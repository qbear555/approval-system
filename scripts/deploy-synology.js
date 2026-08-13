/**
 * Deploy approval-system to Synology NAS via SSH/SFTP.
 * Usage:
 *   set NAS_HOST=192.168.99.220
 *   set NAS_USER=tsuming
 *   set NAS_PASS=***
 *   node scripts/deploy-synology.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 22);
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
// Shell/docker absolute path on DSM volume
const REMOTE_DIR = process.env.NAS_DIR || '/volume1/docker/approval-system';
// SFTP on Synology is chrooted to shared folders (no /volume1 prefix)
const SFTP_DIR = process.env.NAS_SFTP_DIR || '/docker/approval-system';
const ROOT = path.join(__dirname, '..');
const DOCKER = process.env.NAS_DOCKER || '/usr/local/bin/docker';

if (!PASS) {
  console.error('Set NAS_PASS environment variable');
  process.exit(1);
}

const UPLOAD_DIRS = ['server', 'public', 'docs', 'fonts'];
const UPLOAD_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'README.md',
];
const SKIP_DB = /^(1|true|yes)$/i.test(String(process.env.NAS_SKIP_DB || ''));

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
          // Synology may use older host key types
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
  // Synology: docker lives in /usr/local/bin; sudo may reset PATH
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
        .on('close', (code) => {
          resolve({ code, stdout, stderr });
        })
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
          if (!err || err.code === 4 || err.code === 11) resolve(); // exists
          else if (String(err.message || '').includes('Failure')) resolve();
          else reject(err);
        });
      });
    } catch {
      /* ignore exists */
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
    // skip tests / junk
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
  console.log(`Connecting ${USER}@${HOST}:${PORT} ...`);
  const conn = await connect();
  console.log('SSH OK');

  console.log(`Prepare remote shell path ${REMOTE_DIR} ...`);
  // stop container first so data files are not locked by node user
  await exec(
    conn,
    `${DOCKER} stop approval-system 2>/dev/null || true; ${DOCKER} rm approval-system 2>/dev/null || true`,
    { sudo: true }
  );
  let r = await exec(
    conn,
    `mkdir -p ${REMOTE_DIR}/data/uploads ${REMOTE_DIR}/data/backups ${REMOTE_DIR}/data/mail-outbox; chmod -R a+rwX ${REMOTE_DIR}/data 2>/dev/null || true; touch ${REMOTE_DIR}/.write-ok; ls -la ${REMOTE_DIR}`
  );
  if (r.code !== 0) {
    throw new Error('Failed to prepare remote directory (need write access to docker share)');
  }

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

  // Database: skip by default when NAS_SKIP_DB=1 (code-only deploy / HTTPS update)
  if (SKIP_DB) {
    console.log('Skip database upload (NAS_SKIP_DB=1) — keep NAS data as-is');
  } else {
    // Database backup prefer D:\電子簽核\approval.db then local data
    const dbCandidates = [
      'D:\\電子簽核\\approval.db',
      path.join(ROOT, 'data', 'approval.db'),
    ];
    for (const db of dbCandidates) {
      if (fs.existsSync(db)) {
        console.log('Upload database:', db);
        await uploadFile(s, db, SFTP_DIR + '/data/approval.db');
        break;
      }
    }
  }

  // ensure container can write DB/uploads (best-effort; Synology ACL may block some files)
  await exec(conn, `chmod -R a+rwX ${REMOTE_DIR}/data 2>/dev/null || true`);

  console.log('Detect docker...');
  r = await exec(conn, `${DOCKER} --version`, { sudo: true });
  console.log('\n--- docker version exit', r.code);
  if (r.code !== 0) {
    throw new Error('Docker not available at ' + DOCKER);
  }

  console.log('\nBuild & start container (this may take several minutes)...');
  // Synology has both `docker compose` plugin and `docker-compose` binary
  const composeCmd =
    `cd ${REMOTE_DIR} && ` +
    `(${DOCKER} compose version >/dev/null 2>&1 && ${DOCKER} compose up -d --build) || ` +
    `(/usr/local/bin/docker-compose version >/dev/null 2>&1 && /usr/local/bin/docker-compose up -d --build)`;

  r = await exec(conn, composeCmd, { sudo: true });
  console.log('\n--- compose exit', r.code);
  if (r.code !== 0) {
    throw new Error('docker compose failed — see log above');
  }

  console.log('Container status...');
  await exec(conn, `${DOCKER} ps -a --filter name=approval-system`, { sudo: true });

  console.log('Recent logs...');
  await exec(conn, `${DOCKER} logs --tail 50 approval-system 2>&1 || true`, { sudo: true });

  // health check from NAS
  console.log('\nLocal health from NAS...');
  await exec(
    conn,
    'curl -s -o /dev/null -w "http_3847=%{http_code}\\n" http://127.0.0.1:3847/api/departments || true'
  );
  await exec(
    conn,
    'curl -sk -o /dev/null -w "https_3848=%{http_code}\\n" https://127.0.0.1:3848/api/departments || true'
  );

  conn.end();
  console.log('\nDONE');
  console.log(`HTTP:  http://${HOST}:3847`);
  console.log(`HTTPS: https://${HOST}:3848  (self-signed — browser may warn)`);
  console.log('If fresh DB: admin / admin123 — change immediately.');
  console.log('SECURITY: change NAS password (shared in chat) ASAP.');
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e.message || e);
  process.exit(1);
});
