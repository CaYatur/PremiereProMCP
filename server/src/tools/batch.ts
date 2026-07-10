import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

// Category O — automation/batch. Server-side loops over confirmed atomic
// relay methods. Omitted: batch_replace_font_in_titles (ExtendScript/MOGRT
// only), batch_export_stills_from_markers (export-frame path incomplete),
// batch_tag_by_criteria (metadata API unconfirmed).

const clipRefObj = z.object({
  trackType: z.enum(["video", "audio"]),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
});

type SelectedClip = {
  trackType?: "video" | "audio";
  trackIndex?: number;
  clipIndex?: number;
  name?: string;
};

export const batchTools = [
  defineTool({
    name: "batch_rename_items",
    title: "Batch rename project items",
    description:
      "Rename multiple project items. Each entry is { projectItemId, name }. Uses media.rename (ClipProjectItem.createSetNameAction) per item.",
    inputSchema: {
      items: z
        .array(z.object({ projectItemId: z.string(), name: z.string() }))
        .min(1)
        .describe("List of project items to rename."),
    },
    handler: async (p, ctx) => {
      const results: Array<{ projectItemId: string; name: string; ok: boolean; error?: string }> = [];
      for (const it of p.items) {
        try {
          await ctx.relay.call("media.rename", it);
          results.push({ projectItemId: it.projectItemId, name: it.name, ok: true });
        } catch (err) {
          results.push({
            projectItemId: it.projectItemId,
            name: it.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Renamed ${ok}/${results.length} item(s).`, data: { results } };
    },
  }),

  defineTool({
    name: "batch_apply_effect_to_selection",
    title: "Apply effect to selection (or clip list)",
    description:
      "Apply an effect (by matchName from effect_list_available) to every clip in the current timeline selection, or to an explicit clips array. Requires trackType/trackIndex/clipIndex on each target.",
    inputSchema: {
      sequenceId: z.string().optional(),
      matchName: z.string().describe('Effect matchName, e.g. "AE.ADBE Gaussian Blur 2".'),
      clips: z
        .array(clipRefObj)
        .optional()
        .describe("If omitted, uses the current timeline selection from selection_get."),
    },
    handler: async (p, ctx) => {
      let targets: Array<{ trackType: "video" | "audio"; trackIndex: number; clipIndex: number }> = p.clips ?? [];
      if (!targets.length) {
        const selected = (await ctx.relay.call("selection.get", {
          sequenceId: p.sequenceId,
        })) as SelectedClip[];
        targets = selected
          .filter(
            (c): c is SelectedClip & { trackType: "video" | "audio"; trackIndex: number; clipIndex: number } =>
              c.trackType === "video" || c.trackType === "audio",
          )
          .filter((c) => typeof c.trackIndex === "number" && typeof c.clipIndex === "number")
          .map((c) => ({ trackType: c.trackType, trackIndex: c.trackIndex, clipIndex: c.clipIndex }));
      }
      if (!targets.length) {
        return {
          text: "No target clips — select timeline clips first, or pass a clips array.",
          data: { applied: 0, results: [] },
        };
      }
      const results: Array<{ clip: (typeof targets)[0]; ok: boolean; error?: string }> = [];
      for (const clip of targets) {
        try {
          await ctx.relay.call("effect.add", {
            sequenceId: p.sequenceId,
            ...clip,
            matchName: p.matchName,
          });
          results.push({ clip, ok: true });
        } catch (err) {
          results.push({
            clip,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return {
        text: `Applied ${p.matchName} to ${ok}/${results.length} clip(s).`,
        data: { applied: ok, results },
      };
    },
  }),

  defineTool({
    name: "batch_apply_color_to_selection",
    title: "Apply Lumetri to selection (or clip list)",
    description:
      "Apply Lumetri Color to every target video clip (selection or explicit list), optionally setting basic-correction params afterward.",
    inputSchema: {
      sequenceId: z.string().optional(),
      clips: z.array(clipRefObj).optional(),
      params: z
        .record(z.number())
        .optional()
        .describe('Optional Lumetri params after apply, e.g. { "Exposure": 0.5, "Saturation": 110 }.'),
    },
    handler: async (p, ctx) => {
      let targets: Array<{ trackType: "video" | "audio"; trackIndex: number; clipIndex: number }> = p.clips ?? [];
      if (!targets.length) {
        const selected = (await ctx.relay.call("selection.get", {
          sequenceId: p.sequenceId,
        })) as SelectedClip[];
        targets = selected
          .filter(
            (c): c is SelectedClip & { trackType: "video" | "audio"; trackIndex: number; clipIndex: number } =>
              c.trackType === "video" || c.trackType === "audio",
          )
          .filter((c) => typeof c.trackIndex === "number" && typeof c.clipIndex === "number")
          .map((c) => ({ trackType: c.trackType, trackIndex: c.trackIndex, clipIndex: c.clipIndex }));
      }
      const videoTargets = targets.filter((c) => c.trackType === "video");
      if (!videoTargets.length) {
        return {
          text: "No video target clips — select video clips or pass clips with trackType video.",
          data: { applied: 0, results: [] },
        };
      }
      const results: Array<{ clip: (typeof videoTargets)[0]; ok: boolean; error?: string }> = [];
      for (const clip of videoTargets) {
        try {
          await ctx.relay.call("color.applyLumetri", { sequenceId: p.sequenceId, ...clip });
          if (p.params) {
            for (const [paramName, value] of Object.entries(p.params)) {
              await ctx.relay.call("color.setParam", {
                sequenceId: p.sequenceId,
                ...clip,
                paramName,
                value,
              });
            }
          }
          results.push({ clip, ok: true });
        } catch (err) {
          results.push({
            clip,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return {
        text: `Applied Lumetri to ${ok}/${results.length} clip(s).`,
        data: { applied: ok, results },
      };
    },
  }),

  defineTool({
    name: "batch_relink_by_pattern",
    title: "Batch relink media by path pattern",
    description:
      "Find project items whose media path contains matchString, then replace pathSubstring with pathReplacement via media.relink. Example: matchString 'D:\\\\old', pathSubstring 'D:\\\\old', pathReplacement 'E:\\\\new'.",
    inputSchema: {
      matchString: z.string().describe("Substring used to find items (media_find_by_path)."),
      pathSubstring: z.string().describe("Substring in the current path to replace."),
      pathReplacement: z.string().describe("Replacement path fragment."),
      ignoreSubclips: z.boolean().optional().default(true),
      overrideCompatibilityCheck: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const found = (await ctx.relay.call("media.findByPath", {
        matchString: p.matchString,
        ignoreSubclips: p.ignoreSubclips,
      })) as Array<{ projectItemId?: string; name?: string; mediaFilePath?: string }>;
      const results: Array<{
        projectItemId?: string;
        name?: string;
        from?: string;
        to?: string;
        ok: boolean;
        error?: string;
      }> = [];
      for (const item of found) {
        if (!item.projectItemId || !item.mediaFilePath) {
          results.push({
            projectItemId: item.projectItemId,
            name: item.name,
            ok: false,
            error: "Missing projectItemId or mediaFilePath",
          });
          continue;
        }
        if (!item.mediaFilePath.includes(p.pathSubstring)) {
          results.push({
            projectItemId: item.projectItemId,
            name: item.name,
            from: item.mediaFilePath,
            ok: false,
            error: "pathSubstring not present in mediaFilePath",
          });
          continue;
        }
        const newPath = item.mediaFilePath.split(p.pathSubstring).join(p.pathReplacement);
        try {
          await ctx.relay.call("media.relink", {
            projectItemId: item.projectItemId,
            newPath,
            overrideCompatibilityCheck: p.overrideCompatibilityCheck,
          });
          results.push({
            projectItemId: item.projectItemId,
            name: item.name,
            from: item.mediaFilePath,
            to: newPath,
            ok: true,
          });
        } catch (err) {
          results.push({
            projectItemId: item.projectItemId,
            name: item.name,
            from: item.mediaFilePath,
            to: newPath,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return {
        text: `Relinked ${ok}/${results.length} item(s) matching "${p.matchString}".`,
        data: { results, found: found.length },
      };
    },
  }),

  defineTool({
    name: "batch_apply_color_preset_to_selection",
    title: "Apply color params to selection",
    description: "Alias of batch_apply_color_to_selection with optional Lumetri param map.",
    inputSchema: {
      sequenceId: z.string().optional(),
      clips: z.array(clipRefObj).optional(),
      params: z.record(z.number()).optional(),
    },
    handler: async (p, ctx) => {
      // Re-use same logic by calling color tools in-process via relay like batch_apply_color_to_selection.
      let targets: Array<{ trackType: "video" | "audio"; trackIndex: number; clipIndex: number }> = p.clips ?? [];
      if (!targets.length) {
        const selected = (await ctx.relay.call("selection.get", {
          sequenceId: p.sequenceId,
        })) as SelectedClip[];
        targets = selected
          .filter(
            (c): c is SelectedClip & { trackType: "video" | "audio"; trackIndex: number; clipIndex: number } =>
              c.trackType === "video" || c.trackType === "audio",
          )
          .filter((c) => typeof c.trackIndex === "number" && typeof c.clipIndex === "number")
          .map((c) => ({ trackType: c.trackType, trackIndex: c.trackIndex, clipIndex: c.clipIndex }));
      }
      const videoTargets = targets.filter((c) => c.trackType === "video");
      const results: Array<{ clip: (typeof videoTargets)[0]; ok: boolean; error?: string }> = [];
      for (const clip of videoTargets) {
        try {
          await ctx.relay.call("color.applyLumetri", { sequenceId: p.sequenceId, ...clip });
          if (p.params) {
            for (const [paramName, value] of Object.entries(p.params)) {
              await ctx.relay.call("color.setParam", {
                sequenceId: p.sequenceId,
                ...clip,
                paramName,
                value,
              });
            }
          }
          results.push({ clip, ok: true });
        } catch (err) {
          results.push({
            clip,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Color preset applied to ${ok}/${results.length} clip(s).`, data: { applied: ok, results } };
    },
  }),

  defineTool({
    name: "batch_export_stills_from_markers",
    title: "Export stills from markers",
    description: "Export a still frame at each sequence marker into outputDir (export.frame per marker).",
    inputSchema: {
      sequenceId: z.string().optional(),
      outputDir: z.string(),
      extension: z.string().optional().default(".png"),
    },
    handler: async (p, ctx) => {
      const markers = (await ctx.relay.call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})) as Array<{
        markerIndex: number;
        startTicks: string;
        name?: string;
      }>;
      const ext = p.extension.startsWith(".") ? p.extension : `.${p.extension}`;
      const results = [];
      for (const m of markers) {
        const safe = (m.name || `marker_${m.markerIndex}`).replace(/[<>:"/\\|?*]/g, "_");
        const outputPath = `${p.outputDir.replace(/[\\/]$/, "")}\\${m.markerIndex}_${safe}${ext}`;
        try {
          await ctx.relay.call("export.frame", {
            sequenceId: p.sequenceId,
            atTicks: m.startTicks,
            outputPath,
          });
          results.push({ markerIndex: m.markerIndex, outputPath, ok: true });
        } catch (err) {
          results.push({
            markerIndex: m.markerIndex,
            outputPath,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Exported ${ok}/${results.length} still(s) from markers.`, data: { results } };
    },
  }),
];
