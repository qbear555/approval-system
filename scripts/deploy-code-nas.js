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

const FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'package.json',
  'package-lock.json',
  'server/index.js',
  'server/db.js',
  'server/auth.js',
  'server/pdf.js',
  'server/mail.js',
  'server/backup.js',
  'server/system-package.js',
  'server/import-workflows.js',
  'server/export-workflows.js',
  'server/labor.js',
  'server/leave-report.js',
  'public/js/app.js',
  'public/js/tw-calendar.js',
  'public/css/style.css',
  'public/index.html',
];

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
