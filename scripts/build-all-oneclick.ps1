#Requires -Version 5.1
<#
  建置 Windows / Ubuntu / NAS 一鍵安裝包（含完整種子資料）
  輸出：D:\一鍵安裝包\

  用法（專案根目錄）:
    powershell -ExecutionPolicy Bypass -File scripts\build-all-oneclick.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-all-oneclick.ps1 -SkipNasPull
#>
param(
  [switch]$SkipNasPull,
  [switch]$SkipWindows,
  [switch]$SkipUbuntu,
  [switch]$SkipNas
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DistRoot = Join-Path $Root 'dist'
$SeedDir = Join-Path $DistRoot 'seed-data'
$OutRoot = 'D:\一鍵安裝包'
$NodeVersion = 'v22.17.1'
$NodeZipName = "node-$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/$NodeVersion/$NodeZipName"
$CacheDir = Join-Path $Root '.cache'
$NodeZipPath = Join-Path $CacheDir $NodeZipName
$Stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==== $msg ====" -ForegroundColor Cyan
}

function Ensure-Dir($p) {
  New-Item -ItemType Directory -Force -Path $p | Out-Null
}

function Copy-Tree($src, $dest, $excludeNames = @()) {
  if (-not (Test-Path $src)) { return }
  Ensure-Dir $dest
  Get-ChildItem $src -Force | ForEach-Object {
    if ($excludeNames -contains $_.Name) { return }
    $t = Join-Path $dest $_.Name
    if ($_.PSIsContainer) {
      Copy-Tree $_.FullName $t $excludeNames
    } else {
      Copy-Item -Force $_.FullName $t
    }
  }
}

function Write-Utf8NoBom($path, $text) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($path, $text, $utf8)
}

function Normalize-Sh($dir) {
  Get-ChildItem $dir -Filter '*.sh' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n" -replace "`r", "`n"
    Write-Utf8NoBom $_.FullName $t
  }
}

Set-Location $Root
Ensure-Dir $DistRoot
Ensure-Dir $CacheDir
Ensure-Dir $OutRoot

# ---------- 0) Pull NAS data ----------
if (-not $SkipNasPull) {
  Write-Step '0/5 Pull latest data from NAS'
  $env:NAS_USER = if ($env:NAS_USER) { $env:NAS_USER } else { 'tsuming' }
  $env:NAS_HOST = if ($env:NAS_HOST) { $env:NAS_HOST } else { '192.168.99.220' }
  if (-not $env:NAS_PASS) { throw 'Set NAS_PASS environment variable before running this script' }
  node (Join-Path $Root 'scripts\pull-nas-data.js')
  if ($LASTEXITCODE -ne 0) { throw 'pull-nas-data failed' }
} else {
  Write-Host 'Skip NAS pull' -ForegroundColor Yellow
}

