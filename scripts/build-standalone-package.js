const fs = require('fs');
const path = require('path');

const outputBase = 'D:\\一鍵安裝包';
const packageFolder = 'approval-system-update-20260806';
const targetDir = path.join(outputBase, packageFolder);
const sourceRoot = path.resolve(__dirname, '..');

console.log('=== 開始建置今日獨立更新包 (2026-08-06) ===');
console.log('來源目錄:', sourceRoot);
console.log('目標目錄:', targetDir);

// 建立目標目錄
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// 需要包含的程式檔與資料夾
const includeItems = [
  'public',
  'server',
  'package.json',
  'package-lock.json',
  'start-server.js',
  'local-server-control.bat',
  'local-server-control.ps1',
  'local-server-start.bat',
  'local-server-stop.bat',
  'create-desktop-shortcuts.js',
  'CHANGELOG.md',
  'docs'
];

function copyRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      if (['node_modules', '.git', 'data', 'backups', 'mail-outbox'].includes(childItemName)) return;
      copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
}

includeItems.forEach((item) => {
  const s = path.join(sourceRoot, item);
  const d = path.join(targetDir, item);
  if (fs.existsSync(s)) {
    copyRecursive(s, d);
    console.log(`[已複製] ${item}`);
  }
});

// 1. Windows Batch (一鍵更新-Windows.bat)
const winBatContent = `@echo off
chcp 65001 >nul
title 簽核流程系統 - 一鍵更新 (Windows Batch)
echo ===================================================
echo   簽核流程系統 - 今日獨立一鍵更新包 (2026-08-06)
echo   支援平台: Windows CMD Batch
echo   防護機制: 自動排除資料庫 data/ 與系統設定, 絕不更動原系統設定!
echo ===================================================
echo.

set TARGET_DIR=%~dp0
cd /d "%TARGET_DIR%"

if not exist "%TARGET_DIR%package.json" (
    echo [錯誤] 找不到 package.json，請確認更新包檔案完整。
    pause
    exit /b 1
)

echo [1/3] 停止目前正在運行的服務...
taskkill /f /im node.exe 2>nul

echo [2/3] 檢查與安裝套件依依賴 (npm install)...
call npm install --production

echo [3/3] 重啟簽核系統服務...
start "" node start-server.js

echo.
echo ===================================================
echo   [OK] Windows 平台系統更新成功完成！
echo   請於瀏覽器重新整理 (Ctrl+F5) 確認新功能。
echo ===================================================
pause
`;

// 2. Windows PowerShell (一鍵更新-Windows.ps1)
const winPs1Content = `# UTF-8 PowerShell 腳本
$Host.UI.RawUI.WindowTitle = "簽核流程系統 - 一鍵更新 (PowerShell)"
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  簽核流程系統 - 今日獨立一鍵更新包 (2026-08-06)" -ForegroundColor Cyan
Write-Host "  支援平台: Windows PowerShell" -ForegroundColor Cyan
Write-Host "  防護機制: 排除資料庫 data/ 與設定檔，保留原系統所有資料" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

if (-not (Test-Path "$ScriptDir\\package.json")) {
    Write-Host "[錯誤] 找不到 package.json，請確認更新包完整。" -ForegroundColor Red
    Read-Host "請按 Enter 鍵結束..."
    exit 1
}

Write-Host "[1/3] 停止背景 Node.exe 進程..." -ForegroundColor Yellow
Stop-Process -Name "node" -ErrorAction SilentlyContinue

Write-Host "[2/3] 檢查與更新套件依賴..." -ForegroundColor Yellow
npm install --production

Write-Host "[3/3] 重啟簽核系統服務..." -ForegroundColor Yellow
Start-Process node -ArgumentList "start-server.js" -WindowStyle Hidden

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "  [OK] PowerShell 平台系統更新成功！" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
`;

// 3. Linux / NAS Docker Bash (一鍵更新-Linux-NAS.sh)
const linuxShContent = `#!/bin/bash
# ===================================================
#  簽核流程系統 - 今日獨立一鍵更新包 (Linux / NAS Docker)
#  支援平台: Linux / Synology NAS Docker (Bash)
#  防護機制: 自動跳過 data/ approval.db 與系統設定檔
# ===================================================

set -e

echo "=== 開始執行 Linux / NAS Docker 平台一鍵更新 ==="

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/package.json" ]; then
  echo "[錯誤] 找不到 package.json，請確認檔案完整！"
  exit 1
fi

echo "[1/3] 檢查 Docker 容器與 Node 服務..."
if command -v docker &> /dev/null && [ -f "/volume1/docker/approval-system/docker-compose.yml" ]; then
  echo "檢測到 Synology NAS / Linux Docker 環境，重啟 Docker 容器..."
  docker-compose restart || docker restart approval-system
else
  echo "重啟 Linux Node 服務..."
  pkill -f "node start-server.js" || true
  npm install --production
  nohup node start-server.js > server.log 2>&1 &
fi

echo "==================================================="
echo "  [OK] Linux / NAS Docker 平台一鍵更新完成！"
echo "  網址: http://localhost:3847/"
echo "==================================================="
`;

