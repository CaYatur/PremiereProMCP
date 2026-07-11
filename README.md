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

**What holds up well under real testing:** the core edit path (`clip_overwrite`, trim, roll/slip/slide, split, ripple delete), sequence/track management, shape add + position + fill color, `text_write`'s PNG fallback path, listing effects/transitions/markers, and media import. Multi-step edits (roll/slip/slide and composite workflow tools) are committed through Premiere's `Project.executeTransaction()` — several primitive actions run as one atomic unit, so a failure partway through doesn't leave the timeline half-edited. That transaction design has been the most reliable part of the whole plugin.

**Known issues right now, with a real workaround for each** (all four are specific gaps in this Premiere build's scripting API, not vague "might not work"):

| Tool | Issue | Use instead |
|------|-------|--------------|
| `clip_insert` | Fails on this Premiere build (`SequenceEditor` insert action rejected); falls back to creating a *new* sequence from the media rather than inserting into yours | `clip_overwrite` on an existing sequence |
| `marker_add` | Native marker creation fails; falls back to a "virtual marker" stored in Sequence Properties — readable by `marker_list`/`marker_go_to`, but does **not** show up in Premiere's own marker track | Known limitation for now — track marker intent yourself if you need a visible Premiere marker |
| `text_set_content` (edit *existing* text) | Only reliable with the optional CEP Text Bridge connected, on an After-Effects-authored MOGRT. Without CEP, the pure-UXP path is rejected by Premiere (`Illegal Parameter type` on the MOGRT `Text` property) | `text_write` / `text_add` for placing new text — it always succeeds via a guaranteed PNG fallback, even without CEP |
| `shape_set_size` | The bundled shape template never exposed a real pixel-size property; always approximates size via a single uniform Motion Scale %, not independent width/height | Fine for "bigger/smaller"; don't rely on it for exact pixel dimensions |

We'd rather list four honest gaps than quietly ship them as working. This table gets updated as the underlying Premiere/UXP API changes.

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
