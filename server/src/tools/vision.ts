import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  capturePremiereWindow,
  ffmpegExtractFrame,
  findFfmpeg,
  sleep,
  waitForFile,
} from "../captureFrame.js";
import { frameToTicks, goToFrame, resolveTimebase } from "../timebase.js";
import { resolveH264MatchSourcePreset } from "../aeMogrtPaths.js";

/**
 * Sequence frame capture — NO full-timeline AME render.
 *
 * Primary (fast, reliable):
 *   Park playhead → Program Monitor HWND → strip title/chrome → crop to sequence size
 *
 * Optional pure (short 1-frame only, never full sequence):
 *   export.frame with frameSpan=1 + H264 + ffmpeg, 12s budget then abandon
 */

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function readPngSize(pngPath: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function isUsableStill(filePath: string, minBytes = 2000): boolean {
  if (!fs.existsSync(filePath)) return false;
  if (fs.statSync(filePath).size < minBytes) return false;
  if (/\.png$/i.test(filePath)) {
    const sz = readPngSize(filePath);
    if (!sz || sz.w < 320 || sz.h < 180) return false;
  }
  return true;
}

async function resolveAtTicks(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  sequenceId: string | undefined,
  atTicks?: string,
  frame?: number,
): Promise<{ atTicks: string; frame?: number }> {
  if (frame !== undefined && frame !== null) {
    try {
      const g = await goToFrame(ctx.relay, { sequenceId, frame });
      return { atTicks: g.atTicks, frame: g.frame };
    } catch {
      const tb = await resolveTimebase(ctx.relay, sequenceId);
      return { atTicks: frameToTicks(frame, tb.ticksPerFrame), frame };
    }
  }
  if (atTicks) return { atTicks };
  const pos = (await ctx.relay.call("playhead.get", sequenceId ? { sequenceId } : {})) as {
    ticks?: string;
    frame?: number;
  };
  return { atTicks: pos?.ticks ?? "0", frame: pos?.frame };
}

async function getSequenceSize(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  sequenceId?: string,
): Promise<{ width: number; height: number }> {
  try {
    const settings = (await ctx.relay.call(
      "sequence.getSettings",
      sequenceId ? { sequenceId } : {},
    )) as {
      frameSize?: { width?: number; height?: number };
      videoFrameWidth?: number;
      videoFrameHeight?: number;
    };
    if (settings?.frameSize?.width && settings?.frameSize?.height) {
      return { width: Number(settings.frameSize.width), height: Number(settings.frameSize.height) };
    }
    if (settings?.videoFrameWidth && settings?.videoFrameHeight) {
      return { width: Number(settings.videoFrameWidth), height: Number(settings.videoFrameHeight) };
    }
  } catch {
    /* default */
  }
  return { width: 1920, height: 1080 };
}

function inlineImage(
  outputPath: string,
  atTicks: string,
  frame: number | undefined,
  via: string,
  extra: unknown,
): {
  text: string;
  data: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;
} {
  const buf = fs.readFileSync(outputPath);
  const mimeType = mimeFromPath(outputPath);
  const maxBytes = 4_000_000;
  const images =
    buf.length <= maxBytes ? [{ data: buf.toString("base64"), mimeType }] : undefined;
  const pure = /export\.|h264|ffmpeg|png-sequence|still/i.test(via) && !/window|program-monitor|main|desktop/i.test(via);
  const premiereWin = /premiere-main|program-monitor/i.test(via);
  const desktop = /desktop/i.test(via);
  const sz = /\.png$/i.test(outputPath) ? readPngSize(outputPath) : null;
  const label = pure
    ? " [PURE encode]"
    : premiereWin
      ? " [full Premiere window]"
      : desktop
        ? " [full desktop fallback]"
        : " [window fallback]";
  return {
    text: images
      ? `Frame ticks=${atTicks}${frame !== undefined ? ` frame=${frame}` : ""} via ${via} (${(buf.length / 1024).toFixed(0)} KB${sz ? ` ${sz.w}x${sz.h}` : ""})${label}. Image attached.`
      : `Frame saved to ${outputPath} via ${via}${label}.`,
    data: {
      atTicks,
      frame,
      outputPath,
      bytes: buf.length,
      via,
      pureSequenceFrame: pure,
      premiereWindowFrame: premiereWin || pure,
      desktopFallback: desktop,
      width: sz?.w,
      height: sz?.h,
      inlined: !!images,
      extra,
    },
    images,
  };
}

/**
 * Optional short 1-frame encode — NEVER full sequence. 12s budget then give up.
 */
async function tryShortOneFrameEncode(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  opts: {
    sequenceId?: string;
    atTicks: string;
    frame?: number;
    outputPath: string;
    presetPath?: string;
  },
  attempts: string[],
): Promise<ReturnType<typeof inlineImage> | null> {
  if (!findFfmpeg()) {
    attempts.push("short-encode: no ffmpeg");
    return null;
  }
  const h264 = opts.presetPath || resolveH264MatchSourcePreset().path || "";
  if (!h264) {
    attempts.push("short-encode: no H264 preset");
    return null;
  }
  const mediaPath = path.join(os.tmpdir(), `ppmcp-1f-${Date.now()}.mp4`);
  try {
    const exportData = (await ctx.relay.call(
      "export.frame",
      {
        sequenceId: opts.sequenceId,
        atTicks: opts.atTicks,
        outputPath: opts.outputPath,
        mediaOutputPath: mediaPath,
        presetPath: h264,
        frameSpan: 1, // NEVER full timeline
      },
      12000, // hard 12s — if AME hangs, abandon (no full render wait)
    )) as {
      exported?: boolean;
      via?: string;
      needsFfmpegExtract?: boolean;
      mediaOutputPath?: string;
      exportError?: string;
    };

    if (exportData?.exported && isUsableStill(opts.outputPath) && !exportData.needsFfmpegExtract) {
      return inlineImage(opts.outputPath, opts.atTicks, opts.frame, exportData.via || "export.still", {
        pureSequenceFrame: true,
      });
    }

    const media = exportData?.mediaOutputPath || mediaPath;
    const ready = await waitForFile(media, 8000, 400);
    if (ready && ffmpegExtractFrame(media, opts.outputPath, 15000)) {
      try {
        fs.unlinkSync(media);
      } catch {
        /* */
      }
      if (isUsableStill(opts.outputPath)) {
        return inlineImage(opts.outputPath, opts.atTicks, opts.frame, "export.h264+ffmpeg", {
          pureSequenceFrame: true,
        });
      }
    }
    attempts.push(
      `short-encode: exported=${exportData?.exported} ready=${ready} err=${exportData?.exportError || "—"}`,
    );
  } catch (err) {
    attempts.push(`short-encode: ${err instanceof Error ? err.message : err}`);
  }
  try {
    if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
  } catch {
    /* */
  }
  return null;
}

/**
 * Primary path: Program Monitor video pane (no full AME render).
 */
async function captureProgramMonitorStill(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  opts: {
    sequenceId?: string;
    atTicks: string;
    frame?: number;
    outputPath: string;
  },
  attempts: string[],
): Promise<ReturnType<typeof inlineImage> | null> {
  try {
    await ctx.relay.call("playhead.set", {
      sequenceId: opts.sequenceId,
      atTicks: opts.atTicks,
    });
    await sleep(550);
  } catch (e) {
    attempts.push(`playhead.set: ${e instanceof Error ? e.message : e}`);
  }

  const size = await getSequenceSize(ctx, opts.sequenceId);
  await sleep(200);
  const cap = capturePremiereWindow(opts.outputPath, {
    mode: "program",
    frameWidth: size.width,
    frameHeight: size.height,
    // No crop — full Program Monitor as shown (title/transport OK)
    stripChrome: false,
    smartCrop: false,
  });

  if (cap.ok && isUsableStill(opts.outputPath, 500)) {
    return inlineImage(opts.outputPath, opts.atTicks, opts.frame, cap.via, {
      attempts,
      note:
        cap.via === "desktop"
          ? "Full primary desktop (Premiere HWND failed). No AME render."
          : "Full Premiere Pro main window (stable). PM child hunt skipped — layout changes. No AME render.",
      hwndHint: cap.hwndHint,
      frameWidth: size.width,
      frameHeight: size.height,
      noFullRender: true,
      noCrop: true,
    });
  }
  attempts.push(`program-monitor: ${cap.error || "failed"}`);
  return null;
}

async function captureFramePipeline(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  opts: {
    sequenceId?: string;
    atTicks?: string;
    frame?: number;
    outputPath?: string;
    /** Prefer short 1-frame encode first (default false — PM is faster/reliable). */
    tryEncodeFirst?: boolean;
    presetPath?: string;
    /** Restore playhead after capture (default true) so QA shots don't steal user's CTI. */
    restorePlayhead?: boolean;
  },
): Promise<{
  text: string;
  data: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;
}> {
  // Remember user's playhead BEFORE any scrub (screenshot used to leave CTI at capture time)
  let savedTicks: string | null = null;
  try {
    const cur = (await ctx.relay.call(
      "playhead.get",
      opts.sequenceId ? { sequenceId: opts.sequenceId } : {},
    )) as { ticks?: string };
    if (cur?.ticks !== undefined) savedTicks = String(cur.ticks);
  } catch {
    /* ignore */
  }

  const { atTicks, frame } = await resolveAtTicks(ctx, opts.sequenceId, opts.atTicks, opts.frame);
  const outputPath =
    opts.outputPath ?? path.join(os.tmpdir(), `ppmcp-preview-${Date.now()}.png`);
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  } catch {
    /* ignore */
  }

  const attempts: string[] = [];
  const restore = opts.restorePlayhead !== false;

  const finish = async <T extends { data?: Record<string, unknown> }>(result: T): Promise<T> => {
    if (restore && savedTicks !== null && savedTicks !== atTicks) {
      try {
        await ctx.relay.call("playhead.set", {
          sequenceId: opts.sequenceId,
          atTicks: savedTicks,
        });
        if (result.data) {
          result.data.playheadRestoredTo = savedTicks;
        }
      } catch (e) {
        attempts.push(`playhead.restore: ${e instanceof Error ? e.message : e}`);
      }
    }
    return result;
  };

  // Optional short encode first (never full sequence)
  if (opts.tryEncodeFirst) {
    const encoded = await tryShortOneFrameEncode(
      ctx,
      {
        sequenceId: opts.sequenceId,
        atTicks,
        frame,
        outputPath,
        presetPath: opts.presetPath,
      },
      attempts,
    );
    if (encoded) return finish(encoded);
  }

  // Primary: Program Monitor / Premiere window
  const pm = await captureProgramMonitorStill(
    ctx,
    { sequenceId: opts.sequenceId, atTicks, frame, outputPath },
    attempts,
  );
  if (pm) return finish(pm);

  // Last: short encode if not tried
  if (!opts.tryEncodeFirst) {
    const encoded = await tryShortOneFrameEncode(
      ctx,
      {
        sequenceId: opts.sequenceId,
        atTicks,
        frame,
        outputPath,
        presetPath: opts.presetPath,
      },
      attempts,
    );
    if (encoded) return finish(encoded);
  }

  await finish({ data: {} });
  return {
    text: `Could not capture Program Monitor frame at ticks=${atTicks}. Attempts: ${attempts.join(" | ")}. Keep Premiere visible with Program panel open.`,
    data: { atTicks, frame, outputPath, attempts, ok: false },
  };
}

