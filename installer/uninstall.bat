@echo off
chcp 65001 >nul
setlocal
echo ========================================
echo   線上簽核系統 - 解除安裝
echo ========================================
echo.
set "DEST=%LOCALAPPDATA%\ApprovalSystem"
echo 將移除: %DEST%
echo 注意: 資料庫 data\approval.db 也會一併刪除（請先自行備份）。
echo.
set /p CONFIRM=確定解除安裝？(Y/N) 
if /I not "%CONFIRM%"=="Y" (
  echo 已取消。
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($p in 8080,3847) { Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }"

timeout /t 1 /nobreak >nul

powershell -NoProfile -Command ^
  "$d=[Environment]::GetFolderPath('Desktop'); ^
   $f=Join-Path $d '線上簽核系統.lnk'; if(Test-Path $f){Remove-Item $f -Force}"

if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\線上簽核系統" rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\線上簽核系統"

if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  echo 已移除程式目錄。
) else (
  echo 找不到安裝目錄，可能已移除。
)

echo 解除安裝完成。
pause
endlocal
