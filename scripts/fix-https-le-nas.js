/**
 * Install Synology Let's Encrypt cert (catshome.tw) onto approval-system :3848
 * so browsers stop showing net::ERR_CERT_AUTHORITY_INVALID.
 *
 * Usage:
 *   set NAS_PASS=***
 *   node scripts/fix-https-le-nas.js
 */
const { Client } = require('ssh2');

const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 22);
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
const REMOTE_DIR = process.env.NAS_DIR || '/volume1/docker/approval-system';
const DOCKER = process.env.NAS_DOCKER || '/usr/local/bin/docker';
// Synology certificate archive id for CN=catshome.tw (Let's Encrypt)
const CERT_ARCHIVE = process.env.NAS_CERT_ARCHIVE || 'Bpqtwj';
const CERT_SRC = `/usr/syno/etc/certificate/_archive/${CERT_ARCHIVE}`;
const CERT_DST = `${REMOTE_DIR}/data/certs`;

if (!PASS) {
  console.error('Set NAS_PASS environment variable');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
        },
      });
  });
}

function exec(conn, cmd, { sudo = false } = {}) {
  const wrapped = `export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; ${cmd}`;
  const full = sudo
    ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' -E env "PATH=/usr/local/bin:/usr/bin:/bin" sh -lc ${JSON.stringify(cmd)}`
    : `sh -lc ${JSON.stringify(wrapped)}`;
  return new Promise((resolve, reject) => {
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
          process.stdout.write(d);
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function uploadBuffer(sftpClient, remote, content) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    sftpClient.writeFile(remote, buf, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  console.log(`Connecting ${USER}@${HOST}:${PORT} ...`);
  const conn = await connect();
  console.log('SSH OK');

  // SFTP path is chrooted to shared folders on Synology
  const sftpDir = process.env.NAS_SFTP_DIR || '/docker/approval-system';
  const s = await sftp(conn);

  const installScript = `#!/bin/sh
set -e
SRC="${CERT_SRC}"
DST="${CERT_DST}"
DOCKER="${DOCKER}"
mkdir -p "$DST"
ts=$(date +%Y%m%d-%H%M%S)
if [ -f "$DST/cert.pem" ]; then cp -a "$DST/cert.pem" "$DST/cert.pem.bak-$ts"; fi
if [ -f "$DST/key.pem" ]; then cp -a "$DST/key.pem" "$DST/key.pem.bak-$ts"; fi
if [ -f "$SRC/ECC-fullchain.pem" ] && [ -f "$SRC/ECC-privkey.pem" ]; then
  echo "Using ECC fullchain from $SRC"
  cp -f "$SRC/ECC-fullchain.pem" "$DST/cert.pem"
  cp -f "$SRC/ECC-privkey.pem" "$DST/key.pem"
elif [ -f "$SRC/fullchain.pem" ] && [ -f "$SRC/privkey.pem" ]; then
  echo "Using RSA fullchain from $SRC"
  cp -f "$SRC/fullchain.pem" "$DST/cert.pem"
  cp -f "$SRC/privkey.pem" "$DST/key.pem"
else
  echo "ERROR: LE cert files not found in $SRC"
  ls -la "$SRC" || true
  exit 1
fi
chmod 644 "$DST/cert.pem"
chmod 600 "$DST/key.pem"
chown 1000:1000 "$DST/cert.pem" "$DST/key.pem" 2>/dev/null || true
echo "Installed cert:"
openssl x509 -in "$DST/cert.pem" -noout -subject -issuer -dates -ext subjectAltName
echo "Restarting approval-system..."
"$DOCKER" restart approval-system
sleep 4
"$DOCKER" ps --filter name=approval-system --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"
echo "--- logs ---"
"$DOCKER" logs --tail 25 approval-system 2>&1 || true
`;

  const renewBody = `#!/bin/sh
# Sync Synology LE cert (catshome.tw) into approval-system HTTPS :3848
# Schedule via DSM Task Scheduler after certificate renew, or daily.
set -e
SRC="${CERT_SRC}"
DST="${CERT_DST}"
DOCKER="${DOCKER}"
if [ -f "$SRC/ECC-fullchain.pem" ] && [ -f "$SRC/ECC-privkey.pem" ]; then
  cp -f "$SRC/ECC-fullchain.pem" "$DST/cert.pem"
  cp -f "$SRC/ECC-privkey.pem" "$DST/key.pem"
else
  cp -f "$SRC/fullchain.pem" "$DST/cert.pem"
  cp -f "$SRC/privkey.pem" "$DST/key.pem"
fi
chmod 644 "$DST/cert.pem"
chmod 600 "$DST/key.pem"
chown 1000:1000 "$DST/cert.pem" "$DST/key.pem" 2>/dev/null || true
"$DOCKER" restart approval-system >/dev/null
echo "[$(date)] approval-system certs refreshed from $SRC"
`;

  console.log('Uploading scripts via SFTP...');
  await uploadBuffer(s, `${sftpDir}/_install-le-cert.sh`, installScript);
  await uploadBuffer(s, `${sftpDir}/sync-le-cert.sh`, renewBody);
  await exec(conn, `chmod +x ${REMOTE_DIR}/_install-le-cert.sh ${REMOTE_DIR}/sync-le-cert.sh`);

  console.log('Installing LE certificate into container certs...');
  const r = await exec(conn, `sh ${REMOTE_DIR}/_install-le-cert.sh`, { sudo: true });
  if (r.code !== 0) {
    throw new Error(`install failed with code ${r.code}`);
  }

  console.log('\nHealth check from NAS...');
  await exec(
    conn,
    'curl -s -o /dev/null -w "http_3847=%{http_code}\\n" http://127.0.0.1:3847/api/departments || true; ' +
      'curl -s -o /dev/null -w "https_3848=%{http_code}\\n" https://127.0.0.1:3848/api/departments || true; ' +
      'echo | openssl s_client -connect 127.0.0.1:3848 -servername catshome.tw 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true'
  );

  conn.end();
  console.log('\nDONE');
  console.log('Open: https://catshome.tw:3848/');
  console.log("Certificate should now be Let's Encrypt (trusted).");
  console.log(`After LE renew on DSM, run: sudo ${REMOTE_DIR}/sync-le-cert.sh`);
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
