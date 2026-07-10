$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class H {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int cb);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Right,B; }
  public static string T(IntPtr h){ var s=new StringBuilder(512); GetWindowText(h,s,512); return s.ToString(); }
  public static string C(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
  public static R Bounds(IntPtr h){
    R r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(R)))==0 && r.Right>r.L && r.B>r.T) return r;
    GetWindowRect(h, out r); return r;
  }
}
"@
$procs = @(Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and ($_.ProcessName -match 'Premiere' -or $_.MainWindowTitle -match 'Premiere') })
$main = $procs | Select-Object -First 1
$ppid = [uint32]$main.Id
$mainR = [H]::Bounds($main.MainWindowHandle)
Write-Host "MAIN pid=$ppid title=$($main.MainWindowTitle)"
Write-Host "MAIN rect L=$($mainR.L) T=$($mainR.T) R=$($mainR.Right) B=$($mainR.B) = $($mainR.Right-$mainR.L)x$($mainR.B-$mainR.T)"

$list = New-Object System.Collections.Generic.List[object]
function AddH([IntPtr]$h, [string]$src) {
  if (-not [H]::IsWindowVisible($h)) { return }
  $r = [H]::Bounds($h)
  $w = $r.Right - $r.L; $hh = $r.B - $r.T
  if ($w -lt 200 -or $hh -lt 100) { return }
  # Only on-screen-ish (not huge negative virtual)
  if ($r.L -lt -5000 -or $r.T -lt -5000) { return }
  $list.Add([pscustomobject]@{
      Src=$src; Title=[H]::T($h); Class=[H]::C($h)
      W=$w; H=$hh; L=$r.L; T=$r.T; R=$r.Right; B=$r.B
      Area=($w*$hh)
    })
}
$enumTop = [H+EnumProc]{
  param([IntPtr]$h,[IntPtr]$lp)
  $p=0; [void][H]::GetWindowThreadProcessId($h,[ref]$p)
  if ($p -ne $ppid) { return $true }
  AddH $h 'top'
  $ch = [H+EnumProc]{
    param([IntPtr]$c,[IntPtr]$l2)
    AddH $c 'child'
    return $true
  }
  [void][H]::EnumChildWindows($h, $ch, [IntPtr]::Zero)
  return $true
}
[void][H]::EnumWindows($enumTop, [IntPtr]::Zero)
Write-Host "count=$($list.Count)"
$list | Sort-Object Area -Descending | Select-Object -First 30 |
  Format-Table -AutoSize Src,W,H,L,T,R,B,Class,Title
