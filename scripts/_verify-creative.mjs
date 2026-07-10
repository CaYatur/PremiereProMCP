import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const TPS = 254016000000;
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "verify-cut", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  return (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
}
function arr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) { try { const v = JSON.parse(f[1]); if (Array.isArray(v)) return v; } catch {} }
  const i = text.indexOf("["), j = text.lastIndexOf("]");
  if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch {} }
  return [];
}
await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });
const v = arr(await call("clip_list", { trackType: "video", trackIndex: 0 }));
const tx = arr(await call("clip_list", { trackType: "video", trackIndex: 2 }));
console.log("VIDEO", v.length, "clips, end", v.length ? (Number(v[v.length-1].endTicks)/TPS).toFixed(1)+"s" : "?");
console.log(v.map(c => c.name.replace(".mp4","")).join(" → "));
console.log("TEXT", tx.map(c => `${c.name.slice(0,40)} @${(Number(c.startTicks)/TPS).toFixed(1)}s d=${(Number(c.durationTicks)/TPS).toFixed(1)}`));
let aN = 0, aEnd = 0;
for (const ti of [0,1,2]) {
  const a = arr(await call("clip_list", { trackType: "audio", trackIndex: ti }));
  aN += a.length;
  for (const c of a) aEnd = Math.max(aEnd, Number(c.endTicks)/TPS);
}
console.log("AUDIO clips", aN, "last end", aEnd.toFixed(1)+"s");
// sample gain
const g0 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("gain A1[0]", g0.slice(0, 200).replace(/\s+/g," "));
await c.close();
