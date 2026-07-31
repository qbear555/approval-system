#Requires -Version 5.1
# 建立「線上簽核」本機啟用／停用／控制台 桌面捷徑
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function New-Shortcut {
  param(
    [string]$LnkPath,
    [string]$Target,
    [string]$Arguments = $null,
    [string]$WorkDir,
    [string]$Description
  )
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($LnkPath)
  $sc.TargetPath = $Target
  if ($Arguments) { $sc.Arguments = $Arguments }
  $sc.WorkingDirectory = $WorkDir
  $sc.Description = $Description
  $sc.Save()
  Write-Host "OK $LnkPath"
}

$desks = @(
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
  'F:\TsuMing\Desktop'
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$consoleBat = Join-Path $Root 'local-server-control.bat'
$startBat = Join-Path $Root 'local-server-start.bat'
$stopBat = Join-Path $Root 'local-server-stop.bat'

# 若英文 bat 不存在，退回中文 bat
if (-not (Test-Path $consoleBat)) { $consoleBat = Join-Path $Root '本機簽核系統-控制台.bat' }
if (-not (Test-Path $startBat)) { $startBat = Join-Path $Root '本機簽核系統-啟用.bat' }
if (-not (Test-Path $stopBat)) { $stopBat = Join-Path $Root '本機簽核系統-停用.bat' }

foreach ($desk in $desks) {
  # 中文檔名
  New-Shortcut (Join-Path $desk '線上簽核-本機控制台.lnk') $consoleBat $null $Root '啟用／停用本機簽核 Server'
  New-Shortcut (Join-Path $desk '線上簽核-本機啟用.lnk') $startBat $null $Root '啟動本機簽核 http://127.0.0.1:8080'
  New-Shortcut (Join-Path $desk '線上簽核-本機停用.lnk') $stopBat $null $Root '停止本機簽核 Server'
  # 英文檔名（相容）
  New-Shortcut (Join-Path $desk 'Approval-Local-Console.lnk') $consoleBat $null $Root 'Approval Local Console'
  New-Shortcut (Join-Path $desk 'Approval-Local-Start.lnk') $startBat $null $Root 'Start local Approval System'
  New-Shortcut (Join-Path $desk 'Approval-Local-Stop.lnk') $stopBat $null $Root 'Stop local Approval System'
}

Write-Host ''
Write-Host '桌面捷徑已建立：'
Write-Host '  · 線上簽核-本機控制台  /  Approval-Local-Console'
Write-Host '  · 線上簽核-本機啟用    /  Approval-Local-Start'
Write-Host '  · 線上簽核-本機停用    /  Approval-Local-Stop'
Write-Host "目錄: $Root"
Write-Host '網址: http://127.0.0.1:8080/'
