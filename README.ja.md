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

## MCP クライアントを接続する

PPMCP は**ローカルの stdio MCP サーバー**です — 自分の PC 上で動く Node プロセスに、AI クライアントが直接話しかけます。ホスト型の「リモート MCP コネクタ」ではないため、Claude の Connectors 設定にある *「Add custom connector」→ Remote MCP server URL* のフローはここでは使いません。Setup 実行後、あなたの実際のパスはすでに `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json` に書かれています。

**Claude Desktop** — Setup が `claude_desktop_config.json` に自動で追加します。手動の場合は `"mcpServers"` オブジェクトに追加:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\あなた\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\あなた\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code**（CLI）:

```bash
claude mcp add premiere-pro -- "C:\Users\あなた\AppData\Local\PPMCP\node\node.exe" "C:\Users\あなた\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server（URL ではなく*ローカルコマンド*）:
- Command: 上記の Node のパス
- Args: 上記の server のパス

## ツールの状態

約225個の MCP ツール。ほとんどは type-verified（Adobe API の実メソッドに対応するが、まだ実機で全て検証済みではない）。実際のワークアラウンドがある既知の問題が4つ: `clip_insert`、`marker_add`、`text_set_content`（既存テキストの編集）、`shape_set_size`。詳細と代替手段は **[English README](./README.md#tool-status-whats-actually-tested)** または [docs/FEATURES.md](./docs/FEATURES.md) を参照。

詳細は **[INSTALL.md](./INSTALL.md)** と English README。
