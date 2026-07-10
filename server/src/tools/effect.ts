import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.enum(["video", "audio"]),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const paramValue = z.union([z.number(), z.string(), z.boolean(), z.object({ x: z.number(), y: z.number() })]);

export const effectTools = [
  defineTool({
    name: "effect_list_available",
    title: "List available effects",
    description:
      "List effects from Premiere's Effects panel (VideoFilterFactory/AudioFilterFactory — the same catalog as Gaussian Blur, Lumetri, RGB Split, Noise, etc.). Returns matchName + displayName. Use query e.g. \"glitch\", \"blur\", \"noise\". Then apply with effect_add or a dedicated effect_apply_* shortcut.",
    inputSchema: { query: z.string().optional().describe("Case-insensitive substring filter on display name.") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.listAvailable", p);
      return { text: `Available effects: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "effect_add",
    title: "Add effect to clip",
    description: "Apply an effect to a clip by matchName (from effect_list_available), e.g. \"AE.ADBE Gaussian Blur 2\" or \"AE.ADBE Color Balance (HLS)\".",
    inputSchema: { ...clipRef, matchName: z.string() },
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
    description: "List effects currently applied to a clip, with each effect's index and its parameters (name, current value).",
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
      "Set a parameter value on an applied effect, either as a static value or as a keyframe at a specific time. Provide atTicks to add/update a keyframe instead of the static value. Point values: {x,y}; colors: {r,g,b,a}.",
    inputSchema: {
      ...clipRef,
      effectIndex: z.number().int(),
      paramName: z.string(),
      value: paramValue,
      atTicks: z.string().optional().describe("If given, sets a keyframe at this time instead of a static value."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("effect.setParam", p);
      return { text: `Set ${p.paramName} = ${JSON.stringify(p.value)}${p.atTicks ? ` at ${p.atTicks} ticks` : ""}.`, data };
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
