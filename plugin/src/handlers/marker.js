// Markers: try native Adobe path first (create action inside lockedAccess
// transaction). If that fails on this build, fall back to virtual markers
// stored on Sequence Properties so MCP tools still work for list/go_to.

const { apiError, ppro, getActiveProject, getSequence, tickTime, runTransaction } = require("../ppro.js");
const { readVirtual, writeVirtual } = require("./virtualMarkers.js");

async function getMarkers(sequence) {
  return ppro.Markers.getMarkers(sequence);
}

function markerTypeValue(requested) {
  const M = ppro.Marker || {};
  const map = {
    comment: M.MARKER_TYPE_COMMENT ?? "Comment",
    chapter: M.MARKER_TYPE_CHAPTER ?? "Chapter",
    weblink: M.MARKER_TYPE_WEBLINK ?? "WebLink",
    flashcue: M.MARKER_TYPE_FLVCUEPOINT ?? M.MARKER_TYPE_FLASHCUE ?? "FlashCuePoint",
    segue: M.MARKER_TYPE_SEGUE ?? "Segue",
  };
  if (!requested) return map.comment;
  return map[String(requested).toLowerCase()] ?? requested;
}

function startTimeFromTicks(atTicks) {
  if (atTicks === undefined || atTicks === null || atTicks === "0" || atTicks === 0) {
    if (ppro.TickTime.createWithSeconds) return ppro.TickTime.createWithSeconds(0.0);
    return ppro.TickTime.TIME_ZERO;
  }
  try {
    if (ppro.TickTime.createWithSeconds) {
      const seconds = Number(BigInt(String(atTicks))) / 254016000000;
      if (Number.isFinite(seconds)) return ppro.TickTime.createWithSeconds(seconds);
    }
  } catch {
    /* fall through */
  }
  return tickTime(String(atTicks));
}

async function nativeList(sequence) {
  try {
    const markers = await getMarkers(sequence);
    let list = markers.getMarkers();
    if (list && typeof list.then === "function") list = await list;
    const out = [];
    for (let i = 0; i < (list || []).length; i++) {
      const m = list[i];
      out.push({
        markerIndex: i,
        name: await m.getName(),
        comment: await m.getComments(),
        startTicks: String((await m.getStart()).ticks),
        durationTicks: String((await m.getDuration()).ticks),
        type: await m.getType(),
        source: "native",
      });
    }
    return out;
  } catch {
    return [];
  }
}

