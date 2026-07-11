// Effect enumeration is confirmed live (docs/PLAN.md §3 live probe: 105
// video filters, 54 audio filters enumerated via VideoFilterFactory/
// AudioFilterFactory). Applying/removing/parameterizing an effect uses the
// component-chain factory methods named in the type declarations
// (createInsertComponentAction/createAppendComponentAction/
// createRemoveComponentAction) — not individually exercised live yet.

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
  findParamByLabel,
  runTransaction,
  tickTime,
} = require("../ppro.js");

function coerceParamValue(value) {
  if (value && typeof value === "object" && "x" in value && "y" in value && ppro.PointF) {
    return new ppro.PointF(value.x, value.y);
  }
  if (value && typeof value === "object" && "r" in value && "g" in value && "b" in value && ppro.Color) {
    return new ppro.Color(value.r, value.g, value.b, value.a === undefined ? 255 : value.a);
  }
  return value;
}

async function getItem({ sequenceId, trackType, trackIndex, clipIndex }) {
  const project = await getActiveProject();
  const sequence = await getSequence(project, sequenceId);
  const track = await getTrack(sequence, trackType, trackIndex);
  const items = await getTrackItems(track);
  const item = items[clipIndex];
  if (!item) {
    const e = new Error(`No clip at index ${clipIndex} on ${trackType} track ${trackIndex}.`);
    e.code = "NOT_FOUND";
    throw e;
  }
  return { project, item };
}

/** Build a VideoFilterComponent from a matchName or display name. */
async function resolveVideoFilterComponent(name) {
  if (!name) {
    const e = new Error("effect.add requires matchName (or display name).");
    e.code = "INVALID_PARAMS";
    throw e;
  }
  // Prefer exact matchName first.
  try {
    const direct = await ppro.VideoFilterFactory.createComponent(name);
    if (direct) return direct;
  } catch {
    /* fall through to display-name lookup */
  }
  const [matchNames, displayNames] = await Promise.all([
    ppro.VideoFilterFactory.getMatchNames(),
    ppro.VideoFilterFactory.getDisplayNames(),
  ]);
  const lower = name.toLowerCase();
  let idx = displayNames.findIndex((d) => d === name);
  if (idx < 0) idx = displayNames.findIndex((d) => d && d.toLowerCase() === lower);
  if (idx < 0) idx = displayNames.findIndex((d) => d && d.toLowerCase().includes(lower));
  if (idx < 0) idx = matchNames.findIndex((m) => m === name || (m && m.toLowerCase() === lower));
  if (idx < 0) {
    const e = new Error(
      `No video filter matching "${name}". Use effect_list_available to see matchName/displayName pairs.`,
    );
    e.code = "NOT_FOUND";
    throw e;
  }
  const component = await ppro.VideoFilterFactory.createComponent(matchNames[idx]);
  if (!component) {
    throw new Error(`VideoFilterFactory.createComponent("${matchNames[idx]}") returned null.`);
  }
  return component;
}

