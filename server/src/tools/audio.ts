import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.literal("audio").default("audio"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

export const audioTools = [
  defineTool({
    name: "audio_set_gain",
    title: "Set clip gain",
    description:
      "Set Volume Level (dB) on ONE audio clip only. DEFAULT 0 = unity if decibels omitted. Max +6. Only touch clips you placed (trackIndex+clipIndex).",
    inputSchema: {
      ...clipRef,
      decibels: z
        .number()
        .optional()
        .default(0)
        .describe("dB: omit or 0 = unity (DEFAULT). Negative quieter. Boost allowed up to +15 (clip rubber-band max)."),
    },
    handler: async (p, ctx) => {
      const db = typeof p.decibels === "number" && Number.isFinite(p.decibels) ? p.decibels : 0;
      const data = await ctx.relay.call("audio.setGain", { ...p, decibels: db });
      const d = data as {
        decibels?: number;
        linear?: number;
        readLinear?: number;
        readDb?: number;
        unityOk?: boolean;
      };
      const lin =
        typeof d.linear === "number"
          ? d.linear.toFixed(4)
          : typeof d.readLinear === "number"
            ? String(d.readLinear)
            : "?";
      return {
        text: `Set ${d.decibels ?? db} dB (linear ${lin}, read≈${typeof d.readDb === "number" ? d.readDb.toFixed(1) : "?"} dB)${d.unityOk === false ? " ⚠" : ""}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "audio_get_gain",
    title: "Read clip Volume Level",
    description: "Read Volume/Level (dB) on one audio clip. 0 ≈ unity.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = (await ctx.relay.call("audio.getGain", p)) as {
        linear?: number;
        decibels?: number;
      };
      return {
        text: `Gain: linear=${data.linear} ≈ ${data.decibels?.toFixed?.(1) ?? "?"} dB (1.0 linear = 0 dB unity).`,
        data,
      };
    },
  }),

  defineTool({
    name: "audio_add_volume_keyframe",
    title: "Add a volume keyframe",
    description: "Add or update a volume keyframe on an audio clip at a specific time, for fades and mixing moves over time.",
    inputSchema: { ...clipRef, atTicks: z.string(), decibels: z.number() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.addVolumeKeyframe", p);
      return { text: `Volume keyframe: ${p.decibels} dB at ${p.atTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "audio_set_mute",
    title: "Mute/unmute clip",
    description: "Mute or unmute an individual audio clip (as opposed to an entire track — see track_set_mute).",
    inputSchema: { ...clipRef, muted: z.boolean() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.setMute", p);
      return { text: `Clip ${p.muted ? "muted" : "unmuted"}.`, data };
    },
  }),

  defineTool({
    name: "audio_add_effect",
    title: "Add an audio effect",
    description: 'Apply an audio effect to a clip by matchName, e.g. "AHFN Noise Reduction", "AE.ADBE Parametric EQ", "AE.ADBE Dynamics".',
    inputSchema: { ...clipRef, matchName: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.addEffect", p);
      return { text: `Added audio effect ${p.matchName}.`, data };
    },
  }),

  defineTool({
    name: "audio_fix_levels",
    title: "Fix levels on specific clips only",
    description:
      "Set Volume Level on SCOPED clips only (does not touch rest of mix). Default mode=unity (0 dB). mode=boost = +6 max. REQUIRED: trackIndex+clipIndex, or clips:[{trackIndex,clipIndex}], or allClips:true (discouraged). Protects user fader corrections.",
    inputSchema: {
      sequenceId: z.string().optional(),
      mode: z.enum(["boost", "unity"]).optional().default("unity"),
      targetDb: z
        .number()
        .optional()
        .describe("Override dB. unity default 0, boost default +6. Max +6."),
      trackIndex: z.number().int().optional().describe("Audio track of the clip you placed."),
      clipIndex: z.number().int().optional().describe("Clip index you placed — required with trackIndex."),
      clips: z
        .array(z.object({ trackIndex: z.number().int(), clipIndex: z.number().int() }))
        .optional()
        .describe("Multiple owned clips only."),
      allClips: z
        .boolean()
        .optional()
        .default(false)
        .describe("Dangerous: rewrite every audio fader. Default false."),
    },
    handler: async (p, ctx) => {
      const { runOp } = await import("../agent/ops.js");
      const r = await runOp(ctx, {
        op: "audio_fix",
        sequenceId: p.sequenceId,
        mode: p.mode,
        targetDb: p.targetDb,
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
        clips: p.clips,
        allClips: p.allClips,
      });
      const db = (r.data as { targetDb?: number })?.targetDb ?? p.targetDb ?? 0;
      return {
        text: r.ok
          ? `Audio fixed (scoped): ${(r.data as { fixed?: number })?.fixed ?? "?"} clip(s) → ${db} dB (${p.mode}).`
          : `Audio fix refused/failed: ${r.error}`,
        data: r,
      };
    },
  }),

  defineTool({
    name: "audio_normalize",
    title: "Normalize clip loudness",
    description:
      "Approximate normalize by setting Volume/Level to targetDb (default 0 = unity dB). Not true LUFS. Prefer audio_fix_levels for silent cuts.",
    inputSchema: { ...clipRef, targetDb: z.number().optional().default(0) },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.normalize", p);
      return { text: `Normalized (gain approx) to ${p.targetDb} dB.`, data };
    },
  }),

  defineTool({
    name: "audio_apply_noise_reduction",
    title: "Apply DeNoise",
    description: 'Apply the "DeNoise" audio filter (live-enumerated). Shortcut for audio_add_effect.',
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.addEffect", { ...p, matchName: "DeNoise" });
      return { text: "Applied DeNoise.", data };
    },
  }),

  defineTool({
    name: "audio_apply_dialogue_enhance",
    title: "Apply dialogue enhance filters",
    description: 'Apply "Vocal Enhancer" then "DeReverb" (both live-enumerated).',
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      await ctx.relay.call("audio.addEffect", { ...p, matchName: "Vocal Enhancer" });
      const data = await ctx.relay.call("audio.addEffect", { ...p, matchName: "DeReverb" });
      return { text: "Applied Vocal Enhancer + DeReverb.", data };
    },
  }),

  defineTool({
    name: "audio_mute_track",
    title: "Mute audio track",
    description: "Alias of track_set_mute for audio tracks.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      muted: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("track.setMute", {
        sequenceId: p.sequenceId,
        trackType: "audio",
        trackIndex: p.trackIndex,
        muted: p.muted,
      });
      return { text: `Audio track ${p.trackIndex} ${p.muted ? "muted" : "unmuted"}.`, data };
    },
  }),
];
