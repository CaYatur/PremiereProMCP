#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveExistingAeTextMogrt } from "../server/dist/aeMogrtPaths.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "smoke-legacy", version: "0.0.1" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) =>
      c.type === "image" ? `[IMAGE ${(c.data || "").length}b64]` : c.text,
    )
    .join(" | ")
    .slice(0, 700);
const data = (r) => {
  const t = text(r);
  const m = t.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
};

let pass = 0,
  fail = 0;
async function step(label, run) {
  try {
    const r = await run();
    const t = text(r);
    if (r.isError) {
      console.log("[FAIL]", label, "\n     ", t);
      fail++;
      return undefined;
    }
    console.log("[PASS]", label, "\n     ", t);
    pass++;
    return data(r);
  } catch (e) {
    console.log("[FAIL]", label, e.message);
    fail++;
    return undefined;
  }
}

console.log("=== Legacy text bridge live smoke ===\n");
const ae = resolveExistingAeTextMogrt();
console.log("AE MOGRT:", ae.path || "NONE");

const st = await step("connection", () => call("app_get_connection_status"));
if (!st?.pluginConnected) {
  console.log("UXP plugin not connected");
  await client.close();
  process.exit(1);
}
if (!st?.legacyBridgeConnected) {
  console.log("Legacy bridge NOT connected — open Window > PPMCP Text Bridge");
  await client.close();
  process.exit(1);
}

// Use a dedicated sequence so we don't trash the active edit accidentally
const seqName = `PPMCP LegacyText ${Date.now()}`;
const created = await step("sequence_create", () =>
  call("sequence_create", { name: seqName }),
);
const sequenceId = created?.sequenceId;
if (sequenceId) {
  await step("sequence_set_active", () => call("sequence_set_active", { sequenceId }));
}

await step("text_write ES (insertAndSetText)", () =>
  call("text_write", {
    sequenceId,
    trackIndex: 0,
    atTicks: "0",
    text: "ES TITLE LIVE",
    style: "title",
    mogrtPath: ae.path || undefined,
  }),
);

// Read back via legacy
const clips = await step("clip_list V0", () =>
  call("clip_list", { sequenceId, trackType: "video", trackIndex: 0 }),
);
const clipIndex =
  Array.isArray(clips) && clips.length ? clips[clips.length - 1].clipIndex : 0;

await step("text_set_content_legacy", () =>
  call("text_set_content_legacy", {
    trackIndex: 0,
    clipIndex,
    text: "ES TITLE UPDATED",
  }),
);

// Lower third style second clip further along
await step("text_write second title", () =>
  call("text_write", {
    sequenceId,
    trackIndex: 1,
    atTicks: "508032000000",
    text: "ES LOWER LINE",
    style: "lower_third",
    mogrtPath: ae.path || undefined,
  }),
);

await step("playhead_go_to_frame 0", () => call("playhead_go_to_frame", { sequenceId, frame: 0 }));
await step("sequence_screenshot", () =>
  call("sequence_screenshot", {
    sequenceId,
    frame: 0,
    outputPath: path.join(os.tmpdir(), `ppmcp-legacy-shot-${Date.now()}.png`),
  }),
);

await step("workflow_summarize_timeline", () => call("workflow_summarize_timeline", { sequenceId }));

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
await client.close();
process.exit(fail ? 1 : 0);
