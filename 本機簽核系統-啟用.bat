@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=3847"
set "HTTPS_ENABLED=0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo 正在啟用本機簽核系統...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=8080; $c=Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue; if($c){ Write-Host '服務已在執行'; exit 0 }"

start "ApprovalSystemLocal" /MIN "%NODE%" "%~dp0start-server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
echo 已啟動 http://127.0.0.1:%PORT%/
timeout /t 2 >nul
