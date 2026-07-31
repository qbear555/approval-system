#Requires -Version 5.1
$ErrorActionPreference = 'Continue'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$launchJs = Join-Path $proj 'start-server.js'
$taskName = 'ApprovalSystemServer'

# free ports
foreach ($port in 3847, 8080) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1

# remove old task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$launchJs`"" -WorkingDirectory $proj
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null

# Also create logon trigger so it auto-starts
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Set-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Principal $principal -Settings $settings | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 4

Write-Host "Task:" (Get-ScheduledTask -TaskName $taskName).State
Write-Host "Ports:"
netstat -ano | findstr "LISTENING" | findstr ":8080"
try {
  $r = Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 5
  Write-Host "HTTP OK" $r.StatusCode
} catch {
  Write-Host "HTTP FAIL" $_.Exception.Message
  # fallback: direct start
  Start-Process -FilePath $node -ArgumentList "`"$launchJs`"" -WorkingDirectory $proj -WindowStyle Minimized
  Start-Sleep -Seconds 3
  try {
    $r2 = Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 5
    Write-Host "HTTP OK after fallback" $r2.StatusCode
  } catch {
    Write-Host "STILL FAIL" $_.Exception.Message
  }
}
