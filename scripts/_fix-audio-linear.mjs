import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "fix-linear", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function j(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { return JSON.parse(f[1]); } catch {}
  return null;
}

console.log("bootstrap", (await call("edit_bootstrap", { compact: true })).text.slice(0, 120));
await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });

// Fix all to unity 0 dB (linear 1.0)
const fix = await call("audio_fix_levels", { allClips: true, mode: "unity", targetDb: 0 });
console.log("FIX", fix.text.slice(0, 300));

// Probe several clips
for (const [ti, ci] of [[0, 0], [1, 0], [1, 5], [2, 0]]) {
  const g = await call("audio_get_gain", { trackIndex: ti, clipIndex: ci });
  console.log(`A${ti}[${ci}]`, g.text.slice(0, 180).replace(/\s+/g, " "));
}

// Explicit set 0 on A1[0] and read
const s = await call("audio_set_gain", { trackIndex: 1, clipIndex: 0, decibels: 0 });
console.log("SET0", s.text.slice(0, 250).replace(/\s+/g, " "));
const g2 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("GET0", g2.text.slice(0, 200).replace(/\s+/g, " "));

// -6 dB should be ~0.5 linear
const s2 = await call("audio_set_gain", { trackIndex: 1, clipIndex: 0, decibels: -6 });
console.log("SET-6", s2.text.slice(0, 250).replace(/\s+/g, " "));
const g3 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("GET-6", g3.text.slice(0, 200).replace(/\s+/g, " "));

// back to 0
await call("audio_set_gain", { trackIndex: 1, clipIndex: 0, decibels: 0 });
await call("audio_fix_levels", { allClips: true, mode: "unity", targetDb: 0 });
await call("project_save", {});
await c.close();
console.log("DONE");
