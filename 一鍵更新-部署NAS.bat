@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 一鍵更新 → 部署 NAS（保留 data）...
echo 請輸入 NAS SSH 密碼（或先 set NAS_PASS=...）
if "%NAS_PASS%"=="" set /p NAS_PASS=NAS SSH 密碼: 
if "%NAS_PASS%"=="" (
  echo 已取消。
  pause
  exit /b 1
)
if "%NAS_HOST%"=="" set "NAS_HOST=192.168.99.220"
if "%NAS_USER%"=="" set "NAS_USER=tsuming"
node scripts\one-click-update.js --nas
set "NAS_PASS="
pause
