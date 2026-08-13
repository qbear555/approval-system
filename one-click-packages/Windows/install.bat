@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   線上簽核系統 — Windows 一鍵安裝
echo ========================================
echo.
echo  完整步驟請見：安裝說明.md（上層 Windows 資料夾）
echo.

if not exist "app\data" mkdir "app\data"
if not exist "app\data\uploads" mkdir "app\data\uploads"
if not exist "app\data\backups" mkdir "app\data\backups"
if not exist "app\data\certs" mkdir "app\data\certs"

if not exist "app\data\approval.db" (
  if exist "seed-data\data\approval.db" (
    echo [1/3] 還原種子資料庫...
    xcopy /E /I /Y "seed-data\data\*" "app\data\" >nul
  ) else (
    echo [1/3] 使用現有或空的 data 目錄
  )
) else (
  echo [1/3] 已有資料庫，略過種子還原
)

echo [2/3] 檢查 PDF 數位簽章套件...
if not exist "app\node_modules\@signpdf\signpdf" (
  echo       正在安裝 npm 依賴（含 @signpdf，首次可能需數分鐘）...
  pushd "app"
  call "%~dp0runtime\node\npm.cmd" install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [警告] npm install 失敗。系統仍可啟動，但 PDF 數位簽章可能無法使用。
    echo         請見 安裝說明.md 第四節手動安裝。
  ) else (
    echo       依賴安裝完成。
  )
  popd
) else (
  echo       簽章套件已存在，略過。
)

echo [3/3] 正在啟動（埠 3847）...
start "" "%~dp0start.bat"
timeout /t 3 >nul
start http://127.0.0.1:3847
echo.
echo ========================================
echo  完成
echo  網址：http://127.0.0.1:3847
echo  全新庫帳號：Admin
echo  密碼見 app\data\.admin-bootstrap.txt
echo  說明：..\安裝說明.md
echo ========================================
pause