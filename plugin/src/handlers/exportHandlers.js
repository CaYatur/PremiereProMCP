// Export via EncoderManager + best-effort frame still capture.
// Sequence.exportFrame is NOT in current UXP Sequence docs — we probe several
// hosts, then fall back to 1-frame in/out export for the MCP server to
// ffmpeg-extract a PNG. Server can also do a Windows window screenshot.

const { apiError, getActiveProject, getSequence, tickTime, ppro } = require("../ppro.js");

const TICKS_PER_SECOND = 254016000000n;

function getEncoderManager() {
  if (!ppro.EncoderManager || typeof ppro.EncoderManager.getManager !== "function") {
    const e = new Error("EncoderManager.getManager is not available in this Premiere build.");
    e.code = "PREMIERE_API_ERROR";
    throw e;
  }
  return ppro.EncoderManager.getManager();
}

function resolveExportType(exportType) {
  const map = ppro.Constants && ppro.Constants.ExportType ? ppro.Constants.ExportType : {};
  if (exportType === "queue" || exportType === "QUEUE_TO_AME") {
    return map.QUEUE_TO_AME ?? map.QUEUE ?? exportType;
  }
  if (exportType === "immediately" || exportType === "IMMEDIATELY" || !exportType) {
    return map.IMMEDIATELY ?? map.IMMEDIATE ?? exportType ?? 0;
  }
  return map[exportType] ?? exportType;
}

async function resolveTicksPerFrame(sequence) {
  try {
    if (typeof sequence.getTimebase === "function") {
      const tb = await sequence.getTimebase();
      if (tb !== undefined && tb !== null && String(tb) !== "") {
        const n = BigInt(String(tb));
        if (n > 0n) return n;
      }
    }
  } catch {
    /* fall through */
  }
  return TICKS_PER_SECOND / 24n;
}

function toTickTime(atTicks) {
  if (atTicks === "0" || !atTicks) {
    return ppro.TickTime.TIME_ZERO || tickTime("0");
  }
  try {
    if (ppro.TickTime.createWithSeconds) {
      return ppro.TickTime.createWithSeconds(Number(BigInt(String(atTicks))) / Number(TICKS_PER_SECOND));
    }
  } catch {
    /* fall through */
  }
  return tickTime(atTicks);
}

async function tryDirectExportFrame(sequence, project, atTicks, outputPath) {
  const time = toTickTime(atTicks);
  const attempts = [];

  for (const [label, fn] of [
    [
      "sequence.exportFrame",
      async () => {
        if (typeof sequence.exportFrame !== "function") throw new Error("missing");
        await sequence.exportFrame(time, outputPath);
      },
    ],
    [
      "sequence.exportFrameJPEG",
      async () => {
        if (typeof sequence.exportFrameJPEG !== "function") throw new Error("missing");
        await sequence.exportFrameJPEG(time, outputPath);
      },
    ],
    [
      "project.exportFrame",
      async () => {
        if (typeof project.exportFrame !== "function") throw new Error("missing");
        await project.exportFrame(sequence, time, outputPath);
      },
    ],
    [
      "Application.exportFrame",
      async () => {
        const App = ppro.Application || ppro.app;
        if (!App || typeof App.exportFrame !== "function") throw new Error("missing");
        await App.exportFrame(sequence, time, outputPath);
      },
    ],
  ]) {
    try {
      await fn();
      return { exported: true, outputPath, via: label };
    } catch (e) {
      attempts.push(`${label}: ${e && e.message ? e.message : e}`);
    }
  }
  return { exported: false, attempts };
}

async function setInOutSafe(sequence, inTicks, outTicks) {
  const inT = toTickTime(inTicks);
  const outT = toTickTime(outTicks);
  // Prefer direct setters if present
  if (typeof sequence.setInPoint === "function") {
    await sequence.setInPoint(inT);
  } else if (typeof sequence.createSetInPointAction === "function") {
    /* action-based path not used without project transaction here */
  }
  if (typeof sequence.setOutPoint === "function") {
    await sequence.setOutPoint(outT);
  }
}

async function getInOutSafe(sequence) {
  let inTicks = null;
  let outTicks = null;
  try {
    if (typeof sequence.getInPoint === "function") {
      const t = await sequence.getInPoint();
      inTicks = t && t.ticks !== undefined ? String(t.ticks) : null;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof sequence.getOutPoint === "function") {
      const t = await sequence.getOutPoint();
      outTicks = t && t.ticks !== undefined ? String(t.ticks) : null;
    }
  } catch {
    /* ignore */
  }
  return { inTicks, outTicks };
}

