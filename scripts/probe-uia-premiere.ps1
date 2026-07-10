$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$procs = @(Get-Process | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and ($_.ProcessName -match 'Premiere' -or $_.MainWindowTitle -match 'Premiere')
})
if (-not $procs) { Write-Host 'NO PREMIERE'; exit 1 }
$main = $procs | Select-Object -First 1
Write-Host "main=$($main.MainWindowTitle)"
$root = [System.Windows.Automation.AutomationElement]::FromHandle($main.MainWindowHandle)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$list = New-Object System.Collections.Generic.List[object]

function Walk($el, [int]$d) {
  if ($null -eq $el -or $d -gt 25) { return }
  try {
    $n = [string]$el.Current.Name
    $t = [string]$el.Current.ControlType.ProgrammaticName
    $br = $el.Current.BoundingRectangle
    if ($br.Width -ge 250 -and $br.Height -ge 120 -and -not [double]::IsInfinity($br.Width)) {
      if (-not [string]::IsNullOrWhiteSpace($n) -or $br.Width -ge 500) {
        $list.Add([pscustomobject]@{
            D = $d; Name = $n; Type = $t
            W = [int]$br.Width; H = [int]$br.Height
            X = [int]$br.X; Y = [int]$br.Y
          })
      }
    }
  } catch {}
  try {
    $c = $walker.GetFirstChild($el)
    while ($null -ne $c) {
      Walk $c ($d + 1)
      $c = $walker.GetNextSibling($c)
    }
  } catch {}
}
Walk $root 0
Write-Host "count=$($list.Count)"
Write-Host "--- named ---"
$list | Where-Object { $_.Name } | Sort-Object { $_.W * $_.H } -Descending | Select-Object -First 40 |
  Format-Table -AutoSize D, W, H, X, Y, Type, Name
Write-Host "--- large blank ---"
$list | Where-Object { -not $_.Name -and ($_.W * $_.H) -gt 200000 } | Sort-Object { $_.W * $_.H } -Descending | Select-Object -First 15 |
  Format-Table -AutoSize D, W, H, X, Y, Type
