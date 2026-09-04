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

PPMCP は **ローカルの stdio MCP サーバー** です。AI クライアントが自分の PC 上で Node プロセスとして起動し、stdin/stdout で通信します。入力する URL やポートはありません。

> [!WARNING]
> Claude の **Settings → Connectors → Add custom connector** は *Remote MCP server URL* を求めますが、これはホスト型サーバー用で PPMCP では**動作しません**。クライアントのローカル設定ファイル（または `claude mcp add`）を使ってください。

どのクライアントも必要な値は同じ 2 つです。Setup が実際のパス付きで `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` と `mcp-config-snippet.json` に既に書き出しています：

| Value | Default |
|-------|---------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **エスケープ：** `.json` の中ではバックスラッシュを**二重**にします（`C:\\Users\\You\\...`）。コマンドラインでは不要です。接続失敗の最も多い原因です。

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` — 既存の `"mcpServers"` オブジェクトにマージし、アプリを**完全に終了して再起動**します（ウィンドウを閉じるだけでは不十分）。

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

**Claude Code** (CLI) — `--scope user` で全プロジェクトから使えます。`claude mcp list` で確認できます。

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — `%USERPROFILE%\.cursor\mcp.json` （グローバル）または `.cursor\mcp.json`（このプロジェクトのみ）— Claude Desktop と同じ JSON。

**VS Code / GitHub Copilot** — `.vscode/mcp.json` — 形式が異なる唯一のクライアント：キーは `mcpServers` ではなく `servers`、さらに `"type": "stdio"` が必要です。**MCP: Open User Configuration** コマンドからも設定できます。

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

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` （または Cascade パネル → MCP アイコン → Configure）— `mcpServers` 形式。設定後 Windsurf を再読み込み。

**その他の MCP クライアント** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI… トランスポートに **`stdio`**（"local" / "command" / "process" と呼ばれることもあります）、コマンドに Node のパス、引数にサーバーのパスを 1 つ指定します。ほとんどが上記の `mcpServers` 形式です。リモート URL 欄しかないクライアントでは PPMCP は動きません。

**`PPMCP_PROFILE`** — `core` (~19) · `standard` (~109, 既定) · `full` (277). PPMCP は 277 個すべてではなく**プロファイル**を登録します。残りは `tool_search` → `tool_schema` → `tool_invoke` で到達できます。

```json
"env": { "PPMCP_PROFILE": "standard" }
```

→ **[INSTALL.md](./INSTALL.md)** · **[English README](./README.md#connect-your-mcp-client)**

---

## ツールの状態

約20カテゴリに277個の MCP ツール。`clip_append` は実機で動作確認済み、`sequence_set_in_out` は動作確認済み（実機で確認。`sequence.createSetInPointAction` を呼ぶ、Premiere 25.6+）。確認済みの Adobe プラットフォーム制限: UXP API には空のトラックを追加するメソッドがない（`track_add`）— シーケンス作成時にトラック数を計画してください。最新の詳細な表は **[English README](./README.md#tool-status-whats-actually-tested)** または [docs/FEATURES.md](./docs/FEATURES.md) を参照。

詳細は **[INSTALL.md](./INSTALL.md)** と English README。
