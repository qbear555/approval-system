/**
 * 強制上傳製作數位簽章相關檔 + no-cache 重建 NAS 容器
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const PASS = process.env.NAS_PASS || '';
const HOST = '192.168.99.220';
const USER = 'tsuming';
const SFTP = '/docker/approval-system';
const REMOTE = '/volume1/docker/approval-system';
const DOCKER = '/usr/local/bin/docker';
const ROOT = path.resolve(__dirname, '..');

if (!PASS) {
  console.error('NAS_PASS required');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c))
      .on('error', reject)
      .connect({
        host: HOST,
        port: 22,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
        },
      });
  });
}

function exec(conn, cmd) {
  const full = `echo ${JSON.stringify(PASS)} | sudo -S -p '' sh -lc ${JSON.stringify(
    `export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; ${cmd}`
  )}`;
  return new Promise((resolve, reject) => {
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      stream
        .on('close', (code) => resolve({ code, stdout }))
        .on('data', (d) => {
          stdout += d.toString();
          process.stdout.write(d);
        });
      stream.stderr.on('data', (d) => process.stderr.write(d));
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function put(s, local, remote) {
  return new Promise((resolve, reject) => {
    s.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const conn = await connect();
  console.log('SSH OK');
  const s = await sftp(conn);

  const files = [
    'server/system-settings.js',
    'server/index.js',
    'server/pdf-sign.js',
    'public/js/app.js',
    'package.json',
    'package-lock.json',
  ];
  for (const rel of files) {
    const local = path.join(ROOT, rel);
    if (!fs.existsSync(local)) {
      console.warn('skip', rel);
      continue;
    }
    await put(s, local, `${SFTP}/${rel}`);
    console.log('put', rel);
  }

  // 確認本機檔案含功能
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const ss = fs.readFileSync(path.join(ROOT, 'server/system-settings.js'), 'utf8');
  console.log(
    'local checks:',
    'ui=',
    app.includes('製作數位簽章'),
    'create=',
    ss.includes('createSelfSignedPdfSignCert')
  );

  await exec(conn, `date >> ${REMOTE}/.deploy-stamp`);
  console.log('building (no-cache, may take a few min)...');
  const r = await exec(
    conn,
    `cd ${REMOTE} && ${DOCKER} compose build --no-cache approval-system && ${DOCKER} compose up -d approval-system`
  );
  console.log('build exit', r.code);

  await new Promise((r) => setTimeout(r, 8000));
  await exec(
    conn,
    `${DOCKER} exec approval-system sh -c "grep -c '製作數位簽章' /app/public/js/app.js; grep -c createSelfSignedPdfSignCert /app/server/system-settings.js; grep -c pdf-sign/create /app/server/index.js; node -e \\"require('node-forge');console.log('forge_ok')\\""`
  );
  await exec(conn, `curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3847/`);
  console.log('DONE');
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
