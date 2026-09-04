# Installation Guide — Premiere Pro MCP (PPMCP)

**Developer:** [CaYaDev](https://cayadev.com) · https://cayadev.com  

> [!IMPORTANT]
> **To install:** go to **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**, download `PPMCP-Setup-x.x.x.zip`, extract it, then double-click **`Setup.bat`**. That single file runs the whole installer.

---

# For everyone (recommended): Download the Setup ZIP

1. Open **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**.  
2. Download **`PPMCP-Setup-x.x.x.zip`**.  
3. Extract the **whole folder** (keep `Setup.bat` next to the `payload` folder).  
4. Double-click **`Setup.bat`**.

Setup is a **built-in Windows PowerShell wizard** — no extra installer license required.

### What you will see in the wizard

| Step | What it shows / asks |
|------|----------------------|
| Header | Product name, **this Setup version**, CaYaDev |
| **If already installed** | Detects old install → shows version + folder |
| Action | **Install / Update**, or **Uninstall completely** |
| Install folder | Default `%LOCALAPPDATA%\PPMCP` (Browse…) |
| Options | Optional **CEP Text Bridge**, **Start with Windows** |
| Finish | Opens **usage guide with YOUR full paths** |

### Update to a new version

1. Download the **newer** `PPMCP-Setup-*.zip` from Releases.  
2. Extract → run **Setup.bat**.  
3. Choose **Update / reinstall**.  
4. Same install folder is reused; files are replaced; paths/guides are refreshed.

### Uninstall

1. Run **Setup.bat** again → choose **Uninstall completely**, or  
2. Run **`Uninstall.bat`** inside the install folder, or  
3. Windows **Settings → Apps → Premiere Pro MCP** (if registered).  
4. Remove the `premiere-pro` MCP entry from Claude/Cursor config if you added one.

**Default install path:**  
`%LOCALAPPDATA%\PPMCP`  
(example: `C:\Users\You\AppData\Local\PPMCP`)

**Optional component:**  
*CEP Text Bridge* — only if you want **editable** MOGRT titles. PNG titles work without it.

---

## After install (do this once)

The installer **detects paths on your PC** and writes them into:

| File | Content |
|------|---------|
| `%APPDATA%\PPMCP\HOW-TO-USE.txt` | Full guide with **absolute paths** + UXP Developer Tool download links |
| `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` | Short list: Node, server, plugin manifest, Claude config path |
| `%APPDATA%\PPMCP\mcp-config-snippet.json` | Ready JSON for MCP clients (real paths) |

Open those files (setup opens them automatically). **Copy paths from there** — do not invent them.

### 0. Adobe UXP Developer Tool (required)

If you do not have it, you **must install** Adobe’s free tool before loading the panel:

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Or search: **Adobe UXP Developer Tool download**

Without this app, a beginner cannot load the PPMCP panel into Premiere.

### 1. Bridge
- Desktop shortcut: **PPMCP Bridge** (also Startup if you kept that option).  
- If the panel is red: run that shortcut.

### 2. Premiere Pro panel
1. Open **Premiere Pro**.  
2. Open **UXP Developer Tool**.  
3. **Add Plugin** → select the **Plugin manifest** path shown in `HOW-TO-CONNECT.txt`.  
4. **Load** → open **PPMCP** panel → **Active**.  
5. Footer: **CaYaDev · cayadev.com**

### 3–5. Connect an MCP client

#### The two facts that decide every client's config

1. **PPMCP is a local stdio server.** Your AI client *launches* it as a child
   process and talks over stdin/stdout. There is no URL, no port to enter, and
   no account to log into.
   > Claude's **Settings → Connectors → Add custom connector** asks for a
   > *Remote MCP server URL*. That dialog is for hosted servers and **will not
   > work** for PPMCP. Use the client's local config file (or `claude mcp add`).
2. **Every client needs the same two values** — and Setup already wrote both,
   with your real paths, into `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` and
   `mcp-config-snippet.json`. Copy them from there; do not retype them.

| Value | Default location |
|-------|------------------|
| `command` — the Node executable | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` — the MCP server entry | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

Expanded, for a user named `You`:
`C:\Users\You\AppData\Local\PPMCP\node\node.exe` and
`C:\Users\You\AppData\Local\PPMCP\server\dist\index.js`.

> **JSON path escaping:** inside a `.json` file every backslash must be doubled
> (`C:\\Users\\You\\...`). On a command line it must **not** be. Getting this
> wrong is the single most common connection failure.
>
> Installed from a git clone instead of the Setup ZIP? Use `node` (your system
> Node 18+) as the `command` and the absolute path to `server/dist/index.js` in
> your clone as the argument — after running `npm run build`.

---

#### Claude Desktop

Setup writes this for you. To do it by hand, edit
`%APPDATA%\Claude\claude_desktop_config.json` (create it if missing) and merge
into the existing `"mcpServers"` object — do not replace the whole file:

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

Then **fully quit and reopen Claude Desktop** (closing the window is not
enough — quit it from the tray/menu bar).

#### Claude Code (CLI)

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

`--scope user` makes it available in every project. Drop it (or use
`--scope project`) to scope it to the current repo. Verify with
`claude mcp list`, and remove with `claude mcp remove premiere-pro`.

#### Cursor

Cursor reads `mcp.json`, same shape as Claude Desktop:

- **Global (all projects):** `%USERPROFILE%\.cursor\mcp.json`
- **This project only:** `.cursor\mcp.json` in the project root

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

Then Settings → MCP and confirm `premiere-pro` shows its tools.

#### VS Code (GitHub Copilot agent mode)

**VS Code is the exception** — its key is `servers`, not `mcpServers`, and it
wants an explicit `"type": "stdio"`:

- **This workspace:** `.vscode/mcp.json`
- **All workspaces:** run the command **MCP: Open User Configuration**

```json
{
  "servers": {
    "premiere-pro": {
      "type": "stdio",
      "command": "C:\\Users\\You\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\You\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

Then open Chat → **Agent** mode → the tools picker to enable it.

#### Windsurf (Cascade)

Edit `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (or Cascade panel →
MCP icon → **Configure**). Same `mcpServers` shape as Claude Desktop. Reload
Windsurf afterwards.

#### Any other MCP client

Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex
CLI, your own MCP host — the recipe is always the same. Find where the client
stores MCP servers, then give it:

| Field | Value |
|-------|-------|
| Transport / type | `stdio` (also called "local", "command", or "process") |
| Command | `C:\Users\You\AppData\Local\PPMCP\node\node.exe` |
| Arguments | `C:\Users\You\AppData\Local\PPMCP\server\dist\index.js` |
| Working directory | not required |
| Environment | optional — see `PPMCP_PROFILE` below |

Almost every client uses the `mcpServers` JSON shape shown above; VS Code's
`servers` + `"type": "stdio"` is the only common variant. If a client offers
only a *remote URL* field, it cannot run PPMCP — that field is for hosted
servers.

**Quick test without any client.** This should print a startup line to stderr
and then wait (Ctrl+C to stop). If it does, the server itself is fine and the
problem is in your client's config:

```bash
"C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

#### Optional: choose how many tools the model sees

PPMCP ships 277 tools. Registering all of them costs thousands of tokens per
session and makes tool selection worse, so the server registers a **profile**
by default and keeps the rest reachable through `tool_search` → `tool_schema`
→ `tool_invoke`.

| `PPMCP_PROFILE` | Registered | Use when |
|-----------------|-----------|----------|
| `core` | ~19 | Small/cheap models. `edit_bootstrap` → `edit_auto` → `edit_verify` only. |
| `standard` *(default)* | ~109 | Everything with a recorded live pass, plus the atomics a real cut uses. |
| `full` | 277 | You want the entire catalog resident, as in 1.0.x. |

Set it like any other MCP env var:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\You\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\You\\AppData\\Local\\PPMCP\\server\\dist\\index.js"],
      "env": { "PPMCP_PROFILE": "standard" }
    }
  }
}
```

#### If it doesn't connect

| Symptom | Cause | Fix |
|---------|-------|-----|
| Client shows no `premiere-pro` server | Config not loaded | Fully quit and reopen the client (not just the window) |
| Server fails to start | Wrong path, or single backslashes in JSON | Double every backslash in `.json`; run the quick test above |
| Tools appear, but every call returns `PLUGIN_NOT_CONNECTED` | Premiere panel not loaded, or bridge down | Start the **PPMCP Bridge** shortcut, then load the panel in UXP Developer Tool until it shows **Active** |
| Calls return `RATE_LIMITED` | Tools fired too fast | Wait `retryAfterMs`; prefer `edit_run` batches. This guard exists because flooding Premiere crashes it |
| A tool you expected is missing | You are on a profile | `tool_search("...")` to find it, or set `PPMCP_PROFILE=full` |

### 6. Optional CEP (if checked in the wizard)
Restart Premiere → **Window → PPMCP Text Bridge**.

---

# For developers: GitHub repo (manual)

If you prefer cloning the source:

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install
npm run build
npm run dev:bridge
```

Load `plugin/manifest.json` in UXP Developer Tool.  
Point MCP at `server/dist/index.js` with system Node.

Or run the wizard / script installer from the clone:

```text
installer\Setup.bat
```

(Without a `payload` folder this is **dev mode**: uses the repo + system Node.js.)

Lighter non-GUI script:

```text
installer\install.bat
```

---

# Building the release ZIP (maintainers)

On a Windows machine with **Node.js + npm** only (no third-party installer):

```powershell
cd PremiereProMCP
npm run release:win
```

or:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-release.ps1
```

Output:

```text
dist-release\PPMCP-Setup-x.x.x.zip
dist-release\PPMCP-Setup-x.x.x\   (extracted layout for testing)
```

Upload the **ZIP** to **GitHub → Releases**.

`build-release.ps1` will:
1. Build the monorepo  
2. Stage app + **portable Node** into `installer/payload`  
3. Pack **Setup.bat**, **Setup.ps1**, and payload into the release ZIP  

Users extract the ZIP and double-click **Setup.bat**.

---

## Uninstall

- Run **Setup.bat** → Uninstall, or  
- Install folder **`Uninstall.bat`**, or  
- Windows **Settings → Apps** → Premiere Pro MCP  
- Optional cleanup from a repo clone: `installer\uninstall.ps1`

---

## Support

- **Website:** https://cayadev.com  
- **Developer:** CaYaDev  
- **Source:** https://github.com/CaYatur/PremiereProMCP  
