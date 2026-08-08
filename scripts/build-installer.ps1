#Requires -Version 5.1
<#
.SYNOPSIS
  Build one-click deploy package for Approval System (portable Node.js + zip)

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1

.PARAMETER SkipBootCheck
  略過啟動驗證。啟動驗證失敗時建置會中止，此參數可在確知環境問題
  （例如埠被占用）時強制產包，請自行確認可啟動後再發布。
#>
param(
  [switch]$SkipBootCheck
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DistRoot = Join-Path $Root 'dist'
$PkgName = 'ApprovalSystem-Portable'
$OutDir = Join-Path $DistRoot $PkgName
$NodeVersion = 'v22.17.1'
$NodeZipName = "node-$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/$NodeVersion/$NodeZipName"
$CacheDir = Join-Path $Root '.cache'
$NodeZipPath = Join-Path $CacheDir $NodeZipName
# 便攜版對外使用的埠（寫進 README 與說明文件）
$Port = 3847
# 啟動驗證專用的暫時埠。刻意與 $Port 分開：驗證流程會清掉佔用該埠的
# node 行程，若沿用 3847，建置時會把正在跑的開發伺服器一起砍掉。
$VerifyPort = 34700

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Build Approval System Installer' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "Out:  $OutDir"
Write-Host ''

if (Test-Path $OutDir) {
  Remove-Item -Recurse -Force $OutDir
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'runtime') | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null

# --- Copy application source ---
Write-Host '[1/6] Copy app files...' -ForegroundColor Yellow
Copy-Item -Recurse -Force (Join-Path $Root 'server') (Join-Path $OutDir 'app\server')
Copy-Item -Recurse -Force (Join-Path $Root 'public') (Join-Path $OutDir 'app\public')
Copy-Item -Force (Join-Path $Root 'package.json') (Join-Path $OutDir 'app\package.json')
if (Test-Path (Join-Path $Root 'package-lock.json')) {
  Copy-Item -Force (Join-Path $Root 'package-lock.json') (Join-Path $OutDir 'app\package-lock.json')
}
if (Test-Path (Join-Path $Root 'start-server.js')) {
  Copy-Item -Force (Join-Path $Root 'start-server.js') (Join-Path $OutDir 'app\start-server.js')
}

# Remove dev/test scripts from package (keep mail.js, seed.js, pdf.js, backup.js, auth.js, db.js)
$removeScripts = @(
  'test-form.js', 'create-users.js', 'export-accounts.js', 'list-users-quick.js',
  'set-gm.js', 'set-vgm.js', 'setup-approval-levels.js', 'test-wf-delete.js',
  'update-leave-datetime.js', 'update-leave-tw.js', 'remove-agent-from-workflows.js',
  'remove-dept-head-required.js'
)
foreach ($f in $removeScripts) {
  $p = Join-Path $OutDir "app\server\$f"
  if (Test-Path $p) { Remove-Item -Force $p }
}
# Remove accidental temp scripts
Get-ChildItem (Join-Path $OutDir 'app\server') -Filter '_tmp*.js' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data\uploads') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data\backups') | Out-Null
Set-Content -Path (Join-Path $OutDir 'app\data\.gitkeep') -Value '' -Encoding ascii

# --- Copy installer scripts ---
Write-Host '[2/6] Copy installer scripts...' -ForegroundColor Yellow
$installerDir = Join-Path $Root 'installer'
$scriptFiles = @(
  'install.bat',
  'uninstall.bat',
  'start.bat',
  'start-hidden.bat',
  'start-background.vbs',
  'stop.bat'
)
foreach ($f in $scriptFiles) {
  Copy-Item -Force (Join-Path $installerDir $f) (Join-Path $OutDir $f)
}
Copy-Item -Force (Join-Path $installerDir 'install.bat') (Join-Path $OutDir 'Install.bat')
if (Test-Path (Join-Path $installerDir 'README-install.txt')) {
  Copy-Item -Force (Join-Path $installerDir 'README-install.txt') (Join-Path $OutDir 'README.txt')
}

