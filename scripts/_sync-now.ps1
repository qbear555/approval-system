#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$src  = 'C:\Users\TsuMing\Documents\approval-system'
$root = 'D:\一鍵安裝包'

if (-not (Test-Path $root)) { Write-Host "找不到 $root"; exit 1 }

$targets = @(
  @{ Name='NAS';     Path="$root\NAS\ApprovalSystem-NAS-Install" },
  @{ Name='Ubuntu';  Path="$root\Ubuntu\ApprovalSystem-Ubuntu-Install" },
  @{ Name='Windows'; Path="$root\Windows\ApprovalSystem-Portable\app" }
)

$dirs  = @('server','public','fonts','docs','seed-workflows')
$files = @('package.json','package-lock.json','Dockerfile','docker-compose.yml',
           'docker-entrypoint.sh','.dockerignore','start-server.js','CHANGELOG.md','README.md')

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t.Path)) {
    Write-Host "略過不存在: $($t.Name) -> $($t.Path)"
    continue
  }
  Write-Host "=== $($t.Name) ==="
  foreach ($d in $dirs) {
    $s  = Join-Path $src $d
    $ds = Join-Path $t.Path $d
    if (-not (Test-Path -LiteralPath $s)) { continue }
    if (Test-Path -LiteralPath $ds) { Remove-Item -LiteralPath $ds -Recurse -Force }
    Copy-Item -LiteralPath $s -Destination $ds -Recurse -Force
    Write-Host "  dir  $d/"
  }
  foreach ($f in $files) {
    $s  = Join-Path $src $f
    $ds = Join-Path $t.Path $f
    if (-not (Test-Path -LiteralPath $s)) { continue }
    Copy-Item -LiteralPath $s -Destination $ds -Force
    Write-Host "  file $f"
  }
  # 清除 mail 密鑰
  $mc = Join-Path $t.Path 'data\mail-config.json'
  if (Test-Path -LiteralPath $mc) { Remove-Item -LiteralPath $mc -Force; Write-Host "  strip data/mail-config.json" }
  # entrypoint LF 換行
  $ep = Join-Path $t.Path 'docker-entrypoint.sh'
  if (Test-Path -LiteralPath $ep) {
    $c = [IO.File]::ReadAllText($ep) -replace "`r`n","`n" -replace "`r","`n"
    [IO.File]::WriteAllText($ep, $c, (New-Object System.Text.UTF8Encoding $false))
  }
}

$stamp   = Get-Date -Format 'yyyy-MM-dd'
$logPath = Join-Path $root "同步紀錄-$stamp-備份目錄設定.txt"
$ver     = (Get-Content (Join-Path $src 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$log = @"
同步時間: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
來源: $src
版本: $ver
功能: admin 可設定備份目錄（backupDir）
目標: NAS / Ubuntu / Windows 一鍵安裝包
"@
Set-Content -LiteralPath $logPath -Value $log -Encoding UTF8
Write-Host ""
Write-Host "同步紀錄: $logPath"
Write-Host "DONE"
