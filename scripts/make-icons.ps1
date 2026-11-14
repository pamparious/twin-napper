Add-Type -AssemblyName System.IO.Compression

function Get-Crc([byte[]]$bytes) {
  $crc = [uint32]4294967295
  foreach ($b in $bytes) {
    $crc = $crc -bxor [uint32]$b
    for ($i = 0; $i -lt 8; $i++) {
      if (($crc -band 1) -ne 0) { $crc = [uint32](($crc -shr 1) -bxor 0xedb88320) }
      else { $crc = [uint32]($crc -shr 1) }
    }
  }
  return [uint32]((-bnot $crc) -band 0xffffffff)
}

function Add-Bytes([System.Collections.Generic.List[byte]]$list, [byte[]]$bytes) {
  foreach ($b in $bytes) { $list.Add($b) }
}

function New-Png([int]$size) {
  $stride = $size * 4 + 1
  $raw = New-Object byte[] ($stride * $size)
  $r2 = ($size * 0.16) * ($size * 0.16)
  for ($y = 0; $y -lt $size; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $size; $x++) {
      $dx1 = $x - ($size * 0.36)
      $dy1 = $y - ($size * 0.56)
      $dx2 = $x - ($size * 0.64)
      $dy2 = $y - ($size * 0.56)
      $p = $row + 1 + ($x * 4)
      if (($dx1 * $dx1 + $dy1 * $dy1) -le $r2) {
        $raw[$p] = 255; $raw[$p + 1] = 255; $raw[$p + 2] = 255
      } elseif (($dx2 * $dx2 + $dy2 * $dy2) -le $r2) {
        $raw[$p] = 255; $raw[$p + 1] = 214; $raw[$p + 2] = 10
      } else {
        $raw[$p] = 10; $raw[$p + 1] = 132; $raw[$p + 2] = 255
      }
      $raw[$p + 3] = 255
    }
  }
  $ms = New-Object System.IO.MemoryStream
  $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  $ds.Write($raw, 0, $raw.Length)
  $ds.Dispose()
  $idat = $ms.ToArray()

  $ihdr = New-Object byte[] 13
  $w = [BitConverter]::GetBytes([int]$size)
  $h = [BitConverter]::GetBytes([int]$size)
  [Array]::Reverse($w)
  [Array]::Reverse($h)
  [Array]::Copy($w, 0, $ihdr, 0, 4)
  [Array]::Copy($h, 0, $ihdr, 4, 4)
  $ihdr[8] = 8
  $ihdr[9] = 6

  $png = New-Object 'System.Collections.Generic.List[byte]'
  Add-Bytes $png ([byte[]](137, 80, 78, 71, 13, 10, 26, 10))
  foreach ($pair in @(@('IHDR', $ihdr), @('IDAT', $idat), @('IEND', [byte[]]@()))) {
    $type = [Text.Encoding]::ASCII.GetBytes([string]$pair[0])
    $data = [byte[]]$pair[1]
    $body = New-Object byte[] ($type.Length + $data.Length)
    [Array]::Copy($type, 0, $body, 0, $type.Length)
    if ($data.Length -gt 0) { [Array]::Copy($data, 0, $body, $type.Length, $data.Length) }
    $len = [BitConverter]::GetBytes([int]$data.Length)
    [Array]::Reverse($len)
    $crc = [BitConverter]::GetBytes([uint32](Get-Crc $body))
    [Array]::Reverse($crc)
    Add-Bytes $png $len
    Add-Bytes $png $body
    Add-Bytes $png $crc
  }
  return $png.ToArray()
}

$root = Split-Path $PSScriptRoot -Parent
if (-not $root) { $root = (Get-Location).Path }
$public = Join-Path $root 'public'
New-Item -ItemType Directory -Force -Path $public | Out-Null
[IO.File]::WriteAllBytes((Join-Path $public 'apple-touch-icon.png'), (New-Png 180))
[IO.File]::WriteAllBytes((Join-Path $public 'icon-192.png'), (New-Png 192))
[IO.File]::WriteAllBytes((Join-Path $public 'icon-512.png'), (New-Png 512))
Get-ChildItem $public -Filter *.png | ForEach-Object { '{0} {1}' -f $_.Name, $_.Length }