# ---------- 1) Seed ----------
Write-Step '1/5 Prepare seed data'
node (Join-Path $Root 'scripts\prepare-seed-data.js')
if ($LASTEXITCODE -ne 0) { throw 'prepare-seed-data failed' }
if (-not (Test-Path (Join-Path $SeedDir 'data\approval.db'))) {
  throw 'Seed DB missing'
}
$manifest = Get-Content (Join-Path $SeedDir 'SEED-MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ("Seed: users={0} workflows={1} requests={2}" -f $manifest.counts.users, $manifest.counts.workflows, $manifest.counts.requests) -ForegroundColor Green

# ---------- helpers: copy app common ----------
function Copy-AppCore($destApp) {
  Ensure-Dir $destApp
  robocopy (Join-Path $Root 'server') (Join-Path $destApp 'server') /E /XF test-*.js create-users.js list-users-quick.js _tmp*.js /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  robocopy (Join-Path $Root 'public') (Join-Path $destApp 'public') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if (Test-Path (Join-Path $Root 'fonts')) {
    robocopy (Join-Path $Root 'fonts') (Join-Path $destApp 'fonts') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
  Copy-Item -Force (Join-Path $Root 'package.json') $destApp
  if (Test-Path (Join-Path $Root 'package-lock.json')) {
    Copy-Item -Force (Join-Path $Root 'package-lock.json') $destApp
  }
  if (Test-Path (Join-Path $Root 'start-server.js')) {
    Copy-Item -Force (Join-Path $Root 'start-server.js') $destApp
  }
}

function Copy-SeedData($destData) {
  if (Test-Path $destData) { Remove-Item -Recurse -Force $destData }
  Copy-Tree (Join-Path $SeedDir 'data') $destData
}

# =====================================================================
# Windows package
# =====================================================================
if (-not $SkipWindows) {
  Write-Step '2/5 Build Windows package'
  $PkgName = 'ApprovalSystem-Portable'
  $OutDir = Join-Path $DistRoot $PkgName
  if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
  Ensure-Dir (Join-Path $OutDir 'app')
  Ensure-Dir (Join-Path $OutDir 'runtime')

  Write-Host '  Copy app...'
  Copy-AppCore (Join-Path $OutDir 'app')
  # strip helper scripts not needed at runtime
  $removeScripts = @(
    'export-accounts.js', 'set-gm.js', 'set-vgm.js', 'setup-approval-levels.js',
    'test-wf-delete.js', 'update-leave-datetime.js', 'update-leave-tw.js',
    'remove-agent-from-workflows.js', 'remove-dept-head-required.js'
  )
  foreach ($f in $removeScripts) {
    $p = Join-Path $OutDir "app\server\$f"
    if (Test-Path $p) { Remove-Item -Force $p }
  }

  Write-Host '  Installer scripts...'
  $installerDir = Join-Path $Root 'installer'
  foreach ($f in @('install.bat', 'uninstall.bat', 'start.bat', 'start-hidden.bat', 'start-background.vbs', 'stop.bat')) {
    Copy-Item -Force (Join-Path $installerDir $f) (Join-Path $OutDir $f)
  }
  # Windows 檔名不分大小寫，不再複製 Install.bat（與 install.bat 相同）

  Write-Host '  Portable Node.js...'
  if (-not (Test-Path $NodeZipPath)) {
    Write-Host "  Downloading $NodeUrl"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath -UseBasicParsing
  }
  $extracted = Join-Path $CacheDir "node-$NodeVersion-win-x64"
  if (Test-Path $extracted) { Remove-Item -Recurse -Force $extracted }
  Expand-Archive -Path $NodeZipPath -DestinationPath $CacheDir -Force
  if (-not (Test-Path $extracted)) {
    $extracted = (Get-ChildItem $CacheDir -Directory | Where-Object { $_.Name -like 'node-v*-win-x64' } | Select-Object -First 1).FullName
  }
  $runtimeNode = Join-Path $OutDir 'runtime\node'
  Ensure-Dir $runtimeNode
  Copy-Item -Force (Join-Path $extracted 'node.exe') (Join-Path $runtimeNode 'node.exe')
  foreach ($f in @('npm.cmd', 'npx.cmd', 'nodevars.bat')) {
    $src = Join-Path $extracted $f
    if (Test-Path $src) { Copy-Item -Force $src (Join-Path $runtimeNode $f) }
  }
  if (Test-Path (Join-Path $extracted 'node_modules')) {
    Copy-Item -Recurse -Force (Join-Path $extracted 'node_modules') (Join-Path $runtimeNode 'node_modules')
  }

  Write-Host '  npm install...'
  $nodeExe = Join-Path $runtimeNode 'node.exe'
  $npmCmd = Join-Path $runtimeNode 'npm.cmd'
  $appDir = Join-Path $OutDir 'app'
  Push-Location $appDir
  try {
    $env:Path = "$runtimeNode;" + $env:Path
    & $npmCmd install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  Write-Host '  Seed data...'
  Copy-SeedData (Join-Path $OutDir 'app\data')
  if (Test-Path (Join-Path $SeedDir 'workflows')) {
    $wfTpl = Join-Path $OutDir 'app\data\workflow-templates'
    if (Test-Path $wfTpl) { Remove-Item -Recurse -Force $wfTpl }
    Copy-Item -Recurse -Force (Join-Path $SeedDir 'workflows') $wfTpl
  }
  $seedOut = Join-Path $OutDir 'seed-data'
  if (Test-Path $seedOut) { Remove-Item -Recurse -Force $seedOut }
  Copy-Item -Recurse -Force $SeedDir $seedOut

  # Chinese readme inside package
  $winGuide = @"
線上簽核系統 — Windows 便攜／一鍵安裝包
建置時間：$Stamp

【快速安裝】
1. 解壓或開啟本資料夾
2. 雙擊 install.bat（或「一鍵安裝.bat」）
3. 安裝完成後會自動啟動
4. 瀏覽器開啟：http://127.0.0.1:8080/
5. 管理員：admin / admin123

【完整說明】
請閱讀外層「安裝說明.md」

【資料】
本包已內建 NAS 同步之完整資料：
- 成員、部門、簽核流程、歷史申請、附件、備份
"@
  Write-Utf8NoBom (Join-Path $OutDir 'README-安裝說明.txt') $winGuide
  Write-Utf8NoBom (Join-Path $OutDir 'README.txt') $winGuide

  Write-Host '  Zip...'
  $zipPath = Join-Path $DistRoot "$PkgName.zip"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath, 'Optimal', $true)

  $bootstrap = Join-Path $DistRoot 'Install-ApprovalSystem.bat'
  @(
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    "set `"ZIP=%~dp0$PkgName.zip`"",
    'set "TMP=%TEMP%\ApprovalSystem-Setup-%RANDOM%"',
    'if not exist "%ZIP%" ( echo [ERROR] Missing zip & pause & exit /b 1 )',
    'echo Extracting...',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'mkdir "%TMP%"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''%ZIP%'' -DestinationPath ''%TMP%'' -Force"',
    "set `"PKG=%TMP%\$PkgName`"",
    'if not exist "%PKG%\install.bat" ( echo [ERROR] install.bat not found & pause & exit /b 1 )',
    'call "%PKG%\install.bat"',
    'endlocal'
  ) | Set-Content -Path $bootstrap -Encoding UTF8

  # Deliver to D:\一鍵安裝包\Windows
  $winOut = Join-Path $OutRoot 'Windows'
  if (Test-Path $winOut) { Remove-Item -Recurse -Force $winOut }
  Ensure-Dir $winOut
  Copy-Item -Force $zipPath $winOut
  Copy-Item -Force $bootstrap $winOut
  Copy-Item -Force (Join-Path $OutDir 'install.bat') (Join-Path $winOut '一鍵安裝.bat')
  # also unzipped folder for USB
  Copy-Item -Recurse -Force $OutDir (Join-Path $winOut $PkgName)
  Copy-Item -Force (Join-Path $SeedDir '成員帳號清單.csv') $winOut -ErrorAction SilentlyContinue
  Copy-Item -Force (Join-Path $SeedDir 'SEED-MANIFEST.json') $winOut -ErrorAction SilentlyContinue
  Write-Host "  Windows package → $winOut" -ForegroundColor Green
}

# =====================================================================
# Ubuntu package
# =====================================================================
if (-not $SkipUbuntu) {
  Write-Step '3/5 Build Ubuntu package'
  $PkgName = 'ApprovalSystem-Ubuntu-Install'
  $OutDir = Join-Path $DistRoot $PkgName
  $Template = Join-Path $Root 'deploy\ubuntu-package'
  if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
  Ensure-Dir $OutDir

  foreach ($f in @('install.sh', 'uninstall.sh', 'status.sh', 'backup-data.sh', '00-請先讀我.txt', 'env.example', 'docker-compose.yml')) {
    $src = Join-Path $Template $f
    if (Test-Path $src) { Copy-Item -Force $src $OutDir }
  }
  Copy-Item -Force (Join-Path $Root 'Dockerfile') $OutDir
  Copy-Item -Force (Join-Path $Root 'docker-compose.yml') $OutDir
  Copy-Item -Force (Join-Path $Root 'package.json') $OutDir
  if (Test-Path (Join-Path $Root 'package-lock.json')) {
    Copy-Item -Force (Join-Path $Root 'package-lock.json') $OutDir
  }
  if (Test-Path (Join-Path $Root '.dockerignore')) {
    Copy-Item -Force (Join-Path $Root '.dockerignore') $OutDir
  }
  Copy-AppCore $OutDir
  if (Test-Path (Join-Path $Root 'docs')) {
    robocopy (Join-Path $Root 'docs') (Join-Path $OutDir 'docs') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
  Copy-SeedData (Join-Path $OutDir 'data')
  if (Test-Path (Join-Path $SeedDir 'workflows')) {
    Copy-Item -Recurse -Force (Join-Path $SeedDir 'workflows') (Join-Path $OutDir 'seed-workflows')
  }
  Normalize-Sh $OutDir

  $zipPath = Join-Path $DistRoot "$PkgName.zip"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath, 'Optimal', $true)

  $ubOut = Join-Path $OutRoot 'Ubuntu'
  if (Test-Path $ubOut) { Remove-Item -Recurse -Force $ubOut }
  Ensure-Dir $ubOut
  Copy-Item -Force $zipPath $ubOut
  Copy-Item -Recurse -Force $OutDir (Join-Path $ubOut $PkgName)
  Copy-Item -Force (Join-Path $SeedDir '成員帳號清單.csv') $ubOut -ErrorAction SilentlyContinue
  Copy-Item -Force (Join-Path $SeedDir 'SEED-MANIFEST.json') $ubOut -ErrorAction SilentlyContinue
  Write-Host "  Ubuntu package → $ubOut" -ForegroundColor Green
}

# =====================================================================
# NAS / Synology package
# =====================================================================
if (-not $SkipNas) {
  Write-Step '4/5 Build NAS (Synology) package'
  $PkgName = 'ApprovalSystem-NAS-Install'
  $OutDir = Join-Path $DistRoot $PkgName
  if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
  Ensure-Dir $OutDir

  Copy-Item -Force (Join-Path $Root 'Dockerfile') $OutDir
  Copy-Item -Force (Join-Path $Root 'docker-compose.yml') $OutDir
  Copy-Item -Force (Join-Path $Root 'package.json') $OutDir
  if (Test-Path (Join-Path $Root 'package-lock.json')) {
    Copy-Item -Force (Join-Path $Root 'package-lock.json') $OutDir
  }
  if (Test-Path (Join-Path $Root '.dockerignore')) {
    Copy-Item -Force (Join-Path $Root '.dockerignore') $OutDir
  }
  Copy-AppCore $OutDir
  if (Test-Path (Join-Path $Root 'docs')) {
    robocopy (Join-Path $Root 'docs') (Join-Path $OutDir 'docs') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
  Copy-SeedData (Join-Path $OutDir 'data')
  if (Test-Path (Join-Path $SeedDir 'workflows')) {
    Copy-Item -Recurse -Force (Join-Path $SeedDir 'workflows') (Join-Path $OutDir 'seed-workflows')
  }

  # simple deploy helpers (avoid nested quotes in PS here-strings)
  $deployLines = @(
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'echo "[*] Build & start approval-system (Docker Compose)..."',
    'if command -v docker >/dev/null 2>&1; then',
    '  docker compose up -d --build',
    '  docker compose ps',
    '  IP=$(hostname -I 2>/dev/null | awk "{print `$1}")',
    '  echo "[OK] Open http://${IP:-NAS_IP}:3847/"',
    'else',
    '  echo "[ERR] docker not found. On Synology use Container Manager UI instead."',
    '  exit 1',
    'fi'
  )
  Write-Utf8NoBom (Join-Path $OutDir 'deploy.sh') (($deployLines -join "`n") + "`n")
  Normalize-Sh $OutDir

  $zipPath = Join-Path $DistRoot "$PkgName.zip"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath, 'Optimal', $true)

  $nasOut = Join-Path $OutRoot 'NAS'
  if (Test-Path $nasOut) { Remove-Item -Recurse -Force $nasOut }
  Ensure-Dir $nasOut
  Copy-Item -Force $zipPath $nasOut
  Copy-Item -Recurse -Force $OutDir (Join-Path $nasOut $PkgName)
  Copy-Item -Force (Join-Path $SeedDir '成員帳號清單.csv') $nasOut -ErrorAction SilentlyContinue
  Copy-Item -Force (Join-Path $SeedDir 'SEED-MANIFEST.json') $nasOut -ErrorAction SilentlyContinue
  Write-Host "  NAS package → $nasOut" -ForegroundColor Green
}

# =====================================================================
# Documentation
# =====================================================================
Write-Step '5/5 Write install guides'

$usersList = ($manifest.users | ForEach-Object { "- $($_.username) / $($_.name) （$($_.department)）[$($_.role)]" }) -join "`n"
$wfList = ($manifest.workflows | ForEach-Object { "- $($_.name)" }) -join "`n"
$deptList = if ($manifest.departments) {
  ($manifest.departments | ForEach-Object { "- $($_.name)" }) -join "`n"
} else { '（見系統內部門設定）' }

$commonData = @"
## 本包內建資料摘要（建置時間：$Stamp）

| 項目 | 數量 |
|------|------|
| 成員（啟用） | $($manifest.counts.users) |
| 部門 | $($manifest.counts.departments) |
| 簽核流程 | $($manifest.counts.workflows) |
| 申請單 | $($manifest.counts.requests) |
| 附件索引 | $($manifest.counts.attachments) |

### 簽核流程
$wfList

### 部門
$deptList

### 成員（節錄）
$usersList

> 完整清單見同目錄 **成員帳號清單.csv** 與 **SEED-MANIFEST.json**

### 預設登入
- **管理員**：``admin`` / ``admin123``（首次請立即修改密碼）
- **其他帳號**：多數為 ``pass1234``（若曾在系統中改過密碼，以實際為準）
"@

# --- Windows guide ---
$winMd = @"
# 線上簽核系統 — Windows 一鍵安裝說明

**建置時間：** $Stamp  
**適用：** Windows 10 / 11 / Windows Server 2016 以上（x64）  
**預設埠：** ``8080``  
**無需預先安裝 Node.js**

---

## 1. 安裝包內容

\`\`\`
Windows/
├── 安裝說明.md                 ← 本文件
├── 一鍵安裝.bat                ← 從解壓資料夾直接安裝
├── Install-ApprovalSystem.bat  ← 從 zip 一鍵解壓並安裝
├── ApprovalSystem-Portable.zip
├── ApprovalSystem-Portable/    ← 已解壓完整包（可拷貝到 USB）
│   ├── install.bat
│   ├── start.bat / stop.bat
│   ├── runtime/node/           ← 內建 Node.js
│   ├── app/                    ← 程式
│   │   └── data/               ← ★ 完整種子資料
│   └── seed-data/              ← 種子備份（可手動還原）
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

$commonData

---

## 2. 安裝步驟（建議）

### 方式 A：一鍵從 ZIP 安裝

1. 將整個 ``Windows`` 資料夾拷貝到目標電腦（例如桌面）
2. **以系統管理員身分**（建議）雙擊 ``Install-ApprovalSystem.bat``
3. 等待解壓與複製完成
4. 瀏覽器自動或手動開啟：

   **http://127.0.0.1:8080/**

5. 使用 ``admin`` / ``admin123`` 登入

### 方式 B：使用已解壓資料夾

1. 開啟 ``ApprovalSystem-Portable``
2. 雙擊 ``install.bat``
3. 同上開啟網址登入

### 方式 C：僅隨身碟／離線執行（不安裝）

1. 開啟 ``ApprovalSystem-Portable``
2. 雙擊 ``start.bat``
3. 開啟 http://127.0.0.1:8080/

---

## 3. 安裝位置與資料路徑

| 項目 | 路徑 |
|------|------|
| 程式安裝目錄 | ``%LOCALAPPDATA%\ApprovalSystem`` |
| 資料庫 | ``%LOCALAPPDATA%\ApprovalSystem\app\data\approval.db`` |
| 附件 | ``...\app\data\uploads`` |
| 備份 PDF | ``...\app\data\backups`` |

- **全新安裝**：自動帶入本包種子資料（成員、流程、歷史單據、附件）
- **重複安裝／更新**：會**保留**既有 ``data``，不覆蓋您的資料庫

---

## 4. 區網給其他電腦使用

1. 在伺服器電腦完成安裝並啟動
2. Windows 防火牆允許 **TCP 8080** 輸入
3. 其他電腦瀏覽器開啟：``http://伺服器IP:8080/``

---

## 5. 日常操作

| 動作 | 方式 |
|------|------|
| 啟動 | 開始功能表 → 線上簽核系統 → 啟動；或 ``start.bat`` |
| 背景啟動 | ``start-hidden.bat`` / ``start-background.vbs`` |
| 停止 | ``stop.bat`` |
| 解除安裝 | ``uninstall.bat``（請先備份 data） |

---

## 6. 備份建議

定期複製整個資料夾：

``%LOCALAPPDATA%\ApprovalSystem\app\data``

或使用系統內「備份」功能。

---

## 7. 常見問題

**Q：打不開網頁？**  
A：確認 ``start.bat`` 已執行；埠 8080 未被占用；瀏覽器用 ``127.0.0.1`` 而非錯誤 IP。

**Q：中文 PDF 亂碼？**  
A：本包裝有 ``fonts/kaiu.ttf``；若仍異常請確認該字型檔存在於 ``app\fonts``。

**Q：想還原種子資料？**  
A：停止服務後，用 ``seed-data\data\`` 覆蓋 ``app\data\``（會取代現況，請先備份）。

**Q：Email 通知？**  
A：登入管理員 → 帳號設定 → Email 設定 → 啟用 SMTP。
"@
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'Windows') '安裝說明.md') $winMd
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'Windows') '00-請先讀我.txt') @"
線上簽核系統 — Windows 安裝包
================================
1. 雙擊 Install-ApprovalSystem.bat 或 一鍵安裝.bat
2. 開啟 http://127.0.0.1:8080/
3. 登入 admin / admin123
4. 詳細步驟見 安裝說明.md
建置：$Stamp
"@

