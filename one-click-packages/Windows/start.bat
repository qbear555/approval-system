@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3847
set HTTPS_PORT=8443
set HTTPS_ENABLED=0
set NODE_ENV=production
if not exist "app\data" mkdir "app\data"
if not exist "app\data\uploads" mkdir "app\data\uploads"
if not exist "app\data\backups" mkdir "app\data\backups"
if not exist "app\data\certs" mkdir "app\data\certs"
if not exist "app\data\mail-outbox" mkdir "app\data\mail-outbox"

REM 若有 openssl 且尚無憑證，自動產生自簽憑證（HTTPS 8443）
where openssl >nul 2>&1
if %ERRORLEVEL%==0 (
  if not exist "app\data\certs\cert.pem" (
    echo  [HTTPS] 產生自簽憑證...
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -keyout "app\data\certs\key.pem" -out "app\data\certs\cert.pem" -days 3650 -subj "/CN=localhost/O=Approval System/C=TW" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>nul
  )
)

echo.
echo  線上簽核系統啟動中...
echo  HTTP : http://127.0.0.1:3847
echo  全新庫帳號 Admin，密碼見 app\data\.admin-bootstrap.txt
echo.
"%~dp0runtime\node\node.exe" "%~dp0app\start-server.js"
pause
