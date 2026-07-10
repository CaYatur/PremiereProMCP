// MOGRT insertion + text/position master properties on text/shape graphics.
// Text write is known-hard: createKeyframe(string) historically threw
// "Illegal Parameter type" on our Basic Text.mogrt. This file retries
// multiple value shapes (plain string, AE-capsule JSON) and surfaces
// a precise error if all fail.

const {
  apiError,
  getActiveProject,
  getSequence,
  getEditor,
  getTrack,
  getTrackItems,
  findParamByLabel,
  setParamValue,
  tickTime,
  ppro,
  runTransaction,
  getComponents,
  getComponentDisplayName,
  getComponentParams,
} = require("../ppro.js");
const { resolveTemplatePath } = require("../templates.js");

const DEFAULT_DURATION_TICKS = "1270080000000"; // 5s

async function insertMogrt({ sequenceId, trackIndex, atTicks, durationTicks, template }) {
  const project = await getActiveProject();
  const sequence = await getSequence(project, sequenceId);
  const track = await getTrack(sequence, "video", trackIndex);
  const path = await resolveTemplatePath(template);

  let created;
  try {
    // Adobe sample: wrap insertMogrtFromPath in project.lockedAccess.
    const editor = await getEditor(sequence);
    let time;
    try {
      if ((!atTicks || atTicks === "0") && ppro.TickTime.TIME_ZERO) time = ppro.TickTime.TIME_ZERO;
      else if (ppro.TickTime.createWithSeconds) {
        time = ppro.TickTime.createWithSeconds(Number(BigInt(atTicks)) / 254016000000);
      } else time = tickTime(atTicks);
    } catch {
      time = tickTime(atTicks || "0");
    }
    let items;
    if (typeof project.lockedAccess === "function") {
      let result;
      project.lockedAccess(() => {
        result = editor.insertMogrtFromPath(path, time, trackIndex, 0);
      });
      items = result && typeof result.then === "function" ? await result : result;
    } else {
      items = await editor.insertMogrtFromPath(path, time, trackIndex, 0);
    }
    if (items && typeof items.then === "function") items = await items;
    created = items && items[0];
    if (!created) throw new Error("insertMogrtFromPath returned no track items.");
  } catch (err) {
    throw apiError("title.insertMogrt", err);
  }

  const allItems = await getTrackItems(track);
  let clipIndex = allItems.indexOf(created);
  if (clipIndex === -1) {
    const createdStart = String((await created.getStartTime()).ticks);
    clipIndex = allItems.length - 1;
    for (let i = 0; i < allItems.length; i++) {
      const st = String((await allItems[i].getStartTime()).ticks);
      if (st === createdStart) {
        clipIndex = i;
        break;
      }
    }
  }

  if (durationTicks && durationTicks !== DEFAULT_DURATION_TICKS) {
    try {
      const action = created.createSetEndAction(
        tickTime((BigInt(atTicks) + BigInt(durationTicks)).toString()),
      );
      runTransaction(project, "PPMCP text/shape duration", (c) => c.addAction(action));
    } catch {
      /* non-fatal */
    }
  }

  return { trackIndex, clipIndex, templatePath: path };
}

/** Build candidate values for a text master property. AE Capsule-style
 * MOGRTs often want a JSON blob; our Basic Text may want a plain string. */
function textValueCandidates(text) {
  const s = String(text);
  return [
    { kind: "string", value: s },
    { kind: "json-textEditValue", value: JSON.stringify({ textEditValue: s }) },
    {
      kind: "json-capsule",
      value: JSON.stringify({
        textEditValue: s,
        fontEditValue: ["ArialMT"],
        fontSizeEditValue: [48],
        fontTextRunLength: [s.length],
      }),
    },
  ];
}

async function findTextLikeParam(item) {
  const labels = ["Text", "Title", "Subtitle", "Source Text", "Main Text"];
  for (const label of labels) {
    const p = await findParamByLabel(item, label, { retries: label === "Text" ? 4 : 1, delayMs: 200 });
    if (p) return { param: p, label };
  }
  // Scan all params for name containing "text"/"title"
  const { components } = await getComponents(item);
  for (const comp of components) {
    const params = await getComponentParams(comp);
    for (const p of params) {
      const n = (p.displayName || "").toLowerCase();
      if (n.includes("text") || n.includes("title") || n.includes("caption")) {
        return { param: p, label: p.displayName };
      }
    }
  }
  return null;
}

