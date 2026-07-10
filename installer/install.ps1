#Requires -Version 5.1
<#
.SYNOPSIS
  PPMCP one-click installer (Windows) - CaYaDev | https://cayadev.com

.DESCRIPTION
  Installs Premiere Pro MCP stack:
  - npm install + build
  - Bridge auto-start (Startup folder + optional scheduled task)
  - UXP plugin registration helper (Developer Tool instructions + External folder copy)
  - Optional CEP Text Bridge
  - Claude Desktop / Cursor MCP config snippets

  Run:  right-click install.bat -> Run as administrator (recommended)
        or:  powershell -ExecutionPolicy Bypass -File install.ps1
#>

param(
  [switch]$SkipNodeCheck,
  [switch]$SkipCep,
  [switch]$NoStartup,
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = if ($InstallDir) { $InstallDir } else { Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$Brand = "CaYaDev"
$Site = "https://cayadev.com"
$Product = "Premiere Pro MCP (PPMCP)"
$RelayPort = 8265

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  XX  $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  $Product  installer" -ForegroundColor White
Write-Host "  Developer: $Brand  |  $Site" -ForegroundColor DarkGray
Write-Host "  Repo: $RepoRoot" -ForegroundColor DarkGray
Write-Host ""

# ── 1) Node.js ─────────────────────────────────────────────────────
Write-Step "Checking Node.js 18+"
if (-not $SkipNodeCheck) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Fail "Node.js not found. Install from https://nodejs.org (LTS 18+) and re-run."
    Write-Host "  Opening nodejs.org ..."
    Start-Process "https://nodejs.org/"
    exit 1
  }
  $ver = (& node -v) -replace '^v', ''
  $major = [int]($ver.Split('.')[0])
  if ($major -lt 18) {
    Write-Fail "Node $ver is too old. Need 18+."
    exit 1
  }
  Write-Ok "Node v$ver"
} else {
  Write-Warn "Skipped Node check"
}

# ── 2) npm install + build ─────────────────────────────────────────
Write-Step "Installing dependencies and building"
Push-Location $RepoRoot
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  Write-Ok "npm install + build complete"
} finally {
  Pop-Location
}

$ServerEntry = Join-Path $RepoRoot "server\dist\index.js"
$BridgeEntry = Join-Path $RepoRoot "bridge\dist\index.js"
if (-not (Test-Path $ServerEntry)) { throw "Missing $ServerEntry - build failed?" }
if (-not (Test-Path $BridgeEntry)) { throw "Missing $BridgeEntry - build failed?" }
$ServerEntryAbs = (Resolve-Path $ServerEntry).Path
$BridgeEntryAbs = (Resolve-Path $BridgeEntry).Path
$PluginManifest = (Resolve-Path (Join-Path $RepoRoot "plugin\manifest.json")).Path

# ── 3) Bridge launcher + Startup ───────────────────────────────────
Write-Step "Bridge auto-start"
$AppData = $env:APPDATA
$InstallApp = Join-Path $AppData "PPMCP"
New-Item -ItemType Directory -Force -Path $InstallApp | Out-Null

$BridgeBat = Join-Path $InstallApp "start-bridge.bat"
$BridgeVbs = Join-Path $InstallApp "start-bridge-silent.vbs"
$NodeExe = (Get-Command node).Source

@"
@echo off
title PPMCP Bridge (CaYaDev)
cd /d "$RepoRoot"
"$NodeExe" "$BridgeEntryAbs"
"@ | Set-Content -Encoding ASCII $BridgeBat

@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "$BridgeBat" & chr(34), 0, False
"@ | Set-Content -Encoding ASCII $BridgeVbs

if (-not $NoStartup) {
  $Startup = [Environment]::GetFolderPath("Startup")
  $lnkPath = Join-Path $Startup "PPMCP Bridge.lnk"
  $w = New-Object -ComObject WScript.Shell
  $sc = $w.CreateShortcut($lnkPath)
  $sc.TargetPath = "wscript.exe"
  $sc.Arguments = "`"$BridgeVbs`""
  $sc.WorkingDirectory = $InstallApp
  $sc.Description = "PPMCP WebSocket relay :$RelayPort - $Brand"
  $sc.Save()
  Write-Ok "Startup shortcut: $lnkPath"
} else {
  Write-Warn "Skipped Startup registration"
}

# Start bridge now
try {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$BridgeVbs`"" -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Write-Ok "Bridge started (silent) on port $RelayPort"
} catch {
  Write-Warn "Could not auto-start bridge: $_ - run $BridgeBat manually"
}

# ── 4) UXP plugin helper ───────────────────────────────────────────
Write-Step "UXP plugin"
$UxpExternal = Join-Path $AppData "Adobe\UXP\Plugins\External\com.ppmcp.plugin"
try {
  New-Item -ItemType Directory -Force -Path (Split-Path $UxpExternal) | Out-Null
  if (Test-Path $UxpExternal) {
    Remove-Item -Recurse -Force $UxpExternal -ErrorAction SilentlyContinue
  }
  # Junction/symlink so updates to repo apply; fallback to robocopy
  $pluginSrc = Join-Path $RepoRoot "plugin"
  try {
    cmd /c mklink /J "$UxpExternal" "$pluginSrc" | Out-Null
    Write-Ok "Linked UXP plugin -> $UxpExternal"
  } catch {
    robocopy $pluginSrc $UxpExternal /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    Write-Ok "Copied UXP plugin -> $UxpExternal"
  }
} catch {
  Write-Warn "UXP External folder setup failed: $_"
}

