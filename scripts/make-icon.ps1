# Renders the LoL Scoreboard crest (dark rounded square, gold hexagon,
# crossed swords) at multiple sizes: assets/icon-*.png + public/icon.png
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function New-Crest([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 256.0   # design coordinates are 256-based

  # rounded-square background with vertical gradient
  $r = 44 * $s
  $rect = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w = $size - 1
  $rect.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
  $rect.AddArc($w - 2*$r, 0, 2*$r, 2*$r, 270, 90)
  $rect.AddArc($w - 2*$r, $w - 2*$r, 2*$r, 2*$r, 0, 90)
  $rect.AddArc(0, $w - 2*$r, 2*$r, 2*$r, 90, 90)
  $rect.CloseFigure()
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 24, 30, 40), [System.Drawing.Color]::FromArgb(255, 9, 12, 16))
  $g.FillPath($bg, $rect)

  # gold hexagon (pointy-top)
  $gold = [System.Drawing.Color]::FromArgb(255, 200, 170, 110)
  $cx = $size / 2.0; $cy = $size / 2.0; $hr = 100 * $s
  $hex = [System.Drawing.PointF[]]::new(6)
  for ($i = 0; $i -lt 6; $i++) {
    $a = [Math]::PI / 180 * (60 * $i - 90)
    $hex[$i] = New-Object System.Drawing.PointF(($cx + $hr * [Math]::Cos($a)), ($cy + $hr * [Math]::Sin($a)))
  }
  $pen = New-Object System.Drawing.Pen($gold, [Math]::Max(1.5, 9 * $s))
  $pen.LineJoin = 'Round'
  $g.DrawPolygon($pen, $hex)

  # crossed swords
  $blade = [System.Drawing.Color]::FromArgb(255, 240, 230, 210)
  $bladeBrush = New-Object System.Drawing.SolidBrush($blade)
  $goldBrush = New-Object System.Drawing.SolidBrush($gold)
  foreach ($angle in @(-45, 45)) {
    $g.ResetTransform()
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform($angle)
    $g.ScaleTransform($s, $s)
    # blade with tip (design units, origin at crest center)
    $pts = [System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF(-9, 52)), (New-Object System.Drawing.PointF(-9, -52)),
      (New-Object System.Drawing.PointF(0, -80)), (New-Object System.Drawing.PointF(9, -52)),
      (New-Object System.Drawing.PointF(9, 52)))
    $g.FillPolygon($bladeBrush, $pts)
    $g.FillRectangle($goldBrush, -26, 50, 52, 11)   # crossguard
    $g.FillRectangle($goldBrush, -5.5, 61, 11, 24)  # grip
    $g.FillEllipse($goldBrush, -9, 84, 18, 18)      # pommel
  }
  $g.ResetTransform()
  $g.Dispose()
  return $bmp
}

foreach ($sz in 16, 24, 32, 48, 64, 128, 256) {
  $bmp = New-Crest $sz
  $bmp.Save((Join-Path $assets "icon-$sz.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$panel = New-Crest 256
$panel.Save((Join-Path $root 'public\icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$panel.Dispose()
Write-Host "icons rendered -> assets/, public/icon.png"