# --- Ubuntu guide ---
$ubMd = @"
# 線上簽核系統 — Ubuntu 一鍵安裝說明

**建置時間：** $Stamp  
**適用：** Ubuntu 22.04 / 24.04 LTS（x86_64 或 aarch64）  
**預設埠：** ``3847``  
**建議方式：** Docker Compose

---

## 1. 安裝包內容

\`\`\`
Ubuntu/
├── 安裝說明.md
├── ApprovalSystem-Ubuntu-Install.zip
├── ApprovalSystem-Ubuntu-Install/
│   ├── install.sh          ← ★ 一鍵安裝
│   ├── uninstall.sh / status.sh / backup-data.sh
│   ├── Dockerfile / docker-compose.yml
│   ├── server/ public/ fonts/
│   └── data/               ← ★ 完整種子資料
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

$commonData

---

## 2. 安裝前準備

1. 伺服器可連網（首次安裝 Docker 或 Node 需下載）
2. 建議可用空間 ≥ 2 GB
3. 上傳本安裝包到 Ubuntu，例如：

\`\`\`bash
# 在 Windows 可用 scp / WinSCP
scp -r Ubuntu/ApprovalSystem-Ubuntu-Install.zip user@ubuntu-ip:~/
\`\`\`

---

## 3. 一鍵安裝步驟

\`\`\`bash
# 1) 解壓
cd ~
unzip ApprovalSystem-Ubuntu-Install.zip
cd ApprovalSystem-Ubuntu-Install

# 2) 給執行權限
chmod +x install.sh uninstall.sh status.sh backup-data.sh

# 3) 一鍵安裝（互動選單；建議選 Docker）
./install.sh

# 或非互動：
./install.sh --docker -y
# 原生 Node + systemd（需 sudo）：
# sudo ./install.sh --native -y
\`\`\`

4. 安裝完成後開啟：

   **http://伺服器IP:3847/**

5. 登入 ``admin`` / ``admin123``

> 種子 ``data/`` 會一併安裝；若目標已有資料，腳本通常會保留既有 data（以 ``install.sh`` 實際行為為準）。

---

## 4. 驗證

\`\`\`bash
./status.sh
# 或
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3847/
\`\`\`

---

## 5. 日常維運

| 動作 | Docker 模式 |
|------|-------------|
| 查看狀態 | ``./status.sh`` 或 ``docker compose ps`` |
| 查看日誌 | ``docker compose logs -f`` |
| 重啟 | ``docker compose restart`` |
| 停止 | ``docker compose down`` |
| 備份 data | ``./backup-data.sh`` |
| 更新程式 | 覆蓋程式檔後 ``docker compose up -d --build``（**勿刪 data/**） |

資料目錄（Docker）：安裝目錄下的 ``data/``（掛載到容器 ``/app/data``）

---

## 6. 防火牆

\`\`\`bash
sudo ufw allow 3847/tcp
sudo ufw reload
\`\`\`

---

## 7. 從 Windows／NAS 再遷移資料

若要改用其他主機的最新 ``approval.db``：

1. ``docker compose down``
2. 備份現有 ``data/``
3. 覆寫 ``data/approval.db``、``data/uploads``、``data/backups``
4. ``docker compose up -d``

---

## 8. 常見問題

**Q：Permission denied: ./install.sh**  
A：``chmod +x install.sh``

**Q：bash\r 錯誤**  
A：腳本已轉 LF；若仍有問題：``sed -i 's/\r$//' install.sh``

**Q：埠被占用**  
A：``./install.sh --docker --port 3848`` 或改 ``docker-compose.yml`` 左側埠號

**Q：Email**  
A：系統內「帳號設定 → Email 設定」
"@
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'Ubuntu') '安裝說明.md') $ubMd
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'Ubuntu') '00-請先讀我.txt') @"
線上簽核系統 — Ubuntu 安裝包
================================
1. unzip ApprovalSystem-Ubuntu-Install.zip
2. cd ApprovalSystem-Ubuntu-Install
3. chmod +x install.sh && ./install.sh
4. 開啟 http://伺服器IP:3847/
5. 登入 admin / admin123
詳細：安裝說明.md
建置：$Stamp
"@

# Also copy detailed guide into unzipped folder
if (Test-Path (Join-Path $OutRoot 'Ubuntu\ApprovalSystem-Ubuntu-Install')) {
  Copy-Item -Force (Join-Path (Join-Path $OutRoot 'Ubuntu') '安裝說明.md') (Join-Path $OutRoot 'Ubuntu\ApprovalSystem-Ubuntu-Install\安裝說明.md')
}

# --- NAS guide ---
$nasMd = @"
# 線上簽核系統 — Synology NAS 一鍵安裝說明

**建置時間：** $Stamp  
**適用：** DSM 7.x + **Container Manager**（Docker）  
**預設埠：** ``3847``  
**範例 IP：** ``192.168.99.220``（請改成您的 NAS IP）

---

## 1. 安裝包內容

\`\`\`
NAS/
├── 安裝說明.md
├── ApprovalSystem-NAS-Install.zip
├── ApprovalSystem-NAS-Install/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── server/ public/ fonts/
│   ├── data/                 ← ★ 完整種子資料
│   ├── deploy.sh             ← SSH 一鍵 up -d --build
│   └── docs/SYNOLOGY.md
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

$commonData

---

## 2. 前置條件

1. **套件中心** → 安裝 **Container Manager**
2. 建議 NAS 使用固定 IP
3. 在 File Station 建立資料夾：

\`\`\`
/docker/approval-system/
\`\`\`

（實際路徑多為 ``/volume1/docker/approval-system/``）

---

## 3. 安裝步驟（圖形介面，建議）

### 步驟 1：上傳檔案

1. 解壓 ``ApprovalSystem-NAS-Install.zip``
2. 將資料夾**內所有內容**上傳到：

   ``\\\\NASIP\\docker\\approval-system\\``

   上傳後應看到：

\`\`\`
/docker/approval-system/
  Dockerfile
  docker-compose.yml
  package.json
  server/
  public/
  fonts/
  data/          ← 含 approval.db、uploads、backups
\`\`\`

> **注意：** 若 NAS 上**已有線上系統且要保留現況**，請先備份既有 ``data/``，再決定是否覆蓋 ``data/``。  
> 本包 ``data/`` 為目前完整種子；全新安裝請整包上傳。

### 步驟 2：Container Manager 建立專案

1. 開啟 **Container Manager**
2. 左側 **專案** → **新增**
3. 專案名稱：``approval-system``
4. 路徑：選 ``/docker/approval-system``（有 docker-compose.yml 的目錄）
5. 來源：使用既有 ``docker-compose.yml``
6. 建立並啟動

首次 **build** 需連外網下載 Node 映像，約 5–15 分鐘。

### 步驟 3：開啟系統

瀏覽器開啟：

**http://NAS的IP:3847/**

例如：``http://192.168.99.220:3847/``

登入：``admin`` / ``admin123``

---

## 4. 安裝步驟（SSH 進階）

1. DSM → 控制台 → 終端機與 SNMP → 啟用 SSH  
2. 登入後：

\`\`\`bash
cd /volume1/docker/approval-system
sudo chmod +x deploy.sh
sudo ./deploy.sh
# 或
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs -f
\`\`\`

---

## 5. 資料與更新

| 項目 | 說明 |
|------|------|
| 持久化資料 | ``./data`` 掛載到容器 ``/app/data`` |
| 更新程式 | 上傳新的 server/public 等後 ``docker compose up -d --build`` |
| **不要刪** | ``data/approval.db``、``data/uploads``、``data/backups`` |
| 備份 | 複製整個 ``data/`` 資料夾 |

---

## 6. 防火牆／反向代理

- DSM 防火牆允許 **TCP 3847**
- 若要用 80/443，可在反向代理把網域轉到 ``127.0.0.1:3847``

---

## 7. 常見問題

**Q：容器一直重啟？**  
A：``docker compose logs`` 查看；常見為 data 權限或埠衝突。

**Q：中文 PDF 亂碼？**  
A：確認 ``fonts/kaiu.ttf`` 已上傳並重建映像。

**Q：被選的部門主管沒待簽？**  
A：請使用本包最新版程式（已修正部門主管自選寫入步驟快照）。

**Q：Email 未寄出？**  
A：系統內啟用 Email／SMTP；簽核人帳號需填真實信箱。

**Q：與現有 3847 服務衝突？**  
A：改 ``docker-compose.yml`` 的 ``"3848:3847"`` 後重建。
"@
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'NAS') '安裝說明.md') $nasMd
Write-Utf8NoBom (Join-Path (Join-Path $OutRoot 'NAS') '00-請先讀我.txt') @"
線上簽核系統 — Synology NAS 安裝包
================================
1. 解壓 ApprovalSystem-NAS-Install.zip
2. 上傳全部內容到 /docker/approval-system/
3. Container Manager → 專案 → 用 docker-compose 啟動
4. 開啟 http://NAS_IP:3847/
5. 登入 admin / admin123
詳細：安裝說明.md
建置：$Stamp
"@

if (Test-Path (Join-Path $OutRoot 'NAS\ApprovalSystem-NAS-Install')) {
  Copy-Item -Force (Join-Path (Join-Path $OutRoot 'NAS') '安裝說明.md') (Join-Path $OutRoot 'NAS\ApprovalSystem-NAS-Install\安裝說明.md')
  Copy-Item -Force (Join-Path (Join-Path $OutRoot 'NAS') '00-請先讀我.txt') (Join-Path $OutRoot 'NAS\ApprovalSystem-NAS-Install\00-請先讀我.txt')
}

# Root index
$index = @"
線上簽核系統 — 一鍵安裝包總覽
================================
建置時間：$Stamp
存放位置：D:\一鍵安裝包\

【目錄】
  Windows\   → Windows 10/11 一鍵安裝（埠 8080）
  Ubuntu\    → Ubuntu Docker／原生一鍵安裝（埠 3847）
  NAS\       → Synology Container Manager（埠 3847）

【每個資料夾都有】
  00-請先讀我.txt
  安裝說明.md          ← 詳細步驟
  成員帳號清單.csv
  SEED-MANIFEST.json
  對應平台的 zip / 解壓目錄

【內建資料】
  成員：$($manifest.counts.users)
  流程：$($manifest.counts.workflows)
  申請單：$($manifest.counts.requests)
  部門：$($manifest.counts.departments)

【預設帳號】
  admin / admin123

【建議】
  1. 依目標環境只拷貝對應子資料夾即可
  2. 安裝前請閱讀該資料夾「安裝說明.md」
  3. 上線後立即修改 admin 密碼並設定 Email
"@
Write-Utf8NoBom (Join-Path $OutRoot '00-請先讀我.txt') $index
Write-Utf8NoBom (Join-Path $OutRoot 'README.md') ($index -replace '\\','/')

# Also copy seed snapshot reference
$seedRef = Join-Path $OutRoot '_共用種子資料'
if (Test-Path $seedRef) { Remove-Item -Recurse -Force $seedRef }
Copy-Item -Recurse -Force $SeedDir $seedRef

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ALL PACKAGES READY" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Output: $OutRoot"
Get-ChildItem $OutRoot -Directory | ForEach-Object {
  $sz = [math]::Round(((Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Write-Host ("  {0,-12} {1} MB" -f $_.Name, $sz)
}
Write-Host "========================================" -ForegroundColor Green
