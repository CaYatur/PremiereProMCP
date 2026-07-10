import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

const TPS = 254016000000n;
const toS = (t) => Number(BigInt(t)) / Number(TPS);

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "diag-final", version: "1.0.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { isError: !!r.isError, text };
}

function extractJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const i = text.indexOf("[");
  const j = text.indexOf("{");
  const start = i >= 0 && (j < 0 || i < j) ? i : j;
  if (start < 0) return null;
  // try parse from start
  for (const endChar of ["]", "}"]) {
    const end = text.lastIndexOf(endChar);
    if (end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

await call("sequence_set_active_by_name", { query: "Final Creative 1783720198964" });

const report = { video: {}, audio: {}, gains: [] };

for (const ti of [0, 1, 2]) {
  const r = await call("clip_list", { trackType: "video", trackIndex: ti });
  const clips = extractJson(r.text) || [];
  report.video[ti] = Array.isArray(clips)
    ? clips.map((c) => ({
        i: c.clipIndex,
        name: c.name,
        start: +toS(c.startTicks).toFixed(2),
        end: +toS(c.endTicks).toFixed(2),
        dur: +toS(c.durationTicks).toFixed(2),
      }))
    : r.text.slice(0, 300);
}

for (const ti of [0, 1, 2]) {
  const r = await call("clip_list", { trackType: "audio", trackIndex: ti });
  const clips = extractJson(r.text) || [];
  report.audio[ti] = Array.isArray(clips)
    ? clips.map((c) => ({
        i: c.clipIndex,
        name: c.name,
        start: +toS(c.startTicks).toFixed(2),
        end: +toS(c.endTicks).toFixed(2),
        dur: +toS(c.durationTicks).toFixed(2),
      }))
    : r.text.slice(0, 300);
}

// Probe Level via debug or effect get if available
const a1 = report.audio[1];
if (Array.isArray(a1)) {
  for (const cl of a1.slice(0, 8)) {
    // try audio normalize read path - set then we already know
    const g = await call("audio_set_gain", { trackIndex: 1, clipIndex: cl.i, decibels: 0 });
    report.gains.push({ track: 1, clip: cl.i, name: cl.name, res: g.text.slice(0, 180) });
  }
}

// Also try effect_get_param style if exists
const tools = await call("edit_help", { topic: "audio" }).catch(() => ({ text: "" }));

fs.writeFileSync("C:/Users/cagan/Desktop/ppmcp-diag-final.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 12000));
console.log("\n... wrote ppmcp-diag-final.json");
console.log("V0 count", Array.isArray(report.video[0]) ? report.video[0].length : "?");
console.log("A1 count", Array.isArray(report.audio[1]) ? report.audio[1].length : "?");
console.log("A2 count", Array.isArray(report.audio[2]) ? report.audio[2].length : "?");
if (Array.isArray(report.video[0]) && report.video[0].length) {
  const last = report.video[0][report.video[0].length - 1];
  console.log("V0 first", report.video[0][0]);
  console.log("V0 last", last);
}
await client.close();
