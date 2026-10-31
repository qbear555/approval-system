@echo off
chcp 65001 >nul
title Ollama LAN Proxy (RTX 5080)
cd /d "%~dp0\.."
echo ===================================================
echo   正在啟動 Ollama 區網轉發服務 (0.0.0.0:11434)
echo   將 NAS 正式環境請求轉發至本機 RTX 5080
echo ===================================================
node scripts\ollama-lan-proxy.js
pause
