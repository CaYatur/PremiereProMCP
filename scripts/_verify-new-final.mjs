import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const TPS = 254016000000n;
const toS = (t) => Number(BigInt(t)) / Number(TPS);
const transport = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const client = new Client({ name: "verify-fix", version: "1.0.0" });
await client.connect(transport);
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return text;
}
function extract(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const i = text.indexOf("[");
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i, text.lastIndexOf("]") + 1)); } catch { return null; }
}
await call("sequence_set_active_by_name", { query: "Final Creative 1783720639001" });
const v = extract(await call("clip_list", { trackType: "video", trackIndex: 0 }));
const t = extract(await call("clip_list", { trackType: "video", trackIndex: 2 }));
console.log("=== V0 (" + (v?.length||0) + " clips) ===");
for (const c of v || []) console.log(c.clipIndex, c.name, toS(c.startTicks).toFixed(2)+"-"+toS(c.endTicks).toFixed(2));
console.log("=== V2 TEXT (" + (t?.length||0) + ") ===");
for (const c of t || []) console.log(c.clipIndex, c.name, toS(c.startTicks).toFixed(2)+"-"+toS(c.endTicks).toFixed(2)+"s dur="+toS(c.durationTicks).toFixed(2));
let aMax = 0, aCount = 0;
for (const ti of [0,1,2]) {
  const a = extract(await call("clip_list", { trackType: "audio", trackIndex: ti }));
  console.log("=== A"+ti+" ("+(a?.length||0)+") ===");
  for (const c of a || []) {
    const end = toS(c.endTicks);
    if (end > aMax) aMax = end;
    aCount++;
    console.log(c.clipIndex, (c.name||"").slice(0,36), toS(c.startTicks).toFixed(2)+"-"+end.toFixed(2));
  }
}
const vEnd = v?.length ? toS(v[v.length-1].endTicks) : 0;
console.log("\nSUMMARY videoEnd="+vEnd.toFixed(2)+"s audioEnd="+aMax.toFixed(2)+"s audioClips="+aCount);
await client.close();
