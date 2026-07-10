import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "mass-linear1", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function arr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { const v = JSON.parse(f[1]); if (Array.isArray(v)) return v; } catch {}
  const i = text.indexOf("["), j = text.lastIndexOf("]");
  if (i >= 0 && j > i) try { return JSON.parse(text.slice(i, j + 1)); } catch {}
  return [];
}

await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });

let fixed = 0, failed = 0;
for (const ti of [0, 1, 2, 3, 4, 5]) {
  const clips = arr((await call("clip_list", { trackType: "audio", trackIndex: ti })).text);
  console.log(`A${ti} clips=${clips.length}`);
  for (const cl of clips) {
    const ci = cl.clipIndex;
    // RAW linear 1.0 via effect_set_param (works without audio.js reload)
    const ops = [
      { effectIndex: 0, paramName: "Level", value: 1 },
      { effectIndex: 0, paramName: "Mute", value: 0 },
      { effectIndex: 1, paramName: "Left", value: 1 },
      { effectIndex: 1, paramName: "Right", value: 1 },
    ];
    let ok = true;
    for (const op of ops) {
      const r = await call("effect_set_param", {
        trackType: "audio",
        trackIndex: ti,
        clipIndex: ci,
        ...op,
      });
      if (r.isError && op.paramName === "Level") ok = false;
    }
    try {
      await call("audio_set_mute", { trackIndex: ti, clipIndex: ci, muted: false });
    } catch {}
    if (ok) fixed++; else failed++;
  }
}
console.log(`DONE fixed=${fixed} failed=${failed}`);

// Verify with effect path: set Level 1 then audio_get_gain
await call("effect_set_param", { trackType: "audio", trackIndex: 1, clipIndex: 0, effectIndex: 0, paramName: "Level", value: 1 });
const g = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("VERIFY A1[0]", g.text.slice(0, 250).replace(/\s+/g, " "));

// Also try setGain with decibels:1 which OLD plugin writes as linear 1 (lucky hack!)
// After plugin reload, decibels:0 will map to linear 1.
const s = await call("audio_set_gain", { trackIndex: 1, clipIndex: 1, decibels: 1 });
console.log("old-path setGain(1)", s.text.slice(0, 200).replace(/\s+/g, " "));
const g2 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 1 });
console.log("old-path get", g2.text.slice(0, 200).replace(/\s+/g, " "));

await call("project_save", {});
await c.close();
