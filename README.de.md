# Premiere Pro MCP (PPMCP)

**Steuern Sie Adobe Premiere Pro uber Claude, Cursor oder jeden [MCP](https://modelcontextprotocol.io)-Client.**

**Developer:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **Installation:** Offnen Sie **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**, laden Sie `PPMCP-Setup-x.x.x.zip` herunter, entpacken Sie es, und doppelklicken Sie auf **`Setup.bat`**. Diese eine Datei fuhrt die komplette Installation aus.

Hauptsprache: **[English README](./README.md)**

---

# Installation (hier starten)

**Vollstandige Anleitung:** **[INSTALL.md](./INSTALL.md)**

## Empfohlen: Setup-ZIP von Releases

1. **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)** offnen.  
2. **`PPMCP-Setup-x.x.x.zip`** herunterladen, entpacken.  
3. **`Setup.bat`** doppelklicken (PowerShell-Assistent).  
4. Installationsordner, Version, optionales **CEP Text Bridge**.  
5. Danach Guides mit **vollen Pfaden auf diesem PC**:
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

ZIP enthalt portable **Node.js**.

Einmalig noetig: kostenloses **Adobe UXP Developer Tool** (Premiere-Panel laden):

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Suche: **Adobe UXP Developer Tool download**

## Entwickler: aus dem Repo

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install && npm run build && npm run dev:bridge
```

Details: **[INSTALL.md](./INSTALL.md)** · Features im English README.
