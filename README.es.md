# Premiere Pro MCP (PPMCP)

**Controla Adobe Premiere Pro desde Claude, Cursor o cualquier cliente [MCP](https://modelcontextprotocol.io).**

**Developer:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **Para instalar:** ve a **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**, descarga `PPMCP-Setup-x.x.x.zip`, extraelo, y haz doble clic en **`Setup.bat`**. Ese unico archivo ejecuta todo el instalador.

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

## Conecta tu cliente MCP

PPMCP es un **servidor MCP local (stdio)** — un proceso Node en tu propio PC que tu cliente de IA usa directamente. **No** es un "conector MCP remoto", asi que el flujo *"Add custom connector" → Remote MCP server URL* de Claude no aplica aqui. Tras el Setup, tus rutas exactas ya estan en `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json`.

**Claude Desktop** — Setup lo agrega automaticamente a `claude_desktop_config.json`. A mano, agrega esto al objeto `"mcpServers"`:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\Tu\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\Tu\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code** (CLI):

```bash
claude mcp add premiere-pro -- "C:\Users\Tu\AppData\Local\PPMCP\node\node.exe" "C:\Users\Tu\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server (un *comando local*, no una URL):
- Command: la ruta de Node de arriba
- Args: la ruta del server de arriba

## Estado de las herramientas

277 herramientas MCP en ~20 categorias. `clip_append` ya esta confirmado funcionando y `sequence_set_in_out` ahora funciona (confirmado en vivo; llama a `sequence.createSetInPointAction`, Premiere 25.6+). Limitacion confirmada de la plataforma Adobe: la API UXP no tiene metodo para anadir pistas vacias (`track_add`) — planifica el numero de pistas al crear la secuencia. Tabla detallada y actualizada en el **[English README](./README.md#tool-status-whats-actually-tested)** o en [docs/FEATURES.md](./docs/FEATURES.md).

Details: **[INSTALL.md](./INSTALL.md)** · English README for full features.
