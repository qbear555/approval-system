@echo off
chcp 65001 >nul
REM 從開發機一鍵更新 NAS（保留 data、不覆寫 Email）
cd /d "%~dp0\.."
set "NAS_HOST=192.168.99.220"
set "NAS_USER=tsuming"
set "NAS_SKIP_DB=1"
for /d %%D in ("D:\*") do (
  if exist "%%D\NAS\ApprovalSystem-NAS-Install\package.json" set "NAS_PKG=%%D\NAS\ApprovalSystem-NAS-Install"
)
if not defined NAS_PKG (
  echo [ERR] 找不到 D:\一鍵安裝包\NAS\ApprovalSystem-NAS-Install
  exit /b 1
)
echo NAS_PKG=%NAS_PKG%
set /p NAS_PASS=NAS SSH 密碼: 
if "%NAS_PASS%"=="" exit /b 1
node scripts\deploy-nas-package.js
set "NAS_PASS="
