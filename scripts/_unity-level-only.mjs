import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const UNITY = Math.pow(10, (0 - 15) / 20); // 0 dB if top=+15
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "unity-only", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  return (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
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
  for (const cl of arr(await call("clip_list", { trackType: "audio", trackIndex: ti }))) {
    await call("effect_set_param", {
      trackType: "audio", trackIndex: ti, clipIndex: cl.clipIndex,
      effectIndex: 0, paramName: "Level", value: UNITY,
    });
    await call("effect_set_param", {
      trackType: "audio", trackIndex: ti, clipIndex: cl.clipIndex,
      effectIndex: 0, paramName: "Mute", value: 0,
    });
    n++;
  }
}
// verify Level only via effect_get is empty; use audio_get and parse value
const g = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
const m = g.match(/"value":\s*([0-9.]+)/);
console.log("clips", n, "unityLinear", UNITY, "A1[0] value", m?.[1] || g.slice(0, 150));
await call("project_save", {});
await c.close();
console.log("OK — Level set to ~0.178 (0 dB). Do NOT call old setGain until plugin reload.");
