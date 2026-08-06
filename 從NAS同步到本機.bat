@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ========================================
echo    NAS → 本機 → 一鍵安裝包  同步
echo    來源: 192.168.99.220
echo  ========================================
echo.

if "%NAS_PASS%"=="" set /p NAS_PASS=請輸入 NAS SSH 密碼: 
if "%NAS_PASS%"=="" (
  echo [ERR] 未輸入密碼，已取消。
  pause
  exit /b 1
)

echo.
echo [1/3] 從 NAS 拉取程式碼到本機...
node scripts\pull-nas-code.js
if errorlevel 1 (
  echo [ERR] 從 NAS 拉取程式碼失敗
  set NAS_PASS=
  pause
  exit /b 1
)

echo.
echo [2/3] 重啟本機簽核系統...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($p in 8080,3847,8443,3848) { Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }" >nul 2>&1
timeout /t 2 /nobreak >nul
start "" /b wscript "%~dp0start-always.vbs"
echo 本機服務已重啟（背景執行）

echo.
echo [3/3] 同步到一鍵安裝包三平台...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sync-oneclick-packages.ps1"
if errorlevel 1 (
  echo [WARN] 一鍵安裝包同步失敗（D:\一鍵安裝包 可能不存在，略過）
) else (
  echo 一鍵安裝包同步完成
)

set NAS_PASS=
echo.
echo  ========================================
echo    ✅ 同步完成！
echo    本機: http://127.0.0.1:8080/
echo    NAS:  https://192.168.99.220:3848/
echo  ========================================
echo.
pause
