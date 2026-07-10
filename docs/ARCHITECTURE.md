# Architecture

Status: **Phase 1 implemented AND live-tested across two rounds against a real Premiere Pro 2026.2.2 session, including real imported footage (docs/FEATURES.md's status banner has the full pass/fail breakdown: 14/18 probed operations pass). The end-to-end chain — MCP client → server → relay → UXP plugin → real Premiere edits — genuinely works: sequence creation, track listing, shape insert/position/fill-color, marker listing, media import, and effect/transition enumeration all confirmed live. Four specific gaps remain (MOGRT text write, shape Size, clip_insert, marker_add) — each root-caused to a real, documented cause, not "untested." clip_insert and marker_add share the same underlying finding: CompoundAction#addAction() throws synchronously for actions sourced from a collection-level factory (SequenceEditor, Markers), despite its type declaration promising a boolean return — every TrackItem/ComponentParam-sourced action works fine. Tools outside the live-tested set (media-dependent effect/color/audio operations, and every category not yet implemented — see FEATURES.md) still carry the original "should work per type declarations, not yet proven" caveat.**
Last updated: 2026-07-10 (second live smoke-test round, with real media)

## 1. Why a three-component architecture

Premiere Pro is a GUI app, not something an external process can drive
directly. Its extension surface (UXP) can only act as a **WebSocket client**
— a UXP plugin cannot open a listening socket. Separately, Claude/MCP
clients launch the MCP server **per session over stdio**, so the MCP server
process itself is not a good place to host a long-lived socket that the
Premiere plugin depends on: if the relay lived inside the MCP server
process, every session start/stop would drop the plugin's connection, and
concurrent Claude sessions would fight over the port. (This is the same
reason `mikechambers/adb-mcp` — the closest existing precedent for a
multi-app Adobe UXP MCP bridge — runs its Command Proxy Server as its own
persistent process rather than embedding it in the MCP server.)

So: **three components**, two of them long-lived, one of them per-session.

```
┌────────────────────┐        stdio        ┌──────────────────────┐
│  MCP Client         │ ◄─────────────────► │  MCP Server           │
│  (Claude Desktop/    │   (per session,     │  (Node/TS, launched    │
│   Code, Cursor, …)   │    launched by       │   by the client)       │
└────────────────────┘    the client)        └───────────┬──────────┘
                                                            │ WS client
                                                            ▼
                                              ┌──────────────────────┐
                                              │  Bridge/Relay Service  │
                                              │  (persistent local     │
                                              │   background process,  │
                                              │   installed by setup)  │
                                              │  hosts ws://127.0.0.1: │
                                              │  <port>                │
                                              └───────────┬──────────┘
                                                            │ WS client
                                                            ▼
                                              ┌──────────────────────┐
                                              │  UXP Plugin             │
                                              │  (runs inside Premiere  │
                                              │   Pro, auto-loads on    │
                                              │   app start, connects   │
                                              │   out to the relay)     │
                                              │  → @adobe/premierepro   │
                                              │    API calls into the   │
                                              │    running app          │
                                              └──────────────────────┘
```

Both the MCP server and the UXP plugin connect **out** to the relay as
clients; the relay is the only thing that listens. The relay is the one
piece that must survive across Claude sessions and across Premiere
restarts, so it runs as an independent background process managed by the
installer (Windows: a background/tray process or scheduled task started at
login; not embedded in either the plugin or the MCP server).

## 2. Component responsibilities

### 2.1 Bridge/Relay Service
- Persistent local process, started independently of both Claude and
  Premiere (e.g. at user login, or lazily started by the installer's setup
  step and kept alive).
- Hosts a WebSocket server on a fixed local port (loopback only —
  `127.0.0.1`, never exposed on a network interface).
- Tracks connection state: is a Premiere plugin currently attached? Is an
  MCP server currently attached? Supports multiple MCP server connections
  attaching/detaching without dropping the plugin connection.
- Pure message router + correlation-id tracker; no editing logic lives
  here.
- Exposes a simple health/status surface the MCP server can query
  synchronously (backs the `app_get_connection_status` tool from
  FEATURES.md).

### 2.2 UXP Plugin (inside Premiere Pro)
- Standard UXP plugin, installed into wherever Premiere scans for UXP
  plugins on startup, installed via UPIA (see PLAN.md §3, Gate 2 —
  confirmed: `.ccx` package, silent CLI install, no dev mode).
- Auto-loads when Premiere Pro starts (this is what satisfies "install
  once, then it just works when they open Premiere").
- On load, connects to the relay as a WS client and identifies itself;
  reconnects with backoff if the relay isn't up yet or drops.
- Executes incoming commands via the official `@adobe/premierepro` UXP API
  (`app`, `Project`, `Sequence`, `Track`, `TrackItem`, `constants`, etc.).
  All calls are async/promise-based — never block Premiere's UI thread.
  Multi-step edits (roll/slip/slide) are composed from several primitive
  `Action`s and committed atomically via `Project.executeTransaction()`
  (see §2.4 and PLAN.md §3, Gate 1).
- Streams results (including errors, with enough detail for the model to
  self-correct — e.g. "no active sequence", "clip not found at that time")
  back through the relay, tagged with the originating request's correlation
  id.

### 2.3 MCP Server
- Node.js/TypeScript, implements the MCP protocol (stdio transport) —
  what Claude Desktop/Code/etc. actually launches per session.
- On startup, connects to the relay as a WS client (does not host anything
  itself). If the relay isn't running, either auto-starts it (spawn, if the
  install laid down the relay as a standalone launchable process) or
  surfaces a clear "bridge not running" state rather than failing silently.
- Owns all MCP-facing concerns: tool schema definitions, MCP resources
  (read-only contextual state — see FEATURES.md §1.3), request validation,
  and translating a tool call into a relay message / translating the relay
  response back into an MCP tool result.
- No editing logic here either — it's a thin, well-typed translation layer.
  Keeping business logic out of both the MCP server and the relay (and
  entirely in the plugin, next to the actual `@adobe/premierepro` calls)
  means the tool behavior only has one place to change.

### 2.4 MOGRT text — live-tested finding: UXP can locate but not yet set/read the Text master property (2026-07-10)

**Status update, Phase 1, live-tested 2026-07-10:** the ExtendScript-bridge
plan below was written after testing Adobe's *bundled* `Basic Title.mogrt`,
whose text lives in an `AE.ADBE Text` component invisible to UXP's
`getComponentChain()`. Our *own* `Basic Text.mogrt`
(`spike/ae-template-builder/build-templates.jsx`) is different: its `"Text"`
master property **is found** via `getComponentChain()` (component
`"Graphic Parameters"`, confirmed live via `plugin/src/handlers/debug.js`'s
`debug.introspectParam` probe) — so the original "invisible to UXP" finding
does not apply to it, and `/legacy-bridge` stays removed from the workspace.

**But locating the param is not the same as controlling it, and here the
news is mixed, live-confirmed with an isolated probe (not a guess):**
- `textParam.createKeyframe("a real string")` throws `"Illegal Parameter
  type"` — even though `string` is one of the five types
  `@adobe/premierepro`'s own type declarations document as valid
  (`number | string | boolean | PointF | Color`). This is Adobe's runtime
  diverging from its own published types, not a bug in our call.
- `textParam.getStartValue()` returns `null` (contrast:
  the sibling `"Position"` master property on the same clip returns a real
  keyframe whose `.value.value` is `[0.5, 0.5]`).
- `textParam.getKeyframePtr(time)` also returns `null` for every time
  tried; `isTimeVarying()` is `false`; `getKeyframeListAsTickTimes()` is
  empty.
- Every other read/write accessor `ComponentParam` exposes
  (`findNearestKeyframe`, `createAddKeyframeAction`,
  `createSetTimeVaryingAction`, etc.) is keyframe-time-based and therefore
  gated behind the same `getKeyframePtr`/`getStartValue` dead end.

**Conclusion: for now, `text_set_content`/`text_get_content` are a
documented v1 gap, not a solved feature** — `title.setText`/`title.getText`
exist in `plugin/src/handlers/title.js` and fail loudly with a specific
error rather than silently. Position and Color on the *same* "Graphic
Parameters" component work fine via the identical
`createKeyframe`/`createSetValueAction` mechanism (using real `PointF`/
`Color` instances, not plain objects — see §2.4's routing rule below), so
this is narrowly a Text-value-type problem, not evidence the master-
property mechanism itself is broken.

**Do not revive the ExtendScript-bridge plan over this.** It was evaluated
and parked for good reasons independent of this specific gap: no one-click
bootstrap exists for triggering ExtendScript inside Premiere without a
developer's VS Code attached, and it sits on the same CEP/ExtendScript
deprecation runway this project is positioned against. An
`ExtendScript Socket.listen()` server is also a dead end regardless —
ExtendScript runs on Premiere's main thread with no async event loop, so a
listen/poll loop would freeze the host UI. If Text needs solving later,
that requires fresh investigation (e.g. whether a *different* MOGRT
authoring choice produces a differently-typed master property, or whether
Adobe's runtime accepts some other value shape not yet tried), not a return
to the plan below.

**Live-confirmed value-type rule for `ComponentParam.createKeyframe()`
(2026-07-10):** it wants a real instance of the matching class, not a
structurally-similar plain object — `new ppro.PointF(x, y)` and
`new ppro.Color(r, g, b, a)` both work (confirmed via `shape_set_position`/
`shape_set_fill_color` actually moving/recoloring a shape live); a plain
`{x, y}` object throws the same `"Illegal Parameter type"` error Text hits.
`ppro.Point` does **not** exist as an export — the type declarations name
it `PointF`.

<details>
<summary>Original plan (kept for history, not current)</summary>

Desk research against Adobe's official `@adobe/premierepro` v26.3.0 type
declarations (PLAN.md §3, Gate 1) confirms the primitives needed for
ripple delete, trim, move, keyframing, effect add/remove, nesting, and
MOGRT insert all exist in the official UXP API, plus
`Project.executeTransaction()` for bundling multiple actions atomically —
which is how roll/slip/slide compose from primitives without a dedicated
convenience method. **No general CEP/legacy-editing-panel fallback is
planned** — that decision stands.

**One narrow exception, fully live-confirmed 2026-07-10 (not just
theorized — five test rounds, `spike/extendscript-test/test.jsx`):** a
MOGRT's own internal properties (text content) do not appear in
`getComponentChain()` at all via UXP — only the generic Opacity/Motion/
Vector-Motion transform wrapper does. Corroborated by an independent Adobe
developer-forum report of the identical limitation (PLAN.md §3). A classic
ExtendScript path — `clip.components[i]`, matching on `matchName`, then
JSON-parse/edit/write the text property's `getValue()`/`setValue()` — was
demonstrated end-to-end: read the existing JSON, change only
`textEditValue` + `fontTextRunLength`, write it back, re-read to confirm
an exact match with font/size/style preserved, save the project. **Load
-bearing caveat found during testing:** this only works against
**After-Effects-authored** MOGRTs (`AE.ADBE Capsule`-style components).
Adobe's own bundled Premiere-native templates (`AE.ADBE Text` component,
e.g. `Basic Title.mogrt`) reproducibly return a broken, non-JSON value and
must not be used. **Action item:** author our own minimal AE-made MOGRT
template(s) and bundle them as plugin assets (PLAN.md §4, Phase 3
prerequisite) — do not rely on Adobe's default library for any `title_*`
tool.

Since titles/lower-thirds/on-screen text are a core, user-requested
capability (not a nice-to-have), plan for a **small, purpose-built
ExtendScript helper script** reachable from the relay exactly like the UXP
plugin (same message protocol, §3 below) — scoped *only* to reading/
writing MOGRT/graphic-layer text properties. It is not a general editing
panel, does not duplicate any UXP-confirmed capability, and gets retired
the moment Adobe closes this specific UXP gap (tracked against the CEP
freeze's ~Sept 2026 runway — if Adobe hasn't closed it by then,
re-evaluate, since ExtendScript itself may stop working past that point
per PLAN.md §3's still-open question on what "end of support" precisely
means).

**Property-type routing rule, established by this testing (keep this
distinction when implementing):** simple typed properties — Position,
Scale, Rotation, and **Color** (`Color` is a first-class value type in
UXP's `ComponentParam.createKeyframe()`, confirmed in the official type
declarations) — route through the **UXP plugin** like any other effect
parameter. Only rich-text JSON-blob properties (MOGRT `Source Text`/
Capsule `Title`/`Subtitle`-style fields) need the ExtendScript bridge.
This means the planned `shape_*` tools (position/size/fill-color on a
future bundled shape template) are expected to need **UXP only, no
ExtendScript** — consistent with classic ExtendScript's `getValue()`
returning unusable opaque integers for `Color`-typed properties in this
same test round. Not yet literally tested against a real shape template
(none exists yet) — treat as a strong inference pending that test, not a
closed result.

</details>

## 3. Message protocol (relay ↔ plugin ↔ server)

Simple JSON messages over the relay's WebSocket, correlation-id based so
responses can arrive out of order / asynchronously:

```json
// MCP server -> relay -> plugin
{ "id": "uuid", "type": "call", "method": "sequence.create", "params": { "name": "My Sequence", "presetId": "..." } }

// plugin -> relay -> MCP server
{ "id": "uuid", "type": "result", "ok": true, "data": { "sequenceId": "..." } }
// or
{ "id": "uuid", "type": "result", "ok": false, "error": { "code": "NO_ACTIVE_SEQUENCE", "message": "..." } }
```

Error responses always include a stable machine-readable `code` plus a
human/model-readable `message` — this is what lets a model recover instead
of retrying blindly (directly serves the "models must use the tools well"
goal from PLAN.md).

## 4. Repo structure (current)

```
/docs               planning docs (this folder)
/server              MCP server (Node/TS) — tool definitions, MCP transport, relay client
/bridge              Bridge/Relay service (Node/TS) — standalone process
/plugin              UXP plugin (manifest.json, JS, uses @adobe/premierepro) — includes /plugin/templates (bundled copies of /templates)
/templates           Our own AE-authored MOGRT assets (basic text, basic shape) — see §2.4: Adobe's bundled templates don't work for scripted text editing, ours do
/installer           Packaging: Windows installer script, .ccx plugin package, .mcpb manifest, macOS packaging (later)
/skill               Shipped usage guide / MCP prompt resources teaching tool-chaining workflows
README.md
```

Likely a single-repo (monorepo) layout rather than splitting server/plugin
across repos — keeps versioning and the installer build simple, matches
what most comparable projects do.

## 5. Packaging & installer (detail in PLAN.md Phase 5)

- MCP-server half: package as an **`.mcpb`** (MCP Bundle, the open spec at
  `github.com/modelcontextprotocol/mcpb`) for one-click install into Claude
  Desktop. Note its real limitation: `.mcpb` only knows how to launch a
  single stdio process — it has no concept of the bridge/plugin half, so it
  covers roughly a third of the install story.
- Bridge + plugin half: a native installer (Windows: Inno Setup or NSIS)
  that (a) installs the bridge service and registers it to start
  automatically, (b) packages the UXP plugin as a **`.ccx`** and silently
  installs it via **UPIA** (`UnifiedPluginInstallerAgent.exe /install
  plugin.ccx`, confirmed available via Creative Cloud Desktop 5.7+ — see
  PLAN.md §3, Gate 2 — no dev mode, no Exchange review needed), with a
  guided double-click `.ccx` fallback if UPIA isn't found, and (c) where
  possible, also drives Claude Desktop/Code config registration so the
  `.mcpb` step isn't even manually required.
- Ship the MCP server as a **compiled/bundled artifact** (not requiring the
  end user to have Node.js installed) if at all practical — this alone
  beats every competitor's `npm install -g` / `uv run` requirement.
- Single GitHub Release per version, multiple platform-specific assets.

## 6. Tech stack (working assumption, confirm in Phase 0)

- **Language:** TypeScript throughout (server, bridge, plugin) — matches
  UXP's JS runtime and Adobe's official `@adobe/premierepro` TypeScript
  declarations; avoids a second language boundary.
- **MCP SDK:** official TypeScript MCP SDK.
- **Transport (client-facing):** stdio (standard for locally-launched MCP
  servers).
- **Transport (internal, relay):** plain WebSocket, JSON messages,
  loopback-only.
- **UXP API:** `@adobe/premierepro` (official).
