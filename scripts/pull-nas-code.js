/**
 * 從 NAS 拉取程式碼到本機（不覆蓋 data/）
 * 適用情境：NAS 為主要編輯環境，同步程式碼到本機
 *
 * Usage:
 *   set NAS_PASS=***
 *   node scripts/pull-nas-code.js
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const SFTP_DIR = '/docker/approval-system';
const ROOT = path.join(__dirname, '..');

// 要從 NAS 拉回的目錄（不含 data/）
const PULL_DIRS = ['server', 'public', 'fonts', 'docs', 'seed-workflows'];

// 要從 NAS 拉回的單一檔案
const PULL_FILES = [
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore',
  'start-server.js',
  'CHANGELOG.md',
  'README.md',
];

if (!PASS) {
  console.error('[ERR] 請設定 NAS_PASS 環境變數');
  process.exit(1);
}

function getSftp(conn) {
  return new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
}

function list(sftp, dir) {
  return new Promise((res, rej) =>
    sftp.readdir(dir, (e, list) => (e ? rej(e) : res(list || [])))
  );
}

function download(sftp, remote, local) {
  return new Promise((res, rej) => {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    sftp.fastGet(remote, local, (e) => (e ? rej(e) : res()));
  });
}

async function downloadTree(sftp, remoteDir, localDir) {
  fs.mkdirSync(localDir, { recursive: true });
  let entries = [];
  try {
    entries = await list(sftp, remoteDir);
  } catch (e) {
    console.warn('  skip list', remoteDir, e.message);
    return;
  }
  for (const ent of entries) {
    const name = ent.filename;
    if (name === '.' || name === '..') continue;
    if (name === 'node_modules' || name === 'data') continue;
    if (/\.(log|db-wal|db-shm)$/i.test(name)) continue;
    const r = remoteDir + '/' + name;
    const l = path.join(localDir, name);
    const isDir = (ent.attrs.mode & 0o170000) === 0o040000;
    if (isDir) {
      await downloadTree(sftp, r, l);
    } else {
      process.stdout.write(`  get ${r}\n`);
      await download(sftp, r, l);
    }
  }
}

async function main() {
  if (!PASS) {
    console.error('[ERR] NAS_PASS 未設定');
    process.exit(1);
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
        },
      });
  });
  console.log(`SSH OK → ${USER}@${HOST}`);

  try {
    const sftp = await getSftp(conn);

    // 拉取目錄
    for (const d of PULL_DIRS) {
      const remoteDir = SFTP_DIR + '/' + d;
      const localDir = path.join(ROOT, d);
      console.log(`\n[DIR] ${d}/`);
      // 清除本機舊版本後重新下載
      if (fs.existsSync(localDir)) {
        fs.rmSync(localDir, { recursive: true, force: true });
      }
      await downloadTree(sftp, remoteDir, localDir);
    }

    // 拉取單一檔案
    for (const f of PULL_FILES) {
      const remotePath = SFTP_DIR + '/' + f;
      const localPath = path.join(ROOT, f);
      try {
        process.stdout.write(`  get ${remotePath}\n`);
        await download(sftp, remotePath, localPath);
      } catch (e) {
        console.warn(`  skip ${f}: ${e.message}`);
      }
    }

    console.log('\n✅ PULL NAS CODE OK');
    console.log('本機路徑:', ROOT);
  } finally {
    conn.end();
  }
}

main().catch((e) => {
  console.error('PULL FAILED:', e.message || e);
  process.exit(1);
});
