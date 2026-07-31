/**
 * Deploy NAS install package to Synology (code only, keep data).
 * Usage:
 *   set NAS_PASS=***
 *   set NAS_SKIP_DB=1
 *   set NAS_PKG=D:\一鍵安裝包\NAS\ApprovalSystem-NAS-Install
 *   node scripts/deploy-nas-package.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 22);
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
const REMOTE_DIR = process.env.NAS_DIR || '/volume1/docker/approval-system';
const SFTP_DIR = process.env.NAS_SFTP_DIR || '/docker/approval-system';
const DOCKER = process.env.NAS_DOCKER || '/usr/local/bin/docker';
const SKIP_DB = /^(1|true|yes)$/i.test(String(process.env.NAS_SKIP_DB || '1'));

function resolvePkg() {
  if (process.env.NAS_PKG && fs.existsSync(process.env.NAS_PKG)) {
    return path.resolve(process.env.NAS_PKG);
  }
  // Auto-find D:\*\NAS\ApprovalSystem-NAS-Install
  const drives = ['D:\\', 'C:\\Users\\TsuMing\\Documents\\approval-system\\dist\\'];
  for (const root of drives) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const cand = path.join(root, name, 'NAS', 'ApprovalSystem-NAS-Install');
      if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
      const cand2 = path.join(root, name, 'ApprovalSystem-NAS-Install');
      if (fs.existsSync(path.join(cand2, 'package.json'))) return cand2;
    }
  }
  const fallback = path.join(__dirname, '..', 'dist', 'ApprovalSystem-NAS-Install');
  if (fs.existsSync(fallback)) return fallback;
  throw new Error('Cannot find ApprovalSystem-NAS-Install package. Set NAS_PKG=');
}

const ROOT = resolvePkg();

const UPLOAD_DIRS = ['server', 'public', 'docs', 'fonts', 'seed-workflows'];
const UPLOAD_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'README.md',
  'CHANGELOG.md',
  'start-server.js',
  'deploy.sh',
];

if (!PASS) {
  console.error('Set NAS_PASS environment variable');
  process.exit(1);
}

console.log('Package root:', ROOT);
console.log('Target:', `${USER}@${HOST}:${REMOTE_DIR}`);
console.log('Skip DB:', SKIP_DB);

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: {
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ssh-rsa',
            'ssh-dss',
          ],
        },
      });
  });
}

function exec(conn, cmd, { sudo = false } = {}) {
  const wrapped = `export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; ${cmd}`;
  const full = sudo
    ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' -E env "PATH=/usr/local/bin:/usr/bin:/bin" sh -lc ${JSON.stringify(cmd)}`
    : `sh -lc ${JSON.stringify(wrapped)}`;
  return new Promise((resolve, reject) => {
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
          process.stdout.write(d);
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function mkdirp(sftpClient, remotePath) {
  const parts = remotePath.split('/').filter(Boolean);
  let cur = '';
  return parts.reduce(async (prev, part) => {
    await prev;
    cur += '/' + part;
    try {
      await new Promise((resolve, reject) => {
        sftpClient.mkdir(cur, (err) => {
          if (!err || err.code === 4 || err.code === 11) resolve();
          else if (String(err.message || '').includes('Failure')) resolve();
          else reject(err);
        });
      });
    } catch {
      /* ignore */
    }
  }, Promise.resolve());
}

function uploadFile(sftpClient, local, remote) {
  return new Promise((resolve, reject) => {
    sftpClient.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function uploadDir(sftpClient, localDir, remoteDir) {
  await mkdirp(sftpClient, remoteDir);
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const ent of entries) {
    const lp = path.join(localDir, ent.name);
    const rp = remoteDir + '/' + ent.name;
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'data') continue;
      await uploadDir(sftpClient, lp, rp);
    } else {
      if (/\.(log|db-wal|db-shm)$/i.test(ent.name)) continue;
      process.stdout.write(`  put ${rp}\n`);
      await uploadFile(sftpClient, lp, rp);
    }
  }
}

