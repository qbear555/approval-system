const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

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
  console.log('Connected');

  // Test piping a local file to /tmp/test_pipe.tar.gz
  const localFile = path.join(__dirname, '..', 'temp_deploy_nas.tar.gz');
  console.log('Local file exists:', fs.existsSync(localFile));

  await new Promise((resolve, reject) => {
    conn.exec('cat > /tmp/test_pipe.tar.gz', (err, stream) => {
      if (err) return reject(err);
      const rs = fs.createReadStream(localFile);
      rs.pipe(stream);
      stream.on('close', (c) => {
        console.log('Stream closed with code:', c);
        resolve();
      });
      stream.stderr.on('data', d => console.error(d.toString()));
    });
  });

  const check = await exec(conn, 'ls -lh /tmp/test_pipe.tar.gz');
  console.log('Remote file:', check.o);

  await exec(conn, 'rm -f /tmp/test_pipe.tar.gz');
  conn.end();
}

run().catch(console.error);
