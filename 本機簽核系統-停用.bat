@echo off
chcp 65001 >nul
echo 正在停用本機簽核系統...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($port in 8080,3847) { ^
     $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; ^
     if ($conns) { ^
       $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; ^
       Write-Host ('已停止埠 ' + $port); ^
     } else { Write-Host ('埠 ' + $port + ' 未在監聽') } ^
   }; Write-Host '完成。'"
timeout /t 2 >nul
