// Diagnostic probes for known gaps: text write, shape size, insert, markers.
// Temporarily registered while we re-investigate. Not a public MCP tool surface
// by default — can be reached via raw relay call "debug.*".

const {
  apiError,
  ppro,
  getActiveProject,
  getSequence,
  getEditor,
  getTrack,
  getTrackItems,
  getComponents,
  getComponentDisplayName,
  getComponentParams,
  findParamByLabel,
  setParamValue,
  tickTime,
  runTransaction,
  findProjectItemById,
} = require("../ppro.js");

function safe(fn) {
  return Promise.resolve()
    .then(fn)
    .then((v) => ({ ok: true, value: v }))
    .catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
}

function ownKeys(obj) {
  const keys = new Set();
  let cur = obj;
  let depth = 0;
  while (cur && depth < 4) {
    try {
      Object.getOwnPropertyNames(cur).forEach((k) => keys.add(k));
    } catch {
      /* ignore */
    }
    cur = Object.getPrototypeOf(cur);
    depth++;
  }
  return Array.from(keys);
}

async function listAllParams(item) {
  const { components } = await getComponents(item);
  const out = [];
  for (const comp of components) {
    const name = await getComponentDisplayName(comp);
    const params = await getComponentParams(comp);
    out.push({
      component: name,
      params: params.map((p, i) => ({ index: i, displayName: p.displayName })),
    });
  }
  return out;
}

async function probeTextValueShapes(param) {
  const candidates = [
    ["string", "PPMCP_PROBE"],
    ["json-textEditValue", JSON.stringify({ textEditValue: "PPMCP_PROBE" })],
    ["json-full-capsule", JSON.stringify({ textEditValue: "PPMCP_PROBE", fontSizeEditValue: [48], fontTextRunLength: [11] })],
    ["empty-string", ""],
    ["number-zero", 0],
  ];
  const results = [];
  for (const [label, value] of candidates) {
    try {
      const kf = param.createKeyframe(value);
      results.push({
        label,
        createKeyframe: "ok",
        kfKeys: kf ? ownKeys(kf) : null,
        kfValueType: kf && kf.value !== undefined ? typeof kf.value : null,
      });
    } catch (e) {
      results.push({ label, createKeyframe: "ERR", error: String(e && e.message ? e.message : e) });
    }
  }
  // areKeyframesSupported / getStartValue / getValueAtTime
  results.push({ label: "areKeyframesSupported", ...(await safe(() => param.areKeyframesSupported())) });
  results.push({ label: "getStartValue", ...(await safe(async () => {
    const sv = await param.getStartValue();
    return sv ? { keys: ownKeys(sv), value: sv.value, valueType: typeof sv.value } : null;
  })) });
  results.push({ label: "getValueAtTime(0)", ...(await safe(async () => {
    const v = await param.getValueAtTime(ppro.TickTime.TIME_ZERO);
    return { type: typeof v, value: v && v.value !== undefined ? v.value : v };
  })) });
  results.push({ label: "isTimeVarying", ...(await safe(() => param.isTimeVarying())) });
  return results;
}

