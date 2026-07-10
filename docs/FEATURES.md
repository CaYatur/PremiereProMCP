# Feature / Tool List

> **⚠ IMPLEMENTATION STATUS (updated 2026-07-10, expansion pass + live smoke):
> ~199 MCP tools are registered in code (server `allTools`). The full chain
> MCP client → server → relay → UXP plugin → Premiere has been exercised
> live for the edit core, P/L/K/N/O categories, and effect-add (after fixing
> `VideoFilterFactory.createComponent` → `createAppendComponentAction`).
> Plugin must be **reloaded in UXP Developer Tool** after handler changes
> before new relay methods appear. Tools without a real UXP primitive
> (multicam create/sync, STT captions, silence/scene DSP, workspace APIs)
> remain intentionally unimplemented rather than faked.**
>
> **Confirmed working live:** plugin connect/reconnect, reading the active
> project and its sequences, creating a sequence, listing tracks, adding a
> shape graphic and setting its position and fill color (a real on-screen
> edit, round-tripped through `PointF`/`Color` class instances), listing
> markers, enumerating real available effects/transitions (`AE.ADBE
> Lumetri`, 100+ real transition matchNames), and **importing a real video
> file into the project** (`project_import_media`, confirmed after fixing a
> real bug — `ProjectItem`'s id is the `getId()` *method*, not a `.nodeId`
> property the type declarations never actually named that way).
>
> **Four specific, well-understood gaps, not vague uncertainty:**
> 1. `text_set_content` — Premiere's `createKeyframe()` rejects even a
>    valid string for the MOGRT `"Text"` master property with `"Illegal
>    Parameter type"`, contradicting its own published type declarations;
>    an isolated diagnostic probe (`plugin/src/handlers/debug.js`)
>    confirmed this isn't our bug — `getStartValue()`/`getKeyframePtr()`
>    both return `null` for this param, unlike the sibling `Position`
>    param on the same clip, which works fine.
> 2. `shape_set_size` — the AE-template-authoring step never successfully
>    exposed a `Size` master property (a known gap from Phase 0).
> 3. `clip_insert` and 4. `marker_add` — both fail with the identical
>    generic `"Script action failed to execute"`, thrown *synchronously by
>    `CompoundAction#addAction()` itself* (confirmed via added
>    instrumentation in `plugin/src/ppro.js#runTransaction` — its type
>    declaration claims it returns a boolean, but it throws instead here).
>    Both come from a "collection-level" factory
>    (`SequenceEditor.createInsertProjectItemAction` /
>    `Markers.createAddMarkerAction`) rather than a `TrackItem`/
>    `ComponentParam` directly — every action sourced the latter way
>    (trim/roll/slip/slide, shape position/color) works. **Ruled out across
>    a third round:** the action object itself is non-null (an explicit
>    guard confirmed this), and neither `limitShift` (tried both `true`/
>    `false`) nor the marker duration value (tried a small nonzero tick
>    count and `ppro.TickTime.TIME_ZERO`) changes the outcome — same
>    generic error every time. This is now a confirmed platform-level gap
>    in this specific mechanism for this Premiere build, not an unfound
>    parameter. Revisit if a future Premiere/`@adobe/premierepro` release
>    changes this, or if a different construction path for these two
>    actions surfaces.
>
> See `docs/ARCHITECTURE.md` §2.4 for the Text gap's full detail. The
> remaining categories below (multicam, proxy/media, analysis, batch, most
> of markers/metadata, the dedicated-shortcut catalog, and the 12
> high-level workflow tools) are still spec-only. No installer/packaging
> and no GitHub publish yet.

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

