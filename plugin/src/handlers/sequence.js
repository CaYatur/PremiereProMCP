const { ppro, apiError, getActiveProject, getSequence, sequenceIdOf, getTrackCount } = require("../ppro.js");

async function sequenceSummary(sequence) {
  return {
    sequenceId: sequenceIdOf(sequence),
    name: sequence.name,
    videoTrackCount: await getTrackCount(sequence, "video"),
    audioTrackCount: await getTrackCount(sequence, "audio"),
  };
}

module.exports = {
  "sequence.create": async ({ name, presetPath }) => {
    const project = await getActiveProject();
    try {
      // Confirmed live (docs/PLAN.md §3): project.createSequence(name)
      // works with no preset — Premiere applies its own default. presetPath
      // is passed through when given, for callers that want a specific
      // preset's frame rate/resolution.
      const sequence = presetPath ? await project.createSequence(name, presetPath) : await project.createSequence(name);
      return sequenceSummary(sequence);
    } catch (err) {
      throw apiError("sequence.create", err);
    }
  },

  "sequence.getActive": async () => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, undefined);
    return sequenceSummary(sequence);
  },

  "sequence.list": async () => {
    const project = await getActiveProject();
    const sequences = await project.getSequences();
    return Promise.all(sequences.map(sequenceSummary));
  },

  "sequence.setActive": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      await project.setActiveSequence(sequence);
      return { active: true };
    } catch (err) {
      throw apiError("sequence.setActive", err);
    }
  },

  "sequence.getSettings": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const raw = await sequence.getSettings();
      // Plain JSON for MCP (class instances serialize to {})
      const out = {};
      if (raw && typeof raw === "object") {
        for (const k of Object.keys(raw)) {
          try {
            const v = raw[k];
            if (v === null || v === undefined) out[k] = v;
            else if (typeof v === "object" && v.ticks !== undefined) out[k] = String(v.ticks);
            else if (typeof v === "object" && typeof v.then === "function") out[k] = await v;
            else if (typeof v !== "function" && typeof v !== "object") out[k] = v;
            else if (typeof v === "object") {
              try {
                out[k] = JSON.parse(JSON.stringify(v));
              } catch {
                out[k] = String(v);
              }
            }
          } catch {
            /* skip */
          }
        }
      }
      try {
        if (typeof sequence.getTimebase === "function") {
          out.timebaseTicksPerFrame = String(await sequence.getTimebase());
        }
      } catch {
        /* ignore */
      }
      try {
        if (typeof sequence.getFrameSize === "function") {
          const fs = await sequence.getFrameSize();
          out.frameSize = fs
            ? { width: fs.width ?? fs.Width, height: fs.height ?? fs.Height }
            : undefined;
        }
      } catch {
        /* ignore */
      }
      return out;
    } catch (err) {
      throw apiError("sequence.getSettings", err);
    }
  },

  "sequence.getTimebase": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      let ticksPerFrame = null;
      if (typeof sequence.getTimebase === "function") {
        ticksPerFrame = String(await sequence.getTimebase());
      }
      const TICKS_PER_SECOND = 254016000000;
      const tpf = ticksPerFrame ? Number(ticksPerFrame) : TICKS_PER_SECOND / 24;
      return {
        ticksPerFrame: ticksPerFrame || String(Math.round(TICKS_PER_SECOND / 24)),
        fps: Math.round((TICKS_PER_SECOND / tpf) * 1000) / 1000,
        ticksPerSecond: String(TICKS_PER_SECOND),
      };
    } catch (err) {
      throw apiError("sequence.getTimebase", err);
    }
  },

  "sequence.setInOut": async ({ sequenceId, inTicks, outTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      if (inTicks !== undefined) await sequence.setInPoint(ppro.TickTime.createWithTicks(String(inTicks)));
      if (outTicks !== undefined) await sequence.setOutPoint(ppro.TickTime.createWithTicks(String(outTicks)));
      return { updated: true };
    } catch (err) {
      throw apiError("sequence.setInOut", err);
    }
  },

  "sequence.delete": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      await project.deleteSequence(sequence);
      return { deleted: true };
    } catch (err) {
      throw apiError("sequence.delete", err);
    }
  },

  "sequence.close": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      if (typeof project.closeSequence !== "function") {
        throw new Error("project.closeSequence is not available in this Premiere build.");
      }
      const ok = await project.closeSequence(sequence);
      return { closed: !!ok };
    } catch (err) {
      throw apiError("sequence.close", err);
    }
  },

  "sequence.createFromMedia": async ({ name, projectItemIds, targetBinPath }) => {
    const project = await getActiveProject();
    try {
      if (typeof project.createSequenceFromMedia !== "function") {
        throw new Error("project.createSequenceFromMedia is not available.");
      }
      const { findProjectItemById } = require("../ppro.js");
      const clips = [];
      for (const id of projectItemIds || []) {
        const item = await findProjectItemById(project, id);
        let cast = item;
        if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
          try {
            cast = ppro.ClipProjectItem.cast(item);
            // Skip sequences / non-media that cast but aren't timeline-able.
            if (typeof cast.isSequence === "function" && (await cast.isSequence())) continue;
            if (typeof cast.getMediaFilePath === "function") {
              const path = await cast.getMediaFilePath().catch(() => "");
              if (!path) continue;
            }
          } catch {
            continue;
          }
        }
        clips.push(cast);
      }
      if (!clips.length) {
        const e = new Error("No usable media ClipProjectItems among the given projectItemIds (sequences/empty items skipped).");
        e.code = "INVALID_PARAMS";
        throw e;
      }
      let targetBin;
      if (targetBinPath && targetBinPath.length) {
        let current = await project.getRootItem();
        for (const segment of targetBinPath) {
          const children = await current.getItems();
          const next = children.find((c) => c.name === segment);
          if (!next) {
            const e = new Error(`Bin path segment "${segment}" not found.`);
            e.code = "NOT_FOUND";
            throw e;
          }
          current = next;
        }
        targetBin = current;
      } else if (typeof project.getInsertionBin === "function") {
        targetBin = await project.getInsertionBin();
      } else {
        targetBin = await project.getRootItem();
      }
      // Some builds reject FolderItem vs ProjectItem cast mismatches — try root as-is.
      let sequence;
      try {
        sequence = await project.createSequenceFromMedia(name, clips, targetBin);
      } catch (err1) {
        // Retry without target bin if the 3-arg form rejects the bin type.
        try {
          sequence = await project.createSequenceFromMedia(name, clips);
        } catch {
          throw err1;
        }
      }
      if (!sequence) {
        // Retry once with only the first clip (large multi-item lists can null-out)
        if (clips.length > 1) {
          try {
            sequence = await project.createSequenceFromMedia(name, [clips[0]]);
          } catch {
            /* fall through */
          }
        }
      }
      if (!sequence) {
        const e = new Error(
          "createSequenceFromMedia returned null. Try fewer clips or sequence.create + clip.overwrite.",
        );
        e.code = "PREMIERE_API_ERROR";
        throw e;
      }
      return sequenceSummary(sequence);
    } catch (err) {
      throw apiError("sequence.createFromMedia", err);
    }
  },

  "sequence.getTimebase": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const settings = typeof sequence.getSettings === "function" ? await sequence.getSettings() : null;
      let endTicks;
      try {
        // Some builds expose getEnd / getPlayerPosition range helpers.
        if (typeof sequence.getEnd === "function") {
          endTicks = String((await sequence.getEnd()).ticks);
        } else if (sequence.end) {
          endTicks = String(sequence.end.ticks ?? sequence.end);
        }
      } catch {
        endTicks = undefined;
      }
      return { settings, endTicks, name: sequence.name, sequenceId: sequenceIdOf(sequence) };
    } catch (err) {
      throw apiError("sequence.getTimebase", err);
    }
  },
};
