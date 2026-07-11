const { apiError, getActiveProject, getSequence, getTrack, getTrackCount, getTrackItems, runTransaction } = require("../ppro.js");

async function trackSummary(track, trackType, index) {
  let clipCount = 0;
  try {
    clipCount = (await getTrackItems(track)).length;
  } catch {
    clipCount = -1; // enumeration not confirmed for this track type yet
  }
  return {
    trackType,
    trackIndex: index,
    name: track.name,
    muted: track.isMuted ? await track.isMuted() : undefined,
    locked: track.isLocked ? await track.isLocked() : undefined,
    clipCount,
  };
}

module.exports = {
  "track.list": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const videoCount = await getTrackCount(sequence, "video");
    const audioCount = await getTrackCount(sequence, "audio");
    const result = [];
    for (let i = 0; i < videoCount; i++) result.push(await trackSummary(await getTrack(sequence, "video", i), "video", i));
    for (let i = 0; i < audioCount; i++) result.push(await trackSummary(await getTrack(sequence, "audio", i), "audio", i));
    return result;
  },

  "track.add": async ({ sequenceId, trackType }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      // CONFIRMED PLATFORM LIMITATION (verified 2026-07-11 against Adobe's
      // official ppro_reference): the UXP API exposes NO method to add an
      // empty track. Neither the Sequence class nor SequenceEditor has any
      // addTrack / addVideoTrack / addAudioTrack / createAddTrackAction — this
      // is missing from Premiere itself, not a PPMCP bug, and cannot be fixed
      // plugin-side. We still feature-detect (a future Premiere release could
      // add one of these), so this becomes a no-op that "just works" the day
      // Adobe ships it — but today it falls through to a clear error.
      const { getEditor, getTrackCount } = require("../ppro.js");
      let editor = null;
      try {
        editor = await getEditor(sequence);
      } catch {
        editor = null;
      }
      const count = await getTrackCount(sequence, trackType);
      if (editor && typeof editor.createAddTrackAction === "function") {
        const action = editor.createAddTrackAction(trackType, count);
        await runTransaction(project, "PPMCP track_add", (c) => c.addAction(action));
        return { added: true, trackType, via: "createAddTrackAction", trackIndex: count };
      }
      if (typeof sequence.addTrack === "function") {
        await sequence.addTrack(trackType);
        return { added: true, trackType, via: "sequence.addTrack" };
      }
      const e = new Error(
        `Adding a ${trackType} track is not supported by the Premiere UXP API on any current build ` +
          `(no addTrack/addVideoTrack/addAudioTrack/createAddTrackAction exists on Sequence or SequenceEditor — ` +
          `a confirmed Adobe platform limitation, not a plugin bug). ` +
          `The track count is fixed when the sequence is created and CANNOT be increased afterward: ` +
          `inserting a clip past the existing track count does NOT auto-create a track either — it fails with ` +
          `"[INTERNAL_ERROR] BE: An invalid track index was passed to the sequence" (tested 2026-07-11). ` +
          `Only fix: choose the track count at creation (sequence_create, or a sequence preset that already has enough tracks).`,
      );
      e.code = "PREMIERE_API_ERROR";
      throw e;
    } catch (err) {
      throw apiError("track.add", err);
    }
  },

  "track.delete": async ({ sequenceId, trackType, trackIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    try {
      if (typeof sequence.removeVideoTrack === "function" || typeof sequence.removeAudioTrack === "function") {
        if (trackType === "audio") await sequence.removeAudioTrack(track);
        else await sequence.removeVideoTrack(track);
        return { deleted: true };
      }
      const { getEditor } = require("../ppro.js");
      const editor = await getEditor(sequence);
      if (typeof editor.createRemoveTrackAction === "function") {
        const action = editor.createRemoveTrackAction(track);
        await runTransaction(project, "PPMCP track_delete", (c) => c.addAction(action));
        return { deleted: true, via: "createRemoveTrackAction" };
      }
      const e = new Error("No UXP method to delete a track on this Premiere build.");
      e.code = "PREMIERE_API_ERROR";
      throw e;
    } catch (err) {
      throw apiError("track.delete", err);
    }
  },

  "track.setMute": async ({ sequenceId, trackType, trackIndex, muted }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    try {
      await track.setMute(muted);
      return { muted };
    } catch (err) {
      throw apiError("track.setMute", err);
    }
  },

  "track.setLock": async ({ sequenceId, trackType, trackIndex, locked }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    try {
      await track.setLocked(locked);
      return { locked };
    } catch (err) {
      throw apiError("track.setLock", err);
    }
  },

  "track.setOutputEnabled": async ({ sequenceId, trackType, trackIndex, enabled }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    try {
      await track.setOutputEnabled(enabled);
      return { enabled };
    } catch (err) {
      throw apiError("track.setOutputEnabled", err);
    }
  },

  "track.rename": async ({ sequenceId, trackType, trackIndex, name }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    try {
      // Prefer createSetNameAction (26.3+). Fall back to setName / writable .name
      // when the action factory is missing on this build.
      if (typeof track.createSetNameAction === "function") {
        const action = track.createSetNameAction(name);
        if (action) {
          await runTransaction(project, "PPMCP track_rename", (c) => c.addAction(action));
          return { name, via: "createSetNameAction" };
        }
      }
      if (typeof track.setName === "function") {
        await track.setName(name);
        return { name, via: "setName" };
      }
      try {
        track.name = name;
        if (track.name === name) return { name, via: "name property" };
      } catch {
        /* fall through */
      }
      const e = new Error(
        "No working track rename path on this Premiere build (createSetNameAction/setName/name all unavailable or read-only).",
      );
      e.code = "PREMIERE_API_ERROR";
      throw e;
    } catch (err) {
      throw apiError("track.rename", err);
    }
  },

  "track.getItems": async ({ sequenceId, trackType, trackIndex }) => {
    // Alias of clip.list — kept for FEATURES.md naming symmetry.
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    const items = await getTrackItems(track);
    const { getClipName } = require("../ppro.js");
    return Promise.all(
      items.map(async (it, i) => ({
        clipIndex: i,
        name: await getClipName(it),
        startTicks: it.getStartTime ? String((await it.getStartTime()).ticks) : undefined,
        endTicks: it.getEndTime ? String((await it.getEndTime()).ticks) : undefined,
      })),
    );
  },
};
