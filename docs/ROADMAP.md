# Repo Audit & Roadmap

Last updated: **2026-09-04**.

[PLAN.md](./PLAN.md) records why the architecture looks the way it does;
[FEATURES.md](./FEATURES.md) records what is verified to work. **This file is
the current audit of the repo and the prioritized list of what to build next.**

---

## 1. Where the project stands

**Shape.** npm workspaces monorepo, TypeScript throughout, **18,738 lines** of
first-party source across 61 files (excluding `dist/` and `node_modules/`;
counted 2026-09-04).

| Area | Lines | Notes |
|---|---|---|
| `server/src/` — MCP server, 23 tool modules | 13,113 | Biggest: `agent/ops.ts` 2,237 · `textEngine.ts` 1,557 · `tools/workflow.ts` 1,133 · `tools/title.ts` 899 · `tools/analyze.ts` 771 |
| `plugin/src/` — UXP panel, 17 handlers | 5,292 | Biggest: `handlers/clip.js` 621 · `handlers/title.js` 492 · `handlers/debug.js` 465 |
| `bridge/src/` — WS relay `:8265` | 231 | Thin router, correlation-id based |
| `shared/src/` — protocol | 102 | |
| `legacy-bridge/` — optional CEP text bridge | — | Editable MOGRT text only |
| `scripts/` | 40+ `.mjs`/`.ps1` | Ad-hoc probes, smoke runs, and the two CI checks |
| `docs/` | ~2,500 lines | AGENT, AGENT_USAGE, ARCHITECTURE, FEATURES, PLAN, PROMPTS, ROADMAP, TEXT_SYSTEM |

**Releases.** v1.0.0 → v1.0.2 (2026-07-10/11), then v1.1.0 (2026-09-04). MIT.

### 1.1 What is genuinely strong — do not regress these

- **Atomic multi-step edits.** Every composed edit runs inside
  `Project.executeTransaction()` within `Project.lockedAccess()`
  (`runTransaction()` in `plugin/src/ppro.js`). FEATURES.md calls this the part
  that has held up best under real testing: a composed edit commits as one unit
  or not at all.
- **Real trims.** roll / slip / slide / split / ripple delete composed from
  confirmed UXP primitives, not metadata shuffling.
- **Agent-first orchestration.** `edit_bootstrap` → `edit_auto` / playbooks →
  `edit_verify`, with structured `recovery`, `stopOnError: false` continuation,
  and separate documented tracks for weak and strong models.
- **Operational safety.** Rate limiting (`RATE_LIMITED`, ~220 ms floor — the
  guard that stops tool spam from crashing Premiere) and file-based checkpoints
  under `~/.ppmcp/`, because Premiere's undo stack is unreliable for agents.
- **Text engine.** 1,557 lines with a real design system (anchors, plates,
  fades) and a UXP → hybrid → CEP → PNG fallback chain.
- **Honest documentation.** README's "what's actually tested" section and
  FEATURES.md's verification tiers, including two written-down corrections
  where static analysis turned out wrong (`clip_insert`, `clip_append`).
- **Seven translated READMEs** (en/tr/es/de/fr/ja/zh-CN).

### 1.2 Open gaps and technical debt

| # | Finding | Evidence |
|---|---|---|
| A | **One-click install is not delivered.** No `.ccx` packaging, no UPIA invocation, no `.mcpb`. The install checklist still tells the user to install the UXP Developer Tool and hand-load `plugin/manifest.json`. | `grep -rn "UPIA\|UnifiedPluginInstaller\|\.ccx\|mcpb" installer/ scripts/` → 0 hits; the surviving mentions are all `docs/` prose |
| B | ~~All 277 schemas exposed unconditionally~~ | **Fixed in 1.1.0** — `PPMCP_PROFILE` + `tool_search`/`tool_schema`/`tool_invoke` |
| C | ~~No CI~~ | **Fixed in 1.1.0** — `.github/workflows/ci.yml` builds, typechecks and runs two catalog checks on Windows + Linux, Node 20 + 22 |
| D | **Verification results are prose, not data.** FEATURES.md's tiers live only in Markdown, so nothing can gate a release on them and they drift. `scripts/check-catalog.mjs` covers structure; it does not know which tools have a live pass. | `docs/FEATURES.md` banner |
| E | ~~Stale status banners~~ | **Fixed in 1.1.0** — PLAN.md and FEATURES.md now say what actually shipped |
| F | **Windows-only.** PowerShell installer, `capture-program-monitor.ps1`, PowerShell probe scripts. macOS is the majority editorial platform. | `installer/*.ps1`, `server/scripts/*.ps1` |
| G | **No export progress streaming.** `Constants.EncoderEvent` (`RENDER_PROGRESS` / `RENDER_COMPLETE` / `RENDER_ERROR`) was identified in PLAN.md §3 as available and is still unused; exports are fire-and-poll. | `server/src/tools/exportTools.ts` |
| H | **Retry loops are the latency model.** `clip_insert` / `clip_append` try ~10 variants, `marker_add` ~15, before succeeding. It works, but nothing records *which* variant won, so the catalog never converges on the correct call. | README: "this retry loop is also part of why individual calls can feel slow" |
| I | **`marker_add` path is unknown.** The native marker path and the `virtualMarkers.js` fallback return the same success shape, so we cannot tell which ran. | `plugin/src/handlers/virtualMarkers.js` |
| J | **Workspace links break silently.** A tree without `node_modules/@ppmcp/*` symlinks fails `npm run build` with `Cannot find module '@ppmcp/shared'` — hit during this audit. `npm ci` restores it. | Now caught by CI |

