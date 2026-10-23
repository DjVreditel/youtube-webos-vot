Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\src\icons'
$variants = @{ 'logo-orange' = '#E8799B'; 'logo-blue' = '#00A8D6'; 'logo-red' = '#E53935'; 'logo-dark' = '#555555' }
foreach ($name in $variants.Keys) {
  $bmp = New-Object System.Drawing.Bitmap 150, 150
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $color = [System.Drawing.ColorTranslator]::FromHtml($variants[$name])
  $brush = New-Object System.Drawing.SolidBrush $color
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $x = 6; $y = 26; $w = 138; $h = 98; $r = 30
  $path.AddArc($x, $y, $r, $r, 180, 90); $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)
  $white = [System.Drawing.Brushes]::White
  $tri = @((New-Object System.Drawing.PointF 38, 52), (New-Object System.Drawing.PointF 38, 98), (New-Object System.Drawing.PointF 78, 75))
  $g.FillPolygon($white, [System.Drawing.PointF[]]$tri)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 7
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawArc($pen, 70, 57, 28, 36, -55, 110)
  $g.DrawArc($pen, 74, 45, 46, 60, -55, 110)
  $bmp.Save("$out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "$name.png"
}
