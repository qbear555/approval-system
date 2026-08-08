@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "TZ=Asia/Taipei"
if not exist "data" mkdir "data"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

rem Check if already listening on 8080
netstat -ano | findstr ":3847" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL%==0 exit /b 0

rem Detached start via PowerShell (survives bat exit)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-service.ps1"
exit /b %ERRORLEVEL%
