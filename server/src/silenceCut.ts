/**
 * Pure planning for confirmed silence cutting (workflow_cut_silence).
 * Takes silence regions already mapped to sequence time (silenceMapping)
 * and turns them into ripple-delete ranges: keeps `padding` of audio next to
 * speech, drops cuts shorter than `minCut`, merges overlaps, skips clips the
 * splitter can't handle (speed != 1), and orders cuts from the END of the
 * timeline backward so earlier ranges stay valid while later ones ripple.
 * The plan token is a hash of everything the apply step will do, so apply
 * refuses to run if the timeline or settings changed since the dry run.
 * No Premiere access: unit-tested in scripts/test-transcript-and-cut.mjs.
 */
import { createHash } from "node:crypto";
import type { MappedRegion, PlacedClip } from "./silenceMapping.js";

export interface CutRange {
  trackType?: string;
  trackIndex?: number;
  /** clip index at plan time (informational; apply re-finds the clip by time). */
  clipIndex: number;
  startTicks: string;
  endTicks: string;
  durationTicks: string;
}

export interface SkippedRegion {
  sequenceStartTicks: string;
  sequenceEndTicks: string;
  reason: string;
}

export interface CutPlan {
  cuts: CutRange[];
  skipped: SkippedRegion[];
  totalRemovedTicks: string;
  token: string;
}

const sameClip = (c: PlacedClip, m: MappedRegion) =>
  c.clipIndex === m.clipIndex && c.trackIndex === m.trackIndex && (c.trackType ?? "") === (m.trackType ?? "");

export function planSilenceCuts(
  regions: MappedRegion[],
  clips: PlacedClip[],
  opts: { paddingTicks: bigint; minCutTicks: bigint; tokenSeed: string; frameTicks?: bigint },
): CutPlan {
  const skipped: SkippedRegion[] = [];
  const raw: CutRange[] = [];
  for (const r of regions) {
    const clip = clips.find((c) => sameClip(c, r));
    const speed = clip?.speed ?? 1;
    if (clip && Math.abs(speed - 1) > 1e-6) {
      skipped.push({ sequenceStartTicks: r.sequenceStartTicks, sequenceEndTicks: r.sequenceEndTicks, reason: `clip speed ${speed} (only 100% clips can be split)` });
      continue;
    }
    const cs = clip?.startTicks !== undefined ? BigInt(clip.startTicks) : undefined;
    const ce = clip?.endTicks !== undefined ? BigInt(clip.endTicks) : undefined;
    let s = BigInt(r.sequenceStartTicks);
    let e = BigInt(r.sequenceEndTicks);
    // Pad only the sides that touch speech; silence at the clip's own
    // head/tail is cut flush.
    if (cs === undefined || s > cs) s += opts.paddingTicks;
    if (ce === undefined || e < ce) e -= opts.paddingTicks;
    // Cut edges inside a clip must sit on frame boundaries (Premiere snaps
    // edits to frames). Round inward so speech is never shortened; edges at
    // the clip's own head/tail stay where they are.
    const f = opts.frameTicks && opts.frameTicks > 0n ? opts.frameTicks : 0n;
    if (f > 0n) {
      if (cs === undefined || s > cs) s = ((s + f - 1n) / f) * f;
      if (ce === undefined || e < ce) e = (e / f) * f;
    }
    if (e - s < opts.minCutTicks || e <= s) {
      skipped.push({ sequenceStartTicks: r.sequenceStartTicks, sequenceEndTicks: r.sequenceEndTicks, reason: "shorter than minCut after padding" });
      continue;
    }
    raw.push({ trackType: r.trackType, trackIndex: r.trackIndex, clipIndex: r.clipIndex, startTicks: String(s), endTicks: String(e), durationTicks: String(e - s) });
  }
  // Merge overlaps on the same track.
  raw.sort((a, b) => {
    const k = `${a.trackType}:${a.trackIndex}`.localeCompare(`${b.trackType}:${b.trackIndex}`);
    if (k !== 0) return k;
    const d = BigInt(a.startTicks) - BigInt(b.startTicks);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  });
  const merged: CutRange[] = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.trackType === c.trackType && prev.trackIndex === c.trackIndex && BigInt(c.startTicks) <= BigInt(prev.endTicks)) {
      const end = BigInt(c.endTicks) > BigInt(prev.endTicks) ? BigInt(c.endTicks) : BigInt(prev.endTicks);
      prev.endTicks = String(end);
      prev.durationTicks = String(end - BigInt(prev.startTicks));
    } else {
      merged.push({ ...c });
    }
  }
  // Apply order: latest first.
  merged.sort((a, b) => {
    const d = BigInt(b.startTicks) - BigInt(a.startTicks);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  });
  const total = merged.reduce((t, c) => t + BigInt(c.durationTicks), 0n);
  const token = createHash("sha256")
    .update(JSON.stringify([opts.tokenSeed, merged.map((c) => [c.trackType, c.trackIndex, c.startTicks, c.endTicks])]))
    .digest("hex")
    .slice(0, 16);
  return { cuts: merged, skipped, totalRemovedTicks: String(total), token };
}
