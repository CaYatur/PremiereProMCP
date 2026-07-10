import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "smoke-cp", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  console.log((r.isError ? "ERR " : "OK  ") + name + ": " + text.slice(0, 400).replace(/\s+/g, " "));
  return text;
}

await call("edit_bootstrap", { compact: true });
// Force all audio clips on active sequence to 0 dB
await call("audio_fix_levels", { allClips: true, mode: "unity", targetDb: 0 });
// Read a couple of gains
await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
await call("audio_set_gain", { trackIndex: 1, clipIndex: 0 }); // omit decibels → 0
await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });

// Checkpoint
const cp = await call("checkpoint_create", { label: "smoke-before-test", note: "smoke test" });
await call("checkpoint_list", {});

// sfx without gainDb should still force 0
await call("edit_once", {
  op: "sfx",
  params: {
    path: "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\whoosh_01.wav",
    atSeconds: 0.5,
    trackIndex: 1,
  },
  compact: false,
});

await call("project_save", {});
await c.close();
console.log("DONE");
