# Premiere Pro MCP (PPMCP)

**Controlez Adobe Premiere Pro depuis Claude, Cursor ou tout client [MCP](https://modelcontextprotocol.io).**

**Developer:** [CaYaDev](https://cayadev.com)

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

Details : **[INSTALL.md](./INSTALL.md)** · fonctions dans le README anglais.
