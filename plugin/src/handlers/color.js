// Lumetri Color's real matchName is confirmed live: "AE.ADBE Lumetri"
// (docs/PLAN.md §3 live probe, among 105 enumerated video filters). There
// is no dedicated Lumetri API — it's applied/parameterized through the
// same generic effect-component mechanism as any other effect.

const { apiError, ppro, getActiveProject, getSequence, getTrack, getTrackItems, getComponents, getComponentDisplayName, getComponentParams, setParamValue, runTransaction } = require("../ppro.js");

const LUMETRI_MATCH_NAME = "AE.ADBE Lumetri";

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
    const param = compParams.find((p) => p.displayName === params.paramName);
    if (!param) {
      const e = new Error(`No Lumetri parameter "${params.paramName}" found. Use color_get_params to see available names.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    await setParamValue(project, param, params.value, "PPMCP color_set_param");
    return { set: true };
  },

  "color.getParams": async (params) => {
    const { item } = await getItem(params);
    const comp = await findLumetriComponent(item);
    if (!comp) return { applied: false, params: [] };
    const compParams = await getComponentParams(comp);
    return { applied: true, params: compParams.map((p) => ({ displayName: p.displayName })) };
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
    await setParamValue(project, param, params.lutPath, "PPMCP color_apply_lut");
    return { applied: true };
  },
};
