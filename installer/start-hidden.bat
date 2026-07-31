@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "APP_DIR=%~dp0app"
set "NODE_DIR=%~dp0runtime\node"
set "PORT=8080"
if not exist "%APP_DIR%\data" mkdir "%APP_DIR%\data"
if not exist "%APP_DIR%\data\uploads" mkdir "%APP_DIR%\data\uploads"
if not exist "%APP_DIR%\data\backups" mkdir "%APP_DIR%\data\backups"
if exist "%NODE_DIR%\node.exe" (
  set "NODE_EXE=%NODE_DIR%\node.exe"
) else (
  set "NODE_EXE=node"
)
cd /d "%APP_DIR%"
set "PORT=%PORT%"
if exist "start-server.js" (
  "%NODE_EXE%" start-server.js > "%APP_DIR%\data\server.log" 2>&1
) else (
  "%NODE_EXE%" server\index.js > "%APP_DIR%\data\server.log" 2>&1
)
