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

PPMCP est un **serveur MCP local (stdio)** — un processus Node sur votre propre PC avec lequel votre client IA parle directement. Ce n'est **pas** un "connecteur MCP distant" hebergé — le flux *"Add custom connector" → Remote MCP server URL* des parametres Connectors de Claude ne s'applique pas ici. Apres le Setup, vos chemins exacts sont deja dans `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json`.

**Claude Desktop** — Setup l'ajoute automatiquement a `claude_desktop_config.json`. A la main, ajoutez ceci dans l'objet `"mcpServers"` :

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\Vous\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\Vous\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code** (CLI) :

```bash
claude mcp add premiere-pro -- "C:\Users\Vous\AppData\Local\PPMCP\node\node.exe" "C:\Users\Vous\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server (une *commande locale*, pas une URL) :
- Command : le chemin Node ci-dessus
- Args : le chemin du serveur ci-dessus

## Etat des outils

~225 outils MCP ; la plupart sont type-verified (correspondent a une methode reelle de l'API Adobe, mais pas encore toutes testees en direct). Quatre problemes connus avec une vraie solution : `clip_insert`, `marker_add`, `text_set_content` (editer un texte existant), et `shape_set_size` — details et alternatives dans le **[README anglais](./README.md#tool-status-whats-actually-tested)** ou [docs/FEATURES.md](./docs/FEATURES.md).

Details : **[INSTALL.md](./INSTALL.md)** · fonctions dans le README anglais.
