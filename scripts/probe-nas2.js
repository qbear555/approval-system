const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS;
const conn = new Client();

function run(conn, cmd, sudo = false) {
  return new Promise((resolve) => {
    const full = sudo ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' ${cmd}` : cmd;
    conn.exec(full, (err, stream) => {
      let o = '';
      if (err) return resolve({ code: -1, o: String(err) });
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (code) => {
        console.log('\n###', cmd, '=>', code);
        console.log(o.trim());
        resolve({ code, o });
      });
    });
  });
}

conn
  .on('ready', async () => {
    await run(conn, 'ls -la /volume1/docker');
    await run(conn, 'rm -rf /volume1/docker/approval-system', true);
    await run(conn, 'ls -la /volume1/docker');
    // create as normal user
    await run(conn, 'mkdir -p /volume1/docker/approval-system/data/uploads && touch /volume1/docker/approval-system/write-test && ls -la /volume1/docker/approval-system');
    // try home
    await run(
      conn,
      'mkdir -p $HOME/approval-system/data && touch $HOME/approval-system/write-test && ls -la $HOME/approval-system'
    );
    // docker path details
    await run(conn, 'ls -la /usr/local/bin/docker; file /usr/local/bin/docker; /usr/local/bin/docker --version', true);
    await run(conn, 'ls /usr/local/lib/docker 2>&1 | head; ls /var/packages/ContainerManager/target/usr/bin 2>&1 | head', true);
    await run(conn, 'find /var/packages/ContainerManager -name docker -type f 2>/dev/null | head', true);
    await run(conn, 'ls -la /usr/local/bin/ | head -40', true);
    conn.end();
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
