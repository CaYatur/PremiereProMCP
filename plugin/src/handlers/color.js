// Lumetri Color's real matchName is confirmed live: "AE.ADBE Lumetri"
// (docs/PLAN.md §3 live probe, among 105 enumerated video filters). There
// is no dedicated Lumetri API — it's applied/parameterized through the
// same generic effect-component mechanism as any other effect.

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
  runTransaction,
  readParamValue,
  coerceToParamType,
  adjustParamValue,
} = require("../ppro.js");

const LUMETRI_MATCH_NAME = "AE.ADBE Lumetri";

// Slider limits of Lumetri's numeric controls, used to clamp relative
// adjustments (color_adjust, issue #4). The UXP API exposes no param range;
// these were measured live on Premiere 26.5.1 by writing out-of-range values
// and reading back what Premiere kept (the hard limits, wider than the
// sliders: Temperature ±300 vs ±100 on screen). Same-named params in
// Creative / HSL Secondary share the limits. "Intensity" differs per section
// (0–100 / 0–200), so it is left to Premiere's own clamp.
const LUMETRI_RANGES = {
  Temperature: { min: -300, max: 300 },
  Tint: { min: -300, max: 300 },
  Saturation: { min: 0, max: 300 },
  Exposure: { min: -7, max: 7 },
  Contrast: { min: -150, max: 150 },
  Highlights: { min: -150, max: 150 },
  Shadows: { min: -150, max: 150 },
  Whites: { min: -150, max: 150 },
  Blacks: { min: -150, max: 150 },
  "Faded Film": { min: 0, max: 150 },
  Sharpen: { min: -100, max: 100 },
  Vibrance: { min: -100, max: 100 },
  "Tint Balance": { min: -150, max: 150 },
  Amount: { min: -5, max: 5 },
  Midpoint: { min: 0, max: 100 },
  Roundness: { min: -100, max: 100 },
  Feather: { min: 0, max: 100 },
};

/** Index of the first numeric Lumetri param called `name` (the Basic
 * Correction one when the name repeats in Creative/Curves), or -1. */
async function findNumericParam(compParams, name) {
  for (let i = 0; i < compParams.length; i++) {
    if (compParams[i].displayName !== name) continue;
    if ((await readParamValue(compParams[i])).valueType === "number") return i;
  }
  return -1;
}

