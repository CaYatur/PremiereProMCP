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
  getTrackCount,
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

function invalidParams(message) {
  const e = new Error(message);
  e.code = "INVALID_PARAMS";
  return e;
}

/** Start/end on the timeline and in/out in the source, as BigInt ticks. */
async function itemTimes(item) {
  return {
    start: BigInt((await item.getStartTime()).ticks),
    end: BigInt((await item.getEndTime()).ticks),
    in: BigInt((await item.getInPoint()).ticks),
    out: BigInt((await item.getOutPoint()).ticks),
  };
}

/** Length of the source media in ticks, or null when it can't be read
 * (in/out points are measured from the media start, so this is the
 * largest valid out-point). Best effort: the check is skipped when null. */
async function mediaDurationTicks(item) {
  try {
    const clip = ppro.ClipProjectItem.cast(await item.getProjectItem());
    const media = await clip.getMedia();
    const ticks = BigInt((await media.getDuration()).ticks);
    return ticks > 0n ? ticks : null;
  } catch {
    return null;
  }
}

/** Throw INVALID_PARAMS when extending `item`'s out-point to `newOut` would
 * run past the end of its media. */
async function requireTailHandle(item, newOut, what) {
  const dur = await mediaDurationTicks(item);
  if (dur !== null && newOut > dur) {
    throw invalidParams(`${what} would move a source out-point to ${newOut}, past the end of the media (${dur}).`);
  }
}

/** The slip/split arithmetic below maps source ticks 1:1 to timeline ticks. */
function requireUnitSpeed(t, what) {
  if (t.out - t.in !== t.end - t.start) {
    throw invalidParams(`${what} is not supported on speed-changed clips (source and timeline lengths differ).`);
  }
}

/** Items on the other media type at exactly the same time from the same
 * project item: the video/audio halves Premiere links when a clip is
 * added. The UXP API has no link query, so they are matched by position. */
async function findLinkedPartners(sequence, item, trackType) {
  const otherType = trackType === "audio" ? "video" : "audio";
  const t = await itemTimes(item);
  let pid;
  try {
    pid = await (await item.getProjectItem()).getId();
  } catch {
    return [];
  }
  const partners = [];
  const count = await getTrackCount(sequence, otherType);
  for (let ti = 0; ti < count; ti++) {
    const track = await getTrack(sequence, otherType, ti);
    for (const other of await getTrackItems(track)) {
      try {
        const o = await itemTimes(other);
        if (o.start !== t.start || o.end !== t.end) continue;
        if ((await (await other.getProjectItem()).getId()) !== pid) continue;
        partners.push({ item: other, trackType: otherType, trackIndex: ti });
      } catch {
        /* not a clip with a project item */
      }
    }
  }
  return partners;
}

/** The edits that slip a clip with source in/out t.in/t.out by `delta`
 * ticks without changing its place on the timeline. The TrackItem in/out
 * setters trim (the start/end move with them), so each step trims one edge
 * inward, moves the clip back by the delta (createMoveAction is relative),
 * then extends the other edge: the clip never leaves its own footprint, so
 * neighbours are never touched. A step can't trim the whole clip away, so
 * large deltas are done in steps of half the clip length. */
function slipSteps(item, t, delta) {
  const len = t.out - t.in;
  const maxStep = len / 2n > 0n ? len / 2n : 1n;
  const steps = [];
  let inP = t.in;
  let outP = t.out;
  let remaining = delta;
  while (remaining !== 0n) {
    const mag = remaining < 0n ? -remaining : remaining;
    const step = mag < maxStep ? mag : maxStep;
    const d = remaining < 0n ? -step : step;
    const trimIn = { item, edit: "in", ticks: inP + d };
    const move = { item, edit: "move", ticks: -d };
    const trimOut = { item, edit: "out", ticks: outP + d };
    steps.push(...(d > 0n ? [trimIn, move, trimOut] : [trimOut, move, trimIn]));
    inP += d;
    outP += d;
    remaining -= d;
  }
  return steps;
}

/** Apply timeline edits ({item, edit: start|end|in|out|move, ticks}) one
 * transaction each, in order. Live on 26.5, several time edits in ONE
 * transaction are each validated against the state before the transaction
 * (a move that is only valid after the preceding trim fails with "Invalid
 * parameter", and the earlier edits stay applied), so they can't be
 * batched; the price is one undo step per edit. */
async function runEditsInOrder(project, label, edits) {
  for (const e of edits) {
    await runTransaction(project, `${label} (${e.edit})`, (c) => {
      // Actions must be created inside lockedAccess (required since Premiere 26.3).
      const time = tickTime(String(e.ticks));
      if (e.edit === "start") c.addAction(e.item.createSetStartAction(time));
      else if (e.edit === "end") c.addAction(e.item.createSetEndAction(time));
      else if (e.edit === "in") c.addAction(e.item.createSetInPointAction(time));
      else if (e.edit === "out") c.addAction(e.item.createSetOutPointAction(time));
      else c.addAction(e.item.createMoveAction(time));
    });
  }
}

