@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   NAS 一鍵更新（從 Windows 部署到 NAS）
echo   - 只更新程式，保留 NAS 上 data/
echo   - 不覆寫 Email（mail-config.json）
echo   - 需要：Node.js、SSH、NAS 帳密
echo ========================================
echo.

set "PKG=%~dp0ApprovalSystem-NAS-Install"
if not exist "%PKG%\package.json" (
  echo [ERR] 找不到 %PKG%
  pause
  exit /b 1
)

set "REPO=%USERPROFILE%\Documents\approval-system"
if not exist "%REPO%\scripts\deploy-nas-package.js" (
  echo [ERR] 找不到部署腳本：%REPO%\scripts\deploy-nas-package.js
  echo       請確認開發專案路徑，或改用 NAS 本機 update.sh
  pause
  exit /b 1
)

set "NAS_HOST=192.168.99.220"
set "NAS_USER=tsuming"
set /p NAS_HOST=NAS IP [%NAS_HOST%]: 
if "%NAS_HOST%"=="" set "NAS_HOST=192.168.99.220"
set /p NAS_USER=SSH 帳號 [%NAS_USER%]: 
if "%NAS_USER%"=="" set "NAS_USER=tsuming"
set /p NAS_PASS=SSH 密碼: 
if "%NAS_PASS%"=="" (
  echo 已取消。
  pause
  exit /b 1
)

set "NAS_PKG=%PKG%"
set "NAS_SKIP_DB=1"
echo.
echo 部署中（略過資料庫與 Email 覆寫）...
pushd "%REPO%"
node scripts\deploy-nas-package.js
set "ERR=%ERRORLEVEL%"
popd

set "NAS_PASS="
if not "%ERR%"=="0" (
  echo [ERR] 部署失敗 code=%ERR%
  pause
  exit /b %ERR%
)

echo.
echo ========================================
echo  完成
echo  https://%NAS_HOST%:3848
echo  http://%NAS_HOST%:3847
echo ========================================
pause
endlocal
