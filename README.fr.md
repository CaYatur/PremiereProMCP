# Premiere Pro MCP (PPMCP)

**Controlez Adobe Premiere Pro depuis Claude, Cursor ou tout client [MCP](https://modelcontextprotocol.io).**

**Developer:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **Pour installer :** ouvrez **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**, telechargez `PPMCP-Setup-x.x.x.zip`, extrayez-le, puis double-cliquez sur **`Setup.bat`**. Ce seul fichier execute tout l'installateur.

Langue principale : **[English README](./README.md)**

---

# Installation (commencer ici)

**Guide complet :** **[INSTALL.md](./INSTALL.md)**

## Recommande : Setup ZIP depuis Releases

1. Ouvrir **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)**.  
2. Telecharger **`PPMCP-Setup-x.x.x.zip`**, extraire.  
3. Double-cliquer **`Setup.bat`** (assistant PowerShell).  
4. Dossier d'installation, version, **CEP Text Bridge** optionnel.  
5. Apres install, guides avec **chemins complets de ce PC** :
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

Le ZIP inclut **Node.js portable**.

Requis une fois : **Adobe UXP Developer Tool** (gratuit) pour charger le panneau Premiere :

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Recherche : **Adobe UXP Developer Tool download**

## Developpeurs : depuis le depot

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install && npm run build && npm run dev:bridge
```

## Connecter votre client MCP

PPMCP est un **serveur MCP local (stdio)** — un processus Node sur votre propre PC, que votre client IA lance et avec lequel il dialogue via stdin/stdout. Aucune URL ni port a saisir.

> [!WARNING]
> La boite **Settings → Connectors → Add custom connector** de Claude demande une *Remote MCP server URL*. Elle concerne les serveurs heberges et **ne fonctionne pas** pour PPMCP. Utilisez le fichier de configuration local du client (ou `claude mcp add`).

Tous les clients ont besoin des deux memes valeurs ; Setup les a deja ecrites avec vos vrais chemins dans `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` et `mcp-config-snippet.json` :

| Value | Default |
|-------|---------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **Echappement :** dans un `.json`, chaque antislash doit etre **double** (`C:\\Users\\You\\...`) ; en ligne de commande, non. C'est l'erreur de connexion la plus frequente.

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` — fusionnez dans l'objet `"mcpServers"` existant, puis **quittez et relancez completement** l'application (fermer la fenetre ne suffit pas).

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

**Claude Code** (CLI) — `--scope user` le rend disponible dans tous les projets ; verifiez avec `claude mcp list`.

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — `%USERPROFILE%\.cursor\mcp.json` (global) ou `.cursor\mcp.json` (ce projet seulement) — meme JSON que Claude Desktop.

**VS Code / GitHub Copilot** — `.vscode/mcp.json` — le seul client avec une forme differente : la cle est `servers`, pas `mcpServers`, et il faut `"type": "stdio"`. Egalement via la commande **MCP: Open User Configuration**.

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

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (ou panneau Cascade → icone MCP → Configure) — meme forme `mcpServers` ; rechargez Windsurf ensuite.

**Tout autre client MCP** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI… donnez-lui le transport **`stdio`** (parfois appele "local", "command" ou "process"), le chemin de Node comme commande et le chemin du serveur comme unique argument. Presque tous utilisent la forme `mcpServers` ci-dessus. Un client qui ne propose qu'un champ URL distante ne peut pas lancer PPMCP.

**`PPMCP_PROFILE`** — `core` (19) · `standard` (109, par defaut) · `full` (277). Cela ne fixe que le point de *depart* : le modele peut elargir lui-meme sa surface avec `tool_profile({ profile: "full" })` ou `{ category: "color" }`, et `tool_invoke` execute n'importe quel outil, enregistre ou non.

```json
"env": { "PPMCP_PROFILE": "standard" }
```

→ **[INSTALL.md](./INSTALL.md)** · **[English README](./README.md#connect-your-mcp-client)**

---

## Etat des outils

277 outils MCP dans ~20 categories. `clip_append` est maintenant confirme fonctionnel et `sequence_set_in_out` fonctionne maintenant (confirme en direct ; appelle `sequence.createSetInPointAction`, Premiere 25.6+). Limite confirmee de la plateforme Adobe : l'API UXP n'a aucune methode pour ajouter des pistes vides (`track_add`) — planifiez le nombre de pistes a la creation de la sequence. Tableau detaille et a jour dans le **[README anglais](./README.md#tool-status-whats-actually-tested)** ou [docs/FEATURES.md](./docs/FEATURES.md).

Details : **[INSTALL.md](./INSTALL.md)** · fonctions dans le README anglais.
