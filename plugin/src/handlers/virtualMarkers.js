// Fallback sequence markers stored on the Sequence Properties object when
// Markers.createAddMarkerAction fails on this Premiere build.
// Key: "PPMCP_MARKERS" — JSON array of { id, name, comment, atTicks, durationTicks }.
// Native Premiere markers (if any) are still listed first by marker.list.

const MARKER_PROP = "PPMCP_MARKERS";

async function getProperties(sequence, ppro) {
  if (!ppro.Properties || typeof ppro.Properties.getProperties !== "function") {
    return null;
  }
  return ppro.Properties.getProperties(sequence);
}

async function readVirtual(sequence, ppro) {
  try {
    const props = await getProperties(sequence, ppro);
    if (!props || typeof props.getValue !== "function") return [];
    const raw = props.getValue(MARKER_PROP);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeVirtual(project, sequence, ppro, list, runTransaction) {
  const props = await getProperties(sequence, ppro);
  if (!props) {
    const e = new Error("Sequence Properties API unavailable for virtual markers.");
    e.code = "PREMIERE_API_ERROR";
    throw e;
  }
  const json = JSON.stringify(list);
  const propType =
    (ppro.Constants && ppro.Constants.PropertyType && ppro.Constants.PropertyType.NON_PERSISTENT) ||
    (ppro.Constants && ppro.Constants.PropertyType && ppro.Constants.PropertyType.PERSISTENT) ||
    0;

  runTransaction(project, "PPMCP virtual markers", (c) => {
    let action;
    if (typeof props.createSetValueAction === "function") {
      try {
        action = props.createSetValueAction(MARKER_PROP, json, propType);
      } catch {
        action = props.createSetValueAction(MARKER_PROP, json);
      }
    }
    if (!action) throw new Error("createSetValueAction failed for virtual markers");
    c.addAction(action);
  });
}

module.exports = { MARKER_PROP, readVirtual, writeVirtual, getProperties };