### 1.3 Hard Adobe limits — keep these off the roadmap

- **Adding tracks after sequence creation is impossible.** Re-verified
  2026-09-04 against Adobe's `ppro_reference`: `Sequence` exposes
  `getVideoTrack` / `getAudioTrack` / `getCaptionTrack` and the matching
  `*Count` getters, and **no** `addTrack` / `createAddTrackAction` /
  `addVideoTrack` / `addAudioTrack`. Inserting at a higher track index fails
  with `[INTERNAL_ERROR] BE: An invalid track index was passed to the
  sequence`. Track count is fixed at `sequence_create`.
- **MOGRT text via pure UXP.** `ComponentParam.createKeyframe("string")`
  throws `Illegal Parameter type` and `getStartValue()` returns `null` for the
  Text master property — hence the CEP text bridge and the PNG fallback. Do not
  re-litigate without a fresh live probe.
- **Caption tracks look read-only** (checked 2026-09-04): `CaptionTrack` exposes
  `getTrackItems`, `getIndex`, `getMediaType`, `isMuted`, and only
  `createSetNameAction()` / `setMute()` as mutators. No documented way to create
  a caption track or insert caption items.
- **No Essential Sound ducking effect exists** among the 54 enumerated audio
  filters; auto-ducking stays a from-scratch implementation.

---

## 2. Roadmap

Ordering rule: anything that changes whether a new user can install and run
this at all outranks any new capability. Net-new tools must unlock a workflow
that is currently impossible — not raise the count.

### Done in 1.1.0

- **Tool-surface profiles.** `PPMCP_PROFILE=core|standard|full`, default
  `standard`. Registers ~109 instead of 277, so a session no longer pays
  thousands of tokens for schemas it will never call.
- **Meta-tools.** `tool_search` → `tool_schema` → `tool_invoke` keep the whole
  catalog one call away. Nothing became unreachable.
- **CI.** Build + typecheck + `scripts/check-profiles.mjs` +
  `scripts/check-catalog.mjs` on Windows and Linux, Node 20 and 22 — every
  check that is meaningful without a live Premiere.
- **Connection docs rewritten.** Verified per-client configs for Claude
  Desktop, Claude Code, Cursor, VS Code (the `servers` + `"type": "stdio"`
  variant), Windsurf, plus a generic stdio recipe, a no-client test command,
  and a troubleshooting table — in all seven READMEs.

### P0 — next

**P0-1 · Real one-click install (`.ccx` + UPIA).**
Package `plugin/` as a `.ccx` and have `installer/install.ps1` shell out to
`UnifiedPluginInstallerAgent.exe /install`, with a guided double-click `.ccx`
fallback when Creative Cloud Desktop / UPIA is absent. Removes the UXP
Developer Tool step entirely. Closes gap **A** — the single biggest thing
standing between a non-developer and a working install.

> **Verify first (half a day, gates the estimate):** Adobe's install docs
> confirm sideloading a non-Marketplace `.ccx` works — the user gets "an
> additional warning dialog since the plugin doesn't come from the Creative
> Cloud Marketplace" — but say **nothing** about whether UPIA accepts an
> unsigned, self-packaged `.ccx`. Test that and check UPIA's exit codes before
> committing to the full task; if it refuses, this grows a signing story and
> the estimate changes materially.

