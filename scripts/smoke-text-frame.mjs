#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "smoke-text-frame", version: "0.0.1" });
await client.connect(transport);

let pass = 0;
let fail = 0;
const call = (name, args = {}) => client.callTool({ name, arguments: args });
function text(r) {
  return (r.content || [])
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) =>
      c.type === "image" ? `[IMAGE ${c.mimeType} ${(c.data || "").length}b64]` : c.text,
    )
    .join(" | ")
    .slice(0, 500);
}
function data(r) {
  const t = text(r);
  const m = t.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}
async function step(label, run) {
  try {
    const result = await run();
    const t = text(result);
    if (result.isError) {
      console.log(`[FAIL] ${label}\n       ${t}`);
      fail++;
      return undefined;
    }
    console.log(`[PASS] ${label}\n       ${t}`);
    pass++;
    return data(result);
  } catch (e) {
    console.log(`[FAIL] ${label} threw ${e.message}`);
    fail++;
    return undefined;
  }
}

console.log("=== Text + frame navigation + screenshot smoke ===\n");
const st = await step("connection", () => call("app_get_connection_status"));
if (!st?.pluginConnected) {
  console.log("Plugin not connected — reload UXP plugin.");
  await client.close();
  process.exit(1);
}

const pos0 = await step("playhead_get_position", () => call("playhead_get_position", {}));
await step("playhead_go_to_frame 0", () => call("playhead_go_to_frame", { frame: 0 }));
await step("playhead_step_frames +5", () => call("playhead_step_frames", { deltaFrames: 5 }));
await step("playhead_step_frames -2", () => call("playhead_step_frames", { deltaFrames: -2 }));
const pos1 = await step("playhead_get_position after step", () => call("playhead_get_position", {}));
console.log("frame before/after:", pos0?.frame, "->", pos1?.frame);

const shot = path.join(os.tmpdir(), `ppmcp-shot-${Date.now()}.png`);
await step("sequence_screenshot frame 0", () =>
  call("sequence_screenshot", { frame: 0, outputPath: shot }),
);
await step("sequence_preview_frame frame 3", () =>
  call("sequence_export_still", { frame: 3 }),
);
await step("export_frame", () =>
  call("export_frame", { frame: 1, outputPath: path.join(os.tmpdir(), `ppmcp-ef-${Date.now()}.png`) }),
);

await step("text_write title", () =>
  call("text_write", {
    trackIndex: 1,
    atTicks: "0",
    text: "FRAME + TEXT OK",
    style: "title",
    colorHex: "FFFFFF",
  }),
);
await step("text_write lower_third", () =>
  call("text_write", {
    trackIndex: 2,
    atTicks: "254016000000",
    text: "Cagan · Live Edit",
    style: "lower_third",
    colorHex: "FFD700",
  }),
);

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
await client.close();
process.exit(fail ? 1 : 0);
