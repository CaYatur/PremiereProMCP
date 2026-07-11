# Changelog

All notable changes to PPMCP are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses
[Semantic Versioning](https://semver.org/).

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

[1.0.2]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.2
[1.0.1]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.1
[1.0.0]: https://github.com/CaYatur/PremiereProMCP/releases/tag/v1.0.0
