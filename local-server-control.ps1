#Requires -Version 5.1
<#
.SYNOPSIS
  線上簽核系統 — 本機 Server 啟用／停用控制台
#>
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3847
$Node = $null
foreach ($c in @(
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  'node'
)) {
  if ($c -eq 'node') {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $Node = $cmd.Source; break }
  } elseif (Test-Path $c) { $Node = $c; break }
}

function Get-ListenPids {
  param([int]$PortNum)
  @(Get-NetTCPConnection -LocalPort $PortNum -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-ServerUp {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

function Start-LocalServer {
  if (-not $Node) {
    [System.Windows.Forms.MessageBox]::Show(
      "找不到 Node.js。`n請先安裝 Node.js 22+（https://nodejs.org）",
      '線上簽核系統',
      'OK',
      'Error'
    ) | Out-Null
    return
  }
  $pids = Get-ListenPids -PortNum $Port
  if ($pids.Count -gt 0 -and (Test-ServerUp)) {
    [System.Windows.Forms.MessageBox]::Show(
      "服務已在執行中。`nhttp://127.0.0.1:$Port/",
      '線上簽核系統',
      'OK',
      'Information'
    ) | Out-Null
    return
  }
  $startJs = Join-Path $Root 'start-server.js'
  if (-not (Test-Path $startJs)) {
    [System.Windows.Forms.MessageBox]::Show("找不到 start-server.js`n$Root", '錯誤', 'OK', 'Error') | Out-Null
    return
  }
  $env:PORT = "$Port"
  $env:HTTPS_ENABLED = '0'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Node
  $psi.Arguments = "`"$startJs`""
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $psi.EnvironmentVariables['PORT'] = "$Port"
  $psi.EnvironmentVariables['HTTPS_ENABLED'] = '0'
  # inherit path
  try {
    [void][System.Diagnostics.Process]::Start($psi)
  } catch {
    [System.Windows.Forms.MessageBox]::Show("啟動失敗：$_", '錯誤', 'OK', 'Error') | Out-Null
    return
  }
  # wait ready
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-ServerUp) { $ok = $true; break }
  }
  if ($ok) {
    Start-Process "http://127.0.0.1:$Port/"
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      "已送出啟動指令，但尚未偵測到 http://127.0.0.1:$Port/`n請稍候再按「重新整理狀態」，或查看是否缺套件（npm install）。",
      '線上簽核系統',
      'OK',
      'Warning'
    ) | Out-Null
  }
}

function Stop-LocalServer {
  $ports = @($Port, 8080) # 8080：相容舊本機埠
  $killed = 0
  foreach ($p in $ports) {
    $pids = Get-ListenPids -PortNum $p
    foreach ($id in $pids) {
      try {
        Stop-Process -Id $id -Force -ErrorAction Stop
        $killed++
      } catch {}
    }
  }
  Start-Sleep -Milliseconds 500
  if ($killed -gt 0) {
    [System.Windows.Forms.MessageBox]::Show(
      "已停止本機簽核服務（結束 $killed 個程序）。",
      '線上簽核系統',
      'OK',
      'Information'
    ) | Out-Null
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      '目前沒有偵測到執行中的本機服務。',
      '線上簽核系統',
      'OK',
      'Information'
    ) | Out-Null
  }
}

# ---------- UI ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = '線上簽核系統 — 本機控制台'
$form.Size = New-Object System.Drawing.Size(420, 320)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI', 10)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = '本機簽核 Server'
$lblTitle.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI', 14, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.AutoSize = $true

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = "網址：http://127.0.0.1:$Port/"
$lblUrl.Location = New-Object System.Drawing.Point(22, 52)
$lblUrl.AutoSize = $true
$lblUrl.ForeColor = [System.Drawing.Color]::FromArgb(30, 64, 175)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = '狀態：檢查中…'
$lblStatus.Location = New-Object System.Drawing.Point(22, 82)
$lblStatus.Size = New-Object System.Drawing.Size(360, 28)
$lblStatus.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI', 11, [System.Drawing.FontStyle]::Bold)

$lblPath = New-Object System.Windows.Forms.Label
$lblPath.Text = "目錄：$Root"
$lblPath.Location = New-Object System.Drawing.Point(22, 118)
$lblPath.Size = New-Object System.Drawing.Size(360, 40)
$lblPath.ForeColor = [System.Drawing.Color]::Gray

function Update-StatusUi {
  $up = Test-ServerUp
  $pids = Get-ListenPids -PortNum $Port
  if ($up) {
    $lblStatus.Text = "狀態：● 執行中（埠 $Port）"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
  } elseif ($pids.Count -gt 0) {
    $lblStatus.Text = "狀態：▲ 埠占用但網頁未就緒（PID $($pids -join ',')）"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(180, 83, 9)
  } else {
    $lblStatus.Text = '狀態：○ 已停用'
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
  }
}

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = '啟用（啟動）'
$btnStart.Size = New-Object System.Drawing.Size(160, 40)
$btnStart.Location = New-Object System.Drawing.Point(30, 170)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.FlatStyle = 'Flat'
$btnStart.Add_Click({
  Start-LocalServer
  Update-StatusUi
})

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = '停用（停止）'
$btnStop.Size = New-Object System.Drawing.Size(160, 40)
$btnStop.Location = New-Object System.Drawing.Point(210, 170)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = 'Flat'
$btnStop.Add_Click({
  Stop-LocalServer
  Update-StatusUi
})

$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Text = '開啟瀏覽器'
$btnOpen.Size = New-Object System.Drawing.Size(160, 32)
$btnOpen.Location = New-Object System.Drawing.Point(30, 225)
$btnOpen.Add_Click({ Start-Process "http://127.0.0.1:$Port/" })

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = '重新整理狀態'
$btnRefresh.Size = New-Object System.Drawing.Size(160, 32)
$btnRefresh.Location = New-Object System.Drawing.Point(210, 225)
$btnRefresh.Add_Click({ Update-StatusUi })

$form.Controls.AddRange(@(
  $lblTitle, $lblUrl, $lblStatus, $lblPath,
  $btnStart, $btnStop, $btnOpen, $btnRefresh
))

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Update-StatusUi })
$timer.Start()

Update-StatusUi
[void]$form.ShowDialog()
$timer.Stop()
