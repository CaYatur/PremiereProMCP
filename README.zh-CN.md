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

PPMCP 是一个**本地 stdio MCP 服务器**——一个运行在你自己电脑上的 Node 进程，AI 客户端直接与它通信。它**不是**托管的"远程 MCP 连接器"，所以 Claude 的 Connectors 设置里 *"Add custom connector" → Remote MCP server URL* 那个流程在这里不适用。Setup 完成后，你的确切路径已经写在 `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json` 里了。

**Claude Desktop** —— Setup 会自动写入 `claude_desktop_config.json`。手动添加时，合并到 `"mcpServers"` 对象里：

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\你\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\你\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code**（命令行）：

```bash
claude mcp add premiere-pro -- "C:\Users\你\AppData\Local\PPMCP\node\node.exe" "C:\Users\你\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** —— Settings → MCP → Add server（这是*本地命令*，不是 URL）：
- Command：上面的 Node 路径
- Args：上面的 server 路径

详见 **[INSTALL.md](./INSTALL.md)** 与英文 README 功能说明。
