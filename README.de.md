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

## MCP-Client verbinden

PPMCP ist ein **lokaler stdio-MCP-Server** — ein Node-Prozess auf Ihrem eigenen PC, mit dem Ihr KI-Client direkt spricht. Es ist **kein** gehosteter "Remote-MCP-Connector" — der Ablauf *"Add custom connector" → Remote MCP server URL* in Claudes Connectors-Einstellungen gilt hier nicht. Nach dem Setup stehen Ihre genauen Pfade bereits in `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json`.

**Claude Desktop** — Setup tragt dies automatisch in `claude_desktop_config.json` ein. Manuell: in das `"mcpServers"`-Objekt einfugen:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\Sie\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\Sie\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code** (CLI):

```bash
claude mcp add premiere-pro -- "C:\Users\Sie\AppData\Local\PPMCP\node\node.exe" "C:\Users\Sie\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server (ein *lokaler Befehl*, keine URL):
- Command: der Node-Pfad oben
- Args: der Server-Pfad oben

## Tool-Status

~225 MCP-Tools; die meisten sind type-verified (bilden eine echte Adobe-API-Methode ab, aber noch nicht alle live getestet). Aktuelle reale Tests haben bereits mehrere bestatigte Probleme (mit Workaround) gefunden und eine fruhere Annahme korrigiert — die aktuelle, detaillierte Tabelle steht im **[English README](./README.md#tool-status-whats-actually-tested)** oder in [docs/FEATURES.md](./docs/FEATURES.md).

Details: **[INSTALL.md](./INSTALL.md)** · Features im English README.
