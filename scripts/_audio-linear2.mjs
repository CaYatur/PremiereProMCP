import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "audio-linear", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function j(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { return JSON.parse(f[1]); } catch {}
  return text.slice(0, 300);
}

await call("sequence_set_active_by_name", { query: "Creative Cut" });

// Use effect_set_param to write raw values without our dB clamp
const ti = 0, ci = 0;

// Read Mute (param via effect_get_param effectIndex 0)
for (const [ei, pn] of [[0, "Mute"], [0, "Level"], [1, "Left"], [1, "Right"], [1, "Bypass"]]) {
  const r = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: ei, paramName: pn });
  console.log("GET", ei, pn, JSON.stringify(j(r.text)));
}

// Write Level as linear 1.0 via effect_set_param
console.log("SET Level=1 via effect_set_param");
let r = await call("effect_set_param", {
  trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Level", value: 1,
});
console.log(r.text.slice(0, 200));
r = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Level" });
console.log("Level after 1:", JSON.stringify(j(r.text)));

// Try 2.0 for boost
r = await call("effect_set_param", {
  trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Level", value: 2,
});
console.log("set 2", r.text.slice(0, 150));
r = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Level" });
console.log("Level after 2:", JSON.stringify(j(r.text)));

// Mute false
r = await call("effect_set_param", {
  trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Mute", value: false,
});
console.log("mute false", r.text.slice(0, 150), r.isError);
r = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Mute" });
console.log("Mute after:", JSON.stringify(j(r.text)));

// Channel Left/Right = 1
for (const pn of ["Left", "Right"]) {
  r = await call("effect_set_param", {
    trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 1, paramName: pn, value: 1,
  });
  console.log("set", pn, r.isError, r.text.slice(0, 120));
  const g = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 1, paramName: pn });
  console.log("get", pn, JSON.stringify(j(g.text)));
}

// Try Mute as 0 number
r = await call("effect_set_param", {
  trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Mute", value: 0,
});
console.log("mute 0", r.isError, r.text.slice(0, 150));
r = await call("effect_get_param", { trackType: "audio", trackIndex: ti, clipIndex: ci, effectIndex: 0, paramName: "Mute" });
console.log("Mute after 0:", JSON.stringify(j(r.text)));

// audio_set_gain with our broken path after fix we'll do - for now linear 1 via setGain writing 1
r = await call("audio_set_gain", { trackIndex: ti, clipIndex: ci, decibels: 1 });
console.log("setGain 1", j(r.text));
r = await call("audio_get_gain", { trackIndex: ti, clipIndex: ci });
console.log("getGain", j(r.text));

await c.close();
