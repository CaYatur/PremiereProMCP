#Requires -Version 5.1
<#
  Runs at the end of Setup.ps1 install (payload mode).
  Resolves real absolute paths on THIS PC and writes user-facing guides.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [string]$SetupVersion = "0.2.0",
  [switch]$InstallCep,
  [switch]$NoStartup
)

$ErrorActionPreference = "Stop"
$Brand = "CaYaDev"
$Site = "https://cayadev.com"
$AppDir = (Resolve-Path -LiteralPath $AppDir.TrimEnd('\')).Path

# Persist version for next Setup "update vs uninstall" detection
try {
  Set-Content -Path (Join-Path $AppDir "version.txt") -Value $SetupVersion.Trim() -Encoding ASCII
} catch {}

$NodeExe = Join-Path $AppDir "node\node.exe"
$ServerJs = Join-Path $AppDir "app\server\dist\index.js"
$BridgeJs = Join-Path $AppDir "app\bridge\dist\index.js"
$PluginManifest = Join-Path $AppDir "app\plugin\manifest.json"
$PluginFolder = Join-Path $AppDir "app\plugin"

function Full([string]$p) {
  if (Test-Path -LiteralPath $p) {
    return (Resolve-Path -LiteralPath $p).Path
  }
  return $p
}

$NodeExe = Full $NodeExe
$ServerJs = Full $ServerJs
$BridgeJs = Full $BridgeJs
$PluginManifest = Full $PluginManifest
$PluginFolder = Full $PluginFolder

if (-not (Test-Path -LiteralPath $NodeExe)) { throw "Bundled Node not found: $NodeExe" }
if (-not (Test-Path -LiteralPath $ServerJs)) { throw "MCP server not found: $ServerJs" }
if (-not (Test-Path -LiteralPath $BridgeJs)) { throw "Bridge not found: $BridgeJs" }

$AppData = $env:APPDATA
$LocalAppData = $env:LOCALAPPDATA
$UserName = $env:USERNAME
$ComputerName = $env:COMPUTERNAME
$Helper = Join-Path $AppData "PPMCP"
New-Item -ItemType Directory -Force -Path $Helper | Out-Null
$Helper = Full $Helper

$ClaudeConfig = Join-Path $AppData "Claude\claude_desktop_config.json"
$SnippetPath = Join-Path $Helper "mcp-config-snippet.json"
$HowToUse = Join-Path $Helper "HOW-TO-USE.txt"
$HowToConnect = Join-Path $Helper "HOW-TO-CONNECT.txt"
$Desktop = [Environment]::GetFolderPath("Desktop")
$Startup = [Environment]::GetFolderPath("Startup")
$BridgeBat = Join-Path $Helper "start-bridge.bat"
$BridgeVbs = Join-Path $Helper "start-bridge-silent.vbs"
$DesktopLnk = Join-Path $Desktop "PPMCP Bridge.lnk"
$StartupLnk = Join-Path $Startup "PPMCP Bridge.lnk"

# JSON paths: forward slashes work in Node on Windows and avoid escape hell
function JsonPath([string]$p) { return ($p -replace '\\', '/') }

# ── Bridge launcher ────────────────────────────────────────────────
@"
@echo off
title PPMCP Bridge - CaYaDev
cd /d "$AppDir\app"
"$NodeExe" "$BridgeJs"
"@ | Set-Content -Encoding ASCII $BridgeBat

@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "$BridgeBat" & chr(34), 0, False
"@ | Set-Content -Encoding ASCII $BridgeVbs

if (-not $NoStartup) {
  $w = New-Object -ComObject WScript.Shell
  $sc = $w.CreateShortcut($StartupLnk)
  $sc.TargetPath = "wscript.exe"
  $sc.Arguments = "`"$BridgeVbs`""
  $sc.WorkingDirectory = $Helper
  $sc.Description = "PPMCP relay - $Brand"
  $sc.Save()
}

try {
  $w = New-Object -ComObject WScript.Shell
  $sc = $w.CreateShortcut($DesktopLnk)
  $sc.TargetPath = $BridgeBat
  $sc.WorkingDirectory = $AppDir
  $sc.Description = "Start PPMCP bridge - $Brand"
  $sc.Save()
} catch {}

# ── MCP JSON (real paths) ──────────────────────────────────────────
$snippet = @"
{
  "mcpServers": {
    "premiere-pro": {
      "command": "$(JsonPath $NodeExe)",
      "args": [
        "$(JsonPath $ServerJs)"
      ]
    }
  }
}
"@
Set-Content -Path $SnippetPath -Value $snippet -Encoding UTF8

# ── Short connect card ─────────────────────────────────────────────
$connectText = @"
PPMCP - YOUR PATHS ON THIS COMPUTER
====================================
PC user:     $UserName
Computer:    $ComputerName
Install dir: $AppDir
Developer:   $Brand | $Site

--- Copy these EXACT paths ---

Node (command):
$NodeExe

MCP server (args):
$ServerJs

MCP JSON file (ready to copy):
$SnippetPath

Claude Desktop config file:
$ClaudeConfig

Plugin manifest (for UXP Developer Tool -> Add Plugin):
$PluginManifest

Plugin folder:
$PluginFolder

Bridge start (if not running):
$BridgeBat
Desktop shortcut:
$DesktopLnk

Claude Code example (one line, copy as-is):
claude mcp add premiere-pro -- "$NodeExe" "$ServerJs"

Cursor:
  Settings -> MCP -> Add server
  Command = the Node path above
  Args    = the MCP server path above
"@
Set-Content -Path $HowToConnect -Value $connectText -Encoding UTF8

# ── Full HOW-TO-USE with real paths + UXP Developer Tool download ──
$cepNote = if ($InstallCep) {
  @"
CEP Text Bridge: SELECTED during install.
  Restart Premiere Pro, then open: Window -> PPMCP Text Bridge (leave it open).
"@
} else {
  @"
CEP Text Bridge: NOT installed (optional).
  PNG titles still work. To add editable titles later, re-run the installer
  with CEP checked, or see the GitHub repo legacy-bridge folder.
"@
}

$guide = @"
============================================================
  Premiere Pro MCP (PPMCP) - How to use on THIS PC
  Developer: $Brand  |  $Site
============================================================

Install finished on: $(Get-Date -Format "yyyy-MM-dd HH:mm")
Setup version: $SetupVersion
Windows user: $UserName
Computer:     $ComputerName

To UPDATE later: run the newest PPMCP-Setup-*.exe again (detects this install).
To REMOVE: run Setup again and choose Uninstall, or Windows Settings -> Apps.

------------------------------------------------------------
YOUR FULL PATHS (do not guess - copy from here)
------------------------------------------------------------

Install folder:
  $AppDir

Portable Node.exe (MCP "command"):
  $NodeExe

MCP server entry (MCP "args"):
  $ServerJs

Bridge script:
  $BridgeJs

Ready MCP JSON (copy entire file into your AI client):
  $SnippetPath

Claude Desktop config (edit this file):
  $ClaudeConfig

Plugin manifest (select this in UXP Developer Tool):
  $PluginManifest

This guide file:
  $HowToUse

Path list only:
  $HowToConnect

------------------------------------------------------------
STEP 0 - Adobe UXP Developer Tool (required once)
------------------------------------------------------------

You need Adobe's free "UXP Developer Tool" to load the Premiere panel.
If you never installed it, download it first:

  Official Adobe page (Premiere Pro UXP / tools):
  https://developer.adobe.com/premiere-pro/uxp/

  Direct marketplace / Creative Cloud style listing often used:
  https://adobe.com/go/uxp_developer_tool

  Search Google if the link moves:
  "Adobe UXP Developer Tool download"

Install UXP Developer Tool, then continue. Without it, a non-technical
user cannot load the PPMCP panel into Premiere.

------------------------------------------------------------
STEP 1 - Bridge (relay) must be running
------------------------------------------------------------

  Relay:  ws://127.0.0.1:8265

  If needed, double-click:
    $DesktopLnk

  Or run:
    $BridgeBat

  Setup also tried to start the bridge automatically.

------------------------------------------------------------
STEP 2 - Load the plugin in Premiere Pro
------------------------------------------------------------

  1. Open Adobe Premiere Pro.
  2. Open Adobe UXP Developer Tool (you installed it in Step 0).
  3. Click "Add Plugin" (or equivalent).
  4. Select this EXACT file:

       $PluginManifest

  5. Click Load.
  6. In Premiere, open the PPMCP panel.
  7. Status must say:  Active  (green).
  8. Bottom-right: Developer: CaYaDev | cayadev.com

  After updates: click Reload on the plugin in UXP Developer Tool.

------------------------------------------------------------
STEP 3 - Connect Claude Desktop
------------------------------------------------------------

  1. Open or create this file in Notepad:

       $ClaudeConfig

  2. Open this file and COPY ALL of its contents:

       $SnippetPath

  3. Paste into claude_desktop_config.json so the "mcpServers" section
     includes "premiere-pro" (merge carefully if you already have other servers).

  Example of what your snippet contains on THIS PC:

$snippet

  4. Fully quit Claude Desktop (tray too) and open it again.
  5. Ask Claude to call:  edit_bootstrap

------------------------------------------------------------
STEP 4 - Connect Claude Code
------------------------------------------------------------

  Run this command in a terminal (paths are for THIS PC):

  claude mcp add premiere-pro -- "$NodeExe" "$ServerJs"

  Or add the same command/args in Claude Code MCP settings JSON.

------------------------------------------------------------
STEP 5 - Connect Cursor
------------------------------------------------------------

  Cursor -> Settings -> MCP -> Add new MCP server

  Command:
    $NodeExe

  Args (one argument):
    $ServerJs

  Save and restart Cursor if needed. Then call edit_bootstrap.

------------------------------------------------------------
STEP 6 - First test checklist
------------------------------------------------------------

  [ ] UXP Developer Tool installed
  [ ] Bridge running (Desktop "PPMCP Bridge" if needed)
  [ ] Premiere open, PPMCP panel = Active
  [ ] MCP client config uses the paths above
  [ ] AI client fully restarted
  [ ] Call: edit_bootstrap  ->  plugin connected

------------------------------------------------------------
OPTIONAL - CEP text bridge
------------------------------------------------------------

$cepNote

------------------------------------------------------------
SUPPORT
------------------------------------------------------------

  Website:   $Site
  Developer: $Brand
  GitHub:    https://github.com/CaYatur/PremiereProMCP

============================================================
"@

Set-Content -Path $HowToUse -Value $guide -Encoding UTF8

# Also write into install dir for Start Menu "Open usage guide"
$appGuide = Join-Path $AppDir "HOW-TO-USE.txt"
try {
  Set-Content -Path $appGuide -Value $guide -Encoding UTF8
} catch {}

# UXP External junction (best-effort)
$pluginSrc = Join-Path $AppDir "app\plugin"
$uxpExt = Join-Path $AppData "Adobe\UXP\Plugins\External\com.ppmcp.plugin"
try {
  New-Item -ItemType Directory -Force -Path (Split-Path $uxpExt) | Out-Null
  if (Test-Path $uxpExt) {
    cmd /c "rmdir `"$uxpExt`"" 2>$null | Out-Null
    Remove-Item $uxpExt -Recurse -Force -ErrorAction SilentlyContinue
  }
  cmd /c "mklink /J `"$uxpExt`" `"$pluginSrc`"" | Out-Null
} catch {}

if ($InstallCep) {
  $cep = Join-Path $AppDir "app\legacy-bridge\install-dev.ps1"
  if (Test-Path $cep) {
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $cep
    } catch {}
  }
}

try {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$BridgeVbs`"" -WindowStyle Hidden
} catch {
  try { Start-Process -FilePath $BridgeBat } catch {}
}

# Open personalized guides
try { Start-Process "notepad.exe" -ArgumentList "`"$HowToUse`"" } catch {}
try { Start-Process "notepad.exe" -ArgumentList "`"$HowToConnect`"" } catch {}

Write-Host "Post-install OK. Guides written with real paths:"
Write-Host "  $HowToUse"
Write-Host "  $HowToConnect"
Write-Host "  $SnippetPath"
Write-Host "CaYaDev | $Site"
