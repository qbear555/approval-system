@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=8080"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
echo ========================================
echo   線上簽核系統
echo ========================================
echo   位址: http://127.0.0.1:%PORT%/
echo   預設管理員: admin / admin123
echo   按 Ctrl+C 可停止服務
echo ========================================
echo.
start "" "http://127.0.0.1:%PORT%/"
"%NODE%" "%~dp0start-server.js"
