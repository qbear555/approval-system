#Requires -Version 5.1
# Start approval system as fully independent process (survives parent shell exit)
$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Port = 8080
$Node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source } else { Write-Error 'Node.js not found'; exit 1 }
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "Already listening on $Port (PID $($listening[0].OwningProcess))"
  exit 0
}

$serverJs = Join-Path $Root 'start-server.js'
if (-not (Test-Path $serverJs)) {
  Write-Error "Missing start-server.js in $Root"
  exit 1
}

$dataDir = Join-Path $Root 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# Prefer WMI Create so process is not tied to this shell's job object
$cmdLine = '"' + $Node + '" "' + $serverJs + '"'
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine     = $cmdLine
  CurrentDirectory = $Root
}
if ($result.ReturnValue -ne 0) {
  # Fallback
  $p = Start-Process -FilePath $Node -ArgumentList 'start-server.js' -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  $pid = $p.Id
} else {
  $pid = $result.ProcessId
}

Start-Sleep -Seconds 2
$ok = $false
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
  if ($r.StatusCode -eq 200) { $ok = $true }
} catch { $ok = $false }

if ($ok) {
  Write-Host "Started PID=$pid  http://127.0.0.1:$Port/"
  exit 0
}

Write-Host "Start may have failed. PID=$pid"
exit 1
