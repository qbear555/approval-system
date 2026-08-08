@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3847
set HTTPS_ENABLED=0
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set NODE=node

echo Starting Approval System (local)...
rem Exit code 1 = already listening (skip start); 0 = need start
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c=Get-NetTCPConnection -LocalPort 3847 -State Listen -EA SilentlyContinue; if($c){ Write-Host 'Already running on 3847'; exit 1 } else { exit 0 }"
if errorlevel 1 (
  start "" "http://127.0.0.1:%PORT%/"
  echo Already running: http://127.0.0.1:%PORT%/
  timeout /t 2 >nul
  exit /b 0
)

start "ApprovalLocal" /MIN "%NODE%" "%~dp0start-server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
echo Started: http://127.0.0.1:%PORT%/
timeout /t 2 >nul
