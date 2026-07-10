// Shape master properties (Position/Size/Color) on our own Basic Shape.mogrt.
// Size was never successfully exposed from AE (template authoring gap).
// Fallbacks: Motion Scale / Scale Width / Scale Height, or a synthetic
// size via Scale percentage relative to default 400x200 design size.

const {
  apiError,
  ppro,
  getActiveProject,
  getSequence,
  getTrack,
  getTrackItems,
  findParamByLabel,
  setParamValue,
  getComponents,
  getComponentDisplayName,
  getComponentParams,
} = require("../ppro.js");

const DEFAULT_DESIGN_W = 400;
const DEFAULT_DESIGN_H = 200;

async function getShapeItem(sequenceId, trackIndex, clipIndex) {
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

async function setLabeled(project, item, label, value, methodName) {
  const param = await findParamByLabel(item, label);
  if (!param) {
    const e = new Error(`Could not find a "${label}" master property on this clip — is it a PPMCP shape graphic?`);
    e.code = "NOT_FOUND";
    throw e;
  }
  await setParamValue(project, param, value, methodName);
  return { label };
}

async function listParamNames(item) {
  const { components } = await getComponents(item);
  const names = [];
  for (const comp of components) {
    const cn = await getComponentDisplayName(comp);
    const params = await getComponentParams(comp);
    for (const p of params) names.push(`${cn}.${p.displayName}`);
  }
  return names;
}

module.exports = {
  "shape.setPosition": async ({ sequenceId, trackIndex, clipIndex, x, y }) => {
    const { project, item } = await getShapeItem(sequenceId, trackIndex, clipIndex);
    await setLabeled(project, item, "Position", new ppro.PointF(x, y), "PPMCP shape_set_position");
    return { x, y };
  },

  "shape.setSize": async ({ sequenceId, trackIndex, clipIndex, width, height }) => {
    const { project, item } = await getShapeItem(sequenceId, trackIndex, clipIndex);
    const w = Number(width);
    const h = Number(height);
    const errors = [];

    // 1) True "Size" master property (PointF) — preferred if AE expose worked.
    try {
      const sizeParam = await findParamByLabel(item, "Size", { retries: 2 });
      if (sizeParam) {
        // Try PointF, then [w,h], then separate numbers
        for (const [kind, value] of [
          ["PointF", new ppro.PointF(w, h)],
          ["array", [w, h]],
          ["width-only-number", w],
        ]) {
          try {
            await setParamValue(project, sizeParam, value, `PPMCP shape_set_size (${kind})`);
            return { width: w, height: h, via: `Size/${kind}` };
          } catch (e) {
            errors.push(`Size/${kind}: ${e.message}`);
          }
        }
      } else {
        errors.push("Size param not found");
      }
    } catch (e) {
      errors.push(`Size: ${e.message}`);
    }

    // 2) Uniform Scale (%) so visual size ≈ design size * scale/100
    //    Use average of w/h relative to default design size.
    try {
      const scaleParam = await findParamByLabel(item, "Scale", { retries: 1 });
      if (scaleParam) {
        const scalePct = ((w / DEFAULT_DESIGN_W + h / DEFAULT_DESIGN_H) / 2) * 100;
        await setParamValue(project, scaleParam, scalePct, "PPMCP shape_set_size via Scale");
        return {
          width: w,
          height: h,
          via: "Scale",
          scalePercent: scalePct,
          note: "Size master property missing on template; approximated via Motion/graphic Scale.",
        };
      }
      errors.push("Scale param not found");
    } catch (e) {
      errors.push(`Scale: ${e.message}`);
    }

    // 3) Scale Width / Scale Height if present
    try {
      const sw = await findParamByLabel(item, "Scale Width", { retries: 0 });
      const sh = await findParamByLabel(item, "Scale Height", { retries: 0 });
      if (sw || sh) {
        if (sw) await setParamValue(project, sw, (w / DEFAULT_DESIGN_W) * 100, "PPMCP shape Scale Width");
        if (sh) await setParamValue(project, sh, (h / DEFAULT_DESIGN_H) * 100, "PPMCP shape Scale Height");
        return { width: w, height: h, via: "Scale Width/Height" };
      }
      errors.push("Scale Width/Height not found");
    } catch (e) {
      errors.push(`Scale W/H: ${e.message}`);
    }

    const names = await listParamNames(item);
    const e = new Error(
      `Could not set size. Attempts: ${errors.join(" ;; ")}. Available params: ${names.join(", ")}`,
    );
    e.code = "NOT_FOUND";
    throw e;
  },

  "shape.setFillColor": async ({ sequenceId, trackIndex, clipIndex, r, g, b, a }) => {
    const { project, item } = await getShapeItem(sequenceId, trackIndex, clipIndex);
    const alpha = a === undefined ? 255 : a;
    const color = new ppro.Color(r, g, b, alpha);
    // Try Color, then Fill Color, then Main Color
    for (const label of ["Color", "Fill Color", "Main Color", "Fill"]) {
      try {
        await setLabeled(project, item, label, color, `PPMCP shape_set_fill_color (${label})`);
        return { r, g, b, a: alpha, via: label };
      } catch (e) {
        if (e.code !== "NOT_FOUND") {
          // param found but set failed — keep trying labels
          if (!String(e.message).includes("Could not find")) throw e;
        }
      }
    }
    const e = new Error("Could not find a Color/Fill Color master property on this clip.");
    e.code = "NOT_FOUND";
    throw e;
  },
};
