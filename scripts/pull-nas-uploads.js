/**
 * Sync uploads from Synology NAS to Local Windows and WSL Ubuntu
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const PASS = process.env.NAS_PASS || '';
if (!PASS) {
  console.error('請設定環境變數 NAS_PASS=***');
  process.exit(1);
}
const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 9922);
const USER = process.env.NAS_USER || 'tsuming';

const REMOTE_UPLOADS = '/volume1/docker/approval-system/data/uploads';
const LOCAL_UPLOADS = path.join(__dirname, '..', 'data', 'uploads');

if (!fs.existsSync(LOCAL_UPLOADS)) {
  fs.mkdirSync(LOCAL_UPLOADS, { recursive: true });
}

async function main() {
  console.log(`[1/3] 連線至 NAS ${HOST}:${PORT}...`);
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 15000 });
  });

  console.log(`[2/3] 從 NAS 串流打包下載 uploads 目錄...`);
  const tarStream = tar.x({
    cwd: LOCAL_UPLOADS,
    strip: 0,
  });

  let bytes = 0;
  await new Promise((resolve, reject) => {
    tarStream.on('finish', resolve);
    tarStream.on('error', reject);

    const cmd = `echo ${JSON.stringify(PASS)} | sudo -S -p '' tar -czf - -C ${REMOTE_UPLOADS} .`;
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (d) => {
        bytes += d.length;
        if (bytes % (10 * 1024 * 1024) < d.length) {
          process.stdout.write(`  已接收 ${(bytes / (1024 * 1024)).toFixed(1)} MB...\r`);
        }
      });
      stream.on('error', reject);
      stream.pipe(tarStream);
    });
  });

  console.log(`\n  下載解壓完成！共接收 ${(bytes / (1024 * 1024)).toFixed(1)} MB 壓縮資料。`);
  conn.end();

  const count = fs.readdirSync(LOCAL_UPLOADS).length;
  console.log(`[3/3] 本機 data/uploads 現有 ${count} 個檔案。`);
}

main().catch((err) => {
  console.error('同步 uploads 失敗：', err);
  process.exit(1);
});
