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

PPMCP ist ein **lokaler stdio-MCP-Server** — ein Node-Prozess auf deinem eigenen PC, den dein KI-Client startet und uber stdin/stdout anspricht. Es gibt keine URL und keinen Port einzutragen.

> [!WARNING]
> Claudes Dialog **Settings → Connectors → Add custom connector** verlangt eine *Remote MCP server URL*. Der ist fur gehostete Server und funktioniert mit PPMCP **nicht**. Nutze die lokale Konfigurationsdatei des Clients (oder `claude mcp add`).

Jeder Client braucht dieselben zwei Werte; Setup hat sie mit deinen echten Pfaden bereits nach `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` und `mcp-config-snippet.json` geschrieben:

| Value | Default |
|-------|---------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **Escaping:** in einer `.json` muss jeder Backslash **doppelt** stehen (`C:\\Users\\You\\...`), auf der Kommandozeile nicht. Das ist der haufigste Verbindungsfehler.

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` — in das vorhandene `"mcpServers"`-Objekt einfugen, dann die App **komplett beenden und neu starten** (Fenster schliessen genugt nicht).

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

**Claude Code** (CLI) — `--scope user` macht ihn in allen Projekten verfugbar; prufen mit `claude mcp list`.

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — `%USERPROFILE%\.cursor\mcp.json` (global) oder `.cursor\mcp.json` (nur dieses Projekt) — gleiches JSON wie Claude Desktop.

**VS Code / GitHub Copilot** — `.vscode/mcp.json` — der einzige Client mit anderer Form: der Schlussel heisst `servers`, nicht `mcpServers`, und braucht `"type": "stdio"`. Auch uber den Befehl **MCP: Open User Configuration**.

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

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (oder Cascade-Panel → MCP-Symbol → Configure) — gleiche `mcpServers`-Form; danach Windsurf neu laden.

**Jeder andere MCP-Client** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI… gib ihm Transport **`stdio`** (teils "local", "command" oder "process" genannt), den Node-Pfad als Befehl und den Server-Pfad als einziges Argument. Fast alle nutzen die `mcpServers`-Form oben. Ein Client, der nur ein Remote-URL-Feld anbietet, kann PPMCP nicht starten.

**`PPMCP_PROFILE`** — `core` (19) · `standard` (109, Standard) · `full` (277). Das legt nur fest, womit die Sitzung *startet*: das Modell kann die Auswahl selbst erweitern — `tool_profile({ profile: "full" })` oder `{ category: "color" }` — und `tool_invoke` fuhrt jedes Tool aus, registriert oder nicht.

```json
"env": { "PPMCP_PROFILE": "standard" }
```

→ **[INSTALL.md](./INSTALL.md)** · **[English README](./README.md#connect-your-mcp-client)**

---

## Tool-Status

277 MCP-Tools in ~20 Kategorien. `clip_append` ist jetzt bestatigt funktionsfahig und `sequence_set_in_out` funktioniert jetzt (live bestatigt; ruft `sequence.createSetInPointAction` auf, Premiere 25.6+). Bestatigte Adobe-Plattformgrenze: die UXP-API hat keine Methode, um leere Spuren hinzuzufugen (`track_add`) — plane die Spuranzahl beim Erstellen der Sequenz. Aktuelle detaillierte Tabelle im **[English README](./README.md#tool-status-whats-actually-tested)** oder in [docs/FEATURES.md](./docs/FEATURES.md).

Details: **[INSTALL.md](./INSTALL.md)** · Features im English README.
