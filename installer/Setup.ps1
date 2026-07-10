#Requires -Version 5.1
<#
  PPMCP Setup Wizard - pure PowerShell + WinForms (no third-party installer).
  Developer: CaYaDev | https://cayadev.com

  Launch: double-click Setup.bat (or run this script).

  - Fresh install / update / uninstall
  - Detects existing install (folder + registry)
  - Optional CEP Text Bridge
  - Writes real full paths after install (HOW-TO-USE.txt)
  - Package mode: .\payload with portable Node
  - Dev mode: no payload -> uses parent repo + system Node
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $ScriptDir
$Brand = "CaYaDev"
$Site = "https://cayadev.com"
$Product = "Premiere Pro MCP"
$DefaultVersion = "0.2.0"

# Prefer staged release payload (next to Setup); else live repo
$PayloadRoot = Join-Path $ScriptDir "payload"
$HasPayload = (Test-Path (Join-Path $PayloadRoot "app\server\dist\index.js")) -and
              (Test-Path (Join-Path $PayloadRoot "node\node.exe"))

function Get-SetupVersion {
  $vf = Join-Path $PayloadRoot "version.txt"
  if (Test-Path $vf) { return (Get-Content $vf -Raw).Trim() }
  $pkg = Join-Path $RepoRoot "package.json"
  if (Test-Path $pkg) {
    try {
      $j = Get-Content $pkg -Raw | ConvertFrom-Json
      if ($j.version) { return [string]$j.version }
    } catch {}
  }
  return $DefaultVersion
}

$SetupVersion = Get-SetupVersion
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA "PPMCP"

