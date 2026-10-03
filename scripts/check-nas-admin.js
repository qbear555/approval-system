const { Client } = require('../dist/ApprovalSystem-Portable/app/node_modules/ssh2');

const PASS = 'Ww837*5630';
const HOST = '192.168.99.220';
const PORT = 9922;
const USER = 'tsuming';

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

async function run() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 10000 });
  });
  console.log('Connected to NAS via SSH');

  // 1. 在容器內查詢 admin
  const res1 = await exec(conn, "docker exec approval-system node -e \"const db = require('./server/db'); const u = db.prepare('SELECT id, username, name, password_hash, active FROM users WHERE LOWER(username)=?').get('admin'); console.log(JSON.stringify(u));\"", true);
  console.log('Admin Query Result:', res1.o);

  conn.end();
}

run().catch(console.error);