async function main() {
  // Ensure LF for entrypoint
  const ep = path.join(ROOT, 'docker-entrypoint.sh');
  if (fs.existsSync(ep)) {
    let t = fs.readFileSync(ep, 'utf8');
    t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    fs.writeFileSync(ep, t, 'utf8');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  console.log(`Deploying version ${pkg.version} ...`);

  console.log(`Connecting ${USER}@${HOST}:${PORT} ...`);
  const conn = await connect();
  console.log('SSH OK');

  // Backup DB on NAS before update (safety)
  console.log('Backup NAS database on remote...');
  await exec(
    conn,
    `mkdir -p ${REMOTE_DIR}/data/_deploy_backup; ` +
      `ts=$(date +%Y%m%d-%H%M%S); ` +
      `if [ -f ${REMOTE_DIR}/data/approval.db ]; then cp -a ${REMOTE_DIR}/data/approval.db ${REMOTE_DIR}/data/_deploy_backup/approval.db.$ts; echo backup_ok_$ts; else echo no_db; fi`,
    { sudo: true }
  );

  await exec(
    conn,
    `${DOCKER} stop approval-system 2>/dev/null || true; ${DOCKER} rm approval-system 2>/dev/null || true`,
    { sudo: true }
  );

  let r = await exec(
    conn,
    `mkdir -p ${REMOTE_DIR}/data/uploads ${REMOTE_DIR}/data/backups ${REMOTE_DIR}/data/mail-outbox ${REMOTE_DIR}/data/certs ${REMOTE_DIR}/data/branding; chmod -R a+rwX ${REMOTE_DIR}/data 2>/dev/null || true; ls -la ${REMOTE_DIR}`
  );
  if (r.code !== 0) throw new Error('Failed to prepare remote directory');

  const s = await sftp(conn);
  console.log(`SFTP OK — upload root ${SFTP_DIR}`);
  await mkdirp(s, SFTP_DIR + '/data');

  console.log('Upload project files...');
  for (const f of UPLOAD_FILES) {
    const lp = path.join(ROOT, f);
    if (!fs.existsSync(lp)) {
      console.warn('  skip missing', f);
      continue;
    }
    process.stdout.write(`  put ${f}\n`);
    await uploadFile(s, lp, SFTP_DIR + '/' + f);
  }
  for (const d of UPLOAD_DIRS) {
    const lp = path.join(ROOT, d);
    if (!fs.existsSync(lp)) continue;
    console.log(`  dir ${d}/`);
    await uploadDir(s, lp, SFTP_DIR + '/' + d);
  }

  if (SKIP_DB) {
    console.log('Skip database upload — keep NAS data as-is');
  } else {
    const seedDb = path.join(ROOT, 'data', 'approval.db');
    if (fs.existsSync(seedDb)) {
      console.log('Upload package seed database');
      await uploadFile(s, seedDb, SFTP_DIR + '/data/approval.db');
    }
  }

  await exec(conn, `chmod -R a+rwX ${REMOTE_DIR}/data 2>/dev/null || true; chmod +x ${REMOTE_DIR}/docker-entrypoint.sh 2>/dev/null || true`);

  console.log('Detect docker...');
  r = await exec(conn, `${DOCKER} --version`, { sudo: true });
  if (r.code !== 0) throw new Error('Docker not available');

  console.log('\nBuild & start container...');
  const composeCmd =
    `cd ${REMOTE_DIR} && ` +
    `(${DOCKER} compose version >/dev/null 2>&1 && ${DOCKER} compose up -d --build) || ` +
    `(/usr/local/bin/docker-compose version >/dev/null 2>&1 && /usr/local/bin/docker-compose up -d --build)`;
  r = await exec(conn, composeCmd, { sudo: true });
  console.log('\n--- compose exit', r.code);
  if (r.code !== 0) throw new Error('docker compose failed');

  // wait a few seconds for openssl + node
  await exec(conn, 'sleep 5');

  console.log('Container status...');
  await exec(conn, `${DOCKER} ps -a --filter name=approval-system`, { sudo: true });
  console.log('Recent logs...');
  await exec(conn, `${DOCKER} logs --tail 60 approval-system 2>&1 || true`, { sudo: true });

  console.log('\nHealth checks...');
  await exec(
    conn,
    'curl -s -o /dev/null -w "http_3847=%{http_code}\\n" http://127.0.0.1:3847/api/departments || true; ' +
      'curl -sk -o /dev/null -w "https_3848=%{http_code}\\n" https://127.0.0.1:3848/api/departments || true; ' +
      'curl -s http://127.0.0.1:3847/api/system/version 2>/dev/null || curl -s http://127.0.0.1:3847/api/version 2>/dev/null || true'
  );

  conn.end();
  console.log('\nDONE v' + pkg.version);
  console.log(`HTTP:  http://${HOST}:3847`);
  console.log(`HTTPS: https://${HOST}:3848`);
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e.message || e);
  process.exit(1);
});
