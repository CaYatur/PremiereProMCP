#!/usr/bin/env node
/**
 * Direct probe of title.addSimpleText / effect.probeStringParams after plugin reload.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "probe-st3", version: "0.0.1" });
await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .slice(0, 1200);

console.log("=== connection ===");
console.log(text(await call("app_get_connection_status")));

// Ensure a clip on V0
const clips = await call("clip_list", { trackType: "video", trackIndex: 0 });
console.log("clips V0", text(clips).slice(0, 400));

// Add SimpleText via effect_add then probe string params
const add = await call("effect_add", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
  matchName: "AE.ADBE PPro SimpleText",
});
console.log("effect_add", text(add));

const applied = await call("effect_list_applied", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
});
console.log("applied", text(applied).slice(0, 1500));

// Parse simple text index
const m = text(applied).match(/```json\n([\s\S]*?)\n```/);
let stIdx = null;
if (m) {
  try {
    const arr = JSON.parse(m[1]);
    const st = arr.find((e) => /simple\s*text/i.test(e.displayName || ""));
    stIdx = st?.effectIndex;
    console.log("SimpleText effectIndex", stIdx, st?.params);
  } catch {
    /* ignore */
  }
}

if (stIdx != null) {
  // Try Content alias and paramIndex 0 and last
  for (const args of [
    { paramName: "Content", value: "CONTENT NAME" },
    { paramIndex: 0, value: "IDX0 TEXT" },
    { paramIndex: 5, value: "IDX5 TEXT" },
  ]) {
    const r = await call("effect_set_param", {
      trackType: "video",
      trackIndex: 0,
      clipIndex: 0,
      effectIndex: stIdx,
      ...args,
    });
    console.log("set", JSON.stringify(args), r.isError ? "FAIL" : "OK", text(r).slice(0, 200));
  }
}

// High-level title path
const tw = await call("text_write", {
  trackIndex: 1,
  atTicks: "0",
  text: "RELOAD SIMPLETEXT",
  style: "title",
});
console.log("text_write", text(tw));

// Screenshot
const shot = await call("sequence_screenshot", { frame: 0 });
console.log("screenshot", text(shot).slice(0, 500));

await client.close();
