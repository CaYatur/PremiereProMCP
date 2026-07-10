# Premiere Pro MCP (PPMCP)

**Claude / Cursor / [MCP](https://modelcontextprotocol.io) クライアントから Adobe Premiere Pro を操作。**

**Developer:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **インストール方法:** **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)** を開き、`PPMCP-Setup-x.x.x.zip` をダウンロードして展開し、**`Setup.bat`** をダブルクリックしてください。このファイル1つでインストールがすべて完了します。

メイン: **[English README](./README.md)**

---

# インストール（ここから）

**詳細ガイド:** **[INSTALL.md](./INSTALL.md)**

## おすすめ: Releases の Setup ZIP

1. **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)** を開く  
2. **`PPMCP-Setup-x.x.x.zip`** をダウンロードして展開  
3. **`Setup.bat`** をダブルクリック（PowerShell ウィザード）  
4. インストール先・バージョン・任意の **CEP Text Bridge**  
5. 完了後、この PC の **絶対パス** が入ったガイド:
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

ZIP に **portable Node.js** 同梱（別途 Node 不要）。

Premiere パネル用に無料の **Adobe UXP Developer Tool** が必要（未導入なら先にインストール）:

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- 検索: **Adobe UXP Developer Tool download**

## 開発者: リポジトリから

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install && npm run build && npm run dev:bridge
```

詳細は **[INSTALL.md](./INSTALL.md)** と English README。
