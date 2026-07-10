#Requires -Version 5.1
# Remove PPMCP startup + local AppData helpers (does not delete the repo).
$ErrorActionPreference = "Continue"
$AppData = $env:APPDATA
$InstallApp = Join-Path $AppData "PPMCP"
$Startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $Startup "PPMCP Bridge.lnk"
$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "PPMCP Bridge.lnk"
$uxp = Join-Path $AppData "Adobe\UXP\Plugins\External\com.ppmcp.plugin"

Write-Host "Uninstalling PPMCP shortcuts / AppData (repo not deleted)..." -ForegroundColor Cyan
Remove-Item $lnk -Force -ErrorAction SilentlyContinue
Remove-Item $desktop -Force -ErrorAction SilentlyContinue
Remove-Item $InstallApp -Recurse -Force -ErrorAction SilentlyContinue
# Only remove if junction/copy we created
if (Test-Path $uxp) {
  cmd /c rmdir "$uxp" 2>$null
  if (Test-Path $uxp) { Remove-Item $uxp -Recurse -Force -ErrorAction SilentlyContinue }
}
$cep = Join-Path $AppData "Adobe\CEP\extensions\com.ppmcp.legacybridge"
Remove-Item $cep -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Done. Remove MCP server entry from Claude/Cursor config manually." -ForegroundColor Green
Write-Host "Developer: CaYaDev | https://cayadev.com"
