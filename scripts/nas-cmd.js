const { Client } = require('ssh2');

const PASS = process.env.NAS_PASS || '';
if (!PASS) {
  console.error('請設定環境變數 NAS_PASS=***');
  process.exit(1);
}
const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 9922);
const USER = process.env.NAS_USER || 'tsuming';

function execRemote(conn, cmd, sudo = false) {
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
  const cmd = process.argv.slice(2).join(' ') || 'docker ps -a';
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 10000 });
  });

  const res = await execRemote(conn, cmd, true);
  console.log(res.o);
  conn.end();
}

main().catch(console.error);
