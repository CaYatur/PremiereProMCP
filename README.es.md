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

PPMCP es un **servidor MCP local (stdio)** — un proceso Node en tu propio PC que tu cliente de IA lanza y con el que habla por stdin/stdout. No hay URL ni puerto que introducir.

> [!WARNING]
> El dialogo **Settings → Connectors → Add custom connector** de Claude pide una *Remote MCP server URL*. Es para servidores alojados y **no funciona** con PPMCP. Usa el archivo de configuracion local del cliente (o `claude mcp add`).

Todos los clientes necesitan los mismos dos valores; Setup ya los escribio con tus rutas reales en `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` y `mcp-config-snippet.json`:

| Value | Default |
|-------|---------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **Escapado:** dentro de un `.json` cada barra invertida va **doble** (`C:\\Users\\You\\...`); en la linea de comandos, no. Es el fallo de conexion mas comun.

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` — anade esto al objeto `"mcpServers"` existente, luego **cierra y reabre la app por completo** (cerrar la ventana no basta).

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

**Claude Code** (CLI) — `--scope user` lo hace disponible en todos los proyectos; comprueba con `claude mcp list`.

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — `%USERPROFILE%\.cursor\mcp.json` (global) o `.cursor\mcp.json` (solo este proyecto) — mismo JSON que Claude Desktop.

**VS Code / GitHub Copilot** — `.vscode/mcp.json` — el unico cliente con forma distinta: la clave es `servers`, no `mcpServers`, y necesita `"type": "stdio"`. Tambien via el comando **MCP: Open User Configuration**.

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

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (o panel Cascade → icono MCP → Configure) — misma forma `mcpServers`; recarga Windsurf despues.

**Cualquier otro cliente MCP** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI… dale transporte **`stdio`** (a veces llamado "local", "command" o "process"), la ruta de Node como comando y la ruta del server como unico argumento. Casi todos usan la forma `mcpServers` de arriba. Un cliente que solo ofrece un campo de URL remota no puede ejecutar PPMCP.

**`PPMCP_PROFILE`** — `core` (19) · `standard` (109, por defecto) · `full` (277). Solo decide donde *empieza* la sesion: el modelo puede ampliarla el mismo con `tool_profile({ profile: "full" })` o `{ category: "color" }`, y `tool_invoke` ejecuta cualquier herramienta este registrada o no.

```json
"env": { "PPMCP_PROFILE": "standard" }
```

→ **[INSTALL.md](./INSTALL.md)** · **[English README](./README.md#connect-your-mcp-client)**

---

## Estado de las herramientas

277 herramientas MCP en ~20 categorias. `clip_append` ya esta confirmado funcionando y `sequence_set_in_out` ahora funciona (confirmado en vivo; llama a `sequence.createSetInPointAction`, Premiere 25.6+). Limitacion confirmada de la plataforma Adobe: la API UXP no tiene metodo para anadir pistas vacias (`track_add`) — planifica el numero de pistas al crear la secuencia. Tabla detallada y actualizada en el **[English README](./README.md#tool-status-whats-actually-tested)** o en [docs/FEATURES.md](./docs/FEATURES.md).

Details: **[INSTALL.md](./INSTALL.md)** · English README for full features.
