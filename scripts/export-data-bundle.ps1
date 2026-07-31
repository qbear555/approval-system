# 打包 data 目錄，供搬到 Ubuntu / NAS
# 用法：在專案根目錄
#   powershell -ExecutionPolicy Bypass -File scripts\export-data-bundle.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Data = Join-Path $Root 'data'
$OutDir = Join-Path $Root 'dist'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Zip = Join-Path $OutDir "approval-data-$Stamp.zip"

if (-not (Test-Path $Data)) { throw "找不到 data: $Data" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 盡量 checkpoint（若本機有 node + 服務未鎖檔）
try {
  $db = Join-Path $Data 'approval.db'
  if (Test-Path $db) {
    node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close();" $db 2>$null
  }
} catch { Write-Host "checkpoint 略過（可手動停止服務後再打包）" }

if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path (Join-Path $Data '*') -DestinationPath $Zip -Force
$mb = [math]::Round((Get-Item $Zip).Length / 1MB, 2)
Write-Host "OK: $Zip ($mb MB)"
Write-Host "請上傳到 Ubuntu 後解壓至 /opt/approval-system/data/"