# --- Download portable Node.js ---
Write-Host "[3/6] Portable Node.js $NodeVersion ..." -ForegroundColor Yellow
if (-not (Test-Path $NodeZipPath)) {
  Write-Host "  Downloading $NodeUrl"
  Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath -UseBasicParsing
} else {
  Write-Host "  Cache hit: $NodeZipPath"
}

$extracted = Join-Path $CacheDir "node-$NodeVersion-win-x64"
if (Test-Path $extracted) {
  Remove-Item -Recurse -Force $extracted
}
Expand-Archive -Path $NodeZipPath -DestinationPath $CacheDir -Force
if (-not (Test-Path $extracted)) {
  $extracted = Get-ChildItem $CacheDir -Directory |
    Where-Object { $_.Name -like 'node-v*-win-x64' } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $extracted -or -not (Test-Path $extracted)) {
  throw 'Failed to extract portable Node.js'
}

$runtimeNode = Join-Path $OutDir 'runtime\node'
New-Item -ItemType Directory -Force -Path $runtimeNode | Out-Null
Copy-Item -Force (Join-Path $extracted 'node.exe') (Join-Path $runtimeNode 'node.exe')
foreach ($f in @('npm.cmd', 'npx.cmd', 'nodevars.bat')) {
  $src = Join-Path $extracted $f
  if (Test-Path $src) { Copy-Item -Force $src (Join-Path $runtimeNode $f) }
}
# npm needs its own node_modules
if (Test-Path (Join-Path $extracted 'node_modules')) {
  if (Test-Path (Join-Path $runtimeNode 'node_modules')) {
    Remove-Item -Recurse -Force (Join-Path $runtimeNode 'node_modules')
  }
  Copy-Item -Recurse -Force (Join-Path $extracted 'node_modules') (Join-Path $runtimeNode 'node_modules')
}

# --- npm install production deps ---
Write-Host '[4/6] npm install --omit=dev ...' -ForegroundColor Yellow
$nodeExe = Join-Path $runtimeNode 'node.exe'
$npmCmd = Join-Path $runtimeNode 'npm.cmd'
$appDir = Join-Path $OutDir 'app'
Push-Location $appDir
try {
  $env:Path = "$runtimeNode;" + $env:Path
  if (Test-Path $npmCmd) {
    & $npmCmd install --omit=dev --no-audit --no-fund
  } else {
    npm.cmd install --omit=dev --no-audit --no-fund
  }
  if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
} finally {
  Pop-Location
}

