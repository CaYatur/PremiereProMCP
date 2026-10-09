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
    description:
      "Try to load a .cube/.look file as Lumetri's Input LUT. NOTE: on Premiere 26.x the UXP API exposes Input LUT only as a dropdown index and rejects file paths, so this returns an error explaining that; load the LUT by hand in Lumetri, or grade with color_adjust / color_set_basic_correction. Lumetri curves are not reachable through UXP either (see docs/FEATURES.md).",
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
    name: "color_adjust",
    title: "Adjust Lumetri relative to the current grade",
    description:
      "Nudge Lumetri params by a DELTA added to each clip's current value, so existing per-clip corrections are kept (unlike color_set_basic_correction, which writes absolute values). E.g. exposure: 0.3 brightens every target by +0.3 from wherever it is. Results are clamped to the slider range. Targets: trackIndex+clipIndex, a clips list, or (neither) the current timeline selection. Lumetri is applied first where missing unless applyIfMissing is false. Other params: deltas, keyed by display name or \"#<paramIndex>\" (from color_get_params) for a same-named Creative/Curves param. Keyframed params are skipped (a relative change would drop their keyframes).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().optional(),
      clipIndex: z.number().int().optional(),
      clips: z
        .array(z.object({ trackIndex: z.number().int(), clipIndex: z.number().int() }))
        .optional()
        .describe("Video clips to adjust. Omit (with trackIndex/clipIndex) to use the timeline selection."),
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      highlights: z.number().optional(),
      shadows: z.number().optional(),
      whites: z.number().optional(),
      blacks: z.number().optional(),
      saturation: z.number().optional(),
      vibrance: z.number().optional(),
      temperature: z.number().optional(),
      tint: z.number().optional(),
      deltas: z
        .record(z.number())
        .optional()
        .describe('Extra deltas by Lumetri display name or "#<paramIndex>", e.g. { "Faded Film": 10, "#43": -5 }.'),
      applyIfMissing: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const deltas: Record<string, number> = {};
      const named: Array<[string, number | undefined]> = [
        ["Exposure", p.exposure],
        ["Contrast", p.contrast],
        ["Highlights", p.highlights],
        ["Shadows", p.shadows],
        ["Whites", p.whites],
        ["Blacks", p.blacks],
        ["Saturation", p.saturation],
        ["Vibrance", p.vibrance],
        ["Temperature", p.temperature],
        ["Tint", p.tint],
      ];
      for (const [name, value] of named) if (value !== undefined) deltas[name] = value;
      Object.assign(deltas, p.deltas ?? {});
      if (!Object.keys(deltas).length) {
        throw new Error("[INVALID_PARAMS] color_adjust needs at least one delta (e.g. exposure: 0.3).");
      }

      let targets: Array<{ trackIndex: number; clipIndex: number }>;
      if (p.trackIndex !== undefined && p.clipIndex !== undefined) {
        targets = [{ trackIndex: p.trackIndex, clipIndex: p.clipIndex }];
      } else if (p.clips?.length) {
        targets = p.clips;
      } else {
        const selected = (await ctx.relay.call("selection.get", { sequenceId: p.sequenceId })) as Array<{
          trackType?: string;
          trackIndex?: number;
          clipIndex?: number;
        }>;
        targets = selected
          .filter((c) => c.trackType === "video" && typeof c.trackIndex === "number" && typeof c.clipIndex === "number")
          .map((c) => ({ trackIndex: c.trackIndex as number, clipIndex: c.clipIndex as number }));
        if (!targets.length) {
          throw new Error(
            "[INVALID_PARAMS] No target clips: pass trackIndex+clipIndex or clips, or select video clips on the timeline.",
          );
        }
      }

      type ParamResult = { param: string; ok: boolean; error?: string };
      const results: Array<{
        trackIndex: number;
        clipIndex: number;
        adjusted: number;
        params?: ParamResult[];
        error?: string;
      }> = [];
      for (const t of targets) {
        const ref = { sequenceId: p.sequenceId, trackType: "video" as const, ...t };
        try {
          if (p.applyIfMissing ?? true) await ctx.relay.call("color.applyLumetri", ref);
          const data = (await ctx.relay.call("color.adjust", { ...ref, deltas })) as {
            adjusted: number;
            results: ParamResult[];
          };
          results.push({ ...t, adjusted: data.adjusted, params: data.results });
        } catch (err) {
          results.push({ ...t, adjusted: 0, error: err instanceof Error ? err.message : String(err) });
        }
      }
      // Each param is applied on its own, so one refusal (e.g. a keyframed
      // param) doesn't undo the others: report what changed and what didn't.
      const skipped = results.flatMap((r) =>
        r.error
          ? [`clip ${r.trackIndex}/${r.clipIndex}: ${r.error}`]
          : (r.params ?? []).filter((x) => !x.ok).map((x) => `clip ${r.trackIndex}/${r.clipIndex} ${x.param}: ${x.error}`),
      );
      const changed = results.reduce((n, r) => n + r.adjusted, 0);
      if (!changed) throw new Error(`[INVALID_PARAMS] color_adjust changed nothing. ${skipped.join(" | ")}`);
      const touched = results.filter((r) => r.adjusted > 0).length;
      return {
        text:
          `Adjusted ${changed} param(s) on ${touched}/${results.length} clip(s) by ${JSON.stringify(deltas)}.` +
          (skipped.length ? ` Skipped: ${skipped.join(" | ")}` : ""),
        data: { deltas, results },
      };
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