function Read-InstalledInfo {
  $info = @{
    Found   = $false
    Dir     = ""
    Version = ""
  }
  # Default + common locations
  $candidates = @(
    $DefaultInstallDir,
    (Join-Path $env:ProgramFiles "PPMCP"),
    (Join-Path ${env:ProgramFiles(x86)} "PPMCP")
  )
  foreach ($d in $candidates) {
    if (-not $d) { continue }
    $marker = Join-Path $d "app\server\dist\index.js"
    $verFile = Join-Path $d "version.txt"
    if (Test-Path $marker) {
      $info.Found = $true
      $info.Dir = $d
      if (Test-Path $verFile) { $info.Version = (Get-Content $verFile -Raw).Trim() }
      break
    }
  }
  # Registry uninstall (if previous Inno or custom wrote it)
  try {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PPMCP-CaYaDev"
    if (Test-Path $key) {
      $p = Get-ItemProperty $key -ErrorAction SilentlyContinue
      if ($p.InstallLocation -and (Test-Path $p.InstallLocation)) {
        $info.Found = $true
        $info.Dir = $p.InstallLocation.TrimEnd('\')
        if ($p.DisplayVersion) { $info.Version = $p.DisplayVersion }
      }
    }
  } catch {}
  return $info
}

function Stop-Bridge {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -like "PPMCP Bridge*" -or
    ($_.ProcessName -eq "node" -and $_.Path -like "*PPMCP*")
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
}

function Write-RegistryUninstall($installDir, $version) {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PPMCP-CaYaDev"
  New-Item -Path $key -Force | Out-Null
  $uninst = Join-Path $installDir "Uninstall.bat"
  Set-ItemProperty -Path $key -Name "DisplayName" -Value $Product
  Set-ItemProperty -Path $key -Name "DisplayVersion" -Value $version
  Set-ItemProperty -Path $key -Name "Publisher" -Value $Brand
  Set-ItemProperty -Path $key -Name "InstallLocation" -Value $installDir
  Set-ItemProperty -Path $key -Name "UninstallString" -Value "`"$uninst`""
  Set-ItemProperty -Path $key -Name "DisplayIcon" -Value (Join-Path $installDir "node\node.exe")
  Set-ItemProperty -Path $key -Name "URLInfoAbout" -Value $Site
  Set-ItemProperty -Path $key -Name "NoModify" -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name "NoRepair" -Value 1 -Type DWord
}

function Remove-RegistryUninstall {
  Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PPMCP-CaYaDev" -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-Uninstall($installDir) {
  Stop-Bridge
  $helper = Join-Path $env:APPDATA "PPMCP"
  $startup = [Environment]::GetFolderPath("Startup")
  $desktop = [Environment]::GetFolderPath("Desktop")
  Remove-Item (Join-Path $startup "PPMCP Bridge.lnk") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $desktop "PPMCP Bridge.lnk") -Force -ErrorAction SilentlyContinue
  Remove-Item $helper -Recurse -Force -ErrorAction SilentlyContinue
  $uxp = Join-Path $env:APPDATA "Adobe\UXP\Plugins\External\com.ppmcp.plugin"
  if (Test-Path $uxp) {
    cmd /c "rmdir `"$uxp`"" 2>$null | Out-Null
    Remove-Item $uxp -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($installDir -and (Test-Path $installDir)) {
    # Don't delete if install dir is the live repo accidentally
    $isRepo = Test-Path (Join-Path $installDir "installer\Setup.ps1")
    if (-not $isRepo) {
      Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-RegistryUninstall
}

function Copy-Tree($src, $dst) {
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  robocopy $src $dst /E /XD .git node_modules\.cache /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
}

function Install-FromPayload($installDir, $installCep, $startup) {
  if (-not $HasPayload) { throw "Release payload not found. Run build-release.ps1 first, or use repo install (no payload folder)." }

  Stop-Bridge
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null

  # node
  $nodeSrc = Join-Path $PayloadRoot "node"
  $nodeDst = Join-Path $installDir "node"
  if (Test-Path $nodeDst) { Remove-Item $nodeDst -Recurse -Force -ErrorAction SilentlyContinue }
  Copy-Tree $nodeSrc $nodeDst

  # app
  $appSrc = Join-Path $PayloadRoot "app"
  $appDst = Join-Path $installDir "app"
  if (Test-Path $appDst) { Remove-Item $appDst -Recurse -Force -ErrorAction SilentlyContinue }
  Copy-Tree $appSrc $appDst

  Copy-Item (Join-Path $PayloadRoot "version.txt") (Join-Path $installDir "version.txt") -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $ScriptDir "post-install.ps1") (Join-Path $installDir "post-install.ps1") -Force
  Copy-Item (Join-Path $ScriptDir "uninstall-helpers.ps1") (Join-Path $installDir "uninstall-helpers.ps1") -Force -ErrorAction SilentlyContinue

  # Uninstall.bat in install dir
  $unBat = Join-Path $installDir "Uninstall.bat"
  @"
@echo off
title PPMCP Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-Setup.ps1"
pause
"@ | Set-Content $unBat -Encoding ASCII

  $unPs1 = Join-Path $installDir "Uninstall-Setup.ps1"
  @"
`$ErrorActionPreference = 'Continue'
`$dir = Split-Path -Parent `$MyInvocation.MyCommand.Path
Write-Host 'Removing PPMCP from' `$dir
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path `$dir 'uninstall-helpers.ps1')
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PPMCP-CaYaDev" -Recurse -Force -ErrorAction SilentlyContinue
`$startup = [Environment]::GetFolderPath('Startup')
`$desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path `$startup 'PPMCP Bridge.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path `$desktop 'PPMCP Bridge.lnk') -Force -ErrorAction SilentlyContinue
if (Test-Path `$dir) {
  Start-Sleep 1
  try { Remove-Item `$dir -Recurse -Force } catch {
    Write-Host 'Close any open files in the install folder, then delete it manually:'
    Write-Host `$dir
  }
}
Write-Host 'Done. Remove MCP entry from Claude/Cursor if needed.'
Write-Host 'CaYaDev | https://cayadev.com'
"@ | Set-Content $unPs1 -Encoding UTF8

  # Also copy uninstall-helpers into install dir content for Uninstall-Setup
  if (Test-Path (Join-Path $ScriptDir "uninstall-helpers.ps1")) {
    Copy-Item (Join-Path $ScriptDir "uninstall-helpers.ps1") (Join-Path $installDir "uninstall-helpers.ps1") -Force
  }

  $postArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $installDir "post-install.ps1"),
    "-AppDir", $installDir,
    "-SetupVersion", $SetupVersion
  )
  if ($installCep) { $postArgs += "-InstallCep" }
  if (-not $startup) { $postArgs += "-NoStartup" }
  & powershell @postArgs
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    # post-install may not set exit code
  }

  Write-RegistryUninstall $installDir $SetupVersion
}

function Install-FromRepo($installDir, $installCep, $startup) {
  # Dev/source path: use existing install.ps1 logic via calling it with InstallDir
  $installPs1 = Join-Path $ScriptDir "install.ps1"
  if (-not (Test-Path $installPs1)) { throw "install.ps1 not found" }
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installPs1, "-InstallDir", $RepoRoot)
  if (-not $installCep) { $args += "-SkipCep" }
  if (-not $startup) { $args += "-NoStartup" }
  # Repo mode installs in-place (does not copy to LocalAppData) - still register helpers
  & powershell @args

  # If user picked a different dir, note that repo mode uses the clone
  Set-Content (Join-Path $RepoRoot "version.txt") $SetupVersion -Encoding ASCII -ErrorAction SilentlyContinue
  Write-RegistryUninstall $RepoRoot $SetupVersion
}

# ── UI ─────────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "$Product Setup  v$SetupVersion  -  $Brand"
$form.Size = New-Object System.Drawing.Size(560, 520)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 48)
$form.ForeColor = [System.Drawing.Color]::WhiteSmoke

function Add-Label($text, $x, $y, $w = 520, $h = 20, $bold = $false) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = [System.Drawing.Color]::WhiteSmoke
  if ($bold) { $l.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold) }
  else { $l.Font = New-Object System.Drawing.Font("Segoe UI", 9) }
  $form.Controls.Add($l)
  return $l
}

$existing = Read-InstalledInfo

Add-Label "$Product" 20 16 500 24 $true | Out-Null
Add-Label "Developer: $Brand   |   $Site" 20 42 500 18 | Out-Null
Add-Label "This Setup version:  $SetupVersion" 20 64 500 18 | Out-Null

$modeLabel = Add-Label "" 20 92 520 40
if ($existing.Found) {
  $ver = if ($existing.Version) { $existing.Version } else { "unknown" }
  $modeLabel.Text = "Installed: YES   |   Version: $ver`nLocation: $($existing.Dir)"
  $modeLabel.ForeColor = [System.Drawing.Color]::FromArgb(144, 238, 144)
} else {
  $modeLabel.Text = "Installed: No - fresh install"
  $modeLabel.ForeColor = [System.Drawing.Color]::FromArgb(180, 180, 180)
}

Add-Label "Action" 20 140 200 18 $true | Out-Null
$rbInstall = New-Object System.Windows.Forms.RadioButton
$rbInstall.Text = if ($existing.Found) { "Update / reinstall to v$SetupVersion" } else { "Install v$SetupVersion" }
$rbInstall.Location = New-Object System.Drawing.Point(24, 162)
$rbInstall.Size = New-Object System.Drawing.Size(480, 22)
$rbInstall.Checked = $true
$rbInstall.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Controls.Add($rbInstall)

$rbUninstall = New-Object System.Windows.Forms.RadioButton
$rbUninstall.Text = "Uninstall completely (remove PPMCP from this PC)"
$rbUninstall.Location = New-Object System.Drawing.Point(24, 186)
$rbUninstall.Size = New-Object System.Drawing.Size(480, 22)
$rbUninstall.Enabled = $existing.Found
$rbUninstall.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Controls.Add($rbUninstall)

Add-Label "Install folder" 20 220 200 18 $true | Out-Null
$tbDir = New-Object System.Windows.Forms.TextBox
$tbDir.Location = New-Object System.Drawing.Point(24, 242)
$tbDir.Size = New-Object System.Drawing.Size(400, 24)
$tbDir.Text = if ($existing.Found) { $existing.Dir } else { $DefaultInstallDir }
$form.Controls.Add($tbDir)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Location = New-Object System.Drawing.Point(432, 240)
$btnBrowse.Size = New-Object System.Drawing.Size(90, 26)
$btnBrowse.Add_Click({
  $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
  $fbd.Description = "Choose install folder for PPMCP"
  $fbd.SelectedPath = $tbDir.Text
  if ($fbd.ShowDialog() -eq "OK") { $tbDir.Text = $fbd.SelectedPath }
})
$form.Controls.Add($btnBrowse)

$cbCep = New-Object System.Windows.Forms.CheckBox
$cbCep.Text = "Install optional CEP Text Bridge (editable titles; PNG works without it)"
$cbCep.Location = New-Object System.Drawing.Point(24, 280)
$cbCep.Size = New-Object System.Drawing.Size(500, 22)
$cbCep.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Controls.Add($cbCep)

$cbStartup = New-Object System.Windows.Forms.CheckBox
$cbStartup.Text = "Start bridge when Windows starts (recommended)"
$cbStartup.Location = New-Object System.Drawing.Point(24, 304)
$cbStartup.Size = New-Object System.Drawing.Size(500, 22)
$cbStartup.Checked = $true
$cbStartup.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Controls.Add($cbStartup)

$lblNote = Add-Label "" 20 335 510 50
if ($HasPayload) {
  $lblNote.Text = "Package mode: using bundled payload (portable Node + app). No separate Node.js install needed."
  $lblNote.ForeColor = [System.Drawing.Color]::FromArgb(144, 200, 255)
} else {
  $lblNote.Text = "Dev mode: no payload folder - will use this repo + system Node.js (npm install/build)."
  $lblNote.ForeColor = [System.Drawing.Color]::FromArgb(255, 200, 120)
}

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(24, 390)
$progress.Size = New-Object System.Drawing.Size(500, 18)
$progress.Style = "Marquee"
$progress.Visible = $false
$form.Controls.Add($progress)

$status = Add-Label "Ready." 20 415 510 22
$status.ForeColor = [System.Drawing.Color]::Silver

$btnOk = New-Object System.Windows.Forms.Button
$btnOk.Text = "Continue"
$btnOk.Location = New-Object System.Drawing.Point(320, 445)
$btnOk.Size = New-Object System.Drawing.Size(100, 30)
$btnOk.BackColor = [System.Drawing.Color]::FromArgb(0, 122, 204)
$btnOk.ForeColor = [System.Drawing.Color]::White
$btnOk.FlatStyle = "Flat"
$form.Controls.Add($btnOk)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Location = New-Object System.Drawing.Point(430, 445)
$btnCancel.Size = New-Object System.Drawing.Size(90, 30)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$btnOk.Add_Click({
  try {
    $btnOk.Enabled = $false
    $btnCancel.Enabled = $false
    $progress.Visible = $true
    $status.ForeColor = [System.Drawing.Color]::WhiteSmoke

    if ($rbUninstall.Checked) {
      $status.Text = "Uninstalling..."
      $form.Refresh()
      $dir = if ($existing.Found) { $existing.Dir } else { $tbDir.Text.Trim() }
      $r = [System.Windows.Forms.MessageBox]::Show(
        "Remove Premiere Pro MCP completely?`n`nFolder:`n$dir",
        "Confirm uninstall",
        "YesNo",
        "Warning"
      )
      if ($r -ne "Yes") {
        $btnOk.Enabled = $true
        $btnCancel.Enabled = $true
        $progress.Visible = $false
        $status.Text = "Cancelled."
        return
      }
      Invoke-Uninstall $dir
      $progress.Visible = $false
      [System.Windows.Forms.MessageBox]::Show(
        "PPMCP was removed.`n`nIf needed, delete MCP entry from Claude/Cursor config.`n`nCaYaDev | $Site",
        "Uninstall complete",
        "OK",
        "Information"
      )
      $form.Close()
      return
    }

    $dir = $tbDir.Text.Trim()
    if (-not $dir) { throw "Install folder is empty." }

    if ($HasPayload) {
      $status.Text = "Installing / updating files..."
      $form.Refresh()
      Install-FromPayload $dir $cbCep.Checked $cbStartup.Checked
    } else {
      $status.Text = "Installing from repository (npm)..."
      $form.Refresh()
      Install-FromRepo $dir $cbCep.Checked $cbStartup.Checked
      $dir = $RepoRoot
    }

    $progress.Visible = $false
    $status.Text = "Done."
    $guide = Join-Path $env:APPDATA "PPMCP\HOW-TO-USE.txt"
    $msg = @"
Setup finished.

Version: $SetupVersion
Folder:  $dir

Next:
1) Install Adobe UXP Developer Tool if needed:
   https://developer.adobe.com/premiere-pro/uxp/
2) Open the guide (real paths on this PC):
   $guide
3) Load plugin in Premiere -> panel shows Active
4) Add MCP using paths in the guide

CaYaDev | $Site
"@
    [System.Windows.Forms.MessageBox]::Show($msg, "Install complete", "OK", "Information")
    if (Test-Path $guide) { Start-Process "notepad.exe" -ArgumentList "`"$guide`"" }
    $form.Close()
  } catch {
    $progress.Visible = $false
    $btnOk.Enabled = $true
    $btnCancel.Enabled = $true
    $status.Text = "Error."
    [System.Windows.Forms.MessageBox]::Show(
      "Setup failed:`n$($_.Exception.Message)",
      "Error",
      "OK",
      "Error"
    )
  }
})

[void]$form.ShowDialog()
