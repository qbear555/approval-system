#Requires -Version 5.1
<#
.SYNOPSIS
  將簽核系統程式同步到 D:\一鍵安裝包 三個平台。

.DESCRIPTION
  預設來源：C:\Users\TsuMing\Documents\approval-system
  或 -Source 指定（例如已驗證的 NAS 安裝包路徑）。

.EXAMPLE
  .\scripts\sync-oneclick-packages.ps1
  .\scripts\sync-oneclick-packages.ps1 -Source "D:\一鍵安裝包\NAS\ApprovalSystem-NAS-Install"
#>
param(
  [string]$Source = "",
  [string]$OneClickRoot = ""
)

$ErrorActionPreference = "Stop"

function Resolve-OneClickRoot {
  param([string]$Hint)
  if ($Hint -and (Test-Path -LiteralPath $Hint)) { return (Resolve-Path -LiteralPath $Hint).Path }
  $found = Get-ChildItem "D:\" -Directory -ErrorAction SilentlyContinue | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "NAS\ApprovalSystem-NAS-Install\package.json")
  } | Select-Object -First 1
  if (-not $found) { throw "找不到 D:\一鍵安裝包（需含 NAS\ApprovalSystem-NAS-Install）" }
  return $found.FullName
}

if (-not $Source) {
  $Source = "C:\Users\TsuMing\Documents\approval-system"
}
if (-not (Test-Path -LiteralPath (Join-Path $Source "package.json"))) {
  throw "Source 無效（無 package.json）: $Source"
}

$root = Resolve-OneClickRoot $OneClickRoot
$targets = @(
  @{ Name = "NAS"; Path = Join-Path $root "NAS\ApprovalSystem-NAS-Install" },
  @{ Name = "Ubuntu"; Path = Join-Path $root "Ubuntu\ApprovalSystem-Ubuntu-Install" },
  @{ Name = "Windows"; Path = Join-Path $root "Windows\ApprovalSystem-Portable\app" }
)

# 程式層同步項目（不碰 data/）
$dirs = @("server", "public", "fonts", "docs", "seed-workflows")
$files = @(
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "docker-compose.yml",
  "docker-entrypoint.sh",
  ".dockerignore",
  "start-server.js",
  "CHANGELOG.md",
  "README.md"
)

Write-Host "Source: $Source"
Write-Host "OneClick: $root"
Write-Host ""

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t.Path)) {
    Write-Warning "略過不存在目標: $($t.Name) -> $($t.Path)"
    continue
  }
  Write-Host "=== $($t.Name) ==="
  foreach ($d in $dirs) {
    $src = Join-Path $Source $d
    $dst = Join-Path $t.Path $d
    if (-not (Test-Path -LiteralPath $src)) { continue }
    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
    Write-Host "  dir  $d/"
  }
  foreach ($f in $files) {
    $src = Join-Path $Source $f
    $dst = Join-Path $t.Path $f
    if (-not (Test-Path -LiteralPath $src)) { continue }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Write-Host "  file $f"
  }
  # entrypoint LF
  $ep = Join-Path $t.Path "docker-entrypoint.sh"
  if (Test-Path -LiteralPath $ep) {
    $c = [IO.File]::ReadAllText($ep) -replace "`r`n", "`n" -replace "`r", "`n"
    [IO.File]::WriteAllText($ep, $c, (New-Object System.Text.UTF8Encoding $false))
  }

  # 一鍵安裝包禁止含 Email 設定／寄送紀錄
  $mailCfg = Join-Path $t.Path "data\mail-config.json"
  if (Test-Path -LiteralPath $mailCfg) {
    Remove-Item -LiteralPath $mailCfg -Force
    Write-Host "  strip data/mail-config.json"
  }
  $outbox = Join-Path $t.Path "data\mail-outbox"
  if (Test-Path -LiteralPath $outbox) {
    Get-ChildItem -LiteralPath $outbox -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne '.gitkeep' } |
      ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host "  strip mail-outbox/$($_.Name)"
      }
  }
}

# 種子／共用資料路徑一併清理 mail 設定
$extraDataRoots = @(
  (Join-Path $root "Windows\ApprovalSystem-Portable\seed-data\data"),
  (Join-Path $root "Windows\ApprovalSystem-Portable\app\data")
)
Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name -like '_共用*' -or $_.Name -like '*種子*') {
    $extraDataRoots += (Join-Path $_.FullName "data")
  }
}
foreach ($dataRoot in $extraDataRoots) {
  if (-not (Test-Path -LiteralPath $dataRoot)) { continue }
  $mc = Join-Path $dataRoot "mail-config.json"
  if (Test-Path -LiteralPath $mc) {
    Remove-Item -LiteralPath $mc -Force
    Write-Host "strip $mc"
  }
  $ob = Join-Path $dataRoot "mail-outbox"
  if (Test-Path -LiteralPath $ob) {
    Get-ChildItem -LiteralPath $ob -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne '.gitkeep' } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  }
}

$stamp = Get-Date -Format "yyyy-MM-dd"
$ver = (Get-Content (Join-Path $Source "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$logPath = Join-Path $root "同步紀錄-$stamp.txt"
$log = @"
同步時間: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
來源: $Source
版本: $ver
目標:
- NAS\ApprovalSystem-NAS-Install
- Ubuntu\ApprovalSystem-Ubuntu-Install
- Windows\ApprovalSystem-Portable\app
內容: server/ public/ fonts/ docs/ seed-workflows/ package*.json Docker 相關檔
注意: 未覆寫各平台 data/；一鍵安裝包不含 Email 設定（無 mail-config.json、無 outbox 信件）
"@
Set-Content -LiteralPath $logPath -Value $log -Encoding UTF8
Write-Host ""
Write-Host "Wrote $logPath"
Write-Host "DONE"
