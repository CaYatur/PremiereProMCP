import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

export const markerTools = [
  defineTool({
    name: "marker_add",
    title: "Add a sequence marker",
    description: "Add a marker on the sequence timeline (not tied to a specific clip) at a given time, with a name/comment.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string(),
      name: z.string().optional(),
      comment: z.string().optional(),
      durationTicks: z.string().optional(),
      colorIndex: z.number().int().optional().describe("Premiere marker color index, if supported."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("marker.add", p);
      return { text: `Added marker at ${p.atTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "marker_list",
    title: "List sequence markers",
    description: "List every marker on a sequence's timeline, with markerIndex, time, name, and comment.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("marker.list", p);
      return { text: `Markers: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "marker_update",
    title: "Update a marker",
    description: "Change an existing marker's name, comment, time, or duration.",
    inputSchema: {
      sequenceId: z.string().optional(),
      markerIndex: z.number().int(),
      name: z.string().optional(),
      comment: z.string().optional(),
      atTicks: z.string().optional(),
      durationTicks: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("marker.update", p);
      return { text: `Updated marker ${p.markerIndex}.`, data };
    },
  }),

  defineTool({
    name: "marker_remove",
    title: "Remove a marker",
    description: "Delete a marker from the sequence timeline.",
    inputSchema: { sequenceId: z.string().optional(), markerIndex: z.number().int() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("marker.remove", p);
      return { text: `Removed marker ${p.markerIndex}.`, data };
    },
  }),

  defineTool({
    name: "marker_go_to",
    title: "Go to marker",
    description: "Move the playhead to a marker (alias of playhead_go_to_marker).",
    inputSchema: { sequenceId: z.string().optional(), markerIndex: z.number().int() },
    handler: async (p, ctx) => {
      const markers = (await ctx.relay.call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})) as Array<{
        markerIndex: number;
        startTicks: string;
        name?: string;
      }>;
      const m = markers.find((x) => x.markerIndex === p.markerIndex) ?? markers[p.markerIndex];
      if (!m) return { text: `No marker at index ${p.markerIndex}.`, data: { found: false } };
      await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks: m.startTicks });
      return { text: `Playhead at marker ${p.markerIndex} (${m.startTicks} ticks).`, data: m };
    },
  }),

  defineTool({
    name: "marker_set_duration",
    title: "Set marker duration",
    description: "Update a marker's duration via marker_update.",
    inputSchema: {
      sequenceId: z.string().optional(),
      markerIndex: z.number().int(),
      durationTicks: z.string(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("marker.update", p);
      return { text: `Marker ${p.markerIndex} duration set.`, data };
    },
  }),
];
