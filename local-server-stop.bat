@echo off
chcp 65001 >nul
echo Stopping local Approval System...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach($port in 8080,3847){$c=Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue; if($c){$c|ForEach-Object{Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue}; Write-Host ('Stopped '+$port)}else{Write-Host ('Free '+$port)}}; Write-Host Done."
timeout /t 2 >nul
