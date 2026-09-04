# Premiere Pro MCP Server — Project Plan

Status: **Shipped and in maintenance.** Phases 0–6 are complete: 277 MCP
tools across ~20 categories, a UXP plugin, the bridge/relay, and a PowerShell
Setup with bundled portable Node are all released (v1.0.0 → v1.1.0). The
planning content below is kept because §3's gate research and live-probe
findings are still the authoritative record of *why* the architecture looks
the way it does — but it is history, not a to-do list.

**For what to build next, see [ROADMAP.md](./ROADMAP.md)** (repo audit and
prioritized work). For what is verified to work today, see
[FEATURES.md](./FEATURES.md).
Last updated: 2026-09-04 (originally drafted 2026-07-10)

## 1. Goal

Build the most capable, most reliable, and easiest-to-install MCP (Model Context
Protocol) server for Adobe Premiere Pro, so that any MCP client (Claude Desktop,
Claude Code, Cursor, Windsurf, etc.) can drive real, frame-accurate editing —
not just metadata/marker toys — with 150+ (target: ~275, FEATURES.md)
well-designed tools that both weak and strong models can use correctly.
Ship it on GitHub with source + signed Releases and a true one-click
install experience.

## 2. Design principles

These are the commitments the whole project is measured against. They are
listed in priority order — when two of them conflict, the higher one wins.

1. **UXP-native, not a CEP hack.** Adobe froze ExtendScript/CEP development in
   favour of UXP, and Premiere Pro 2026 ships UXP as a standard release. Every
   core editing capability goes through the official `@adobe/premierepro` UXP
   API. The one deliberate exception is a narrow CEP bridge for editable MOGRT
   text, which exists only because UXP cannot write that property (§3, and
   ARCHITECTURE.md §2.4) and is retired the moment it can.
2. **Install without a terminal.** A single Setup that lays down the bridge,
   registers the Premiere plugin, and writes the MCP client config. Bundled
   portable Node so the user never installs a toolchain. Anything that makes a
   non-developer open a shell is a bug in the installer, not a documentation
   problem.
3. **Edit quality, not metadata theater.** Prioritize the tools that do real
   timeline work — ripple/roll/slip/slide trims, speed ramping, Lumetri,
   Essential Graphics, keyframing — over tools that only read or write
   metadata. Multi-step edits commit atomically through
   `Project.executeTransaction()` so a failure halfway never leaves a
   half-edited timeline.
4. **Model-usable by design.** Consistent naming, a tiered surface (outcome
   tools and playbooks first, atomic precision tools behind them), rich
   schemas, structured recovery hints instead of blind retries, and a shipped
   skill that teaches the chaining. A profile keeps the resident tool count
   small; `tool_search` → `tool_schema` → `tool_invoke` keeps the rest
   reachable. Both a small model and a frontier model have to be able to drive
   it correctly.
5. **Claims must be backed by a live session.** A tool is not "working"
   because its method exists in Adobe's type declarations — that has been wrong
   here more than once (§3's `Transcript.querySupportedLanguages()` threw at
   runtime despite being type-declared). FEATURES.md's verification tiers, and
   the checks in `scripts/`, exist to keep the documentation honest.
6. **Discoverable.** Keyword-accurate repo name, description and topics; a
   README that shows install and a real edit within the first screen;
   submission to the public MCP server lists.

## 3. Two gating unknowns — desk-research resolved 2026-07-10, runtime behavior still to verify

These were the two assumptions the whole plan leaned on. Both have now been
checked against **primary sources** (not blog posts) and both resolve
**favorably** — the UXP-native + one-click-install thesis holds. What
remains is runtime *behavior* verification (Phase 1 spike), not existence.

### Gate 1 — Can UXP actually do "real" editing? → **Yes, confirmed at the primitive level.**

Source: `npm pack @adobe/premierepro` (official Adobe package, v26.3.0,
`src/premierepro.d.ts`, 4,675 lines, published by `adobe/premierepro-types`
on GitHub). This is Adobe's own type declarations for the runtime module
UXP plugins load via `require('premierepro')` — not a third-party guess.

Confirmed present in the official API:
- **Insert / overwrite:** `SequenceEditor.createInsertProjectItemAction`,
  `createOverwriteItemAction`.
