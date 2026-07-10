# Premiere Pro MCP (PPMCP)

**通过 Claude、Cursor 或任意 [MCP](https://modelcontextprotocol.io) 客户端控制 Adobe Premiere Pro。**

**Developer:** [CaYaDev](https://cayadev.com)

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

详见 **[INSTALL.md](./INSTALL.md)** 与英文 README 功能说明。
