import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.literal("video").default("video"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

export const colorTools = [
  defineTool({
    name: "color_apply_lumetri",
    title: "Apply Lumetri Color",
    description: "Apply the Lumetri Color effect to a clip so its color parameters can then be set with color_set_param. No-op if already applied.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("color.applyLumetri", p);
      return { text: "Lumetri Color applied.", data };
    },
  }),

  defineTool({
    name: "color_set_param",
    title: "Set a Lumetri Color parameter",
    description:
      'Set a Lumetri Color basic-correction parameter, e.g. "Temperature", "Tint", "Exposure", "Contrast", "Highlights", "Shadows", "Whites", "Blacks", "Saturation". Call color_apply_lumetri first if not already applied.',
    inputSchema: { ...clipRef, paramName: z.string(), value: z.number() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("color.setParam", p);
      return { text: `Set Lumetri ${p.paramName} = ${p.value}.`, data };
    },
  }),

  defineTool({
    name: "color_apply_lut",
    title: "Apply a LUT / .look file",
    description: "Apply a .cube LUT or .look file as the Lumetri Color creative input on a clip.",
    inputSchema: { ...clipRef, lutPath: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("color.applyLut", p);
      return { text: `Applied LUT ${p.lutPath}.`, data };
    },
  }),

  defineTool({
    name: "color_get_params",
    title: "Get current Lumetri Color parameters",
    description: "Read the current Lumetri Color parameter values on a clip.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("color.getParams", p);
      return { text: `Lumetri params: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "color_set_basic_correction",
    title: "Set Lumetri basic correction bundle",
    description:
      "Apply Lumetri if needed, then set any of Exposure/Contrast/Highlights/Shadows/Whites/Blacks/Saturation/Temperature/Tint in one call.",
    inputSchema: {
      ...clipRef,
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      highlights: z.number().optional(),
      shadows: z.number().optional(),
      whites: z.number().optional(),
      blacks: z.number().optional(),
      saturation: z.number().optional(),
      temperature: z.number().optional(),
      tint: z.number().optional(),
    },
    handler: async (p, ctx) => {
      await ctx.relay.call("color.applyLumetri", p);
      const map: Array<[string, number | undefined]> = [
        ["Exposure", p.exposure],
        ["Contrast", p.contrast],
        ["Highlights", p.highlights],
        ["Shadows", p.shadows],
        ["Whites", p.whites],
        ["Blacks", p.blacks],
        ["Saturation", p.saturation],
        ["Temperature", p.temperature],
        ["Tint", p.tint],
      ];
      const set: Record<string, number> = {};
      for (const [name, value] of map) {
        if (value === undefined) continue;
        await ctx.relay.call("color.setParam", { ...p, paramName: name, value });
        set[name] = value;
      }
      return { text: `Basic correction set: ${JSON.stringify(set)}`, data: { set } };
    },
  }),

  defineTool({
    name: "color_set_white_balance",
    title: "Set Lumetri white balance",
    description: "Set Temperature and/or Tint on Lumetri Color.",
    inputSchema: {
      ...clipRef,
      temperature: z.number().optional(),
      tint: z.number().optional(),
    },
    handler: async (p, ctx) => {
      await ctx.relay.call("color.applyLumetri", p);
      if (p.temperature !== undefined) {
        await ctx.relay.call("color.setParam", { ...p, paramName: "Temperature", value: p.temperature });
      }
      if (p.tint !== undefined) {
        await ctx.relay.call("color.setParam", { ...p, paramName: "Tint", value: p.tint });
      }
      return { text: "White balance updated.", data: { temperature: p.temperature, tint: p.tint } };
    },
  }),

  defineTool({
    name: "color_reset_grade",
    title: "Reset Lumetri grade",
    description: "Remove all non-intrinsic effects then re-apply a clean Lumetri Color (approximation of grade reset).",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      await ctx.relay.call("effect.reset", p).catch(() => undefined);
      const data = await ctx.relay.call("color.applyLumetri", p);
      return { text: "Grade reset (effects cleared + Lumetri reapplied).", data };
    },
  }),

  defineTool({
    name: "color_copy_grade",
    title: "Copy Lumetri params snapshot",
    description:
      "Read current Lumetri params from a clip and return them as a JSON snapshot you can pass to color_paste_grade.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("color.getParams", p);
      return { text: `Grade snapshot: ${JSON.stringify(data)}`, data: { snapshot: data } };
    },
  }),

  defineTool({
    name: "color_paste_grade",
    title: "Paste Lumetri params snapshot",
    description:
      "Apply Lumetri and set parameters from a snapshot object { paramName: number, ... } produced by color_copy_grade / color_get_params.",
    inputSchema: {
      ...clipRef,
      snapshot: z.record(z.number()).describe("Map of Lumetri param display names to numeric values."),
    },
    handler: async (p, ctx) => {
      await ctx.relay.call("color.applyLumetri", p);
      for (const [paramName, value] of Object.entries(p.snapshot)) {
        await ctx.relay.call("color.setParam", { ...p, paramName, value });
      }
      return { text: `Pasted ${Object.keys(p.snapshot).length} Lumetri param(s).`, data: { count: Object.keys(p.snapshot).length } };
    },
  }),
];
