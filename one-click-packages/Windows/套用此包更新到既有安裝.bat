@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   將「此新版本」套用到既有 Windows 安裝
echo   （不複製 data、不覆寫 Email）
echo ========================================
echo.
echo  請輸入既有安裝路徑（含 ApprovalSystem-Portable）
echo  例如：C:\Apps\ApprovalSystem-Portable
echo.
set /p TARGET=路徑: 
if "%TARGET%"=="" (
  echo 已取消。
  pause
  exit /b 1
)
if not exist "%TARGET%\app\server" (
  echo [ERR] 目標不像有效安裝：%TARGET%
  pause
  exit /b 1
)

echo.
echo 來源（新版）: %~dp0
echo 目標（既有）: %TARGET%
echo.
set /p CONFIRM=確定更新？(Y/N): 
if /i not "%CONFIRM%"=="Y" (
  echo 已取消。
  pause
  exit /b 0
)

REM 停止目標
if exist "%TARGET%\stop.bat" call "%TARGET%\stop.bat"
timeout /t 2 /nobreak >nul

REM 備份目標 data 關鍵檔
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "BK=%TARGET%\app\data\_update_backup"
if not exist "%BK%" mkdir "%BK%"
if exist "%TARGET%\app\data\approval.db" copy /y "%TARGET%\app\data\approval.db" "%BK%\approval.db.%TS%" >nul
if exist "%TARGET%\app\data\mail-config.json" copy /y "%TARGET%\app\data\mail-config.json" "%BK%\mail-config.json.%TS%" >nul

echo [1/4] 複製 server...
xcopy /E /I /Y "%~dp0app\server\*" "%TARGET%\app\server\" >nul
echo [2/4] 複製 public...
xcopy /E /I /Y "%~dp0app\public\*" "%TARGET%\app\public\" >nul
if exist "%~dp0app\fonts" xcopy /E /I /Y "%~dp0app\fonts\*" "%TARGET%\app\fonts\" >nul
echo [3/4] 複製 package 與啟動檔...
copy /y "%~dp0app\package.json" "%TARGET%\app\package.json" >nul
if exist "%~dp0app\package-lock.json" copy /y "%~dp0app\package-lock.json" "%TARGET%\app\package-lock.json" >nul
if exist "%~dp0app\start-server.js" copy /y "%~dp0app\start-server.js" "%TARGET%\app\start-server.js" >nul
if exist "%~dp0start.bat" copy /y "%~dp0start.bat" "%TARGET%\start.bat" >nul
if exist "%~dp0stop.bat" copy /y "%~dp0stop.bat" "%TARGET%\stop.bat" >nul
if exist "%~dp0update.bat" copy /y "%~dp0update.bat" "%TARGET%\update.bat" >nul

REM 明確不複製：data、mail-config
echo [i] 已略過 app\data（含 Email 與資料庫）

echo [4/4] npm install + 啟動...
if exist "%TARGET%\runtime\node\npm.cmd" (
  pushd "%TARGET%\app"
  call "%TARGET%\runtime\node\npm.cmd" install --omit=dev --no-audit --no-fund
  popd
)
if exist "%TARGET%\start.bat" start "" "%TARGET%\start.bat"

echo.
echo ========================================
echo  已套用更新到：%TARGET%
echo  data 與 Email 未覆寫
echo ========================================
pause
endlocal
