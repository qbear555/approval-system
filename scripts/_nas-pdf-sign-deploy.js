/**
 * 僅部署「製作數位簽章（自簽憑證）」到 NAS 並重建容器
 * NAS_SKIP_DB=1 不覆寫 data
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
const REMOTE = '/volume1/docker/approval-system';
const SFTP = '/docker/approval-system';
const DOCKER = '/usr/local/bin/docker';
const ROOT = path.resolve(__dirname, '..');

if (!PASS) {
  console.error('Set NAS_PASS');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c)).on('error', reject).connect({
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

function put(s, local, remote) {
  return new Promise((resolve, reject) => {
    s.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function readRemote(s, remote) {
  return new Promise((resolve, reject) => {
    s.readFile(remote, 'utf8', (err, data) => {
      if (err) reject(err);
      else resolve(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    });
  });
}

function writeRemote(s, remote, content) {
  return new Promise((resolve, reject) => {
    s.writeFile(remote, content, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  console.log('Deploy 製作數位簽章 only →', HOST);
  const conn = await connect();
  console.log('SSH OK');
  const s = await sftp(conn);

  // 1) system-settings.js 必須含 createSelfSignedPdfSignCert
  const localSs = path.join(ROOT, 'server', 'system-settings.js');
  await put(s, localSs, `${SFTP}/server/system-settings.js`);
  console.log('put system-settings.js');

  // 2) package.json 確保 node-forge
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.dependencies['node-forge']) {
    pkg.dependencies['node-forge'] = '^1.3.1';
  }
  if (!pkg.dependencies['@signpdf/signpdf']) {
    pkg.dependencies['@signpdf/signpdf'] = '^3.2.4';
    pkg.dependencies['@signpdf/signer-p12'] = '^3.2.4';
    pkg.dependencies['@signpdf/placeholder-plain'] = '^3.2.4';
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await put(s, pkgPath, `${SFTP}/package.json`);
  console.log('put package.json');

  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) {
    await put(s, lock, `${SFTP}/package-lock.json`);
    console.log('put package-lock.json');
  }

  // 3) index.js：若無 create route 則插入
  const indexRemote = `${SFTP}/server/index.js`;
  let indexSrc = await readRemote(s, indexRemote);
  if (!indexSrc.includes('/api/system/pdf-sign/create')) {
    const route = `
/**
 * 製作公司自簽數位簽章憑證（.p12）
 */
app.post('/api/system/pdf-sign/create', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const result = systemSettings.createSelfSignedPdfSignCert(req.body || {});
    res.json({
      ok: true,
      message: '已製作並儲存自簽公司憑證',
      meta: result.meta,
      settings: result.settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    console.error('[pdf-sign create]', e);
    res.status(400).json({ error: e.message || '製作憑證失敗' });
  }
});

`;
    const testIdx = indexSrc.indexOf("app.post('/api/system/pdf-sign/test'");
    if (testIdx < 0) throw new Error('NAS index.js missing pdf-sign/test route');
    indexSrc = indexSrc.slice(0, testIdx) + route + indexSrc.slice(testIdx);
    await writeRemote(s, indexRemote, indexSrc);
    console.log('patched index.js create route');
  } else {
    // 仍上傳本機 index 中的 create 區塊不整檔 — 僅確認有
    console.log('index.js already has create route');
    // 若 NAS 的 create 呼叫存在但 system-settings 剛更新，OK
  }

  // 4) app.js：若無 UI 表單，從本機抽換 PDF 簽章 card 太複雜 → 上傳本機 app.js 的系統設定段落
  // 為保證 UI 出現「製作數位簽章」，若缺少 form id 則上傳完整 app.js
  const appRemote = `${SFTP}/public/js/app.js`;
  let appSrc = await readRemote(s, appRemote);
  if (!appSrc.includes('pdf-sign-create-form') || !appSrc.includes('製作數位簽章')) {
    console.log('app.js missing create UI — uploading local app.js');
    await put(s, path.join(ROOT, 'public', 'js', 'app.js'), appRemote);
  } else {
    console.log('app.js already has create UI');
  }

  // 5) rebuild so node-forge is in image; data volume 保留
  console.log('docker compose up -d --build ...');
  await exec(
    conn,
    `cd ${REMOTE} && ${DOCKER} compose up -d --build approval-system`
  );

  console.log('verify...');
  await exec(
    conn,
    `${DOCKER} exec approval-system sh -c 'node -e "require(\\"node-forge\\");console.log(\\"forge_ok\\")"; node -e "const s=require(\\"./server/system-settings\\");console.log(\\"create\\",typeof s.createSelfSignedPdfSignCert)"; grep -c pdf-sign-create-form /app/public/js/app.js; grep -c pdf-sign/create /app/server/index.js'`
  );
  await exec(
    conn,
    `curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3847/`
  );

  console.log('DONE — 請用 Admin 登入系統設定查看「製作數位簽章」');
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
