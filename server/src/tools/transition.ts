import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.enum(["video", "audio"]).default("video"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

export const transitionTools = [
  defineTool({
    name: "transition_list_available",
    title: "List available transitions",
    description: "List every video transition Premiere exposes via TransitionFactory (audio not available in UXP).",
    inputSchema: { kind: z.enum(["video", "audio"]).optional().default("video") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("transition.listAvailable", p);
      return { text: `Available ${p.kind} transitions: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "transition_apply",
    title: "Apply a transition",
    description:
      'Apply a video transition at a clip edge via TransitionFactory.createVideoTransition + createAddVideoTransitionAction. matchName e.g. "AE.ADBE Cross Dissolve New" or "ADBE Wipe".',
    inputSchema: {
      ...clipRef,
      matchName: z.string(),
      edge: z.enum(["head", "tail"]).describe("head = start of clip; tail = end of clip."),
      durationTicks: z.string().optional(),
      forceSingleSided: z.boolean().optional(),
      alignment: z.number().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("transition.apply", { ...p, trackType: "video" });
      return { text: `Applied transition ${p.matchName} at ${p.edge} of clip.`, data };
    },
  }),

  defineTool({
    name: "transition_remove",
    title: "Remove a transition",
    description: "Remove a video transition from the head or tail of a clip.",
    inputSchema: { ...clipRef, edge: z.enum(["head", "tail"]) },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("transition.remove", { ...p, trackType: "video" });
      return { text: `Removed transition at ${p.edge} of clip.`, data };
    },
  }),

  defineTool({
    name: "transition_set_duration",
    title: "Set transition duration",
    description:
      "Re-apply a transition with a new duration (remove is not required if none exists). Provide matchName of the transition to apply.",
    inputSchema: {
      ...clipRef,
      edge: z.enum(["head", "tail"]),
      durationTicks: z.string(),
      matchName: z.string().describe("Transition matchName to (re)apply at this duration."),
    },
    handler: async (p, ctx) => {
      await ctx.relay.call("transition.remove", { ...p, trackType: "video" }).catch(() => undefined);
      const data = await ctx.relay.call("transition.apply", {
        ...p,
        trackType: "video",
        matchName: p.matchName,
        durationTicks: p.durationTicks,
      });
      return { text: `Set transition duration to ${p.durationTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "transition_apply_to_all_cuts",
    title: "Apply transition to all cuts on a track",
    description:
      "Apply the same transition at the tail of every clip except the last on a video track (one cut per adjacent pair).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      matchName: z.string(),
      durationTicks: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number }>;
      const results = [];
      for (let i = 0; i < clips.length - 1; i++) {
        try {
          await ctx.relay.call("transition.apply", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: p.trackIndex,
            clipIndex: clips[i]!.clipIndex,
            matchName: p.matchName,
            edge: "tail",
            durationTicks: p.durationTicks,
          });
          results.push({ clipIndex: clips[i]!.clipIndex, ok: true });
        } catch (err) {
          results.push({
            clipIndex: clips[i]!.clipIndex,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Applied transition to ${ok}/${results.length} cut(s).`, data: { results } };
    },
  }),
];
