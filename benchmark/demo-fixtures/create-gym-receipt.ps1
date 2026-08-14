param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bitmap = [System.Drawing.Bitmap]::new(1200, 1800)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$titleFont = [System.Drawing.Font]::new(
  'Arial', 82, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel
)
$bodyFont = [System.Drawing.Font]::new(
  'Arial', 58, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel
)
$totalFont = [System.Drawing.Font]::new(
  'Arial', 76, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel
)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::Black)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 4)

try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.DrawRectangle($pen, 45, 45, 1110, 1710)
  $graphics.DrawString('FITNESS CENTER', $titleFont, $brush, 135, 130)
  $graphics.DrawString('MEMBERSHIP RECEIPT', $bodyFont, $brush, 190, 285)
  $graphics.DrawLine($pen, 105, 420, 1095, 420)
  $graphics.DrawString('Member: DEMO USER', $bodyFont, $brush, 115, 520)
  $graphics.DrawString('Plan: MONTHLY GYM', $bodyFont, $brush, 115, 650)
  $graphics.DrawString('Date: 12 Maret 2026', $bodyFont, $brush, 115, 780)
  $graphics.DrawString('Payment: CASH', $bodyFont, $brush, 115, 910)
  $graphics.DrawLine($pen, 105, 1080, 1095, 1080)
  $graphics.DrawString('TOTAL Rp 200.000', $totalFont, $brush, 155, 1190)
  $graphics.DrawLine($pen, 105, 1390, 1095, 1390)
  $graphics.DrawString('THANK YOU', $bodyFont, $brush, 410, 1500)
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $pen.Dispose()
  $brush.Dispose()
  $totalFont.Dispose()
  $bodyFont.Dispose()
  $titleFont.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
