import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import type { RelayClient } from "../relayClient.js";
import { listPlacedClips } from "./workflow.js";
import { sameMediaPath, type PlacedClip } from "../silenceMapping.js";
import {
  findPhrase,
  mapTranscriptToSequence,
  parsePremiereTranscript,
  type ParsedTranscript,
} from "../transcriptMapping.js";

// Premiere's own transcript (Text panel / Speech to Text) via the UXP
// Transcript API, mapped to sequence time. Live-verified on Premiere 26.5.2.

const TICKS_PER_SECOND = 254016000000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const source = {
  sequenceId: z.string().optional(),
  mediaPath: z
    .string()
    .optional()
    .describe("Absolute path of the media whose transcript to read. Its clips in the sequence are found by path."),
  projectItemId: z.string().optional().describe("Project item id (from project_list_items); alternative to mediaPath."),
  transcribe: z
    .boolean()
    .optional()
    .default(false)
    .describe("If the clip has no transcript yet, run Premiere's Speech to Text on it first (can take a while)."),
  language: z.string().optional().describe('Language code for transcription, e.g. "en-us" (see languages in the result).'),
};

type Ctx = { relay: RelayClient };

async function loadTranscript(
  ctx: Ctx,
  p: { sequenceId?: string; mediaPath?: string; projectItemId?: string; transcribe?: boolean; language?: string },
): Promise<{ transcript: ParsedTranscript; mediaPath?: string; projectItemId: string; clips: PlacedClip[]; transcribed: boolean }> {
  if (!p.mediaPath && !p.projectItemId) throw new Error("Pass mediaPath or projectItemId.");
  const clips = await listPlacedClips(ctx, p.sequenceId);
  let projectItemId = p.projectItemId;
  let mediaPath = p.mediaPath;
  if (!projectItemId) {
    const hit = clips.find((c) => sameMediaPath(c.mediaFilePath, mediaPath)) as (PlacedClip & { projectItemId?: string }) | undefined;
    projectItemId = hit?.projectItemId;
    if (!projectItemId) {
      throw new Error("That media isn't in the sequence, so its project item can't be found by path. Pass projectItemId (project_list_items).");
    }
  }
  if (!mediaPath) {
    const info = (await ctx.relay.call("media.getInfo", { projectItemId })) as { mediaFilePath?: string };
    mediaPath = info?.mediaFilePath;
  }
  let transcribed = false;
  const tryExport = async () => {
    const r = (await ctx.relay.call("transcript.export", { projectItemId })) as { json: string };
    return parsePremiereTranscript(r.json);
  };
  try {
    return { transcript: await tryExport(), mediaPath, projectItemId, clips, transcribed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/no transcript/i.test(msg) || !p.transcribe) throw e;
  }
  await ctx.relay.call("transcript.transcribe", { projectItemId, language: p.language }, 600000);
  transcribed = true;
  // transcribeClipProjectItem resolves when the job is queued; poll for the result.
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      return { transcript: await tryExport(), mediaPath, projectItemId, clips, transcribed };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(3000);
    }
  }
  throw new Error(`Transcription started but no transcript appeared within 10 minutes (${lastErr}).`);
}

export const transcriptTools = [
  defineTool({
    name: "transcript_get",
    title: "Read Premiere's transcript at sequence time",
    description:
      "Read Premiere's own Speech-to-Text transcript of a clip (UXP Transcript API) as segments or words, with each item's time mapped onto the sequence for every instance of the clip (in point, speed and trims respected; items outside the visible part are dropped). Set transcribe: true to run Premiere's transcription first if the clip has none.",
    inputSchema: {
      ...source,
      level: z.enum(["segments", "words"]).optional().default("segments"),
      maxItems: z.number().int().positive().optional().default(500),
    },
    handler: async (p, ctx) => {
      const t = await loadTranscript(ctx, p);
      const mapped = mapTranscriptToSequence(t.transcript, t.clips, t.mediaPath, p.level);
      const note =
        mapped.matchedClips === 0
          ? "The clip isn't in this sequence, so no sequence times; the source-time transcript is in `segments`."
          : undefined;
      const text = t.transcript.segments.map((s) => s.text).join(" ");
      return {
        text: `Transcript (${t.transcript.language ?? "?"}, ${t.transcript.segments.length} segment(s)${t.transcribed ? ", just transcribed" : ""}): ${mapped.items.length} ${p.level} at sequence time across ${mapped.instances} instance(s).${note ? " " + note : ""}`,
        data: {
          projectItemId: t.projectItemId,
          mediaPath: t.mediaPath,
          language: t.transcript.language,
          transcribed: t.transcribed,
          text,
          matchedClips: mapped.matchedClips,
          instances: mapped.instances,
          items: mapped.items.slice(0, p.maxItems),
          truncated: mapped.items.length > p.maxItems,
          ...(note
            ? {
                note,
                segments: t.transcript.segments.map((s) => ({
                  text: s.text,
                  sourceStartSeconds: Number(BigInt(s.startTicks)) / TICKS_PER_SECOND,
                  sourceEndSeconds: Number(BigInt(s.endTicks)) / TICKS_PER_SECOND,
                })),
              }
            : {}),
        },
      };
    },
  }),

  defineTool({
    name: "transcript_find_phrase",
    title: "Find a phrase in the transcript",
    description:
      "Find every place a word or phrase is spoken, using Premiere's transcript of the clip, and return the sequence time range of each occurrence (case and punctuation ignored, consecutive words). Optionally add a sequence marker spanning each hit.",
    inputSchema: {
      ...source,
      phrase: z.string().min(1),
      addMarkers: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const t = await loadTranscript(ctx, p);
      const words = mapTranscriptToSequence(t.transcript, t.clips, t.mediaPath, "words");
      const hits = findPhrase(words.items, p.phrase);
      const markers: unknown[] = [];
      if (p.addMarkers) {
        for (const h of hits.slice(0, 50)) {
          try {
            markers.push(
              await ctx.relay.call("marker.add", {
                sequenceId: p.sequenceId,
                atTicks: h.sequenceStartTicks,
                durationTicks: (BigInt(h.sequenceEndTicks) - BigInt(h.sequenceStartTicks)).toString(),
                name: `"${h.text}"`.slice(0, 60),
                comment: `transcript match for "${p.phrase}" at ${h.sequenceStartSeconds.toFixed(2)}-${h.sequenceEndSeconds.toFixed(2)}s`,
              }),
            );
          } catch (e) {
            markers.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return {
        text:
          hits.length === 0
            ? `"${p.phrase}" not found in the transcript${words.matchedClips === 0 ? " (clip not in this sequence)" : ""}.`
            : `"${p.phrase}": ${hits.length} hit(s) at ${hits.map((h) => `${h.sequenceStartSeconds.toFixed(2)}-${h.sequenceEndSeconds.toFixed(2)}s`).join(", ")}${p.addMarkers ? " (markers added)" : ""}.`,
        data: { phrase: p.phrase, hits, markers: p.addMarkers ? markers : undefined, matchedClips: words.matchedClips },
      };
    },
  }),
];
