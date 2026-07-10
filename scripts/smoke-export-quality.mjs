#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-export-quality", version: "0.0.1" });
await client.connect(transport);

let pass = 0;
let fail = 0;
let soft = 0;
const call = (name, args = {}) => client.callTool({ name, arguments: args });
function text(r) {
  return (r.content || [])
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) =>
      c.type === "image" ? `[image ${c.mimeType || "?"} len=${(c.data || "").length}]` : c.text,
    )
    .join(" | ");
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
async function step(label, run, { softFail = false } = {}) {
  try {
    const result = await run();
    const t = text(result).slice(0, 550);
    if (result.isError) {
      if (softFail) {
        console.log(`[SOFT] ${label}`);
        console.log(`       ${t}`);
        soft++;
        return data(result);
      }
      console.log(`[FAIL] ${label}`);
      console.log(`       ${t}`);
      fail++;
      return undefined;
    }
    console.log(`[PASS] ${label}`);
    console.log(`       ${t}`);
    pass++;
    return data(result);
  } catch (err) {
    if (softFail) {
      console.log(`[SOFT] ${label} (threw)`);
      console.log(`       ${err.message}`);
      soft++;
      return undefined;
    }
    console.log(`[FAIL] ${label} (threw)`);
    console.log(`       ${err.message}`);
    fail++;
    return undefined;
  }
}

console.log("=== Post-reload export + quality smoke ===\n");
const status = await step("connection", () => call("app_get_connection_status"));
if (!status?.pluginConnected) {
  console.log("Plugin not connected — reload UXP plugin after code changes.");
  await client.close();
  process.exit(1);
}

const seqs = (await step("sequence_list", () => call("sequence_list"))) || [];
const smoke = Array.isArray(seqs)
  ? [...seqs].reverse().find((s) => /Smoke|PPMCP/i.test(String(s.name || "")))
  : null;
const sequenceId = smoke?.sequenceId || (Array.isArray(seqs) ? seqs[0]?.sequenceId : undefined);
console.log("using sequence:", smoke?.name || sequenceId);
const sid = sequenceId ? { sequenceId } : {};
if (sequenceId) await step("sequence_set_active", () => call("sequence_set_active", { sequenceId }));

const out = path.join(os.tmpdir(), "ppmcp-frame-probe.png");
await step(
  "export_frame (expected soft if no UXP API)",
  () => call("export_frame", { ...sid, atTicks: "0", outputPath: out }),
  { softFail: true },
);
await step(
  "sequence_preview_frame",
  () => call("sequence_preview_frame", { ...sid }),
  { softFail: true },
);

await step("workflow_summarize_timeline", () => call("workflow_summarize_timeline", sid));
await step("workflow_cinematic_grade", () =>
  call("workflow_cinematic_grade", {
    ...sid,
    trackIndex: 0,
    clipIndex: 0,
    look: "warm",
  }),
);
await step("workflow_apply_glitch", () =>
  call("workflow_apply_glitch", {
    ...sid,
    trackIndex: 0,
    clipIndex: 0,
    intensity: "medium",
  }),
);
await step("effect_apply_rgb_split", () =>
  call("effect_apply_rgb_split", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }),
);
await step("effect_apply_vignette", () =>
  call("effect_apply_vignette", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }),
);
await step("text_add (PNG fallback OK)", () =>
  call("text_add", {
    ...sid,
    text: "RELOAD QA TITLE",
    trackIndex: 1,
    atTicks: "0",
    durationTicks: "508032000000",
  }),
);
await step("marker_add", () =>
  call("marker_add", {
    ...sid,
    atTicks: "254016000000",
    name: "reload-smoke",
    comments: "post-reload quality",
  }),
);
await step("workflow_finish_cut", () =>
  call("workflow_finish_cut", {
    ...sid,
    videoTrackIndex: 0,
    videoClipIndex: 0,
    grade: true,
    addDissolve: false,
  }),
);
await step("analyze_get_timeline_summary", () => call("analyze_get_timeline_summary", sid));

console.log(`\n=== Results: ${pass} pass, ${fail} fail, ${soft} soft ===`);
await client.close();
process.exit(fail > 0 ? 1 : 0);