# --- Verify ---
if ($SkipBootCheck) {
  Write-Host '[5/6] Verify boot... 已略過（-SkipBootCheck）' -ForegroundColor Yellow
  Write-Host '  ** 此安裝包未經啟動驗證，發布前請自行確認 **' -ForegroundColor Yellow
} else {
Write-Host '[5/6] Verify boot...' -ForegroundColor Yellow
# 清掉佔用驗證埠的殘留行程。
# 舊寫法對任何佔用者無條件 Stop-Process -Force，若使用者剛好有別的程式
# 在這個埠上（開發伺服器、其他服務），會被建置腳本直接強制砍掉。
# 改為只清理 node，其他程式一律中止建置並要求使用者自行處理。
foreach ($c in @(Get-NetTCPConnection -LocalPort $VerifyPort -State Listen -ErrorAction SilentlyContinue)) {
  $owner = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if (-not $owner) { continue }
  if ($owner.ProcessName -eq 'node') {
    Write-Host ("  清除殘留的 node 行程 PID {0}" -f $owner.Id) -ForegroundColor DarkGray
    Stop-Process -Id $owner.Id -Force -ErrorAction SilentlyContinue
  } else {
    throw ("驗證用連接埠 $VerifyPort 被 {0}（PID {1}）占用，不是建置殘留的 node 行程。" -f $owner.ProcessName, $owner.Id) +
          "建置已中止，未動到該程式。請自行關閉後重試，或加 -SkipBootCheck 略過啟動驗證。"
  }
}
Start-Sleep -Seconds 1

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeExe
$psi.Arguments = 'start-server.js'
$psi.WorkingDirectory = $appDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables['PORT'] = "$VerifyPort"
$proc = [System.Diagnostics.Process]::Start($psi)
try {
  # 輪詢至多 30 秒，而非固定睡 3 秒後單次請求。
  # 剛跑完 npm install（315 個套件）時，防毒即時掃描會拖慢首次啟動，
  # 固定 3 秒常常不夠，導致正常的建置被誤報 API check failed。
  $ok = $false
  $lastErr = ''
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    if ($proc.HasExited) {
      $lastErr = "伺服器行程已結束（exit code $($proc.ExitCode)）"
      break
    }
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$VerifyPort/" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $ok = $true; break }
      $lastErr = "HTTP $($r.StatusCode)"
    } catch {
      $lastErr = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  $sw.Stop()
  if ($ok) {
    Write-Host ('  OK: HTTP 200 （{0:N1} 秒）' -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host '  ****************************************************' -ForegroundColor Red
    Write-Host ('  ** {0} 秒內無法啟動，未通過啟動驗證' -f [int]$sw.Elapsed.TotalSeconds) -ForegroundColor Red
    Write-Host ("  ** 原因：$lastErr") -ForegroundColor Red
    Write-Host '  ****************************************************' -ForegroundColor Red
    Write-Host ''
    # 啟動不了的安裝包沒有發布價值，直接中止，不產生半成品
    throw "啟動驗證失敗（$lastErr）。建置已中止，未產生安裝包。確認要略過請加 -SkipBootCheck 參數。"
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    $proc.Kill()
    $proc.WaitForExit(3000) | Out-Null
  }
  Get-NetTCPConnection -LocalPort $VerifyPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
} # end if (-not $SkipBootCheck)

# Remove artifacts created during verify (empty test DB)
# 啟動驗證會實際跑起服務，deploy-log 會寫入部署歷史與自動修改紀錄。
# 全新安裝不該帶這些紀錄，且它們含建置機器的版本指紋，一併清掉。
Get-ChildItem (Join-Path $appDir 'data') -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -like 'approval.db*' -or $_.Name -like '*.log' -or
    $_.Extension -eq '.pdf' -or
    $_.Name -eq 'deploy-history.json' -or $_.Name -eq '修改紀錄-自動.md' -or
    $_.Name -eq 'version-state.json'
  } |
  Remove-Item -Force -ErrorAction SilentlyContinue
foreach ($f in @('docs\修改紀錄-自動.md', 'docs\修改紀錄.md')) {
  $p = Join-Path $appDir $f
  if (Test-Path $p) { Remove-Item -Force $p -ErrorAction SilentlyContinue }
}

# --- Seed data: all members + 5 workflows ---
Write-Host '[5b/7] Prepare seed data (users + 5 forms)...' -ForegroundColor Yellow
$seedScript = Join-Path $Root 'scripts\prepare-seed-data.js'
& $nodeExe $seedScript
if ($LASTEXITCODE -ne 0) { throw "prepare-seed-data failed: $LASTEXITCODE" }
$seedDir = Join-Path $DistRoot 'seed-data'
if (-not (Test-Path (Join-Path $seedDir 'data\approval.db'))) {
  throw 'Seed DB missing after prepare-seed-data'
}
# Copy seed DB into package app/data (fresh install uses this)
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data\uploads') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'app\data\backups') | Out-Null
Copy-Item -Force (Join-Path $seedDir 'data\approval.db') (Join-Path $OutDir 'app\data\approval.db')
if (Test-Path (Join-Path $seedDir 'workflows')) {
  $wfTpl = Join-Path $OutDir 'app\data\workflow-templates'
  if (Test-Path $wfTpl) { Remove-Item -Recurse -Force $wfTpl }
  Copy-Item -Recurse -Force (Join-Path $seedDir 'workflows') $wfTpl
  # also keep seed-data folder at package root for reinstall / manual restore
  $seedOut = Join-Path $OutDir 'seed-data'
  if (Test-Path $seedOut) { Remove-Item -Recurse -Force $seedOut }
  Copy-Item -Recurse -Force $seedDir $seedOut
}
# 安全性：一鍵安裝包「不得」含帳號密碼清冊。
# 舊版會自動把桌面的「線上簽核系統_帳號密碼.xlsx」複製成「帳號密碼清冊.xlsx」
# 打包進 zip，任何人拿到安裝包即等同取得全體使用者密碼，已移除。
# 若殘留舊建置產物，一併清除。
foreach ($stale in @((Join-Path $OutDir '帳號密碼清冊.xlsx'), (Join-Path $DistRoot '帳號密碼清冊.xlsx'))) {
  if (Test-Path $stale) {
    Remove-Item -Force $stale
    Write-Host "  Removed stale account list: $stale" -ForegroundColor Yellow
  }
}
Write-Host '  Seed data packed into app/data + seed-data' -ForegroundColor Green

# --- Zip ---
Write-Host '[6/7] Zip package...' -ForegroundColor Yellow
$zipPath = Join-Path $DistRoot "$PkgName.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $OutDir,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true
)