- **Ripple delete, explicitly:** `createRemoveItemsAction(trackItemSelection,
  ripple: boolean, mediaType, shiftOverLapping?)` — ripple is a first-class
  documented parameter, not a QE-DOM-only trick.
- **Trim primitives:** `createSetInPointAction`/`createSetOutPointAction`
  (source in/out) and `createSetStartAction`/`createSetEndAction` (timeline
  position/duration) on both `VideoClipTrackItem` and `AudioClipTrackItem`.
- **Move/clone:** `createMoveAction`, `createCloneTrackItemAction`.
- **Full keyframing:** `ComponentParam.createKeyframe`,
  `createAddKeyframeAction`, `createRemoveKeyframeAction`,
  `createRemoveKeyframeRangeAction`,
  `createSetInterpolationAtKeyframeAction` with a real
  `Constants.InterpolationMode` enum (`BEZIER`, `HOLD`, `LINEAR`, `TIME`,
  `TIME_TRANSITION_START/END`), plus `findNearest/Next/PreviousKeyframe`.
- **Effects:** `AudioComponentChain`/`VideoComponentChain` expose
  `createInsertComponentAction`, `createAppendComponentAction`,
  `createRemoveComponentAction`.
- **Nesting:** `Sequence.createSubsequence()`.
- **MOGRT insert:** `SequenceEditor.insertMogrtFromPath` /
  `insertMogrtFromLibrary`.
- **Export/render queue with real progress events:**
  `Constants.EncoderEvent` (`RENDER_PROGRESS`, `RENDER_COMPLETE`,
  `RENDER_ERROR`, `RENDER_CANCEL`, `RENDER_QUEUE`) — resolves the "render
  status polling is awkward" gap noted in the original research.
- **Atomic multi-step edits:** `Project.executeTransaction(callback:
  (compoundAction: CompoundAction) => void)` — multiple `Action`s can be
  bundled into one undoable compound transaction.

**What's genuinely absent as a named convenience method:** dedicated
`rollEdit` / `slip` / `slide` calls. But the primitives to compose them
exist and `executeTransaction` is precisely the mechanism to do it
atomically:
- **Slip** = `createSetInPointAction` + `createSetOutPointAction` on the
  same clip, same transaction (shift source in/out together, timeline
  position/duration unchanged).
