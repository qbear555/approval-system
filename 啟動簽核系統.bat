@echo off
chcp 65001 >nul
title 線上簽核系統 - 請勿關閉此視窗
cd /d "%~dp0"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "URL=http://127.0.0.1:8080/"

cls
echo.
echo  ========================================
echo    線上簽核系統
echo  ========================================
echo.
echo   ★ 這個黑色視窗請一直開著（或改用桌面「背景啟動」）
echo   ★ 關掉就會「無法連線」
echo.
echo   網址：%URL%
echo   帳號：admin
echo   密碼：admin123
echo  ========================================
echo.

rem 先停止舊程序（8080 / 3847）
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($p in 8080,3847) { Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }" >nul 2>&1
timeout /t 1 /nobreak >nul

echo 3 秒後開啟瀏覽器...
start /b cmd /c "timeout /t 3 /nobreak >nul & start %URL%"

echo 服務執行中，請勿關閉...
echo.
"%NODE%" "%~dp0start-server.js"

echo.
echo  ========================================
echo   服務已停止 → 網站會無法連線
echo   請再雙擊「啟動簽核系統」或桌面背景啟動捷徑
echo  ========================================
pause