module.exports = {
  "marker.add": async ({ sequenceId, atTicks, name, comment, durationTicks, markerType }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const typeVal = markerTypeValue(markerType);
    const start = startTimeFromTicks(atTicks);
    const duration = durationTicks ? tickTime(durationTicks) : ppro.TickTime.TIME_ZERO;
    const markerName = name || "Marker";
    const markerComment = comment || "";

    // 1) Native Premiere markers — try several type/duration combos (build-dependent)
    const nativeErrors = [];
    const typeCandidates = [
      typeVal,
      ppro.Marker && ppro.Marker.MARKER_TYPE_COMMENT,
      "Comment",
      0,
      1,
    ].filter((t, i, a) => t !== undefined && t !== null && a.indexOf(t) === i);
    const durationCandidates = [
      duration,
      ppro.TickTime.TIME_ZERO,
      ppro.TickTime.createWithSeconds ? ppro.TickTime.createWithSeconds(0.1) : null,
    ].filter(Boolean);

    for (const t of typeCandidates) {
      for (const d of durationCandidates) {
        try {
          const markers = await getMarkers(sequence);
          runTransaction(project, `PPMCP marker_add t=${t}`, (compoundAction) => {
            const action = markers.createAddMarkerAction(markerName, t, start, d, markerComment);
            if (!action) throw new Error("createAddMarkerAction returned null");
            const ok = compoundAction.addAction(action);
            if (ok === false) throw new Error("addAction returned false");
          });
          return {
            added: true,
            source: "native",
            markerType: t,
            name: markerName,
          };
        } catch (err) {
          nativeErrors.push(`t=${t}: ${err && err.message ? err.message : err}`);
        }
      }
    }

    // 2) Virtual markers via Sequence Properties (always available)
    try {
      const virtual = await readVirtual(sequence, ppro);
      const entry = {
        id: `v${Date.now()}_${virtual.length}`,
        name: markerName,
        comment: markerComment,
        atTicks: String(atTicks ?? "0"),
        durationTicks: String(durationTicks ?? "0"),
        type: String(typeVal),
      };
      virtual.push(entry);
      await writeVirtual(project, sequence, ppro, virtual, runTransaction);
      return {
        added: true,
        source: "virtual",
        name: markerName,
        note:
          "Native Markers.createAddMarkerAction failed on this Premiere build; stored as PPMCP sequence property so list/go_to still work (not visible as Premiere UI marker).",
        nativeErrors: nativeErrors.slice(0, 4),
      };
    } catch (virtErr) {
      throw apiError(
        "marker.add",
        new Error(
          `Native: ${nativeErrors.slice(0, 3).join(" | ")}; Virtual: ${virtErr && virtErr.message ? virtErr.message : virtErr}`,
        ),
      );
    }
  },

  "marker.list": async ({ sequenceId }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    try {
      const native = await nativeList(sequence);
      const virtual = await readVirtual(sequence, ppro);
      const vMapped = virtual.map((v, i) => ({
        markerIndex: native.length + i,
        name: v.name,
        comment: v.comment,
        startTicks: v.atTicks,
        durationTicks: v.durationTicks || "0",
        type: v.type || "Comment",
        source: "virtual",
        id: v.id,
      }));
      return [...native, ...vMapped];
    } catch (err) {
      throw apiError("marker.list", err);
    }
  },

  "marker.update": async ({ sequenceId, markerIndex, name, comment, atTicks, durationTicks }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const native = await nativeList(sequence);
    if (markerIndex < native.length) {
      try {
        const markers = await getMarkers(sequence);
        let list = markers.getMarkers();
        if (list && typeof list.then === "function") list = await list;
        const marker = list[markerIndex];
        runTransaction(project, "PPMCP marker_update", (c) => {
          if (name !== undefined) c.addAction(marker.createSetNameAction(name));
          if (comment !== undefined) c.addAction(marker.createSetCommentsAction(comment));
          if (durationTicks !== undefined) c.addAction(marker.createSetDurationAction(tickTime(durationTicks)));
          if (atTicks !== undefined) c.addAction(markers.createMoveMarkerAction(marker, startTimeFromTicks(atTicks)));
        });
        return { updated: true, source: "native" };
      } catch (err) {
        throw apiError("marker.update", err);
      }
    }
    const virtual = await readVirtual(sequence, ppro);
    const vi = markerIndex - native.length;
    if (vi < 0 || vi >= virtual.length) {
      const e = new Error(`No marker at index ${markerIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    if (name !== undefined) virtual[vi].name = name;
    if (comment !== undefined) virtual[vi].comment = comment;
    if (atTicks !== undefined) virtual[vi].atTicks = String(atTicks);
    if (durationTicks !== undefined) virtual[vi].durationTicks = String(durationTicks);
    await writeVirtual(project, sequence, ppro, virtual, runTransaction);
    return { updated: true, source: "virtual" };
  },

  "marker.remove": async ({ sequenceId, markerIndex }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const native = await nativeList(sequence);
    if (markerIndex < native.length) {
      try {
        const markers = await getMarkers(sequence);
        let list = markers.getMarkers();
        if (list && typeof list.then === "function") list = await list;
        const marker = list[markerIndex];
        runTransaction(project, "PPMCP marker_remove", (c) => {
          c.addAction(markers.createRemoveMarkerAction(marker));
        });
        return { removed: true, source: "native" };
      } catch (err) {
        throw apiError("marker.remove", err);
      }
    }
    const virtual = await readVirtual(sequence, ppro);
    const vi = markerIndex - native.length;
    if (vi < 0 || vi >= virtual.length) {
      const e = new Error(`No marker at index ${markerIndex}.`);
      e.code = "NOT_FOUND";
      throw e;
    }
    virtual.splice(vi, 1);
    await writeVirtual(project, sequence, ppro, virtual, runTransaction);
    return { removed: true, source: "virtual" };
  },
};