# Bootstrap installer (ASCII-safe content)
$bootstrap = Join-Path $DistRoot 'Install-ApprovalSystem.bat'
$bootstrapLines = @(
  '@echo off',
  'chcp 65001 >nul',
  'setlocal',
  'cd /d "%~dp0"',
  "set `"ZIP=%~dp0$PkgName.zip`"",
  'set "TMP=%TEMP%\ApprovalSystem-Setup-%RANDOM%"',
  'if not exist "%ZIP%" (',
  "  echo [ERROR] Missing $PkgName.zip",
  '  pause',
  '  exit /b 1',
  ')',
  'echo Extracting...',
  'if exist "%TMP%" rmdir /s /q "%TMP%"',
  'mkdir "%TMP%"',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''%ZIP%'' -DestinationPath ''%TMP%'' -Force"',
  "set `"PKG=%TMP%\$PkgName`"",
  'if not exist "%PKG%\install.bat" (',
  '  echo [ERROR] install.bat not found after extract',
  '  pause',
  '  exit /b 1',
  ')',
  'call "%PKG%\install.bat"',
  'endlocal'
)
[System.IO.File]::WriteAllLines($bootstrap, $bootstrapLines, [System.Text.UTF8Encoding]::new($true))

$readmeZh = Join-Path $DistRoot 'INSTALL-README.txt'
$readmeLines = @(
  '========================================',
  '  Approval System - One-Click Deploy',
  '  Online Approval System Installer',
  '========================================',
  '',
  '[Install on another PC / Server]',
  '  1. Copy these 2 files to target PC (same folder):',
  '     - Install-ApprovalSystem.bat',
  '     - ApprovalSystem-Portable.zip',
  '  2. Double-click Install-ApprovalSystem.bat',
  '',
  '[After install]',
  '  URL:      http://127.0.0.1:3847/',
  '  Admin:    admin',
  '  Password: admin123',
  '  Folder:   %LOCALAPPDATA%\ApprovalSystem',
  '  Database: %LOCALAPPDATA%\ApprovalSystem\app\data\approval.db',
  '  Backups:  %LOCALAPPDATA%\ApprovalSystem\app\data\backups',
  '  Uploads:  %LOCALAPPDATA%\ApprovalSystem\app\data\uploads',
  '',
  '  Target PC does NOT need Node.js pre-installed.',
  '',
  '[LAN / Server]',
  '  1. Install and start on server',
  '  2. Open firewall TCP 3847',
  '  3. Clients open: http://SERVER-IP:3847/',
  '',
  '[Uninstall]',
  '  Start Menu -> Approval System -> Uninstall',
  '  Backup approval.db first!',
  '========================================'
)
[System.IO.File]::WriteAllLines($readmeZh, $readmeLines, [System.Text.UTF8Encoding]::new($true))

