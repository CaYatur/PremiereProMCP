# Feature / Tool List

> **⚠ IMPLEMENTATION STATUS (updated 2026-07-11, post-install real-app
> testing pass):** 277 MCP tools are implemented in code (server
> `allTools`, `server/src/tools/index.ts` — counted at runtime: 225 in the
> per-category files + 52 generated dedicated effect/audio/transition
> shortcuts). Most of the catalog below is
> **type-verified** — it maps to a real, documented method in
> `@adobe/premierepro`'s type declarations and is very likely to work, but
> has not been individually runtime-exercised yet. A smaller set has been
> **live-verified** (✅) or **verified-composed** (⚠, built from confirmed
> primitives inside one `Project.executeTransaction()` — see below). Treat
> "no tag" as "should work," not "proven," until it's been called against a
> real Premiere session.
>
> **The atomic-transaction design works well.** Multi-step edits (roll,
> slip, slide, and any workflow tool composed from several primitive
> `Action`s) are wrapped in `Project.executeTransaction()` inside
> `Project.lockedAccess()` — see `runTransaction()` in
> `plugin/src/ppro.js`. This is the part of the design that has held up
> best under real testing: composed edits commit as one atomic unit or not
> at all, so a failure partway through doesn't leave the timeline in a
> half-edited state.
>
> **Correction (2026-07-11, after a real end-to-end editing session):**
> the paragraph below previously claimed `clip_insert` was confirmed broken
> on this Premiere build. That was wrong — it was based on an earlier,
> simpler implementation and a static-code read, not a fresh live test.
> The current `clip.js` retries ~10 internal variants (item cast, 5
> limitShift/audio-index combos) before giving up, and in a real session
> building a ~48s multi-track sequence, `clip_insert` **succeeded on every
> one of ~19 video/audio clip placements** via one of those variants
> (`"via": "insert-raw"` in the response). `marker_add` has the same style
> of retry (5 marker-type × 3 duration combos) and added 7 markers with no
> reported error in the same session — though we can't yet tell from that
> alone whether it went through the native path or the virtual-marker
> fallback (both return the same success shape). **Lesson: don't trust a
> "confirmed broken" claim that isn't backed by a live test against the
> current code** — the retry hardening below can silently fix what an
> earlier probe found broken.
>
> **Status after two real sessions (2026-07-11) — what's now confirmed,
> fixed, or a hard platform limit:**
> 1. **`clip_append`** — **NOW CONFIRMED WORKING in a real session.** It
>    previously failed with `"Script action failed to execute"` (one fixed
>    attempt instead of `clip_insert`'s retry logic); the fix made both share
>    the same ~10-variant retry helper (`insertProjectItemWithRetry` in
>    `plugin/src/handlers/clip.js`), and a re-test confirmed it appends clips
>    in the correct order. Promote from "fixed, pending re-test" to ✅.
> 2. **`track_add` / `track_add_video` / `track_add_audio`** — **CONFIRMED
>    ADOBE PLATFORM LIMITATION, not fixable plugin-side.** Verified
>    2026-07-11 against Adobe's official `ppro_reference`: neither the
>    `Sequence` class nor `SequenceEditor` exposes any
>    `addTrack`/`addVideoTrack`/`addAudioTrack`/`createAddTrackAction`. The
>    capability is simply absent from the Premiere UXP API. The handler still
>    feature-detects (so it starts working the day Adobe ships one) but today
>    returns a clear error. **Workarounds:** create the sequence with enough
>    tracks up front (`sequence_create`/a preset), or place a clip at a
>    higher track index with `clip_overwrite`/`clip_insert` (both now work) —
>    Premiere is expected to auto-create the intervening tracks. This also
>    caps `sequence_create`/`sequence_create_from_media` at the preset's
>    track count (≈3 video + 3–4 audio).
> 3. **`sequence_set_in_out`** — **ROOT CAUSE FOUND AND FIX CORRECTED
>    (pending live re-test).** Real testing walked it through two errors:
>    first `"sequence.setInPoint is not a function"`, then — after the first
>    fix attempt — `"no candidate method found… Not exposed via UXP
>    Sequence/SequenceEditor"`. That first attempt looked for the Action
>    factory on the **wrong object** (`SequenceEditor`). Per Adobe's official
>    `ppro_reference`, `createSetInPointAction`/`createSetOutPointAction` are
>    on the **`Sequence` object itself**, introduced in Premiere 25.6. The
>    handler now calls `sequence.createSetInPointAction(t)` /
>    `createSetOutPointAction(t)` and commits both in **one compound
>    transaction** (no invalid in>out intermediate state), keeping the
>    editor/direct paths as fallbacks. Since `clip_append` (a 25.6-era
>    `createInsertProjectItemAction` path) works on this build, the build is
>    ≥25.6, so these factories should be present — hence "should work," not
>    just "might."
> 4. **`media_get_info` / `media_analyze_file_info`** — never returned
>    duration, resolution, or frame rate; `ClipProjectItem` only exposes
>    path/proxy/offline-style fields via UXP (see `plugin/src/handlers/
>    media.js`'s own header comment — this was researched, not
>    overlooked). **Hardened:** now opportunistically probes `getDuration`,
>    `getFrameSize`, `width`/`height`, `getFrameRate`, feature-detected —
>    returns them if this build happens to expose any, `undefined`
>    otherwise (no worse than before). Workaround either way: shell out to
>    `ffprobe` on the source file path.
>
> **Lower-confidence, not re-verified this round:** `text_set_content`
> (editing an *existing* graphic's text — only reliable with the optional
> CEP Text Bridge connected to an AE-authored MOGRT, otherwise the pure-UXP
> path throws `"Illegal Parameter type"` on the MOGRT `Text` property; use
> `text_write`/`text_add` instead for placing new text, which always
> succeeds via a guaranteed PNG fallback) and `shape_set_size` (the bundled
> shape MOGRT never exposed a real `Size` master property, so it falls back
> to a single uniform Motion Scale % approximation, not independent
> width/height) — both are carried over from an earlier code-level probe.
> Given `clip_insert` turned out better than that same style of analysis
> suggested, treat these two as "worth a fresh live check," not settled.
>
> **Also found and fixed: a fade/keyframe ordering footgun, not a tool
> bug.** `workflow_audio_fade`/`workflow_fade_clip` read the clip's
> *current* start/end at call time — correct in isolation, but if you trim
> the clip's length *after* adding fades, the old fade-out keyframe can end
> up past the new out-point and silently stop applying (fade-in still
> works, fade-out doesn't). Both tools' descriptions now explicitly warn
> the model to trim to final length before adding fades.
>
> **Everything else exercised in this testing pass** — connect/reconnect,
> reading project/sequence state, creating sequences, listing tracks,
> `clip_overwrite`/trim/roll/slip/slide, shape add + position + fill color,
> `text_write`'s PNG path, gain/dB control, listing effects/transitions,
> and `project_save`/`sequence_screenshot` — worked as documented.
>
> See `docs/ARCHITECTURE.md` §2.4 for the Text gap's full detail. The
> remaining categories below (multicam, proxy/media, analysis, batch, most
> of markers/metadata, the dedicated-shortcut catalog, and the 12
> high-level workflow tools) are lower-confidence / spec-level and have not
> had a dedicated real-app pass yet.

Status: **Draft target list for v1 — honestly tiered by verification
level.** Desk research read Adobe's official `@adobe/premierepro` v26.3.0
type declarations (PLAN.md §3, Gate 1) line-by-line for the core editing
surface (`Sequence`, `SequenceEditor`, `TrackItem`/clip types, `Component`/
`ComponentParam`, `TransitionFactory`) and confirmed insert, overwrite,
ripple delete, trim, move, full keyframing, generic effect add/remove, and
transitions all map to real, documented methods. **That core — the actual
"edit quality" claim — is solid.**

The same pass also *specifically checked* the creative/analysis surface the
first competitor research flagged as risky, and found real gaps: **no
dedicated Lumetri/color API, no waveform/scope data readout, no
auto-transcription trigger (only transcript JSON import/export), no
freeform text/title creation (MOGRT insert only), no Essential-Sound preset
methods (ducking/noise reduction/dialogue enhance), and no multicam
sync/create/switch-angle methods** (only `isMulticamClip()` exists). Every
tool below now carries an explicit verification tag — see the legend — so
this list stops overclaiming category by category instead of at the end.
Last updated: 2026-07-10

Total: **~219 tools** across 16 categories, plus a small set of high-level
workflow tools. This comfortably clears the 150+ bar while staying short of
the "1,000+ tools" competitor claims — the bet here is documented breadth
and reliability beats padded count (see PLAN.md §2).

## 1. Design principles

These rules apply to every tool below, and are as important as the list
itself — they're what makes the difference between "150 tools a frontier
model can technically call" and "150 tools *any* model reaches for
correctly."

1. **Naming convention:** `domain_verb_noun` in snake_case, one clear
   domain prefix per category (`clip_`, `sequence_`, `color_`, …). The
   prefix alone should let a model guess which tool handles a request.
2. **Tiered design — this is not optional.** A flat list of 219 equally
   -weighted tools is a known failure mode for weaker models (schema noise
   crowds out correct selection). So the tool surface has two layers:
   - **Workflow tools** (§2, ~15-20 tools): high-level, multi-step
     operations like "assemble a rough cut from this bin" or "apply this
     color look to the selected clips." These are what a simple model
     reaches for by default, and they internally chain several atomic
     operations in the plugin/relay layer — the model doesn't need to
     orchestrate the steps itself.
   - **Atomic tools** (§3, the full catalog): one operation each, for
     precision work and for stronger models that want fine control.
   Both layers are real MCP tools; workflow tools are not a separate
   product, just a curated, higher-level entry point.
3. **If the client supports it, expose category-based tool
   grouping/enablement** so a client (or the user) can turn off categories
   they're not using in a given session, shrinking the effective schema set
   a weak model has to search. Treat this as a stretch goal — depends on
   what the target MCP clients actually support in Phase 1.
4. **Rich schemas, not terse ones.** Every parameter has a description,
   sensible defaults, and enums instead of free-text where the underlying
   Premiere API is enum-constrained (transition types, easing/interpolation
   types, track types). Every tool description states what it does, what
   it needs to already exist (e.g. "requires an active sequence"), and what
   it returns.
5. **Fail loud and specific.** Every error surfaced to the model has a
   stable machine-readable code and an actionable message (see
   ARCHITECTURE.md §3) — "no clip selected," not "operation failed."
6. **MCP resources for read-heavy state.** Frequently-needed contextual
   state (current project structure, active sequence's clip list, current
   playhead position) is exposed as MCP **resources**, not tools, so a
   model can pull context without spending a tool-call round-trip and
   without that state cluttering the tool list itself.
7. **A shipped usage guide.** Ship a skill/prompt-resource document with
   common workflows worked out end-to-end (rough cut → trim → color →
   captions → export), mirroring what `lordhoell/davinci-resolve-mcp` does
   with its Claude Code skill. This is what teaches a model to *chain*
   tools well, not just call them individually.

**Verification legend** (applied per tool below):
- *(no tag)* — **Type-verified.** Maps to a specific method read directly in
  `@adobe/premierepro` v26.3.0's type declarations. **Caveat, confirmed
  2026-07-10 by the live probe below: type declarations do not guarantee
  runtime availability** — `Transcript.querySupportedLanguages()` is
  documented but threw `is not a function` in a real Premiere Pro 2026
  session. Treat "no tag" as "very likely to work," not "proven," until a
  tool has been runtime-exercised.
- **✅** — **Live-verified.** Actually called successfully against a
  running Premiere Pro 2026 instance via the Phase 0 diagnostic plugin
  (`spike/diagnostic-plugin/`), 2026-07-10. The strongest tier.
- **⚠** — **Verified, composed.** Built from multiple confirmed primitives
  inside one `Project.executeTransaction()` (roll/slip/slide-style edits) —
  existence confirmed, exact runtime behavior (atomicity, linked-AV edge
  cases) pending further live testing.
- **🔧** — **Generic mechanism confirmed, specific target identified.**
  Backed by a real factory API (`VideoFilterFactory.createComponent`,
  `AudioFilterFactory.createComponentByDisplayName`,
  `TransitionFactory.createVideoTransition`) that can instantiate *any*
  effect by match/display name. Where the live probe below found the exact
  name (e.g. Lumetri Color = `AE.ADBE Lumetri`), that's noted explicitly;
  otherwise the name still needs a lookup, but the mechanism itself is live
  -confirmed to work (105 real video filters and 54 real audio filters were
  successfully enumerated).
- **❔** — **Not found, or found-but-broken.** No matching method exists in
  `@adobe/premierepro`'s type declarations, or it exists in the types but
  failed at runtime (see the Transcript caveat above). Either not possible
  via UXP today, needs a from-scratch implementation on top of confirmed
  primitives (e.g. our own silence/scene-detection algorithm, or our own
  ducking via level analysis + volume keyframes, rather than an Adobe
  built-in), or is a legitimate candidate to cut/defer past v1. Do not
  market these as confirmed capabilities until further testing.
- **🧩** — **Confirmed impossible via pure UXP, confirmed *possible* via a
  narrow ExtendScript/QE-DOM helper.** Not a guess — backed by a live
  negative result here (MOGRT text/graphic-layer properties do not appear
  in UXP's `getComponentChain()` at all, see the 2026-07-10 live test
  below) plus a corroborating, independently-documented Adobe developer
  -forum report of the exact same UXP limitation, plus a
  community-verified working ExtendScript technique for the same
  operation. This is the one deliberate, narrow exception to "no
  ExtendScript fallback" in PLAN.md §3 — scoped to graphic/MOGRT property
  read-write only, not a general legacy bridge.

**Live probe results (2026-07-10, Premiere Pro 2026, real project open):**
video filters: 105 enumerated, incl. confirmed `AE.ADBE Lumetri` ("Lumetri
Color"), `Warp Stabilizer`, `Crop` (enumeration only — *applying* any of
these was not itself exercised). Audio filters: 54 enumerated, incl.
`DeNoise`, `DeReverb`, `DeHummer`, `Adaptive Noise Reduction`, `Vocal
Enhancer` (no ducking-specific effect — confirms `audio_apply_auto_ducking`
needs a from-scratch implementation). Video transitions: 100+ enumerated,
incl. `AE.ADBE MorphCut` (again, enumeration only). Active project + root
-item read access: confirmed working (`project.name`, `getRootItem()`).
**Active sequence: inconclusive** — `getActiveSequence()` didn't error, but
returned something whose downstream reads never populated, most likely
because the test project had no sequence open — untested, not proven
broken. `Transcript.querySupportedLanguages()`: confirmed **broken** at
runtime despite being in the type declarations. `Application.version`:
resolved to `undefined` at runtime despite being a documented `readonly`
property — a second, smaller type-vs-runtime gap.

**Second live probe (2026-07-10, write test):** `project.createSequence(name)`
**confirmed live** — creates a real new sequence
(`sequence_create` graduates to ✅). `SequenceEditor.insertMogrtFromPath()`
**confirmed live** — Adobe's own bundled `Basic Title.mogrt`
(`C:\Program Files\Adobe\Adobe Premiere Pro 2026\Essential Graphics\Basic
Title.mogrt`, present by default on any Premiere Pro install) was
successfully inserted onto the new sequence, no extra file-system
permissions needed (`title_apply_mogrt` graduates to ✅). **But** the
inserted item's `getComponentChain()` returned only **3 generic transform
components — `Opacity`, `Motion`, `Vector Motion`** (11-6 params each, all
standard position/scale/rotation/crop controls every clip has) — the
MOGRT's own actual "Basic Title" **text content is not among them.** No
component with a text-like param was found (`textParamFound: null`).
Corroborated independently by a live Adobe developer-forum thread
(`forums.creativeclouddeveloper.com/t/setting-mogrt-text-parameters-in-premiere-uxp/11969`):
UXP cannot read or write the `AE.ADBE Text` component's `Source Text`
parameter on a MOGRT — a known platform limitation, not a mistake in our
probe. A working **ExtendScript** technique is documented on Adobe's
community forums instead: get the component via `clip.getMGTComponent()`
(or the equivalent on an imported MGT), find the one with
`matchName === "AE.ADBE Text"`, JSON-parse its parameter value, set
`textEditValue` + `fontTextRunLength`, write it back. **Consequence:**
MOGRT/graphic text and per-layer styling is real, achievable, v1-viable
work — but only through a narrow ExtendScript helper (tag 🧩), not pure
UXP. This is the one deliberate exception to "no ExtendScript fallback,"
see PLAN.md §3.

## 2. Workflow tools (high-level, composite)

| Tool | Description |
|---|---|
| `assembly_rough_cut_from_bin` | Assemble clips from a bin onto a new/target sequence in order, with default transitions |
| `assembly_apply_edl` | Apply an edit decision list to build/modify a sequence |
| `workflow_trim_to_length` | Trim a sequence or selection to a target duration using sensible ripple rules ⚠ |
| `workflow_apply_color_look` | Apply a named color look/LUT/preset to selected clips with auto-balancing 🔧 |
| `workflow_add_captions_from_audio` | Generate, style, and place captions for a sequence in one call ❔ (blocked on `caption_generate_auto`, no STT trigger found) |
| `workflow_add_lower_third` | Insert a styled lower-third graphic at the playhead/selection with given text 🧩✅ (technique fully confirmed; use our own bundled AE-authored lower-third template, not Adobe's non-`[AE]` ones which are confirmed broken for this) |
| `workflow_sync_and_build_multicam` | Sync multicam sources and build a ready-to-cut multicam sequence ❔ (entire multicam category unconfirmed) |
| `workflow_clean_silence` | Detect and ripple-delete silence across a sequence or selection ❔ (delete step confirmed; silence *detection* is a from-scratch implementation) |
| `workflow_prep_for_export` | Normalize audio loudness, check for offline media, and export with a named preset in one call |
| `workflow_summarize_timeline` | Return a compact, model-readable summary of the current sequence (clips, gaps, duration, markers) |
| `workflow_apply_chroma_key` | Add and configure a green/blue-screen key on a clip in one call 🔧 (`Ultra Key` live-confirmed to exist in the 105-filter catalog; parameter mapping not yet probed) |
| `workflow_create_picture_in_picture` | Scale, position, and border a clip on an upper track over another clip (PIP/split-screen) 🔧 (composed from confirmed `effect_set_transform` + track layering, no dedicated PIP primitive needed) |

(Full workflow set finalized after Phase 0/1; this is the initial target
set — expect this list to grow as real usage patterns emerge.)

## 3. Atomic tool catalog

### A. Project Management — `project_*` (20)
Live probe confirmed `Project.getActiveProject()`, reading `project.name`,
and `project.getRootItem()` against a real, open project.
`project_open`, `project_create`, `project_save`, `project_save_as`,
`project_close`, `project_get_info` ✅, `project_list_recent`,
`project_import_media`, `project_list_items` ✅, `project_create_bin`,
`project_move_item_to_bin`, `project_rename_item`, `project_delete_item`,
`project_search_items`, `project_relink_media`,
`project_find_offline_media`, `project_get_settings`,
`project_set_settings`, `project_get_selection`, `project_consolidate`

### B. Sequence Management — `sequence_*` (12)
**Note: real shipped tool names, corrected 2026-07-11** — the previous
catalog listed several planning-era names (`sequence_create_from_preset`,
`sequence_duplicate`, `sequence_nest`, `sequence_rename`,
`sequence_zoom_to_fit`, `sequence_get_render_bar_status`) that were never
implemented under those names. Real list, real tags:
`sequence_create` ✅, `sequence_get_active`, `sequence_list`,
`sequence_set_active`, `sequence_get_settings`,
`sequence_set_in_out` ❔ (root cause found + fix corrected 2026-07-11, pending live re-test — the Action factory lives on the `Sequence` object, not `SequenceEditor`; now calls `sequence.createSetInPointAction`/`createSetOutPointAction`, Premiere 25.6+, both in one compound transaction — see status callout above),
`sequence_delete`, `sequence_close`,
`sequence_create_from_media` (the fallback destination when `clip_insert` truly can't insert — see §D), `sequence_get_duration`, `sequence_get_tracks`,
`sequence_export_frame`

### C. Track Operations — `track_*` (10)
**Note: real shipped tool names, corrected 2026-07-11** — the previous
catalog's `track_remove`/`track_set_enabled`/`track_set_locked`/
`track_set_muted`/`track_set_solo`/`track_set_height`/`track_set_target`
don't match what shipped. Real list, real tags:
`track_list`, `track_add`, `track_delete`, `track_set_mute`,
`track_set_lock`, `track_set_output_enabled`, `track_rename`,
`track_get_items`,
`track_add` ✗, `track_add_video` ✗, `track_add_audio` ✗ (confirmed Adobe
platform limitation, verified 2026-07-11 against the official
`ppro_reference` — no add-track method exists on `Sequence` or
`SequenceEditor`; not a plugin bug and not fixable plugin-side. Workaround:
plan track count at `sequence_create`, or drop a clip at a higher track
index via `clip_overwrite`/`clip_insert` to force-create tracks — see
status callout above)

### D. Clip / TrackItem Editing — `clip_*` (33) — the "edit quality" core
`clip_insert` ✅ (live-confirmed on ~19 clips in a real session via internal multi-variant retry — see status callout above; can be slow due to the retry loop), `clip_overwrite` ✅, `clip_append` ✅ (was broken — `"Script action failed to execute"` — now shares `clip_insert`'s retry logic via one helper; re-test 2026-07-11 confirmed it works and appends in the correct order), `clip_ripple_delete`,
`clip_lift`, `clip_extract`, `clip_trim_in`, `clip_trim_out`,
`clip_roll_edit` ⚠, `clip_slip` ⚠, `clip_slide` ⚠, `clip_move`,
`clip_duplicate`, `clip_split`, `clip_split_at_playhead`, `clip_delete`,
`clip_group`, `clip_ungroup`, `clip_link_audio_video`,
`clip_unlink_audio_video`, `clip_set_enabled`, `clip_set_speed`,
`clip_set_duration`, `clip_reverse`, `clip_freeze_frame`,
`clip_set_in_out_points`, `clip_get_properties`, `clip_set_transform`,
`clip_replace_footage`, `clip_get_timeline_selection`, `clip_select`,
`clip_nest_selected`, `clip_align_to_playhead`

### E. Transitions — `transition_*` (8)
Video path **live-verified**: `TransitionFactory.createVideoTransition(matchName)`
+ `getVideoTransitionMatchNames()` returned 100+ real transitions (incl.
`AE.ADBE MorphCut`, `AE.ADBE Cross Dissolve New`, `ADBE Additive Dissolve`).
No equivalent audio-transition factory was found in the type declarations.
`transition_add_video` 🔧 (the transition exists — `createVideoTransition()` itself not yet called), `transition_add_audio` ❔,
`transition_add_default_at_cut`, `transition_set_duration`,
`transition_set_alignment`, `transition_remove`,
`transition_list_available` ✅, `transition_apply_to_all_cuts`

### F. Effects — `effect_*` (19)
`effect_list_available` ✅ (105 real video filters enumerated live),
`effect_add`, `effect_remove`,
`effect_list_applied`, `effect_set_parameter`, `effect_get_parameter`,
`effect_add_keyframe`, `effect_remove_keyframe`,
`effect_set_keyframe_interpolation`, `effect_copy`, `effect_paste`,
`effect_apply_preset`, `effect_save_preset`, `effect_set_transform`,
`effect_set_opacity`, `effect_set_blend_mode`,
`effect_apply_warp_stabilizer` 🔧 (the effect exists in the catalog — `createComponent()` itself not yet called), `effect_apply_crop` 🔧 (same), `effect_reset`

### G. Color Grading (Lumetri) — `color_*` (14)
No dedicated Lumetri API exists, but the live probe confirmed the exact
matchname: **`AE.ADBE Lumetri`** (display name "Lumetri Color"), addable via
`VideoFilterFactory.createComponent('AE.ADBE Lumetri')` — live-verified to
exist in the enumerated filter list. Driving its individual controls
(exposure, contrast, wheels, curves) still needs generic `ComponentParam`
index mapping (`getParam(i)`/`getDisplayName()` per index — not yet probed,
the component was found but not instantiated/inspected). `color_get_scopes_data`
has no backing API found at all — numeric waveform/vectorscope/histogram
readout does not appear to be exposed to UXP.
`color_apply_lumetri` 🔧 (matchname known: `AE.ADBE Lumetri`), `color_set_basic_correction` 🔧,
`color_set_white_balance` 🔧, `color_set_saturation_vibrance` 🔧,
`color_set_rgb_curves` 🔧, `color_set_hue_saturation_curves` 🔧,
`color_set_color_wheels` 🔧, `color_apply_lut` 🔧, `color_match_color` ❔,
`color_apply_creative_look` 🔧, `color_get_scopes_data` ❔, `color_copy_grade` 🔧,
`color_paste_grade` 🔧, `color_reset_grade` 🔧

### H. Audio — `audio_*` (14)
Core level/gain control and keyframing are verified against
`AudioClipTrackItem`/`ComponentParam`. The live probe enumerated 54 real
audio filters, confirming `DeNoise`, `DeReverb`, `DeHummer`, `Adaptive
Noise Reduction`, and `Vocal Enhancer` all exist — noise reduction and
dialogue-cleanup building blocks are real. **No ducking-specific effect
was found** (only `Loudness Meter`/`Loudness Radar`, which are metering
tools, not an action) — auto-ducking is confirmed to need a from-scratch
implementation (level analysis + our own volume keyframing), not an Adobe
built-in. Same conclusion for loudness *normalization*: metering exists,
a one-call "normalize to target LUFS" action does not.
`audio_set_gain`, `audio_set_volume_keyframe`,
`audio_normalize_loudness` ❔, `audio_apply_auto_ducking` ❔,
`audio_apply_noise_reduction` 🔧 (`DeNoise`/`Adaptive Noise Reduction` live-confirmed), `audio_apply_dialogue_enhance` 🔧 (`DeReverb`/`Vocal Enhancer` live-confirmed),
`audio_set_channel_mapping`, `audio_extract_to_clip`, `audio_mute_track`,
`audio_solo_track`, `audio_apply_essential_sound_preset` ❔,
`audio_get_waveform_data` ❔, `audio_pan_set`, `audio_get_levels`

### I. Titles, Graphics & Captions — `text_*`, `title_*`, `caption_*`, `shape_*` (19)
**Updated 2026-07-10 — text editing is now FULLY live-confirmed
end-to-end, with a critical caveat about which MOGRT you use.** Five live
test rounds (`spike/extendscript-test/test.jsx`, run against real Premiere
Pro 2026 by the user) established:

1. Inserting a MOGRT via UXP is ✅ live-confirmed (no extra permissions).
2. The MOGRT's *internal* text/graphic properties are **not reachable via
   UXP's `getComponentChain()` at all** — confirmed live, independently
   corroborated on Adobe's developer forum. A classic ExtendScript bridge
   *is* required for this specific piece — same conclusion as before.
3. **New, important split: results depend entirely on which MOGRT.**
   Adobe's own bundled, Premiere-native templates (e.g. `Basic
   Title.mogrt`) expose an `AE.ADBE Text` component whose `Source Text`
   parameter's `getValue()` reliably returns one opaque, non-JSON
   character (char code 380) — **broken, reproducibly, not a probe
   mistake.** But an **After-Effects-authored** MOGRT (tested with the
   bundled `[AE] Sports Package/Sports Lower Third Center.mogrt`) uses a
   different, richer `AE.ADBE Capsule` component whose `Title`/`Subtitle`
   properties return **real, well-formed JSON**
   (`{"textEditValue":"COACH ADOBE","fontEditValue":["Bungee-Regular"],
   "fontSizeEditValue":[42],...}`) that we successfully **read, edited
   (preserving font/size/style), wrote back, and re-read to confirm the
   round-trip** — a clean, complete, reproducible win, not a one-off.
4. **Consequence for v1 design:** don't build on Adobe's bundled
   Premiere-native templates for text tools — author and bundle our own
   minimal AE-made MOGRT template(s) (After Effects is already installed
   on the dev machine). To the model/end user this is invisible — a
   `title_create_text("...")` call just works, no template selection
   required — but internally it's "insert our bundled MOGRT (✅ UXP) + set
   its text via the ExtendScript bridge (🧩, now proven not theorized)."
5. **Shapes are a different, partially-open story.** No default blank
   -shape MOGRT exists (confirmed: zero matches for `shape`/`rectangle`/
   `ellipse` in the type declarations, and no such template ships with
   Premiere). But `AE.ADBE Capsule`'s Position/Scale/Rotation-style
   properties are the same `AE.ADBE Motion` pattern already confirmed
   readable via UXP directly (no ExtendScript needed for those). **Color
   properties are a new, distinct wrinkle:** reading `Main Color`/
   `Secondary Color`/`Highlight Color` via classic ExtendScript's
   `getValue()` returned large opaque integers (e.g.
   `72337973781266176`), not usable color data — almost certainly a
   native `Color` object ExtendScript doesn't auto-serialize. UXP,
   however, has `Color` as a first-class supported value type in
   `ComponentParam.createKeyframe(value: number|string|boolean|PointF|
   Color)` (confirmed in the official type declarations) — so the correct
   path for a shape's fill color is very likely the **already-confirmed
   UXP keyframe/param API**, not the ExtendScript bridge. **This specific
   claim is architecturally well-supported but not yet literally tested**
   — there's no shape MOGRT to test it against yet. Author one (a plain
   rectangle/ellipse with an exposed fill-color and size control, built in
   AE, exported as `.mogrt`) as the next concrete validation step before
   treating shapes as fully solved.
Captions are a separate subsystem from MOGRT graphics (`CaptionTrack`,
`Transcript`/`TextSegments`), and are limited on their own terms: listing/
mute only is confirmed; **the live probe confirmed
`Transcript.querySupportedLanguages()` throws `is not a function` at
runtime** — the documented Transcript API is not reliable as-is and needs
its own targeted runtime testing (the MOGRT ExtendScript workaround does
**not** apply here — captions aren't MOGRT graphics).
**Note: the shipped tool names differ from the planning names used in the
narrative above** — the "`title_create_text`"-style read→edit→write→re-read
round-trip described above shipped as the `text_write`/`text_add` resilient
multi-path engine (UXP → CEP → PNG), not as separate `title_*` tools. Real
tool list, real tags:

`text_system_status`, `text_design_guide`, `text_auto_design`,
`text_bridge_ensure` (checks/starts the optional CEP Text Bridge connection),
`text_write` ⚠ (resilient multi-path: tries an AE-authored MOGRT capsule via
UXP/CEP first, always has a PNG-render fallback so it never fails outright —
PNG text is not re-editable afterward), `text_write_editable` (forces the
editable-MOGRT path, no PNG fallback — fails if CEP/UXP both fail),
`text_write_png` (skips straight to the PNG path), `text_add` (alias of
`text_write`),
`text_set_content` ❔ (edits an *existing* graphic's text — only reliable
with the optional CEP Text Bridge connected to an AE-authored MOGRT; the
pure-UXP fallback is confirmed broken — `ComponentParam.createKeyframe()`
throws `"Illegal Parameter type"` for the MOGRT `Text` master property. Use
`text_write` instead if you don't need to re-edit existing text),
`text_get_content` (same CEP-first/UXP-fallback split as above, read-only),
`text_set_content_legacy`, `text_get_content_legacy` (CEP-only, no UXP
fallback — require the Text Bridge panel open), `text_set_position`,
`shape_add` ✅ (live-confirmed: adds a real on-screen shape, position and
fill color round-tripped through `PointF`/`Color`), `shape_set_position` ✅,
`shape_set_size` ❔ (the bundled shape MOGRT never exposed a real `Size`
master property — this tool *always* falls back to a single uniform Motion
Scale % approximation, not independent width/height in pixels),
`shape_set_fill_color` ✅, `title_list_params`,
`caption_generate_auto` ❔, `caption_import_srt` ❔ (downgraded from 🔧 — depends on the now-broken `Transcript` surface), `caption_export_srt` ❔ (same),
`caption_edit_segment_text` ❔, `caption_edit_segment_timing` ❔,
`caption_set_style` ❔, `caption_burn_in` ❔, `caption_list_tracks`,
`caption_create_track` ❔

### J. Markers & Metadata — `marker_*`, `metadata_*` (12)
`marker_add` (added 7 markers with no error in a real session via the same multi-variant retry as `clip_insert` — unconfirmed whether that went through the native path or the virtual-marker Sequence-Properties fallback, since both return the same success shape; if it's the fallback, markers won't appear in Premiere's own marker UI), `marker_remove`, `marker_list` ✅, `marker_set_color`,
`marker_set_type`, `marker_set_duration`, `marker_go_to`,
`metadata_get_clip`, `metadata_set_clip`, `metadata_get_xmp`,
`metadata_set_xmp`, `metadata_batch_tag`

### K. Multicam & Sync — `multicam_*` (5)
Weakest category found. Only `ClipProjectItem.isMulticamClip()` is
confirmed. No create-multicam-sequence, sync-by-audio/timecode,
switch-angle, or flatten method exists in the official type declarations —
this entire category is unconfirmed and may not be scriptable via UXP
today; a strong Phase 0 candidate for "cut from v1, revisit later."
`multicam_create_sequence` ❔, `multicam_sync_by_audio` ❔,
`multicam_sync_by_timecode` ❔, `multicam_switch_angle` ❔, `multicam_flatten` ❔

### L. Proxy & Media Management — `proxy_*`, `media_*` (10)
**Note: real shipped tool names, corrected 2026-07-11** — the previous
catalog omitted `media_get_info` entirely and listed `proxy_create`/
`proxy_toggle_playback_resolution`/`media_get_ingest_settings`/
`media_set_ingest_settings`, none of which match what shipped.
`ClipProjectItem.canProxy()/getProxyPath()/hasProxy()/attachProxy()` are
confirmed. Real list, real tags:
`media_get_info` ❔ (never returned duration/resolution/frame rate — only
path/proxy/offline-style fields; hardened 2026-07-11 with opportunistic,
feature-detected probes for `getDuration`/`getFrameSize`/`width`/`height`/
`getFrameRate`, unverified whether any exist on this build), `proxy_attach`,
`media_go_offline`, `media_relink`, `media_refresh`, `media_rename`,
`media_find_by_path`, `media_go_online`,
`media_analyze_file_info` ❔ (same gap/hardening as `media_get_info`),
`media_browser_search`

### M. Export & Rendering — `export_*`, `render_*` (12)
`export_with_preset`, `export_custom_settings`,
`export_queue_to_media_encoder`, `export_get_queue_status`,
`export_frame_as_image`, `export_batch_sequences`,
`render_preview_in_out`, `render_replace_with_render_file`,
`export_generate_edl`, `export_generate_xml`, `export_get_presets_list`,
`export_cancel`

### N. Project Analysis / AI-assisted — `analyze_*` (10)
No built-in silence/scene-detection API was found. Tools that read
existing project/sequence structure (statistics, timeline summary, gaps,
unused media, comparisons — all computable by walking the confirmed
`Project`/`Sequence`/`TrackItem` object graph) are solidly implementable.
Tools that need audio/video *content analysis* (silence, scene changes,
auto-suggested cut points) have no Adobe-provided primitive — they would
be a from-scratch implementation (e.g. audio level analysis via the
plugin, or an external library) layered on top of confirmed primitives, not
a thin API wrapper. Treat these as real engineering work, not a quick win.
`analyze_sequence_structure`, `analyze_detect_silence` ❔,
`analyze_detect_scene_changes` ❔, `analyze_find_unused_media`,
`analyze_get_project_statistics`, `analyze_get_timeline_summary`,
`analyze_detect_gaps`, `analyze_suggest_cut_points` ❔,
`analyze_compare_sequences`, `analyze_get_edit_history` ❔

### O. Automation / Batch — `batch_*` (7)
`batch_rename_items`, `batch_apply_effect_to_selection`,
`batch_apply_color_preset_to_selection` 🔧, `batch_replace_font_in_titles` 🧩✅ (`fontEditValue` confirmed present and independently settable in the same JSON blob, same live-confirmed technique),
`batch_export_stills_from_markers`, `batch_relink_by_pattern`,
`batch_tag_by_criteria`

### P. Selection, Navigation, Playhead, System — `playhead_*`,
`selection_*`, `workspace_*`, `app_*` (12)
`playhead_get_position`, `playhead_set_position`,
`playhead_go_to_marker`, `playhead_go_to_next_edit`,
`playhead_go_to_previous_edit`, `selection_get_current`,
`selection_set`, `selection_clear`, `workspace_get_active_panel`,
`workspace_set_layout`, `app_get_version` ❔ (live probe: `ppro.Application.version` resolved to `undefined` — a second, quieter type-vs-runtime gap; needs its own lookup), `app_get_connection_status`

### Q. Dedicated common effect/transition shortcuts — `effect_apply_*`, `audio_apply_*`, `transition_add_*` (41)
Added 2026-07-10, directly in response to the competitive tool-count
question: competitors claim 170–1,027 tools (PLAN.md §2); our core
categories land at 234, below two named competitors (269, 278). Rather
than pad the count with speculative/duplicate tools, this category adds
**41 genuinely low-risk, evidence-backed tools** — one dedicated
convenience tool per commonly-needed effect/transition, each targeting a
matchname/display-name the live probe *actually enumerated* as present
(§1's live probe results). All 🔧 (mechanism proven, this specific
application not yet individually exercised — see legend). These also
directly serve model-usability (design principle §1.4): a model calling
`effect_apply_gaussian_blur` doesn't need to know or guess the internal
matchname the way `effect_add(matchName: "...")` would require.

**Video (20):** `effect_apply_gaussian_blur` ("Gaussian Blur"),
`effect_apply_sharpen` ("Sharpen"), `effect_apply_unsharp_mask`
("Unsharp Mask"), `effect_apply_black_and_white` ("Black & White"),
`effect_apply_brightness_contrast` ("Brightness & Contrast"),
`effect_apply_vignette` ("Vignette"), `effect_apply_mosaic` ("Mosaic"),
`effect_apply_mirror` ("Mirror"), `effect_apply_tint` ("Tint"),
`effect_apply_posterize` ("Posterize"), `effect_apply_invert` ("Invert"),
`effect_apply_drop_shadow` ("Drop Shadow"), `effect_apply_glow`
("Wonder Glow"), `effect_apply_light_leaks` ("Light Leaks"),
`effect_apply_rgb_split` ("RGB Split"), `effect_apply_directional_blur`
("Directional Blur"), `effect_apply_bokeh_blur` ("Bokeh Blur"),
`effect_apply_camera_shake` ("Camera Shake"), `effect_apply_corner_pin`
("Corner Pin"), `effect_apply_gradient` ("Gradient")

**Audio (11):** `audio_apply_dehummer` ("DeHummer"), `audio_apply_deesser`
("DeEsser"), `audio_apply_parametric_eq` ("Parametric Equalizer"),
`audio_apply_graphic_eq` ("Graphic Equalizer (10 Bands)"),
`audio_apply_compressor` ("Single-band Compressor"), `audio_apply_limiter`
("Hard Limiter"), `audio_apply_reverb` ("Studio Reverb"),
`audio_apply_surround_reverb` ("Surround Reverb"), `audio_apply_pitch_shifter`
("Pitch Shifter"), `audio_apply_distortion` ("Distortion"),
`audio_apply_click_remover` ("Automatic Click Remover")

**Transitions (10):** `transition_add_cross_dissolve`
("AE.ADBE Cross Dissolve New"), `transition_add_dip_to_black`
("AE.ADBE Dip To Black"), `transition_add_dip_to_white`
("AE.ADBE Dip To White"), `transition_add_morph_cut` ("AE.ADBE MorphCut"),
`transition_add_film_dissolve` ("ADBE Film Dissolve"),
`transition_add_additive_dissolve` ("ADBE Additive Dissolve"),
`transition_add_iris_round` ("ADBE Iris Round"), `transition_add_wipe`
("ADBE Wipe"), `transition_add_push` ("ADBE Push"), `transition_add_slide`
("ADBE Slide")

---

**Category tool-count total: 20+17+11+33+8+19+14+14+19+12+5+9+12+10+7+12+41 = 263**,
plus the ~12 workflow tools in §2 (incl. the newly-added `shape_*` gap
tools and chroma-key/PIP workflows) → **~275 tools at v1 target — honest
breakdown by verification tag, updated 2026-07-10 with real live-probe
results from a running Premiere Pro 2026 instance. IMPORTANT: this is still
a specification — 0 of these 275 exist as working code today; see the
status note above §1.** This clears both named competitors previously
ahead of us on raw count (269, 278) without padding — every one of the 41
new tools targets a specific effect/transition the live probe actually
found present, not a guess.

| Tag | Count (approx.) | Meaning |
|---|---|---|
| ✅ live-verified | ~6 | The tool's actual return data came back from a real call against a running Premiere Pro 2026 instance — includes real *write* actions now: creating a sequence, inserting a MOGRT, not just enumeration |
| *(type-verified)* | ~171 | Maps to a method read in the official type declarations; not yet runtime-exercised |
| ⚠ verified-composed | ~4 | Confirmed primitives, composed via `executeTransaction`; runtime behavior pending further live testing |
| 🔧 generic-mechanism | ~62 | Real factory API exists; the live probe confirmed the factory itself works (105 video filters, 54 audio filters, 100+ transitions really enumerated) and, for most tools in this tier, the exact target name is directly confirmed present (e.g. Lumetri = `AE.ADBE Lumetri`, the 41 dedicated shortcuts in §3.Q) — but *applying* that specific effect/transition has not itself been called yet. Includes the 3 `shape_*` tools: position/scale/rotation confirmed reachable via UXP, fill color expected to work via UXP's confirmed `Color` keyframe type but not yet tested against a real shape template |
| 🧩 ExtendScript bridge (all 7 now fully live-confirmed) | 7 | Not just theorized: a complete read→edit→write→re-read round-trip (font/size/style preserved) was demonstrated live for MOGRT text properties, on an After-Effects-authored template. **Critical caveat baked into every one of these 7 tools: only works on AE-authored MOGRTs — Adobe's own bundled non-`[AE]`-prefixed templates (e.g. `Basic Title.mogrt`) are confirmed broken for this and must not be used** — v1 needs its own bundled AE-authored template assets |
| ❔ unconfirmed / found-broken | ~25 | No matching method found, or found in the types but confirmed broken at runtime (`Transcript.querySupportedLanguages`, `Application.version`) — needs from-scratch implementation, further investigation, or is a real cut candidate for v1 |

Even the strict *live+type-verified* count clears the 150+ target on its
own — the core "edit quality" pillar (insert/overwrite/ripple/trim/
roll/slip/slide/keyframe/effects/transitions) is confirmed at the type
level, though **not yet live** (see the callout below — the probe's test
project had no active sequence, so this core is first in line for Phase 1
live testing, not already proven). The ❔ tier is concentrated in
creative/analysis breadth (Essential Sound presets, caption generation,
freeform titles, multicam, content-analysis), not core editing. **One
methodological result from the live probe matters beyond any single tool:
type declarations are not proof of runtime
behavior** — every category, including ones currently marked type-verified,
should get a live smoke-test pass in Phase 1, not just the categories
flagged ❔/🔧 here. Do not market any tool as a shipped capability before it
has been runtime-exercised at least once.

## 4. MCP resources (not tools — see design principle §1.6)

- `premiere://project/current` — active project structure (bins, items)
- `premiere://sequence/active` — active sequence's tracks, clips, duration
- `premiere://sequence/active/markers` — marker list for the active sequence
- `premiere://playhead` — current playhead position
- `premiere://connection/status` — bridge/plugin connection health