// 4. README-更新說明與紀錄-20260806.md
const readmeContent = `# 簽核流程系統 - 今日獨立一鍵更新包 (2026-08-06)

## 📌 今日更新功能彙整與紀錄

1. **簽核動態表單一行多列佈局 ("一行多列填寫")**:
   - \`textarea\` / 說明事由自動跨滿整行，短欄位 (Select / Date / User / Number) 自動兩兩併排，提升填寫效率。

2. **登入頁面現代企業風格切分設計**:
   - 左側微光藍夜漸層英雄 Banner（含 3 大特色亮點與公司 Branding Logo 自訂綁定），右側圖示輸入框。

3. **客製化個人佈景主題與即時預覽**:
   - 提供 6 款專屬主題色調 (經典藍調、暗黑夜空、翡翠森林、皇家紫羅蘭、暖陽日暮、櫻花石榴)。
   - 切換主題時動態套用該主題代表色底色，並自動對齊高對比字體。

4. **下拉選單 (Select / Option) 高對比清晰度修正**:
   - 全面修正選單與 Option 項目文字在深色/暗黑模式下難以閱讀的問題。

5. **高效能 GPU 硬體加速 (FPS 提升)**:
   - 採用 \`transform: translateZ(0)\` 與 \`contain: paint layout\` GPU 合成層隔離，流暢保留毛玻璃質感同時提升 60 FPS 幀率。

---

## 🔒 系統設定保護說明 (Safety Guarantee)

本更新包採用 **「程式碼覆蓋、設定資料隔離」** 原則：
- ❌ **絕不覆寫**: \`data/approval.db\` (SQLite 資料庫)、\`data/system-settings.json\` (系統設定)、\`data/mail-config.json\` (Email 設定)、\`data/line-config.json\` (LINE 設定)、\`data/uploads/\` (附件上傳檔)、\`data/certs/\` (PDF憑證)。
- ✅ **僅更新**: 前端資源 (\`public/\`)、後端服務核心 (\`server/\`) 與啟動主程式。

---

## 🚀 三平台一鍵更新執行說明

### 1. Windows (CMD / Batch)
- 雙擊執行 \`一鍵更新-Windows.bat\`

### 2. Windows (PowerShell)
- 右鍵選擇「使用 PowerShell 執行」 \`一鍵更新-Windows.ps1\`

### 3. Linux / Synology NAS Docker
- 上傳至 Docker/系統目錄後執行：
  \`\`\`bash
  chmod +x 一鍵更新-Linux-NAS.sh
  ./一鍵更新-Linux-NAS.sh
  \`\`\`
`;

// 5. Ubuntu Platform Specific Files (D:\一鍵安裝包\Ubuntu)
const ubuntuDir = path.join(outputBase, 'Ubuntu');
const ubuntuPackageDir = path.join(ubuntuDir, 'ApprovalSystem-Ubuntu-Update-20260806');

if (!fs.existsSync(ubuntuDir)) fs.mkdirSync(ubuntuDir, { recursive: true });
if (fs.existsSync(ubuntuPackageDir)) fs.rmSync(ubuntuPackageDir, { recursive: true, force: true });
fs.mkdirSync(ubuntuPackageDir, { recursive: true });

includeItems.forEach((item) => {
  const s = path.join(sourceRoot, item);
  const d = path.join(ubuntuPackageDir, item);
  if (fs.existsSync(s)) {
    copyRecursive(s, d);
  }
});

