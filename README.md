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
