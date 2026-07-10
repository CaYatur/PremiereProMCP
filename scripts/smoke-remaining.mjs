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
const client = new Client({ name: "ppmcp-smoke-remaining", version: "0.0.1" });
await client.connect(transport);

let pass = 0,
  fail = 0,
  skip = 0;
const call = (name, args = {}) => client.callTool({ name, arguments: args });
function text(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
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
async function step(label, run) {
  try {
    const result = await run();
    if (result.isError) {
      console.log(`[FAIL] ${label}`);
      console.log(`       ${text(result).slice(0, 350)}`);
      fail++;
      return undefined;
    }
    console.log(`[PASS] ${label}`);
    console.log(`       ${text(result).slice(0, 220)}`);
    pass++;
    return data(result);
  } catch (err) {
    console.log(`[FAIL] ${label} (threw)`);
    console.log(`       ${err.message}`);
    fail++;
    return undefined;
  }
}

console.log("=== Remaining-features live smoke ===\n");
const status = await step("connection", () => call("app_get_connection_status"));
if (!status?.pluginConnected) {
  console.log("Plugin not connected — reload UXP plugin after code changes.");
  await client.close();
  process.exit(1);
}

const seqs = (await step("sequence_list", () => call("sequence_list"))) || [];
const smoke = [...seqs].reverse().find((s) => String(s.name || "").includes("PPMCP Smoke"));
const sequenceId = smoke?.sequenceId;
if (sequenceId) await step("sequence_set_active", () => call("sequence_set_active", { sequenceId }));
const sid = sequenceId ? { sequenceId } : {};

await step("sequence_get_duration", () => call("sequence_get_duration", sid));
await step("sequence_get_tracks", () => call("sequence_get_tracks", sid));
await step("project_search_items", () => call("project_search_items", { query: "Smoke" }));
await step("project_find_offline_media", () => call("project_find_offline_media", {}));
await step("export_get_status", () => call("export_get_status", {}));
await step("track_rename", () => call("track_rename", { ...sid, trackType: "video", trackIndex: 0, name: "V1 Smoke" }));

const clips = (await step("clip_list", () => call("clip_list", { ...sid, trackType: "video", trackIndex: 0 }))) || [];
if (Array.isArray(clips) && clips.length) {
  await step("clip_get_properties", () =>
    call("clip_get_properties", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }),
  );
  await step("clip_set_enabled true", () =>
    call("clip_set_enabled", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0, enabled: true }),
  );
  await step("effect_set_opacity", () =>
    call("effect_set_opacity", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0, opacity: 90 }),
  );
  await step("effect_set_transform", () =>
    call("effect_set_transform", {
      ...sid,
      trackType: "video",
      trackIndex: 0,
      clipIndex: 0,
      scale: 95,
    }),
  );
  await step("effect_apply_crop", () =>
    call("effect_apply_crop", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }),
  );
  await step("color_set_basic_correction", () =>
    call("color_set_basic_correction", {
      ...sid,
      trackIndex: 0,
      clipIndex: 0,
      saturation: 110,
      exposure: 0.1,
    }),
  );
  await step("transition_apply cross dissolve", () =>
    call("transition_apply", {
      ...sid,
      trackType: "video",
      trackIndex: 0,
      clipIndex: 0,
      matchName: "AE.ADBE Cross Dissolve New",
      edge: "tail",
      durationTicks: "508032000000",
    }),
  );
  await step("clip_select", () => call("clip_select", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0 }));
  await step("clip_rename", () =>
    call("clip_rename", { ...sid, trackType: "video", trackIndex: 0, clipIndex: 0, name: "Smoke Clip 0" }),
  );
} else {
  console.log("[SKIP] clip-dependent tests");
  skip += 8;
}

// media from known video if present
const found = (await step("media_find_by_path", () => call("media_find_by_path", { matchString: ".mp4" }))) || [];
if (Array.isArray(found) && found[0]?.projectItemId) {
  await step("media_get_info real mp4", () => call("media_get_info", { projectItemId: found[0].projectItemId }));
  await step("project_rename_item roundtrip", async () => {
    const id = found[0].projectItemId;
    const info = await call("media_get_info", { projectItemId: id });
    const name = data(info)?.name || found[0].name;
    await call("project_rename_item", { projectItemId: id, name: name + " tmp" });
    return call("project_rename_item", { projectItemId: id, name });
  });
}

await step("workflow_apply_color_look", () =>
  call("workflow_apply_color_look", {
    ...sid,
    clips: [{ trackIndex: 0, clipIndex: 0 }],
    params: { Saturation: 105 },
  }),
);

const outDir = path.join(os.tmpdir(), "ppmcp-smoke");
await step("export_get_file_extension", () => call("export_get_file_extension", sid));

console.log(`\n=== Done: ${pass} passed, ${fail} failed, ${skip} skipped ===`);
console.log("If transition/effect/export plugin methods fail, reload the UXP plugin to pick up handler changes.");
await client.close();
process.exit(fail > 0 ? 1 : 0);
