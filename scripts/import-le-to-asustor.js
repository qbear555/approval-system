/**
 * Import Let's Encrypt cert (from Synology export or tmp-le-export/) into ASUSTOR ADM.
 * Target: https://192.168.99.250:801
 *
 * Usage:
 *   set NAS_PASS=...
 *   node scripts/import-le-to-asustor.js
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const HOST = process.env.ASUSTOR_HOST || '192.168.99.250';
const SSH_PORT = Number(process.env.ASUSTOR_SSH_PORT || 22);
const ADM_PORT = Number(process.env.ASUSTOR_ADM_PORT || 801);
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || process.env.ASUSTOR_PASS || '';
const CERT_DIR = process.env.LE_EXPORT_DIR || path.join(__dirname, '..', 'tmp-le-export');

if (!PASS) {
  console.error('Set NAS_PASS');
  process.exit(1);
}

const agent = new https.Agent({ rejectUnauthorized: false });

function admReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data =
      body == null
        ? null
        : typeof body === 'string'
          ? body
          : new URLSearchParams(body).toString();
    const req = https.request(
      {
        host: HOST,
        port: ADM_PORT,
        path: urlPath,
        method,
        agent,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `https://${HOST}:${ADM_PORT}/portal/`,
          ...(data
            ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sshConnect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({
        host: HOST,
        port: SSH_PORT,
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

function exec(conn, cmd, { sudo = true } = {}) {
  const full = sudo
    ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' sh -c ${JSON.stringify(cmd)}`
    : `sh -c ${JSON.stringify(cmd)}`;
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
        // filter sudo password prompt noise
        if (!d.toString().includes('[sudo]')) process.stderr.write(d);
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
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    sftp.writeFile(remote, buf, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function ensureSshEnabled() {
  console.log('Ensuring SSH is enabled via ADM API...');
  const login = JSON.parse(
    (
      await admReq('POST', '/portal/apis/login.cgi?act=login', {
        account: USER,
        password: PASS,
        'two-step-auth': 'true',
      })
    ).body
  );
  if (!login.success) throw new Error('ADM login failed: ' + JSON.stringify(login));
  const sid = login.sid;
  await admReq('POST', `/portal/apis/services/terminal.cgi?sid=${encodeURIComponent(sid)}`, {
    sid,
    act: 'set',
    ssh_enable: 1,
    ssh_port: SSH_PORT,
    sftp_enable: 1,
  });
  const st = JSON.parse(
    (
      await admReq(
        'GET',
        `/portal/apis/services/terminal.cgi?sid=${encodeURIComponent(sid)}&act=get`
      )
    ).body
  );
  console.log('SSH status:', st);
  return sid;
}

async function main() {
  // Prefer RSA fullchain (broader lighttpd compatibility on older ADM)
  const fullchainPath = path.join(CERT_DIR, 'fullchain.pem');
  const privkeyPath = path.join(CERT_DIR, 'privkey.pem');
  const eccFull = path.join(CERT_DIR, 'ECC-fullchain.pem');
  const eccKey = path.join(CERT_DIR, 'ECC-privkey.pem');

  let useFull = fullchainPath;
  let useKey = privkeyPath;
  if (!fs.existsSync(fullchainPath) || !fs.existsSync(privkeyPath)) {
    if (fs.existsSync(eccFull) && fs.existsSync(eccKey)) {
      useFull = eccFull;
      useKey = eccKey;
      console.log('Using ECC certs');
    } else {
      throw new Error(`Missing certs in ${CERT_DIR}. Run export from Synology first.`);
    }
  } else {
    console.log('Using RSA fullchain + privkey');
  }

  const fullchain = fs.readFileSync(useFull, 'utf8').trim() + '\n';
  const privkey = fs.readFileSync(useKey, 'utf8').trim() + '\n';
  // Existing ASUSTOR layout: ssl.pem size ≈ crt + key (crt then key)
  const sslPem = fullchain + privkey;
  const certId = crypto.randomUUID();

  await ensureSshEnabled();
  // give sshd a moment
  await new Promise((r) => setTimeout(r, 1500));

  const conn = await sshConnect();
  console.log('SSH connected');
  const sftp = await sftpClient(conn);

  // Find writable upload dir
  const candidates = [
    `/volume1/homes/${USER}`,
    `/share/homes/${USER}`,
    '/volume1/Public',
    '/share/Public',
    '/tmp',
  ];
  let uploadDir = null;
  for (const p of candidates) {
    try {
      const test = `${p}/.le-write-test-${Date.now()}`;
      await sftpWrite(sftp, test, 'ok\n');
      await new Promise((res) => sftp.unlink(test, () => res()));
      uploadDir = p;
      console.log('Upload dir:', p);
      break;
    } catch {
      /* try next */
    }
  }
  if (!uploadDir) throw new Error('No writable SFTP path');

  await sftpWrite(sftp, `${uploadDir}/install-ssl.crt`, fullchain);
  await sftpWrite(sftp, `${uploadDir}/install-ssl.key`, privkey);
  await sftpWrite(sftp, `${uploadDir}/install-ssl.pem`, sslPem);
  console.log('Uploaded cert files');

  const installSh = `#!/bin/sh
set -e
SRC="${uploadDir}"
CERT_ROOT=/usr/builtin/etc/certificate
ID="${certId}"
TS=$(date +%s)

mkdir -p "$CERT_ROOT/backup-$TS"
cp -a "$CERT_ROOT/ssl.crt" "$CERT_ROOT/ssl.key" "$CERT_ROOT/ssl.pem" "$CERT_ROOT/certificate.json" "$CERT_ROOT/backup-$TS/" 2>/dev/null || true
cp -a "$CERT_ROOT/ssl" "$CERT_ROOT/backup-$TS/" 2>/dev/null || true

cp -f "$SRC/install-ssl.crt" "$CERT_ROOT/ssl.crt"
cp -f "$SRC/install-ssl.key" "$CERT_ROOT/ssl.key"
cp -f "$SRC/install-ssl.pem" "$CERT_ROOT/ssl.pem"
chmod 644 "$CERT_ROOT/ssl.crt" "$CERT_ROOT/ssl.pem"
chmod 600 "$CERT_ROOT/ssl.key"

mkdir -p "$CERT_ROOT/ssl/$ID"
cp -f "$SRC/install-ssl.crt" "$CERT_ROOT/ssl/$ID/ssl.crt"
cp -f "$SRC/install-ssl.key" "$CERT_ROOT/ssl/$ID/ssl.key"
cp -f "$SRC/install-ssl.pem" "$CERT_ROOT/ssl/$ID/ssl.pem"
chmod 644 "$CERT_ROOT/ssl/$ID/ssl.crt" "$CERT_ROOT/ssl/$ID/ssl.pem"
chmod 600 "$CERT_ROOT/ssl/$ID/ssl.key"

# valid_time unix from cert
VALID_UNIX=$(openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -enddate | sed 's/notAfter=//' | xargs -I{} date -d "{}" +%s 2>/dev/null || echo 1787529600)
NOW=$(date +%s)

# Write certificate.json with python (available on ADM) or sed fallback
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY=$(command -v python3 2>/dev/null || command -v python)
  $PY - <<PY
import json, time
path = "/usr/builtin/etc/certificate/certificate.json"
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    data = {"cert_list": []}
for c in data.get("cert_list", []):
    c["default"] = False
new = {
    "id": "${certId}",
    "alt_name": "DNS:blog.catshome.tw, DNS:catshome.tw",
    "default": True,
    "domain_name": "catshome.tw",
    "name": "catshome-le",
    "issuer_name": "Let's Encrypt",
    "type": 1,
    "valid_time": int("${'${VALID_UNIX}'}") if False else int("$VALID_UNIX"),
    "update_time": int(time.time()),
    "valid_time_week": int(time.time()),
}
# fix valid_time
new["valid_time"] = int("$VALID_UNIX")
data["cert_list"] = [new] + [c for c in data.get("cert_list", []) if c.get("id") != new["id"]]
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print("certificate.json updated")
PY
else
  cat > "$CERT_ROOT/certificate.json" <<EOF
{
  "cert_list":[
    {
      "id":"$ID",
      "alt_name":"DNS:blog.catshome.tw, DNS:catshome.tw",
      "default":true,
      "domain_name":"catshome.tw",
      "name":"catshome-le",
      "issuer_name":"Let's Encrypt",
      "type":1,
      "valid_time":$VALID_UNIX,
      "update_time":$NOW,
      "valid_time_week":$NOW
    }
  ]
}
EOF
fi

# lighttpd combined pem (key + cert) used by some ADM versions
for LDIR in /volume0/usr/etc/lighttpd /usr/builtin/etc/lighttpd /etc/lighttpd /volume0/usr/builtin/etc/lighttpd; do
  if [ -d "\$LDIR" ]; then
    echo "Found lighttpd dir: \$LDIR"
    ls -la "\$LDIR" | head -20
    if [ -f "\$LDIR/lighttpd.pem" ] || [ -f "\$LDIR/server.pem" ] || [ -f "\$LDIR/ssl.pem" ]; then
      [ -f "\$LDIR/lighttpd.pem" ] && cp -a "\$LDIR/lighttpd.pem" "$CERT_ROOT/backup-$TS/lighttpd.pem" || true
      # Asustor-certbot uses key then cert
      cat "$CERT_ROOT/ssl.key" "$CERT_ROOT/ssl.crt" > "\$LDIR/lighttpd.pem"
      chmod 600 "\$LDIR/lighttpd.pem" 2>/dev/null || true
      echo "Updated \$LDIR/lighttpd.pem"
    fi
  fi
done

# Also check lighttpd config for ssl.pemfile path
grep -R "ssl.pemfile\\|pemfile\\|ssl.crt" /volume0/usr/etc/lighttpd /usr/builtin/etc/lighttpd /etc/lighttpd 2>/dev/null | head -20 || true

echo "=== Installed cert ==="
openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -subject -issuer -dates
echo "=== certificate.json ==="
cat "$CERT_ROOT/certificate.json"

# Restart web UI service
for svc in \\
  /etc/init.d/S41lighttpd \\
  /usr/builtin/etc/init.d/S41lighttpd \\
  /etc/init.d/lighttpd \\
  /etc/init.d/S40nginx \\
  /usr/builtin/etc/init.d/S80lighttpd
 do
  if [ -x "\$svc" ]; then
    echo "Restarting \$svc"
    "\$svc" restart || "\$svc" reload || true
  fi
done
killall -HUP lighttpd 2>/dev/null || true
# ADM reload helper if present
/usr/builtin/bin/certificate update-cert 2>/dev/null || true

sleep 2
echo INSTALL_OK
`;

  // Fix accidental template pollution - write clean script without the broken python bits
  const cleanScript = `#!/bin/sh
set -e
SRC="${uploadDir}"
CERT_ROOT=/usr/builtin/etc/certificate
ID="${certId}"
TS=$(date +%s)

mkdir -p "$CERT_ROOT/backup-$TS"
cp -a "$CERT_ROOT/ssl.crt" "$CERT_ROOT/ssl.key" "$CERT_ROOT/ssl.pem" "$CERT_ROOT/certificate.json" "$CERT_ROOT/backup-$TS/" 2>/dev/null || true
cp -a "$CERT_ROOT/ssl" "$CERT_ROOT/backup-$TS/" 2>/dev/null || true

cp -f "$SRC/install-ssl.crt" "$CERT_ROOT/ssl.crt"
cp -f "$SRC/install-ssl.key" "$CERT_ROOT/ssl.key"
cp -f "$SRC/install-ssl.pem" "$CERT_ROOT/ssl.pem"
chmod 644 "$CERT_ROOT/ssl.crt" "$CERT_ROOT/ssl.pem"
chmod 600 "$CERT_ROOT/ssl.key"

mkdir -p "$CERT_ROOT/ssl/$ID"
cp -f "$SRC/install-ssl.crt" "$CERT_ROOT/ssl/$ID/ssl.crt"
cp -f "$SRC/install-ssl.key" "$CERT_ROOT/ssl/$ID/ssl.key"
cp -f "$SRC/install-ssl.pem" "$CERT_ROOT/ssl/$ID/ssl.pem"
chmod 644 "$CERT_ROOT/ssl/$ID/ssl.crt" "$CERT_ROOT/ssl/$ID/ssl.pem"
chmod 600 "$CERT_ROOT/ssl/$ID/ssl.key"

VALID_UNIX=$(openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -enddate | sed 's/notAfter=//' | xargs -I{} date -d "{}" +%s 2>/dev/null || echo 1787529600)
NOW=$(date +%s)

cat > "$CERT_ROOT/certificate.json" <<EOF
{
  "cert_list":[
    {
      "id":"$ID",
      "alt_name":"DNS:blog.catshome.tw, DNS:catshome.tw",
      "default":true,
      "domain_name":"catshome.tw",
      "name":"catshome-le",
      "issuer_name":"Let's Encrypt",
      "type":1,
      "valid_time":$VALID_UNIX,
      "update_time":$NOW,
      "valid_time_week":$NOW
    }
  ]
}
EOF

for LDIR in /volume0/usr/etc/lighttpd /usr/builtin/etc/lighttpd /etc/lighttpd /volume0/usr/builtin/etc/lighttpd; do
  if [ -d "$LDIR" ]; then
    echo "Found lighttpd dir: $LDIR"
    ls -la "$LDIR" | head -20
    if [ -f "$LDIR/lighttpd.pem" ] || [ -f "$LDIR/server.pem" ] || [ -f "$LDIR/ssl.pem" ]; then
      [ -f "$LDIR/lighttpd.pem" ] && cp -a "$LDIR/lighttpd.pem" "$CERT_ROOT/backup-$TS/lighttpd.pem" || true
      cat "$CERT_ROOT/ssl.key" "$CERT_ROOT/ssl.crt" > "$LDIR/lighttpd.pem"
      chmod 600 "$LDIR/lighttpd.pem" 2>/dev/null || true
      echo "Updated $LDIR/lighttpd.pem"
    fi
  fi
done

grep -R "ssl.pemfile\\|pemfile\\|ssl.crt\\|ssl.key" /volume0/usr/etc/lighttpd /usr/builtin/etc/lighttpd /etc/lighttpd 2>/dev/null | head -30 || true

echo "=== Installed cert ==="
openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -subject -issuer -dates
echo "=== SAN ==="
openssl x509 -in "$CERT_ROOT/ssl.crt" -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" || true
echo "=== certificate.json ==="
cat "$CERT_ROOT/certificate.json"

for svc in /etc/init.d/S41lighttpd /usr/builtin/etc/init.d/S41lighttpd /etc/init.d/lighttpd /etc/init.d/S40nginx /usr/builtin/etc/init.d/S80lighttpd; do
  if [ -x "$svc" ]; then
    echo "Restarting $svc"
    "$svc" restart || "$svc" reload || true
  fi
done
killall -HUP lighttpd 2>/dev/null || true
/usr/builtin/bin/certificate update-cert 2>/dev/null || true

sleep 2
echo INSTALL_OK
`;

  await sftpWrite(sftp, `${uploadDir}/install-le-asustor.sh`, cleanScript);
  console.log('Running install script...');
  const r = await exec(conn, `chmod +x ${uploadDir}/install-le-asustor.sh; sh ${uploadDir}/install-le-asustor.sh`);
  if (r.code !== 0) {
    throw new Error('install script failed code ' + r.code);
  }

  conn.end();

  // Verify TLS from outside
  console.log('\nVerifying HTTPS on port', ADM_PORT, '...');
  await new Promise((r) => setTimeout(r, 2000));
  await verifyTls(HOST, ADM_PORT, 'catshome.tw');
  await verifyTls(HOST, ADM_PORT, HOST);

  console.log('\nDONE. Open: https://' + HOST + ':' + ADM_PORT + '/');
  console.log('If browser still warns about name mismatch when using IP, use https://catshome.tw:801/ (with hosts/port forward) or accept that LE cert is for catshome.tw not the LAN IP.');
}

function verifyTls(host, port, sni) {
  return new Promise((resolve) => {
    const socket = require('tls').connect(
      {
        host,
        port,
        servername: sni,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
      () => {
        const cert = socket.getPeerCertificate();
        console.log(
          `TLS OK sni=${sni} subject=${cert.subject.CN} issuer=${cert.issuer.CN} authorized=${socket.authorized}`
        );
        socket.end();
        resolve();
      }
    );
    socket.on('error', (e) => {
      console.log(`TLS check sni=${sni}: ${e.message}`);
      // retry without auth for diagnostics
      const s2 = require('tls').connect(
        { host, port, servername: sni, rejectUnauthorized: false },
        () => {
          const cert = s2.getPeerCertificate();
          console.log(
            `  (insecure peek) subject=${cert.subject && cert.subject.CN} issuer=${cert.issuer && cert.issuer.CN}`
          );
          s2.end();
          resolve();
        }
      );
      s2.on('error', (e2) => {
        console.log('  peek failed', e2.message);
        resolve();
      });
    });
  });
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
