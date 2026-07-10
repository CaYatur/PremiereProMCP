import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "audio-deep", version: "1.0.0" });
await c.connect(t);

async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}

function extract(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) {
    try { return JSON.parse(f[1]); } catch {}
  }
  return text;
}

const out = { probes: [], checkpoints: [], notes: [] };

// List checkpoints
const cpRoot = path.join(os.homedir(), ".ppmcp", "checkpoints");
out.cpRoot = cpRoot;
if (fs.existsSync(cpRoot)) {
  for (const id of fs.readdirSync(cpRoot)) {
    const metaP = path.join(cpRoot, id, "meta.json");
    if (!fs.existsSync(metaP)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
      const projExists = fs.existsSync(meta.checkpointProjectPath);
      const size = projExists ? fs.statSync(meta.checkpointProjectPath).size : 0;
      out.checkpoints.push({
        id: meta.id,
        label: meta.label,
        createdAt: meta.createdAt,
        source: meta.sourceProjectPath,
        dest: meta.checkpointProjectPath,
        destExists: projExists,
        destBytes: size,
        sourceExists: meta.sourceProjectPath ? fs.existsSync(meta.sourceProjectPath.replace(/^\\\\\?\\/, "")) : false,
      });
    } catch (e) {
      out.checkpoints.push({ id, error: String(e) });
    }
  }
}

await call("edit_bootstrap", { compact: true });
// Prefer Creative Cut if present
const act = await call("sequence_set_active_by_name", { query: "Creative Cut" });
out.active = extract(act.text);

// List audio clips A0-A2
for (const ti of [0, 1, 2]) {
  const r = await call("clip_list", { trackType: "audio", trackIndex: ti });
  const j = extract(r.text);
  const clips = Array.isArray(j) ? j : [];
  out[`A${ti}`] = clips.map((c) => ({ i: c.clipIndex, name: c.name, start: c.startTicks }));
}

// Deep probe via debug.listParams on first audio clip found
const targets = [];
for (const ti of [0, 1, 2]) {
  for (const c of out[`A${ti}`] || []) {
    targets.push({ trackIndex: ti, clipIndex: c.i, name: c.name });
  }
}
out.targetCount = targets.length;

// For first 3 clips: getGain, set various values, getGain again
const testVals = [0, 1, 0.5, 6, -6, 100, 0.891250938, 1.0];
const sample = targets.slice(0, 2);
for (const tgt of sample) {
  const series = { clip: tgt, steps: [] };
  // initial read
  let g = await call("audio_get_gain", { trackIndex: tgt.trackIndex, clipIndex: tgt.clipIndex });
  series.steps.push({ op: "get_initial", res: extract(g.text) });

  // debug list params if tool exists via relay - use effect_list_applied
  const applied = await call("effect_list_applied", {
    trackType: "audio",
    trackIndex: tgt.trackIndex,
    clipIndex: tgt.clipIndex,
  });
  series.steps.push({ op: "list_applied", res: extract(applied.text) });

  for (const v of testVals) {
    const s = await call("audio_set_gain", {
      trackIndex: tgt.trackIndex,
      clipIndex: tgt.clipIndex,
      decibels: v,
    });
    const after = await call("audio_get_gain", {
      trackIndex: tgt.trackIndex,
      clipIndex: tgt.clipIndex,
    });
    series.steps.push({
      write: v,
      set: extract(s.text),
      read: extract(after.text),
    });
  }
  // final force 0
  await call("audio_set_gain", { trackIndex: tgt.trackIndex, clipIndex: tgt.clipIndex, decibels: 0 });
  out.probes.push(series);
}

// Also try debug.listParams via a raw approach - effect_get_param Volume Level
for (const ei of [0, 1, 2, 3, 4]) {
  const r = await call("effect_get_param", {
    trackType: "audio",
    trackIndex: sample[0]?.trackIndex ?? 1,
    clipIndex: sample[0]?.clipIndex ?? 0,
    effectIndex: ei,
    paramName: "Level",
  });
  out.probes.push({ effectIndex: ei, level: extract(r.text), err: r.isError });
}

fs.writeFileSync(
  path.join(os.homedir(), "Desktop", "ppmcp-audio-probe.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2).slice(0, 14000));
console.log("\n... wrote Desktop/ppmcp-audio-probe.json");
await c.close();
