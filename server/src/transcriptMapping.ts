/**
 * Pure helpers for Premiere's transcript JSON (UXP Transcript.exportToJSON)
 * and for mapping it to sequence time. Times in the JSON are seconds of the
 * media file; mapping onto the timeline reuses silenceMapping's
 * mapRegionToClip, so trims, speed and multiple instances behave the same
 * way as silence markers. No Premiere access: unit-tested in
 * scripts/test-transcript-and-cut.mjs.
 */
import { mapRegionToClip, sameMediaPath, type PlacedClip } from "./silenceMapping.js";

const TICKS_PER_SECOND = 254016000000;
const toTicks = (sec: number): string => String(BigInt(Math.round(sec * TICKS_PER_SECOND)));
const toSec = (ticks: string | bigint): number => Number(BigInt(ticks)) / TICKS_PER_SECOND;

export interface TranscriptWord {
  text: string;
  startTicks: string;
  endTicks: string;
  confidence?: number;
  segmentIndex: number;
}

export interface TranscriptSegment {
  text: string;
  startTicks: string;
  endTicks: string;
  speaker?: string;
  words: TranscriptWord[];
}

export interface ParsedTranscript {
  language?: string;
  segments: TranscriptSegment[];
  speakers: Array<{ id: string; name?: string }>;
}

interface RawWord {
  text?: string;
  start?: number;
  duration?: number;
  confidence?: number;
  type?: string;
}
interface RawSegment {
  start?: number;
  duration?: number;
  speaker?: string;
  words?: RawWord[];
}

/** Parse Premiere's transcript JSON (string or object). Throws on garbage. */
export function parsePremiereTranscript(input: string | object): ParsedTranscript {
  const raw = (typeof input === "string" ? JSON.parse(input) : input) as {
    language?: string;
    segments?: RawSegment[];
    speakers?: Array<{ id: string; name?: string }>;
  };
  if (!raw || !Array.isArray(raw.segments)) throw new Error("Not a Premiere transcript: missing segments[]");
  const segments: TranscriptSegment[] = raw.segments.map((s, si) => {
    const words: TranscriptWord[] = (s.words ?? [])
      .filter((w) => typeof w.start === "number" && typeof w.text === "string" && (w.type ?? "word") !== "punctuation")
      .map((w) => ({
        text: String(w.text),
        startTicks: toTicks(w.start as number),
        endTicks: toTicks((w.start as number) + (w.duration ?? 0)),
        confidence: w.confidence,
        segmentIndex: si,
      }));
    const firstW = words[0];
    const lastW = words[words.length - 1];
    const start = typeof s.start === "number" ? s.start : firstW ? toSec(firstW.startTicks) : 0;
    const end = typeof s.duration === "number" ? start + s.duration : lastW ? toSec(lastW.endTicks) : start;
    return {
      text: words.map((w) => w.text).join(" "),
      startTicks: toTicks(start),
      endTicks: toTicks(end),
      speaker: s.speaker,
      words,
    };
  });
  return { language: raw.language, segments, speakers: raw.speakers ?? [] };
}

export interface PlacedText {
  text: string;
  sourceStartTicks: string;
  sourceEndTicks: string;
  sequenceStartTicks: string;
  sequenceEndTicks: string;
  sequenceStartSeconds: number;
  sequenceEndSeconds: number;
  trackType?: string;
  trackIndex?: number;
  clipIndex: number;
  /** Which placed instance of the media (0-based, in timeline order). */
  instance: number;
  segmentIndex?: number;
}

/**
 * Map transcript segments or words onto the sequence for every instance of
 * mediaPath (linked A/V items of one instance are de-duplicated). Items
 * outside an instance's trimmed range are dropped; items cut by the trim
 * are clipped to the visible part.
 */
