#Requires -Version 5.1
<#
.SYNOPSIS
  Build a Windows release ZIP (pure PowerShell Setup - no Inno Setup).

.DESCRIPTION
  1) Builds the monorepo
  2) Stages app + portable Node into installer/payload
  3) Packs Setup.bat + Setup.ps1 + payload -> dist-release/PPMCP-Setup-<version>.zip

  Requires: Node.js, npm only (Windows 10+ has PowerShell + WinForms).
  Commercial-friendly: no third-party installer license.

  Usage (from repo root):
    powershell -ExecutionPolicy Bypass -File installer\build-release.ps1
    npm run release:win

  User: extract ZIP -> double-click Setup.bat
#>

param(
  [string]$NodeVersion = "20.18.1",
  [switch]$SkipNodeDownload,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$InstallerDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $InstallerDir
$Payload = Join-Path $InstallerDir "payload"
$OutDir = Join-Path $RepoRoot "dist-release"
$Pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$Version = $Pkg.version
if (-not $Version) { $Version = "0.1.0" }

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  OK  $m" -ForegroundColor Green }

Write-Host "PPMCP release build v$Version - CaYaDev / cayadev.com" -ForegroundColor White
Write-Host "Installer: PowerShell Setup (no Inno Setup)" -ForegroundColor Gray

# ── Build monorepo ─────────────────────────────────────────────────
if (-not $SkipBuild) {
  Write-Step "npm install + build"
  Push-Location $RepoRoot
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm install --omit=dev failed" }
  } finally {
    Pop-Location
  }
  Write-Ok "Project built"
} else {
  Write-Host "  Skipping npm build (-SkipBuild)" -ForegroundColor Yellow
}

# ── Stage payload ──────────────────────────────────────────────────
Write-Step "Staging payload"
if (Test-Path $Payload) { Remove-Item $Payload -Recurse -Force }
$App = Join-Path $Payload "app"
New-Item -ItemType Directory -Force -Path $App | Out-Null

function Copy-Path($rel) {
  $src = Join-Path $RepoRoot $rel
  $dst = Join-Path $App $rel
  if (-not (Test-Path $src)) {
    Write-Host "  skip missing $rel" -ForegroundColor Yellow
    return
  }
  if (Test-Path $src -PathType Container) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    robocopy $src $dst /E /XD node_modules .git dist-release tmp-qa scripts\spike /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  } else {
    $parent = Split-Path $dst -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item $src $dst -Force
  }
}

foreach ($d in @(
    "server",
    "bridge",
    "shared",
    "plugin",
    "templates",
    "legacy-bridge"
  )) {
  Copy-Path $d
}
Copy-Item (Join-Path $RepoRoot "package.json") (Join-Path $App "package.json") -Force
if (Test-Path (Join-Path $RepoRoot "package-lock.json")) {
  Copy-Item (Join-Path $RepoRoot "package-lock.json") (Join-Path $App "package-lock.json") -Force
}

Write-Step "Copying node_modules (this may take a minute)"
$nmSrc = Join-Path $RepoRoot "node_modules"
$nmDst = Join-Path $App "node_modules"
if (Test-Path $nmSrc) {
  robocopy $nmSrc $nmDst /E /XD .cache /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  Write-Ok "node_modules copied"
} else {
  throw "node_modules missing after install"
}

if (-not $SkipBuild) {
  Write-Step "Restoring devDependencies in repo (release build stripped them)"
  Push-Location $RepoRoot
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install (restore) failed" }
  } finally {
    Pop-Location
  }
  Write-Ok "Repo node_modules restored"
}

Set-Content (Join-Path $Payload "version.txt") $Version -Encoding ASCII
if (Test-Path (Join-Path $InstallerDir "finish-guide.txt")) {
  Copy-Item (Join-Path $InstallerDir "finish-guide.txt") (Join-Path $Payload "HOW-TO-USE.txt") -Force
}
Copy-Item (Join-Path $InstallerDir "post-install.ps1") (Join-Path $Payload "post-install.ps1") -Force
Copy-Item (Join-Path $InstallerDir "uninstall-helpers.ps1") (Join-Path $Payload "uninstall-helpers.ps1") -Force

# ── Portable Node ──────────────────────────────────────────────────
$NodeDir = Join-Path $Payload "node"
if (-not $SkipNodeDownload) {
  Write-Step "Downloading portable Node.js v$NodeVersion (win-x64)"
  $zipName = "node-v$NodeVersion-win-x64.zip"
  $url = "https://nodejs.org/dist/v$NodeVersion/$zipName"
  $zipPath = Join-Path $env:TEMP $zipName
  if (-not (Test-Path $zipPath)) {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  }
  $extract = Join-Path $env:TEMP "node-v$NodeVersion-win-x64"
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item $extract $NodeDir
  Write-Ok "Node at $NodeDir"
} else {
  Write-Host "  Skipping Node download (payload must already contain node\)" -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
  throw "node.exe missing in payload\node"
}

# ── Pack release ZIP (Setup.bat + scripts + payload) ────────────────
Write-Step "Packing release ZIP"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stageName = "PPMCP-Setup-$Version"
$stage = Join-Path $OutDir $stageName
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Entry points
Copy-Item (Join-Path $InstallerDir "Setup.bat") (Join-Path $stage "Setup.bat") -Force
Copy-Item (Join-Path $InstallerDir "Setup.ps1") (Join-Path $stage "Setup.ps1") -Force
Copy-Item (Join-Path $InstallerDir "post-install.ps1") (Join-Path $stage "post-install.ps1") -Force
Copy-Item (Join-Path $InstallerDir "uninstall-helpers.ps1") (Join-Path $stage "uninstall-helpers.ps1") -Force

# Payload next to Setup.ps1 (Setup.ps1 looks for .\payload)
$stagePayload = Join-Path $stage "payload"
New-Item -ItemType Directory -Force -Path $stagePayload | Out-Null
robocopy $Payload $stagePayload /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

# Short README for end users
$readmeTxt = @"
Premiere Pro MCP Setup  v$Version
CaYaDev | https://cayadev.com

HOW TO INSTALL
  1. Extract this whole folder (keep Setup.bat next to the payload folder).
  2. Double-click Setup.bat
  3. Choose Install / Update / Uninstall
  4. After install, open the guide with full paths:
     %APPDATA%\PPMCP\HOW-TO-USE.txt

REQUIREMENTS
  - Windows 10 or later (PowerShell is built-in)
  - Adobe Premiere Pro (UXP-capable)
  - Adobe UXP Developer Tool (free) to load the panel once:
    https://developer.adobe.com/premiere-pro/uxp/

No separate Node.js install needed - portable Node is included.
MIT License | CaYaDev | https://cayadev.com
"@
Set-Content (Join-Path $stage "README-INSTALL.txt") $readmeTxt -Encoding UTF8

$zipPath = Join-Path $OutDir "$stageName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Compress-Archive is slow on huge trees; use .NET ZipFile when available
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $stage,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Ok "ZIP created ($sizeMb MB)"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  RELEASE READY (no Inno Setup)" -ForegroundColor Green
Write-Host "  $zipPath" -ForegroundColor Green
Write-Host "  Also staged folder: $stage" -ForegroundColor Gray
Write-Host "  Upload the ZIP to GitHub Releases" -ForegroundColor Green
Write-Host "  Users: extract -> Setup.bat" -ForegroundColor Green
Write-Host "  CaYaDev | https://cayadev.com" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
