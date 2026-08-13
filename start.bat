@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=3847"
set "TZ=Asia/Taipei"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
echo ========================================
echo   線上簽核系統
echo ========================================
echo   位址: http://127.0.0.1:%PORT%/
echo   全新庫帳號: Admin
echo   密碼見 data\.admin-bootstrap.txt
echo   按 Ctrl+C 可停止服務
echo ========================================
echo.
start "" "http://127.0.0.1:%PORT%/"
"%NODE%" "%~dp0start-server.js"
