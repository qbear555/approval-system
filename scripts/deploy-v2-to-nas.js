/**
 * Deploy dual-track code (Classic + Vue 3 v2) to Synology NAS
 * Preserves /volume1/docker/approval-system/data completely intact.
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const PASS = process.env.NAS_PASS || 'Ww837*5630';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 9922);
const USER = process.env.NAS_USER || 'tsuming';
const REMOTE_DIR = '/volume1/docker/approval-system';
const ROOT = path.join(__dirname, '..');
const LOCAL_TAR = path.join(ROOT, 'temp_deploy_nas.tar.gz');

function execRemote(conn, cmd, sudo = false) {
  return new Promise((resolve, reject) => {
    const full = sudo
      ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' env PATH=/usr/local/bin:/usr/bin:/bin sh -c ${JSON.stringify(cmd)}`
      : `sh -c ${JSON.stringify(cmd)}`;
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let o = '';
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (c) => resolve({ c, o }));
    });
  });
}

async function main() {
  console.log('=== 1/5 檢查本地 Vue 3 構建產物 ===');
  const appIndex = path.join(ROOT, 'public', 'index.html');
  if (!fs.existsSync(appIndex)) {
    throw new Error('未找到 public/index.html，請先執行 npm run build:frontend');
  }
  console.log('  Vue 3 主產物存在：', appIndex);

  console.log('=== 2/5 打包更新檔案（排除 data/、node_modules） ===');
  const filesToPack = [
    'public',
    'server',
    'Dockerfile',
    'docker-compose.yml',
    'docker-entrypoint.sh',
    'package.json',
    'package-lock.json',
  ];
  await tar.c(
    {
      gzip: true,
      file: LOCAL_TAR,
      cwd: ROOT,
    },
    filesToPack
  );
  const tarSize = (fs.statSync(LOCAL_TAR).size / (1024 * 1024)).toFixed(2);
  console.log(`  壓縮完成：${LOCAL_TAR} (${tarSize} MB)`);

  console.log(`=== 3/5 連線至 NAS SFTP (埠 22) 並上傳更新包 ===`);
  const sftpConn = new Client();
  await new Promise((resolve, reject) => {
    sftpConn.on('ready', resolve);
    sftpConn.on('error', reject);
    sftpConn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });

  const remoteTar = '/docker/approval-system/temp_deploy_nas.tar.gz';
  await new Promise((resolve, reject) => {
    sftpConn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(LOCAL_TAR, remoteTar, (putErr) => {
        if (putErr) return reject(putErr);
        resolve();
      });
    });
  });
  sftpConn.end();
  console.log('  SFTP 上傳成功！');
  if (fs.existsSync(LOCAL_TAR)) fs.unlinkSync(LOCAL_TAR);

  console.log(`=== 4/5 連線至 NAS 管理 SSH (埠 ${PORT}) 執行解壓與重啟 Docker 容器 ===`);
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 15000 });
  });

  console.log('  正在解壓檔案至正式環境目錄...');
  const cleanupCmd = `rm -f ${REMOTE_DIR}/temp_deploy_nas.tar.gz`;
  const unpackRes = await execRemote(
    conn,
    `tar -xzf ${REMOTE_DIR}/temp_deploy_nas.tar.gz -C ${REMOTE_DIR} && ${cleanupCmd}`,
    true
  );
  if (unpackRes.c !== 0) {
    throw new Error(`遠端解壓失敗：${unpackRes.o}`);
  }
  console.log('  解壓完成！');

  console.log('  正在執行 docker compose up -d --build ...（可能需要 1~2 分鐘）');
  const buildRes = await execRemote(
    conn,
    `cd ${REMOTE_DIR} && /usr/local/bin/docker compose up -d --build approval-system`,
    true
  );
  console.log(buildRes.o.slice(-1500));
  if (buildRes.c !== 0) {
    throw new Error(`Docker 重建失敗，代碼：${buildRes.c}`);
  }

  console.log('=== 5/5 驗證服務狀態 ===');
  const psRes = await execRemote(conn, 'docker ps --filter name=approval', true);
  console.log(psRes.o);

  conn.end();
  console.log('\n========================================');
  console.log('🎉 NAS 正式環境升級成功（已全面切換至 Vue 3 現代版）！');
  console.log(`  系統入口網址：http://${HOST}:3847/`);
  console.log('========================================');
}

main().catch((err) => {
  console.error('部署發生錯誤：', err);
  if (fs.existsSync(LOCAL_TAR)) fs.unlinkSync(LOCAL_TAR);
  process.exit(1);
});
