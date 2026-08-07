/** Upload code files and rebuild container (does NOT overwrite data/approval.db) */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const PASS = process.env.NAS_PASS;
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const SFTP_DIR = '/docker/approval-system';
const REMOTE_DIR = '/volume1/docker/approval-system';
const ROOT = path.join(__dirname, '..');

// 根目錄要部署的單檔
const ROOT_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  'package.json',
  'package-lock.json',
];

// 整個目錄遞迴部署（不再用手寫白名單，避免漏檔造成模組半套）
const CODE_DIRS = ['server', 'public'];

/** 遞迴列出目錄下所有檔案，回傳相對於 ROOT 的 posix 路徑 */
function walk(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const relPath = relDir + '/' + name;
    const st = fs.statSync(path.join(ROOT, relPath));
    if (st.isDirectory()) out.push(...walk(relPath));
    else out.push(relPath);
  }
  return out;
}

const FILES = [...ROOT_FILES, ...CODE_DIRS.flatMap((d) => walk(d))];

function exec(conn, cmd, sudo = false) {
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

function put(sftp, local, remote) {
  return new Promise((res, rej) => sftp.fastPut(local, remote, (e) => (e ? rej(e) : res())));
}

async function ensureDir(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    await new Promise((resolve) => {
      sftp.mkdir(cur, () => resolve());
    });
  }
}

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      const sftp = await new Promise((res, rej) =>
        conn.sftp((e, s) => (e ? rej(e) : res(s)))
      );
      for (const f of FILES) {
        const lp = path.join(ROOT, f);
        if (!fs.existsSync(lp)) {
          console.log('skip missing', f);
          continue;
        }
        if (fs.statSync(lp).isDirectory()) continue;
        const rp = SFTP_DIR + '/' + f.replace(/\\/g, '/');
        await ensureDir(sftp, path.posix.dirname(rp));
        console.log('put', rp);
        await put(sftp, lp, rp);
      }
      // fonts if any
      const fontsDir = path.join(ROOT, 'fonts');
      if (fs.existsSync(fontsDir)) {
        for (const name of fs.readdirSync(fontsDir)) {
          const lp = path.join(fontsDir, name);
          if (!fs.statSync(lp).isFile()) continue;
          const rp = SFTP_DIR + '/fonts/' + name;
          await ensureDir(sftp, SFTP_DIR + '/fonts');
          console.log('put', rp);
          await put(sftp, lp, rp);
        }
      }
      console.log('docker compose build...');
      const r = await exec(
        conn,
        `cd ${REMOTE_DIR} && /usr/local/bin/docker compose up -d --build`,
        true
      );
      console.log(r.o.slice(-1200));
      console.log('exit', r.c);
      conn.end();
      if (r.c !== 0) process.exit(r.c);
      console.log('NAS code deploy OK');
    } catch (e) {
      console.error(e);
      conn.end();
      process.exit(1);
    }
  })
  .connect({
    host: HOST,
    username: USER,
    password: PASS,
    readyTimeout: 30000,
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
    },
  });
