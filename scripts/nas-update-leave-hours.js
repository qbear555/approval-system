/** Run leave hours field update inside NAS container DB */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const script = fs.readFileSync(
  path.join(__dirname, 'update-leave-hours-field.js'),
  'utf8'
);
// adapt path for container
const remote = script.replace(
  /process\.argv\[2\] \|\| path\.join\(__dirname, '\.\.', 'data', 'approval\.db'\)/,
  "'/app/data/approval.db'"
);

const conn = new Client();
conn
  .on('ready', () => {
    const b64 = Buffer.from(remote).toString('base64');
    const cmd = `echo ${JSON.stringify(PASS)} | sudo -S -p '' /usr/local/bin/docker exec approval-system node -e "eval(Buffer.from('${b64}','base64').toString())"`;
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
    host: HOST,
    username: USER,
    password: PASS,
    readyTimeout: 30000,
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
    },
  });
