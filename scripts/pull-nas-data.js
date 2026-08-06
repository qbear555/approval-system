/**
 * 自 Synology NAS 拉取完整業務資料到本機 data/
 * 包含：approval.db、uploads、backups、mail-config.json
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const SFTP_DATA = '/docker/approval-system/data';
const ROOT = path.join(__dirname, '..');
const LOCAL_DATA = path.join(ROOT, 'data');
const SNAPSHOT = path.join(ROOT, 'dist', 'nas-snapshot');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
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
    ensureDir(path.dirname(local));
    sftp.fastGet(remote, local, (e) => (e ? rej(e) : res()));
  });
}

async function downloadTree(sftp, remoteDir, localDir) {
  ensureDir(localDir);
  let entries = [];
  try {
    entries = await list(sftp, remoteDir);
  } catch (e) {
    console.warn('skip list', remoteDir, e.message);
    return;
  }
  for (const ent of entries) {
    const name = ent.filename;
    if (name === '.' || name === '..') continue;
    // skip logs
    if (/\.log$/i.test(name)) continue;
    if (/^test-|^api-pdf|^font-test|^chinese-fix/i.test(name)) continue;
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

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    const full = `echo ${JSON.stringify(PASS)} | sudo -S -p '' sh -c ${JSON.stringify(cmd)}`;
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
  ensureDir(LOCAL_DATA);
  ensureDir(SNAPSHOT);

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        username: USER,
        password: PASS,
        readyTimeout: 60000,
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
        },
      });
  });

  try {
    // Checkpoint DB inside container
    console.log('Checkpoint SQLite in container...');
    const ck = await exec(
      conn,
      `/usr/local/bin/docker exec approval-system node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('/app/data/approval.db'); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close(); console.log('checkpoint ok');"`
    );
    console.log(ck.o.trim());

    const sftp = await getSftp(conn);
    console.log('Downloading NAS data →', SNAPSHOT);
    // clear snapshot (keep structure)
    fs.rmSync(SNAPSHOT, { recursive: true, force: true });
    ensureDir(SNAPSHOT);

    await downloadTree(sftp, SFTP_DATA, SNAPSHOT);

    // Copy critical files into project data/
    // Clean stale WAL/SHM in local data before copying DB
    fs.rmSync(path.join(LOCAL_DATA, 'approval.db-wal'), { force: true });
    fs.rmSync(path.join(LOCAL_DATA, 'approval.db-shm'), { force: true });

    const files = ['approval.db', 'approval.db-wal', 'approval.db-shm', 'mail-config.json'];
    for (const f of files) {
      const src = path.join(SNAPSHOT, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(LOCAL_DATA, f));
        console.log('updated local data/', f);
      }
    }
    for (const dir of ['uploads', 'backups', 'mail-outbox', 'calendar']) {
      const src = path.join(SNAPSHOT, dir);
      const dest = path.join(LOCAL_DATA, dir);
      if (fs.existsSync(src)) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true });
        console.log('updated local data/', dir);
      }
    }

    // Stats
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(LOCAL_DATA, 'approval.db');
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath);
      const stats = {
        users: db.prepare(`SELECT COUNT(*) AS c FROM users WHERE active=1`).get().c,
        workflows: db
          .prepare(
            `SELECT COUNT(*) AS c FROM workflows WHERE active=1 AND IFNULL(purged,0)=0`
          )
          .get().c,
        requests: db.prepare(`SELECT COUNT(*) AS c FROM approval_requests`).get().c,
        depts: db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE active=1`).get().c,
      };
      db.close();
      console.log('NAS data stats:', stats);
      fs.writeFileSync(
        path.join(SNAPSHOT, 'SNAPSHOT-INFO.json'),
        JSON.stringify(
          { at: new Date().toISOString(), host: HOST, stats, source: SFTP_DATA },
          null,
          2
        ),
        'utf8'
      );
    }
    console.log('PULL NAS DATA OK');
  } finally {
    conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
