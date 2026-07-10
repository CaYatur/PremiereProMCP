# Install PPMCP optional CEP text bridge for Premiere (developer mode).
# Does NOT replace the UXP plugin — only adds Window > PPMCP Text Bridge.
# Requires: PlayerDebugMode enabled for CEP (one-time).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path $Root "cep"
$ExtName = "com.ppmcp.legacybridge"

# CEP extensions folder (user)
$CepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
if (-not (Test-Path $CepRoot)) {
  New-Item -ItemType Directory -Path $CepRoot -Force | Out-Null
}
$Dest = Join-Path $CepRoot $ExtName

Write-Host "Source: $Src"
Write-Host "Dest:   $Dest"

if (Test-Path $Dest) {
  Remove-Item -Recurse -Force $Dest
}
Copy-Item -Recurse -Force $Src $Dest

# Enable CEP debug mode (unsigned extensions) for CSXS 9–11
$csxsVersions = 9..12
foreach ($v in $csxsVersions) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) {
    New-Item -Path $key -Force | Out-Null
  }
  New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
  Write-Host "PlayerDebugMode=1 → CSXS.$v"
}

Write-Host ""
Write-Host "Installed. Next steps:"
Write-Host "  1) Ensure PPMCP bridge is running (ws://127.0.0.1:8265)"
Write-Host "  2) Restart Premiere Pro"
Write-Host "  3) Window → PPMCP Text Bridge (open the panel)"
Write-Host "  4) Status should say Connected"
Write-Host "  5) app_get_connection_status → legacyBridgeConnected: true"
Write-Host ""
Write-Host "Without this panel, text_write still works via PNG fallback."