/** Find the item on `trackType`/`trackIndex` that starts at `startTicks`
 * and isn't `exclude` (used to pick up a freshly cloned item). */
async function findItemStartingAt(sequence, trackType, trackIndex, startTicks, exclude) {
  const items = await getTrackItems(await getTrack(sequence, trackType, trackIndex));
  for (const it of items) {
    if (it === exclude) continue;
    if (BigInt((await it.getStartTime()).ticks) === startTicks) return it;
  }
  return null;
}

/** Razor one track item at `cut`. There is no split action in the UXP API,
 * so: trim the item to one side of the cut, clone it with an overwrite edit
 * into the space that freed (the clone is never longer than that space),
 * then extend and slip the clone so it holds the other side's source. */
async function splitOne(project, sequence, editor, ref, cut) {
  const { item, trackType, trackIndex } = ref;
  const t = await itemTimes(item);
  const left = cut - t.start;
  const right = t.end - cut;
  if (left <= right) {
    await runTransaction(project, "PPMCP clip_split trim", (c) => {
      c.addAction(item.createSetEndAction(tickTime(String(cut))));
    });
    await runTransaction(project, "PPMCP clip_split clone", (c) => {
      c.addAction(editor.createCloneTrackItemAction(item, tickTime(String(left)), 0, 0, trackType === "video", false));
    });
    const clone = await findItemStartingAt(sequence, trackType, trackIndex, cut, item);
    if (!clone) throw new Error(`Cloned the ${trackType} item but could not find the clone at ${cut}.`);
    await runEditsInOrder(project, "PPMCP clip_split fit", [
      { item: clone, edit: "end", ticks: t.end },
      ...slipSteps(clone, { in: t.in, out: t.in + right }, left),
    ]);
  } else {
    await runTransaction(project, "PPMCP clip_split trim", (c) => {
      c.addAction(item.createSetStartAction(tickTime(String(cut))));
    });
    await runTransaction(project, "PPMCP clip_split clone", (c) => {
      c.addAction(editor.createCloneTrackItemAction(item, tickTime(String(-left)), 0, 0, trackType === "video", false));
    });
    const clone = await findItemStartingAt(sequence, trackType, trackIndex, t.start, item);
    if (!clone) throw new Error(`Cloned the ${trackType} item but could not find the clone at ${t.start}.`);
    await runEditsInOrder(project, "PPMCP clip_split fit", [
      ...slipSteps(clone, { in: t.in + left, out: t.out }, -left),
      { item: clone, edit: "end", ticks: cut },
    ]);
  }
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
      await runTransaction(project, "PPMCP clip_move", (c) => {
        // Created inside lockedAccess (required since Premiere 26.3).
        const action = item.createMoveAction(tickTime(String(delta)));
        c.addAction(action);
      });
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
      const editor = await getEditor(sequence);
      const cut = BigInt(atTicks);
      const start = BigInt((await item.getStartTime()).ticks);
      const end = BigInt((await item.getEndTime()).ticks);
      if (cut <= start || cut >= end) {
        throw invalidParams(`Split time ${atTicks} is outside clip range (${start}, ${end}).`);
      }
      if (typeof editor.createCloneTrackItemAction !== "function") {
        throw new Error("No clip split primitive (createCloneTrackItemAction unavailable). Cannot razor-cut on this build.");
      }
      // Split the linked audio/video halves too, like the razor tool.
      const partners = await findLinkedPartners(sequence, item, trackType);
      const targets = [{ item, trackType, trackIndex }, ...partners];
      for (const ref of targets) requireUnitSpeed(await itemTimes(ref.item), "clip_split");
      for (const ref of targets) await splitOne(project, sequence, editor, ref, cut);
      return { split: true, atTicks, via: "trim+clone", linkedSplit: partners.length };
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
      const a = await itemTimes(earlier);
      const b = await itemTimes(later);
      if (a.end !== b.start) {
        throw invalidParams(`clip_roll needs adjacent clips; clip ${clipIndex} ends at ${a.end} but the next one starts at ${b.start}.`);
      }
      const cut = a.end + delta;
      if (cut <= a.start || cut >= b.end) {
        throw invalidParams(`Roll by ${delta} ticks would move the cut outside the two clips (${a.start}, ${b.end}).`);
      }
      if (b.in + delta < 0n) {
        throw invalidParams(`Roll by ${delta} ticks needs ${-delta} ticks of handle before the next clip's in-point, which has only ${b.in}.`);
      }
      if (delta > 0n) await requireTailHandle(earlier, a.out + delta, `Roll by ${delta} ticks`);
      // Shorten one side before lengthening the other so they never overlap.
      const shortenLater = { item: later, edit: "start", ticks: cut };
      const extendEarlier = { item: earlier, edit: "end", ticks: cut };
      await runEditsInOrder(
        project,
        "PPMCP clip_roll",
        delta > 0n ? [shortenLater, extendEarlier] : [extendEarlier, shortenLater],
      );
      return { rolled: true, newCutTicks: cut.toString() };
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
      const t = await itemTimes(item);
      const newIn = t.in + delta;
      const newOut = t.out + delta;
      if (delta === 0n) return { slipped: false, reason: "deltaTicks is 0", inPointTicks: String(t.in), outPointTicks: String(t.out) };
      if (newIn < 0n) {
        throw invalidParams(
          `Slip by ${delta} ticks would move the source in-point before the start of the media (current in-point ${t.in}). Use a smaller backward delta.`,
        );
      }
      requireUnitSpeed(t, "clip_slip");
      await requireTailHandle(item, newOut, `Slip by ${delta} ticks`);
      await runEditsInOrder(project, "PPMCP clip_slip", slipSteps(item, t, delta));
      return { slipped: true, inPointTicks: String(newIn), outPointTicks: String(newOut) };
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
      const p = await itemTimes(prev);
      const t = await itemTimes(item);
      const n = await itemTimes(next);
      if (p.end !== t.start || t.end !== n.start) {
        throw invalidParams("clip_slide needs the clip to touch both neighbours (no gaps on either side).");
      }
      const newStart = t.start + delta;
      const newEnd = t.end + delta;
      if (newStart <= p.start || newEnd >= n.end) {
        throw invalidParams(`Slide by ${delta} ticks would swallow a neighbouring clip.`);
      }
      if (n.in + delta < 0n) {
        throw invalidParams(`Slide by ${delta} ticks needs ${-delta} ticks of handle before the next clip's in-point, which has only ${n.in}.`);
      }
      if (delta > 0n) await requireTailHandle(prev, p.out + delta, `Slide by ${delta} ticks`);
      // TrackItem#createMoveAction takes a relative offset, not a time.
      // Shorten the neighbour on the side we move towards first.
      const prevEdit = { item: prev, edit: "end", ticks: newStart };
      const move = { item, edit: "move", ticks: delta };
      const nextEdit = { item: next, edit: "start", ticks: newEnd };
      await runEditsInOrder(project, "PPMCP clip_slide", delta < 0n ? [prevEdit, move, nextEdit] : [nextEdit, move, prevEdit]);
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
      // The linked audio/video half has to go too: left behind, it holds the
      // gap open and nothing ripples.
      const partners = await findLinkedPartners(sequence, item, trackType);
      for (const p of partners) selection.addItem(p.item);
      // Confirmed enum (@adobe/premierepro): ppro.Constants.MediaType —
      // {ANY, DATA, VIDEO, AUDIO} — not the raw 1/2 this file guessed first.
      const mediaType = partners.length
        ? ppro.Constants.MediaType.ANY
        : trackType === "audio"
          ? ppro.Constants.MediaType.AUDIO
          : ppro.Constants.MediaType.VIDEO;
      await runTransaction(project, "PPMCP clip_ripple_delete", (c) => {
        // Created inside lockedAccess (required since Premiere 26.3).
        const action = editor.createRemoveItemsAction(selection, true, mediaType);
        c.addAction(action);
      });
      return { deleted: true, rippled: true, linkedDeleted: partners.length };
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
      await runTransaction(project, "PPMCP clip_lift", (c) => {
        // Created inside lockedAccess (required since Premiere 26.3).
        const action = editor.createRemoveItemsAction(selection, false, mediaType);
        c.addAction(action);
      });
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
      let factory;
      if (typeof item.createSetSpeedAction === "function") {
        factory = "createSetSpeedAction";
      } else if (typeof item.createSetPlaybackSpeedAction === "function") {
        factory = "createSetPlaybackSpeedAction";
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
      await runTransaction(project, "PPMCP clip_set_speed", (c) => {
        // Created inside lockedAccess (required since Premiere 26.3).
        const action =
          factory === "createSetSpeedAction"
            ? item.createSetSpeedAction(rate, !!reverse, !!maintainPitch, !!rippleEdit)
            : item.createSetPlaybackSpeedAction(rate, !!reverse, !!maintainPitch, !!rippleEdit);
        c.addAction(action);
      });
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
      await runTransaction(project, "PPMCP clip_set_enabled", (c) => {
        // Created inside lockedAccess (required since Premiere 26.3).
        const action = item.createSetDisabledAction(!enabled);
        c.addAction(action);
      });
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
          await runTransaction(project, "PPMCP clip_rename", (c) => {
            // Created inside lockedAccess (required since Premiere 26.3).
            const action = item.createSetNameAction(name);
            if (!action) throw new Error("createSetNameAction returned null");
            c.addAction(action);
          });
          return { name, via: "createSetNameAction" };
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
