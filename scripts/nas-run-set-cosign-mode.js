const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const PASS = process.env.NAS_PASS || '';
const code = fs.readFileSync(path.join(__dirname, 'set-cosign-mode-all.js'), 'utf8');
const conn = new Client();
conn
  .on('ready', () => {
    const b64 = Buffer.from(code).toString('base64');
    const cmd = `echo ${JSON.stringify(PASS)} | sudo -S -p '' sh -c ${JSON.stringify(
      `echo ${JSON.stringify(b64)} | base64 -d > /tmp/sc.js && /usr/local/bin/docker cp /tmp/sc.js approval-system:/tmp/sc.js && /usr/local/bin/docker exec approval-system node /tmp/sc.js /app/data/approval.db`
    )}`;
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        conn.end();
        process.exit(1);
      }
      let o = '';
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (c) => {
        console.log(o);
        conn.end();
        process.exit(c || 0);
      });
    });
  })
  .connect({
    host: process.env.NAS_HOST || '192.168.99.220',
    username: process.env.NAS_USER || 'tsuming',
    password: PASS,
    readyTimeout: 30000,
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
    },
  });
