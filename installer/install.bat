@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   線上簽核系統 - 一鍵安裝
echo ========================================
echo.

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\ApprovalSystem"
set "PORT=8080"
set "TZ=Asia/Taipei"

echo 安裝位置: %DEST%
echo 服務埠號: %PORT%
echo.

if exist "%DEST%\app\server\index.js" (
  echo 偵測到既有安裝，將更新程式檔（保留 data 資料庫）...
) else (
  echo 正在進行全新安裝...
)

if not exist "%DEST%" mkdir "%DEST%"

REM 先停止舊服務
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($p in 8080,3847) { Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }" >nul 2>&1

REM 複製 runtime / 啟動腳本
xcopy "%SRC%runtime" "%DEST%\runtime\" /E /I /Y /Q >nul
copy /Y "%SRC%start.bat" "%DEST%\" >nul
copy /Y "%SRC%start-hidden.bat" "%DEST%\" >nul
copy /Y "%SRC%start-background.vbs" "%DEST%\" >nul
copy /Y "%SRC%stop.bat" "%DEST%\" >nul
copy /Y "%SRC%uninstall.bat" "%DEST%\" >nul
copy /Y "%SRC%install.bat" "%DEST%\" >nul
if exist "%SRC%README.txt" copy /Y "%SRC%README.txt" "%DEST%\" >nul
if exist "%SRC%README-安裝說明.txt" copy /Y "%SRC%README-安裝說明.txt" "%DEST%\" >nul

REM 複製 app（保留既有 data）
if not exist "%DEST%\app" mkdir "%DEST%\app"
if exist "%DEST%\app\data" (
  set "KEEP_DATA=1"
) else (
  set "KEEP_DATA=0"
)

xcopy "%SRC%app\server" "%DEST%\app\server\" /E /I /Y /Q >nul
xcopy "%SRC%app\public" "%DEST%\app\public\" /E /I /Y /Q >nul
if exist "%SRC%app\node_modules" xcopy "%SRC%app\node_modules" "%DEST%\app\node_modules\" /E /I /Y /Q >nul
copy /Y "%SRC%app\package.json" "%DEST%\app\" >nul
if exist "%SRC%app\package-lock.json" copy /Y "%SRC%app\package-lock.json" "%DEST%\app\" >nul
if exist "%SRC%app\start-server.js" copy /Y "%SRC%app\start-server.js" "%DEST%\app\" >nul

if "!KEEP_DATA!"=="0" (
  echo 正在安裝種子資料（全員帳號 + 簽核申請表單）...
  if exist "%SRC%app\data\approval.db" (
    xcopy "%SRC%app\data" "%DEST%\app\data\" /E /I /Y /Q >nul
  ) else if exist "%SRC%seed-data\data\approval.db" (
    xcopy "%SRC%seed-data\data" "%DEST%\app\data\" /E /I /Y /Q >nul
  ) else (
    if not exist "%DEST%\app\data" mkdir "%DEST%\app\data"
  )
  if not exist "%DEST%\app\data\uploads" mkdir "%DEST%\app\data\uploads"
  if not exist "%DEST%\app\data\backups" mkdir "%DEST%\app\data\backups"
  if exist "%SRC%seed-data\workflows" (
    xcopy "%SRC%seed-data\workflows" "%DEST%\app\data\workflow-templates\" /E /I /Y /Q >nul
  )
  if exist "%SRC%app\data\workflow-templates" (
    xcopy "%SRC%app\data\workflow-templates" "%DEST%\app\data\workflow-templates\" /E /I /Y /Q >nul
  )
)

REM 桌面與開始功能表捷徑
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\線上簽核系統"
if not exist "%STARTMENU%" mkdir "%STARTMENU%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('Desktop'); ^
   $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\線上簽核系統'; ^
   if (-not (Test-Path $menu)) { New-Item -ItemType Directory -Path $menu -Force | Out-Null }; ^
   $pairs = @( ^
     @{ Path = (Join-Path $desktop '線上簽核系統.lnk'); Target = '%DEST%\start-background.vbs' }, ^
     @{ Path = (Join-Path $menu '啟動簽核系統.lnk'); Target = '%DEST%\start-background.vbs' }, ^
     @{ Path = (Join-Path $menu '停止簽核系統.lnk'); Target = '%DEST%\stop.bat' }, ^
     @{ Path = (Join-Path $menu '解除安裝.lnk'); Target = '%DEST%\uninstall.bat' } ^
   ); ^
   foreach ($p in $pairs) { ^
     $s = $ws.CreateShortcut($p.Path); ^
     $s.TargetPath = $p.Target; ^
     $s.WorkingDirectory = '%DEST%'; ^
     $s.Description = '線上簽核系統'; ^
     $s.Save(); ^
   }"

echo.
echo ========================================
echo   安裝完成！
echo ========================================
echo   安裝目錄: %DEST%
echo   使用網址: http://127.0.0.1:%PORT%/
echo   預設帳號: admin
echo   預設密碼: admin123
echo.
echo   資料庫: %DEST%\app\data\approval.db
echo   備份PDF: %DEST%\app\data\backups
echo   附件:   %DEST%\app\data\uploads
echo.
echo   本安裝包含：全員帳號資料 + 5 個簽核申請表單
echo   （全新安裝會自動帶入；更新安裝則保留既有資料庫）
echo.
echo   已建立桌面捷徑「線上簽核系統」
echo   目標電腦不必事先安裝 Node.js
echo ========================================
echo.

set /p STARTNOW=是否立即啟動系統？(Y/N) 
if /I "%STARTNOW%"=="Y" (
  start "" "%DEST%\start-background.vbs"
  echo 已啟動，瀏覽器稍後會開啟。
) else (
  echo 之後可雙擊桌面「線上簽核系統」啟動。
)

echo.
pause
endlocal
