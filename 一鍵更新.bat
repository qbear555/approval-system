@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   線上簽核系統 — 一鍵更新
echo   2026-08-01 功能包
echo   （總覽公告／公布期間／僅檢視／路由
echo    本機控制／PDF 中文簽章）
echo ========================================
echo.
echo  說明文件: docs\一鍵更新-2026-08-01-本次功能.md
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERR] 找不到 Node.js，請先安裝 https://nodejs.org
  pause
  exit /b 1
)

if not exist "scripts\one-click-update.js" (
  echo [ERR] 找不到 scripts\one-click-update.js
  pause
  exit /b 1
)

if /I "%~1"=="" (
  node scripts\one-click-update.js
) else (
  node scripts\one-click-update.js %*
)

set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo [ERR] 結束代碼 %ERR%
  pause
  exit /b %ERR%
)
echo 完成。
pause
endlocal
