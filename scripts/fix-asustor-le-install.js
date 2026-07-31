/**
 * Finalize LE cert install on ASUSTOR after partial import.
 * Fixes lighttpd.pem content (key + fullchain) and restarts web UI.
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');

const HOST = process.env.ASUSTOR_HOST || '192.168.99.250';
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
const CERT_DIR = process.env.LE_EXPORT_DIR || path.join(__dirname, '..', 'tmp-le-export');

if (!PASS) {
  console.error('Set NAS_PASS');
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
        port: 22,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: {
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ssh-rsa',
            'ssh-dss',
            'rsa-sha2-256',
            'rsa-sha2-512',
          ],
        },
      });
  });
}

function exec(conn, cmd) {
  const full = `echo ${JSON.stringify(PASS)} | sudo -S -p '' env PATH=/usr/builtin/bin:/usr/bin:/bin:/usr/sbin:/sbin sh -c ${JSON.stringify(cmd)}`;
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
        const t = d.toString();
        stderr += t;
        if (!/lecture|Respect the privacy|Think before|great power|\[sudo\]/i.test(t)) {
          process.stderr.write(d);
        }
      });
    });
  });
}

function sftpClient(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function sftpWrite(sftp, remote, content) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remote, Buffer.from(content, 'utf8'), (err) => (err ? reject(err) : resolve()));
  });
}

function verifyTls(sni) {
  return new Promise((resolve) => {
    const sock = tls.connect(
      { host: HOST, port: 801, servername: sni, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      () => {
        const cert = sock.getPeerCertificate();
        console.log(
          `TLS TRUSTED sni=${sni} CN=${cert.subject.CN} issuer=${cert.issuer.CN} expires=${cert.valid_to}`
        );
        sock.end();
        resolve(true);
      }
    );
    sock.on('error', (e) => {
      console.log(`TLS FAIL sni=${sni}: ${e.message}`);
      const s2 = tls.connect(
        { host: HOST, port: 801, servername: sni, rejectUnauthorized: false },
        () => {
          const cert = s2.getPeerCertificate();
          console.log(
            `  peek CN=${cert.subject && cert.subject.CN} issuer=${cert.issuer && cert.issuer.CN} expires=${cert.valid_to}`
          );
          s2.end();
          resolve(false);
        }
      );
      s2.on('error', (e2) => {
        console.log('  peek failed', e2.message);
        resolve(false);
      });
    });
  });
}

async function main() {
  const fullchain = fs.readFileSync(path.join(CERT_DIR, 'fullchain.pem'), 'utf8').replace(/\r/g, '').trim() + '\n';
  const privkey = fs.readFileSync(path.join(CERT_DIR, 'privkey.pem'), 'utf8').replace(/\r/g, '').trim() + '\n';
  const chain = fs.readFileSync(path.join(CERT_DIR, 'chain.pem'), 'utf8').replace(/\r/g, '').trim() + '\n';
  // lighttpd ssl.pemfile needs private key + cert chain when no ca-file is configured
  const lighttpdPem = privkey + fullchain;
  const certId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const valid = Math.floor(new Date('2026-08-24T01:00:29Z').getTime() / 1000);

  const certJson = JSON.stringify(
    {
      cert_list: [
        {
          id: certId,
          alt_name: 'DNS:blog.catshome.tw, DNS:catshome.tw',
          default: true,
          domain_name: 'catshome.tw',
          name: 'catshome-le',
          issuer_name: "Let's Encrypt",
          type: 1,
          valid_time: valid,
          update_time: now,
          valid_time_week: now,
        },
      ],
    },
    null,
    2
  );

  const conn = await connect();
  console.log('SSH OK');
  const sftp = await sftpClient(conn);
  const up = '/volume1/Public';

  await sftpWrite(sftp, `${up}/ssl.crt`, fullchain);
  await sftpWrite(sftp, `${up}/ssl.key`, privkey);
  await sftpWrite(sftp, `${up}/ssl.chain`, chain);
  await sftpWrite(sftp, `${up}/ssl.pem`, lighttpdPem);
  await sftpWrite(sftp, `${up}/certificate.json`, certJson);

  const script = `#!/bin/sh
set -e
CR=/usr/builtin/etc/certificate
UP=/volume1/Public
ID=${certId}
TS=$(date +%s)
export PATH=/usr/builtin/bin:/usr/bin:/bin:/usr/sbin:/sbin

mkdir -p "$CR/backup-fix-$TS"
cp -a "$CR/ssl.crt" "$CR/ssl.key" "$CR/ssl.pem" "$CR/certificate.json" "$CR/backup-fix-$TS/" 2>/dev/null || true

# Ensure lighttpd symlinks point at certificate store (do NOT replace with plain files)
rm -f /volume0/usr/etc/lighttpd/lighttpd.pem
ln -sf /usr/builtin/etc/certificate/ssl.pem /volume0/usr/etc/lighttpd/lighttpd.pem
rm -f /volume0/usr/etc/lighttpd/lighttpd.chain
ln -sf /usr/builtin/etc/certificate/ssl.chain /volume0/usr/etc/lighttpd/lighttpd.chain

cp -f "$UP/ssl.crt" "$CR/ssl.crt"
cp -f "$UP/ssl.key" "$CR/ssl.key"
cp -f "$UP/ssl.pem" "$CR/ssl.pem"
cp -f "$UP/ssl.chain" "$CR/ssl.chain"
cp -f "$UP/certificate.json" "$CR/certificate.json"
chmod 644 "$CR/ssl.crt" "$CR/ssl.chain" "$CR/certificate.json"
chmod 600 "$CR/ssl.key" "$CR/ssl.pem"

mkdir -p "$CR/ssl/$ID"
cp -f "$CR/ssl.crt" "$CR/ssl.key" "$CR/ssl.pem" "$CR/ssl.chain" "$CR/ssl/$ID/"

echo "=== files ==="
ls -la "$CR/ssl.crt" "$CR/ssl.key" "$CR/ssl.pem" "$CR/ssl.chain"
ls -la /volume0/usr/etc/lighttpd/lighttpd.pem /volume0/usr/etc/lighttpd/lighttpd.chain
echo "=== certificate.json ==="
cat "$CR/certificate.json"

# Restart lighttpd (ADM HTTPS)
if [ -x /etc/init.d/S41lighttpd ]; then
  /etc/init.d/S41lighttpd restart
elif [ -x /usr/builtin/etc/init.d/S41lighttpd ]; then
  /usr/builtin/etc/init.d/S41lighttpd restart
else
  killall lighttpd 2>/dev/null || true
  sleep 1
  if [ -x /usr/builtin/sbin/lighttpd ]; then
    /usr/builtin/sbin/lighttpd -f /usr/etc/lighttpd/lighttpd.conf || true
  fi
fi

sleep 2
ps | grep -i lighttpd | grep -v grep || true
echo FIX_OK
`;

  await sftpWrite(sftp, `${up}/fix-le.sh`, script);
  console.log('Running fix script...');
  const r = await exec(conn, `sh ${up}/fix-le.sh`);
  console.log('exit', r.code);
  conn.end();
  if (r.code !== 0) throw new Error('fix script exit ' + r.code);

  await new Promise((r) => setTimeout(r, 2500));
  console.log('\nTLS verification:');
  await verifyTls('catshome.tw');
  await verifyTls(HOST);

  console.log('\nDone. Open: https://' + HOST + ':801/');
  console.log('Note: cert SAN is catshome.tw — browsers using the raw IP may still show name mismatch, but AUTHORITY should be trusted when using the domain.');
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
