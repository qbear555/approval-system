const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS;
const conn = new Client();

conn
  .on('ready', () => {
    conn.sftp(async (err, sftp) => {
      if (err) {
        console.error(err);
        conn.end();
        return;
      }
      const list = (p) =>
        new Promise((resolve) => {
          sftp.readdir(p, (e, list) => {
            console.log('\nLIST', p, e ? e.message : 'ok');
            if (list) list.slice(0, 20).forEach((f) => console.log(' ', f.longname || f.filename));
            resolve();
          });
        });
      const put = (remote) =>
        new Promise((resolve) => {
          const buf = Buffer.from('test\n');
          sftp.writeFile(remote, buf, (e) => {
            console.log('PUT', remote, e ? e.message : 'ok');
            resolve();
          });
        });

      (async () => {
        await list('.');
        await list('/');
        await list('/docker');
        await list('/volume1');
        await list('/volume1/docker');
        await list('/homes');
        await list('/var/services/homes/tsuming');
        await put('/docker/approval-system/sftp-test.txt');
        await put('./approval-sftp-test.txt');
        await put('/volume1/docker/approval-system/sftp-test2.txt');
        conn.end();
      })();
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
