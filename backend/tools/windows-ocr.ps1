param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ExifOrientationMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ColorManagementMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

function Await-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

if (-not [System.IO.Path]::IsPathRooted($ImagePath)) {
  throw 'OCR requires an absolute image path.'
}
if (-not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
  throw 'The image no longer exists.'
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  throw 'Windows OCR has no installed recognition language. Install a Windows language pack with OCR support.'
}

$file = Await-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRtOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$bitmap = $null

try {
  $decoder = Await-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  if ($decoder.PixelWidth -lt 1 -or $decoder.PixelHeight -lt 1) {
    throw 'The decoded image has invalid dimensions.'
  }
  if ([uint64]$decoder.PixelWidth * [uint64]$decoder.PixelHeight -gt 100000000) {
    throw 'The image exceeds the 100-megapixel safety limit.'
  }

  $transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
  $maxDimension = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $largestDimension = [double][Math]::Max($decoder.PixelWidth, $decoder.PixelHeight)
  if ($largestDimension -gt $maxDimension) {
    $scale = $maxDimension / $largestDimension
    $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $scale))
    $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $scale))
  }

  $bitmapOperation = $decoder.GetSoftwareBitmapAsync(
    [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
    [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
    $transform,
    [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
    [Windows.Graphics.Imaging.ColorManagementMode]::ColorManageToSRgb
  )
  $bitmap = Await-WinRtOperation $bitmapOperation ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await-WinRtOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @($result.Lines | ForEach-Object { $_.Text })

  [pscustomobject]@{
    text = $result.Text
    language = $engine.RecognizerLanguage.LanguageTag
    lines = $lines
    sourceWidth = [uint32]$decoder.PixelWidth
    sourceHeight = [uint32]$decoder.PixelHeight
    engine = 'windows-media-ocr'
  } | ConvertTo-Json -Depth 4 -Compress
}
finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  $stream.Dispose()
}
