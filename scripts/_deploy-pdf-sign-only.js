/**
 * 僅部署「製作數位簽章」相關檔案到 NAS，不整包更新其他功能。
 * 用法：set NAS_PASS=... ; node scripts/_deploy-pdf-sign-only.js
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';
const PASS = process.env.NAS_PASS || '';
const REMOTE = process.env.NAS_DIR || '/volume1/docker/approval-system';
const SFTP_ROOT = process.env.NAS_SFTP_DIR || '/docker/approval-system';
const DOCKER = process.env.NAS_DOCKER || '/usr/local/bin/docker';
const ROOT = path.resolve(__dirname, '..');

if (!PASS) {
  console.error('Set NAS_PASS');
  process.exit(1);
}

// 僅憑證功能相關
const FILES = [
  ['server/system-settings.js', 'server/system-settings.js'],
  ['package.json', 'package.json'],
  ['package-lock.json', 'package-lock.json'],
];

// index.js / app.js：只在 NAS 尚無 create API／表單時才上傳（避免覆蓋其他本機實驗改動）
// 若已有則略過，只靠 system-settings + 重建映像裝 node-forge

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
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
        },
      });
  });
}

function exec(conn, cmd) {
  const full = `echo ${JSON.stringify(PASS)} | sudo -S -p '' -E env "PATH=/usr/local/bin:/usr/bin:/bin" sh -lc ${JSON.stringify(cmd)}`;
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

function put(sftpClient, local, remote) {
  return new Promise((resolve, reject) => {
    sftpClient.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function readRemote(sftpClient, remote) {
  return new Promise((resolve, reject) => {
    sftpClient.readFile(remote, 'utf8', (err, data) => {
      if (err) reject(err);
      else resolve(data.toString());
    });
  });
}

function writeRemote(sftpClient, remote, content) {
  return new Promise((resolve, reject) => {
    sftpClient.writeFile(remote, content, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  console.log('Deploy PDF-sign create ONLY to', `${USER}@${HOST}:${REMOTE}`);
  const conn = await connect();
  console.log('SSH OK');
  const s = await sftp(conn);

  for (const [rel, remoteRel] of FILES) {
    const local = path.join(ROOT, rel);
    if (!fs.existsSync(local)) {
      console.warn('skip missing', rel);
      continue;
    }
    const remote = `${SFTP_ROOT}/${remoteRel}`.replace(/\\/g, '/');
    console.log('put', remoteRel);
    await put(s, local, remote);
  }

  // index.js：若尚無 /api/system/pdf-sign/create 則插入（不整檔覆蓋）
  try {
    const indexRemote = `${SFTP_ROOT}/server/index.js`;
    let indexSrc = await readRemote(s, indexRemote);
    if (!indexSrc.includes('/api/system/pdf-sign/create')) {
      const route = `
/**
 * 製作公司自簽數位簽章憑證（.p12）
 * 必填：commonName、organization、country、passphrase（與確認密碼）
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
      const anchor = "app.delete('/api/system/pdf-sign/cert'";
      const idx = indexSrc.indexOf(anchor);
      if (idx < 0) throw new Error('cannot find pdf-sign cert delete route to insert after');
      // insert after the delete handler block ending with });
      const afterDelete = indexSrc.indexOf(
        "/** 測試數位簽章",
        idx
      );
      if (afterDelete > 0) {
        indexSrc = indexSrc.slice(0, afterDelete) + route + indexSrc.slice(afterDelete);
      } else {
        const close = indexSrc.indexOf('});', indexSrc.indexOf('clearPdfSignCert', idx));
        // fallback: before test route or after delete route's closing
        const testIdx = indexSrc.indexOf("app.post('/api/system/pdf-sign/test'");
        if (testIdx > 0) {
          indexSrc = indexSrc.slice(0, testIdx) + route + indexSrc.slice(testIdx);
        } else {
          throw new Error('cannot locate insert point in index.js');
        }
      }
      await writeRemote(s, indexRemote, indexSrc);
      console.log('patched index.js with create route');
    } else {
      console.log('index.js already has create route — leave as-is');
    }
  } catch (e) {
    console.warn('index.js patch skip/fail:', e.message);
  }

  // app.js：若尚無製作表單，從本機抽「製作區塊」過難，改上傳本機 app 片段提示
  try {
    const appRemote = `${SFTP_ROOT}/public/js/app.js`;
    let appSrc = await readRemote(s, appRemote);
    if (!appSrc.includes('pdf-sign-create-form')) {
      // 若無 UI，上傳本機完整 app.js（使用者要求僅憑證；但無 UI 則功能不可用）
      // 改為僅當缺少時才上傳完整 app.js
      console.log('app.js missing create form — uploading local app.js (needed for UI)');
      await put(s, path.join(ROOT, 'public/js/app.js'), appRemote);
    } else {
      console.log('app.js already has create form — leave as-is');
    }
  } catch (e) {
    console.warn('app.js check fail:', e.message);
  }

  // 確保 package.json 有 node-forge
  const pkgLocal = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!pkgLocal.dependencies['node-forge']) {
    pkgLocal.dependencies['node-forge'] = '^1.3.1';
    fs.writeFileSync(
      path.join(ROOT, 'package.json'),
      JSON.stringify(pkgLocal, null, 2) + '\n'
    );
    await put(s, path.join(ROOT, 'package.json'), `${SFTP_ROOT}/package.json`);
    console.log('package.json updated with node-forge');
  }

  console.log('Rebuild container (install node-forge if needed)...');
  const build = await exec(
    conn,
    `cd ${REMOTE} && ${DOCKER} compose up -d --build approval-system 2>&1 | tail -40; sleep 8; ${DOCKER} exec approval-system node -e "try{require('node-forge');console.log('forge_ok')}catch(e){console.log('forge_no')}; try{const s=require('./server/system-settings');console.log('create',typeof s.createSelfSignedPdfSignCert)}catch(e){console.log(e.message)}"; curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3847/ || true`
  );
  console.log('done code', build.code);
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