**P0-2 · `.mcpb` bundle for Claude Desktop.**
One-click install for the MCP half, added to `npm run release:win` output.
Pairs with P0-1 to make the whole install terminal-free.

**P0-3 · Machine-readable verification manifest.**
Make `scripts/smoke-all-tools.mjs` emit `verification.json`
(`{tool, tier, lastVerified, premiereVersion, via, error}`) and **generate**
FEATURES.md's status tables from it. Wire the same file to the profile lists so
"live-verified" and "registered by default" cannot drift apart. Closes gaps
**D** and **H** — and fixes the systemic problem this repo has already been
burned by twice.

### P1 — reach and depth

**P1-1 · macOS support.** A shell equivalent of `install.ps1` (UPIA's macOS
`--install`), and a cross-platform replacement for the PowerShell frame-capture
path in `captureFrame.ts`. Closes gap **F**; largest single increase in
addressable users.

**P1-2 · `script_execute` escape hatch.** An opt-in, permission-flagged tool
that runs model-authored JS against the `premierepro` UXP module inside the
plugin — off unless `PPMCP_ALLOW_SCRIPT=1`, size-capped, logged, and
checkpoint-prompted. Covers everything the catalog does not, and is the fastest
way to probe new Adobe APIs (it would have answered the caption-track question
in minutes).
**Safety caveat that must ship with it:** arbitrary JS runs inside a single
tool call, so it bypasses the rate limiter's per-tool accounting — the ~220 ms
floor exists precisely because flooding Premiere crashes it. Either enforce a
call-count/duration budget inside the plugin's script sandbox, or document
loudly that this is the one tool that can take the host down.

**P1-3 · Export progress streaming.** Wire `Constants.EncoderEvent` through the
relay to MCP progress notifications so `export_sequence` reports percent instead
of the model polling. Closes gap **G**.

**P1-4 · Transaction-level undo.** `edit_undo_last` — one `executeTransaction`
step back, sitting between "no undo" and the heavyweight file checkpoint. Cheap,
and directly serves agent self-correction.

**P1-5 · Caption tracks — feasibility spike only, not a build commitment.**
See §1.3: no write path is documented. Time-box a live probe (can an imported
`.srt` project item reach a caption track by any route?) and only then decide.
If it is read-only, record that in FEATURES.md and keep the current text/PNG
path. Getters are weak evidence in this API — `track_add` looked plausible until
the reference showed nothing, and `Transcript.querySupportedLanguages()` was
type-declared but threw at runtime.

**P1-6 · Distribution (PLAN.md §6, never executed).** Submit to the public MCP
server lists, and record a 60-second demo GIF. No engineering required.

### P2 — what a local, scriptable server can do that an in-app assistant cannot

**P2-1 · Saved, replayable edit recipes.** Serialize an `edit_run` plan to
`.ppmcp-recipe.json` and add `recipe_save` / `recipe_run` /
`recipe_run_batch(folder)`. One recipe, fifty projects, identical result, no
model in the loop on replay. This is the clearest step from "impressive demo" to
"production tool."

**P2-2 · Headless mode.** A CLI entry (`ppmcp run recipe.json`) that drives the
relay without an MCP client, so overnight and CI-driven batches are possible.

**P2-3 · Edit diff & delivery report.** Extend `analyze_compare_sequences` into
a real diff (clips added/removed/trimmed, grade deltas, audio level changes) and
render an HTML delivery report. Auditability is a professional-post concern.

**P2-4 · Close the vision QA loop.** `sequence_qa_loop` and
`sequence_screenshot` exist but the loop is not autonomous: screenshot → model
critique → targeted fix → re-screenshot, bounded by an iteration count. Turns
"we have screenshots" into "it checks its own work."

**P2-5 · Cross-app relay (After Effects first).** The relay protocol is
app-agnostic, and AE already runs the MOGRT authoring in
`spike/ae-template-builder/build-templates.jsx`. One agent plan spanning
Premiere + AE.

**P2-6 · Optional remote transport.** HTTP/SSE with bearer/OAuth for
studio setups. Lowest priority — it conflicts with the local-first,
loopback-only security posture and must stay opt-in.

### Explicitly not doing

- **`track_add` in any form.** Absent from the Adobe UXP API, re-verified
  2026-09-04. Keep the feature-detecting handler and the clear error message.
- **Growing the tool count for its own sake.** Profiles and `script_execute`
  make the number irrelevant; a tool earns its place by unlocking a workflow.
- **Reviving a general CEP/ExtendScript editing path.** The narrow text bridge
  stays; nothing else.
