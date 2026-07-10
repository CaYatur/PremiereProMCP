# Capture for QA frames — robust, not fragile PM child hunt.
# Order:
#   1) Full Adobe Premiere Pro main window (default, reliable)
#   2) Full primary desktop if Premiere HWND fails
# Mode=program kept for API compat but uses full Premiere window (PM layout changes too often).
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [ValidateSet('program', 'window')][string]$Mode = 'program'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class H {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, int flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int cb);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Right,B; }
  public static R Bounds(IntPtr h) {
    R r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(R))) == 0
        && r.Right > r.L && r.B > r.T) return r;
    GetWindowRect(h, out r);
    return r;
  }
}
"@

function Save-Bitmap([System.Drawing.Bitmap]$bmp, [string]$path) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $path) { Remove-Item $path -Force }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Capture-Hwnd([IntPtr]$hwnd, [string]$path) {
  if ($hwnd -eq [IntPtr]::Zero) { throw 'null hwnd' }
  if ([H]::IsIconic($hwnd)) { [void][H]::ShowWindow($hwnd, 9) }
  [void][H]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 350

  $r = [H]::Bounds($hwnd)
  $W = $r.Right - $r.L
  $Hgt = $r.B - $r.T
  if ($W -lt 200 -or $Hgt -lt 150) { throw "Premiere window too small: ${W}x${Hgt}" }

  $bmp = New-Object System.Drawing.Bitmap $W, $Hgt
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [H]::PrintWindow($hwnd, $hdc, 2)
  if (-not $ok) { $ok = [H]::PrintWindow($hwnd, $hdc, 0) }
  $g.ReleaseHdc($hdc)
  if (-not $ok) {
    $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $W, $Hgt), [System.Drawing.CopyPixelOperation]::SourceCopy)
  }
  $g.Dispose()
  Save-Bitmap $bmp $path
  $bmp.Dispose()
  return "${W}x${Hgt}@$(($r.L)),$(($r.T)) print=$ok"
}

function Capture-Desktop([string]$path) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $W = $bounds.Width
  $Hgt = $bounds.Height
  $bmp = New-Object System.Drawing.Bitmap $W, $Hgt
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, (New-Object System.Drawing.Size $W, $Hgt), [System.Drawing.CopyPixelOperation]::SourceCopy)
  $g.Dispose()
  Save-Bitmap $bmp $path
  $bmp.Dispose()
  return "${W}x${Hgt}@desktop"
}

# System.Windows.Forms for Screen.PrimaryScreen
Add-Type -AssemblyName System.Windows.Forms

$procs = @(Get-Process | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    $_.ProcessName -match 'Adobe Premiere Pro' -or
    $_.MainWindowTitle -match 'Premiere Pro' -or
    $_.MainWindowTitle -match 'Premiere'
  )
} | Sort-Object {
  # Prefer real Premiere app title
  if ($_.MainWindowTitle -match 'Adobe Premiere') { 0 } else { 1 }
})

$attempts = @()

# ── 1) Full Premiere Pro main window (reliable) ─────────────────────
if ($procs.Count -gt 0) {
  $main = $procs | Select-Object -First 1
  try {
    $sz = Capture-Hwnd $main.MainWindowHandle $OutFile
    Write-Output ("ok via=premiere-main title='" + $main.MainWindowTitle + "' " + $sz)
    exit 0
  } catch {
    $attempts += "premiere-main: $($_.Exception.Message)"
  }
} else {
  $attempts += 'premiere-main: process not found'
}

# ── 2) Full primary desktop ─────────────────────────────────────────
try {
  $sz2 = Capture-Desktop $OutFile
  Write-Output ("ok via=desktop " + $sz2 + " attempts=" + ($attempts -join ' | '))
  exit 0
} catch {
  $attempts += "desktop: $($_.Exception.Message)"
}

throw ("capture failed: " + ($attempts -join ' | '))
