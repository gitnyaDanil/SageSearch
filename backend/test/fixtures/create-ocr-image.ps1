param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bitmap = [System.Drawing.Bitmap]::new(1000, 360)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = [System.Drawing.Font]::new(
  'Arial',
  52,
  [System.Drawing.FontStyle]::Bold,
  [System.Drawing.GraphicsUnit]::Pixel
)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::Black)

try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.DrawString("SAGESEARCH STORE`nTOTAL RP 48291", $font, $brush, 45, 55)
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $brush.Dispose()
  $font.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
