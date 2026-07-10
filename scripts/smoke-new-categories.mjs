#!/usr/bin/env node
// Live smoke for categories added after the core loop: P (playhead/selection),
// L/K (media/proxy/multicam-check), N (analyze), O (batch), plus a couple of
// dedicated shortcuts / workflow composites. Requires bridge + Premiere plugin.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-smoke-new", version: "0.0.1" });
await client.connect(transport);

let pass = 0;
let fail = 0;
let skip = 0;

const call = (name, args = {}) => client.callTool({ name, arguments: args });

function extractText(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");
}

function tryExtractJson(result) {
  const block = (result.content || []).find((c) => c.type === "text" && c.text.includes("```json"));
  if (!block) return undefined;
  const m = block.text.match(/```json\n([\s\S]*?)\n```/);
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
    if (result.isError) {
      console.log(`[FAIL] ${label}`);
      console.log(`       ${extractText(result).slice(0, 400)}`);
      fail++;
      return undefined;
    }
    console.log(`[PASS] ${label}`);
    console.log(`       ${extractText(result).slice(0, 280)}`);
    pass++;
    return tryExtractJson(result);
  } catch (err) {
    console.log(`[FAIL] ${label} (threw)`);
    console.log(`       ${err.message}`);
    fail++;
    return undefined;
  }
}

function flattenItems(items, out = []) {
  for (const it of items || []) {
    if (it.isBin) flattenItems(it.children, out);
    else out.push(it);
  }
  return out;
}

console.log("=== PPMCP new-categories live smoke (P / L / K / N / O) ===\n");

const status = await step("app_get_connection_status", () => call("app_get_connection_status", {}));
if (!status || !status.pluginConnected) {
  console.log("\nPlugin not connected — load the UXP plugin first.");
  await client.close();
  process.exit(1);
}

const seqList = (await step("sequence_list", () => call("sequence_list", {}))) || [];
const smoke = Array.isArray(seqList)
  ? [...seqList].reverse().find((s) => String(s.name || "").includes("PPMCP Smoke Test"))
  : null;
const sequenceId = smoke?.sequenceId;
if (sequenceId) {
  await step("sequence_set_active (latest smoke seq)", () => call("sequence_set_active", { sequenceId }));
} else {
  console.log("[INFO] No PPMCP Smoke Test sequence found — using active sequence.");
}

const sid = sequenceId ? { sequenceId } : {};

// --- P ---
await step("playhead_get_position", () => call("playhead_get_position", sid));
await step("playhead_set_position", () => call("playhead_set_position", { ...sid, atTicks: "254016000000" }));
await step("playhead_get_position (after set)", () => call("playhead_get_position", sid));
await step("playhead_go_to_next_edit", () => call("playhead_go_to_next_edit", sid));
await step("playhead_go_to_previous_edit", () => call("playhead_go_to_previous_edit", sid));
await step("selection_get", () => call("selection_get", sid));
await step("selection_clear", () => call("selection_clear", sid));
await step("app_get_version", () => call("app_get_version", {}));

const clips = (await step("clip_list V1", () => call("clip_list", { ...sid, trackType: "video", trackIndex: 0 }))) || [];
if (Array.isArray(clips) && clips.length > 0) {
  await step("selection_set (V1 clip 0)", () =>
    call("selection_set", { ...sid, clips: [{ trackType: "video", trackIndex: 0, clipIndex: 0 }] }),
  );
  await step("selection_get (after set)", () => call("selection_get", sid));
  await step("effect_apply_gaussian_blur (dedicated)", () =>
    call("effect_apply_gaussian_blur", { ...sid, trackIndex: 0, clipIndex: 0 }),
  );
  await step("effect_list_applied", () =>
    call("effect_list_applied", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }),
  );
  await step("batch_apply_effect_to_selection", () =>
    call("batch_apply_effect_to_selection", {
      ...sid,
      matchName: "AE.ADBE Black & White",
      clips: [{ trackType: "video", trackIndex: 0, clipIndex: 0 }],
    }),
  );
} else {
  console.log("[SKIP] selection_set / effect on clip — no clips on V1");
  skip += 5;
}

// --- N ---
await step("analyze_get_timeline_summary", () => call("analyze_get_timeline_summary", sid));
await step("analyze_sequence_structure", () => call("analyze_sequence_structure", sid));
await step("analyze_detect_gaps", () => call("analyze_detect_gaps", sid));
await step("analyze_get_project_statistics", () => call("analyze_get_project_statistics", {}));
await step("analyze_find_unused_media", () => call("analyze_find_unused_media", {}));
await step("workflow_summarize_timeline", () => call("workflow_summarize_timeline", sid));

if (Array.isArray(seqList) && seqList.length >= 2) {
  await step("analyze_compare_sequences", () =>
    call("analyze_compare_sequences", {
      sequenceIdA: seqList[0].sequenceId,
      sequenceIdB: seqList[1].sequenceId,
    }),
  );
} else {
  console.log("[SKIP] analyze_compare_sequences — need 2+ sequences");
  skip++;
}

// --- L / K ---
const rootItems = (await step("project_list_items (recursive)", () => call("project_list_items", { recursive: true }))) || [];
const media = flattenItems(Array.isArray(rootItems) ? rootItems : []);
console.log(`[INFO] media items in project: ${media.length}${media[0] ? ` (first: ${media[0].name})` : ""}`);

if (media.length > 0) {
  const id = media[0].id;
  await step("media_get_info", () => call("media_get_info", { projectItemId: id }));
  await step("multicam_check", () => call("multicam_check", { projectItemId: id }));
  await step("media_find_by_path", () => call("media_find_by_path", { matchString: ":" }));
  await step("media_refresh", () => call("media_refresh", { projectItemId: id }));

  const original = media[0].name;
  const tmp = `${original} __ppmcp_tmp`;
  await step("batch_rename_items (tmp)", () =>
    call("batch_rename_items", { items: [{ projectItemId: id, name: tmp }] }),
  );
  await step("batch_rename_items (restore)", () =>
    call("batch_rename_items", { items: [{ projectItemId: id, name: original }] }),
  );
} else {
  console.log("[SKIP] media_*/multicam_check/batch_rename — no media items");
  skip += 6;
}

console.log(`\n=== Done: ${pass} passed, ${fail} failed, ${skip} skipped ===`);
await client.close();
process.exit(fail > 0 ? 1 : 0);
