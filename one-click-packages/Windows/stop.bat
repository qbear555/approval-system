@echo off
chcp 65001 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo 已嘗試停止 8080 服務
pause
