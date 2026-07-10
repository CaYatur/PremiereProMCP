import { z } from "zod";
import { defineTool, ToolContext } from "../toolDefinition.js";
import { goToFrame, resolveTimebase, stepFrames, ticksToFrame, ticksToSeconds } from "../timebase.js";

const clipRefObj = z.object({
  trackType: z.enum(["video", "audio"]),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
});

type ClipListItem = {
  clipIndex: number;
  name?: string;
  startTicks?: string;
  endTicks?: string;
};

type TrackRow = { trackType: string; trackIndex: number };

/** Collect all edit-point tick strings (clip starts + ends) across tracks. */
async function collectEditPoints(ctx: ToolContext, sequenceId: string | undefined): Promise<bigint[]> {
  const tracks = (await ctx.relay.call("track.list", sequenceId ? { sequenceId } : {})) as TrackRow[];
  const points = new Set<string>();
  for (const t of tracks) {
    const clips = (await ctx.relay.call("clip.list", {
      sequenceId,
      trackType: t.trackType,
      trackIndex: t.trackIndex,
    })) as ClipListItem[];
    for (const c of clips) {
      if (c.startTicks) points.add(c.startTicks);
      if (c.endTicks) points.add(c.endTicks);
    }
  }
  return [...points]
    .map((s) => BigInt(s))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export const selectionTools = [
  defineTool({
    name: "playhead_get_position",
    title: "Get playhead position",
    description:
      "Get the current playhead position: ticks, 0-based frame number, seconds, fps, and ticksPerFrame (sequence timebase).",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const raw = (await ctx.relay.call("playhead.get", p)) as {
        ticks: string;
        frame?: number;
        seconds?: number;
        ticksPerFrame?: string;
        fps?: number;
      };
      if (raw.frame !== undefined && raw.ticksPerFrame) {
        return { text: `Playhead: frame ${raw.frame} @ ${raw.ticks} ticks (${raw.fps} fps).`, data: raw };
      }
      const tb = await resolveTimebase(ctx.relay, p.sequenceId);
      const data = {
        ticks: raw.ticks,
        frame: ticksToFrame(raw.ticks, tb.ticksPerFrame),
        seconds: ticksToSeconds(raw.ticks),
        ticksPerFrame: String(tb.ticksPerFrame),
        fps: Math.round(tb.fps * 1000) / 1000,
      };
      return { text: `Playhead: frame ${data.frame} @ ${data.ticks} ticks (${data.fps} fps).`, data };
    },
  }),

  defineTool({
    name: "playhead_set_position",
    title: "Set playhead position",
    description: "Move the playhead to a given time in ticks. Prefer playhead_go_to_frame for frame-accurate moves.",
    inputSchema: { sequenceId: z.string().optional(), atTicks: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("playhead.set", p);
      return { text: `Playhead moved to ${p.atTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "playhead_go_to_frame",
    title: "Go to frame number",
    description:
      "Move the playhead to an absolute 0-based frame number using the sequence timebase (frame-accurate). Use this to scrub every frame.",
    inputSchema: {
      sequenceId: z.string().optional(),
      frame: z.number().int().describe("0-based frame index (0 = first frame)."),
    },
    handler: async (p, ctx) => {
      const data = await goToFrame(ctx.relay, { sequenceId: p.sequenceId, frame: p.frame });
      return {
        text: `Playhead at frame ${data.frame} (${data.atTicks} ticks, via ${data.via}).`,
        data,
      };
    },
  }),

  defineTool({
    name: "playhead_step_frames",
    title: "Step playhead by N frames",
    description:
      "Move the playhead forward (positive) or backward (negative) by N frames. Frame-accurate using sequence timebase.",
    inputSchema: {
      sequenceId: z.string().optional(),
      deltaFrames: z.number().int().describe("Frames to step; negative goes backward."),
    },
    handler: async (p, ctx) => {
      const data = await stepFrames(ctx.relay, {
        sequenceId: p.sequenceId,
        deltaFrames: p.deltaFrames,
      });
      return {
        text: `Stepped to frame ${data.frame} (${data.atTicks} ticks, via ${data.via}).`,
        data,
      };
    },
  }),

  defineTool({
    name: "playhead_go_to_marker",
    title: "Move playhead to a marker",
    description:
      "Move the playhead to the start of a sequence marker (by markerIndex from marker_list). Pure composition of marker_list + playhead_set.",
    inputSchema: {
      sequenceId: z.string().optional(),
      markerIndex: z.number().int().describe("Index from marker_list."),
    },
    handler: async (p, ctx) => {
      const markers = (await ctx.relay.call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})) as Array<{
        markerIndex: number;
        startTicks: string;
        name?: string;
      }>;
      const m = markers.find((x) => x.markerIndex === p.markerIndex) ?? markers[p.markerIndex];
      if (!m) {
        return { text: `No marker at index ${p.markerIndex}.`, data: { found: false } };
      }
      await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks: m.startTicks });
      return {
        text: `Playhead moved to marker ${p.markerIndex}${m.name ? ` ("${m.name}")` : ""} at ${m.startTicks} ticks.`,
        data: { atTicks: m.startTicks, marker: m },
      };
    },
  }),

  defineTool({
    name: "playhead_go_to_next_edit",
    title: "Move playhead to next edit point",
    description:
      "Move the playhead to the next clip start/end boundary after the current position. Computed from clip_list (no dedicated Premiere 'next edit' API).",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const pos = (await ctx.relay.call("playhead.get", p)) as { ticks: string };
      const now = BigInt(pos.ticks);
      const points = await collectEditPoints(ctx, p.sequenceId);
      const next = points.find((t) => t > now);
      if (next === undefined) {
        return { text: "No edit point after the current playhead.", data: { atTicks: pos.ticks, moved: false } };
      }
      const atTicks = String(next);
      await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks });
      return { text: `Playhead moved to next edit at ${atTicks} ticks.`, data: { atTicks, moved: true } };
    },
  }),

  defineTool({
    name: "playhead_go_to_previous_edit",
    title: "Move playhead to previous edit point",
    description:
      "Move the playhead to the previous clip start/end boundary before the current position. Computed from clip_list.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const pos = (await ctx.relay.call("playhead.get", p)) as { ticks: string };
      const now = BigInt(pos.ticks);
      const points = await collectEditPoints(ctx, p.sequenceId);
      let prev: bigint | undefined;
      for (const t of points) {
        if (t < now) prev = t;
        else break;
      }
      if (prev === undefined) {
        return { text: "No edit point before the current playhead.", data: { atTicks: pos.ticks, moved: false } };
      }
      const atTicks = String(prev);
      await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks });
      return { text: `Playhead moved to previous edit at ${atTicks} ticks.`, data: { atTicks, moved: true } };
    },
  }),

  defineTool({
    name: "selection_get",
    title: "Get current timeline selection",
    description:
      "Get the clips currently selected on a sequence's timeline, with trackType/trackIndex/clipIndex when resolvable (via TrackItem.getIsSelected walk).",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("selection.get", p);
      return { text: `Selected clips: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "selection_set",
    title: "Set timeline selection",
    description: "Replace the current timeline selection with the given set of clips.",
    inputSchema: { sequenceId: z.string().optional(), clips: z.array(clipRefObj).min(1) },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("selection.set", p);
      return { text: `Selected ${p.clips.length} clip(s).`, data };
    },
  }),

  defineTool({
    name: "selection_clear",
    title: "Clear timeline selection",
    description: "Deselect everything on a sequence's timeline.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("selection.clear", p);
      return { text: "Selection cleared.", data };
    },
  }),

  defineTool({
    name: "app_get_version",
    title: "Get Premiere Pro version",
    description:
      "Get the version string of the running Premiere Pro application (ppro.Application.version). Note: one live probe returned undefined despite the type declaration — the tool surfaces that honestly.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("app.getVersion", {});
      return { text: `Premiere Pro version: ${JSON.stringify(data)}`, data };
    },
  }),
];