export const visionTools = [
  defineTool({
    name: "sequence_export_still",
    title: "Export sequence frame (PM video pane)",
    description:
      "Capture full Premiere Pro window for QA (stable). Fallback: full desktop. Does NOT AME-render the timeline.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional(),
      frame: z.number().int().optional(),
      outputPath: z.string().optional(),
      presetPath: z.string().optional(),
      tryEncode: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, try 1-frame AME encode first (still never full sequence)."),
    },
    handler: async (p, ctx) =>
      captureFramePipeline(ctx, {
        sequenceId: p.sequenceId,
        atTicks: p.atTicks,
        frame: p.frame,
        outputPath: p.outputPath,
        tryEncodeFirst: p.tryEncode === true,
        presetPath: p.presetPath,
      }),
  }),

  defineTool({
    name: "sequence_preview_frame",
    title: "Preview timeline frame (vision)",
    description:
      "Full Premiere Pro window still for multimodal QA. Desktop fallback if needed. No AME timeline render.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional().describe("Absolute time in ticks."),
      frame: z.number().int().optional().describe("0-based frame number."),
      outputPath: z.string().optional(),
      preferWindowCapture: z
        .boolean()
        .optional()
        .default(true)
        .describe("Ignored — always uses Program Monitor pane (safe default)."),
      presetPath: z.string().optional(),
    },
    handler: async (p, ctx) =>
      captureFramePipeline(ctx, {
        sequenceId: p.sequenceId,
        atTicks: p.atTicks,
        frame: p.frame,
        outputPath: p.outputPath,
        tryEncodeFirst: false,
        presetPath: p.presetPath,
      }),
  }),

  defineTool({
    name: "sequence_screenshot",
    title: "Capture Program Monitor frame",
    description:
      "Capture full Premiere Pro application window (reliable). If that fails, full primary desktop. No fragile Program Monitor child search. No AME full-timeline render.",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional(),
      frame: z.number().int().optional(),
      outputPath: z.string().optional(),
      preferWindowCapture: z
        .boolean()
        .optional()
        .default(true)
        .describe("Always PM pane path — kept for API compat."),
    },
    handler: async (p, ctx) =>
      captureFramePipeline(ctx, {
        sequenceId: p.sequenceId,
        atTicks: p.atTicks,
        frame: p.frame,
        outputPath: p.outputPath,
        tryEncodeFirst: false,
      }),
  }),

  defineTool({
    name: "sequence_qa_loop",
    title: "Capture frame + timeline summary for QA",
    description: "Timeline tracks/markers + Program Monitor still (no full render).",
    inputSchema: {
      sequenceId: z.string().optional(),
      atTicks: z.string().optional(),
      frame: z.number().int().optional(),
      outputPath: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const summary = await ctx.relay.call(
        "track.list",
        p.sequenceId ? { sequenceId: p.sequenceId } : {},
      );
      const markers = await ctx.relay
        .call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})
        .catch(() => []);
      const frameResult = await captureFramePipeline(ctx, {
        sequenceId: p.sequenceId,
        atTicks: p.atTicks,
        frame: p.frame,
        outputPath: p.outputPath,
        tryEncodeFirst: false,
      });
      return {
        text: `QA: ${frameResult.text}`,
        data: {
          tracks: summary,
          markers,
          frame: frameResult.data,
        },
        images: frameResult.images,
      };
    },
  }),
];
