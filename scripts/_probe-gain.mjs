import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "gain-probe", version: "1.0.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { isError: !!r.isError, text };
}

// Use raw relay via a known path - effect_get_param or try calling through edit
// First set gain to known values and see if we can read via plugin debug
// Try effect_get_param on audio clip - might only work video

// Test writing different scales on clip 0 of A1
const tests = [
  { decibels: 0, label: "db0" },
  { decibels: -6, label: "db-6" },
];

await call("sequence_set_active_by_name", { query: "Final Creative 1783720198964" });

// Probe via project - use audio_set_gain then try clip_get_properties
for (const t of tests) {
  const g = await call("audio_set_gain", { trackIndex: 1, clipIndex: 0, decibels: t.decibels });
  console.log("SET", t.label, g.text.slice(0, 200).replace(/\s+/g, " "));
  const p = await call("clip_get_properties", { trackType: "audio", trackIndex: 1, clipIndex: 0 });
  console.log("PROPS", p.text.slice(0, 500).replace(/\s+/g, " "));
}

// Try effect_get_param Level
const e = await call("effect_get_param", {
  trackType: "audio",
  trackIndex: 1,
  clipIndex: 0,
  effectName: "Volume",
  paramName: "Level",
});
console.log("EFFECT_GET", e.text.slice(0, 800));

// Also try with display names
const e2 = await call("effect_get_param", {
  trackType: "audio",
  trackIndex: 1,
  clipIndex: 0,
  paramName: "Level",
});
console.log("EFFECT_GET2", e2.text.slice(0, 800));

await client.close();