- **Roll** = `createSetEndAction` on the left clip + `createSetStartAction`
  on the right clip, same transaction (shared edit point moves, durations
  either side of it change, neighbors' total span unchanged).
- **Slide** = `createSetStartAction`/`createSetEndAction` on the moved
  clip + corresponding adjustments on its neighbors, same transaction.

This downgrades Gate 1 from "existential risk — might not exist at all" to
"implementation detail — compose from confirmed primitives inside a
transaction." **Remaining open question for Phase 1 (not Phase 0):**
runtime behavior when composing — does Premiere correctly treat a
multi-action transaction as atomic with no 1-frame gaps or collisions
against un-modified neighbors, across linked audio/video, across the actual
installed Premiere Pro version. That needs a running Premiere Pro, hence
still a Phase 1 spike task — but it is now a **behavior** question, not an
**existence** question.

No time-boxed ExtendScript/QE-DOM fallback is planned as a result — the
official UXP surface appears sufficient. Revisit only if Phase 1 behavioral
testing finds a hard gap the primitives above can't cover.

**Scope correction (same desk-research pass, 2026-07-10):** the confirmed
strength above is specific to *core cut/trim editing*. The same read of the
type declarations found real, specific gaps in the creative/analysis
breadth: **no dedicated Lumetri/color API** (generic effect-component
mechanism only, untested), **no waveform/scope data readout**, **no
auto-transcription trigger** (only transcript JSON import/export), **no
freeform text/title creation** (MOGRT insert only, confirming the original
the original research's warning), **no Essential Sound preset methods**
(ducking/noise-reduction/dialogue-enhance), and **no multicam
sync/create/switch-angle methods** (only `isMulticamClip()`). These are
tracked tool-by-tool with verification tags in FEATURES.md §1 and §3 — do
not treat pillar #3 ("edit quality") as covering these until Phase 0/1
resolves them. The *cut-editing* core of pillar #3 is solid; the *creative
breadth* is not yet proven and is real engineering risk, not desk-research
risk (several — content analysis, Essential Sound ducking — would need
from-scratch algorithms, not thin API wrappers).

**Live runtime probe (2026-07-10, real Premiere Pro 2026 session):** a
minimal, read-only diagnostic UXP plugin (`spike/diagnostic-plugin/`) was
built and loaded into a live Premiere Pro 2026 instance via UPIA/UXP
Developer Tool, with a real open project. Results converted several
desk-research unknowns into confirmed facts:

- **Lumetri Color's real matchname is `AE.ADBE Lumetri`** — confirmed to
  exist among 105 live-enumerated video filters (also confirming `Warp
  Stabilizer` and `Crop` are present). `VideoFilterFactory` is genuinely
  usable, not just type-declared.
- **54 real audio filters enumerated**, confirming `DeNoise`, `DeReverb`,
  `DeHummer`, `Adaptive Noise Reduction`, and `Vocal Enhancer` exist — noise
  reduction and dialogue-cleanup tools are real, not aspirational. **No
  ducking-specific effect exists** (only metering tools `Loudness Meter`/
  `Loudness Radar`) — auto-ducking and loudness normalization are confirmed
  to need from-scratch implementations, not Adobe built-ins.
- **100+ real video transitions enumerated** via `TransitionFactory`,
  including `AE.ADBE MorphCut` — the transition mechanism is fully live-
  confirmed.
- **Active project/sequence/root-item read access confirmed** against a
  real open project (`PremiereMCPTest.prproj`).
- **Important negative result:** `Transcript.querySupportedLanguages()` —
  present in the official type declarations — **threw `is not a function`
  at runtime.** This is direct proof that `@adobe/premierepro`'s type
  declarations can describe methods that are not actually implemented in a
  given Premiere Pro build. **Consequence for the whole plan:** no tool
  should be treated as confirmed-working from a type-declaration read
  alone — every category needs at least one live smoke-test in Phase 1,
  not only the categories already flagged 🔧/❔. FEATURES.md's verification
  legend was updated with a new ✅ (live-verified) tier to keep this
  distinction visible going forward.

Full updated tags are in FEATURES.md §1 and §3. Net effect: the plan does
not need to cut any category as a result of this probe — even
`audio_apply_auto_ducking`-style gaps become "build it ourselves" scope
items, not blockers — but it hardens the discipline around what counts as
"done" for any given tool.

**Third live probe (2026-07-10, write test — user-requested check on
"can it add shapes/text?"):** `project.createSequence()` and
`SequenceEditor.insertMogrtFromPath()` both **confirmed live** — a new
sequence and Adobe's own bundled `Basic Title.mogrt` were both created/
inserted successfully with no extra permissions (`sequence_create` and
`title_apply_mogrt` graduate to ✅). But the inserted MOGRT's own text
content (`matchName: "AE.ADBE Text"`) **does not appear in
`getComponentChain()` at all** — only the generic Opacity/Motion/Vector
Motion transform wrapper does. Independently corroborated by an Adobe
developer-forum thread reporting the identical UXP limitation. **This is a
real, confirmed platform gap, not a mistake in our test.**

**Resolution, not a dead end:** a community-documented ExtendScript
technique (find the `AE.ADBE Text` component, JSON-parse/edit
`textEditValue` + `fontTextRunLength`, write back) is proven to work for
exactly this. Titles/lower-thirds/on-screen text are core to what the user
asked this plan to guarantee ("objeler, efektler, kutular, yazılar ekleme")
— so this is now the **one deliberate, narrow exception** to "no
ExtendScript fallback": a small helper scoped *only* to MOGRT/graphic
-layer property read-write, detailed in ARCHITECTURE.md §2.4. It does not
reopen the door to a general legacy editing panel, and gets retired the
moment UXP closes this specific gap.

**Shapes (plain rectangles/ellipses, no text) remain a harder, two-part
gap**, distinct from text: (1) Adobe doesn't bundle a default blank-shape
MOGRT the way it bundles title/lower-third templates, so we'd need to
author and ship our own; (2) whether the same ExtendScript
matchName/JSON-edit technique that works for `AE.ADBE Text` also works for
a shape/vector-layer matchname is **untested** — don't assume it transfers
without checking. Tracked as ❔ in FEATURES.md, not 🧩, until tested — see
the update below, which narrows this further.

**Fourth and fifth live probes (2026-07-10, five rounds total,
`spike/extendscript-test/test.jsx`) — the MOGRT text question is now fully
closed, not just theorized:**

- **Root cause found for round 3's failure:** Adobe's own bundled,
  Premiere-native MOGRTs (`Basic Title.mogrt`, and by strong inference the
  rest of the non-`[AE]`-prefixed default library — Lower Thirds/, Titles/,
  Credits/, Captions and Subtitles/, Slates/, Social Media/) expose the old
  `AE.ADBE Text` component, whose `Source Text` `getValue()` reproducibly
  returns one opaque, non-JSON character — genuinely broken via classic
  ExtendScript, not a probe artifact (confirmed twice).
- **An After-Effects-authored MOGRT behaves completely differently.**
  Testing against the bundled `[AE] Sports Package/Sports Lower Third
  Center.mogrt` (the `[AE]` prefix literally signals AE-authored, and
  turned out to be the deciding factor) found an `AE.ADBE Capsule`
  component instead, with clean sub-properties (`Text`, `Title`,
  `Subtitle`, plus color/shield/alignment controls). Its `Title`/`Subtitle`
  properties returned real, well-formed JSON
  (`{"textEditValue":"COACH ADOBE","fontEditValue":["Bungee-Regular"],
  "fontSizeEditValue":[42],...}`). We edited `textEditValue` +
  `fontTextRunLength` while preserving every other field, wrote it back
  via `setValue(json, true)`, read it again, and confirmed an exact,
  clean round-trip — twice, on two different properties (Title and
  Subtitle), with the project saved afterward. **This is now a proven,
  reproducible technique, not a hypothesis.**
- **Direct implication for v1:** build/bundle our **own AE-authored MOGRT
  template(s)** (After Effects is already installed on this machine) for
  text tools — insert our template via UXP (✅) + edit its text via the
  ExtendScript bridge (🧩, now proven). Do not build text tools on top of
  Adobe's bundled Premiere-native templates; they don't work for this.
  This also means "no template picker for the model" is achievable exactly
  as the user asked — the template is an internal implementation detail,
  invisible to whoever calls `title_create_text(...)`.
- **Shapes, narrowed further:** the `AE.ADBE Capsule` component's
  Position/Scale/Rotation-style properties follow the same `AE.ADBE
  Motion` pattern already confirmed directly readable via UXP (no
  ExtendScript needed). Its **Color** properties (`Main Color`, `Secondary
  Color`, `Highlight Color`, etc.) came back from classic ExtendScript's
  `getValue()` as large opaque integers (e.g. `72337973781266176`) — not
  usable color data, almost certainly a native `Color` object ExtendScript
  doesn't serialize automatically. UXP, however, has `Color` as a
  first-class value type in `ComponentParam.createKeyframe()` (confirmed
  in the official type declarations) — so a shape's fill color should
  route through the **already-confirmed UXP path**, not the ExtendScript
  bridge. **This is a strong, evidence-based inference, not yet a literal
  test** — there's still no shape MOGRT to test it against. Author one
  (a plain rectangle/ellipse in After Effects with an exposed fill-color
  and size control, exported as `.mogrt`) as the concrete next validation
  step before calling shapes fully solved.

**Update 2026-07-10 (final round):** Both templates now exist as real
files, built via a fully-scripted After Effects `.jsx`
(`spike/ae-template-builder/build-templates.jsx`), no GUI needed:
`Basic Text.mogrt` (text + position exposed, exported OK) and
`Basic Shape.mogrt` (position + fill color exposed and confirmed via
`addToMotionGraphicsTemplateAs`, exported OK; only the rectangle's Size
property failed to expose — non-blocking, export succeeded regardless,
fixable later). **Color exposing to the Essential Graphics panel worked
without error at the AE-authoring stage** — the earlier concern was about
reading/writing color via classic ExtendScript's `getValue()` on an
*existing* Capsule component (still untested for our own shape), not
about whether AE can expose a color master property at all (it can).
Both `.mogrt` files are saved at `C:\Users\cagan\AppData\Roaming\Adobe\
Common\Motion Graphics Templates\`, ready to bundle. Stopping live probes
here (context budget) — reading back the exposed color's actual value via
Premiere is the one remaining unproven step, deferred to Phase 1/3.

### Gate 2 — Can the UXP plugin actually be one-click installed? → **Yes, confirmed via UPIA.**

Adobe ships the **UPIA (Unified Plugin Installer Agent)**, part of the
Creative Cloud Desktop app (CCD 5.7+), specifically for this:
command-line install of `.ccx` plugin packages, with **no developer mode
and no Adobe Exchange review required** for side-loaded distribution.

- Windows path: `C:\Program Files\Common Files\Adobe\Adobe Desktop
  Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\
  UnifiedPluginInstallerAgent.exe /install path\to\plugin.ccx`
- macOS equivalent documented (`UnifiedPluginInstallerAgent --install`).
- Requires CCD present — a safe assumption, since Premiere Pro itself is
  normally installed and licensed through Creative Cloud Desktop.
- Confirmed constraint: a UXP plugin **cannot** be sideloaded by copying
  files into a folder the way CEP allowed — it must go through double-click
  or UPIA so Adobe's plugin database stays consistent. UPIA is the
  scriptable path, so the Windows installer shells out to it as a silent
  post-install step.
- Sources: [Install a UXP plugin](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/),
  [Package a UXP plugin](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/),
  [Install plugins using UPIA tool](https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/install-plugins-using-upia-tool.html),
  [How to Install UXP Plugins Using Command Line Tools](https://blog.developer.adobe.com/en/publish/2022/03/how-to-install-uxp-plugins-using-command-line-tools).

This directly enables the priority the user set: a native installer (Inno
Setup/NSIS) that packages the plugin as `.ccx`, installs the bridge
service, and calls UPIA silently — a genuine zero-terminal, zero-dev-mode
install, which is exactly what lets us stay usable if/when CEP-based
CEP-based tooling breaks on future Premiere Pro updates.

**Partially live-confirmed 2026-07-10:** the diagnostic plugin (Gate 1
probe, above) was successfully packaged with a real `manifestVersion: 5`
manifest (`"app": "premierepro", "minVersion": "26.0.0"` — matching the
`@adobe/premierepro@26.3.0` package exactly) and loaded into a real running
Premiere Pro 2026 via UXP Developer Tool on this machine, then executed
successfully end-to-end (panel rendered, button worked, live API calls
returned real data). This confirms the plugin manifest/format/loading path
works. It does **not** yet confirm the specific silent-UPIA-CLI-from-an-
installer path (dev mode was used here, not the `.ccx`+UPIA route) — that
remains the Phase 1 task: verify UPIA's actual exit codes/error handling
end-to-end (e.g. CCD not installed, permission prompts) with a packaged
`.ccx`, not developer mode. Implementation detail, not a feasibility risk.

## 4. Phased roadmap

- **Phase 0 — Feasibility spike (existence resolved via desk research
  2026-07-10; behavior verification remains).** Stand up the smallest
  possible proof: a UXP plugin that connects to a local WebSocket relay,
  executes one read command (e.g. get project name) and one write command
  (e.g. add a marker), installed via UPIA with no dev mode. Then
  specifically test one composed transaction (e.g. a two-clip roll edit via
  `executeTransaction`) to validate Gate 1's remaining behavioral question.
  Output: a short findings doc confirming/adjusting `ARCHITECTURE.md` and
  marking any FEATURES.md tool that doesn't survive contact with a real
  Premiere Pro instance.
- **Phase 1 — Core skeleton.** Bridge/relay service, UXP plugin shell, MCP
  server shell, end-to-end plumbing for ~15-20 tools covering project,
  sequence, and basic clip operations. Get the full pipe working reliably
  (reconnect handling, error surfaces back to the model) before breadth.
- **Phase 2 — Core editing depth.** Full `clip_*`, `track_*`, `transition_*`
  tool categories — the "edit quality" core. This is the category that must
  not be shallow.
- **Phase 3 — Creative breadth.** Effects, color (Lumetri), audio, titles/
  captions/MOGRT, markers/metadata, multicam, proxy/media management.
  **Prerequisite, confirmed necessary 2026-07-10:** author our own minimal
  MOGRT template assets in After Effects (a "Basic Text" title/lower-third,
  a "Basic Shape" rectangle/ellipse with exposed fill color + size) and
  bundle them with the plugin — Adobe's own bundled Premiere-native
  templates are confirmed broken for the ExtendScript text-edit technique
  this phase depends on (PLAN.md §3). Do this before building `title_*`/
  `shape_*` tools, not after — it's the one manual/creative prerequisite
  task in an otherwise all-code roadmap.
- **Phase 4 — Intelligence layer.** `analyze_*` and composite `assembly_*`/
  workflow tools (rough cut assembly, silence/scene detection, timeline
  summarization for the model) — this is what makes the server feel
  "AI-native" rather than a 1:1 API wrapper, and it's what lets weak models
  succeed without chaining 10 atomic calls.
- **Phase 5 — Packaging & installer.** Signed Windows installer (bridge
  service + plugin registration + MCP client auto-config), `.mcpb` bundle
  for the Claude Desktop half, macOS installer as a fast-follow.
- **Phase 6 — Docs, SEO, launch.** English README optimized for discovery
  (see §6), demo video/GIF, submission to `awesome-mcp-servers` and
  `modelcontextprotocol/servers`, GitHub topics, first tagged Release.

Do not start Phase 2+ tool implementation before Phase 0 closes — it
determines which categories in FEATURES.md are real.

## 5. Key risks

| Risk | Mitigation |
|---|---|
| Composed transactions (roll/slip/slide) misbehave at runtime despite confirmed primitives (Gate 1 residual) | Phase 0/1 behavioral spike against a real Premiere Pro instance; fall back to a narrower op (e.g. non-rippling trim) for any specific case that fails, rather than reintroducing a CEP/QE-DOM dependency |
| UPIA unavailable or behaves unexpectedly on a given user's machine (Gate 2 residual) | Detect CCD/UPIA presence at install time; fall back to a guided double-click `.ccx` install (still no dev mode) if UPIA's silent path fails |
| 150+ tool schemas overwhelm small-model tool selection | Tiered design: small set of workflow-level tools as the default surface; atomic tools grouped/namespaced; consider category-based enablement if a client supports it (see FEATURES.md §1) |
| Adobe changes UXP API mid-development | Pin against a specific Premiere Pro version during Phase 0-3; track `AdobeDocs/uxp-premiere-pro-samples` for breaking changes |
| Relay process lifecycle vs. MCP stdio process lifecycle | Relay runs as its own persistent background process (not embedded in the per-session MCP server) — see ARCHITECTURE.md |
| Premiere not running / plugin not connected when a tool is called | Every tool call fails fast with a clear, model-readable error (not a hang); ship an explicit `app_get_connection_status` tool |
| macOS support adds installer complexity | Windows-first (matches dev environment); macOS installer in Phase 5 as fast-follow, not blocking v1 |

## 6. Distribution & SEO strategy (detail, executed in Phase 6)

- Repo name: keyword-rich and still available, front-loading "Premiere Pro"
  and "MCP".
- GitHub repo **description** field front-loads "Premiere Pro MCP Server" /
  "Adobe Premiere Pro MCP" — this is what search results surface.
- GitHub **topics**: `mcp`, `model-context-protocol`, `mcp-server`, `claude`,
  `claude-desktop`, `adobe`, `premiere-pro`, `video-editing`.
- README structure (English): badges (license, tool count, platform, MCP
  protocol version) → one-line install → "why this exists" → categorized
  tool table → quick start per client (Claude Desktop, Claude Code, Cursor,
  VS Code, Windsurf, and the generic stdio recipe) → architecture diagram →
  demo GIF.
- Submit to the public MCP server lists (`awesome-mcp-servers`, the official
  `modelcontextprotocol/servers` list, PulseMCP, LobeHub) — real distribution
  channels, not just README wording.
- Cross-post to relevant communities once stable (r/editors, r/premiere,
  relevant Discords) — not needed for v1 but noted for launch checklist.

## 7. Success metrics (v1)

- Phase 0 gates resolved with a written decision (not an assumption).
- 150+ shipped tools (target ~200-220 per FEATURES.md), each with a tested
  round-trip (tool call → real change visible in Premiere Pro).
- A user can go from "download installer" to "ask Claude to make an edit in
  Premiere" with zero terminal commands.
- Deep edit operations (ripple/roll trims, multicam, keyframing, Lumetri,
  captions) work reliably, not just marker/metadata tools.
- README ranks on page 1 for "premiere pro mcp server" within a few weeks of
  launch + list submissions (best-effort, not fully controllable).

## 8. Open decisions (revisit as needed, not blocking Phase 0)

- Final repo/product name.
- Node.js/TypeScript is the working assumption for the MCP server and
  bridge (matches UXP's JS runtime and the official `@adobe/premierepro`
  TypeScript types) — confirm no reason to reconsider during Phase 0.
- macOS support timing (fast-follow vs. day-one).
