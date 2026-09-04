# Changelog

All notable changes to PPMCP are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses
[Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-09-04

Quality-of-life release. Nothing about how edits are performed changed — this
is about how much the model has to carry, how the project is verified, and how
people connect to it.

### Added

- **Tool-surface profiles — `PPMCP_PROFILE=core|standard|full`.** The server no
  longer registers all 277 schemas in every session. `standard` (the new
  default) registers 109; `core` registers 19 for small models;
  `full` restores the 1.0.x behaviour. Profile membership is derived from
  evidence, not taste: every tool with a recorded live pass in
  `tmp-qa/smoke-all-*.json` plus the atomics exercised in the real ~48 s
  multi-track session documented in the README. See
  `server/src/toolProfiles.ts`.
- **`tool_profile` — the model can widen its own tool surface.** The profile
  is a starting point, not a cap. Every one of the 277 tools is registered
  with the MCP server at boot; the ones outside the profile are merely
  disabled. `tool_profile({ profile: "full" })` turns them all on,
  `{ category: "color" }` turns on one area, `{ enable: [...] }` turns on
  named tools, and calling it with no arguments just reports the current
  state. The server then emits `notifications/tools/list_changed` and the
  client refreshes its own tool list — no restart, no config edit, no asking
  the operator. Naming a profile also clears anything pinned earlier, so
  "back to `core`" really shrinks. The whole switch emits **one**
  notification, not one per tool.
- **Meta-tools: `tool_search` → `tool_schema` → `tool_invoke`.** The full
  catalog stays one call away regardless of profile. `tool_search` ranks by
  name/title/description, `tool_schema` prints a tool's parameters, and
  `tool_invoke` validates arguments against that tool's own zod schema before
  running it through the same rate limiter as a direct call. **Nothing became
  unreachable** — only resident.
- **Continuous integration** (`.github/workflows/ci.yml`). Build, typecheck and
  two catalog checks on Windows and Linux, Node 20 and 22. Linux is there to
  catch the path and case assumptions that would block macOS support later.
- **`scripts/check-profiles.mjs`** — fails if a profile lists a tool that does
  not exist, contains duplicates, or drops one of the documented entry tools.
  A typo used to silently shrink the registered surface.
- **`scripts/check-catalog.mjs`** — fails on duplicate tool names, missing
  handlers/titles/descriptions, unusable zod shapes, or a meta-tool name
  collision. Runs without Premiere, so it can gate every push.
- **`scripts/test-tool-profile.mjs`** — boots a real MCP stdio session and
  exercises the whole surface-switching path end to end: starting profile,
  finding a hidden tool, registering a category, calling the newly registered
  tool, taking the full catalog, shrinking back, and reaching a disabled tool
  through `tool_invoke`. 26 assertions, no Premiere required, runs in CI.
- **`npm run check`** — build + typecheck + all three checks in one command.
- **`PPMCP_NO_AUTOSPAWN=1`** — stops the server from auto-spawning a bridge
  process. For tests and sandboxes.

### Changed

- **Default registered tool count is now 109, not 277.** This is a deliberate
  behaviour change: a full catalog costs thousands of tokens per session before
  a single edit and measurably worsens tool selection. Set
  `PPMCP_PROFILE=full` to get the old surface back.
- **Connection documentation rewritten across all seven READMEs and
  `INSTALL.md`.** Verified, per-client configuration for Claude Desktop
  (including the config file path, which was missing), Claude Code
  (`--scope user`), Cursor (`mcp.json` global/project paths rather than a
  vague menu path), **VS Code / GitHub Copilot** — which uses `servers`, not
  `mcpServers`, and requires `"type": "stdio"` — and Windsurf, plus a generic
  stdio recipe for any other MCP client, a no-client test command, and a
  troubleshooting table. Added an explicit warning about JSON backslash
  escaping, the most common cause of a failed connection.
- **Plugin manifest version bumped** `0.1.0` → `1.1.0` to match the release.
  Cosmetic — the panel is still loaded by path — but if you already have it
  loaded in the UXP Developer Tool, reload it after updating.
- **`server/src/tools/competitive.ts` → `convenience.ts`** (`competitiveTools`
  → `convenienceTools`). Same tools; the name now describes what they do.
- **Documentation is self-contained.** Comparisons against other projects were
  removed from `PLAN.md`, `FEATURES.md`, `ARCHITECTURE.md`, `AGENT.md`,
  `skill/SKILL.md` and the tool descriptions, and replaced with PPMCP's own
  design rules and verification evidence.

### Fixed

- **The meta-tools were rate-limited for no reason.** `tool_search`,
  `tool_schema` and `tool_profile` never touch Premiere — they read the
  in-process catalog and flip registration flags — but they were subject to
  the ~220 ms floor that exists to stop edit spam from crashing the host. A
  model doing `tool_search` → `tool_schema` → `tool_profile` in sequence got
  `RATE_LIMITED` purely for orienting itself. All three are now exempt;
  `tool_invoke` deliberately is not, because it runs a real tool.
- **Stale status banners.** `PLAN.md` still announced "Still pre-implementation
  — 0 production code written" and `FEATURES.md` claimed "0 of these 275 exist
  as working code today", while 277 tools had been shipping since 1.0.0. Both
  now describe what actually exists.
- **`npm run build` failing on a tree without workspace symlinks** — surfaced
  as `Cannot find module '@ppmcp/shared'`. `npm ci` (now run in CI) restores
  them, and CI fails loudly if it ever regresses.

### Docs

- New **[docs/ROADMAP.md](./docs/ROADMAP.md)** — repo audit and prioritized
  work, with the confirmed Adobe platform limits kept in one place so they stop
  being re-proposed. Next up: `.ccx` + UPIA one-click install, an `.mcpb`
  bundle, and a machine-readable verification manifest that generates
  FEATURES.md's status tables.
- Confirmed again on 2026-09-04 against Adobe's `ppro_reference` that
  `Sequence` still exposes no add-track method — **`track_add` remains
  impossible**, plan the track count at `sequence_create`. Also checked
  `CaptionTrack`: no documented write path (only `createSetNameAction` and
  `setMute`), so real caption-track support stays a feasibility question, not
  a promise.

## [1.0.2] — 2026-07-11

Follow-up release after another real Premiere test session.

### Confirmed working

- **`sequence_set_in_out`** — the 1.0.1 fix is now **verified live**: a re-test
  set the in/out points and returned
  `"via": "sequence.createSetInPointAction + sequence.createSetOutPointAction"`.
  Promoted from "fix applied, pending re-test" to confirmed.

### Fixed

- **`app_get_version`** — no longer returns `null`. The old code read `version`
  off the `Application` **class**, but per Adobe's `ppro_reference` `version` is
  an *instance* property (`Promise<string>`, 25.6+), so it never resolved. Now
  reads the version from the UXP **host** object
  (`require("uxp").host.version`) and returns `{ version, host, uxpVersion }`.
  *(Fix applied, pending a live re-test.)*

### Corrected documentation

- **`track_add` workaround retracted.** 1.0.1 suggested "place a clip at a
  higher track index and let Premiere auto-create the track." That was **tested
  and does NOT work** on this build — it fails with `"[INTERNAL_ERROR] BE: An
  invalid track index was passed to the sequence"`. The track count is fixed at
  sequence creation and cannot be increased afterward **by any means**; plan it
  at `sequence_create` (or use a preset with enough tracks). Docs, tool
  descriptions, and the plugin error message updated accordingly.

## [1.0.1] — 2026-07-11

Bug-fix and capability release driven by real end-to-end Premiere testing.
The atomic-transaction core and the wider tool surface held up; the items
below are what changed since 1.0.0.

### Fixed

- **`sequence_set_in_out`** — root cause found and corrected. The in/out
  Action factories live on the **`Sequence` object itself**
  (`sequence.createSetInPointAction` / `createSetOutPointAction`, Premiere
  25.6+), **not** on `SequenceEditor` where the previous attempt looked.
  Both points are now committed in **one compound transaction**, so the
  timeline never passes through an invalid `in > out` intermediate state.
  Old editor/direct-method paths are kept as fallbacks. *(Fix applied,
  pending a live re-test.)*
- **`clip_append`** — **confirmed working** in a real session. It now shares
  `clip_insert`'s multi-variant retry helper and appends clips in the
  correct order (previously failed with `"Script action failed to
  execute"`).
- **`media_get_info` / `media_analyze_file_info`** — opportunistically probe
  duration / frame size / frame rate, feature-detected.

### Added

- **Full Effects panel is now usable by the model, not just the dedicated
  shortcuts.** `effect_list_available` gains a `kind: "video" | "audio"`
  filter so the model can pull the video-only Effects panel (~105 effects);
  `effect_add` now clearly accepts either a friendly `displayName`
  (e.g. `"Lens Distortion"`) or the raw `matchName`. Agent guidance added to
  `skill/SKILL.md`.

### Known limitations

- **`track_add` / `track_add_video` / `track_add_audio`** — confirmed **Adobe
  platform limitation**, not a plugin bug. The Premiere UXP API exposes no
  add-track method on `Sequence` or `SequenceEditor` (verified against
  Adobe's official `ppro_reference`). Plan the track count up front at
  `sequence_create` (or a preset with enough tracks); it cannot be increased
  afterward. This caps `sequence_create` / `sequence_create_from_media` at
  the preset's track count (~3 video + 3–4 audio). *(See 1.0.2 — the
  "higher track index auto-creates a track" idea suggested here was later
  tested and does not work.)*

### Docs

- Tool count corrected to **277** (225 per-category tools + 52 generated
  dedicated effect/audio/transition shortcuts), across ~20 categories.
- Status tables updated across `README.md`, `README.tr.md`,
  `docs/FEATURES.md`, and the short `es/de/fr/ja/zh-CN` READMEs.

## [1.0.0] — 2026-07-10

First public release. UXP-first control of Adobe Premiere Pro over MCP —
sequences, clip editing (overwrite/trim/roll/slip/slide/split/ripple),
titles/shapes, audio with safe gain defaults, color, transitions, quality
pass, export, and screenshots. Atomic multi-step edits via
`Project.executeTransaction()`, rate limiting, and file checkpoints.
Pure-PowerShell Windows Setup with bundled portable Node.

[1.1.0]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.1.0
[1.0.2]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.2
[1.0.1]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.1
[1.0.0]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.0
