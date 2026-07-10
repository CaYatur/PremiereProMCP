# Premiere Pro MCP (PPMCP)

**Controla Adobe Premiere Pro desde Claude, Cursor o cualquier cliente [MCP](https://modelcontextprotocol.io).**

**Developer:** [CaYaDev](https://cayadev.com)

Main language: **[English README](./README.md)**

---

# Install (start here)

**Full guide:** **[INSTALL.md](./INSTALL.md)**

## Recommended: Setup ZIP from Releases

1. Open **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)**.  
2. Download **`PPMCP-Setup-x.x.x.zip`**, extract it.  
3. Double-click **`Setup.bat`** (PowerShell wizard).  
4. Choose install folder, version options, optional **CEP Text Bridge**.  
5. After install, open the guides with **full paths on your PC**:
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

The ZIP includes portable **Node.js** (no separate Node install).

You must install free **Adobe UXP Developer Tool** once (to load the Premiere panel):

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Search: **Adobe UXP Developer Tool download**

## Developers: from GitHub repo

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install && npm run build && npm run dev:bridge
```

Details: **[INSTALL.md](./INSTALL.md)** · English README for full features.
