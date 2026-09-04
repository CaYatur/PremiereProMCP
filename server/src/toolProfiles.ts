// Tool-surface profiles.
//
// The full catalog is ~277 tools. Registering every schema in every session
// costs the client thousands of tokens before a single edit happens, and a
// large flat surface measurably hurts tool selection. So the server registers
// a *profile* by default and keeps the rest reachable through the `tool_*`
// meta-tools (server/src/tools/meta.ts).
//
// The profile is a *starting point*, not a cage. Every tool is registered with
// the MCP server at boot; the ones outside the profile are simply disabled.
// `tool_profile` flips them back on at runtime and the server emits
// `notifications/tools/list_changed`, so a model that decides it needs the
// whole catalog can grant itself the whole catalog. `PPMCP_PROFILE` only
// decides what it starts with.
//
// Profile membership is evidence-driven, not taste:
//   - `core`     — orchestration, checkpoints, connection. Enough for a weak
//                  model to run `edit_bootstrap` → `edit_auto` → `edit_verify`.
//   - `standard` — core + every tool with a recorded live pass in
//                  `tmp-qa/smoke-all-*.json` (56 of 268 registered; 0 fail)
//                  plus the atomics exercised in the real ~48s multi-track
//                  session documented in README.md.
//   - `full`     — the entire catalog, as before.
//
// Anything not listed here is still callable via `tool_invoke`. Adding a tool
// to a profile is a deliberate act: it means the tool is worth its schema
// budget in every session.

export type ProfileName = "core" | "standard" | "full";

export const DEFAULT_PROFILE: ProfileName = "standard";

/** Always registered, in every profile — a session cannot start without these. */
const CORE_TOOLS = [
  // Agent orchestration — the intended entry surface.
  "edit_bootstrap",
  "edit_auto",
  "edit_help",
  "edit_run",
  "edit_once",
  "edit_playbook_list",
  "edit_playbook_run",
  "edit_pipeline",
  "edit_quality_pass",
  "edit_delivery",
  "edit_verify",
  "edit_get_report",
  // Undo/safety net.
  "checkpoint_create",
  "checkpoint_restore",
  "checkpoint_list",
  "checkpoint_delete",
  // Connection / orientation.
  "app_get_connection_status",
  "app_get_version",
  "project_save",
] as const;

/**
 * Live-passed in `tmp-qa/smoke-all-1783714630075.json` (56 pass / 0 fail /
 * 212 skipped for missing media), minus the ones already in CORE_TOOLS.
 */
const SMOKE_VERIFIED_TOOLS = [
  "sequence_create",
  "sequence_set_active",
  "sequence_preview_frame",
  "sequence_screenshot",
  "project_import_media",
  "project_list_items",
  "analyze_media_capabilities",
  "analyze_detect_silence",
  "analyze_detect_onsets",
  "analyze_detect_gaps",
  "analyze_detect_scene_changes",
  "analyze_find_unused_media",
  "analyze_get_project_statistics",
  "analyze_get_timeline_summary",
  "analyze_sequence_structure",
  "analyze_suggest_cut_points",
  "analyze_compare_sequences",
  "analyze_transcribe",
  "assembly_rough_cut_from_bin",
  "audio_mute_track",
  "batch_apply_color_preset_to_selection",
  "batch_apply_color_to_selection",
  "caption_import_srt",
  "caption_generate_auto",
  "caption_place_from_srt",
  "markers_add_many",
  "text_add",
  "text_write",
  "text_write_editable",
  "text_write_png",
  "text_set_content",
  "text_set_content_legacy",
  "text_get_content_legacy",
  "text_bridge_ensure",
  "text_system_status",
  "workflow_add_captions_from_audio",
  "workflow_add_lower_third",
  "workflow_add_title_card",
  "workflow_apply_glitch",
  "workflow_clean_silence",
  "time_seconds_to_ticks",
  "time_ticks_to_seconds",
] as const;

/**
 * Exercised in the real ~48s multi-track editing session documented in
 * README.md's "what holds up well under real, end-to-end testing" section.
 * Not covered by the smoke run (it skips anything needing media), but these
 * are the atomics a real cut actually uses.
 */
const SESSION_VERIFIED_TOOLS = [
  "sequence_set_active_by_name",
  "sequence_find_by_name",
  "sequence_list",
  "sequence_get_active",
  "sequence_get_duration",
  "sequence_set_in_out",
  "sequence_create_from_media",
  "track_list",
  "clip_list",
  "clip_overwrite",
  "clip_insert",
  "clip_append",
  "clip_trim",
  "clip_roll",
  "clip_slip",
  "clip_slide",
  "clip_split",
  "clip_ripple_delete",
  "clip_delete",
  "clip_move",
  "clip_set_speed",
  "clip_set_transform",
  "shape_add",
  "shape_set_position",
  "shape_set_fill_color",
  "transition_apply",
  "transition_apply_to_all_cuts",
  "transition_list_available",
  "effect_add",
  "effect_list_available",
  "effect_list_applied",
  "effect_set_param",
  "effect_set_opacity",
  "color_apply_lumetri",
  "color_set_basic_correction",
  "audio_set_gain",
  "audio_get_gain",
  "audio_normalize",
  "marker_add",
  "marker_list",
  "playhead_set_position",
  "playhead_get_position",
  "media_get_info",
  "export_sequence",
  "workflow_audio_fade",
  "workflow_fade_clip",
  "workflow_summarize_timeline",
  "workflow_cleanup_test_sequences",
] as const;

const CORE = new Set<string>(CORE_TOOLS);
const STANDARD = new Set<string>([
  ...CORE_TOOLS,
  ...SMOKE_VERIFIED_TOOLS,
  ...SESSION_VERIFIED_TOOLS,
]);

/** Meta-tools are registered separately by index.ts and are never filtered. */
export const META_TOOL_NAMES = ["tool_search", "tool_schema", "tool_invoke", "tool_profile"] as const;

export const PROFILE_ORDER: readonly ProfileName[] = ["core", "standard", "full"];

export function parseProfile(raw: string | undefined): ProfileName {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "core" || v === "standard" || v === "full") return v;
  return DEFAULT_PROFILE;
}

/** Is `name` part of `profile`? `full` includes everything. */
export function inProfile(name: string, profile: ProfileName): boolean {
  if (profile === "full") return true;
  if (profile === "core") return CORE.has(name);
  return STANDARD.has(name);
}

export function profileSize(profile: ProfileName, total: number): number {
  if (profile === "full") return total;
  if (profile === "core") return CORE.size;
  return STANDARD.size;
}
