# Rasterize desktop/build/icon.svg to desktop/build/icon.png. Mirrors
# extension/scripts/generate-icon.ps1 (same visual, larger canvas).
# electron-builder requires the source PNG to be >=256x256 for its
# Windows ICO conversion; we render at 512x512 so multi-resolution
# ICO generation looks crisp at every embedded size.

Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\build\icon.png'
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::White)

# Source SVG coords are 24x24. Scale to fill the canvas the same way
# the SVG's transform does (translate 64,64 + scale 4.4 in a 128x128
# viewBox → factor of 4.4 * (512/128) here).
$scale = 4.4 * ($size / 128.0)
$tx = ($size / 2) - (12 * $scale)
$ty = ($size / 2) - (12 * $scale)

$pen = New-Object System.Drawing.Pen(
  [System.Drawing.ColorTranslator]::FromHtml('#007ACC'),
  [single](1.5 * $scale))
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

function Circle($cx, $cy, $r) {
  $x = $tx + ($cx - $r) * $scale
  $y = $ty + ($cy - $r) * $scale
  $d = 2 * $r * $scale
  $g.DrawEllipse($pen, [single]$x, [single]$y, [single]$d, [single]$d)
}

function Line($x1, $y1, $x2, $y2) {
  $g.DrawLine($pen,
    [single]($tx + $x1 * $scale), [single]($ty + $y1 * $scale),
    [single]($tx + $x2 * $scale), [single]($ty + $y2 * $scale))
}

# Mirror of build/icon.svg
Circle 12 6 2.5
Circle 6 14 2
Circle 12 14 2
Circle 18 14 2
Line 12 8.5 12 12
Line 12 12 6 12.5
Line 12 12 18 12.5
Circle 18 20 1.5
Line 18 16 18 18.5

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$pen.Dispose()
Write-Host "Wrote $out ($size x $size)"