module.exports = {
  "debug.listParams": async ({ sequenceId, trackType, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType || "video", trackIndex);
    const items = await getTrackItems(track);
    const item = items[clipIndex];
    if (!item) throw apiError("debug.listParams", new Error("no clip"));
    return { params: await listAllParams(item), name: await item.getName() };
  },

  "debug.probeText": async ({ sequenceId, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, "video", trackIndex);
    const items = await getTrackItems(track);
    const item = items[clipIndex];
    if (!item) throw apiError("debug.probeText", new Error("no clip"));
    const all = await listAllParams(item);
    const textParam = await findParamByLabel(item, "Text", { retries: 2 });
    const titleParam = await findParamByLabel(item, "Title", { retries: 0 });
    const result = { allComponents: all, hasText: !!textParam, hasTitle: !!titleParam };
    if (textParam) {
      result.textProbe = await probeTextValueShapes(textParam);
      // Attempt write with JSON shape if createKeyframe accepts it
      for (const value of [
        "PPMCP_WRITE_TEST",
        JSON.stringify({ textEditValue: "PPMCP_WRITE_JSON" }),
      ]) {
        try {
          const kf = textParam.createKeyframe(value);
          const action = textParam.createSetValueAction(kf);
          await runTransaction(project, "PPMCP debug text write", (c) => c.addAction(action));
          result.writeAttempt = { value, ok: true };
          break;
        } catch (e) {
          result.writeAttempt = result.writeAttempt || [];
          if (!Array.isArray(result.writeAttempt)) result.writeAttempt = [result.writeAttempt];
          result.writeAttempt.push({ value: String(value).slice(0, 40), error: String(e && e.message ? e.message : e) });
        }
      }
    }
    return result;
  },

  "debug.probeShape": async ({ sequenceId, trackIndex, clipIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, "video", trackIndex);
    const items = await getTrackItems(track);
    const item = items[clipIndex];
    if (!item) throw apiError("debug.probeShape", new Error("no clip"));
    const all = await listAllParams(item);
    const size = await findParamByLabel(item, "Size", { retries: 1 });
    const scale = await findParamByLabel(item, "Scale", { retries: 1 });
    const scaleW = await findParamByLabel(item, "Scale Width", { retries: 0 });
    const result = {
      allComponents: all,
      hasSize: !!size,
      hasScale: !!scale,
      hasScaleWidth: !!scaleW,
    };
    if (size) {
      result.sizeCreateKf = await safe(() => size.createKeyframe(new ppro.PointF(400, 200)));
      result.sizeCreateKfNum = await safe(() => size.createKeyframe(50));
      result.sizeCreateKfArr = await safe(() => size.createKeyframe([400, 200]));
    }
    // Try Scale as size workaround
    if (scale) {
      try {
        await setParamValue(project, scale, 50, "PPMCP debug scale as size");
        result.scaleWrite = { ok: true, value: 50 };
      } catch (e) {
        result.scaleWrite = { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    return result;
  },

  "debug.probeInsert": async ({ sequenceId, projectItemId, trackIndex, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const item = await findProjectItemById(project, projectItemId);
    const editor = await getEditor(sequence);
    const ti = trackIndex ?? 0;
    const t = tickTime(atTicks || "0");
    const attempts = [];

    // 1) raw ProjectItem
    attempts.push(await safe(async () => {
      const action = editor.createOverwriteItemAction(item, t, ti, 0);
      if (!action) throw new Error("action null");
      await runTransaction(project, "PPMCP debug overwrite raw", (c) => c.addAction(action));
      return "overwrite raw ProjectItem";
    }));

    // 2) ClipProjectItem cast
    attempts.push(await safe(async () => {
      const clip = ppro.ClipProjectItem.cast(item);
      const action = editor.createOverwriteItemAction(clip, t, ti, 0);
      if (!action) throw new Error("action null");
      await runTransaction(project, "PPMCP debug overwrite cast", (c) => c.addAction(action));
      return "overwrite ClipProjectItem.cast";
    }));

    // 3) insert with limitShift false/true
    for (const limit of [false, true]) {
      attempts.push(await safe(async () => {
        const clip = ppro.ClipProjectItem.cast(item);
        const action = editor.createInsertProjectItemAction(clip, t, ti, 0, limit);
        if (!action) throw new Error("action null");
        // Check addAction return before executeTransaction throw
        let addOk;
        const execResult = await project.executeTransaction((c) => {
          addOk = c.addAction(action);
        }, `PPMCP debug insert limit=${limit}`);
        return { via: `insert cast limit=${limit}`, addOk, execResult };
      }));
    }

    // 4) lockedAccess wrap
    attempts.push(await safe(async () => {
      const clip = ppro.ClipProjectItem.cast(item);
      const action = editor.createOverwriteItemAction(clip, t, ti, 1);
      if (typeof project.lockedAccess === "function") {
        let inner;
        project.lockedAccess(() => {
          inner = project.executeTransaction((c) => c.addAction(action), "PPMCP debug locked overwrite");
        });
        return { via: "lockedAccess+overwrite track1", inner: await inner };
      }
      throw new Error("no lockedAccess");
    }));

    return { attempts };
  },

  "debug.probeMarker": async ({ sequenceId, atTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const markers = await ppro.Markers.getMarkers(sequence);
    const attempts = [];
    const types = [
      ["COMMENT", ppro.Marker.MARKER_TYPE_COMMENT],
      ["CHAPTER", ppro.Marker.MARKER_TYPE_CHAPTER],
      ["SEGUE", ppro.Marker.MARKER_TYPE_SEGUE],
      ["WEBLINK", ppro.Marker.MARKER_TYPE_WEBLINK],
      ["FLASHCUE", ppro.Marker.MARKER_TYPE_FLASHCUE],
      ["0", 0],
      ["1", 1],
    ];
    for (const [label, type] of types) {
      if (type === undefined) {
        attempts.push({ label, skip: "type undefined" });
        continue;
      }
      attempts.push(await safe(async () => {
        const action = markers.createAddMarkerAction(
          "PPMCP probe",
          type,
          tickTime(atTicks || "0"),
          ppro.TickTime.TIME_ZERO,
          "probe",
        );
        if (!action) throw new Error("action null");
        let addOk;
        try {
          await project.executeTransaction((c) => {
            addOk = c.addAction(action);
          }, `PPMCP debug marker ${label}`);
        } catch (e) {
          throw new Error(`addAction/exec: ${e.message}; addOk=${addOk}`);
        }
        return { label, addOk };
      }));
    }
    // list after
    const list = await safe(async () => {
      const arr = await markers.getMarkers();
      return arr.length;
    });
    return { attempts, markerCount: list };
  },

  /** Deep probe SimpleText (or any effect) string-write paths — live research. */
  "debug.probeSimpleText": async ({ sequenceId, trackIndex, clipIndex, effectIndex, text }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, "video", trackIndex ?? 0);
    const items = await getTrackItems(track);
    const item = items[clipIndex ?? 0];
    if (!item) throw apiError("debug.probeSimpleText", new Error("no clip"));

    const { components } = await getComponents(item);
    let idx = effectIndex;
    if (idx === undefined || idx === null) {
      for (let i = 0; i < components.length; i++) {
        const n = await getComponentDisplayName(components[i]);
        if (/simple\s*text/i.test(n || "")) {
          idx = i;
          break;
        }
      }
    }
    if (idx === undefined || idx === null) {
      // add SimpleText
      try {
        const { chain } = await getComponents(item);
        const filter = await ppro.VideoFilterFactory.createComponent("AE.ADBE PPro SimpleText");
        runTransaction(project, "PPMCP debug add SimpleText", (c) => {
          c.addAction(chain.createAppendComponentAction(filter));
        });
      } catch (e) {
        return { error: `add failed: ${e.message}` };
      }
      const again = await getComponents(item);
      for (let i = 0; i < again.components.length; i++) {
        const n = await getComponentDisplayName(again.components[i]);
        if (/simple\s*text/i.test(n || "")) {
          idx = i;
          break;
        }
      }
    }
    const { components: comps2 } = await getComponents(item);
    const comp = comps2[idx];
    if (!comp) return { error: "no SimpleText component", effectIndex: idx };
    const params = await getComponentParams(comp);
    const sample = String(text || "PPMCP_ST");
    const out = { effectIndex: idx, params: [] };

    // ppro exports that might be text containers
    const pproTextish = [];
    try {
      for (const k of Object.keys(ppro || {})) {
        if (/text|string|char|font|caption|title/i.test(k)) pproTextish.push(k);
      }
    } catch {
      /* ignore */
    }
    out.pproTextishKeys = pproTextish;

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      const entry = { index: i, displayName: p.displayName, keys: ownKeys(p) };
      // read start value
      try {
        if (typeof p.getStartValue === "function") {
          const sv = await p.getStartValue();
          entry.startType = sv === null || sv === undefined ? String(sv) : typeof sv;
          entry.startCtor = sv && sv.constructor ? sv.constructor.name : null;
          entry.startKeys = sv && typeof sv === "object" ? ownKeys(sv) : null;
          try {
            entry.startJson = JSON.parse(JSON.stringify(sv));
          } catch {
            entry.startStr = String(sv).slice(0, 200);
          }
          if (sv && typeof sv === "object" && "value" in sv) {
            entry.innerType = typeof sv.value;
            entry.innerCtor = sv.value && sv.value.constructor ? sv.value.constructor.name : null;
            entry.innerKeys = sv.value && typeof sv.value === "object" ? ownKeys(sv.value) : null;
          }
        }
      } catch (e) {
        entry.startError = String(e && e.message ? e.message : e);
      }

      // Only try string writes on blank / content-like / last / first params
      const name = (p.displayName || "").trim();
      const tryString = !name || /content|text|source/i.test(name) || i === 0 || i === params.length - 1;
      if (tryString) {
        const candidates = [
          ["string", sample],
          ["json-textEditValue", JSON.stringify({ textEditValue: sample })],
          ["json-capsule", JSON.stringify({ textEditValue: sample, fontSizeEditValue: [48], fontTextRunLength: [sample.length] })],
          ["json-SourceText", JSON.stringify({ SourceText: sample })],
          ["json-text", JSON.stringify({ text: sample })],
          ["empty", ""],
        ];
        // If we have start value object, try mutate clone
        try {
          const sv = await p.getStartValue();
          if (sv && typeof sv === "object") {
            candidates.push(["startValue-as-is", sv]);
            if ("value" in sv) {
              candidates.push(["startValue.value string", { ...sv, value: sample }]);
              candidates.push(["startValue.value only", sample]);
            }
          }
        } catch {
          /* ignore */
        }
        entry.writes = [];
        for (const [label, val] of candidates) {
          try {
            const kf = p.createKeyframe(val);
            entry.writes.push({
              label,
              createKeyframe: "ok",
              kfKeys: kf ? ownKeys(kf) : null,
              kfValType: kf && kf.value !== undefined ? typeof kf.value : null,
            });
            try {
              const action = p.createSetValueAction(kf, true);
              await runTransaction(project, `PPMCP st probe ${i} ${label}`, (c) => c.addAction(action));
              entry.writes[entry.writes.length - 1].setValue = "ok";
              entry.success = label;
              break;
            } catch (e2) {
              entry.writes[entry.writes.length - 1].setValue = String(e2 && e2.message ? e2.message : e2);
            }
          } catch (e) {
            entry.writes.push({ label, createKeyframe: "ERR", error: String(e && e.message ? e.message : e) });
          }
        }
      }
      // Number write for Size-like
      if (/size|opacity|justif/i.test(name)) {
        try {
          const kf = p.createKeyframe(/size/i.test(name) ? 72 : /opacity/i.test(name) ? 100 : 1);
          const action = p.createSetValueAction(kf, true);
          await runTransaction(project, `PPMCP st num ${i}`, (c) => c.addAction(action));
          entry.numberWrite = "ok";
        } catch (e) {
          entry.numberWrite = String(e && e.message ? e.message : e);
        }
      }
      out.params.push(entry);
    }
    return out;
  },

  "debug.introspectParam": async ({ sequenceId, trackType, trackIndex, clipIndex, label }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const track = await getTrack(sequence, trackType || "video", trackIndex);
    const items = await getTrackItems(track);
    const item = items[clipIndex];
    if (!item) throw apiError("debug.introspectParam", new Error("no such clip"));
    const { components } = await getComponents(item);
    const matches = [];
    for (const comp of components) {
      const compName = await getComponentDisplayName(comp);
      const params = await getComponentParams(comp);
      for (const p of params) {
        if (label && p.displayName !== label) continue;
        const entry = { componentDisplayName: compName, paramDisplayName: p.displayName, ownKeys: ownKeys(p) };
        entry.areKeyframesSupported = await safe(() => p.areKeyframesSupported());
        entry.startValue = await safe(async () => {
          const sv = await p.getStartValue();
          return sv ? { keys: ownKeys(sv), value: sv.value } : null;
        });
        entry.createKeyframeString = await safe(() => {
          const kf = p.createKeyframe("test");
          return kf ? ownKeys(kf) : null;
        });
        entry.createKeyframeNumber = await safe(() => {
          const kf = p.createKeyframe(1);
          return kf ? ownKeys(kf) : null;
        });
        entry.createKeyframePoint = await safe(() => {
          const kf = p.createKeyframe(new ppro.PointF(0.5, 0.5));
          return kf ? ownKeys(kf) : null;
        });
        matches.push(entry);
      }
    }
    return { label, matchCount: matches.length, matches };
  },
};
