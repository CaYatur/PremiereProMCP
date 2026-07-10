import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const trackType = z.enum(["video", "audio"]);

// Clips are addressed by (trackType, trackIndex, clipIndex) — clipIndex is
// the clip's 0-based position along that track, as returned by clip_list.
// This avoids needing a persistent cross-session id table in the plugin,
// at the cost of indices shifting after ripple-style edits — tools that
// shift indices say so, and a model should re-run clip_list if unsure.
const clipRef = {
  sequenceId: z.string().optional(),
  trackType,
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const ticks = z.string().describe("Time in ticks as a string (Premiere's internal time unit; 254016000000 ticks = 1 second).");

export const clipTools = [
  defineTool({
    name: "clip_list",
    title: "List clips on a track",
    description: "List every clip on a track in order, with clipIndex, name, start/end ticks, and media type. Call this before addressing a clip by index.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.list", p);
      return { text: `Clips: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "clip_get_properties",
    title: "Get clip properties",
    description: "Get full properties of one clip: name, start/end/duration ticks, speed, enabled effects, and source media path.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.getProperties", p);
      return { text: `Clip properties: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "clip_insert",
    title: "Insert clip (ripple)",
    description:
      "Insert a project item onto a track at a given time. On Premiere builds where SequenceEditor insert fails, falls back to sequence_create_from_media (new sequence containing the clip) so media still lands on a timeline.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType,
      trackIndex: z.number().int(),
      projectItemId: z.string().describe("From project_import_media or project_list_items."),
      atTicks: ticks,
      fallbackCreateSequence: z
        .boolean()
        .optional()
        .default(true)
        .describe("If insert fails, create a new sequence from this media (default true)."),
    },
    handler: async (p, ctx) => {
      try {
        const data = await ctx.relay.call("clip.insert", {
          sequenceId: p.sequenceId,
          trackType: p.trackType,
          trackIndex: p.trackIndex,
          projectItemId: p.projectItemId,
          atTicks: p.atTicks,
        });
        return { text: `Inserted clip on ${p.trackType} track ${p.trackIndex} at ${p.atTicks} ticks.`, data };
      } catch (err) {
        if (p.fallbackCreateSequence === false) throw err;
        const name = `Insert ${Date.now()}`;
        const data = await ctx.relay.call("sequence.createFromMedia", {
          name,
          projectItemIds: [p.projectItemId],
        });
        return {
          text: `SequenceEditor insert failed on this Premiere build; created sequence "${name}" from the media instead (via createSequenceFromMedia). Open it with sequence_set_active. Original error: ${err instanceof Error ? err.message : err}`,
          data: { workaround: "createSequenceFromMedia", sequence: data, insertError: String(err) },
        };
      }
    },
  }),

  defineTool({
    name: "clip_overwrite",
    title: "Overwrite clip",
    description:
      "Place a project item onto a track at a given time. Falls back to createSequenceFromMedia if SequenceEditor overwrite fails on this build.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType,
      trackIndex: z.number().int(),
      projectItemId: z.string(),
      atTicks: ticks,
      fallbackCreateSequence: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      try {
        const data = await ctx.relay.call("clip.overwrite", {
          sequenceId: p.sequenceId,
          trackType: p.trackType,
          trackIndex: p.trackIndex,
          projectItemId: p.projectItemId,
          atTicks: p.atTicks,
        });
        return { text: `Overwrote onto ${p.trackType} track ${p.trackIndex} at ${p.atTicks} ticks.`, data };
      } catch (err) {
        if (p.fallbackCreateSequence === false) throw err;
        const name = `Overwrite ${Date.now()}`;
        const data = await ctx.relay.call("sequence.createFromMedia", {
          name,
          projectItemIds: [p.projectItemId],
        });
        return {
          text: `SequenceEditor overwrite failed; created sequence "${name}" from the media instead. Original error: ${err instanceof Error ? err.message : err}`,
          data: { workaround: "createSequenceFromMedia", sequence: data, overwriteError: String(err) },
        };
      }
    },
  }),

  defineTool({
    name: "clip_move",
    title: "Move clip",
    description:
      "Move an existing clip to a new start time on the same track, without changing its duration. Moving to a different track is not supported by this tool — use clip_lift then clip_insert on the target track instead.",
    inputSchema: {
      ...clipRef,
      newStartTicks: ticks,
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.move", p);
      return { text: "Clip moved.", data };
    },
  }),

  defineTool({
    name: "clip_split",
    title: "Split clip (cut)",
    description: "Cut a clip in two at the given time, on this track only unless a matching edit-across-tracks behavior is requested separately.",
    inputSchema: { ...clipRef, atTicks: ticks },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.split", p);
      return { text: `Split clip at ${p.atTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_trim",
    title: "Trim clip edge",
    description: "Move a clip's in-point or out-point, changing its duration. Does not ripple other clips — use clip_ripple_delete or clip_roll for that.",
    inputSchema: {
      ...clipRef,
      edge: z.enum(["in", "out"]),
      newTicks: ticks.describe("New absolute timeline position (ticks) for the chosen edge."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.trim", p);
      return { text: `Trimmed ${p.edge} edge to ${p.newTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_roll",
    title: "Roll edit (adjacent trim)",
    description:
      "Move the cut point between two adjacent clips: trims the out-point of the earlier clip and the in-point of the later clip by the same amount, so total sequence duration is unchanged. Composed from two trims applied atomically.",
    inputSchema: { ...clipRef, deltaTicks: z.string().describe("Positive moves the cut point later; negative moves it earlier.") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.roll", p);
      return { text: `Rolled cut point by ${p.deltaTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_slip",
    title: "Slip edit",
    description: "Change which part of the source media a clip shows, without moving the clip or changing its duration on the timeline.",
    inputSchema: { ...clipRef, deltaTicks: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.slip", p);
      return { text: `Slipped clip source by ${p.deltaTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_slide",
    title: "Slide edit",
    description: "Move a clip left/right while adjusting its two neighbors' edges to fill the gap, keeping the moved clip's own in/out unchanged.",
    inputSchema: { ...clipRef, deltaTicks: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.slide", p);
      return { text: `Slid clip by ${p.deltaTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_ripple_delete",
    title: "Ripple delete clip",
    description: "Remove a clip and close the resulting gap by shifting later clips left.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.rippleDelete", p);
      return { text: "Clip ripple-deleted.", data };
    },
  }),

  defineTool({
    name: "clip_lift",
    title: "Lift clip (leave gap)",
    description: "Remove a clip but leave a gap in its place (does not shift other clips).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.lift", p);
      return { text: "Clip lifted, gap left behind.", data };
    },
  }),

  defineTool({
    name: "clip_delete",
    title: "Delete clip",
    description: "Alias for clip_lift — remove a clip, leaving a gap. Use clip_ripple_delete to also close the gap.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.lift", p);
      return { text: "Clip deleted, gap left behind.", data };
    },
  }),

  defineTool({
    name: "clip_set_speed",
    title: "Set clip speed/duration",
    description: "Change a clip's playback speed (as a percentage) and optionally whether it's reversed and whether audio pitch is preserved.",
    inputSchema: {
      ...clipRef,
      speedPercent: z.number().positive(),
      reverse: z.boolean().optional().default(false),
      maintainPitch: z.boolean().optional().default(true),
      rippleEdit: z.boolean().optional().default(false).describe("If true, ripples later clips to absorb the resulting duration change."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.setSpeed", p);
      return { text: `Set clip speed to ${p.speedPercent}%.`, data };
    },
  }),

  defineTool({
    name: "clip_append",
    title: "Append clip to end of track",
    description: "Insert a project item at the end of the last clip on a track (or at 0 if empty).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType,
      trackIndex: z.number().int(),
      projectItemId: z.string(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.append", p);
      return { text: `Appended item to ${p.trackType} track ${p.trackIndex}.`, data };
    },
  }),

  defineTool({
    name: "clip_set_enabled",
    title: "Enable/disable clip",
    description: "Enable or disable (mute/hide) a timeline clip via createSetDisabledAction.",
    inputSchema: { ...clipRef, enabled: z.boolean() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.setEnabled", p);
      return { text: `Clip ${p.enabled ? "enabled" : "disabled"}.`, data };
    },
  }),

  defineTool({
    name: "clip_rename",
    title: "Rename timeline clip",
    description: "Rename a clip instance on the timeline (TrackItem.createSetNameAction).",
    inputSchema: { ...clipRef, name: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.rename", p);
      return { text: `Clip renamed to "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "clip_reverse",
    title: "Reverse clip playback",
    description: "Play the clip backwards at 100% speed (clip_set_speed reverse=true).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("clip.setSpeed", {
        ...p,
        speedPercent: 100,
        reverse: true,
        maintainPitch: true,
        rippleEdit: false,
      });
      return { text: "Clip reversed.", data };
    },
  }),

  defineTool({
    name: "clip_split_at_playhead",
    title: "Split clip at playhead",
    description: "Split the given clip at the current playhead position (compose playhead_get + clip_split).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const pos = (await ctx.relay.call("playhead.get", { sequenceId: p.sequenceId })) as { ticks: string };
      const data = await ctx.relay.call("clip.split", { ...p, atTicks: pos.ticks });
      return { text: `Split clip at playhead (${pos.ticks} ticks).`, data };
    },
  }),

  defineTool({
    name: "clip_select",
    title: "Select a clip",
    description: "Set the timeline selection to this single clip (selection_set).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("selection.set", {
        sequenceId: p.sequenceId,
        clips: [{ trackType: p.trackType, trackIndex: p.trackIndex, clipIndex: p.clipIndex }],
      });
      return { text: "Clip selected.", data };
    },
  }),

  defineTool({
    name: "clip_align_to_playhead",
    title: "Align clip start to playhead",
    description: "Move the clip so its start matches the current playhead (clip_move).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const pos = (await ctx.relay.call("playhead.get", { sequenceId: p.sequenceId })) as { ticks: string };
      const data = await ctx.relay.call("clip.move", { ...p, newStartTicks: pos.ticks });
      return { text: `Clip aligned to playhead at ${pos.ticks} ticks.`, data };
    },
  }),

  defineTool({
    name: "clip_set_transform",
    title: "Set clip Motion transform",
    description: "Set Position/Scale/Rotation/Anchor on the built-in Motion component (effect_set_transform).",
    inputSchema: {
      ...clipRef,
      x: z.number().optional(),
      y: z.number().optional(),
      scale: z.number().optional().describe("Scale percent, typically ~100."),
      rotation: z.number().optional(),
      anchorX: z.number().optional(),
      anchorY: z.number().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.setTransform", p);
      return { text: `Transform updated: ${JSON.stringify(data)}`, data };
    },
  }),
];
