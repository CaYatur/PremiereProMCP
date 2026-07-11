// Clip editing — the "edit quality core". Every mutation goes through
// project.executeTransaction() + CompoundAction.addAction(), the composed-
// editing pattern confirmed live in the Phase 0 spike
// (spike/diagnostic-plugin/index.js). Insert/overwrite/remove route
// through SequenceEditor (ppro.SequenceEditor.getEditor(sequence)); move
// and trim/roll/slip/slide route through the TrackItem itself
// (createMoveAction/createSetStartAction/createSetEndAction/
// createSetInPointAction/createSetOutPointAction) — confirmed against
// @adobe/premierepro v26.3.0's official type declarations 2026-07-10 after
// live-testing revealed this file's first draft had the wrong owner
// (SequenceEditor vs TrackItem) and wrong argument shapes (Track objects
// vs plain video/audio track-index numbers) for several of these.

const {
  apiError,
  ppro,
  getActiveProject,
  getSequence,
  getEditor,
  getTrack,
  getTrackItems,
  getClip,
  getClipName,
  tickTime,
  runTransaction,
  findProjectItemById,
} = require("../ppro.js");

async function clipSummary(item, index) {
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };
  const start = item.getStartTime ? await item.getStartTime() : undefined;
  const end = item.getEndTime ? await item.getEndTime() : undefined;
  let projectItemId;
  try {
    if (item.getProjectItem) {
      const pi = await item.getProjectItem();
      projectItemId = pi && pi.getId ? await pi.getId() : undefined;
    }
  } catch {
    projectItemId = undefined;
  }
  return {
    clipIndex: index,
    name: await getClipName(item),
    startTicks: start ? String(start.ticks) : undefined,
    endTicks: end ? String(end.ticks) : undefined,
    durationTicks:
      start && end ? String(BigInt(end.ticks) - BigInt(start.ticks)) : undefined,
    inPointTicks: item.getInPoint ? String((await safe(() => item.getInPoint()))?.ticks ?? "") || undefined : undefined,
    outPointTicks: item.getOutPoint ? String((await safe(() => item.getOutPoint()))?.ticks ?? "") || undefined : undefined,
    speed: item.getSpeed ? await safe(() => item.getSpeed()) : undefined,
    disabled: item.isDisabled ? await safe(() => item.isDisabled()) : undefined,
    selected: item.getIsSelected ? await safe(() => item.getIsSelected()) : undefined,
    trackIndex: item.getTrackIndex ? await safe(() => item.getTrackIndex()) : undefined,
    projectItemId,
    mediaType: item.mediaType,
  };
}

/** Confirmed (@adobe/premierepro): TrackItemSelection has no constructor —
 * only obtainable via sequence.getSelection(), mutated with addItem()/
 * removeItem() (no clear()). Build a single-item selection by emptying
 * the current selection then adding our target. */
async function buildSingleItemSelection(sequence, item) {
  const selection = await sequence.getSelection();
  const existing = await selection.getTrackItems();
  for (const existingItem of existing) {
    selection.removeItem(existingItem);
  }
  selection.addItem(item);
  return selection;
}

/** Shared by clip.insert and clip.append: try raw ProjectItem +
 * ClipProjectItem.cast, multiple limitShift/audio-index combos, then an
 * overwrite fallback. Action created INSIDE transaction. Confirmed live
 * to succeed via one of these variants on builds where a naive single
 * -attempt createInsertProjectItemAction call fails outright. */
