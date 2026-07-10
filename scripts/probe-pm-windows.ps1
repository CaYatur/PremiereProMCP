$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  public static string T(IntPtr h){ var s=new StringBuilder(512); GetWindowText(h,s,512); return s.ToString(); }
  public static string C(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
}
"@
$procs = @(Get-Process | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    $_.ProcessName -match 'Premiere' -or $_.MainWindowTitle -match 'Premiere'
  )
})
if (-not $procs) { Write-Host 'NO PREMIERE'; exit 1 }
$ppid = ($procs | Select-Object -First 1).Id
Write-Host "PID=$ppid title=$(($procs|Select-Object -First 1).MainWindowTitle)"
$list = New-Object System.Collections.Generic.List[object]
$enum = [W+EnumProc]{
  param([IntPtr]$h, [IntPtr]$lp)
  $p = 0
  [void][W]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -ne $ppid) { return $true }
  if (-not [W]::IsWindowVisible($h)) { return $true }
  $r = New-Object W+RECT
  [void][W]::GetWindowRect($h, [ref]$r)
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  if ($w -lt 180 -or $hh -lt 100) { return $true }
  $t = [W]::T($h); $c = [W]::C($h)
  $list.Add([pscustomobject]@{ Title=$t; Class=$c; W=$w; H=$hh; L=$r.L; T=$r.T; R=$r.R; B=$r.B; Area=($w*$hh) })
  $ch = [W+EnumProc]{
    param([IntPtr]$x, [IntPtr]$l2)
    if (-not [W]::IsWindowVisible($x)) { return $true }
    $rr = New-Object W+RECT
    [void][W]::GetWindowRect($x, [ref]$rr)
    $cw = $rr.R - $rr.L; $chh = $rr.B - $rr.T
    if ($cw -lt 180 -or $chh -lt 100) { return $true }
    $ct = [W]::T($x); $cc = [W]::C($x)
    $list.Add([pscustomobject]@{ Title=$ct; Class=$cc; W=$cw; H=$chh; L=$rr.L; T=$rr.T; R=$rr.R; B=$rr.B; Area=($cw*$chh) })
    return $true
  }
  [void][W]::EnumChildWindows($h, $ch, [IntPtr]::Zero)
  return $true
}
[void][W]::EnumWindows($enum, [IntPtr]::Zero)
Write-Host "--- Program-ish ---"
$list | Where-Object { $_.Title -match 'Program|Monitor' -or $_.Class -match 'Drover|Monitor' } |
  Sort-Object Area -Descending | Select-Object -First 20 |
  Format-Table -AutoSize W,H,L,T,R,B,Title,Class
Write-Host "--- Largest 15 ---"
$list | Sort-Object Area -Descending | Select-Object -First 15 |
  Format-Table -AutoSize W,H,L,T,R,B,Title,Class
