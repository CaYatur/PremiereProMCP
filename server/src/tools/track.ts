import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const trackType = z.enum(["video", "audio"]);

export const trackTools = [
  defineTool({
    name: "track_list",
    title: "List tracks",
    description: "List every video and audio track in a sequence with index, name, mute/lock state, and clip count.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.list", p);
      return { text: `Tracks: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "track_add",
    title: "Add track",
    description:
      "Add a new video or audio track to a sequence. KNOWN LIMITATION (confirmed Adobe UXP platform gap, not a plugin bug): the Premiere UXP API exposes no add-track method, so this always fails on current builds. The track count is fixed at sequence creation and CANNOT be increased later — inserting a clip past the existing track count does NOT auto-create a track either (it fails with \"invalid track index\"). Plan the track count when you create the sequence (sequence_create, or a preset that already has enough tracks).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType,
      position: z.number().int().optional().describe("Index to insert at; omit to append at the top/end."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.add", p);
      return { text: `Added ${p.trackType} track.`, data };
    },
  }),

  defineTool({
    name: "track_delete",
    title: "Delete track",
    description: "Remove a video or audio track (and every clip on it) from a sequence.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.delete", p);
      return { text: `Deleted ${p.trackType} track ${p.trackIndex}.`, data };
    },
  }),

  defineTool({
    name: "track_set_mute",
    title: "Mute/unmute track",
    description: "Mute or unmute a track (video: hide; audio: silence) without deleting its clips.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int(), muted: z.boolean() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.setMute", p);
      return { text: `${p.trackType} track ${p.trackIndex} ${p.muted ? "muted" : "unmuted"}.`, data };
    },
  }),

  defineTool({
    name: "track_set_lock",
    title: "Lock/unlock track",
    description: "Lock or unlock a track to prevent/allow edits.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int(), locked: z.boolean() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.setLock", p);
      return { text: `${p.trackType} track ${p.trackIndex} ${p.locked ? "locked" : "unlocked"}.`, data };
    },
  }),

  defineTool({
    name: "track_set_output_enabled",
    title: "Enable/disable track output",
    description: "Toggle whether a video track's output is rendered (the 'eye' icon) or an audio track outputs sound.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int(), enabled: z.boolean() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.setOutputEnabled", p);
      return { text: `${p.trackType} track ${p.trackIndex} output ${p.enabled ? "enabled" : "disabled"}.`, data };
    },
  }),

  defineTool({
    name: "track_rename",
    title: "Rename track",
    description: "Rename a video or audio track (Track.createSetNameAction, Premiere 26.3+).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType,
      trackIndex: z.number().int(),
      name: z.string(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.rename", p);
      return { text: `Renamed ${p.trackType} track ${p.trackIndex} to "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "track_get_items",
    title: "Get track items (clips)",
    description: "List clips on one track — alias of clip_list.",
    inputSchema: { sequenceId: z.string().optional(), trackType, trackIndex: z.number().int() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.getItems", p);
      return { text: `Track items: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "track_add_video",
    title: "Add video track",
    description:
      "Add a video track (convenience alias of track_add). KNOWN LIMITATION: unsupported by the Premiere UXP API and unfixable plugin-side — the track count is fixed at sequence creation and cannot be increased later (inserting past the track count also fails). Plan the track count at sequence_create.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.add", { ...p, trackType: "video" });
      return { text: "Added video track.", data };
    },
  }),

  defineTool({
    name: "track_add_audio",
    title: "Add audio track",
    description:
      "Add an audio track (convenience alias of track_add). KNOWN LIMITATION: unsupported by the Premiere UXP API and unfixable plugin-side — the track count is fixed at sequence creation and cannot be increased later (inserting past the track count also fails). Plan the track count at sequence_create.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.add", { ...p, trackType: "audio" });
      return { text: "Added audio track.", data };
    },
  }),
];
