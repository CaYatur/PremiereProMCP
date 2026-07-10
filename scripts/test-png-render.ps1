Add-Type -AssemblyName System.Drawing
$f = Join-Path $env:TEMP "ppmcp-png-test.png"
$bmp = New-Object System.Drawing.Bitmap 640, 360
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Black)
$font = New-Object System.Drawing.Font "Arial", 32
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.DrawString("Hello PNG", $font, $brush, 40, 150)
$bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "ok $f exists=$(Test-Path $f)"