module.exports = {
  "effect.listAvailable": async ({ query, kind } = {}) => {
    try {
      // `kind` narrows the enumeration to just the video (or audio) side of
      // Premiere's Effects panel. When asking for video-only we can skip the
      // audio factory calls entirely (and vice-versa) — cheaper, and it's the
      // common case ("list the video effects I can drop on this clip").
      const wantVideo = kind !== "audio";
      const wantAudio = kind !== "video";
      const [videoMatch, videoDisplay, audioMatch, audioDisplay] = await Promise.all([
        wantVideo ? ppro.VideoFilterFactory.getMatchNames() : Promise.resolve([]),
        wantVideo ? ppro.VideoFilterFactory.getDisplayNames() : Promise.resolve([]),
        wantAudio && ppro.AudioFilterFactory.getMatchNames ? ppro.AudioFilterFactory.getMatchNames() : Promise.resolve([]),
        wantAudio ? ppro.AudioFilterFactory.getDisplayNames() : Promise.resolve([]),
      ]);
      let all = [
        ...videoMatch.map((matchName, i) => ({ matchName, displayName: videoDisplay[i], kind: "video" })),
        ...audioMatch.map((matchName, i) => ({ matchName, displayName: audioDisplay[i], kind: "audio" })),
      ];
      if (all.length === 0 && audioDisplay.length) {
        // audio matchNames enumeration unconfirmed — fall back to display-name-only entries.
        all = audioDisplay.map((displayName) => ({ matchName: undefined, displayName, kind: "audio" }));
      }
      if (query) {
        const q = query.toLowerCase();
        all = all.filter((e) => e.displayName && e.displayName.toLowerCase().includes(q));
      }
      return all;
    } catch (err) {
      throw apiError("effect.listAvailable", err);
    }
  },

  "effect.listApplied": async (params) => {
    const { item } = await getItem(params);
    const { components } = await getComponents(item);
    const result = [];
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const displayName = await getComponentDisplayName(comp);
      const params_ = await getComponentParams(comp);
      result.push({
        effectIndex: i,
        displayName,
        params: params_.map((p, pi) => ({ paramIndex: pi, displayName: p.displayName })),
      });
    }
    return result;
  },

  "effect.add": async (params) => {
    const { project, item } = await getItem(params);
    try {
      // Confirmed (UXP docs): createAppendComponentAction takes a Component,
      // not a matchName string — "Illegal Parameter type" was the live
      // symptom of passing the string. Create via VideoFilterFactory first.
      // Callers may pass either a real matchName ("AE.ADBE Lumetri") or a
      // display name ("Gaussian Blur") — resolve the latter by looking up
      // the live enumeration.
      const component = await resolveVideoFilterComponent(params.matchName);
      const { chain } = await getComponents(item);
      runTransaction(project, "PPMCP effect_add", (c) => {
        const action = chain.createAppendComponentAction(component);
        if (!action) throw new Error("createAppendComponentAction returned null/undefined.");
        c.addAction(action);
      });
      return { added: true, matchName: params.matchName };
    } catch (err) {
      throw apiError("effect.add", err);
    }
  },

  "effect.remove": async (params) => {
    const { project, item } = await getItem(params);
    try {
      const { chain, components } = await getComponents(item);
      const comp = components[params.effectIndex];
      if (!comp) {
        const e = new Error(`No effect at index ${params.effectIndex}.`);
        e.code = "NOT_FOUND";
        throw e;
      }
      const action = chain.createRemoveComponentAction(comp);
      runTransaction(project, "PPMCP effect_remove", (c) => c.addAction(action));
      return { removed: true };
    } catch (err) {
      throw apiError("effect.remove", err);
    }
  },

  "effect.setParam": async (params) => {
    const { project, item } = await getItem(params);
    const { components } = await getComponents(item);
    const comp = components[params.effectIndex];
    if (!comp) {
      const e = new Error(`No effect at index ${params.effectIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    const compParams = await getComponentParams(comp);
    let param;
    let resolvedName = params.paramName;
    if (params.paramIndex !== undefined && params.paramIndex !== null) {
      param = compParams[params.paramIndex];
      resolvedName = param ? param.displayName || `index:${params.paramIndex}` : undefined;
    } else if (params.paramName !== undefined && params.paramName !== null) {
      // Exact match first; empty-string and whitespace names are valid (Simple Text Content)
      param = compParams.find((p) => p.displayName === params.paramName);
      if (!param && String(params.paramName).toLowerCase() === "content") {
        // pymiere: Simple Text props = [?, Position, Justification, Size, Opacity, Content]
        // On this build Content often has blank/space displayName at first or last index.
        param =
          compParams.find((p) => !p.displayName || !String(p.displayName).trim()) ||
          compParams[0] ||
          compParams[compParams.length - 1];
        resolvedName = "Content(blank)";
      }
    }
    if (!param) {
      const e = new Error(
        `No parameter "${params.paramName ?? params.paramIndex}" on effect at index ${params.effectIndex}. Available: ${compParams
          .map((p, i) => `${i}:${JSON.stringify(p.displayName)}`)
          .join(", ")}`,
      );
      e.code = "NOT_FOUND";
      throw e;
    }
    const value = coerceParamValue(params.value);
    if (params.atTicks !== undefined) {
      try {
        const { tickTime } = require("../ppro.js");
        const keyframe = param.createKeyframe(value, tickTime(params.atTicks));
        const action = param.createAddKeyframeAction(keyframe);
        runTransaction(project, "PPMCP effect_set_param (keyframe)", (c) => c.addAction(action));
      } catch (err) {
        throw apiError("effect.setParam(keyframe)", err);
      }
    } else {
      await setParamValue(project, param, value, "PPMCP effect_set_param");
    }
    return { set: true, paramName: resolvedName };
  },

  /** Probe: try writing a string to every param on an effect (for Simple Text Content discovery). */
  "effect.probeStringParams": async (params) => {
    const { project, item } = await getItem(params);
    const { components } = await getComponents(item);
    const comp = components[params.effectIndex];
    if (!comp) {
      const e = new Error(`No effect at index ${params.effectIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    const text = String(params.text || "PPMCP");
    const compParams = await getComponentParams(comp);
    const results = [];
    for (let i = 0; i < compParams.length; i++) {
      const p = compParams[i];
      const name = p.displayName;
      const shapes = [text, JSON.stringify({ textEditValue: text }), JSON.stringify({ textEditValue: text, fontTextRunLength: [text.length] })];
      let ok = false;
      let via = null;
      let err = null;
      for (const shape of shapes) {
        try {
          await setParamValue(project, p, shape, `PPMCP probeString ${i}`);
          ok = true;
          via = typeof shape === "string" && shape.startsWith("{") ? "json" : "string";
          break;
        } catch (e) {
          err = e && e.message ? e.message : String(e);
        }
      }
      // also try number 0 / getStartValue type hints
      let startType = null;
      try {
        if (typeof p.getStartValue === "function") {
          const sv = await p.getStartValue();
          startType = sv && sv.value !== undefined ? typeof sv.value : typeof sv;
        }
      } catch (e) {
        startType = `err:${e.message}`;
      }
      results.push({ paramIndex: i, displayName: name, ok, via, err, startType });
    }
    return results;
  },

  "effect.getParam": async (params) => {
    const { item } = await getItem(params);
    const { components } = await getComponents(item);
    const comp = components[params.effectIndex];
    if (!comp) {
      const e = new Error(`No effect at index ${params.effectIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    const compParams = await getComponentParams(comp);
    const param = compParams.find((p) => p.displayName === params.paramName);
    if (!param) {
      const e = new Error(`No parameter "${params.paramName}" on effect at index ${params.effectIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    try {
      let value;
      if (typeof param.getValue === "function") value = await param.getValue();
      else if (typeof param.getStartValue === "function") value = await param.getStartValue();
      return { paramName: params.paramName, effectIndex: params.effectIndex, value };
    } catch (err) {
      throw apiError("effect.getParam", err);
    }
  },

  "effect.setOpacity": async (params) => {
    const { project, item } = await getItem(params);
    // Opacity lives on the built-in "Opacity" component (live-listed).
    const param =
      (await findParamByLabel(item, "Opacity", { retries: 1 })) ||
      (await findParamByLabel(item, "opacity", { retries: 0 }));
    if (!param) {
      const e = new Error('Could not find an "Opacity" parameter on this clip.');
      e.code = "NOT_FOUND";
      throw e;
    }
    // Premiere often uses 0–100. Optional atTicks → keyframe (blink / fade).
    if (params.atTicks !== undefined && params.atTicks !== null && String(params.atTicks) !== "") {
      try {
        const { tickTime, runTransaction } = require("../ppro.js");
        try {
          if (typeof param.createSetTimeVaryingAction === "function") {
            runTransaction(project, "PPMCP opacity timeVarying", (c) => {
              const tv = param.createSetTimeVaryingAction(true);
              if (tv) c.addAction(tv);
            });
          }
        } catch {
          /* optional */
        }
        const keyframe = param.createKeyframe(params.opacity, tickTime(params.atTicks));
        const action = param.createAddKeyframeAction(keyframe);
        runTransaction(project, "PPMCP effect_set_opacity keyframe", (c) => c.addAction(action));
        return { opacity: params.opacity, atTicks: String(params.atTicks), keyframed: true };
      } catch (err) {
        throw apiError("effect.setOpacity(keyframe)", err);
      }
    }
    await setParamValue(project, param, params.opacity, "PPMCP effect_set_opacity");
    return { opacity: params.opacity, keyframed: false };
  },

  "effect.setTransform": async (params) => {
    const { project, item } = await getItem(params);
    const results = {};
    const atTicks =
      params.atTicks !== undefined && params.atTicks !== null && String(params.atTicks) !== ""
        ? String(params.atTicks)
        : null;
    // Prefer Motion component — MOGRTs also expose Graphic Parameters "Position"
    // (text-layer AE space). Writing 960,480 there hides the text off-screen.
    async function motionParam(label) {
      const { components } = await getComponents(item);
      for (const comp of components) {
        const name = await getComponentDisplayName(comp);
        if (name !== "Motion" && name !== "Vector Motion") continue;
        const params_ = await getComponentParams(comp);
        const hit = params_.find((p) => p.displayName === label);
        if (hit) return hit;
      }
      // Fallback: first match (non-MOGRT clips)
      return findParamByLabel(item, label, { retries: 1 });
    }
    async function writeParam(param, value, label) {
      if (!atTicks) {
        await setParamValue(project, param, value, `PPMCP effect_set_transform ${label}`);
        return { keyframed: false };
      }
      try {
        if (typeof param.createSetTimeVaryingAction === "function") {
          runTransaction(project, `PPMCP ${label} timeVarying`, (c) => {
            const tv = param.createSetTimeVaryingAction(true);
            if (tv) c.addAction(tv);
          });
        }
      } catch {
        /* optional */
      }
      const keyframe = param.createKeyframe(value, tickTime(atTicks));
      const action = param.createAddKeyframeAction(keyframe);
      runTransaction(project, `PPMCP effect_set_transform ${label} kf`, (c) => c.addAction(action));
      return { keyframed: true, atTicks };
    }
    try {
      if (params.x !== undefined || params.y !== undefined) {
        const pos = await motionParam("Position");
        if (!pos) throw Object.assign(new Error('No Motion "Position" param.'), { code: "NOT_FOUND" });
        const x = params.x !== undefined ? params.x : 0.5;
        const y = params.y !== undefined ? params.y : 0.5;
        const wr = await writeParam(pos, new ppro.PointF(x, y), "position");
        results.position = { x, y, via: "Motion", ...wr };
      }
      if (params.scale !== undefined) {
        const scale = await motionParam("Scale");
        if (!scale) throw Object.assign(new Error('No Motion "Scale" param.'), { code: "NOT_FOUND" });
        const wr = await writeParam(scale, params.scale, "scale");
        results.scale = { value: params.scale, ...wr };
      }
      if (params.rotation !== undefined) {
        const rot = await motionParam("Rotation");
        if (!rot) throw Object.assign(new Error('No Motion "Rotation" param.'), { code: "NOT_FOUND" });
        const wr = await writeParam(rot, params.rotation, "rotation");
        results.rotation = { value: params.rotation, ...wr };
      }
      if (params.anchorX !== undefined || params.anchorY !== undefined) {
        const anchor = await motionParam("Anchor Point");
        if (!anchor) throw Object.assign(new Error('No Motion "Anchor Point" param.'), { code: "NOT_FOUND" });
        const wr = await writeParam(
          anchor,
          new ppro.PointF(params.anchorX ?? 0.5, params.anchorY ?? 0.5),
          "anchor",
        );
        results.anchor = { x: params.anchorX ?? 0.5, y: params.anchorY ?? 0.5, ...wr };
      }
      return results;
    } catch (err) {
      throw apiError("effect.setTransform", err);
    }
  },

  "effect.reset": async (params) => {
    // Remove every non-intrinsic component (keep Opacity / Motion / Vector Motion / Graphic Parameters).
    const { project, item } = await getItem(params);
    const keep = new Set(["Opacity", "Motion", "Vector Motion", "Graphic Parameters"]);
    try {
      const { chain, components } = await getComponents(item);
      const toRemove = [];
      for (const comp of components) {
        const name = await getComponentDisplayName(comp);
        if (!keep.has(name)) toRemove.push(comp);
      }
      if (!toRemove.length) return { removed: 0 };
      runTransaction(project, "PPMCP effect_reset", (c) => {
        for (const comp of toRemove) c.addAction(chain.createRemoveComponentAction(comp));
      });
      return { removed: toRemove.length };
    } catch (err) {
      throw apiError("effect.reset", err);
    }
  },
};
