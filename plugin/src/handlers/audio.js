/**
 * Audio handlers — live-probed scale (2026-07-11):
 *
 * Premiere UXP Volume > Level is a LINEAR 0..1 control mapped to the clip
 * rubber-band, whose TOP is about **+15 dB** (not 0 dB).
 *
 *   linear 0.0  → silence (−∞ dB)
 *   linear ~0.178 → **0 dB unity**   (10^((0-15)/20))
 *   linear 1.0  → **+15 dB** (rubber-band max)
 *
 * Public MCP API still uses **decibels** for agents:
 *   decibels: 0  → unity (default)
 *   decibels: -6 → quieter
 *   decibels: +6..+15 → louder (model may boost; clamp +15)
 *
 * Do NOT force Channel Volume L/R to 1 — that was stacking extra gain.
 */
const {
  apiError,
  ppro,
  getActiveProject,
  getSequence,
  getTrack,
  getTrackItems,
  getComponents,
  getComponentDisplayName,
  getComponentParams,
  setParamValue,
  tickTime,
  runTransaction,
} = require("../ppro.js");

/** Rubber-band top in dB (Premiere clip volume line max). */
const LEVEL_MAX_DB = 15;

async function getItem({ sequenceId, trackIndex, clipIndex }) {
  const project = await getActiveProject();
  const sequence = await getSequence(project, sequenceId);
  const track = await getTrack(sequence, "audio", trackIndex);
  const items = await getTrackItems(track);
  const item = items[clipIndex];
  if (!item) {
    const e = new Error(`No clip at index ${clipIndex} on audio track ${trackIndex}.`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return { project, item };
}

/** Deep-unwrap Premiere keyframe / param values ({value:{value:n}} etc.). */
function unwrapParamValue(v, depth = 0) {
  if (depth > 5) return v;
  if (v && typeof v === "object" && "value" in v) return unwrapParamValue(v.value, depth + 1);
  return v;
}

/**
 * Agent dB → Premiere Level linear 0..1.
 * 0 dB → ~0.1778, +15 dB → 1.0, −∞ → 0.
 */
function dbToLinear(db) {
  if (!Number.isFinite(db)) db = 0;
  const clampedDb = Math.max(-96, Math.min(LEVEL_MAX_DB, db));
  const lin = Math.pow(10, (clampedDb - LEVEL_MAX_DB) / 20);
  return Math.max(0, Math.min(1, lin));
}

/** Premiere Level linear → agent dB. */
function linearToDb(lin) {
  const n = Number(unwrapParamValue(lin));
  if (!Number.isFinite(n) || n <= 1e-12) return -100;
  return 20 * Math.log10(n) + LEVEL_MAX_DB;
}

async function findVolumeComponents(item) {
  const { components } = await getComponents(item);
  let volume = null;
  let channelVolume = null;
  for (const comp of components) {
    const name = await getComponentDisplayName(comp);
    if (name === "Volume") volume = comp;
    if (name === "Channel Volume") channelVolume = comp;
  }
  return { volume, channelVolume };
}

async function findParam(comp, displayName) {
  if (!comp) return undefined;
  const params = await getComponentParams(comp);
  return params.find((p) => p.displayName === displayName);
}

async function readParamNumeric(param) {
  if (!param) return undefined;
  try {
    if (typeof param.getStartValue === "function") {
      return unwrapParamValue(await param.getStartValue());
    }
  } catch {
    /* */
  }
  try {
    if (typeof param.getValueAtTime === "function") {
      const z = ppro.TickTime && ppro.TickTime.TIME_ZERO ? ppro.TickTime.TIME_ZERO : tickTime("0");
      return unwrapParamValue(await param.getValueAtTime(z));
    }
  } catch {
    /* */
  }
  return undefined;
}

async function clearTimeVarying(project, param, label) {
  if (!param || typeof param.createSetTimeVaryingAction !== "function") return;
  try {
    runTransaction(project, label, (c) => {
      const tv = param.createSetTimeVaryingAction(false);
      if (tv) c.addAction(tv);
    });
  } catch {
    /* optional */
  }
}

/**
 * Set Volume > Level from agent dB. Unmute only. Leave Channel Volume alone.
 */
async function applyLevelFromDb(project, item, db) {
  const linear = dbToLinear(db);
  const { volume } = await findVolumeComponents(item);
  if (!volume) {
    const e = new Error("Could not find Volume component on this audio clip.");
    e.code = "NOT_FOUND";
    throw e;
  }
  const level = await findParam(volume, "Level");
  const muteP = await findParam(volume, "Mute");
  if (!level) {
    const e = new Error('Could not find Volume/"Level" on this clip.');
    e.code = "NOT_FOUND";
    throw e;
  }

  await clearTimeVarying(project, level, "PPMCP audio Level timeVarying=false");
  await setParamValue(project, level, linear, "PPMCP audio_set_gain Level");

  if (muteP) {
    try {
      await clearTimeVarying(project, muteP, "PPMCP audio Mute tv=false");
      await setParamValue(project, muteP, 0, "PPMCP audio unmute");
    } catch {
      try {
        await setParamValue(project, muteP, false, "PPMCP audio unmute bool");
      } catch {
        /* */
      }
    }
  }

  try {
    if (typeof item.setMute === "function") await item.setMute(false);
  } catch {
    /* */
  }

  const readLinear = await readParamNumeric(level);
  const readDb = linearToDb(readLinear);
  const unityOk = Math.abs(readDb - db) < 1.5 || (db === 0 && Math.abs(readDb) < 1.5);
  return { linear, readLinear, readDb, unityOk };
}

module.exports = {
  "audio.setGain": async (params) => {
    const { project, item } = await getItem(params);
    const raw = params.decibels;
    const db =
      raw === undefined || raw === null || raw === ""
        ? 0
        : Number(raw);
    if (!Number.isFinite(db)) {
      const e = new Error("audio.setGain requires numeric decibels (0 = unity, negative quieter, max +15).");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    // Agent range: −48 .. +15 (rubber-band max). Default 0 = unity.
    const clampedDb = Math.max(-48, Math.min(LEVEL_MAX_DB, db));
    const result = await applyLevelFromDb(project, item, clampedDb);
    return {
      decibels: clampedDb,
      requested: db,
      linear: result.linear,
      readLinear: result.readLinear,
      readDb: result.readDb,
      unityOk: result.unityOk,
      note: `Level linear ${result.linear.toFixed(4)} ≈ ${clampedDb} dB (0 dB unity; +15 dB = linear 1.0 max). Channel Volume not modified.`,
    };
  },

  "audio.getGain": async (params) => {
    const { item } = await getItem(params);
    const { volume } = await findVolumeComponents(item);
    const level = volume ? await findParam(volume, "Level") : undefined;
    if (!level) throw apiError("audio.getGain", new Error('Could not find a Volume/"Level" component param on this clip.'));
    const linear = await readParamNumeric(level);
    const db = linearToDb(linear);
    let muted;
    try {
      if (typeof item.isMuted === "function") muted = await item.isMuted();
      else if (typeof item.getMute === "function") muted = await item.getMute();
    } catch {
      /* */
    }
    return {
      linear,
      decibels: db,
      value: linear,
      via: "getStartValue",
      muted,
      note: "linear 0..1 → dB via 20*log10(lin)+15. 0 dB unity ≈ linear 0.178; +15 dB = linear 1.",
    };
  },

  "audio.addVolumeKeyframe": async (params) => {
    const { project, item } = await getItem(params);
    const { volume } = await findVolumeComponents(item);
    const level = volume ? await findParam(volume, "Level") : undefined;
    if (!level) throw apiError("audio.addVolumeKeyframe", new Error('Could not find a Volume/"Level" component param on this clip.'));
    try {
      const raw = Number(params.decibels);
      const db = Number.isFinite(raw) ? Math.max(-48, Math.min(LEVEL_MAX_DB, raw)) : 0;
      const linear = dbToLinear(db);
      if (typeof level.createSetTimeVaryingAction === "function") {
        try {
          runTransaction(project, "PPMCP audio Level timeVarying=true", (c) => {
            const tv = level.createSetTimeVaryingAction(true);
            if (tv) c.addAction(tv);
          });
        } catch {
          /* */
        }
      }
      const keyframe = level.createKeyframe(linear, tickTime(params.atTicks));
      const action = level.createAddKeyframeAction(keyframe);
      runTransaction(project, "PPMCP audio_add_volume_keyframe", (c) => c.addAction(action));
      return { set: true, decibels: db, linear };
    } catch (err) {
      throw apiError("audio.addVolumeKeyframe", err);
    }
  },

  "audio.setMute": async (params) => {
    const { project, item } = await getItem(params);
    try {
      await item.setMute(params.muted);
      if (params.muted === false) {
        try {
          const { volume } = await findVolumeComponents(item);
          const muteP = volume ? await findParam(volume, "Mute") : undefined;
          if (muteP) await setParamValue(project, muteP, 0, "PPMCP audio setMute param");
        } catch {
          /* */
        }
      }
      return { muted: params.muted };
    } catch (err) {
      throw apiError("audio.setMute", err);
    }
  },

  "audio.addEffect": async (params) => {
    const { project, item } = await getItem(params);
    try {
      const displayName = params.displayName || params.matchName;
      if (!displayName) {
        const e = new Error("audio.addEffect requires displayName (or matchName used as display name).");
        e.code = "INVALID_PARAMS";
        throw e;
      }
      const component = await ppro.AudioFilterFactory.createComponentByDisplayName(displayName, item);
      if (!component) {
        throw new Error(`AudioFilterFactory.createComponentByDisplayName("${displayName}") returned null.`);
      }
      const { chain } = await getComponents(item);
      const action = chain.createAppendComponentAction(component);
      if (!action) throw new Error("createAppendComponentAction returned null/undefined.");
      runTransaction(project, "PPMCP audio_add_effect", (c) => c.addAction(action));
      return { added: true, displayName };
    } catch (err) {
      throw apiError("audio.addEffect", err);
    }
  },

  "audio.normalize": async (params) => {
    const { project, item } = await getItem(params);
    const raw = params.targetDb !== undefined && params.targetDb !== null ? Number(params.targetDb) : 0;
    const targetDb = Number.isFinite(raw) ? Math.max(-48, Math.min(LEVEL_MAX_DB, raw)) : 0;
    const result = await applyLevelFromDb(project, item, targetDb);
    return {
      approximated: true,
      targetDb,
      linear: result.linear,
      readLinear: result.readLinear,
      readDb: result.readDb,
      note: "0 dB unity ≈ linear 0.178. Not LUFS normalize.",
    };
  },
};