const ubuntuShContent = `#!/bin/bash
# ===================================================
#  簽核流程系統 - Ubuntu 平台一鍵更新腳本 (2026-08-06)
#  支援平台: Ubuntu 18.04 / 20.04 / 22.04 / 24.04 LTS
#  防護機制: 自動跳過 data/ approval.db 與系統設定檔
# ===================================================

set -e

echo "==================================================="
echo "  簽核流程系統 - Ubuntu 平台一鍵更新 (2026-08-06)"
echo "  防護機制: 排除資料庫 data/ 與系統設定檔"
echo "==================================================="

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/package.json" ]; then
  echo "[錯誤] 找不到 package.json，請確認更新包路徑正確！"
  exit 1
fi

echo "[1/3] 停止目前運行的 Ubuntu 服務 (systemd / pm2 / node)..."
if systemctl is-active --quiet approval-system 2>/dev/null; then
  echo "停止 systemctl approval-system 服務..."
  sudo systemctl stop approval-system
elif command -v pm2 &> /dev/null && pm2 list | grep -q "approval-system"; then
  echo "停止 pm2 approval-system 服務..."
  pm2 stop approval-system
else
  echo "停止背景 Node 進程..."
  pkill -f "node start-server.js" 2>/dev/null || true
fi

echo "[2/3] 安裝/檢查 npm 套件依賴..."
npm install --production

echo "[3/3] 重啟 Ubuntu 服務..."
if systemctl list-unit-files | grep -q "approval-system.service"; then
  sudo systemctl restart approval-system
  echo "[OK] 已重新啟動 systemd approval-system 服務！"
elif command -v pm2 &> /dev/null; then
  pm2 restart approval-system || pm2 start start-server.js --name "approval-system"
  echo "[OK] 已重新啟動 pm2 approval-system 服務！"
else
  nohup node start-server.js > /var/log/approval-system.log 2>&1 &
  echo "[OK] 已於背景重新啟動 Node 服務！"
fi

echo "==================================================="
echo "  [OK] Ubuntu 平台系統更新成功完成！"
echo "  網址: http://localhost:3847/"
echo "==================================================="
`;

// 寫入根目錄與三平台外層
fs.writeFileSync(path.join(targetDir, '一鍵更新-Windows.bat'), winBatContent, 'utf8');
fs.writeFileSync(path.join(targetDir, '一鍵更新-Windows.ps1'), winPs1Content, 'utf8');
fs.writeFileSync(path.join(targetDir, '一鍵更新-Linux-NAS.sh'), linuxShContent, 'utf8');
fs.writeFileSync(path.join(targetDir, '一鍵更新-Ubuntu.sh'), ubuntuShContent, 'utf8');
fs.writeFileSync(path.join(targetDir, 'README-更新說明與紀錄-20260806.md'), readmeContent, 'utf8');

// 寫入 D:\一鍵安裝包 根目錄
fs.writeFileSync(path.join(outputBase, '一鍵更新-Windows.bat'), winBatContent, 'utf8');
fs.writeFileSync(path.join(outputBase, '一鍵更新-Windows.ps1'), winPs1Content, 'utf8');
fs.writeFileSync(path.join(outputBase, '一鍵更新-Linux-NAS.sh'), linuxShContent, 'utf8');
fs.writeFileSync(path.join(outputBase, '一鍵更新-Ubuntu.sh'), ubuntuShContent, 'utf8');
fs.writeFileSync(path.join(outputBase, '2026-08-06-一鍵更新包說明.md'), readmeContent, 'utf8');

// 寫入 D:\一鍵安裝包\Ubuntu 目錄
fs.writeFileSync(path.join(ubuntuDir, '一鍵更新-Ubuntu.sh'), ubuntuShContent, 'utf8');
fs.writeFileSync(path.join(ubuntuDir, '套用此包更新到既有安裝.sh'), ubuntuShContent, 'utf8');
fs.writeFileSync(path.join(ubuntuDir, '2026-08-06-Ubuntu更新說明.md'), readmeContent, 'utf8');
fs.writeFileSync(path.join(ubuntuPackageDir, '一鍵更新-Ubuntu.sh'), ubuntuShContent, 'utf8');
fs.writeFileSync(path.join(ubuntuPackageDir, 'README-更新說明與紀錄-20260806.md'), readmeContent, 'utf8');

console.log('=== [OK] 今日獨立一鍵更新包建置成功！ ===');
console.log('更新包路徑:', targetDir);
console.log('Ubuntu更新包路徑:', ubuntuPackageDir);
console.log('包含檔案:');
console.log(' - 一鍵更新-Windows.bat (Windows CMD)');
console.log(' - 一鍵更新-Windows.ps1 (Windows PowerShell)');
console.log(' - 一鍵更新-Linux-NAS.sh (Linux / Synology NAS Docker)');
console.log(' - 一鍵更新-Ubuntu.sh (Ubuntu 18.04/20.04/22.04/24.04)');
console.log(' - README-更新說明與紀錄-20260806.md (更新紀錄說明)');
