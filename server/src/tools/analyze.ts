import { z } from "zod";
import { defineTool, ToolContext } from "../toolDefinition.js";
import {
  detectOnsetsInFile,
  detectSceneCutsInFile,
  detectSilenceInFile,
  findFfmpeg,
  parseSrt,
  suggestCutPoints,
  transcribeMedia,
} from "../mediaAnalysis.js";
import fs from "node:fs";
import { placeText } from "../textEngine.js";

// Category N — timeline graph walks + real ffmpeg DSP / STT when available.

type TrackRow = { trackType: string; trackIndex: number; name?: string; clipCount?: number };
type ClipRow = { clipIndex: number; name?: string; startTicks?: string; endTicks?: string };
type ProjectItem = { id: string; name: string; isBin: boolean; children?: ProjectItem[] };

function big(s: string | undefined): bigint | undefined {
  if (s === undefined || s === null || s === "") return undefined;
  try {
    return BigInt(s);
  } catch {
    return undefined;
  }
}

function flattenProjectItems(items: ProjectItem[], path: string[] = []): Array<{ id: string; name: string; path: string[] }> {
  const out: Array<{ id: string; name: string; path: string[] }> = [];
  for (const it of items) {
    if (it.isBin) {
      out.push(...flattenProjectItems(it.children ?? [], [...path, it.name]));
    } else {
      out.push({ id: it.id, name: it.name, path });
    }
  }
  return out;
}

async function loadTimeline(ctx: ToolContext, sequenceId: string | undefined) {
  // sequence.getActive ignores sequenceId — when a specific id is given,
  // resolve it from sequence.list so analysis targets the right sequence.
  let seq: unknown;
  if (sequenceId) {
    const list = (await ctx.relay.call("sequence.list", {})) as Array<{ sequenceId?: string; name?: string }>;
    seq = list.find((s) => s.sequenceId === sequenceId) ?? { sequenceId, note: "not found in sequence.list" };
  } else {
    seq = await ctx.relay.call("sequence.getActive", {});
  }
  const tracks = (await ctx.relay.call("track.list", sequenceId ? { sequenceId } : {})) as TrackRow[];
  const perTrack = await Promise.all(
    tracks.map(async (t) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: t.trackType,
        trackIndex: t.trackIndex,
      })) as ClipRow[];
      return { ...t, clips };
    }),
  );
  const markers = await ctx.relay.call("marker.list", sequenceId ? { sequenceId } : {}).catch(() => []);
  return { sequence: seq, tracks: perTrack, markers };
}