# Chinese install guide (paths built from Unicode escapes for PS encoding safety)
$zhReadmeName = ([string][char]0x5B89) + ([string][char]0x88DD) + ([string][char]0x8AAA) + ([string][char]0x660E) + '.txt'  # 安裝說明.txt
$zhFolderName = ([string][char]0x7DDA) + ([string][char]0x4E0A) + ([string][char]0x7C3D) + ([string][char]0x6838) + ([string][char]0x7CFB) + ([string][char]0x7D71) + '_' + ([string][char]0x5B89) + ([string][char]0x88DD) + ([string][char]0x5305)  # 線上簽核系統_安裝包
$zhInstallBat = ([string][char]0x4E00) + ([string][char]0x9375) + ([string][char]0x5B89) + ([string][char]0x88DD) + '.bat'  # 一鍵安裝.bat
$zhReadmeSrc = Join-Path $Root ('installer\README-' + $zhReadmeName)
if (-not (Test-Path $zhReadmeSrc)) {
  $zhReadmeSrc = Join-Path $Root 'installer\README-install.txt'
}
if (Test-Path $zhReadmeSrc) {
  Copy-Item -Force $zhReadmeSrc (Join-Path $OutDir ('README-' + $zhReadmeName))
  Copy-Item -Force $zhReadmeSrc (Join-Path $DistRoot $zhReadmeName)
}

function Copy-Deliverables([string]$TargetDir) {
  if (-not $TargetDir) { return }
  if (Test-Path $TargetDir) { Remove-Item -Recurse -Force $TargetDir }
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  Copy-Item -Force $zipPath (Join-Path $TargetDir 'ApprovalSystem-Portable.zip')
  Copy-Item -Force $bootstrap (Join-Path $TargetDir 'Install-ApprovalSystem.bat')
  Copy-Item -Force $readmeZh (Join-Path $TargetDir 'INSTALL-README.txt')
  if (Test-Path $zhReadmeSrc) {
    Copy-Item -Force $zhReadmeSrc (Join-Path $TargetDir $zhReadmeName)
  }
  # Unzipped portable folder for USB / offline copy without extracting zip
  $portableCopy = Join-Path $TargetDir 'ApprovalSystem-Portable'
  if (Test-Path $portableCopy) { Remove-Item -Recurse -Force $portableCopy }
  Copy-Item -Recurse -Force $OutDir $portableCopy
  # One-click install from this folder
  Copy-Item -Force (Join-Path $OutDir 'install.bat') (Join-Path $TargetDir $zhInstallBat)
  Write-Host ("  Delivered: " + $TargetDir) -ForegroundColor Cyan
}

Write-Host '[7/7] Copy deliverables...' -ForegroundColor Yellow

# Desktop
$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop -and (Test-Path $desktop)) {
  Copy-Deliverables (Join-Path $desktop 'ApprovalSystem-Installer')
  Copy-Deliverables (Join-Path $desktop $zhFolderName)
}

# D: drive (primary deliverable for portable transfer)
$dTargets = @()
if (Test-Path 'D:\') {
  $dTargets += (Join-Path 'D:\' $zhFolderName)
  $dTargets += 'D:\ApprovalSystem-Installer'
}
foreach ($t in $dTargets) {
  try {
    Copy-Deliverables $t
  } catch {
    Write-Host ("  WARN: failed to copy to " + $t + " : " + $_.Exception.Message) -ForegroundColor Yellow
  }
}

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
$folderMB = [math]::Round(((Get-ChildItem $OutDir -Recurse | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  BUILD COMPLETE' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ("Folder: " + $OutDir + "  (" + $folderMB + " MB)")
Write-Host ("Zip:    " + $zipPath + "  (" + $sizeMB + " MB)")
Write-Host ("Launch: " + $bootstrap)
$dPack = Join-Path 'D:\' $zhFolderName
if (Test-Path $dPack) {
  Write-Host ("D: pack: " + $dPack)
}
Write-Host ''
Write-Host 'Deliver on target PC:'
Write-Host '  - Install-ApprovalSystem.bat + ApprovalSystem-Portable.zip'
Write-Host '  - Or run install.bat inside ApprovalSystem-Portable'
Write-Host '========================================' -ForegroundColor Green