async function trySetTextParam(project, param, text) {
  const errors = [];
  for (const cand of textValueCandidates(text)) {
    try {
      const kf = param.createKeyframe(cand.value);
      if (!kf) {
        errors.push(`${cand.kind}: createKeyframe returned null`);
        continue;
      }
      // Prefer createSetValueAction(keyframe); some builds take a second arg.
      let action;
      try {
        action = param.createSetValueAction(kf, true);
      } catch {
        action = param.createSetValueAction(kf);
      }
      if (!action) {
        errors.push(`${cand.kind}: createSetValueAction returned null`);
        continue;
      }
      await runTransaction(project, `PPMCP text_set (${cand.kind})`, (c) => c.addAction(action));
      return { ok: true, kind: cand.kind };
    } catch (e) {
      errors.push(`${cand.kind}: ${e && e.message ? e.message : e}`);
    }
  }
  // Last resort: createSetTimeVarying + add keyframe at 0
  try {
    if (typeof param.createSetTimeVaryingAction === "function") {
      const tv = param.createSetTimeVaryingAction(true);
      await runTransaction(project, "PPMCP text timeVarying", (c) => c.addAction(tv));
    }
    const kf = param.createKeyframe(String(text));
    if (typeof param.createAddKeyframeAction === "function") {
      // Some signatures take (keyframe) only; others need time on the keyframe.
      const action = param.createAddKeyframeAction(kf);
      await runTransaction(project, "PPMCP text addKeyframe", (c) => c.addAction(action));
      return { ok: true, kind: "addKeyframe-after-timeVarying" };
    }
  } catch (e) {
    errors.push(`timeVarying path: ${e && e.message ? e.message : e}`);
  }
  return { ok: false, errors };
}

/**
 * Community / pymiere path: Simple Text video filter (AE.ADBE PPro SimpleText).
 * Param order typically: [Content?, Position, Justification, Size, Opacity, Content?].
 * Content often has blank displayName — try string write on every blank/text-like param.
 */
