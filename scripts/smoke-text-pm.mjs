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
const client = new Client({ name: "smoke-text-pm", version: "0.0.1" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) =>
      c.type === "image" ? `[IMAGE ${(c.data || "").length}b64]` : c.text,
    )
    .join(" | ")
    .slice(0, 550);

let pass = 0,
  fail = 0;
async function step(label, run) {
  try {
    const r = await run();
    const t = text(r);
    if (r.isError) {
      console.log("[FAIL]", label, "\n     ", t);
      fail++;
      return r;
    }
    console.log("[PASS]", label, "\n     ", t);
    pass++;
    return r;
  } catch (e) {
    console.log("[FAIL]", label, e.message);
    fail++;
  }
}

console.log("=== Text research path + Program Monitor screenshot ===\n");
await step("connection", () => call("app_get_connection_status"));
await step("go frame 0", () => call("playhead_go_to_frame", { frame: 0 }));
await step("screenshot PM", () =>
  call("sequence_screenshot", {
    frame: 0,
    outputPath: path.join(os.tmpdir(), `ppmcp-pm-${Date.now()}.png`),
  }),
);
await step("text_write SimpleText-first", () =>
  call("text_write", {
    trackIndex: 1,
    atTicks: "0",
    text: "SIMPLETEXT RESEARCH",
    style: "title",
  }),
);
await step("text_write preferPng", () =>
  call("text_write", {
    trackIndex: 2,
    atTicks: "0",
    text: "PNG FALLBACK OK",
    style: "lower_third",
    preferPng: true,
    colorHex: "00E5FF",
  }),
);
await step("screenshot after text", () =>
  call("sequence_export_still", { frame: 0 }),
);

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
await client.close();
process.exit(fail ? 1 : 0);
