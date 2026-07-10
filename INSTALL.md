# Installation Guide — Premiere Pro MCP (PPMCP)

**Developer:** [CaYaDev](https://cayadev.com) · https://cayadev.com  

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

### 3–5. Claude Desktop / Claude Code / Cursor
Follow the exact commands and paths in `HOW-TO-USE.txt` / `mcp-config-snippet.json` on your machine (they are already filled in).

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
dist-release\PPMCP-Setup-0.2.0.zip
dist-release\PPMCP-Setup-0.2.0\   (extracted layout for testing)
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
