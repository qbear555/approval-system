@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   線上簽核系統 — Windows 一鍵更新
echo   （保留 data：資料庫、Email、上傳檔）
echo ========================================
echo.

if not exist "app\server\index.js" (
  echo [ERR] 請在 ApprovalSystem-Portable 目錄執行本腳本。
  pause
  exit /b 1
)

if not exist "app\data" (
  echo [ERR] 找不到 app\data，請先完成首次安裝（install.bat）。
  pause
  exit /b 1
)

REM 絕不使用安裝包內的 Email 設定覆寫正式環境
if exist "app\data\mail-config.json" (
  echo [OK] 保留現有 Email 設定 app\data\mail-config.json
) else (
  echo [i] 目前尚無 Email 設定（安裝包本來就不含，可於系統設定新增）
)
if exist "mail-config.json" del /f /q "mail-config.json" >nul 2>&1

REM 備份
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "BK=app\data\_update_backup"
if not exist "%BK%" mkdir "%BK%"
if exist "app\data\approval.db" (
  copy /y "app\data\approval.db" "%BK%\approval.db.%TS%" >nul
  echo [OK] 已備份資料庫
)
if exist "app\data\mail-config.json" (
  copy /y "app\data\mail-config.json" "%BK%\mail-config.json.%TS%" >nul
  echo [OK] 已備份 Email 設定
)

echo [1/3] 停止舊程序（若有）...
if exist "stop.bat" call "stop.bat"
timeout /t 2 /nobreak >nul

echo [2/3] 更新 npm 依賴（若 package.json 有變）...
if exist "runtime\node\npm.cmd" (
  pushd "app"
  call "%~dp0runtime\node\npm.cmd" install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [警告] npm install 失敗，請檢查網路後重試。
  ) else (
    echo       依賴完成。
  )
  popd
) else (
  echo [警告] 找不到 runtime\node\npm.cmd
)

echo [3/3] 啟動服務...
start "" "%~dp0start.bat"
timeout /t 3 /nobreak >nul
start http://127.0.0.1:3847

echo.
echo ========================================
echo  更新完成
echo  HTTP : http://127.0.0.1:3847
echo  HTTPS: https://127.0.0.1:8443 （若有憑證）
echo  data\ 與 Email 已保留
echo ========================================
echo.
echo  說明：若您是「下載整包覆蓋安裝」：
echo  1. 先備份舊的 app\data 資料夾
echo  2. 用新版覆蓋程式檔後，確認 app\data 仍是舊資料
echo  3. 再執行本 update.bat
echo ========================================
pause
endlocal
