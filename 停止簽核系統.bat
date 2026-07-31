@echo off
chcp 65001 >nul
title 停止線上簽核系統
echo 正在停止簽核系統（埠 3847）...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3847" ^| findstr "LISTENING"') do (
  echo 結束程序 PID %%a
  taskkill /F /PID %%a >nul 2>&1
)
echo 完成。
timeout /t 2 >nul
