/**
 * 同步簽核系統到本機 WSL Ubuntu 系統 (/opt/approval-system) 並重啟 Docker 容器。
 * 遵循專案約定：本機系統一律指 WSL 中的 Ubuntu 簽核系統。
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DRIVE = ROOT.substring(0, 1).toLowerCase();
const REST = ROOT.substring(3).replace(/\\/g, '/');
const WSL_SOURCE = `/mnt/${DRIVE}/${REST}`;
const REMOTE_DIR = '/opt/approval-system';

function runWsl(cmd, inherit = false) {
  const res = spawnSync('wsl', ['-e', 'sh', '-c', cmd], {
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim();
    throw new Error(`WSL 指令失敗 (代碼 ${res.status}): ${err}`);
  }
  return res.stdout || '';
}

async function testHealth() {
  for (let i = 0; i < 15; i++) {
    try {
      const ok = await new Promise((resolve) => {
        http.get('http://127.0.0.1:3847/health', { timeout: 3000 }, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            resolve(res.statusCode === 200);
          });
        }).on('error', () => resolve(false));
      });
      if (ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  console.log('========================================');
  console.log('  同步到本機系統（WSL Ubuntu 簽核系統）');
  console.log('========================================\n');

  console.log('[1/3] 正在同步程式檔案至 WSL Ubuntu /opt/approval-system/ ...');
  const syncScript = `
    set -e
    rsync -av --delete \
      --exclude='data/' \
      --exclude='.env' \
      --exclude='node_modules/' \
      --exclude='.git/' \
      --exclude='frontend/' \
      --exclude='deploy/' \
      --exclude='scratch/' \
      --exclude='*.tar.gz' \
      --exclude='*.zip' \
      --exclude='*.bak' \
      "${WSL_SOURCE}/server/" "${REMOTE_DIR}/server/"

    rsync -av --delete \
      --exclude='data/' \
      "${WSL_SOURCE}/public/" "${REMOTE_DIR}/public/"

    rsync -av "${WSL_SOURCE}/fonts/" "${REMOTE_DIR}/fonts/" 2>/dev/null || true
    rsync -av "${WSL_SOURCE}/docs/" "${REMOTE_DIR}/docs/" 2>/dev/null || true
    rsync -av "${WSL_SOURCE}/seed-workflows/" "${REMOTE_DIR}/seed-workflows/" 2>/dev/null || true

    for f in package.json package-lock.json Dockerfile docker-compose.yml docker-entrypoint.sh .dockerignore start-server.js CHANGELOG.md README.md update.sh backup-data.sh status.sh; do
      if [ -f "${WSL_SOURCE}/$f" ]; then
        cp -f "${WSL_SOURCE}/$f" "${REMOTE_DIR}/$f"
      fi
    done
  `;
  runWsl(syncScript);
  console.log('  檔案同步完成！\n');

  console.log('[2/3] 正在重新建置並重啟 WSL Ubuntu Docker 容器 approval-system ...');
  runWsl(`cd ${REMOTE_DIR} && docker compose up -d --build approval-system`, true);
  console.log('  Docker 容器重建並啟動完成！\n');

  console.log('[3/3] 正在驗證本機 Ubuntu 服務健康狀態 ...');
  const isHealthy = await testHealth();
  if (isHealthy) {
    console.log('  驗證成功！本機 Ubuntu 簽核系統運作正常 (HTTP 200 OK)\n');
  } else {
    console.warn('  警告：健康檢查未如期回應，請至 WSL 執行 docker logs approval-system 查看記錄。\n');
  }

  console.log('========================================');
  console.log('  本機系統 (WSL Ubuntu) 已更新完畢！');
  console.log('  HTTP:  http://127.0.0.1:3847/');
  console.log('  HTTPS: https://127.0.0.1:3848/');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('\n[ERR] 同步失敗：', err.message || err);
  process.exit(1);
});