async function trySetSimpleTextOnItem(project, item, text) {
  const { chain, components } = await getComponents(item);
  // Find existing Simple Text or append one
  let simpleIdx = -1;
  let simpleComp = null;
  for (let i = 0; i < components.length; i++) {
    const name = await getComponentDisplayName(components[i]);
    if (/simple\s*text/i.test(name || "")) {
      simpleIdx = i;
      simpleComp = components[i];
      break;
    }
  }
  if (!simpleComp) {
    try {
      const filter = await ppro.VideoFilterFactory.createComponent("AE.ADBE PPro SimpleText");
      if (!filter) throw new Error("createComponent SimpleText returned null");
      runTransaction(project, "PPMCP add SimpleText", (c) => {
        const action = chain.createAppendComponentAction(filter);
        if (!action) throw new Error("append SimpleText null");
        c.addAction(action);
      });
      // re-fetch
      const again = await getComponents(item);
      for (let i = 0; i < again.components.length; i++) {
        const name = await getComponentDisplayName(again.components[i]);
        if (/simple\s*text/i.test(name || "")) {
          simpleIdx = i;
          simpleComp = again.components[i];
          break;
        }
      }
    } catch (e) {
      return { ok: false, error: `add SimpleText: ${e && e.message ? e.message : e}` };
    }
  }
  if (!simpleComp) return { ok: false, error: "SimpleText component not found after add" };

  const params = await getComponentParams(simpleComp);
  const s = String(text);
  const shapes = [
    s,
    JSON.stringify({ textEditValue: s }),
    JSON.stringify({ textEditValue: s, fontTextRunLength: [s.length] }),
  ];
  const attempts = [];
  // Only try string writes on blank / Content-like params (not Position/Size —
  // those need PointF/number and would only pollute the error log).
  const contentIndices = [];
  params.forEach((p, i) => {
    const n = (p.displayName || "").trim();
    if (!n || /content|text|source/i.test(n)) contentIndices.push(i);
  });
  if (!contentIndices.length) {
    // pymiere order: Content is often first (?) or last
    contentIndices.push(0, params.length - 1);
  }
  const seen = new Set();
  for (const i of contentIndices) {
    if (i < 0 || i >= params.length || seen.has(i)) continue;
    seen.add(i);
    const p = params[i];
    // Inspect start value type once for diagnostics
    let startHint = "";
    try {
      if (typeof p.getStartValue === "function") {
        const sv = await p.getStartValue();
        startHint = ` startType=${sv === null || sv === undefined ? sv : typeof sv}`;
        if (sv && typeof sv === "object" && sv.constructor) startHint += ` ctor=${sv.constructor.name}`;
      }
    } catch (e) {
      startHint = ` startErr=${e && e.message ? e.message : e}`;
    }
    for (const shape of shapes) {
      try {
        await setParamValue(project, p, shape, `PPMCP SimpleText param${i}`);
        return {
          ok: true,
          via: "simple-text",
          paramIndex: i,
          paramName: p.displayName,
          shape: typeof shape === "string" && shape.startsWith("{") ? "json" : "string",
        };
      } catch (e) {
        attempts.push(
          `p${i}/${JSON.stringify(p.displayName)}${startHint}: ${e && e.message ? e.message : e}`,
        );
      }
    }
  }
  return {
    ok: false,
    error:
      "UXP createKeyframe rejects string values on SimpleText Content (same Illegal Parameter type as MOGRT Text). " +
      "Confirmed live — ExtendScript setValue works for AE MOGRTs/SimpleText; UXP does not expose a string value type. " +
      attempts.slice(0, 4).join(" ;; "),
    paramCount: params.length,
    platformGap: "uxp-no-string-component-param",
  };
}

