import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const SRC = "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\whoosh_01.wav";
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "probe-0db", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function j(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { return JSON.parse(f[1]); } catch {}
  return text.slice(0, 400);
}

await call("edit_bootstrap", { compact: true });
// Fresh sequence with ONE audio only — do NOT set gain after place if possible
const name = "GainProbe " + Date.now();
// place via sfx will set gain - instead import + overwrite only
await call("edit_run", {
  stopOnError: true,
  compact: true,
  plan: [
    { op: "sequence_from_media", paths: ["C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\intro_blue_3s.mp4"], name },
    { op: "set_active", query: name },
  ],
});
await call("sequence_set_active_by_name", { query: name });

// Place audio with clip_overwrite path if possible - use edit_once sfx then READ before fix
// Better: project import + clip_overwrite without setGain
const imp = await call("project_import_media", { paths: [SRC] });
console.log("import", imp.text.slice(0, 150));
const itemsT = await call("project_list_items", { recursive: true });
// find whoosh id from json
let mediaId;
try {
  const arr = JSON.parse(itemsT.text.slice(itemsT.text.indexOf("["), itemsT.text.lastIndexOf("]") + 1));
  const hits = [];
  function walk(a) {
    for (const it of a || []) {
      if (it.isBin && it.children) walk(it.children);
      else if ((it.name || "").toLowerCase().includes("whoosh_01")) hits.push(it);
    }
  }
  // flat list may not nest
  const flat = [];
  const re = /"name":"([^"]+)","id":"([^"]+)"/g;
  let m;
  while ((m = re.exec(itemsT.text))) flat.push({ name: m[1], id: m[2] });
  const hit = flat.reverse().find((x) => x.name.toLowerCase() === "whoosh_01.wav");
  mediaId = hit?.id;
  console.log("mediaId", mediaId, "from", flat.filter(x=>/whoosh_01/i.test(x.name)).slice(-3));
} catch (e) {
  console.log("parse fail", e.message);
}

if (mediaId) {
  const ov = await call("clip_overwrite", {
    trackType: "audio",
    trackIndex: 1,
    projectItemId: mediaId,
    atTicks: "0",
  });
  console.log("overwrite", ov.text.slice(0, 200));
}

// Read DEFAULT values with no setGain
console.log("\n=== DEFAULT (no setGain) ===");
for (const [ei, pn] of [[0,"Mute"],[0,"Level"],[1,"Bypass"],[1,"Left"],[1,"Right"]]) {
  const r = await call("effect_get_param", { trackType:"audio", trackIndex:1, clipIndex:0, effectIndex:ei, paramName:pn });
  console.log("GET", ei, pn, JSON.stringify(j(r.text)));
}
const g0 = await call("audio_get_gain", { trackIndex:1, clipIndex:0 });
console.log("getGain default", g0.text.slice(0, 250));

// Try writing various LINEAR values and report readback
// Use effect_set_param for raw values
const trials = [0, 0.25, 0.5, 0.707, 0.8, 0.891, 1.0, 1.122, 1.5, 2, 3, 4, 5, 6, 10, 15, 100];
console.log("\n=== RAW Level writes ===");
for (const v of trials) {
  await call("effect_set_param", { trackType:"audio", trackIndex:1, clipIndex:0, effectIndex:0, paramName:"Level", value: v });
  const g = await call("audio_get_gain", { trackIndex:1, clipIndex:0 });
  const data = j(g.text);
  const lin = data?.value?.value ?? data?.linear ?? data?.value;
  console.log("write", String(v).padStart(6), "→ read", lin, "json", JSON.stringify(data).slice(0, 120));
}

// Channel volume defaults after reset - try NOT touching channels
// Reset Level to default by... we don't know default. Leave at 1 for now.

// Probe: only set Level via NEW setGain after checking plugin note
const sg = await call("audio_set_gain", { trackIndex:1, clipIndex:0, decibels: 0 });
console.log("\nsetGain(0) response", sg.text.slice(0, 350));
const g1 = await call("audio_get_gain", { trackIndex:1, clipIndex:0 });
console.log("after setGain0", g1.text.slice(0, 250));

// What if Channel L/R at 0 means unity and 1 means +something?
console.log("\n=== Channel Volume probe ===");
for (const v of [0, 0.5, 1, -1, 100]) {
  await call("effect_set_param", { trackType:"audio", trackIndex:1, clipIndex:0, effectIndex:1, paramName:"Left", value: v });
  const r = await call("effect_get_param", { trackType:"audio", trackIndex:1, clipIndex:0, effectIndex:1, paramName:"Left" });
  console.log("Left write", v, "→", JSON.stringify(j(r.text)).slice(0,100));
}

await c.close();
