// Thin helpers around the host-provided `premierepro` UXP module.
//
// CONFIDENCE NOTE: calls marked "confirmed live" were literally exercised
// against a running Premiere Pro 2026 in the Phase 0 spike
// (spike/diagnostic-plugin/index.js, docs/PLAN.md §3) — trust their exact
// shape (method vs property, argument order where shown). Calls marked
// "type-declaration only" come from @adobe/premierepro's official .d.ts but
// were not individually exercised live; they fail loudly via apiError
// rather than silently, so Task #8's live smoke test is expected to need to
// correct some of these in place.

const ppro = require("premierepro");

// Passed as the first argument to Track#getTrackItems — this literal value
// is what the live spike used successfully; the named constant it
// corresponds to (likely a TrackItemType/MediaType enum) was not identified
// in the desk-research pass. Confirmed live, exact meaning unconfirmed.
const TRACK_ITEM_TYPE_CLIP = 1;

function apiError(context, err) {
  const e = new Error(`${context}: ${err && err.message ? err.message : String(err)}`);
  e.code = "PREMIERE_API_ERROR";
  return e;
}

// --- Confirmed live ---------------------------------------------------

async function getActiveProject() {
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    const e = new Error("No project is currently open in Premiere Pro.");
    e.code = "NO_ACTIVE_PROJECT";
    throw e;
  }
  return project;
}