async function getItem({ sequenceId, trackIndex, clipIndex }) {
  const project = await getActiveProject();
  const sequence = await getSequence(project, sequenceId);
  const track = await getTrack(sequence, "video", trackIndex);
  const items = await getTrackItems(track);
  const item = items[clipIndex];
  if (!item) {
    const e = new Error(`No clip at index ${clipIndex} on video track ${trackIndex}.`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return { project, item };
}

async function findLumetriComponent(item) {
  const { components } = await getComponents(item);
  for (const comp of components) {
    const name = await getComponentDisplayName(comp);
    if (name === "Lumetri Color" || name === LUMETRI_MATCH_NAME) return comp;
  }
  return undefined;
}

module.exports = {
  "color.applyLumetri": async (params) => {
    const { project, item } = await getItem(params);
    const existing = await findLumetriComponent(item);
    if (existing) return { applied: true, alreadyPresent: true };
    try {
      // createAppendComponentAction wants a Component, not a matchName string
      // (live smoke 2026-07-10: string → "Illegal Parameter type").
      const component = await ppro.VideoFilterFactory.createComponent(LUMETRI_MATCH_NAME);
      if (!component) throw new Error(`VideoFilterFactory.createComponent("${LUMETRI_MATCH_NAME}") returned null.`);
      const { chain } = await getComponents(item);
      runTransaction(project, "PPMCP color_apply_lumetri", (c) => {
        const action = chain.createAppendComponentAction(component);
        if (!action) throw new Error("createAppendComponentAction returned null/undefined.");
        c.addAction(action);
      });
      return { applied: true, alreadyPresent: false };
    } catch (err) {
      throw apiError("color.applyLumetri", err);
    }
  },

  "color.setParam": async (params) => {
    const { project, item } = await getItem(params);
    const comp = await findLumetriComponent(item);
    if (!comp) {
      const e = new Error("Lumetri Color is not applied to this clip. Call color_apply_lumetri first.");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    const compParams = await getComponentParams(comp);
    const candidates = compParams.filter((p) => p.displayName === params.paramName);
    if (!candidates.length) {
      const e = new Error(`No Lumetri parameter "${params.paramName}" found. Use color_get_params to see available names.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    // Lumetri repeats names across tabs; first same-named param that accepts
    // a value of its own type wins (issue #2).
    const failures = [];
    for (const param of candidates) {
      try {
        const { valueType } = await readParamValue(param);
        const value = coerceToParamType(valueType, params.value);
        param.createKeyframe(value); // type dry-run, no mutation
        await setParamValue(project, param, value, "PPMCP color_set_param");
        return { set: true, paramIndex: compParams.indexOf(param) };
      } catch (err) {
        failures.push(err && err.message ? err.message : String(err));
      }
    }
    throw apiError("color.setParam", new Error(`"${params.paramName}": ${failures.join(" ;; ")}`));
  },

  // Relative adjustment (issue #4): add a delta to each named Lumetri param's
  // current value instead of overwriting it. Keys are display names, or
  // "#<paramIndex>" to pick one of several same-named params.
  "color.adjust": async (params) => {
    const { project, item } = await getItem(params);
    const comp = await findLumetriComponent(item);
    if (!comp) {
      const e = new Error("Lumetri Color is not applied to this clip. Call color_apply_lumetri first.");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    const deltas = params.deltas && typeof params.deltas === "object" ? params.deltas : {};
    const keys = Object.keys(deltas);
    if (!keys.length) {
      const e = new Error('color.adjust needs deltas, e.g. { "Exposure": 0.3, "Saturation": -10 }.');
      e.code = "INVALID_PARAMS";
      throw e;
    }
    const compParams = await getComponentParams(comp);
    const results = [];
    for (const key of keys) {
      const delta = Number(deltas[key]);
      const byIndex = /^#(\d+)$/.exec(key);
      const index = byIndex ? Number(byIndex[1]) : await findNumericParam(compParams, key);
      const param = compParams[index];
      if (!Number.isFinite(delta)) {
        results.push({ param: key, ok: false, error: "delta is not a number" });
        continue;
      }
      if (!param) {
        results.push({ param: key, ok: false, error: `No numeric Lumetri param "${key}". See color_get_params.` });
        continue;
      }
      const name = param.displayName;
      try {
        const r = await adjustParamValue(project, param, delta, {
          ...(LUMETRI_RANGES[name] || {}),
          label: `PPMCP color_adjust ${name}`,
        });
        results.push({ param: key, paramName: name, paramIndex: index, ok: true, delta, ...r });
      } catch (err) {
        results.push({ param: key, paramName: name, paramIndex: index, ok: false, error: err && err.message ? err.message : String(err) });
      }
    }
    return { adjusted: results.filter((r) => r.ok).length, results };
  },

  "color.getParams": async (params) => {
    const { item } = await getItem(params);
    const comp = await findLumetriComponent(item);
    if (!comp) return { applied: false, params: [] };
    const compParams = await getComponentParams(comp);
    const out = [];
    for (let i = 0; i < compParams.length; i++) {
      const { value, valueType, keyframed } = await readParamValue(compParams[i]);
      out.push({ paramIndex: i, displayName: compParams[i].displayName, value, valueType, keyframed });
    }
    return { applied: true, params: out };
  },

  "color.applyLut": async (params) => {
    const { project, item } = await getItem(params);
    const comp = await findLumetriComponent(item);
    if (!comp) {
      const e = new Error("Lumetri Color is not applied to this clip. Call color_apply_lumetri first.");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    const compParams = await getComponentParams(comp);
    // Best-effort: Lumetri's "Input LUT" param under the Creative section.
    const param = compParams.find((p) => /input lut/i.test(p.displayName || ""));
    if (!param) {
      throw apiError("color.applyLut", new Error('Could not find an "Input LUT"-labeled Lumetri parameter.'));
    }
    // On 26.x "Input LUT" is the dropdown's numeric index, and createKeyframe
    // rejects a file path with "Illegal Parameter type" (live 26.5.1), so a
    // .cube can't be loaded by path through UXP. Say so instead of failing
    // with a type hint. A build that takes a string still gets the write.
    if ((await readParamValue(param)).valueType === "number") {
      throw apiError(
        "color.applyLut",
        new Error(
          "Premiere's UXP API does not accept a LUT file path: Lumetri's Input LUT is a dropdown index on this build. " +
            "Load the .cube in Lumetri > Basic Correction > Input LUT by hand, or grade with color_adjust / color_set_basic_correction instead.",
        ),
      );
    }
    await setParamValue(project, param, params.lutPath, "PPMCP color_apply_lut");
    return { applied: true };
  },
};
