@echo off
chcp 65001 >nul
echo 正在停止線上簽核系統（埠 3847）...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8080,3847; foreach ($p in $ports) { ^
     $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; ^
     if ($conns) { $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host ('已停止埠 ' + $p) } ^
   }; Write-Host '完成。'"
timeout /t 2 >nul