async function insertProjectItemWithRetry({
  project,
  editor,
  projectItem,
  castItem,
  time,
  videoTrackIndex,
  audioTrackIndex,
  label,
}) {
  const errors = [];
  const itemVariants = [
    { label: "cast", item: castItem },
    { label: "raw", item: projectItem },
  ];
  const combos = [
    { limitShift: true, aIdx: audioTrackIndex },
    { limitShift: false, aIdx: audioTrackIndex },
    { limitShift: true, aIdx: 0 },
    { limitShift: true, aIdx: -1 },
    { limitShift: false, aIdx: -1 },
  ];
  for (const variant of itemVariants) {
    for (const c of combos) {
      try {
        runTransaction(project, `PPMCP ${label} ${variant.label} lim=${c.limitShift} a=${c.aIdx}`, (compoundAction) => {
          const action = editor.createInsertProjectItemAction(variant.item, time, videoTrackIndex, c.aIdx, c.limitShift);
          if (!action) throw new Error("createInsertProjectItemAction returned null");
          const ok = compoundAction.addAction(action);
          if (ok === false) throw new Error("addAction returned false");
        });
        return {
          inserted: true,
          via: `insert-${variant.label}`,
          limitShift: c.limitShift,
          videoTrackIndex,
          audioTrackIndex: c.aIdx,
        };
      } catch (err) {
        errors.push(`${variant.label}/lim=${c.limitShift}/a=${c.aIdx}: ${err && err.message ? err.message : err}`);
      }
    }
  }
  // Soft fallback: overwrite often works when insert is blocked on a build
  try {
    runTransaction(project, `PPMCP ${label}->overwrite fallback`, (compoundAction) => {
      const action = editor.createOverwriteItemAction(castItem, time, videoTrackIndex, audioTrackIndex);
      if (!action) throw new Error("overwrite null");
      compoundAction.addAction(action);
    });
    return {
      inserted: true,
      via: "overwrite-fallback",
      note: "createInsertProjectItemAction failed on this build; used overwrite instead (may cover existing media).",
      videoTrackIndex,
      audioTrackIndex,
      attempts: errors.slice(0, 6),
    };
  } catch (err) {
    errors.push(`overwrite-fallback: ${err && err.message ? err.message : err}`);
  }
  return { inserted: false, errors };
}

async function castProjectItem(projectItem) {
  try {
    if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
      return ppro.ClipProjectItem.cast(projectItem) || projectItem;
    }
  } catch {
    /* fall through */
  }
  return projectItem;
}

function timeFromTicks(atTicks) {
  try {
    if ((!atTicks || atTicks === "0") && ppro.TickTime.TIME_ZERO) return ppro.TickTime.TIME_ZERO;
    if (ppro.TickTime.createWithSeconds) {
      return ppro.TickTime.createWithSeconds(Number(BigInt(atTicks)) / 254016000000);
    }
  } catch {
    /* fall through */
  }
  return tickTime(atTicks || "0");
}

