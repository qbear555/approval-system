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

async function run() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 10000 });
  });

  const res = await exec(conn, `cd /volume1/docker/approval-system/data && rm -f /tmp/test_data.zip && zip -q -r /tmp/test_data.zip .`, true);
  console.log('sudo zip exit code:', res.c, 'output:', res.o);

  const res2 = await exec(conn, 'ls -la /tmp/test_data.zip', true);
  console.log('zip file stat:', res2.o);

  await exec(conn, 'rm -f /tmp/test_data.zip', true);

  conn.end();
}

run().catch(console.error);
