const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS;
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const conn = new Client();
conn
  .on('ready', async () => {
    const run = (cmd, sudo = false) =>
      new Promise((resolve) => {
        const full = sudo
          ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' ${cmd}`
          : cmd;
        conn.exec(full, (err, stream) => {
          if (err) {
            console.log('exec err', err.message);
            return resolve();
          }
          let o = '';
          stream.on('data', (d) => (o += d));
          stream.stderr.on('data', (d) => (o += d));
          stream.on('close', (code) => {
            console.log('\n###', cmd, '=>', code);
            console.log(o.trim());
            resolve(o);
          });
        });
      });

    await run('ls -la /volume1');
    await run('ls -la /volume1/docker 2>&1 || echo no-docker-share');
    await run('df -h');
    await run('id; groups');
    await run('ls -la /var/services/homes 2>&1 | head');
    await run('echo $HOME; ls -la $HOME | head');
    await run('mkdir -p /volume1/docker/approval-system/data', true);
    await run('ls -la /volume1/docker 2>&1 || true', true);
    await run('which docker; docker --version 2>&1; ls /usr/local/bin/docker 2>&1');
    await run('docker --version 2>&1', true);
    await run('synoshare --get docker 2>&1 || true', true);
    conn.end();
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
