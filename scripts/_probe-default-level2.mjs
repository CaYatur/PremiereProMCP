import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "probe-default-level", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  return { isError: !!r.isError, text };
}
function j(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { return JSON.parse(f[1]); } catch {}
  return null;
}
function arr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) try { const v = JSON.parse(f[1]); if (Array.isArray(v)) return v; } catch {}
  const i = text.indexOf("["), k = text.lastIndexOf("]");
  if (i >= 0 && k > i) try { return JSON.parse(text.slice(i, k + 1)); } catch {}
  return [];
}

await call("edit_bootstrap", { compact: true });
const name = "DefaultLevel " + Date.now();
// Video with possible linked audio - don't call audio_fix
await call("edit_run", {
  stopOnError: true,
  compact: true,
  plan: [
    {
      op: "sequence_from_media",
      paths: [
        "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\intro_blue_3s.mp4",
        "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\clip_backrooms_12s.mp4",
      ],
      name,
    },
    { op: "set_active", query: name },
  ],
});
await call("sequence_set_active_by_name", { query: name });

for (const ti of [0, 1, 2]) {
  const clips = arr((await call("clip_list", { trackType: "audio", trackIndex: ti })).text);
  console.log(`A${ti} n=${clips.length}`, clips.map((x) => x.name).join(", "));
  for (const cl of clips.slice(0, 3)) {
    const g = await call("audio_get_gain", { trackIndex: ti, clipIndex: cl.clipIndex });
    console.log(`  default getGain A${ti}[${cl.clipIndex}]`, g.text.slice(0, 220).replace(/\s+/g, " "));
    for (const [ei, pn] of [[0, "Level"], [0, "Mute"], [1, "Left"], [1, "Right"]]) {
      const r = await call("effect_get_param", {
        trackType: "audio",
        trackIndex: ti,
        clipIndex: cl.clipIndex,
        effectIndex: ei,
        paramName: pn,
      });
      console.log(`    effect ${ei}.${pn}`, JSON.stringify(j(r.text) || r.text.slice(0, 80)));
    }
  }
}

// Place SFX via sfx op (will set gain) then read
await call("edit_once", {
  op: "sfx",
  params: {
    path: "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\whoosh_01.wav",
    atSeconds: 0.5,
    trackIndex: 1,
    gainDb: 0,
  },
  compact: false,
});
const afterSfx = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("\nAfter sfx gainDb0:", afterSfx.text.slice(0, 300).replace(/\s+/g, " "));

// On Creative Cut - read a clip that was set to linear 1
await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });
const g2 = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
console.log("CreativeCut A1[0] (was linear1):", g2.text.slice(0, 300).replace(/\s+/g, " "));

// Map: write Level raw 0.0-1.0 and also try if Premiere uses dB as the value where rubber band 0dB is value 0
// Hypothesis: Level is dB offset where range is about -∞ to +15, and DEFAULT is 0 (meaning 0 dB)
// But earlier write 0 was silent... unless silence was from Mute or Channel Volume 0 we set

// On creative cut reset ONLY Level to 0 WITHOUT touching channels - user says +15 now
console.log("\n=== CreativeCut: set Level only via effect ===");
for (const v of [0, 0.177, 0.25, 0.5, 0.707, 1]) {
  await call("effect_set_param", {
    trackType: "audio",
    trackIndex: 1,
    clipIndex: 0,
    effectIndex: 0,
    paramName: "Level",
    value: v,
  });
  const g = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
  const data = j(g.text);
  const lin = data?.value?.value ?? data?.linear ?? data?.value;
  console.log("Level=", v, "→ read", lin);
}

await c.close();
