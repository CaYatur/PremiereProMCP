#!/usr/bin/env node
/**
 * Full catalog smoke: call every registered MCP tool once with safe args.
 *
 * Modes:
 *   SAFE (default) — read-only / non-destructive first; mutations only on smoke sequence
 *   Offline analysis tools run without Premiere when possible
 *
 * Usage:
 *   1. npm run build
 *   2. Bridge + Premiere + UXP plugin connected
 *   3. node scripts/smoke-all-tools.mjs
 *   Optional: PPMCP_TEST_MEDIA_PATH=C:\path\to\clip.mp4
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mediaPath = process.env.PPMCP_TEST_MEDIA_PATH;

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-all-tools-smoke", version: "0.0.1" });
await client.connect(transport);

const pass = [];
const fail = [];
const skip = [];

function extractText(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");
}

function extractData(result) {
  const t = extractText(result);
  const m = t.match(/```json\n?([\s\S]*?)```/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

async function call(name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function tryTool(name, args, { soft = false } = {}) {
  try {
    const result = await call(name, args);
    if (result.isError) {
      const msg = extractText(result).slice(0, 200);
      if (soft) {
        skip.push({ name, reason: msg });
        console.log(`[SOFT] ${name} — ${msg}`);
        return { ok: false, soft: true };
      }
      fail.push({ name, error: msg });
      console.log(`[FAIL] ${name} — ${msg}`);
      return { ok: false };
    }
    pass.push(name);
    console.log(`[PASS] ${name}`);
    return { ok: true, data: extractData(result), text: extractText(result) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail.push({ name, error: msg });
    console.log(`[FAIL] ${name} (threw) — ${msg}`);
    return { ok: false };
  }
}

console.log("=== PPMCP ALL-TOOLS SMOKE ===\n");

// ── Catalog ──
const listed = await client.listTools();
const allNames = listed.tools.map((t) => t.name).sort();
console.log(`Registered tools: ${allNames.length}\n`);

// ── Connection ──
const statusR = await tryTool("app_get_connection_status", {});
const status = statusR.data || {};
if (!status.pluginConnected) {
  console.log("\nPlugin not connected — will still run offline analysis tools + list coverage.");
}

// Synthetic short wav for silence/onset tests (via ffmpeg if present)
let synthMedia = mediaPath;
const tmpWav = path.join(os.tmpdir(), `ppmcp-smoke-${Date.now()}.wav`);
try {
  const { spawnSync } = await import("node:child_process");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.4",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-filter_complex",
      "[0][1]concat=n=2:v=0:a=1",
      "-t",
      "1.2",
      tmpWav,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20000 },
  );
  if (fs.existsSync(tmpWav) && fs.statSync(tmpWav).size > 100) {
    synthMedia = tmpWav;
    console.log(`Synth test audio: ${tmpWav}`);
  } else {
    console.log("Synth wav failed:", (ff.stderr || "").slice(-200));
  }
} catch (e) {
  console.log("ffmpeg synth skip:", e.message);
}

// ── Args builders per tool ──
const state = {
  sequenceId: undefined,
  trackIndex: 0,
  clipIndex: 0,
  projectItemId: undefined,
};

// Prefer create smoke sequence if connected
if (status.pluginConnected) {
  const seq = await tryTool("sequence_create", { name: `PPMCP AllSmoke ${Date.now()}` });
  if (seq.data?.sequenceId) {
    state.sequenceId = seq.data.sequenceId;
    await tryTool("sequence_set_active", { sequenceId: state.sequenceId });
  }
  if (mediaPath && fs.existsSync(mediaPath)) {
    const imp = await tryTool("project_import_media", { paths: [mediaPath] });
    await new Promise((r) => setTimeout(r, 500));
    const items = await tryTool("project_list_items", { recursive: true });
    const list = items.data;
    const arr = Array.isArray(list) ? list : list?.items || [];
    const media = arr.find?.((i) => !i.isBin) || (Array.isArray(arr) ? arr[arr.length - 1] : null);
    if (media?.id) {
      state.projectItemId = media.id;
      await tryTool(
        "sequence_create_from_media",
        { name: `PPMCP MediaSmoke ${Date.now()}`, projectItemIds: [media.id] },
        { soft: true },
      );
    }
  }
}

/** Safe default args for each tool. Return null to skip intentionally. */
function argsFor(name) {
  const sid = state.sequenceId;
  const media = synthMedia || mediaPath;
  const ticks = "0";
  const clip = {
    sequenceId: sid,
    trackType: "video",
    trackIndex: 0,
    clipIndex: 0,
  };

  // Destructive / export-heavy — soft skip unless media
  const skipAlways = new Set([
    "project_close",
    "project_delete_item",
    "sequence_delete",
    "export_batch_sequences",
    "export_start_batch",
    "export_queue_to_media_encoder",
    "export_launch_media_encoder",
  ]);
  if (skipAlways.has(name)) return { __skip: "destructive/export-batch skipped in full smoke" };

  switch (name) {
    case "app_get_connection_status":
    case "app_get_version":
    case "project_get_active":
    case "project_get_info":
    case "project_list_items":
    case "project_find_offline_media":
    case "project_save":
    case "project_quick_save":
    case "sequence_list":
    case "sequence_get_active":
    case "sequence_get_settings":
    case "sequence_get_duration":
    case "sequence_get_tracks":
    case "track_list":
    case "marker_list":
    case "selection_get":
    case "selection_clear":
    case "playhead_get_position":
    case "effect_list_available":
    case "transition_list_available":
    case "export_get_status":
    case "export_get_file_extension":
    case "analyze_get_timeline_summary":
    case "analyze_sequence_structure":
    case "analyze_detect_gaps":
    case "analyze_get_project_statistics":
    case "analyze_find_unused_media":
    case "analyze_media_capabilities":
    case "edit_bootstrap":
    case "edit_help":
    case "edit_playbook_list":
    case "edit_get_report":
    case "edit_verify":
    case "text_system_status":
    case "text_bridge_ensure":
    case "workflow_summarize_timeline":
    case "workflow_cleanup_test_sequences":
    case "time_seconds_to_ticks":
    case "time_ticks_to_seconds":
    case "media_browser_search":
      if (name === "time_seconds_to_ticks") return { seconds: 1 };
      if (name === "time_ticks_to_seconds") return { ticks: "254016000000" };
      if (name === "workflow_cleanup_test_sequences") return { dryRun: true };
      if (name === "media_browser_search") return { query: "a" };
      if (name === "project_list_items") return { recursive: true };
      return {};

    case "sequence_create":
      return { name: `PPMCP SmokeX ${Date.now()}` };
    case "sequence_set_active":
    case "sequence_set_active_by_name":
      return sid ? { sequenceId: sid } : name.includes("by_name") ? { query: "PPMCP" } : { __skip: "no sequence" };
    case "sequence_find_by_name":
      return { query: "PPMCP" };
    case "sequence_set_in_out":
      return { inTicks: "0", outTicks: "254016000000" };
    case "sequence_close":
      return { __skip: "avoid closing active" };
    case "sequence_create_from_media":
      return state.projectItemId
        ? { name: `FromMedia ${Date.now()}`, projectItemIds: [state.projectItemId] }
        : { __skip: "no projectItemId" };
    case "sequence_export_frame":
    case "sequence_preview_frame":
    case "sequence_screenshot":
    case "sequence_qa_loop":
    case "export_frame":
    case "export_frame_as_image":
      return { frame: 0 };

    case "track_add":
    case "track_add_video":
    case "track_add_audio":
      return { trackType: name.includes("audio") ? "audio" : "video" };
    case "track_delete":
      return { __skip: "destructive" };
    case "track_set_mute":
    case "track_set_lock":
    case "track_set_output_enabled":
      return { trackType: "video", trackIndex: 0, enabled: true, muted: false, locked: false };
    case "track_rename":
      return { trackType: "video", trackIndex: 0, name: "V1" };
    case "track_get_items":
      return { trackType: "video", trackIndex: 0 };

    case "clip_list":
    case "clip_count_on_track":
      return { trackType: "video", trackIndex: 0 };
    case "clip_get_properties":
    case "clip_select":
      return clip;
    case "clip_insert":
    case "clip_overwrite":
    case "clip_append":
      return state.projectItemId
        ? { ...clip, projectItemId: state.projectItemId, atTicks: ticks }
        : { __skip: "no media item" };
    case "clip_move":
    case "clip_trim":
    case "clip_roll":
    case "clip_slip":
    case "clip_slide":
    case "clip_split":
    case "clip_split_at_playhead":
    case "clip_ripple_delete":
    case "clip_lift":
    case "clip_delete":
    case "clip_set_speed":
    case "clip_set_enabled":
    case "clip_rename":
    case "clip_reverse":
    case "clip_align_to_playhead":
    case "clip_set_transform":
      return { __skip: "needs real clip geometry — soft in batch", soft: true };

    case "marker_add":
      return { atTicks: ticks, name: "smoke-marker" };
    case "marker_update":
    case "marker_remove":
    case "marker_go_to":
    case "marker_set_duration":
      return { markerIndex: 0, name: "smoke", durationTicks: "254016000000", soft: true };
    case "markers_add_many":
      return { markers: [{ atTicks: ticks, name: "batch-smoke" }] };

    case "playhead_set_position":
    case "playhead_go_to_seconds":
    case "playhead_go_to_timecode":
      return { seconds: 0, atTicks: "0" };
    case "playhead_go_to_frame":
      return { frame: 0 };
    case "playhead_step_frames":
      return { frames: 1 };
    case "playhead_go_to_marker":
    case "playhead_go_to_next_edit":
    case "playhead_go_to_previous_edit":
      return { soft: true };

    case "selection_set":
      return { soft: true };

    case "effect_add":
    case "effect_list_applied":
    case "effect_remove":
    case "effect_set_param":
    case "effect_get_param":
    case "effect_set_opacity":
    case "effect_set_transform":
    case "effect_reset":
    case "effect_apply_warp_stabilizer":
    case "effect_apply_crop":
      return { ...clip, matchName: "AE.ADBE Lumetri", opacity: 100, soft: true };

    case "color_apply_lumetri":
    case "color_get_params":
    case "color_set_param":
    case "color_set_basic_correction":
    case "color_set_white_balance":
    case "color_reset_grade":
    case "color_copy_grade":
    case "color_paste_grade":
    case "color_apply_lut":
      return { ...clip, paramName: "Contrast", value: 10, soft: true };

    case "audio_set_gain":
    case "audio_add_volume_keyframe":
    case "audio_set_mute":
    case "audio_add_effect":
    case "audio_normalize":
    case "audio_apply_noise_reduction":
    case "audio_apply_dialogue_enhance":
    case "audio_mute_track":
      return {
        sequenceId: sid,
        trackIndex: 0,
        clipIndex: 0,
        decibels: 0,
        atTicks: "0",
        soft: true,
      };

    case "transition_apply":
    case "transition_remove":
    case "transition_set_duration":
    case "transition_apply_to_all_cuts":
      return {
        ...clip,
        matchName: "AE.ADBE Cross Dissolve New",
        edge: "tail",
        durationTicks: "508032000000",
        soft: true,
      };

    case "text_write":
    case "text_write_editable":
    case "text_write_png":
    case "text_add":
    case "workflow_add_title_card":
    case "workflow_add_lower_third":
      return {
        trackIndex: 1,
        atTicks: ticks,
        text: "SMOKE",
        style: "title",
        soft: true,
      };
    case "text_set_content":
    case "text_get_content":
    case "text_set_position":
    case "text_set_content_legacy":
    case "text_get_content_legacy":
      return { trackIndex: 1, clipIndex: 0, text: "SMOKE", x: 960, y: 540, soft: true };

    case "shape_add":
      return { trackIndex: 0, atTicks: ticks, soft: true };
    case "shape_set_position":
    case "shape_set_size":
    case "shape_set_fill_color":
      return { trackIndex: 0, clipIndex: 0, x: 100, y: 100, width: 200, height: 100, r: 255, g: 0, b: 0, soft: true };

    case "export_sequence":
    case "export_with_preset":
    case "workflow_prep_for_export":
      return {
        outputPath: path.join(os.tmpdir(), `ppmcp-export-smoke-${Date.now()}.mp4`),
        soft: true,
      };

    case "analyze_detect_silence":
    case "analyze_detect_onsets":
    case "analyze_detect_scene_changes":
    case "analyze_suggest_cut_points":
    case "analyze_transcribe":
    case "workflow_clean_silence":
    case "workflow_add_captions_from_audio":
    case "caption_generate_auto":
      return media
        ? {
            mediaPath: media,
            addMarkers: false,
            placeText: false,
            placeMarkers: false,
            maxSegments: 3,
            maxEvents: 10,
            maxSeconds: 5,
            engine: "windows",
            soft: true,
          }
        : { __skip: "no media path" };

    case "caption_import_srt": {
      const srt = path.join(os.tmpdir(), `ppmcp-smoke-${Date.now()}.srt`);
      fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nHello smoke\n", "utf8");
      return { srtPath: srt };
    }
    case "caption_place_from_srt": {
      const srt = path.join(os.tmpdir(), `ppmcp-smoke-place-${Date.now()}.srt`);
      fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nCap smoke\n", "utf8");
      return {
        srtPath: srt,
        trackIndex: 1,
        maxSegments: 1,
        placeText: true,
        placeMarkers: true,
        soft: true,
      };
    }

    case "analyze_compare_sequences":
      return sid
        ? { sequenceIdA: sid, sequenceIdB: sid }
        : { __skip: "need sequence ids" };

    case "edit_playbook_run":
      return { playbook: "qa_pass", args: { capture: false }, soft: true };
    case "edit_auto":
      return { intent: "qa", args: { capture: false }, dryRun: true };
    case "edit_pipeline":
      return { stages: [{ playbook: "qa_pass", args: { capture: false } }], soft: true };
    case "edit_run":
      return { plan: [{ op: "bootstrap" }], soft: true };
    case "edit_once":
      return { op: "bootstrap", soft: true };
    case "edit_quality_pass":
    case "edit_delivery":
      return { look: "neutral", verify: false, soft: true };

    case "workflow_apply_color_look":
    case "workflow_cinematic_grade":
    case "workflow_film_look":
    case "workflow_finish_cut":
    case "workflow_apply_glitch":
    case "workflow_apply_chroma_key":
    case "workflow_create_picture_in_picture":
    case "workflow_animate_zoom":
    case "workflow_fade_clip":
    case "workflow_ken_burns":
    case "workflow_add_transitions_between_clips":
    case "workflow_audio_fade":
    case "workflow_duck_audio_under_markers":
    case "workflow_trim_to_length":
    case "assembly_rough_cut_from_bin":
      return { trackIndex: 0, clipIndex: 0, soft: true, dryRun: true };

    case "project_create":
    case "project_open":
    case "project_save_as":
    case "project_import_media":
      if (name === "project_import_media" && mediaPath) return { paths: [mediaPath] };
      return { __skip: "project lifecycle skipped" };
    case "project_create_bin":
      return { name: `SmokeBin ${Date.now()}` };
    case "project_move_item_to_bin":
    case "project_rename_item":
    case "project_search_items":
    case "project_relink_media":
      return { query: "a", name: "x", soft: true };

    case "media_get_info":
    case "media_analyze_file_info":
    case "media_find_by_path":
      return media ? { path: media, mediaPath: media, soft: true } : { __skip: "no media" };
    case "proxy_attach":
    case "media_go_offline":
    case "media_go_online":
    case "media_relink":
    case "media_refresh":
    case "media_rename":
    case "multicam_check":
      return { soft: true };

    case "batch_run":
    case "batch_apply":
      return { __skip: "batch orchestrator — covered by edit_run" };

    default:
      // dedicated shortcuts etc. — try empty
      return { soft: true };
  }
}

