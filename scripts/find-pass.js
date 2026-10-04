const { Client } = require('ssh2');
const bcrypt = require('bcryptjs');

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

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS });
  });

  const res = await exec(
    conn,
    `/volume1/@appstore/MariaDB10/usr/local/mariadb10.11/bin/mysql -u approval -pWw837*5630 approval -e "SELECT id, username, password_hash FROM users WHERE active=1 LIMIT 5;"`,
    true
  );
  
  const lines = res.o.trim().split('\n').slice(1);
  const commonPass = ['admin123', 'password', '123456', 'admin', 'password123', 'Ww837*5630', '1234', '12345678'];

  for (const line of lines) {
    const [id, username, hash] = line.split('\t');
    if (!hash) continue;
    for (const p of commonPass) {
      if (bcrypt.compareSync(p, hash)) {
        console.log(`FOUND password for ${username}: "${p}"`);
        conn.end();
        return;
      }
    }
  }
  console.log('No common password matched');
  conn.end();
}

main().catch(console.error);
