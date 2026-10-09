import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.enum(["video", "audio"]),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const paramValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.object({ x: z.number(), y: z.number() }),
  z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }),
]);

// Blend modes the Opacity component accepts; must match BLEND_MODES in
// plugin/src/handlers/effect.js (checked by scripts/check-catalog.mjs).
export const BLEND_MODE_NAMES = [
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "color_burn",
  "linear_burn",
  "darker_color",
  "lighten",
  "screen",
  "color_dodge",
  "linear_dodge",
  "lighter_color",
  "overlay",
  "soft_light",
  "hard_light",
  "vivid_light",
  "linear_light",
  "pin_light",
  "hard_mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const effectTools = [
  defineTool({
    name: "effect_list_available",
    title: "List available effects",
    description:
      "List the FULL Premiere Effects panel (VideoFilterFactory/AudioFilterFactory — ~105 video + ~54 audio effects: Gaussian Blur, Lumetri, RGB Split, Noise, Directional Blur, Lens Distortion, and everything else). Any of these can be applied with effect_add by displayName — you are NOT limited to the dedicated effect_apply_* shortcuts. Returns matchName + displayName + kind. Pass kind:\"video\" to get just the video effects applicable to a clip; use query e.g. \"blur\", \"glitch\", \"distort\" to narrow the list.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive substring filter on display name."),
      kind: z.enum(["video", "audio"]).optional().describe("Restrict to video-only or audio-only effects. Omit for both."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.listAvailable", p);
      const count = Array.isArray(data) ? data.length : 0;
      return { text: `${count} available effect(s): ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "effect_add",
    title: "Add effect to clip",
    description:
      "Apply ANY effect from the Effects panel to a clip. `matchName` accepts either the friendly displayName from effect_list_available (e.g. \"Gaussian Blur\", \"Lens Distortion\", \"Directional Blur\") OR the raw matchName (e.g. \"AE.ADBE Gaussian Blur 2\") — the plugin resolves display names automatically, so you don't need to know the cryptic id. This is the general path for the whole video Effects panel; the effect_apply_* tools are just convenience shortcuts for the common ones.",
    inputSchema: { ...clipRef, matchName: z.string().describe("Effect displayName or matchName from effect_list_available.") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.add", p);
      return { text: `Added effect ${p.matchName}.`, data };
    },
  }),

  defineTool({
    name: "effect_remove",
    title: "Remove effect from clip",
    description: "Remove an applied effect from a clip by its index (from effect_list_applied).",
    inputSchema: { ...clipRef, effectIndex: z.number().int() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.remove", p);
      return { text: `Removed effect at index ${p.effectIndex}.`, data };
    },
  }),

  defineTool({
    name: "effect_list_applied",
    title: "List effects applied to a clip",
    description:
      "List effects currently applied to a clip, with each effect's index and its parameters: paramIndex, displayName, current value, valueType (number/boolean/string/point/color) and keyframed flag (best-effort; unreadable params show value undefined). Params whose name repeats inside an effect (e.g. Lumetri Basic vs Creative \"Saturation\") are flagged duplicateName — address those by paramIndex in effect_set_param. Read values first to make relative changes instead of overwriting existing corrections.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.listApplied", p);
      return { text: `Applied effects: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "effect_set_param",
    title: "Set an effect parameter",
    description:
      "Set a parameter value on an applied effect, either as a static value or as a keyframe at a specific time. Identify the param by paramIndex (preferred — from effect_list_applied, unambiguous) or paramName. With paramName, every param of that exact name is tried in order and the first that accepts the value wins (Lumetri repeats names across tabs). The value is coerced to the param's current type (\"20\" → 20 for sliders, \"true\" → true for checkboxes). Provide atTicks to add/update a keyframe instead of the static value. Point values: {x,y}; colors: {r,g,b,a}.",
    inputSchema: {
      ...clipRef,
      effectIndex: z.number().int(),
      paramIndex: z
        .number()
        .int()
        .optional()
        .describe("Index of the param inside the effect (from effect_list_applied). Takes precedence over paramName."),
      paramName: z.string().optional().describe("Param display name. Required unless paramIndex is given."),
      value: paramValue,
      atTicks: z.string().optional().describe("If given, sets a keyframe at this time instead of a static value."),
    },
    handler: async (p, ctx) => {
      if (p.paramIndex === undefined && p.paramName === undefined) {
        throw new Error("[INVALID_PARAMS] effect_set_param needs paramIndex or paramName — call effect_list_applied to find them.");
      }
      const data = (await ctx.relay.call("effect.setParam", p)) as { paramName?: string; paramIndex?: number } | undefined;
      const label = data?.paramName ?? p.paramName ?? `#${p.paramIndex}`;
      const idx = data?.paramIndex ?? p.paramIndex;
      return {
        text: `Set ${label}${idx !== undefined ? ` (paramIndex ${idx})` : ""} = ${JSON.stringify(p.value)}${p.atTicks ? ` at ${p.atTicks} ticks` : ""}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "effect_adjust_param",
    title: "Adjust an effect parameter by a delta",
    description:
      "Add a delta to a numeric effect parameter's CURRENT value instead of overwriting it (e.g. +10 Scale, −0.2 Exposure). Identify the param by paramIndex (from effect_list_applied) or paramName (first numeric param of that name). Optional min/max clamp the result. Keyframed params are refused: a static change would drop their keyframes. For Lumetri across many clips use color_adjust.",
    inputSchema: {
      ...clipRef,
      effectIndex: z.number().int(),
      paramIndex: z.number().int().optional(),
      paramName: z.string().optional(),
      delta: z.number(),
      min: z.number().optional().describe("Lower bound for the result."),
      max: z.number().optional().describe("Upper bound for the result."),
    },
    handler: async (p, ctx) => {
      if (p.paramIndex === undefined && p.paramName === undefined) {
        throw new Error("[INVALID_PARAMS] effect_adjust_param needs paramIndex or paramName — call effect_list_applied to find them.");
      }
      const data = (await ctx.relay.call("effect.adjustParam", p)) as {
        paramName: string;
        paramIndex: number;
        from: number;
        to: number;
        clamped: boolean;
      };
      return {
        text: `${data.paramName} (paramIndex ${data.paramIndex}): ${data.from} → ${data.to}${data.clamped ? " (clamped)" : ""}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "effect_get_param",
    title: "Get an effect parameter value",
    description: "Read one parameter value from an applied effect (best-effort getValue/getStartValue).",
    inputSchema: { ...clipRef, effectIndex: z.number().int(), paramName: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.getParam", p);
      return { text: `Param: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "clip_set_blend_mode",
    title: "Set a clip's blend mode (and opacity)",
    description:
      "Set the Opacity blend mode of a video clip, e.g. screen or linear_dodge for a light-leak overlay on an upper track, multiply for shadows, overlay/soft_light for texture. Optionally set opacity (0–100) in the same call. Returns the previous mode. Static only: this replaces keyframed opacity; use effect_set_opacity with atTicks to animate it.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.literal("video").default("video"),
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      mode: z.enum(BLEND_MODE_NAMES),
      opacity: z.number().min(0).max(100).optional(),
    },
    handler: async (p, ctx) => {
      const data = (await ctx.relay.call("effect.setBlendMode", p)) as {
        mode: string;
        previous: string | number;
        opacity?: number;
      };
      return {
        text: `Blend mode ${data.previous} → ${data.mode}${data.opacity !== undefined ? `, opacity ${data.opacity}` : ""}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "effect_set_opacity",
    title: "Set clip opacity",
    description:
      "Set Opacity (0–100) on video/title/shape. Pass atTicks to write a keyframe (blink REC dots, pulse, fades). Omit atTicks for constant opacity.",
    inputSchema: {
      ...clipRef,
      opacity: z.number().describe("Opacity 0–100."),
      atTicks: z
        .string()
        .optional()
        .describe("Keyframe time in ticks. Required for blink/animate over time."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.setOpacity", p);
      return {
        text: p.atTicks
          ? `Opacity keyframe ${p.opacity} @ ${p.atTicks} ticks.`
          : `Opacity set to ${p.opacity}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "effect_set_transform",
    title: "Set Motion transform",
    description:
      "Set Position, Scale, Rotation, and/or Anchor Point on Motion. Pass atTicks to keyframe (ad-style scale pulse, floating shapes). x/y are normalized 0–1. scale is percent (100=normal).",
    inputSchema: {
      ...clipRef,
      x: z.number().optional(),
      y: z.number().optional(),
      scale: z.number().optional().describe("Motion Scale % (100 = default size)."),
      rotation: z.number().optional(),
      anchorX: z.number().optional(),
      anchorY: z.number().optional(),
      atTicks: z
        .string()
        .optional()
        .describe("If set, writes a Motion keyframe at this time (animate scale/position over clip)."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.setTransform", p);
      return {
        text: p.atTicks
          ? `Transform keyframe @ ${p.atTicks}: ${JSON.stringify(data)}`
          : `Transform set: ${JSON.stringify(data)}`,
        data,
      };
    },
  }),

  defineTool({
    name: "effect_reset",
    title: "Reset effects on clip",
    description:
      "Remove all non-intrinsic effects (keeps Opacity, Motion, Vector Motion, Graphic Parameters).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.reset", p);
      return { text: `Reset effects: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "effect_apply_warp_stabilizer",
    title: "Apply Warp Stabilizer",
    description: 'Apply Warp Stabilizer (display name lookup via effect_add).',
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.add", { ...p, matchName: "Warp Stabilizer" });
      return { text: "Applied Warp Stabilizer.", data };
    },
  }),

  defineTool({
    name: "effect_apply_crop",
    title: "Apply Crop",
    description: 'Apply the Crop effect (display name lookup via effect_add).',
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.add", { ...p, matchName: "Crop" });
      return { text: "Applied Crop.", data };
    },
  }),
];