/**
 * Set playhead to target, pin in/out to frameSpan frames, EncoderManager export.
 * Server extracts PNG with ffmpeg (or uses PNG sequence file directly).
 * frameSpan: 1 = single frame; 12 = short clip (more reliable AME output).
 */
async function prepareAndMaybeExportOneFrame(
  sequence,
  project,
  atTicks,
  mediaOutputPath,
  presetPath,
  frameSpan,
) {
  const tpf = await resolveTicksPerFrame(sequence);
  const start = BigInt(String(atTicks || "0"));
  const span = Math.max(1, Math.min(120, Number(frameSpan) || 1));
  const end = start + tpf * BigInt(span);
  const time = toTickTime(String(start));

  // Always park CTI on the target frame so Program Monitor shows it.
  try {
    if (typeof sequence.setPlayerPosition === "function") {
      await sequence.setPlayerPosition(time);
    }
  } catch {
    /* non-fatal */
  }

  // Direct still API first (only when asking for image path)
  if (mediaOutputPath && /\.(png|jpe?g|bmp|webp)$/i.test(mediaOutputPath) && span === 1) {
    const direct = await tryDirectExportFrame(sequence, project, String(start), mediaOutputPath);
    if (direct.exported) return direct;
  }

  if (!mediaOutputPath) {
    return {
      prepared: true,
      atTicks: String(start),
      frame: Number(start / tpf),
      ticksPerFrame: String(tpf),
      note: "Playhead set; no media path for encoder fallback.",
    };
  }

  const prev = await getInOutSafe(sequence);
  let exportResult = null;
  let exportError = null;
  try {
    await setInOutSafe(sequence, String(start), String(end));
    // Brief settle so in/out take effect before AME reads them
    await new Promise((r) => setTimeout(r, 200));
    const em = getEncoderManager();
    const type = resolveExportType("immediately");
    // exportFull=false → honor in/out range only (critical for pure still)
    const ok = await em.exportSequence(
      sequence,
      type,
      mediaOutputPath,
      presetPath || "",
      false,
    );
    exportResult = {
      started: !!ok,
      mediaOutputPath,
      ameInstalled: em.isAMEInstalled,
      via: span === 1 ? "exportSequence-one-frame-inout" : `exportSequence-${span}frame-inout`,
      frameSpan: span,
    };
  } catch (e) {
    exportError = e && e.message ? e.message : String(e);
  } finally {
    // Restore previous in/out best-effort
    try {
      if (prev.inTicks !== null || prev.outTicks !== null) {
        await setInOutSafe(
          sequence,
          prev.inTicks ?? "0",
          prev.outTicks ?? String(end + tpf * 100n),
        );
      } else {
        // Clear work area if we had none
        try {
          await setInOutSafe(sequence, "0", "0");
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore restore errors */
    }
  }

  if (exportResult) {
    const isImageOut = /\.(png|jpe?g|bmp|webp)$/i.test(mediaOutputPath);
    return {
      exported: true,
      ...exportResult,
      atTicks: String(start),
      frame: Number(start / tpf),
      ticksPerFrame: String(tpf),
      // Image sequence presets write stills; video presets need ffmpeg
      needsFfmpegExtract: !isImageOut,
    };
  }

  return {
    exported: false,
    prepared: true,
    atTicks: String(start),
    frame: Number(start / tpf),
    ticksPerFrame: String(tpf),
    exportError,
    note: "Playhead parked; encoder in/out export failed.",
  };
}

module.exports = {
  "export.sequence": async ({ sequenceId, outputPath, presetPath, exportType, exportFull }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const em = getEncoderManager();
      const type = resolveExportType(exportType);
      const ok = await em.exportSequence(
        sequence,
        type,
        outputPath || "",
        presetPath || "",
        exportFull !== false,
      );
      return {
        started: !!ok,
        outputPath: outputPath || null,
        exportType: exportType || "immediately",
        ameInstalled: em.isAMEInstalled,
      };
    } catch (err) {
      throw apiError("export.sequence", err);
    }
  },

  "export.frame": async ({
    sequenceId,
    atTicks,
    outputPath,
    mediaOutputPath,
    presetPath,
    frameSpan,
  }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      // Prefer a still path for direct APIs; media path for encoder fallback.
      const stillPath = outputPath && /\.(png|jpe?g|bmp|webp)$/i.test(outputPath) ? outputPath : null;
      const mediaPath =
        mediaOutputPath ||
        (outputPath && !stillPath ? outputPath : null) ||
        (outputPath ? String(outputPath).replace(/\.[^.]+$/, "") + "-1frame.mp4" : null);

      if (stillPath && (!frameSpan || Number(frameSpan) <= 1)) {
        const direct = await tryDirectExportFrame(sequence, project, atTicks || "0", stillPath);
        if (direct.exported) return direct;
      }

      const result = await prepareAndMaybeExportOneFrame(
        sequence,
        project,
        atTicks || "0",
        mediaPath,
        presetPath,
        frameSpan,
      );
      if (result.exported && !result.needsFfmpegExtract) {
        return {
          ...result,
          outputPath: stillPath || outputPath || null,
          mediaOutputPath: result.mediaOutputPath,
        };
      }
      if (result.exported && result.needsFfmpegExtract) {
        return {
          ...result,
          outputPath: stillPath || outputPath || null,
          mediaOutputPath: result.mediaOutputPath,
        };
      }
      // Soft result — server may retry or report pure-export failure (no silent UI)
      return {
        exported: false,
        prepared: true,
        atTicks: result.atTicks,
        frame: result.frame,
        ticksPerFrame: result.ticksPerFrame,
        outputPath: stillPath || outputPath || null,
        exportError: result.exportError || result.note,
        via: "playhead-only",
        platformGap: "uxp-no-exportFrame",
      };
    } catch (err) {
      throw apiError("export.frame", err);
    }
  },

  /** Park playhead on a frame so Program Monitor updates (for window capture). */
  "export.prepareFrame": async ({ sequenceId, atTicks, frame }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const tpf = await resolveTicksPerFrame(sequence);
      let ticks = atTicks;
      if (frame !== undefined && frame !== null && (ticks === undefined || ticks === null)) {
        ticks = String(BigInt(Math.max(0, Math.floor(Number(frame)))) * tpf);
      }
      ticks = String(ticks || "0");
      await sequence.setPlayerPosition(toTickTime(ticks));
      return {
        prepared: true,
        atTicks: ticks,
        frame: Number(BigInt(ticks) / tpf),
        ticksPerFrame: String(tpf),
      };
    } catch (err) {
      throw apiError("export.prepareFrame", err);
    }
  },

  "export.encodeFile": async ({ filePath, outputPath, presetPath, startQueueImmediately }) => {
    try {
      const em = getEncoderManager();
      const ok = await em.encodeFile(
        filePath,
        outputPath,
        presetPath || "",
        ppro.TickTime.TIME_ZERO,
        ppro.TickTime.TIME_ZERO,
        0,
        false,
        !!startQueueImmediately,
      );
      return { queued: !!ok, outputPath, ameInstalled: em.isAMEInstalled };
    } catch (err) {
      throw apiError("export.encodeFile", err);
    }
  },

  "export.launchEncoder": async () => {
    try {
      const em = getEncoderManager();
      if (typeof em.launchEncoder !== "function") {
        return { launched: false, ameInstalled: em.isAMEInstalled, note: "launchEncoder not available" };
      }
      const ok = await em.launchEncoder();
      return { launched: !!ok, ameInstalled: em.isAMEInstalled };
    } catch (err) {
      throw apiError("export.launchEncoder", err);
    }
  },

  "export.startBatch": async () => {
    try {
      const em = getEncoderManager();
      if (typeof em.startBatchEncode !== "function") {
        throw new Error("startBatchEncode not available in this Premiere build.");
      }
      const ok = await em.startBatchEncode();
      return { started: !!ok };
    } catch (err) {
      throw apiError("export.startBatch", err);
    }
  },

  "export.getStatus": async () => {
    try {
      const em = getEncoderManager();
      return { ameInstalled: !!em.isAMEInstalled };
    } catch (err) {
      throw apiError("export.getStatus", err);
    }
  },

  "export.getFileExtension": async ({ sequenceId, presetPath }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const ext = await ppro.EncoderManager.getExportFileExtension(sequence, presetPath || "");
      return { extension: ext };
    } catch (err) {
      throw apiError("export.getFileExtension", err);
    }
  },
};
