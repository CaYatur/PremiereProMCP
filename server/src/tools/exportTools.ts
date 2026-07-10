import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

export const exportTools = [
  defineTool({
    name: "export_sequence",
    title: "Export/render a sequence",
    description:
      "Export a sequence via EncoderManager.exportSequence. exportType: immediately (default) or queue (Media Encoder).",
    inputSchema: {
      sequenceId: z.string().optional(),
      outputPath: z.string().describe("Absolute output media path."),
      presetPath: z.string().optional().describe("Absolute path to a .epr preset."),
      exportType: z.enum(["immediately", "queue"]).optional().default("immediately"),
      exportFull: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("export.sequence", p);
      return { text: `Export to ${p.outputPath} (${p.exportType}).`, data };
    },
  }),

  defineTool({
    name: "export_with_preset",
    title: "Export with preset",
    description: "Alias of export_sequence requiring a .epr preset path.",
    inputSchema: {
      sequenceId: z.string().optional(),
      outputPath: z.string(),
      presetPath: z.string(),
      exportType: z.enum(["immediately", "queue"]).optional().default("immediately"),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("export.sequence", p);
      return { text: `Export with preset to ${p.outputPath}.`, data };
    },
  }),

  defineTool({
    name: "export_queue_to_media_encoder",
    title: "Queue sequence to Media Encoder",
    description: "Queue a sequence export in Adobe Media Encoder (exportType=queue).",
    inputSchema: {
      sequenceId: z.string().optional(),
      outputPath: z.string(),
      presetPath: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("export.sequence", { ...p, exportType: "queue" });
      return { text: `Queued to Media Encoder: ${p.outputPath}.`, data };
    },
  }),

  defineTool({
    name: "export_frame",
    title: "Export a single frame",
    description:
      "Capture one PURE sequence frame (no Premiere UI). Uses AME still/1-frame encode + ffmpeg. Prefer sequence_export_still for vision. Does NOT use window screenshot.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional(),
      frame: z.number().int().optional().describe("0-based frame; alternative to atTicks."),
      outputPath: z.string().describe("Absolute path for PNG/JPEG output."),
    },
    handler: async (p, ctx) => {
      const { visionTools } = await import("./vision.js");
      const still = visionTools.find((t) => t.name === "sequence_export_still");
      if (!still) {
        return { text: "sequence_export_still missing.", data: { ok: false } };
      }
      return still.handler(
        {
          sequenceId: p.sequenceId,
          atTicks: p.atTicks,
          frame: p.frame,
          outputPath: p.outputPath,
        } as never,
        ctx,
      );
    },
  }),

  defineTool({
    name: "export_frame_as_image",
    title: "Export frame as image",
    description: "Alias of export_frame — pure sequence still (no Premiere UI chrome).",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional(),
      frame: z.number().int().optional(),
      outputPath: z.string(),
    },
    handler: async (p, ctx) => {
      const { visionTools } = await import("./vision.js");
      const still = visionTools.find((t) => t.name === "sequence_export_still");
      if (!still) return { text: "sequence_export_still missing.", data: { ok: false } };
      return still.handler(
        {
          sequenceId: p.sequenceId,
          atTicks: p.atTicks,
          frame: p.frame,
          outputPath: p.outputPath,
        } as never,
        ctx,
      );
    },
  }),

  defineTool({
    name: "export_batch_sequences",
    title: "Batch export sequences",
    description: "Export multiple sequences to paths derived from outputDir + sequence name.",
    inputSchema: {
      sequenceIds: z.array(z.string()).min(1),
      outputDir: z.string().describe("Absolute directory for outputs."),
      presetPath: z.string().optional(),
      extension: z.string().optional().default(".mp4"),
      exportType: z.enum(["immediately", "queue"]).optional().default("queue"),
    },
    handler: async (p, ctx) => {
      const results = [];
      const list = (await ctx.relay.call("sequence.list", {})) as Array<{ sequenceId: string; name: string }>;
      for (const id of p.sequenceIds) {
        const seq = list.find((s) => s.sequenceId === id);
        const safeName = (seq?.name || id).replace(/[<>:"/\\|?*]/g, "_");
        const outputPath = `${p.outputDir.replace(/[\\/]$/, "")}\\${safeName}${p.extension.startsWith(".") ? p.extension : `.${p.extension}`}`;
        try {
          const data = await ctx.relay.call("export.sequence", {
            sequenceId: id,
            outputPath,
            presetPath: p.presetPath,
            exportType: p.exportType,
          });
          results.push({ sequenceId: id, outputPath, ok: true, data });
        } catch (err) {
          results.push({
            sequenceId: id,
            outputPath,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Batch export: ${ok}/${results.length} started.`, data: { results } };
    },
  }),

  defineTool({
    name: "export_launch_media_encoder",
    title: "Launch Media Encoder",
    description: "Launch Adobe Media Encoder if installed (EncoderManager.launchEncoder).",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("export.launchEncoder", {});
      return { text: `Media Encoder: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "export_start_batch",
    title: "Start AME batch encode",
    description: "Start encoding the Media Encoder batch queue (EncoderManager.startBatchEncode).",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("export.startBatch", {});
      return { text: "Batch encode started.", data };
    },
  }),

  defineTool({
    name: "export_get_status",
    title: "Get encoder status",
    description: "Report whether Adobe Media Encoder is installed.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("export.getStatus", {});
      return { text: `Encoder status: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "export_get_file_extension",
    title: "Get export file extension for preset",
    description: "Return the file extension EncoderManager expects for a sequence+preset pair.",
    inputSchema: { sequenceId: z.string().optional(), presetPath: z.string().optional() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("export.getFileExtension", p);
      return { text: `Extension: ${JSON.stringify(data)}`, data };
    },
  }),
];
