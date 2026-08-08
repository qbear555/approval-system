@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "APP_DIR=%~dp0app"
set "NODE_DIR=%~dp0runtime\node"
set "DATA_DIR=%APP_DIR%\data"
set "PORT=3847"
set "TZ=Asia/Taipei"

if not exist "%APP_DIR%\server\index.js" (
  echo [錯誤] 找不到應用程式檔案，請先執行 install.bat。
  pause
  exit /b 1
)

if exist "%NODE_DIR%\node.exe" (
  set "NODE_EXE=%NODE_DIR%\node.exe"
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [錯誤] 找不到 Node.js。請重新執行安裝。
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\uploads" mkdir "%DATA_DIR%\uploads"
if not exist "%DATA_DIR%\backups" mkdir "%DATA_DIR%\backups"

echo ========================================
echo   線上簽核系統
echo ========================================
echo   位址: http://127.0.0.1:%PORT%/
echo   預設管理員: admin / admin123
echo   按 Ctrl+C 可停止服務
echo ========================================
echo.

cd /d "%APP_DIR%"
set "PORT=%PORT%"
start "" "http://127.0.0.1:%PORT%/"
if exist "start-server.js" (
  "%NODE_EXE%" start-server.js
) else (
  "%NODE_EXE%" server\index.js
)
endlocal
