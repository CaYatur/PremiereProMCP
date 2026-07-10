// Confirmed against @adobe/premierepro v26.3.0's official type declarations:
// Sequence#getPlayerPosition/setPlayerPosition (playhead) and
// Sequence#getSelection/setSelection + TrackItemSelection#addItem/
// removeItem/getTrackItems (timeline selection). VideoClipTrackItem#
// getIsSelected/getTrackIndex used to re-resolve selected items to stable
// {trackType, trackIndex, clipIndex} refs. Not yet individually live-tested —
// same "fails loudly" contract as the rest of the plugin.
const {
  apiError,
  ppro,
  getActiveProject,
  getSequence,
  getTrack,
  getTrackItems,
  getTrackCount,
  getClipName,
  tickTime,
} = require("../ppro.js");

/** Walk every track and collect clips whose getIsSelected() is true, with
 * stable clip refs so batch/analyze tools can target them. */
async function listSelectedClipRefs(sequence) {
  const result = [];
  for (const trackType of ["video", "audio"]) {
    const count = await getTrackCount(sequence, trackType);
    for (let trackIndex = 0; trackIndex < count; trackIndex++) {
      const track = await getTrack(sequence, trackType, trackIndex);
      const items = await getTrackItems(track);
      for (let clipIndex = 0; clipIndex < items.length; clipIndex++) {
        const item = items[clipIndex];
        let selected = false;
        try {
          selected = item.getIsSelected ? await item.getIsSelected() : false;
        } catch {
          selected = false;
        }
        if (!selected) continue;
        result.push({
          trackType,
          trackIndex,
          clipIndex,
          name: await getClipName(item),
          startTicks: item.getStartTime ? String((await item.getStartTime()).ticks) : undefined,
          endTicks: item.getEndTime ? String((await item.getEndTime()).ticks) : undefined,
        });
      }
    }
  }
  return result;
}

/** Adobe tick clock: 254016000000 ticks = 1 second. Sequence.getTimebase()
 * returns ticks-per-frame (string). */
const TICKS_PER_SECOND = 254016000000n;

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
  // Fallback 24fps
  return TICKS_PER_SECOND / 24n;
}

function ticksToFrame(ticks, tpf) {
  return Number(BigInt(String(ticks)) / tpf);
}

function frameToTicks(frame, tpf) {
  const f = Math.max(0, Math.floor(Number(frame)));
  return String(BigInt(f) * tpf);
}

module.exports = {
  "playhead.get": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const pos = await sequence.getPlayerPosition();
      const ticks = String(pos.ticks);
      const ticksPerFrame = await resolveTicksPerFrame(sequence);
      const frame = ticksToFrame(ticks, ticksPerFrame);
      const seconds = Number(BigInt(ticks)) / Number(TICKS_PER_SECOND);
      const fps = Number(TICKS_PER_SECOND) / Number(ticksPerFrame);
      return {
        ticks,
        frame,
        seconds,
        ticksPerFrame: String(ticksPerFrame),
        fps: Math.round(fps * 1000) / 1000,
      };
    } catch (err) {
      throw apiError("playhead.get", err);
    }
  },

  "playhead.set": async ({ sequenceId, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      await sequence.setPlayerPosition(tickTime(atTicks));
      const ticksPerFrame = await resolveTicksPerFrame(sequence);
      return {
        atTicks,
        frame: ticksToFrame(atTicks, ticksPerFrame),
        ticksPerFrame: String(ticksPerFrame),
      };
    } catch (err) {
      throw apiError("playhead.set", err);
    }
  },

  /** Go to an absolute frame number (0-based). */
  "playhead.setFrame": async ({ sequenceId, frame }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const ticksPerFrame = await resolveTicksPerFrame(sequence);
      const atTicks = frameToTicks(frame, ticksPerFrame);
      await sequence.setPlayerPosition(tickTime(atTicks));
      return {
        atTicks,
        frame: Math.max(0, Math.floor(Number(frame))),
        ticksPerFrame: String(ticksPerFrame),
      };
    } catch (err) {
      throw apiError("playhead.setFrame", err);
    }
  },

  /** Step playhead by N frames (negative = backward). */
  "playhead.stepFrames": async ({ sequenceId, deltaFrames }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const ticksPerFrame = await resolveTicksPerFrame(sequence);
      const pos = await sequence.getPlayerPosition();
      const cur = BigInt(String(pos.ticks));
      const delta = BigInt(Math.trunc(Number(deltaFrames) || 0)) * ticksPerFrame;
      let next = cur + delta;
      if (next < 0n) next = 0n;
      const atTicks = String(next);
      await sequence.setPlayerPosition(tickTime(atTicks));
      return {
        atTicks,
        frame: ticksToFrame(atTicks, ticksPerFrame),
        deltaFrames: Math.trunc(Number(deltaFrames) || 0),
        ticksPerFrame: String(ticksPerFrame),
      };
    } catch (err) {
      throw apiError("playhead.stepFrames", err);
    }
  },

  "selection.get": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      // Prefer getIsSelected walk (gives trackType/trackIndex/clipIndex).
      // Fall back to selection.getTrackItems() if that yields nothing but the
      // selection collection is non-empty (some item types may lack getIsSelected).
      const fromWalk = await listSelectedClipRefs(sequence);
      if (fromWalk.length > 0) return fromWalk;

      const selection = await sequence.getSelection();
      const items = await selection.getTrackItems();
      return Promise.all(
        items.map(async (item) => {
          let trackIndex;
          try {
            trackIndex = item.getTrackIndex ? await item.getTrackIndex() : undefined;
          } catch {
            trackIndex = undefined;
          }
          return {
            trackType: undefined,
            trackIndex,
            clipIndex: undefined,
            name: await getClipName(item),
            startTicks: item.getStartTime ? String((await item.getStartTime()).ticks) : undefined,
            endTicks: item.getEndTime ? String((await item.getEndTime()).ticks) : undefined,
          };
        }),
      );
    } catch (err) {
      throw apiError("selection.get", err);
    }
  },

  "selection.set": async ({ sequenceId, clips }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const selection = await sequence.getSelection();
      const existing = await selection.getTrackItems();
      for (const item of existing) selection.removeItem(item);
      for (const ref of clips) {
        const track = await getTrack(sequence, ref.trackType, ref.trackIndex);
        const items = await getTrackItems(track);
        const item = items[ref.clipIndex];
        if (item) selection.addItem(item);
      }
      sequence.setSelection(selection);
      return { selected: clips.length };
    } catch (err) {
      throw apiError("selection.set", err);
    }
  },

  "selection.clear": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const selection = await sequence.getSelection();
      const existing = await selection.getTrackItems();
      for (const item of existing) selection.removeItem(item);
      sequence.setSelection(selection);
      return { cleared: true };
    } catch (err) {
      throw apiError("selection.clear", err);
    }
  },

  "app.getVersion": async () => {
    // Confirmed live (docs/PLAN.md §3 Phase 0 probe): ppro.Application.version
    // resolved to `undefined` in one probe session — still the documented
    // property; surface whatever we get and let the model see it.
    try {
      const version = ppro.Application && ppro.Application.version !== undefined
        ? await Promise.resolve(ppro.Application.version)
        : undefined;
      return { version: version ?? null };
    } catch (err) {
      throw apiError("app.getVersion", err);
    }
  },
};
