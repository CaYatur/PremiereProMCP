/**
 * Pure mapping of source-media time ranges (e.g. ffmpeg silencedetect output,
 * measured from the start of the media FILE) onto sequence time, for every
 * instance of that media placed in a sequence. No Premiere / relay access, so
 * it is unit-testable (scripts/test-silence-mapping.mjs).
 *
 * All times are Premiere ticks as decimal strings (254016000000 per second).
 */

export interface SourceRegion {
  startTicks: string;
  endTicks: string;
}

/** Subset of the plugin's clip.list summary that the mapping needs. */
export interface PlacedClip {
  trackType?: string;
  trackIndex?: number;
  clipIndex: number;
  startTicks?: string;
  endTicks?: string;
  inPointTicks?: string;
  outPointTicks?: string;
  speed?: number;
  mediaFilePath?: string;
}

export interface MappedRegion {
  trackType?: string;
  trackIndex?: number;
  clipIndex: number;
  /** Sequence time of the (trimmed) region. */
  sequenceStartTicks: string;
  sequenceEndTicks: string;
  /** Source-media time actually visible in this clip instance. */
  sourceStartTicks: string;
  sourceEndTicks: string;
}

/** Normalize a file path for comparison (slashes, case, trailing spaces). */
export function normalizeMediaPath(p: string | undefined): string {
  return String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function sameMediaPath(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeMediaPath(a);
  return na !== "" && na === normalizeMediaPath(b);
}

const big = (v: string | undefined): bigint | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  try {
    return BigInt(v);
  } catch {
    return undefined;
  }
};

/**
 * Map one source region into one placed clip. Returns undefined when the
 * region falls outside the clip's [inPoint, outPoint) trim, or the clip lacks
 * timing info. Speed scales source→sequence durations; reversed (negative
 * speed) clips are skipped because their source→sequence direction flips.
 */
export function mapRegionToClip(region: SourceRegion, clip: PlacedClip): MappedRegion | undefined {
  const seqStart = big(clip.startTicks);
  const seqEnd = big(clip.endTicks);
  if (seqStart === undefined || seqEnd === undefined || seqEnd <= seqStart) return undefined;
  const speed = clip.speed === undefined || !Number.isFinite(clip.speed) || clip.speed === 0 ? 1 : clip.speed;
  if (speed < 0) return undefined;
  // Fixed-point speed (1e6) so all math stays in bigint.
  const SCALE = 1_000_000n;
  const sp = BigInt(Math.round(speed * 1_000_000));
  const inPt = big(clip.inPointTicks) ?? 0n;
  const outPt = big(clip.outPointTicks) ?? inPt + ((seqEnd - seqStart) * sp) / SCALE;
  const rs = big(region.startTicks);
  const re = big(region.endTicks);
  if (rs === undefined || re === undefined) return undefined;
  const s = rs > inPt ? rs : inPt;
  const e = re < outPt ? re : outPt;
  if (e <= s) return undefined;
  const toSeq = (t: bigint) => seqStart + ((t - inPt) * SCALE) / sp;
  let qs = toSeq(s);
  let qe = toSeq(e);
  if (qe > seqEnd) qe = seqEnd;
  if (qs < seqStart) qs = seqStart;
  if (qe <= qs) return undefined;
  return {
    trackType: clip.trackType,
    trackIndex: clip.trackIndex,
    clipIndex: clip.clipIndex,
    sequenceStartTicks: String(qs),
    sequenceEndTicks: String(qe),
    sourceStartTicks: String(s),
    sourceEndTicks: String(e),
  };
}

/**
 * Map every region into every clip whose media is `mediaPath` (or into all
 * given clips if mediaPath is omitted — caller already filtered). Result is
 * sorted by sequence time and de-duplicated (linked A/V items of the same
 * instance produce identical ranges).
 */
export function mapSourceRegionsToSequence(
  regions: SourceRegion[],
  clips: PlacedClip[],
  mediaPath?: string,
): { matchedClips: number; mapped: MappedRegion[] } {
  const matches = mediaPath === undefined ? clips : clips.filter((c) => sameMediaPath(c.mediaFilePath, mediaPath));
  const seen = new Set<string>();
  const mapped: MappedRegion[] = [];
  for (const clip of matches) {
    for (const r of regions) {
      const m = mapRegionToClip(r, clip);
      if (!m) continue;
      const key = `${m.sequenceStartTicks}:${m.sequenceEndTicks}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push(m);
    }
  }
  mapped.sort((a, b) => {
    const d = BigInt(a.sequenceStartTicks) - BigInt(b.sequenceStartTicks);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  });
  return { matchedClips: matches.length, mapped };
}
