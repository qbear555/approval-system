/**
 * Import accounts xlsx into Synology NAS approval.db
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PASS = process.env.NAS_PASS;
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const xlsx = process.argv[2];
const localNasDb = path.join(__dirname, '..', 'data', 'approval-nas.db');

if (!PASS || !xlsx) {
  console.error('Usage: NAS_PASS=... node scripts/import-to-nas.js <xlsx>');
  process.exit(1);
}

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
      stream.on('close', (code) => resolve({ code, o }));
    });
  });
}

function sftpGet(sftp, remote, local) {
  return new Promise((res, rej) => sftp.fastGet(remote, local, (e) => (e ? rej(e) : res())));
}
function sftpPut(sftp, local, remote) {
  return new Promise((res, rej) => sftp.fastPut(local, remote, (e) => (e ? rej(e) : res())));
}

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      console.log('Stop container...');
      let r = await exec(conn, '/usr/local/bin/docker stop approval-system || true', true);
      console.log(r.o.trim());
      await new Promise((r) => setTimeout(r, 2000));

      console.log('Download NAS DB...');
      const sftp = await new Promise((res, rej) =>
        conn.sftp((e, s) => (e ? rej(e) : res(s)))
      );
      await sftpGet(sftp, '/docker/approval-system/data/approval.db', localNasDb);
      console.log('size', fs.statSync(localNasDb).size);

      console.log('Import...');
      const imp = spawnSync(
        process.execPath,
        [path.join(__dirname, 'import-accounts-xlsx.js'), xlsx, localNasDb],
        { stdio: 'inherit' }
      );
      if (imp.status !== 0) throw new Error('import failed');

      // drop wal files after checkpoint in import
      for (const s of ['-wal', '-shm']) {
        const p = localNasDb + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }

      console.log('Upload DB...');
      await sftpPut(sftp, localNasDb, '/docker/approval-system/data/approval.db');
      await exec(
        conn,
        'rm -f /volume1/docker/approval-system/data/approval.db-wal /volume1/docker/approval-system/data/approval.db-shm; chmod a+rw /volume1/docker/approval-system/data/approval.db || true'
      );

      console.log('Start container...');
      r = await exec(
        conn,
        'cd /volume1/docker/approval-system && /usr/local/bin/docker compose up -d',
        true
      );
      console.log(r.o.trim(), 'code', r.code);
      conn.end();
      console.log('OK');
    } catch (e) {
      console.error(e);
      try {
        await exec(
          conn,
          'cd /volume1/docker/approval-system && /usr/local/bin/docker compose up -d',
          true
        );
      } catch {
        /* ignore */
      }
      conn.end();
      process.exit(1);
    }
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
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