export function mapTranscriptToSequence(
  transcript: ParsedTranscript,
  clips: PlacedClip[],
  mediaPath: string | undefined,
  level: "segments" | "words",
): { matchedClips: number; instances: number; items: PlacedText[] } {
  const matches = (mediaPath === undefined ? clips : clips.filter((c) => sameMediaPath(c.mediaFilePath, mediaPath)))
    .slice()
    .sort((a, b) => cmp(a.startTicks, b.startTicks));
  // One instance per distinct timeline placement (A/V halves share it).
  const instanceKeys: string[] = [];
  const instances: PlacedClip[] = [];
  for (const c of matches) {
    const key = `${c.startTicks}:${c.endTicks}:${c.inPointTicks}`;
    if (instanceKeys.includes(key)) continue;
    instanceKeys.push(key);
    instances.push(c);
  }
  const units =
    level === "words"
      ? transcript.segments.flatMap((s) => s.words.map((w) => ({ text: w.text, startTicks: w.startTicks, endTicks: w.endTicks, segmentIndex: w.segmentIndex })))
      : transcript.segments.map((s, i) => ({ text: s.text, startTicks: s.startTicks, endTicks: s.endTicks, segmentIndex: i }));
  const items: PlacedText[] = [];
  instances.forEach((clip, instance) => {
    for (const u of units) {
      const m = mapRegionToClip({ startTicks: u.startTicks, endTicks: u.endTicks }, clip);
      if (!m) continue;
      items.push({
        text: u.text,
        sourceStartTicks: m.sourceStartTicks,
        sourceEndTicks: m.sourceEndTicks,
        sequenceStartTicks: m.sequenceStartTicks,
        sequenceEndTicks: m.sequenceEndTicks,
        sequenceStartSeconds: round3(toSec(m.sequenceStartTicks)),
        sequenceEndSeconds: round3(toSec(m.sequenceEndTicks)),
        trackType: m.trackType,
        trackIndex: m.trackIndex,
        clipIndex: m.clipIndex,
        instance,
        segmentIndex: u.segmentIndex,
      });
    }
  });
  items.sort((a, b) => cmp(a.sequenceStartTicks, b.sequenceStartTicks));
  return { matchedClips: matches.length, instances: instances.length, items };
}

/** Lowercase, strip punctuation; "Don't!" -> "dont". */
export function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface PhraseMatch {
  text: string;
  instance: number;
  sequenceStartTicks: string;
  sequenceEndTicks: string;
  sequenceStartSeconds: number;
  sequenceEndSeconds: number;
  sourceStartTicks: string;
  sourceEndTicks: string;
  trackType?: string;
  trackIndex?: number;
  clipIndex: number;
}

/**
 * Find every occurrence of `phrase` in sequence-mapped WORDS (output of
 * mapTranscriptToSequence(..., "words")). Matching is per instance, on
 * consecutive words, ignoring case and punctuation.
 */
export function findPhrase(words: PlacedText[], phrase: string): PhraseMatch[] {
  const target = phrase.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (target.length === 0) return [];
  const out: PhraseMatch[] = [];
  const byInstance = new Map<number, PlacedText[]>();
  for (const w of words) {
    const list = byInstance.get(w.instance) ?? [];
    list.push(w);
    byInstance.set(w.instance, list);
  }
  for (const [instance, list] of byInstance) {
    const toks = list.map((w) => normalizeToken(w.text));
    for (let i = 0; i + target.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < target.length; j++) {
        if (toks[i + j] !== target[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const first = list[i];
      const last = list[i + target.length - 1];
      if (!first || !last) continue;
      out.push({
        text: list.slice(i, i + target.length).map((w) => w.text).join(" "),
        instance,
        sequenceStartTicks: first.sequenceStartTicks,
        sequenceEndTicks: last.sequenceEndTicks,
        sequenceStartSeconds: first.sequenceStartSeconds,
        sequenceEndSeconds: last.sequenceEndSeconds,
        sourceStartTicks: first.sourceStartTicks,
        sourceEndTicks: last.sourceEndTicks,
        trackType: first.trackType,
        trackIndex: first.trackIndex,
        clipIndex: first.clipIndex,
      });
    }
  }
  out.sort((a, b) => cmp(a.sequenceStartTicks, b.sequenceStartTicks));
  return out;
}

function cmp(a: string | undefined, b: string | undefined): number {
  const d = BigInt(a ?? "0") - BigInt(b ?? "0");
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
