# Premiere Pro MCP (PPMCP)

**通过 Claude、Cursor 或任意 [MCP](https://modelcontextprotocol.io) 客户端控制 Adobe Premiere Pro。**

**Developer:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **安装方法：** 打开 **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)**，下载 `PPMCP-Setup-x.x.x.zip` 并解压，然后双击 **`Setup.bat`**。这一个文件就能完成整个安装。

主语言：**[English README](./README.md)**

---

# 安装（从这里开始）

**完整指南：** **[INSTALL.md](./INSTALL.md)**

## 推荐：从 Releases 下载 Setup ZIP

1. 打开 **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)**  
2. 下载 **`PPMCP-Setup-x.x.x.zip`** 并解压  
3. 双击 **`Setup.bat`**（Windows PowerShell 向导）  
4. 选择安装路径、版本选项、可选 **CEP Text Bridge**  
5. 安装结束后查看（已写入本机**完整路径**）：
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

ZIP 内含 **便携 Node.js**，无需单独安装 Node。

加载 Premiere 面板前须安装免费的 **Adobe UXP Developer Tool**：

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- 搜索：**Adobe UXP Developer Tool download**

## 开发者：从仓库安装

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install && npm run build && npm run dev:bridge
```

## 连接你的 MCP 客户端

PPMCP 是一个**本地 stdio MCP 服务器** —— 由你的 AI 客户端在本机启动的 Node 进程，通过 stdin/stdout 通信。没有需要填写的 URL 或端口。

> [!WARNING]
> Claude 的 **Settings → Connectors → Add custom connector** 要求填写 *Remote MCP server URL*，那是给托管服务器用的，对 PPMCP **无效**。请使用客户端本地配置文件（或 `claude mcp add`）。

所有客户端需要的都是同样两个值；Setup 已经把你的真实路径写入 `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` 和 `mcp-config-snippet.json`：

| Value | Default |
|-------|---------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **转义：** 在 `.json` 文件中每个反斜杠都要**写两次**（`C:\\Users\\You\\...`）；命令行里则不用。这是最常见的连接失败原因。

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` — 合并到已有的 `"mcpServers"` 对象中，然后**完全退出并重新打开**应用（仅关闭窗口不够）。

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

**Claude Code** (CLI) — `--scope user` 让它在所有项目中可用；用 `claude mcp list` 检查。

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\You\AppData\Local\PPMCP\node\node.exe" "C:\Users\You\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — `%USERPROFILE%\.cursor\mcp.json` （全局）或 `.cursor\mcp.json`（仅当前项目）—— 与 Claude Desktop 相同的 JSON。

**VS Code / GitHub Copilot** — `.vscode/mcp.json` — 唯一格式不同的客户端：键名是 `servers` 而非 `mcpServers`，并且需要 `"type": "stdio"`。也可通过 **MCP: Open User Configuration** 命令配置。

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

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` （或 Cascade 面板 → MCP 图标 → Configure）—— 同样的 `mcpServers` 格式；之后重新加载 Windsurf。

**任何其他 MCP 客户端** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI… 把传输方式设为 **`stdio`**（有些客户端称为 "local" / "command" / "process"），命令填 Node 路径，参数填服务器路径。几乎都使用上面的 `mcpServers` 格式。只提供远程 URL 输入框的客户端无法运行 PPMCP。

**`PPMCP_PROFILE`** — `core` (19) · `standard` (109, 默认) · `full` (277). 这只决定会话的*起点*：模型可以用 `tool_profile({ profile: "full" })` 或 `{ category: "color" }` 自行扩展，而 `tool_invoke` 无论是否注册都能调用任何工具。

```json
"env": { "PPMCP_PROFILE": "standard" }
```

→ **[INSTALL.md](./INSTALL.md)** · **[English README](./README.md#connect-your-mcp-client)**

---

## 工具状态

约 20 个类别、277 个 MCP 工具。`clip_append` 现已确认可用，`sequence_set_in_out` 现已确认可用（实机确认，调用 `sequence.createSetInPointAction`，Premiere 25.6+）。已确认的 Adobe 平台限制：UXP API 没有添加空轨道的方法（`track_add`）——请在创建序列时规划好轨道数量。最新详细表格见 **[English README](./README.md#tool-status-whats-actually-tested)** 或 [docs/FEATURES.md](./docs/FEATURES.md)。

详见 **[INSTALL.md](./INSTALL.md)** 与英文 README 功能说明。