### B. Sequence Management — `sequence_*` (17)
The live probe result is inconclusive here, not confirming: `getActiveSequence()`
was called successfully (no error), but the returned object's downstream
reads (`getVideoTrackCount`, etc.) never populated — the test project most
likely had no sequence open/active at probe time, so the call path is
**untested**, not proven working *or* broken. **This — an actual open
sequence with clips on it — is the first thing Phase 1 must live-test; the
whole `clip_*`/`track_*`/`sequence_*` "edit quality" core was not exercised
by this probe.**
`sequence_create`, `sequence_create_from_preset`, `sequence_list`,
`sequence_get_active`, `sequence_set_active`, `sequence_duplicate`,
`sequence_delete`, `sequence_get_settings`, `sequence_set_settings`,
`sequence_nest`, `sequence_get_duration`, `sequence_get_tracks`,
`sequence_rename`, `sequence_close`, `sequence_zoom_to_fit`,
`sequence_get_render_bar_status`, `sequence_export_frame`

### C. Track Operations — `track_*` (11)
`track_add_video`, `track_add_audio`, `track_remove`, `track_rename`,
`track_set_enabled`, `track_set_locked`, `track_set_muted`,
`track_set_solo`, `track_set_height`, `track_set_target`,
`track_get_items`

### D. Clip / TrackItem Editing — `clip_*` (33) — the "edit quality" core
`clip_insert`, `clip_overwrite`, `clip_append`, `clip_ripple_delete`,
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

### I. Titles, Graphics & Captions — `title_*`, `caption_*`, `shape_*` (19)
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
`title_create_text` 🧩✅ (full read→edit→write→re-read round-trip live-confirmed, font/size/style preserved — requires our own bundled AE-authored template, not Adobe's), `title_edit_text` 🧩✅ (same technique, same confirmation), `title_set_style` 🧩✅ (font/size/bold/italic/allCaps fields confirmed present and preserved in the same JSON blob as text — same technique, same confirmation),
`title_apply_mogrt` ✅ (live-confirmed: both Adobe's bundled `Basic Title.mogrt` and an AE-authored MOGRT inserted successfully via UXP), `title_list_mogrt_library`,
`title_customize_mogrt_fields` 🧩✅ (confirmed working end-to-end, but only for AE-authored MOGRTs — Adobe's own bundled non-`[AE]`-prefixed templates are confirmed BROKEN for this, do not use them for text tools), `title_create_lower_third` 🧩✅ (directly demonstrated: the AE-authored "Sports Lower Third Center" MOGRT's Title+Subtitle were both successfully edited),
`shape_create_rectangle` 🔧 (needs one bundled template we'd author; position/scale/rotation confirmed reachable via the already-proven UXP Motion-component path; fill color should route through UXP's confirmed `Color` keyframe type, not ExtendScript — architecturally sound, not yet tested against a real shape template), `shape_create_ellipse` 🔧 (same), `shape_set_style` 🔧 (same, color path specifically untested),
`caption_generate_auto` ❔, `caption_import_srt` ❔ (downgraded from 🔧 — depends on the now-broken `Transcript` surface), `caption_export_srt` ❔ (same),
`caption_edit_segment_text` ❔, `caption_edit_segment_timing` ❔,
`caption_set_style` ❔, `caption_burn_in` ❔, `caption_list_tracks`,
`caption_create_track` ❔

### J. Markers & Metadata — `marker_*`, `metadata_*` (12)
`marker_add`, `marker_remove`, `marker_list`, `marker_set_color`,
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

### L. Proxy & Media Management — `proxy_*`, `media_*` (9)
`ClipProjectItem.canProxy()/getProxyPath()/hasProxy()/attachProxy()` are
confirmed. Proxy *creation* (transcoding new proxy media) is not a
`ProjectItem` method — it would route through `EncoderManager`, unconfirmed
without a deeper read of that section.
`proxy_create` ❔, `proxy_attach`, `proxy_toggle_playback_resolution`,
`media_go_offline`, `media_go_online`, `media_browser_search`,
`media_get_ingest_settings`, `media_set_ingest_settings`,
`media_analyze_file_info`

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
