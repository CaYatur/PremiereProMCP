import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

// Category Q (docs/FEATURES.md §3.Q): one dedicated, name-guessing-free tool
// per commonly-needed effect/transition. Every matchName here was actually
// live-enumerated by the Phase 0 probe (real VideoFilterFactory/
// AudioFilterFactory/TransitionFactory output) — these are pure convenience
// wrappers over the already-implemented effect_add/audio_add_effect/
// transition_apply mechanisms, not new plugin-side code. A model calling
// effect_apply_gaussian_blur doesn't need to know or guess an internal
// matchName the way effect_add(matchName: "...") would require.

const videoClipRef = {
  sequenceId: z.string().optional(),
  trackType: z.literal("video").default("video"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const audioClipRef = {
  sequenceId: z.string().optional(),
  trackType: z.literal("audio").default("audio"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const VIDEO_EFFECTS: Array<[toolSuffix: string, displayName: string, matchName: string]> = [
  ["gaussian_blur", "Gaussian Blur", "Gaussian Blur"],
  ["sharpen", "Sharpen", "Sharpen"],
  ["unsharp_mask", "Unsharp Mask", "Unsharp Mask"],
  ["black_and_white", "Black & White", "Black & White"],
  ["brightness_contrast", "Brightness & Contrast", "Brightness & Contrast"],
  ["vignette", "Vignette", "Vignette"],
  ["mosaic", "Mosaic", "Mosaic"],
  ["mirror", "Mirror", "Mirror"],
  ["tint", "Tint", "Tint"],
  ["posterize", "Posterize", "Posterize"],
  ["invert", "Invert", "Invert"],
  ["drop_shadow", "Drop Shadow", "Drop Shadow"],
  ["glow", "Wonder Glow", "Wonder Glow"],
  ["light_leaks", "Light Leaks", "Light Leaks"],
  ["rgb_split", "RGB Split", "RGB Split"],
  ["directional_blur", "Directional Blur", "Directional Blur"],
  ["bokeh_blur", "Bokeh Blur", "Bokeh Blur"],
  ["camera_shake", "Camera Shake", "Camera Shake"],
  ["corner_pin", "Corner Pin", "Corner Pin"],
  ["gradient", "Gradient", "Gradient"],
  // Stylized / glitch-adjacent — display names live-enumerated on Premiere 2026
  ["noise", "Noise", "Noise"],
  ["noise_legacy", "Noise (Legacy)", "Noise (Legacy)"],
  ["vr_digital_glitch", "VR Digital Glitch", "VR Digital Glitch"],
  ["vr_fractal_noise", "VR Fractal Noise", "VR Fractal Noise"],
  ["wave_warp", "Wave Warp", "Wave Warp"],
  ["turbulent_displace", "Turbulent Displace", "Turbulent Displace"],
  ["find_edges", "Find Edges", "Find Edges"],
  ["emboss", "Emboss", "Emboss"],
  ["strobe", "Strobe Light", "Strobe Light"],
  ["echo", "Echo", "Echo"],
  ["time_posterize", "Posterize Time", "Posterize Time"],
];

const AUDIO_EFFECTS: Array<[toolSuffix: string, displayName: string, matchName: string]> = [
  ["dehummer", "DeHummer", "DeHummer"],
  ["deesser", "DeEsser", "DeEsser"],
  ["parametric_eq", "Parametric Equalizer", "Parametric Equalizer"],
  ["graphic_eq", "Graphic Equalizer (10 Bands)", "Graphic Equalizer (10 Bands)"],
  ["compressor", "Single-band Compressor", "Single-band Compressor"],
  ["limiter", "Hard Limiter", "Hard Limiter"],
  ["reverb", "Studio Reverb", "Studio Reverb"],
  ["surround_reverb", "Surround Reverb", "Surround Reverb"],
  ["pitch_shifter", "Pitch Shifter", "Pitch Shifter"],
  ["distortion", "Distortion", "Distortion"],
  ["click_remover", "Automatic Click Remover", "Automatic Click Remover"],
];

const TRANSITIONS: Array<[toolSuffix: string, displayName: string, matchName: string]> = [
  ["cross_dissolve", "Cross Dissolve", "AE.ADBE Cross Dissolve New"],
  ["dip_to_black", "Dip to Black", "AE.ADBE Dip To Black"],
  ["dip_to_white", "Dip to White", "AE.ADBE Dip To White"],
  ["morph_cut", "Morph Cut", "AE.ADBE MorphCut"],
  ["film_dissolve", "Film Dissolve", "ADBE Film Dissolve"],
  ["additive_dissolve", "Additive Dissolve", "ADBE Additive Dissolve"],
  ["iris_round", "Iris Round", "ADBE Iris Round"],
  ["wipe", "Wipe", "ADBE Wipe"],
  ["push", "Push", "ADBE Push"],
  ["slide", "Slide", "ADBE Slide"],
];

const videoEffectTools = VIDEO_EFFECTS.map(([suffix, display, matchName]) =>
  defineTool({
    name: `effect_apply_${suffix}`,
    title: `Apply ${display}`,
    description: `Apply the "${display}" video effect to a clip. Shortcut for effect_add(matchName: "${matchName}").`,
    inputSchema: videoClipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.add", { ...p, matchName });
      return { text: `Applied ${display}.`, data };
    },
  }),
);

const audioEffectTools = AUDIO_EFFECTS.map(([suffix, display, matchName]) =>
  defineTool({
    name: `audio_apply_${suffix}`,
    title: `Apply ${display}`,
    description: `Apply the "${display}" audio effect to a clip. Shortcut for audio_add_effect(matchName: "${matchName}").`,
    inputSchema: audioClipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("audio.addEffect", { ...p, matchName });
      return { text: `Applied ${display}.`, data };
    },
  }),
);

const transitionTools = TRANSITIONS.map(([suffix, display, matchName]) =>
  defineTool({
    name: `transition_add_${suffix}`,
    title: `Add ${display} transition`,
    description: `Apply a "${display}" transition at a clip edge. Shortcut for transition_apply(matchName: "${matchName}").`,
    inputSchema: {
      ...videoClipRef,
      edge: z.enum(["head", "tail"]),
      durationTicks: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("transition.apply", { ...p, matchName });
      return { text: `Added ${display} transition at ${p.edge} of clip.`, data };
    },
  }),
);

export const dedicatedShortcutTools = [...videoEffectTools, ...audioEffectTools, ...transitionTools];
