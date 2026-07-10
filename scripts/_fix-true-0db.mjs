import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 0 dB → linear for +15dB rubber-band top
const UNITY_LINEAR = Math.pow(10, (0 - 15) / 20); // ~0.177827941
console.log("unity linear", UNITY_LINEAR);

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "fix-0db", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function arr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { const v = JSON.parse(f[1]); if (Array.isArray(v)) return v; } catch {}
  const i = text.indexOf("["), k = text.lastIndexOf("]");
  if (i >= 0 && k > i) try { return JSON.parse(text.slice(i, k + 1)); } catch {}
  return [];
}

await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });

let n = 0;
for (const ti of [0, 1, 2]) {
  const clips = arr((await call("clip_list", { trackType: "audio", trackIndex: ti })).text);
  for (const cl of clips) {
    // Only Level — do NOT touch Channel Volume
    await call("effect_set_param", {
      trackType: "audio",
      trackIndex: ti,
      clipIndex: cl.clipIndex,
      effectIndex: 0,
      paramName: "Level",
      value: UNITY_LINEAR,
    });
    await call("effect_set_param", {
      trackType: "audio",
      trackIndex: ti,
      clipIndex: cl.clipIndex,
      effectIndex: 0,
      paramName: "Mute",
      value: 0,
    });
    n++;
  }
}
console.log("set Level to unity linear on", n, "clips");

// Verify via audio_set_gain after hoping plugin reloaded - also raw get
for (const [ti, ci] of [[0, 0], [1, 0], [2, 0]]) {
  const g = await call("audio_get_gain", { trackIndex: ti, clipIndex: ci });
  console.log(`A${ti}[${ci}]`, g.text.slice(0, 220).replace(/\s+/g, " "));
}

// Force through setGain(0) if new plugin loaded
const s = await call("audio_set_gain", { trackIndex: 1, clipIndex: 0, decibels: 0 });
console.log("setGain0", s.text.slice(0, 280).replace(/\s+/g, " "));
const g2 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("after", g2.text.slice(0, 220).replace(/\s+/g, " "));

await call("project_save", {});
await c.close();
console.log("DONE");
