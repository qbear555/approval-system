#Requires -Version 5.1
<#
.SYNOPSIS
  將簽核系統安全變更提交並推送到 GitHub（main）。

.DESCRIPTION
  - 排除 mail-config、node_modules、密鑰與執行期資料
  - 優先使用 git + gh；若未登入則提示改用 MCP 或 gh auth login

.EXAMPLE
  .\scripts\push-github.ps1
  .\scripts\push-github.ps1 -Message "fix: pending modal notify"
#>
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$git = $null
foreach ($c in @(
  "git",
  "$env:LOCALAPPDATA\OpenClaw\deps\portable-git\mingw64\bin\git.exe",
  "C:\Program Files\Git\bin\git.exe"
)) {
  if ($c -eq "git") {
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { $git = $cmd.Source; break }
  } elseif (Test-Path $c) { $git = $c; break }
}
if (-not $git) { throw "找不到 git" }

$gh = $null
foreach ($c in @(
  "C:\Program Files\GitHub CLI\gh.exe",
  "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
)) {
  if (Test-Path $c) { $gh = $c; break }
}

function Invoke-Git { & $git @args }

if (-not (Test-Path (Join-Path $Root ".git"))) {
  throw "尚未初始化 git。遠端應為 https://github.com/qbear555/approval-system"
}

# 確保 .gitignore 存在且涵蓋敏感檔
$gi = Join-Path $Root ".gitignore"
if (-not (Test-Path $gi)) {
  @"
node_modules/
.cache/
dist/
tmp-*/
*.log
.env
.env.*
data/mail-config.json
data/mail-outbox/*.json
!data/mail-outbox/.gitkeep
data/uploads/*
!data/uploads/.gitkeep
data/backups/**
!data/backups/.gitkeep
data/*.db
data/*.db-wal
data/*.db-shm
data/*.pdf
data/test-*
*.zip
fonts/*.ttf
fonts/*.otf
.DS_Store
Thumbs.db
"@ | Set-Content $gi -Encoding UTF8
}

# 只加入安全路徑
$paths = @(
  "server", "public", "scripts", "docs", "deploy", "installer",
  "package.json", "package-lock.json",
  "Dockerfile", "docker-compose.yml", "docker-entrypoint.sh",
  ".dockerignore", ".gitignore", "AGENTS.md", "README.md",
  "start-server.js", "start.bat", "stop.bat", "start-hidden.bat",
  "start-background.vbs", "start-always.vbs", "install-and-start.ps1",
  "seed-workflows", "one-click-packages"
)
foreach ($p in $paths) {
  if (Test-Path (Join-Path $Root $p)) {
    Invoke-Git add -- $p 2>$null
  }
}

$status = Invoke-Git status --porcelain
if (-not $status) {
  Write-Host "沒有可提交的變更。"
  exit 0
}

if (-not $Message) {
  $Message = "chore: update approval-system $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Invoke-Git commit -m $Message
Write-Host "已 commit: $Message"

# 推送
$pushed = $false
if ($gh) {
  $auth = & $gh auth status 2>&1 | Out-String
  if ($auth -match "Logged in") {
    Invoke-Git push -u origin HEAD
    $pushed = $true
  }
}

if (-not $pushed) {
  try {
    Invoke-Git push -u origin HEAD 2>&1 | Write-Host
    $pushed = $LASTEXITCODE -eq 0
  } catch {
    $pushed = $false
  }
}

if ($pushed) {
  Write-Host "已推送到 https://github.com/qbear555/approval-system"
} else {
  Write-Host ""
  Write-Host "【尚未 push】本機 gh/git 可能未登入。"
  Write-Host "請執行: gh auth login"
  Write-Host "或請 AI 使用 GitHub MCP 推送。"
  Write-Host "倉庫: https://github.com/qbear555/approval-system"
  exit 2
}