$UxpReadme = Join-Path $InstallApp "UXP-LOAD-INSTRUCTIONS.txt"
$NodeCmd = (Get-Command node).Source
@"
PPMCP - Load the UXP plugin in Premiere Pro
Developer: $Brand | $Site

YOUR PATHS ON THIS PC
---------------------
Plugin manifest (Add Plugin -> select this file):
  $PluginManifest

Plugin folder:
  $pluginSrc

Bridge:
  $BridgeBat

MCP server:
  $ServerEntryAbs

Node:
  $NodeCmd

MCP JSON snippet:
  $InstallApp\mcp-config-snippet.json

STEP 0 - You need Adobe UXP Developer Tool (free)
-------------------------------------------------
If you do not know what this is: download and install it first.
Without it you cannot load the PPMCP panel into Premiere.

  https://developer.adobe.com/premiere-pro/uxp/
  https://adobe.com/go/uxp_developer_tool
  Search: "Adobe UXP Developer Tool download"

Then:
1. Open Premiere Pro
2. Open UXP Developer Tool -> Add Plugin -> select the manifest path above
3. Load -> open PPMCP panel -> status: Active
4. Bottom-right: CaYaDev | cayadev.com
5. Keep the bridge running ($BridgeBat)
"@ | Set-Content -Encoding UTF8 $UxpReadme
Write-Ok "UXP instructions (full paths): $UxpReadme"
try { notepad $UxpReadme } catch {}

# ── 5) Optional CEP text bridge ────────────────────────────────────
if (-not $SkipCep) {
  Write-Step "Optional CEP Text Bridge"
  $cepScript = Join-Path $RepoRoot "legacy-bridge\install-dev.ps1"
  if (Test-Path $cepScript) {
    try {
      & powershell -ExecutionPolicy Bypass -File $cepScript
      Write-Ok "CEP Text Bridge install script finished"
      Write-Warn "Restart Premiere, then open Window -> PPMCP Text Bridge"
    } catch {
      Write-Warn "CEP install skipped/failed: $_"
    }
  } else {
    Write-Warn "legacy-bridge\install-dev.ps1 not found"
  }
}

# ── 6) MCP client config snippets ──────────────────────────────────
Write-Step "MCP client configuration"
$McpSnippet = Join-Path $InstallApp "mcp-config-snippet.json"
$ServerJson = $ServerEntryAbs -replace '\\', '/'
@"
{
  "mcpServers": {
    "premiere-pro": {
      "command": "node",
      "args": ["$ServerJson"]
    }
  }
}
"@ | Set-Content -Encoding UTF8 $McpSnippet
Write-Ok "MCP snippet: $McpSnippet"

# Claude Desktop path (user merges snippet - safer than auto-overwrite)
$ClaudeConfig = Join-Path $AppData "Claude\claude_desktop_config.json"
Write-Ok "Claude Desktop config (merge mcpServers from snippet):`n      $ClaudeConfig"

# Cursor hint
$CursorHint = Join-Path $InstallApp "CURSOR-MCP.txt"
@"
Cursor MCP setup
================
Add a new MCP server with:
  command: node
  args: $ServerEntryAbs

Or paste the JSON from:
  $McpSnippet
"@ | Set-Content -Encoding UTF8 $CursorHint

# ── 7) Desktop shortcut ────────────────────────────────────────────
Write-Step "Shortcuts"
try {
  $Desktop = [Environment]::GetFolderPath("Desktop")
  $w = New-Object -ComObject WScript.Shell
  $sc = $w.CreateShortcut((Join-Path $Desktop "PPMCP Bridge.lnk"))
  $sc.TargetPath = $BridgeBat
  $sc.WorkingDirectory = $RepoRoot
  $sc.Description = "Start PPMCP relay - $Brand"
  $sc.Save()
  Write-Ok "Desktop: PPMCP Bridge.lnk"
} catch {
  Write-Warn "Desktop shortcut failed: $_"
}

# ── Summary ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  $Product installed" -ForegroundColor Green
Write-Host "  Developer: $Brand  |  $Site" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Bridge starts with Windows (and was started now)."
Write-Host "  2. Load the UXP plugin (see $UxpReadme)."
Write-Host "  3. Open Premiere -> PPMCP panel should show: Active"
Write-Host "  4. Merge MCP config from: $McpSnippet"
Write-Host "  5. Restart Claude Desktop / Cursor, then call edit_bootstrap"
Write-Host ""
Write-Host "Server entry: $ServerEntryAbs"
Write-Host "Bridge entry: $BridgeEntryAbs"
Write-Host ""

# Open instructions
try { notepad $UxpReadme } catch { }
try { Start-Process $Site } catch { }
