#Requires -Version 5.1
# Removes %APPDATA%\PPMCP helpers, shortcuts, UXP junction (used by Setup uninstall)
$ErrorActionPreference = "Continue"
$AppData = $env:APPDATA
$Helper = Join-Path $AppData "PPMCP"
$Startup = [Environment]::GetFolderPath("Startup")
$Desktop = [Environment]::GetFolderPath("Desktop")

# Stop bridge if still running
try {
  Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*PPMCP*" } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {}

Remove-Item (Join-Path $Startup "PPMCP Bridge.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Desktop "PPMCP Bridge.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item $Helper -Recurse -Force -ErrorAction SilentlyContinue

$uxp = Join-Path $AppData "Adobe\UXP\Plugins\External\com.ppmcp.plugin"
if (Test-Path $uxp) {
  cmd /c "rmdir `"$uxp`"" 2>$null
  Remove-Item $uxp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "PPMCP helper files removed. Remove MCP entry from Claude/Cursor config manually if needed."
Write-Host "CaYaDev | https://cayadev.com"
