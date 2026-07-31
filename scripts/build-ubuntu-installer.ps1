#Requires -Version 5.1
<#
  建置 Ubuntu 一鍵安裝包
  用法（專案根目錄）:
    powershell -ExecutionPolicy Bypass -File scripts\build-ubuntu-installer.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PkgName = 'ApprovalSystem-Ubuntu-Install'
$DistRoot = Join-Path $Root 'dist'
$OutDir = Join-Path $DistRoot $PkgName
$Template = Join-Path $Root 'deploy\ubuntu-package'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Build Ubuntu One-Click Installer' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir, $DistRoot | Out-Null

# 1) 安裝包樣板（腳本與說明）
Write-Host '[1/5] Copy installer templates...' -ForegroundColor Yellow
Copy-Item -Force (Join-Path $Template 'install.sh') $OutDir
Copy-Item -Force (Join-Path $Template 'uninstall.sh') $OutDir
Copy-Item -Force (Join-Path $Template 'status.sh') $OutDir
Copy-Item -Force (Join-Path $Template 'backup-data.sh') $OutDir
Copy-Item -Force (Join-Path $Template '00-請先讀我.txt') $OutDir
Copy-Item -Force (Join-Path $Template '安裝說明.md') $OutDir
Copy-Item -Force (Join-Path $Template 'env.example') $OutDir
Copy-Item -Force (Join-Path $Template 'docker-compose.yml') $OutDir

# 2) 應用程式
Write-Host '[2/5] Copy application...' -ForegroundColor Yellow
Copy-Item -Force (Join-Path $Root 'Dockerfile') $OutDir
Copy-Item -Force (Join-Path $Root '.dockerignore') $OutDir -ErrorAction SilentlyContinue
Copy-Item -Force (Join-Path $Root 'package.json') $OutDir
Copy-Item -Force (Join-Path $Root 'package-lock.json') $OutDir
Copy-Item -Force (Join-Path $Root 'README.md') $OutDir
robocopy (Join-Path $Root 'server') (Join-Path $OutDir 'server') /E /XF test-*.js create-users.js list-users-quick.js /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy (Join-Path $Root 'public') (Join-Path $OutDir 'public') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy (Join-Path $Root 'docs') (Join-Path $OutDir 'docs') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if (Test-Path (Join-Path $Root 'fonts')) {
  robocopy (Join-Path $Root 'fonts') (Join-Path $OutDir 'fonts') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
} else {
  New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'fonts') | Out-Null
}

# 3) data 骨架 + 可選目前資料庫（方便開箱）
Write-Host '[3/5] Prepare data/ ...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'data\uploads'), (Join-Path $OutDir 'data\backups'), (Join-Path $OutDir 'data\mail-outbox') | Out-Null
try {
  $dbPath = Join-Path $Root 'data\approval.db'
  if (Test-Path $dbPath) {
    node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close();" $dbPath 2>$null
    Copy-Item -Force $dbPath (Join-Path $OutDir 'data\approval.db')
    Write-Host '  included approval.db' -ForegroundColor Green
  }
} catch {
  Write-Host '  skip live db' -ForegroundColor Yellow
}
# 可選：精簡上傳／備份樣本不強制（體積）

# 4) LF 行尾（避免 bash \r 問題）
Write-Host '[4/5] Normalize shell scripts to LF...' -ForegroundColor Yellow
Get-ChildItem $OutDir -Filter '*.sh' | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n" -replace "`r", "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($_.FullName, $t, $utf8NoBom)
}

# 5) Zip
Write-Host '[5/5] Compress...' -ForegroundColor Yellow
$zipPath = Join-Path $DistRoot "$PkgName.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
$folderMB = [math]::Round(((Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 2)

# 複製到 D:\ 與桌面
$targets = @()
if (Test-Path 'D:\') {
  $dElec = 'D:\ApprovalSystem-Ubuntu-Install'
  New-Item -ItemType Directory -Force -Path $dElec | Out-Null
  Copy-Item -Force $zipPath $dElec
  Get-ChildItem $OutDir -Filter '*.md' | Copy-Item -Destination $dElec -Force
  Get-ChildItem $OutDir -Filter '00-*' | Copy-Item -Destination $dElec -Force
  $targets += $dElec
}

$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ApprovalSystem-Ubuntu-Install'
if (Test-Path $desk) { Remove-Item -Recurse -Force $desk }
New-Item -ItemType Directory -Force -Path $desk | Out-Null
Copy-Item -Force $zipPath $desk
Get-ChildItem $OutDir -Filter '*.md' | Copy-Item -Destination $desk -Force
Get-ChildItem $OutDir -Filter '00-*' | Copy-Item -Destination $desk -Force
robocopy $OutDir (Join-Path $desk $PkgName) /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
$targets += $desk

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  BUILD COMPLETE' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host "Folder: $OutDir ($folderMB MB)"
Write-Host "Zip:    $zipPath ($sizeMB MB)"
Write-Host "Copied: $($targets -join '; ')"
Write-Host ''
Write-Host 'On Ubuntu:'
Write-Host '  unzip ApprovalSystem-Ubuntu-Install.zip'
Write-Host '  cd ApprovalSystem-Ubuntu-Install'
Write-Host '  chmod +x install.sh && ./install.sh'
Write-Host '========================================' -ForegroundColor Green
