# Premiere Pro MCP (PPMCP)

**Control Adobe Premiere Pro from Claude, Cursor, or any [MCP](https://modelcontextprotocol.io)-compatible AI client — real timeline editing, not just project metadata.**

**Developer:** [CaYaDev](https://cayadev.com) · [cayadev.com](https://cayadev.com)

> [!IMPORTANT]
> **To install:** go to **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**, download `PPMCP-Setup-x.x.x.zip`, extract it, then double-click **`Setup.bat`**. That single file runs the whole installer.

| Language | File |
|----------|------|
| **English** | [README.md](./README.md) (this file) |
| Turkish | [README.tr.md](./README.tr.md) |
| Spanish | [README.es.md](./README.es.md) |
| German | [README.de.md](./README.de.md) |
| French | [README.fr.md](./README.fr.md) |
| Japanese | [README.ja.md](./README.ja.md) |
| Chinese (Simplified) | [README.zh-CN.md](./README.zh-CN.md) |

---

# Install (start here)

**Full step-by-step guide:** **[INSTALL.md](./INSTALL.md)**  
(paths, UXP Developer Tool download, Claude / Claude Code / Cursor, Premiere panel)

## Everyone (recommended): Setup ZIP from Releases

1. Open **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)**.  
2. Download **`PPMCP-Setup-x.x.x.zip`**.  
3. Extract the folder → double-click **`Setup.bat`**.  
4. The wizard shows **install folder**, **version**, and optional **CEP Text Bridge**.  
5. **If PPMCP is already installed**, Setup offers:
   - **Update / reinstall** to this version  
   - **Uninstall completely**  
6. When finished, open the personalized guide (real full paths on your PC):
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

Setup is **pure PowerShell** (built into Windows) — no third-party installer, commercial-safe.  
The ZIP bundles **portable Node.js** — you do **not** need to install Node yourself.

You **do** need Adobe **UXP Developer Tool** once (free) to load the Premiere panel:

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Search: **Adobe UXP Developer Tool download**

### Maintainers: build the ZIP

```bash
npm run release:win
```

Needs only Node.js + npm. Output: `dist-release/PPMCP-Setup-*.zip`

## Developers: install from this repo

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install
npm run build
npm run dev:bridge
```

Or (Node already installed): `installer\Setup.bat` or `installer\install.bat`  

Load `plugin/manifest.json` in UXP Developer Tool. Point MCP at `server/dist/index.js`.  
Details: **[INSTALL.md](./INSTALL.md)**.

---

## Connect your MCP client

PPMCP is a **local stdio MCP server** — a Node process on your own PC that your AI client talks to directly. It is **not** a hosted "remote MCP connector", so the *"Add custom connector" → Remote MCP server URL* flow you may see in Claude's Connectors settings does not apply here. Point your client at a local command instead.

After running Setup, your exact ready-to-paste paths are already generated in `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` and `mcp-config-snippet.json`. General form:

**Claude Desktop** — Setup writes this into `claude_desktop_config.json` for you automatically. To do it by hand, merge this into the `"mcpServers"` object:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\You\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\You\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code** (CLI):

```bash
claude mcp add premiere-pro -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server (a *local command*, not a URL):
- Command: the Node path above
- Args: the server path above

Building from source instead of the Setup ZIP? Use `node` on your PATH and `server/dist/index.js` from the repo.

---

## What is this?

PPMCP is a **Model Context Protocol** server that connects an AI agent to a **live Adobe Premiere Pro** session. The model can:

- Create sequences and assemble media  
- Cut, overwrite, and trim clips  
- Place titles, shapes, and motion graphics  
- Mix audio (SFX, music beds) with safe gain defaults  
- Grade, transitions, quality pass, export, screenshots  

**UXP-first** core editing. **Optional CEP** bridge only for editable MOGRT titles (PNG titles work without it).

```
MCP Client (Claude / Cursor / ...)
    <-> stdio
MCP Server (Node)
    <-> WebSocket :8265
Bridge / Relay
    <->
UXP Plugin (inside Premiere Pro)
```

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Windows** | Primary tested platform |
| **Adobe Premiere Pro** | UXP-capable (e.g. 25 / 26+) |
| **UXP Developer Tool** | Required to load the panel ([download](https://developer.adobe.com/premiere-pro/uxp/)) |
| **MCP client** | Claude Desktop, Cursor, Claude Code, etc. |
| **Node.js 18+** | Only if you install from source (EXE includes portable Node) |

Optional: **ffmpeg / ffprobe** for media analysis scripts.

---

## After install (quick checklist)

1. Bridge running (Desktop **PPMCP Bridge** if needed)  
2. UXP Developer Tool → Add Plugin → `...\plugin\manifest.json` → Load  
3. Premiere panel shows **Active** (footer: CaYaDev · cayadev.com)  
4. MCP client uses paths from `%APPDATA%\PPMCP\mcp-config-snippet.json`  
5. Call **`edit_bootstrap`**

Agent workflow: [docs/AGENT_USAGE.md](./docs/AGENT_USAGE.md) · [skill/SKILL.md](./skill/SKILL.md)

---

# Features

### Timeline and media

- Import media, create sequences, set active sequence by **exact name**  
- Place clips with overwrite; trim in/out  
- Markers; sequence screenshots for visual QA  

### Text and graphics

- **`text_write`** (PNG always; editable MOGRT with optional CEP)  
- Shapes, colors, Motion keyframes (scale / position / rotation / opacity)  

### Audio

- SFX and music beds; dB API (0 dB = unity)  
- Scoped gain (does not mass-overwrite the user’s mix)  

### Color, polish, export

- **`quality_pass`** (batched for large timelines), transitions, export  

### Safety

| Feature | Why |
|---------|-----|
| Rate limits | Protects Premiere from tool spam (`RATE_LIMITED`) |
| Checkpoints | Snapshot / restore project before risky edits |
| Playbooks / `edit_run` | Multi-step edits without thrash |
| Agent docs | Shared rules for different AI models |

### Example use cases

Rough cuts · cinematic SFX · music-rhythm cuts · ad-style motion cards · QA before export  

---

## Tool status: what's actually tested

**~225 MCP tools** across 17 categories (project, sequence, track, clip, transitions, effects, color/Lumetri, audio, text/titles/shapes, markers/metadata, multicam, proxy/media, export, analysis, batch, selection/system, plus ~15 high-level workflow tools). Most of that surface maps to a real, documented method in Adobe's own `@adobe/premierepro` UXP API and is expected to work, but hasn't all been individually exercised against a live Premiere session yet — see [docs/FEATURES.md](./docs/FEATURES.md) for the full tool-by-tool verification tier (type-verified / live-verified / verified-composed / known-broken).

**What holds up well under real, end-to-end testing** (a real ~48s multi-track sequence built from scratch, video + 4 audio tracks, transitions, gain, keyframed fades, markers, title, screenshot, save): sequence/project creation, `clip_overwrite`, trim, roll/slip/slide, split, ripple delete, shape add + position + fill color, `text_write`'s PNG fallback path, listing effects/transitions, gain/dB control, and project save/screenshot. Multi-step edits (roll/slip/slide and composite workflow tools) are committed through Premiere's `Project.executeTransaction()` — several primitive actions run as one atomic unit, so a failure partway through doesn't leave the timeline half-edited. That transaction design has been the most reliable part of the whole plugin.

**`clip_insert` and `marker_add` are more reliable than earlier testing suggested.** Both now retry ~10-15 internal variants (different track-index/limit-shift/marker-type combinations) inside the plugin before giving up — in the latest real session, `clip_insert` succeeded on every one of ~19 video/audio clips (via one of those retry variants), and `marker_add` added 7 markers with no reported error. This retry loop is also part of why individual calls can feel slow. We don't yet know for certain whether that marker_add run went through the native path or the virtual-marker fallback (both return the same success message) — treat `marker_add` as "probably fine, unconfirmed which path," not "known broken."

**Fixed since that session (pending a live re-test, not yet re-confirmed):**

| Tool | What was wrong | What changed |
|------|-----------------|--------------|
| `clip_append` | Failed consistently (`"Script action failed to execute"`) — it used a single fixed attempt instead of the retry logic `clip_insert` already had | Now shares `clip_insert`'s ~10-variant retry (item cast/raw × limit-shift/audio-index combos) via one helper, so anything that made `clip_insert` succeed should make `clip_append` succeed too |
| `sequence_set_in_out` | `"sequence.setInPoint is not a function"` — no fallback existed | Now also tries the `SequenceEditor` Action-factory pattern (`createSetInPointAction`/`createSetOutPointAction`) every other mutation in this codebase uses, feature-detected so it's a no-op if that method doesn't exist either |
| `media_get_info` / `media_analyze_file_info` | Never returned duration, resolution, or frame rate | Now opportunistically probes a few extra fields (`getDuration`, `getFrameSize`, `width`/`height`, `getFrameRate`), feature-detected — returns them if this Premiere build happens to expose any, `undefined` otherwise (no worse than before) |

**Still broken, no fix found yet:**

| Tool | Issue | Use instead |
|------|-------|--------------|
| `track_add_video` / `track_add_audio` | Fails on this Premiere build (`"No UXP method to add audio track"`) — you're stuck with the track count the sequence preset started with | Plan track count upfront via `sequence_create`/a preset with enough tracks; can't add more later |

**Lower-confidence claims (from earlier static code analysis, not re-verified in this session):** `text_set_content` (editing existing MOGRT text) and `shape_set_size` (exact pixel sizing) were previously found broken via code-level probes — see [docs/FEATURES.md](./docs/FEATURES.md) for the detail — but given `clip_insert` turned out to be more fixed than that same style of analysis suggested, treat these as "worth re-checking live," not gospel.

**Also found and fixed: a fade/keyframe ordering footgun, not a bug.** `workflow_audio_fade`/`workflow_fade_clip` calculate fade keyframes from the clip's *current* start/end at the moment you call them — correct in isolation, but if you trim the clip's length *after* adding fades, the old fade-out keyframe can end up past the new out-point and silently stop applying (fade-in still works, fade-out doesn't). Both tools' descriptions now explicitly warn the model to trim to final length first.

This section gets updated as real Premiere sessions surface more ground truth — static code analysis alone has already been wrong once here (`clip_insert`).

---

## Architecture

| Path | Role |
|------|------|
| `server/` | MCP tools, rate limit, checkpoints |
| `bridge/` | WebSocket relay (`:8265`) |
| `plugin/` | UXP panel in Premiere |
| `installer/` | Windows PowerShell Setup (Setup.bat) + release packager |
| `docs/` | Architecture & agent usage |
| `skill/` | Compact AI skill |

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/FEATURES.md](./docs/FEATURES.md).

---

## Rate limits (summary)

- Soft gap between plugin calls ~100 ms  
- Min gap between MCP tools ~220 ms  
- High per-minute caps; too fast → `RATE_LIMITED`  

---

## Development

```bash
npm install
npm run build
npm run dev:bridge
npm run release:win    # build Setup ZIP (PowerShell wizard + portable Node)
```

---

## License

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)

Not affiliated with Adobe. Keep project backups / checkpoints.