export const analyzeTools = [
  defineTool({
    name: "analyze_get_timeline_summary",
    title: "Timeline structure summary",
    description:
      "Summarize a sequence: tracks, clips (name/position/duration), and markers. Same data as workflow_summarize_timeline — the atomic analyze entry point.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await loadTimeline(ctx, p.sequenceId);
      return {
        text: `Timeline summary for "${(data.sequence as { name?: string }).name ?? "active sequence"}".`,
        data,
      };
    },
  }),

  defineTool({
    name: "analyze_sequence_structure",
    title: "Analyze sequence structure",
    description:
      "Structural stats for a sequence: track counts, total clips, total span in ticks, clips per track, marker count. No content analysis.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const { sequence, tracks, markers } = await loadTimeline(ctx, p.sequenceId);
      let minStart: bigint | undefined;
      let maxEnd: bigint | undefined;
      let clipTotal = 0;
      const perTrack = tracks.map((t) => {
        clipTotal += t.clips.length;
        for (const c of t.clips) {
          const s = big(c.startTicks);
          const e = big(c.endTicks);
          if (s !== undefined && (minStart === undefined || s < minStart)) minStart = s;
          if (e !== undefined && (maxEnd === undefined || e > maxEnd)) maxEnd = e;
        }
        return {
          trackType: t.trackType,
          trackIndex: t.trackIndex,
          name: t.name,
          clipCount: t.clips.length,
        };
      });
      const data = {
        sequence,
        videoTrackCount: tracks.filter((t) => t.trackType === "video").length,
        audioTrackCount: tracks.filter((t) => t.trackType === "audio").length,
        clipTotal,
        markerCount: Array.isArray(markers) ? markers.length : 0,
        spanStartTicks: minStart !== undefined ? String(minStart) : null,
        spanEndTicks: maxEnd !== undefined ? String(maxEnd) : null,
        spanDurationTicks:
          minStart !== undefined && maxEnd !== undefined ? String(maxEnd - minStart) : null,
        tracks: perTrack,
      };
      return { text: `Sequence structure: ${clipTotal} clips across ${tracks.length} tracks.`, data };
    },
  }),

  defineTool({
    name: "analyze_detect_gaps",
    title: "Detect gaps on tracks",
    description:
      "Find empty gaps between consecutive clips on each track (and leading gaps from 0). Pure timeline math from clip_list — not content/silence detection.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.enum(["video", "audio", "both"]).optional().default("both"),
      minGapTicks: z
        .string()
        .optional()
        .default("0")
        .describe("Ignore gaps shorter than this many ticks (string for large integers)."),
    },
    handler: async (p, ctx) => {
      const minGap = big(p.minGapTicks) ?? 0n;
      const { tracks } = await loadTimeline(ctx, p.sequenceId);
      const filtered = tracks.filter(
        (t) => p.trackType === "both" || t.trackType === p.trackType,
      );
      const gaps: Array<{
        trackType: string;
        trackIndex: number;
        startTicks: string;
        endTicks: string;
        durationTicks: string;
      }> = [];
      for (const t of filtered) {
        const sorted = [...t.clips]
          .map((c) => ({ start: big(c.startTicks), end: big(c.endTicks) }))
          .filter((c) => c.start !== undefined && c.end !== undefined)
          .sort((a, b) => (a.start! < b.start! ? -1 : 1));
        let cursor = 0n;
        for (const c of sorted) {
          if (c.start! > cursor) {
            const dur = c.start! - cursor;
            if (dur >= minGap) {
              gaps.push({
                trackType: t.trackType,
                trackIndex: t.trackIndex,
                startTicks: String(cursor),
                endTicks: String(c.start),
                durationTicks: String(dur),
              });
            }
          }
          if (c.end! > cursor) cursor = c.end!;
        }
      }
      return {
        text: `Found ${gaps.length} gap(s)${minGap > 0n ? ` ≥ ${p.minGapTicks} ticks` : ""}.`,
        data: { gaps, gapCount: gaps.length },
      };
    },
  }),

  defineTool({
    name: "analyze_get_project_statistics",
    title: "Project statistics",
    description:
      "High-level project stats: sequence count, project-panel item counts (bins vs media), and per-sequence clip/marker totals.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const project = await ctx.relay.call("project.getActive", {});
      const sequences = (await ctx.relay.call("sequence.list", {})) as Array<{ sequenceId?: string; id?: string; name?: string }>;
      const rootItems = (await ctx.relay.call("project.listItems", { recursive: true })) as ProjectItem[];
      const flat = flattenProjectItems(rootItems);
      const binCount = countBins(rootItems);
      const perSequence = [];
      for (const s of sequences) {
        const sequenceId = s.sequenceId ?? s.id;
        try {
          const { tracks, markers } = await loadTimeline(ctx, sequenceId);
          perSequence.push({
            sequenceId,
            name: s.name,
            clipTotal: tracks.reduce((n, t) => n + t.clips.length, 0),
            trackCount: tracks.length,
            markerCount: Array.isArray(markers) ? markers.length : 0,
          });
        } catch {
          perSequence.push({ sequenceId, name: s.name, error: "could not load timeline" });
        }
      }
      const data = {
        project,
        sequenceCount: sequences.length,
        mediaItemCount: flat.length,
        binCount,
        sequences: perSequence,
      };
      return {
        text: `Project stats: ${sequences.length} sequence(s), ${flat.length} media item(s), ${binCount} bin(s).`,
        data,
      };
    },
  }),

  defineTool({
    name: "analyze_find_unused_media",
    title: "Find unused media",
    description:
      "List project-panel media items whose names do not appear as timeline clip names in any sequence. Best-effort name match (UXP does not always expose projectItemId on timeline clips); may miss renames and nested sequences.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const rootItems = (await ctx.relay.call("project.listItems", { recursive: true })) as ProjectItem[];
      const media = flattenProjectItems(rootItems);
      const usedNames = new Set<string>();
      const sequences = (await ctx.relay.call("sequence.list", {})) as Array<{ sequenceId?: string; id?: string }>;
      for (const s of sequences) {
        const sequenceId = s.sequenceId ?? s.id;
        try {
          const { tracks } = await loadTimeline(ctx, sequenceId);
          for (const t of tracks) {
            for (const c of t.clips) {
              if (c.name) usedNames.add(c.name);
            }
          }
        } catch {
          /* skip sequences that fail to load */
        }
      }
      const unused = media.filter((m) => !usedNames.has(m.name));
      const data = {
        unused,
        unusedCount: unused.length,
        mediaItemCount: media.length,
        usedNameCount: usedNames.size,
        caveat:
          "Match is by display name only — renamed timeline clips or shared names can produce false positives/negatives.",
      };
      return { text: `Unused media (name match): ${unused.length} of ${media.length} item(s).`, data };
    },
  }),

  defineTool({
    name: "analyze_compare_sequences",
    title: "Compare two sequences",
    description:
      "Compare structure of two sequences: track counts, clip counts, span, and clip name sets (added/removed/shared by name).",
    inputSchema: {
      sequenceIdA: z.string(),
      sequenceIdB: z.string(),
    },
    handler: async (p, ctx) => {
      const a = await loadTimeline(ctx, p.sequenceIdA);
      const b = await loadTimeline(ctx, p.sequenceIdB);
      const namesA = new Set<string>();
      const namesB = new Set<string>();
      let clipsA = 0;
      let clipsB = 0;
      for (const t of a.tracks) {
        clipsA += t.clips.length;
        for (const c of t.clips) if (c.name) namesA.add(c.name);
      }
      for (const t of b.tracks) {
        clipsB += t.clips.length;
        for (const c of t.clips) if (c.name) namesB.add(c.name);
      }
      const onlyA = [...namesA].filter((n) => !namesB.has(n));
      const onlyB = [...namesB].filter((n) => !namesA.has(n));
      const shared = [...namesA].filter((n) => namesB.has(n));
      const data = {
        a: {
          sequenceId: p.sequenceIdA,
          sequence: a.sequence,
          trackCount: a.tracks.length,
          clipCount: clipsA,
          markerCount: Array.isArray(a.markers) ? a.markers.length : 0,
        },
        b: {
          sequenceId: p.sequenceIdB,
          sequence: b.sequence,
          trackCount: b.tracks.length,
          clipCount: clipsB,
          markerCount: Array.isArray(b.markers) ? b.markers.length : 0,
        },
        clipNamesOnlyInA: onlyA,
        clipNamesOnlyInB: onlyB,
        clipNamesShared: shared,
      };
      return {
        text: `Compare: A has ${clipsA} clips / ${a.tracks.length} tracks; B has ${clipsB} clips / ${b.tracks.length} tracks; ${shared.length} shared clip name(s).`,
        data,
      };
    },
  }),

  // ── Real DSP (ffmpeg) ─────────────────────────────────────────────

  defineTool({
    name: "analyze_detect_silence",
    title: "Detect silence in a media file",
    description:
      "Real silence detection via ffmpeg silencedetect on an absolute media path. Returns silence regions in seconds + ticks. Not fake — requires ffmpeg on PATH.",
    inputSchema: {
      mediaPath: z.string().describe("Absolute path to audio or video file."),
      noiseDb: z.number().optional().default(-30).describe("Noise floor in dB (e.g. -30)."),
      minDuration: z.number().optional().default(0.35).describe("Minimum silence length in seconds."),
      addMarkers: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, add markers at silence starts on the active sequence."),
      sequenceId: z.string().optional(),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return {
          text: "ffmpeg not found — install ffmpeg or set FFMPEG_PATH.",
          data: { ok: false, needFfmpeg: true },
        };
      }
      const result = detectSilenceInFile(p.mediaPath, {
        noiseDb: p.noiseDb,
        minDuration: p.minDuration,
      });
      const markers = [];
      if (p.addMarkers) {
        for (const r of result.regions.slice(0, 40)) {
          try {
            const data = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: r.startTicks,
              name: `Silence ${r.startSeconds.toFixed(1)}s`,
              comments: `dur ${r.durationSeconds.toFixed(2)}s`,
            });
            markers.push({ ok: true, data });
          } catch (e) {
            markers.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return {
        text: `Silence: ${result.regions.length} region(s) (noise ${result.noiseDb}dB, min ${result.minDuration}s) via ${result.engine}.`,
        data: { ...result, markers: markers.length ? markers : undefined },
      };
    },
  }),

  defineTool({
    name: "analyze_detect_onsets",
    title: "Detect onsets / beat-like / footstep-like peaks",
    description:
      "Real energy-peak onset detection on mono PCM extracted by ffmpeg. Labels beat_like / footstep_like are interval heuristics (not ML genre detection). Good for SFX hit placement.",
    inputSchema: {
      mediaPath: z.string(),
      maxEvents: z.number().int().optional().default(60),
      sensitivity: z.number().min(0.05).max(1).optional().default(0.35),
      minIntervalMs: z.number().optional().default(120),
      addMarkers: z.boolean().optional().default(false),
      sequenceId: z.string().optional(),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg not found.", data: { ok: false, needFfmpeg: true } };
      }
      const result = detectOnsetsInFile(p.mediaPath, {
        maxEvents: p.maxEvents,
        sensitivity: p.sensitivity,
        minIntervalMs: p.minIntervalMs,
      });
      const markers = [];
      if (p.addMarkers) {
        for (const e of result.events.slice(0, 40)) {
          try {
            const data = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: e.ticks,
              name: e.kind,
              comments: `str=${e.strength}`,
            });
            markers.push({ ok: true, data });
          } catch (err) {
            markers.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      return {
        text: `Onsets: ${result.events.length} peak(s) via ${result.engine}.`,
        data: { ...result, markers: markers.length ? markers : undefined },
      };
    },
  }),

  defineTool({
    name: "analyze_detect_scene_changes",
    title: "Detect scene cuts in video",
    description: "Real scene-change detection via ffmpeg scene filter. Returns cut times in seconds + ticks.",
    inputSchema: {
      mediaPath: z.string(),
      threshold: z.number().min(0.05).max(1).optional().default(0.35),
      maxCuts: z.number().int().optional().default(80),
      addMarkers: z.boolean().optional().default(false),
      sequenceId: z.string().optional(),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg not found.", data: { ok: false, needFfmpeg: true } };
      }
      const result = detectSceneCutsInFile(p.mediaPath, {
        threshold: p.threshold,
        maxCuts: p.maxCuts,
      });
      const markers = [];
      if (p.addMarkers) {
        for (const c of result.cuts.slice(0, 40)) {
          try {
            const data = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: c.ticks,
              name: `Scene ${c.seconds.toFixed(1)}s`,
            });
            markers.push({ ok: true, data });
          } catch (e) {
            markers.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return {
        text: `Scene cuts: ${result.cuts.length} (threshold ${result.threshold}) via ${result.engine}.`,
        data: { ...result, markers: markers.length ? markers : undefined },
      };
    },
  }),

  defineTool({
    name: "analyze_suggest_cut_points",
    title: "Suggest cut points (silence + optional onsets/scenes)",
    description:
      "Merge real silence / onset / scene analysis into cut suggestions. Optional markers on the active sequence.",
    inputSchema: {
      mediaPath: z.string(),
      includeSilence: z.boolean().optional().default(true),
      includeOnsets: z.boolean().optional().default(false),
      includeScenes: z.boolean().optional().default(false),
      max: z.number().int().optional().default(80),
      addMarkers: z.boolean().optional().default(false),
      sequenceId: z.string().optional(),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg not found.", data: { ok: false, needFfmpeg: true } };
      }
      const result = suggestCutPoints(p.mediaPath, {
        includeSilence: p.includeSilence,
        includeOnsets: p.includeOnsets,
        includeScenes: p.includeScenes,
        max: p.max,
      });
      const markers = [];
      if (p.addMarkers) {
        for (const s of result.suggestions.slice(0, 50)) {
          try {
            const data = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: s.ticks,
              name: s.reason,
              comments: s.detail,
            });
            markers.push({ ok: true, data });
          } catch (e) {
            markers.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return {
        text: `Cut suggestions: ${result.suggestions.length} (${result.engines.join(", ")}).`,
        data: { ...result, markers: markers.length ? markers : undefined },
      };
    },
  }),

  defineTool({
    name: "analyze_transcribe",
    title: "Transcribe media (STT)",
    description:
      "Speech-to-text pipeline: extract audio (ffmpeg) → whisper CLI if installed, else Windows System.Speech. Writes SRT. Prefer whisper: pip install openai-whisper. For known SRT use caption_import_srt.",
    inputSchema: {
      mediaPath: z.string(),
      language: z.string().optional().describe("e.g. en, tr — whisper language code or Windows culture en-US."),
      maxSeconds: z.number().optional().default(600),
      engine: z.enum(["auto", "whisper", "windows"]).optional().default("auto"),
    },
    handler: async (p) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg required for STT audio extract.", data: { ok: false, needFfmpeg: true } };
      }
      try {
        const result = transcribeMedia(p.mediaPath, {
          language: p.language,
          maxSeconds: p.maxSeconds,
          engine: p.engine,
        });
        return {
          text: `Transcribed ${result.segments.length} segment(s) via ${result.engine}. SRT: ${result.srtPath}`,
          data: result,
        };
      } catch (e) {
        return {
          text: e instanceof Error ? e.message : String(e),
          data: {
            ok: false,
            recovery:
              "pip install openai-whisper  OR  pass an SRT to caption_import_srt / caption_place_from_srt",
          },
        };
      }
    },
  }),

  defineTool({
    name: "caption_import_srt",
    title: "Import / parse SRT file",
    description: "Parse an SRT file into segments (seconds + ticks). Does not place on timeline — use caption_place_from_srt.",
    inputSchema: { srtPath: z.string() },
    handler: async (p) => {
      if (!fs.existsSync(p.srtPath)) {
        return { text: `SRT not found: ${p.srtPath}`, data: { ok: false } };
      }
      const segments = parseSrt(fs.readFileSync(p.srtPath, "utf8"));
      return {
        text: `Parsed ${segments.length} caption segment(s) from SRT.`,
        data: { segments, srtPath: p.srtPath },
      };
    },
  }),

  defineTool({
    name: "caption_place_from_srt",
    title: "Place captions from SRT on timeline",
    description:
      "Place each SRT segment as on-screen text (multi-path text engine) and/or markers. Real caption pipeline without Adobe Transcript API. Cap maxSegments to avoid thrash.",
    inputSchema: {
      srtPath: z.string().optional().describe("Path to .srt. Omit if segments[] provided."),
      segments: z
        .array(
          z.object({
            text: z.string(),
            startSeconds: z.number().optional(),
            startTicks: z.string().optional(),
            endSeconds: z.number().optional(),
          }),
        )
        .optional(),
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().optional().default(1),
      maxSegments: z.number().int().optional().default(40),
      placeText: z.boolean().optional().default(true),
      placeMarkers: z.boolean().optional().default(true),
      style: z.enum(["caption", "lower_third", "title"]).optional().default("caption"),
    },
    handler: async (p, ctx) => {
      let segments = p.segments || [];
      if (p.srtPath) {
        if (!fs.existsSync(p.srtPath)) {
          return { text: `SRT not found: ${p.srtPath}`, data: { ok: false } };
        }
        segments = parseSrt(fs.readFileSync(p.srtPath, "utf8"));
      }
      if (!segments.length) {
        return { text: "No segments — provide srtPath or segments[].", data: { ok: false } };
      }
      const slice = segments.slice(0, p.maxSegments);
      const results = [];
      for (const seg of slice) {
        const atTicks =
          seg.startTicks ||
          (typeof seg.startSeconds === "number"
            ? String(BigInt(Math.floor(seg.startSeconds * 254016000000)))
            : "0");
        const row: Record<string, unknown> = { text: seg.text, atTicks };
        if (p.placeMarkers) {
          try {
            row.marker = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks,
              name: String(seg.text).slice(0, 40),
              comments: "caption",
            });
          } catch (e) {
            row.markerError = e instanceof Error ? e.message : String(e);
          }
        }
        if (p.placeText) {
          try {
            const r = await placeText(ctx, {
              sequenceId: p.sequenceId,
              trackIndex: p.trackIndex ?? 1,
              atTicks,
              text: String(seg.text),
              style: p.style || "caption",
              appearance: "plain",
              verify: false,
            });
            row.textPlace = { ok: r.ok, via: r.via, quality: r.quality };
          } catch (e) {
            row.textError = e instanceof Error ? e.message : String(e);
          }
        }
        results.push(row);
      }
      return {
        text: `Placed ${results.length}/${segments.length} caption segment(s) (text=${p.placeText}, markers=${p.placeMarkers}).`,
        data: { results, total: segments.length, capped: segments.length > slice.length },
      };
    },
  }),

  defineTool({
    name: "caption_generate_auto",
    title: "Auto captions from media (STT + place)",
    description:
      "Full caption pipeline: transcribe media → write SRT → place text/markers on timeline. Needs ffmpeg + (whisper recommended or Windows Speech). Not Adobe auto-transcribe API (broken/unavailable in UXP).",
    inputSchema: {
      mediaPath: z.string(),
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().optional().default(1),
      language: z.string().optional(),
      maxSeconds: z.number().optional().default(600),
      maxSegments: z.number().int().optional().default(40),
      engine: z.enum(["auto", "whisper", "windows"]).optional().default("auto"),
      placeText: z.boolean().optional().default(true),
      placeMarkers: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg required.", data: { ok: false, needFfmpeg: true } };
      }
      let transcript;
      try {
        transcript = transcribeMedia(p.mediaPath, {
          language: p.language,
          maxSeconds: p.maxSeconds,
          engine: p.engine,
        });
      } catch (e) {
        return {
          text: e instanceof Error ? e.message : String(e),
          data: {
            ok: false,
            recovery: "pip install openai-whisper, or caption_import_srt with external SRT",
          },
        };
      }
      // Re-use place logic
      const slice = transcript.segments.slice(0, p.maxSegments);
      const results = [];
      for (const seg of slice) {
        const row: Record<string, unknown> = { text: seg.text, atTicks: seg.startTicks };
        if (p.placeMarkers) {
          try {
            row.marker = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: seg.startTicks,
              name: seg.text.slice(0, 40),
              comments: "auto-caption",
            });
          } catch (e) {
            row.markerError = e instanceof Error ? e.message : String(e);
          }
        }
        if (p.placeText) {
          try {
            const r = await placeText(ctx, {
              sequenceId: p.sequenceId,
              trackIndex: p.trackIndex ?? 1,
              atTicks: seg.startTicks,
              text: seg.text,
              style: "caption",
              verify: false,
            });
            row.textPlace = { ok: r.ok, via: r.via, quality: r.quality };
          } catch (e) {
            row.textError = e instanceof Error ? e.message : String(e);
          }
        }
        results.push(row);
      }
      return {
        text: `Auto captions: ${results.length} placed via STT engine ${transcript.engine}. SRT: ${transcript.srtPath}`,
        data: {
          engine: transcript.engine,
          srtPath: transcript.srtPath,
          note: transcript.note,
          results,
          segmentCount: transcript.segments.length,
        },
      };
    },
  }),

  defineTool({
    name: "analyze_media_capabilities",
    title: "Media analysis capabilities",
    description: "Report whether ffmpeg / whisper are available for silence, onset, scene, STT.",
    inputSchema: {},
    handler: async () => {
      const ffmpeg = findFfmpeg();
      let whisper = false;
      try {
        const { spawnSync } = await import("node:child_process");
        const r = spawnSync("python", ["-m", "whisper", "--help"], {
          encoding: "utf8",
          timeout: 8000,
          windowsHide: true,
        });
        whisper = r.status === 0 || /whisper/i.test((r.stdout || "") + (r.stderr || ""));
      } catch {
        whisper = false;
      }
      return {
        text: `ffmpeg=${!!ffmpeg} whisper=${whisper}`,
        data: {
          ffmpegPath: ffmpeg,
          whisperCli: whisper,
          tools: {
            analyze_detect_silence: !!ffmpeg,
            analyze_detect_onsets: !!ffmpeg,
            analyze_detect_scene_changes: !!ffmpeg,
            analyze_suggest_cut_points: !!ffmpeg,
            analyze_transcribe: !!ffmpeg,
            caption_generate_auto: !!ffmpeg,
            caption_import_srt: true,
            caption_place_from_srt: true,
          },
          tips: [
            ffmpeg ? "ffmpeg OK" : "Install ffmpeg (winget install ffmpeg)",
            whisper ? "whisper OK" : "For better STT: pip install openai-whisper",
            "caption_import_srt works without STT",
          ],
        },
      };
    },
  }),
];

function countBins(items: ProjectItem[]): number {
  let n = 0;
  for (const it of items) {
    if (it.isBin) {
      n += 1;
      n += countBins(it.children ?? []);
    }
  }
  return n;
}
