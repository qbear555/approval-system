#Requires -Version 5.1
<#
.SYNOPSIS
  在本機 PowerShell 重建 NAS 上的簽核系統容器（套用已上傳的新程式）。

.DESCRIPTION
  SSH 連線使用金鑰（免密碼）；NAS 的 sudo 密碼由你當場輸入，
  以 SecureString 讀取、只透過 stdin 餵給遠端 sudo -S，不寫入檔案、不留在指令歷史。

  為什麼需要 --build：
    Dockerfile 用 COPY server ./server 把程式打進映像，
    單純 docker restart 會繼續跑舊程式，必須重建映像。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\nas-rebuild.ps1
  powershell -ExecutionPolicy Bypass -File scripts\nas-rebuild.ps1 -NasHost 192.168.99.220 -NasUser tsuming
#>
param(
  [string]$NasHost = '192.168.99.220',
  [string]$NasUser = 'tsuming',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519_nas",
  [string]$RemoteDir = '/volume1/docker/approval-system'
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  線上簽核系統 — NAS 容器重建' -ForegroundColor Cyan
Write-Host "  目標：${NasUser}@${NasHost}:${RemoteDir}" -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $KeyPath)) {
  Write-Host "[ERR] 找不到 SSH 金鑰：$KeyPath" -ForegroundColor Red
  exit 1
}

$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', $KeyPath, "$NasUser@$NasHost")

Write-Host '[1/4] 測試 SSH 金鑰連線...' -ForegroundColor Yellow
$probe = & ssh @sshArgs 'echo SSH_OK' 2>&1
if ($probe -notmatch 'SSH_OK') {
  Write-Host '[ERR] SSH 連線失敗：' -ForegroundColor Red
  $probe | ForEach-Object { Write-Host "      $_" }
  exit 1
}
Write-Host '      連線正常（金鑰認證，未使用密碼）' -ForegroundColor DarkGray

Write-Host '[2/4] 確認待部署的程式已在 NAS 上...' -ForegroundColor Yellow
$check = & ssh @sshArgs "grep -c 'function drawApproverComments' $RemoteDir/server/pdf.js 2>/dev/null || echo 0" 2>&1
if ("$check".Trim() -eq '0') {
  Write-Host '[ERR] NAS 上的 server/pdf.js 還是舊版，請先完成程式上傳。' -ForegroundColor Red
  exit 1
}
Write-Host '      新版 pdf.js 已就位' -ForegroundColor DarkGray

Write-Host ''
Write-Host '[3/4] 重建容器（需要 NAS 的 sudo 密碼）' -ForegroundColor Yellow
Write-Host '      密碼只會傳給 NAS 的 sudo，不會顯示、不會存檔。' -ForegroundColor DarkGray
$sec = Read-Host "      $NasUser 的密碼" -AsSecureString
if (-not $sec -or $sec.Length -eq 0) {
  Write-Host '已取消。' -ForegroundColor Yellow
  exit 0
}

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  $remoteCmd = "cd '$RemoteDir' && sudo -S -p '' env PATH=/usr/local/bin:/usr/bin:/bin docker compose up -d --build 2>&1"
  Write-Host '      建置中，首次可能需要數分鐘...' -ForegroundColor DarkGray
  $out = $plain | & ssh @sshArgs $remoteCmd 2>&1
  $code = $LASTEXITCODE
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable plain -ErrorAction SilentlyContinue
}

$out | Select-Object -Last 25 | ForEach-Object { Write-Host "      $_" }

if ("$out" -match 'incorrect password|Sorry, try again') {
  Write-Host ''
  Write-Host '[ERR] sudo 密碼不正確，容器未重建。' -ForegroundColor Red
  exit 1
}
if ($code -ne 0) {
  Write-Host ''
  Write-Host "[ERR] 重建失敗（exit $code），容器可能仍在跑舊版。" -ForegroundColor Red
  exit $code
}

Write-Host ''
Write-Host '[4/4] 驗證服務...' -ForegroundColor Yellow
Start-Sleep -Seconds 6
$verify = & ssh @sshArgs "curl -s -o /dev/null -w 'HTTP 3847 -> %{http_code}\n' http://127.0.0.1:3847/api/departments; curl -sk -o /dev/null -w 'HTTPS 3848 -> %{http_code}\n' https://127.0.0.1:3848/api/departments" 2>&1
$verify | ForEach-Object { Write-Host "      $_" }
$verJson = & ssh @sshArgs 'curl -s http://127.0.0.1:3847/api/system/version' 2>&1
try {
  $ver = ("$verJson" | ConvertFrom-Json).labelFull
  if ($ver) { Write-Host "      版本 $ver" }
} catch {
  Write-Host '      （版本查詢失敗，可忽略）' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  [OK] NAS 容器已重建完成' -ForegroundColor Green
Write-Host '  data/ 與 Email 設定保留未動' -ForegroundColor Green
Write-Host "  網址：http://$NasHost`:3847  或  https://$NasHost`:3848" -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host '  如需回滾：'
Write-Host "    ssh -i `"$KeyPath`" $NasUser@$NasHost"
Write-Host "    cd $RemoteDir && cp -a .code-backup/pre-20260813-191722/server ./ && cp -a .code-backup/pre-20260813-191722/public ./"
Write-Host '    再重跑本腳本'
