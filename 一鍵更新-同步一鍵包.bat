@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 一鍵更新 → 同步 D:\一鍵安裝包 三平台...
node scripts\one-click-update.js --packages
pause