module.exports = {
  "clip.list": async ({ sequenceId, trackType, trackIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    const items = await getTrackItems(track);
    return Promise.all(items.map((it, i) => clipSummary(it, i)));
  },

  "clip.getProperties": async ({ sequenceId, trackType, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    return clipSummary(item, clipIndex);
  },

  "clip.insert": async ({ sequenceId, trackType, trackIndex, projectItemId, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    await getTrack(sequence, trackType, trackIndex);
    const projectItem = await findProjectItemById(project, projectItemId);
    const castItem = await castProjectItem(projectItem);
    const editor = await getEditor(sequence);
    const videoTrackIndex = trackType === "video" ? trackIndex : 0;
    const audioTrackIndex = trackType === "audio" ? trackIndex : trackIndex;
    const time = timeFromTicks(atTicks);

    const result = await insertProjectItemWithRetry({
      project,
      editor,
      projectItem,
      castItem,
      time,
      videoTrackIndex,
      audioTrackIndex,
      label: "clip_insert",
    });
    if (result.inserted) return result;
    throw apiError(
      "clip.insert",
      new Error(`${result.errors.slice(0, 8).join(" ;; ")}. Workaround: sequence_create_from_media.`),
    );
  },

  "clip.overwrite": async ({ sequenceId, trackType, trackIndex, projectItemId, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    await getTrack(sequence, trackType, trackIndex);
    const projectItem = await findProjectItemById(project, projectItemId);
    let castItem = projectItem;
    try {
      if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
        castItem = ppro.ClipProjectItem.cast(projectItem) || projectItem;
      }
    } catch {
      castItem = projectItem;
    }
    const editor = await getEditor(sequence);
    const videoTrackIndex = trackType === "video" ? trackIndex : 0;
    const audioTrackIndex = trackType === "audio" ? trackIndex : trackIndex;
    let time;
    try {
      if ((!atTicks || atTicks === "0") && ppro.TickTime.TIME_ZERO) time = ppro.TickTime.TIME_ZERO;
      else if (ppro.TickTime.createWithSeconds) {
        time = ppro.TickTime.createWithSeconds(Number(BigInt(atTicks)) / 254016000000);
      } else time = tickTime(atTicks);
    } catch {
      time = tickTime(atTicks || "0");
    }
    const errors = [];
    const items = [
      { label: "cast", item: castItem },
      { label: "raw", item: projectItem },
    ];
    for (const variant of items) {
      for (const aIdx of [audioTrackIndex, 1, 0, -1]) {
        try {
          runTransaction(project, `PPMCP clip_overwrite ${variant.label} a=${aIdx}`, (compoundAction) => {
            const action = editor.createOverwriteItemAction(variant.item, time, videoTrackIndex, aIdx);
            if (!action) throw new Error("createOverwriteItemAction returned null");
            const ok = compoundAction.addAction(action);
            if (ok === false) throw new Error("addAction returned false");
          });
          return {
            overwritten: true,
            via: variant.label,
            videoTrackIndex,
            audioTrackIndex: aIdx,
          };
        } catch (err) {
          errors.push(`${variant.label}/a=${aIdx}: ${err && err.message ? err.message : err}`);
        }
      }
    }
    throw apiError(
      "clip.overwrite",
      new Error(`${errors.join(" ;; ")}. Workaround: sequence_create_from_media.`),
    );
  },

  "clip.move": async ({ sequenceId, trackType, trackIndex, clipIndex, newStartTicks, newTrackIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    if (newTrackIndex !== undefined) {
      const e = new Error(
        "clip_move cannot change track in this version — TrackItem move is time-only. Use clip_lift + clip_insert on the target track instead.",
      );
      e.code = "INVALID_PARAMS";
      throw e;
    }
    // Prefer absolute reposition via createSetStartAction + createSetEndAction
    // (preserves duration). createMoveAction's TickTime is treated as a delta
    // offset (live: "move to 0" was a no-op after a prior move).
    try {
      const start = BigInt((await item.getStartTime()).ticks);
      const end = BigInt((await item.getEndTime()).ticks);
      const duration = end - start;
      const newStart = BigInt(newStartTicks);
      const newEnd = newStart + duration;
      if (typeof item.createSetStartAction === "function" && typeof item.createSetEndAction === "function") {
        await runTransaction(project, "PPMCP clip_move", (c) => {
          c.addAction(item.createSetStartAction(tickTime(String(newStart))));
          c.addAction(item.createSetEndAction(tickTime(String(newEnd))));
        });
        return { moved: true, newStartTicks, via: "setStart/setEnd" };
      }
      const delta = newStart - start;
      const action = item.createMoveAction(tickTime(String(delta)));
      await runTransaction(project, "PPMCP clip_move", (c) => c.addAction(action));
      return { moved: true, newStartTicks, via: "createMoveAction delta" };
    } catch (err) {
      throw apiError("clip.move", err);
    }
  },

  "clip.split": async ({ sequenceId, trackType, trackIndex, clipIndex, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      // No createSplitAction on TrackItem (live). Compose with
      // SequenceEditor.createCloneTrackItemAction: clone the right half via
      // insert offset, then trim the original's end to the cut point.
      const editor = await getEditor(sequence);
      const cut = BigInt(atTicks);
      const start = BigInt((await item.getStartTime()).ticks);
      const end = BigInt((await item.getEndTime()).ticks);
      if (cut <= start || cut >= end) {
        const e = new Error(`Split time ${atTicks} is outside clip range [${start}, ${end}).`);
        e.code = "INVALID_PARAMS";
        throw e;
      }
      if (typeof editor.createCloneTrackItemAction !== "function") {
        throw new Error(
          "No clip split primitive (createSplitAction missing; createCloneTrackItemAction unavailable). Cannot razor-cut on this build.",
        );
      }
      // Clone with zero vertical offset, time offset = cut - start, isInsert=false (overwrite-style).
      // Signature: (trackItem, timeOffset, videoTrackVerticalOffset, audioTrackVerticalOffset, alignToVideo, isInsert)
      const timeOffset = tickTime(String(cut - start));
      const cloneAction = editor.createCloneTrackItemAction(item, timeOffset, 0, 0, true, true);
      await runTransaction(project, "PPMCP clip_split clone", (c) => c.addAction(cloneAction));
      // Re-fetch original (indices may shift) and trim its end to cut.
      const { items } = await getClip(sequence, trackType, trackIndex, clipIndex);
      const original = items[clipIndex];
      if (original && typeof original.createSetEndAction === "function") {
        await runTransaction(project, "PPMCP clip_split trim", (c) => {
          c.addAction(original.createSetEndAction(tickTime(String(cut))));
        });
      }
      return { split: true, atTicks, via: "clone+trim" };
    } catch (err) {
      throw apiError("clip.split", err);
    }
  },

  "clip.trim": async ({ sequenceId, trackType, trackIndex, clipIndex, edge, newTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      // Timeline edge trim via setStart/setEnd. If that fails (live: "Script
      // action failed" on some media), try source in/out points instead.
      const useStart = edge === "in";
      if (useStart && typeof item.createSetStartAction === "function") {
        try {
          await runTransaction(project, "PPMCP clip_trim start", (c) => {
            c.addAction(item.createSetStartAction(tickTime(newTicks)));
          });
          return { trimmed: true, edge, via: "setStart" };
        } catch {
          /* try in-point */
        }
      }
      if (!useStart && typeof item.createSetEndAction === "function") {
        try {
          await runTransaction(project, "PPMCP clip_trim end", (c) => {
            c.addAction(item.createSetEndAction(tickTime(newTicks)));
          });
          return { trimmed: true, edge, via: "setEnd" };
        } catch {
          /* try out-point */
        }
      }
      if (useStart && typeof item.createSetInPointAction === "function") {
        await runTransaction(project, "PPMCP clip_trim inPoint", (c) => {
          c.addAction(item.createSetInPointAction(tickTime(newTicks)));
        });
        return { trimmed: true, edge, via: "setInPoint" };
      }
      if (!useStart && typeof item.createSetOutPointAction === "function") {
        await runTransaction(project, "PPMCP clip_trim outPoint", (c) => {
          c.addAction(item.createSetOutPointAction(tickTime(newTicks)));
        });
        return { trimmed: true, edge, via: "setOutPoint" };
      }
      throw new Error("No working trim action on this track item.");
    } catch (err) {
      throw apiError("clip.trim", err);
    }
  },

  "clip.roll": async ({ sequenceId, trackType, trackIndex, clipIndex, deltaTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { items } = await getClip(sequence, trackType, trackIndex, clipIndex);
    const earlier = items[clipIndex];
    const later = items[clipIndex + 1];
    if (!later) {
      const e = new Error(`Clip at index ${clipIndex} has no following clip on the same track to roll against.`);
      e.code = "INVALID_PARAMS";
      throw e;
    }
    try {
      const delta = BigInt(deltaTicks);
      const earlierEnd = (await earlier.getEndTime()).ticks;
      const newCut = (BigInt(earlierEnd) + delta).toString();
      const actionA = earlier.createSetEndAction(tickTime(newCut));
      const actionB = later.createSetStartAction(tickTime(newCut));
      await runTransaction(project, "PPMCP clip_roll", (c) => {
        c.addAction(actionA);
        c.addAction(actionB);
      });
      return { rolled: true, newCutTicks: newCut };
    } catch (err) {
      throw apiError("clip.roll", err);
    }
  },

  "clip.slip": async ({ sequenceId, trackType, trackIndex, clipIndex, deltaTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      const delta = BigInt(deltaTicks);
      const inTicks = (await item.getInPoint()).ticks;
      const outTicks = (await item.getOutPoint()).ticks;
      const newIn = (BigInt(inTicks) + delta).toString();
      const newOut = (BigInt(outTicks) + delta).toString();
      const actionA = item.createSetInPointAction(tickTime(newIn));
      const actionB = item.createSetOutPointAction(tickTime(newOut));
      await runTransaction(project, "PPMCP clip_slip", (c) => {
        c.addAction(actionA);
        c.addAction(actionB);
      });
      return { slipped: true };
    } catch (err) {
      throw apiError("clip.slip", err);
    }
  },

  "clip.slide": async ({ sequenceId, trackType, trackIndex, clipIndex, deltaTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { items } = await getClip(sequence, trackType, trackIndex, clipIndex);
    const prev = items[clipIndex - 1];
    const item = items[clipIndex];
    const next = items[clipIndex + 1];
    if (!prev || !next) {
      const e = new Error("clip_slide requires both a previous and a next clip on the same track.");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    try {
      const delta = BigInt(deltaTicks);
      const itemNewStart = (BigInt((await item.getStartTime()).ticks) + delta).toString();
      const itemNewEnd = (BigInt((await item.getEndTime()).ticks) + delta).toString();
      // Confirmed signature: TrackItem#createMoveAction(tickTime) — on the
      // item itself, not SequenceEditor (this file's original wrong guess).
      const moveAction = item.createMoveAction(tickTime(itemNewStart));
      const prevTrimAction = prev.createSetEndAction(tickTime(itemNewStart));
      const nextTrimAction = next.createSetStartAction(tickTime(itemNewEnd));
      await runTransaction(project, "PPMCP clip_slide", (c) => {
        c.addAction(prevTrimAction);
        c.addAction(moveAction);
        c.addAction(nextTrimAction);
      });
      return { slid: true };
    } catch (err) {
      throw apiError("clip.slide", err);
    }
  },

  "clip.rippleDelete": async ({ sequenceId, trackType, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      const editor = await getEditor(sequence);
      const selection = await buildSingleItemSelection(sequence, item);
      // Confirmed enum (@adobe/premierepro): ppro.Constants.MediaType —
      // {ANY, DATA, VIDEO, AUDIO} — not the raw 1/2 this file guessed first.
      const mediaType = trackType === "audio" ? ppro.Constants.MediaType.AUDIO : ppro.Constants.MediaType.VIDEO;
      const action = editor.createRemoveItemsAction(selection, true, mediaType);
      await runTransaction(project, "PPMCP clip_ripple_delete", (c) => c.addAction(action));
      return { deleted: true, rippled: true };
    } catch (err) {
      throw apiError("clip.rippleDelete", err);
    }
  },

  "clip.lift": async ({ sequenceId, trackType, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      const editor = await getEditor(sequence);
      const selection = await buildSingleItemSelection(sequence, item);
      const mediaType = trackType === "audio" ? ppro.Constants.MediaType.AUDIO : ppro.Constants.MediaType.VIDEO;
      const action = editor.createRemoveItemsAction(selection, false, mediaType);
      await runTransaction(project, "PPMCP clip_lift", (c) => c.addAction(action));
      return { deleted: true, rippled: false };
    } catch (err) {
      throw apiError("clip.lift", err);
    }
  },

  "clip.setSpeed": async ({ sequenceId, trackType, trackIndex, clipIndex, speedPercent, reverse, maintainPitch, rippleEdit }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      // Live: createSetSpeedAction is NOT a function on VideoClipTrackItem in
      // this build. Try alternate names; fail loud with guidance if none work.
      const rate = speedPercent / 100;
      let action;
      if (typeof item.createSetSpeedAction === "function") {
        action = item.createSetSpeedAction(rate, !!reverse, !!maintainPitch, !!rippleEdit);
      } else if (typeof item.createSetPlaybackSpeedAction === "function") {
        action = item.createSetPlaybackSpeedAction(rate, !!reverse, !!maintainPitch, !!rippleEdit);
      } else if (typeof item.setSpeed === "function") {
        await item.setSpeed(rate, !!reverse, !!maintainPitch, !!rippleEdit);
        return { speedPercent, reverse: !!reverse, via: "setSpeed" };
      } else {
        const e = new Error(
          "Speed change is not available on this Premiere UXP build (no createSetSpeedAction/setSpeed on TrackItem). Time-remapping via effects is not implemented.",
        );
        e.code = "PREMIERE_API_ERROR";
        throw e;
      }
      await runTransaction(project, "PPMCP clip_set_speed", (c) => c.addAction(action));
      return { speedPercent, reverse: !!reverse };
    } catch (err) {
      throw apiError("clip.setSpeed", err);
    }
  },

  "clip.setEnabled": async ({ sequenceId, trackType, trackIndex, clipIndex, enabled }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      if (typeof item.createSetDisabledAction !== "function") {
        throw new Error("createSetDisabledAction is not available on this track item.");
      }
      // API takes "disabled" — invert enabled.
      const action = item.createSetDisabledAction(!enabled);
      await runTransaction(project, "PPMCP clip_set_enabled", (c) => c.addAction(action));
      return { enabled: !!enabled };
    } catch (err) {
      throw apiError("clip.setEnabled", err);
    }
  },

  "clip.rename": async ({ sequenceId, trackType, trackIndex, clipIndex, name }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType, trackIndex, clipIndex);
    try {
      // createSetNameAction exists on VideoClipTrackItem docs but can throw
      // "Script action failed to execute" at addAction time on some builds
      // (same class of failure as marker_add). Try action first, then direct.
      if (typeof item.createSetNameAction === "function") {
        try {
          const action = item.createSetNameAction(name);
          if (action) {
            await runTransaction(project, "PPMCP clip_rename", (c) => c.addAction(action));
            return { name, via: "createSetNameAction" };
          }
        } catch {
          /* try fallbacks */
        }
      }
      if (typeof item.setName === "function") {
        await item.setName(name);
        return { name, via: "setName" };
      }
      // Project-item rename is a different surface (bin name), not timeline name.
      const e = new Error(
        "Could not rename timeline clip — createSetNameAction failed and no setName() fallback. Use project_rename_item to rename the source media in the bin.",
      );
      e.code = "PREMIERE_API_ERROR";
      throw e;
    } catch (err) {
      throw apiError("clip.rename", err);
    }
  },

  "clip.append": async ({ sequenceId, trackType, trackIndex, projectItemId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType, trackIndex);
    const items = await getTrackItems(track);
    let atTicks = "0";
    if (items.length) {
      const last = items[items.length - 1];
      atTicks = String((await last.getEndTime()).ticks);
    }
    const projectItem = await findProjectItemById(project, projectItemId);
    const castItem = await castProjectItem(projectItem);
    const editor = await getEditor(sequence);
    const videoTrackIndex = trackType === "video" ? trackIndex : 0;
    const audioTrackIndex = trackType === "audio" ? trackIndex : trackIndex;
    const time = timeFromTicks(atTicks);

    const result = await insertProjectItemWithRetry({
      project,
      editor,
      projectItem,
      castItem,
      time,
      videoTrackIndex,
      audioTrackIndex,
      label: "clip_append",
    });
    if (result.inserted) return { ...result, appended: true, atTicks };
    throw apiError("clip.append", new Error(result.errors.slice(0, 8).join(" ;; ")));
  },
};
