$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$target = Join-Path $PSScriptRoot '../assets/probe'
[IO.Directory]::CreateDirectory($target) | Out-Null
$bitmap = [Drawing.Bitmap]::new(960, 680)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([Drawing.Color]::White)
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$title = [Drawing.Font]::new('Microsoft YaHei', 30)
$font = [Drawing.Font]::new('Microsoft YaHei', 26)
$small = [Drawing.Font]::new('Microsoft YaHei', 18)
try {
  $graphics.DrawString('合成消费凭证', $title, [Drawing.Brushes]::Black, 70, 45)
  $lines = @('商户：示例食品店', '购买物：燕麦饼干', '实付金额：CNY 37.42', '支付日期：2026-08-19', '状态：支付成功')
  for ($i=0; $i -lt $lines.Count; $i++) { $graphics.DrawString($lines[$i], $font, [Drawing.Brushes]::Black, 70, (145 + $i * 78)) }
  $graphics.DrawString('S09 测试图 / 无真实账户、个人信息或真实交易', $small, [Drawing.Brushes]::Gray, 70, 585)
  $bitmap.Save((Join-Path $target 's09-receipt-v1.png'), [Drawing.Imaging.ImageFormat]::Png)
} finally { $title.Dispose(); $font.Dispose(); $small.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
Get-FileHash (Join-Path $target 's09-receipt-v1.png')