async function getSequence(project, sequenceId) {
  if (sequenceId) {
    const sequences = await project.getSequences();
    const match = sequences.find((s) => sequenceIdOf(s) === sequenceId);
    if (!match) {
      const e = new Error(`No sequence with id "${sequenceId}" in the active project.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    return match;
  }
  const active = await project.getActiveSequence();
  if (!active) {
    const e = new Error("No active sequence. Create one with sequence_create or open one with sequence_set_active.");
    e.code = "NO_ACTIVE_SEQUENCE";
    throw e;
  }
  return active;
}

// Live-confirmed 2026-07-10: sequence.sequenceID exists but is NOT a plain
// string — it's an object (likely a Guid wrapper) that JSON.stringify
// serializes to "{}" (no own enumerable properties reach JSON.stringify,
// and/or the real value needs .toString()). Coerce explicitly here, before
// this crosses the relay as JSON, and fall back to the always-string
// sequence.name (confirmed live via project.name) if that coercion
// produces nothing useful.
function sequenceIdOf(sequence) {
  const raw = sequence.sequenceID ?? sequence.guid;
  if (typeof raw === "string" && raw) return raw;
  if (raw !== undefined && raw !== null) {
    try {
      const s = String(raw);
      if (s && s !== "[object Object]") return s;
    } catch {
      /* fall through to name */
    }
  }
  return sequence.name;
}

async function getEditor(sequence) {
  // Confirmed live: ppro.SequenceEditor.getEditor(sequence).
  return ppro.SequenceEditor.getEditor(sequence);
}

async function getTrackCount(sequence, trackType) {
  // Both confirmed live.
  return trackType === "audio" ? sequence.getAudioTrackCount() : sequence.getVideoTrackCount();
}

async function getTrack(sequence, trackType, trackIndex) {
  // getVideoTrack(i) confirmed live. getAudioTrack(i) inferred by naming
  // symmetry with the confirmed getAudioTrackCount() — not itself literally
  // exercised live yet.
  const track = trackType === "audio" ? await sequence.getAudioTrack(trackIndex) : await sequence.getVideoTrack(trackIndex);
  if (!track) {
    const e = new Error(`No ${trackType} track at index ${trackIndex}.`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return track;
}

async function getTrackItems(track) {
  // Confirmed live shape: track.getTrackItems(1, false).
  return track.getTrackItems(TRACK_ITEM_TYPE_CLIP, false);
}

async function getClip(sequence, trackType, trackIndex, clipIndex) {
  const track = await getTrack(sequence, trackType, trackIndex);
  const items = await getTrackItems(track);
  const item = items[clipIndex];
  if (!item) {
    const e = new Error(`No clip at index ${clipIndex} on ${trackType} track ${trackIndex} (track has ${items.length} clip(s)).`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return { track, item, items };
}

async function getClipName(item) {
  // Confirmed live: trackItem.getName() is a METHOD, not a .name property.
  return item.getName();
}

async function getComponents(item) {
  // Confirmed live: getComponentChain() -> getComponentCount() +
  // getComponentAtIndex(i).
  const chain = await item.getComponentChain();
  const count = await chain.getComponentCount();
  const components = [];
  for (let i = 0; i < count; i++) {
    components.push(await chain.getComponentAtIndex(i));
  }
  return { chain, components };
}

async function getComponentDisplayName(component) {
  // Confirmed live: component.getDisplayName() is a METHOD.
  return component.getDisplayName();
}

async function getComponentParams(component) {
  // Confirmed live: getParamCount() + getParam(i).
  const count = await component.getParamCount();
  const params = [];
  for (let i = 0; i < count; i++) {
    params.push(await component.getParam(i));
  }
  return params;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findParamByLabelOnce(item, label) {
  const { components } = await getComponents(item);
  for (const comp of components) {
    const params = await getComponentParams(comp);
    for (const p of params) {
      if (p.displayName === label) return p;
    }
  }
  return undefined;
}

/** Find a param by displayName (a confirmed-live PROPERTY on param, unlike
 * component's getDisplayName() method), searching every component on the
 * clip. Used both for generic effects and for our own MOGRT master
 * properties (Position/Size/Color/Text label).
 *
 * Live-confirmed 2026-07-10: immediately after insertMogrtFromPath()
 * resolves, a MOGRT's "Graphic Parameters" component (which carries our
 * Text/Position/Color/Size master properties) is sometimes not yet present
 * in getComponentChain() — a re-query moments later finds it fine. Retries
 * with a short backoff rather than failing on the first miss, since this
 * is specifically an insert-then-immediately-configure race, not a real
 * absence. */
async function findParamByLabel(item, label, { retries = 5, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const found = await findParamByLabelOnce(item, label);
    if (found) return found;
    if (attempt < retries) await sleep(delayMs);
  }
  return undefined;
}

async function findComponentByDisplayName(item, name) {
  const { components } = await getComponents(item);
  for (const comp of components) {
    if ((await getComponentDisplayName(comp)) === name) return comp;
  }
  return undefined;
}

/**
 * Adobe official sample pattern (sequenceEditor.ts / markers.ts):
 *
 *   project.lockedAccess(() => {
 *     success = project.executeTransaction((compoundAction) => {
 *       const action = factory.create…Action(…);  // CREATE INSIDE callback
 *       compoundAction.addAction(action);
 *     }, "undo name");
 *   });
 *
 * Critical details we previously got wrong:
 * 1) Always wrap in lockedAccess
 * 2) Create the Action *inside* the executeTransaction callback — creating
 *    it outside then addAction() often throws "Script action failed to execute"
 * 3) executeTransaction is sync and returns boolean in Adobe samples
 *
 * buildActions(compoundAction) should CREATE and addAction inside.
 */
function runTransaction(project, description, buildActions) {
  let execResult;
  let lastErr;
  const run = () =>
    project.executeTransaction((compoundAction) => {
      buildActions(compoundAction);
    }, description);

  try {
    if (typeof project.lockedAccess === "function") {
      project.lockedAccess(() => {
        try {
          execResult = run();
        } catch (e) {
          lastErr = e;
        }
      });
    } else {
      execResult = run();
    }
  } catch (err) {
    throw apiError(`executeTransaction(${description})`, err);
  }
  if (lastErr) throw apiError(`executeTransaction(${description})`, lastErr);

  if (execResult && typeof execResult.then === "function") {
    return execResult.then((r) => {
      if (r === false) {
        throw apiError(
          `executeTransaction(${description})`,
          new Error("executeTransaction returned false"),
        );
      }
      return r;
    });
  }
  if (execResult === false) {
    throw apiError(
      `executeTransaction(${description})`,
      new Error("executeTransaction returned false"),
    );
  }
  return execResult;
}

/** Adobe keyframe sample: createKeyframe(value) then
 * createSetValueAction(keyframe, true) inside lockedAccess transaction.
 * Second arg inSafeForPlayback=true matches official keyframe.ts sample. */
async function setParamValue(project, param, value, description) {
  // Adobe keyframe.ts: setTimeVarying(false), then createKeyframe + setValue
  // inside lockedAccess/executeTransaction. Create keyframe can stay outside
  // (it's not an Action); Action factories should run inside the callback.
  try {
    if (typeof param.createSetTimeVaryingAction === "function") {
      runTransaction(project, `${description} (timeVarying=false)`, (c) => {
        const tv = param.createSetTimeVaryingAction(false);
        if (tv) c.addAction(tv);
      });
    }
  } catch {
    /* optional */
  }

  let keyframe;
  try {
    keyframe = param.createKeyframe(value);
  } catch (err) {
    throw apiError(`${description} (createKeyframe)`, err);
  }
  try {
    runTransaction(project, description, (c) => {
      let action;
      try {
        action = param.createSetValueAction(keyframe, true);
      } catch {
        action = param.createSetValueAction(keyframe);
      }
      if (!action) throw new Error("createSetValueAction returned null");
      c.addAction(action);
    });
  } catch (err) {
    throw apiError(`${description} (setValue)`, err);
  }
}

// --- Type-declaration only (docs/PLAN.md §3) — not yet individually live-tested ---

function tickTime(ticksString) {
  return ppro.TickTime.createWithTicks(String(ticksString));
}

/** Shared by clip.js (clip_insert/overwrite) and media.js (proxy/multicam
 * tools, which operate on a ProjectItem directly rather than a track
 * clip). Confirmed (@adobe/premierepro type declarations): getId() is a
 * method, not a .nodeId property — live-confirmed wrong 2026-07-10. */
async function findProjectItemById(project, projectItemId) {
  async function search(bin) {
    const children = await bin.getItems();
    for (const child of children) {
      if ((await child.getId()) === projectItemId) return child;
      if (typeof child.getItems === "function") {
        const found = await search(child).catch(() => undefined);
        if (found) return found;
      }
    }
    return undefined;
  }
  const root = await project.getRootItem();
  const found = await search(root);
  if (!found) {
    const e = new Error(`No project item with id "${projectItemId}". Use project_list_items to find valid ids.`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return found;
}

module.exports = {
  ppro,
  apiError,
  TRACK_ITEM_TYPE_CLIP,
  getActiveProject,
  getSequence,
  sequenceIdOf,
  getEditor,
  getTrackCount,
  getTrack,
  getTrackItems,
  getClip,
  getClipName,
  getComponents,
  getComponentDisplayName,
  getComponentParams,
  findParamByLabel,
  findComponentByDisplayName,
  runTransaction,
  setParamValue,
  tickTime,
  findProjectItemById,
};