module.exports = {
  "title.insertMogrt": insertMogrt,

  "title.setText": async ({ sequenceId, trackIndex, clipIndex, text }) => {
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
    // 1) MOGRT master Text property (fails on Premiere-native templates / UXP type gap)
    const found = await findTextLikeParam(item);
    if (found) {
      const result = await trySetTextParam(project, found.param, text);
      if (result.ok) {
        return { text, paramLabel: found.label, via: result.kind };
      }
    }
    // 2) SimpleText video effect (pymiere / community path) — real Premiere text overlay
    const simple = await trySetSimpleTextOnItem(project, item, text);
    if (simple.ok) {
      return { text, ...simple };
    }
    // 3) Exhaustive error
    const { components } = await getComponents(item);
    const names = [];
    for (const comp of components) {
      const cn = await getComponentDisplayName(comp);
      const params = await getComponentParams(comp);
      names.push(`${cn}:[${params.map((p) => p.displayName).join(", ")}]`);
    }
    throw apiError(
      "title.setText",
      new Error(
        `Could not write text. MOGRT Text: UXP Illegal Parameter type (known gap). SimpleText: ${simple.error}. Components: ${names.join(" | ")}`,
      ),
    );
  },

  /** Place SimpleText on a clip and set content — preferred real-text path without MOGRT. */
  "title.addSimpleText": async ({ sequenceId, trackIndex, clipIndex, text, size, x, y }) => {
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
    const simple = await trySetSimpleTextOnItem(project, item, text);
    if (!simple.ok) {
      throw apiError("title.addSimpleText", new Error(simple.error || "SimpleText failed"));
    }
    // Best-effort size / position on SimpleText component
    try {
      const { components } = await getComponents(item);
      let st = null;
      for (const c of components) {
        const n = await getComponentDisplayName(c);
        if (/simple\s*text/i.test(n || "")) {
          st = c;
          break;
        }
      }
      if (st) {
        const params = await getComponentParams(st);
        if (size !== undefined) {
          const sizeP = params.find((p) => /size/i.test(p.displayName || ""));
          if (sizeP) await setParamValue(project, sizeP, Number(size), "PPMCP SimpleText size");
        }
        if (x !== undefined && y !== undefined) {
          const posP = params.find((p) => /position/i.test(p.displayName || ""));
          if (posP && ppro.PointF) {
            await setParamValue(project, posP, new ppro.PointF(Number(x), Number(y)), "PPMCP SimpleText pos");
          }
        }
      }
    } catch {
      /* non-fatal */
    }
    return { text, ...simple };
  },

  "title.getText": async ({ sequenceId, trackIndex, clipIndex }) => {
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
    const found = await findTextLikeParam(item);
    if (!found) {
      const e = new Error('Could not find a "Text" master property on this clip.');
      e.code = "NOT_FOUND";
      throw e;
    }
    const { param } = found;
    const attempts = [];
    try {
      const sv = await param.getStartValue();
      if (sv && sv.value !== undefined && sv.value !== null) {
        let v = sv.value;
        if (v && typeof v === "object" && "value" in v) v = v.value;
        if (typeof v === "string") {
          try {
            const parsed = JSON.parse(v);
            if (parsed && parsed.textEditValue !== undefined) {
              return { text: parsed.textEditValue, raw: v, via: "getStartValue-json" };
            }
          } catch {
            /* plain string */
          }
          return { text: v, via: "getStartValue" };
        }
        attempts.push(`getStartValue type=${typeof v}`);
      } else {
        attempts.push("getStartValue null");
      }
    } catch (e) {
      attempts.push(`getStartValue: ${e.message}`);
    }
    try {
      const v = await param.getValueAtTime(ppro.TickTime.TIME_ZERO);
      if (typeof v === "string") return { text: v, via: "getValueAtTime" };
      if (v && typeof v === "object") return { text: String(v.value ?? v), raw: v, via: "getValueAtTime-obj" };
      attempts.push(`getValueAtTime type=${typeof v}`);
    } catch (e) {
      attempts.push(`getValueAtTime: ${e.message}`);
    }
    throw apiError(
      "title.getText",
      new Error(`Could not read text param "${found.label}". Attempts: ${attempts.join("; ")}`),
    );
  },

  "title.setPosition": async ({ sequenceId, trackIndex, clipIndex, x, y }) => {
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
    // CRITICAL: Prefer Motion Position (normalized 0–1 center = 0.5,0.5).
    // Graphic Parameters "Position" is AE design space — writing pixel-like
    // values (e.g. 960,480) hides or misplaces text. Never prefer Graphic first.
    const { components } = await getComponents(item);
    let motionPos = null;
    let graphicPos = null;
    for (const comp of components) {
      const name = await getComponentDisplayName(comp);
      const params = await getComponentParams(comp);
      const pos = params.find((p) => p.displayName === "Position");
      if (!pos) continue;
      if (name === "Motion" || name === "Vector Motion") motionPos = pos;
      else if (name === "Graphic Parameters") graphicPos = pos;
    }
    const positionParam = motionPos || (await findParamByLabel(item, "Position")) || graphicPos;
    if (!positionParam) {
      const e = new Error('Could not find a Motion/graphic "Position" property on this clip.');
      e.code = "NOT_FOUND";
      throw e;
    }
    // Auto-detect: values > 2 look like pixels → convert assuming 1920x1080
    let px = Number(x);
    let py = Number(y);
    if (Math.abs(px) > 2 || Math.abs(py) > 2) {
      px = px / 1920;
      py = py / 1080;
    }
    await setParamValue(project, positionParam, new ppro.PointF(px, py), "PPMCP text_set_position");
    return { x: px, y: py, via: motionPos ? "Motion" : "fallback", normalized: true };
  },

  /** List graphic master params — helps models debug template contents. */
  "title.listParams": async ({ sequenceId, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, "video", trackIndex);
    const items = await getTrackItems(track);
    const item = items[clipIndex];
    if (!item) {
      const e = new Error(`No clip at index ${clipIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    const { components } = await getComponents(item);
    const result = [];
    for (const comp of components) {
      const displayName = await getComponentDisplayName(comp);
      const params = await getComponentParams(comp);
      result.push({
        component: displayName,
        params: params.map((p, i) => ({ index: i, displayName: p.displayName })),
      });
    }
    return result;
  },
};
