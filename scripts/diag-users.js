const { Client } = require('ssh2');

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
    `/volume1/@appstore/MariaDB10/usr/local/mariadb10.11/bin/mysql -u approval -pWw837*5630 approval -e "DESCRIBE users;"`,
    true
  );
  console.log('Users columns:\n', res.o);

  conn.end();
}

main().catch(console.error);