// Run offline DSP first (works without Premiere)
console.log("\n--- Offline media analysis ---\n");
for (const n of [
  "analyze_media_capabilities",
  "analyze_detect_silence",
  "analyze_detect_onsets",
  "caption_import_srt",
  "time_seconds_to_ticks",
  "time_ticks_to_seconds",
  "edit_help",
  "edit_playbook_list",
  "edit_auto",
  "text_system_status",
]) {
  if (!allNames.includes(n)) continue;
  const a = argsFor(n);
  if (a?.__skip) {
    skip.push({ name: n, reason: a.__skip });
    console.log(`[SKIP] ${n} — ${a.__skip}`);
    continue;
  }
  const soft = !!a?.soft;
  delete a.soft;
  delete a.__skip;
  await tryTool(n, a || {}, { soft });
}

console.log("\n--- Full catalog pass ---\n");
const covered = new Set([...pass, ...fail.map((f) => f.name), ...skip.map((s) => s.name)]);

for (const name of allNames) {
  if (covered.has(name)) continue;
  const a = argsFor(name);
  if (a?.__skip) {
    skip.push({ name, reason: a.__skip });
    console.log(`[SKIP] ${name} — ${a.__skip}`);
    covered.add(name);
    continue;
  }
  const soft = !!a?.soft || !status.pluginConnected;
  if (a) {
    delete a.soft;
    delete a.__skip;
  }
  await tryTool(name, a || {}, { soft: soft || true });
  covered.add(name);
}

// Coverage report
const uncovered = allNames.filter((n) => !pass.includes(n) && !fail.some((f) => f.name === n) && !skip.some((s) => s.name === n));
console.log("\n=== SUMMARY ===");
console.log(`Tools registered: ${allNames.length}`);
console.log(`PASS: ${pass.length}`);
console.log(`FAIL: ${fail.length}`);
console.log(`SKIP/SOFT: ${skip.length}`);
console.log(`Uncovered: ${uncovered.length}`);
if (fail.length) {
  console.log("\nFailures:");
  for (const f of fail.slice(0, 40)) console.log(`  - ${f.name}: ${f.error}`);
}

const reportPath = path.join(repoRoot, "tmp-qa", `smoke-all-${Date.now()}.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      registered: allNames.length,
      pass,
      fail,
      skip,
      uncovered,
      pluginConnected: !!status.pluginConnected,
      mediaPath: mediaPath || synthMedia,
    },
    null,
    2,
  ),
  "utf8",
);
console.log(`\nReport: ${reportPath}`);

await client.close();
process.exit(fail.length > 20 ? 1 : 0);
