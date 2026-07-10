import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

export const sequenceTools = [
  defineTool({
    name: "sequence_create",
    title: "Create sequence",
    description:
      "Create a new sequence in the active project. Provide either a presetPath (a Premiere .sqpreset file) or explicit width/height/frameRate; explicit settings are simpler for a model to reason about and are recommended unless the user names a specific preset.",
    inputSchema: {
      name: z.string(),
      presetPath: z.string().optional().describe("Absolute path to a .sqpreset file. Overrides width/height/frameRate if given."),
      width: z.number().int().optional().default(1920),
      height: z.number().int().optional().default(1080),
      frameRate: z.number().optional().default(29.97).describe("Frames per second, e.g. 23.976, 24, 25, 29.97, 30, 59.94, 60"),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.create", p);
      return { text: `Created sequence "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "sequence_get_active",
    title: "Get active sequence",
    description: "Get the currently active sequence's id, name, settings, and track counts.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("sequence.getActive", {});
      return { text: `Active sequence: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "sequence_list",
    title: "List sequences",
    description: "List every sequence in the active project with its sequenceId and name.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("sequence.list", {});
      return { text: `Sequences: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "sequence_set_active",
    title: "Set active sequence",
    description: "Make the given sequence the active one (opens its timeline tab in the UI).",
    inputSchema: { sequenceId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.setActive", p);
      return { text: `Active sequence set to ${p.sequenceId}.`, data };
    },
  }),

  defineTool({
    name: "sequence_get_settings",
    title: "Get sequence settings",
    description: "Get frame rate, resolution, pixel aspect ratio, and audio sample rate for a sequence.",
    inputSchema: { sequenceId: z.string().optional().describe("Omit to use the active sequence.") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.getSettings", p);
      return { text: `Sequence settings: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "sequence_set_in_out",
    title: "Set sequence in/out points",
    description: "Set the work-area or in/out points on a sequence's timeline, in ticks (Premiere's internal time unit; 254016000000 ticks = 1 second).",
    inputSchema: {
      sequenceId: z.string().optional(),
      inTicks: z.string().optional().describe("Tick count as a string (ticks exceed safe JS integer range)."),
      outTicks: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.setInOut", p);
      return { text: "Sequence in/out points updated.", data };
    },
  }),

  defineTool({
    name: "sequence_delete",
    title: "Delete sequence",
    description: "Delete a sequence from the project.",
    inputSchema: { sequenceId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.delete", p);
      return { text: `Deleted sequence ${p.sequenceId}.`, data };
    },
  }),

  defineTool({
    name: "sequence_close",
    title: "Close sequence tab",
    description: "Close a sequence's timeline tab without deleting it (project.closeSequence).",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.close", p);
      return { text: "Sequence closed.", data };
    },
  }),

  defineTool({
    name: "sequence_create_from_media",
    title: "Create sequence from media",
    description: "Create a new sequence populated from project items (project.createSequenceFromMedia).",
    inputSchema: {
      name: z.string(),
      projectItemIds: z.array(z.string()).min(1),
      targetBinPath: z.array(z.string()).optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("sequence.createFromMedia", p);
      return { text: `Created sequence "${p.name}" from ${p.projectItemIds.length} item(s).`, data };
    },
  }),

  defineTool({
    name: "sequence_get_duration",
    title: "Get sequence duration",
    description:
      "Compute sequence span from track clips (earliest start → latest end) plus native settings when available.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const tracks = (await ctx.relay.call("track.list", p)) as Array<{ trackType: string; trackIndex: number }>;
      let minStart: bigint | undefined;
      let maxEnd: bigint | undefined;
      for (const t of tracks) {
        const clips = (await ctx.relay.call("clip.list", {
          sequenceId: p.sequenceId,
          trackType: t.trackType,
          trackIndex: t.trackIndex,
        })) as Array<{ startTicks?: string; endTicks?: string }>;
        for (const c of clips) {
          if (c.startTicks) {
            const s = BigInt(c.startTicks);
            if (minStart === undefined || s < minStart) minStart = s;
          }
          if (c.endTicks) {
            const e = BigInt(c.endTicks);
            if (maxEnd === undefined || e > maxEnd) maxEnd = e;
          }
        }
      }
      const meta = await ctx.relay.call("sequence.getTimebase", p).catch(() => null);
      const data = {
        startTicks: minStart !== undefined ? String(minStart) : "0",
        endTicks: maxEnd !== undefined ? String(maxEnd) : "0",
        durationTicks:
          minStart !== undefined && maxEnd !== undefined ? String(maxEnd - minStart) : "0",
        meta,
      };
      return { text: `Sequence duration: ${data.durationTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "sequence_get_tracks",
    title: "Get sequence tracks",
    description: "Alias of track_list for FEATURES.md naming.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.list", p);
      return { text: `Tracks: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "sequence_export_frame",
    title: "Export sequence frame",
    description: "Alias of export_frame — still image at a timeline time.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string(),
      outputPath: z.string(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("export.frame", p);
      return { text: `Exported frame to ${p.outputPath}.`, data };
    },
  }),
];
