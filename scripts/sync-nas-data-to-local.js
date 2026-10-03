/**
 * 將 NAS 正式環境的 data/ 目錄完全鏡像同步至本機 data/
 * - 透過 sudo tar -czf 打包 NAS 正式資料（包含所有附件、備份、憑證、設定）
 * - 使用 node-tar 於本機高效無損解壓（支援 UTF-8 中文檔名與完整路徑）
 * - 刪除本機存在但 NAS 不存在的檔案（完全一致）
 * - 特殊例外：保留本機公司名稱及 Logo（不被正式站 CatsHome Inc. 覆蓋）
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const PASS = 'Ww837*5630';
const HOST = '192.168.99.220';
const PORT = 9922;
const USER = 'tsuming';

const REMOTE_DATA = '/volume1/docker/approval-system/data';
const REMOTE_TAR = '/tmp/nas_approval_data.tar.gz';
const ROOT = path.join(__dirname, '..');
const LOCAL_DATA = path.join(ROOT, 'data');
const LOCAL_TAR = path.join(ROOT, 'nas_approval_data.tar.gz');
const STAGING_DIR = path.join(ROOT, 'nas_data_staging');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function walkDir(dir, prefix = '') {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = prefix ? prefix + '/' + f : f;
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkDir(full, rel));
    } else {
      out.push({ rel: rel.replace(/\\/g, '/'), full });
    }
  }
  return out;
}

function execRemote(conn, cmd, sudo = false) {
  return new Promise((resolve, reject) => {
    const full = sudo
      ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' env PATH=/usr/local/bin:/usr/bin:/bin sh -c ${JSON.stringify(cmd)}`
      : `sh -c ${JSON.stringify(cmd)}`;
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let o = '';
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (c) => resolve({ c, o }));
    });
  });
}

async function main() {
  console.log(`[1/6] 連線至 NAS ${HOST}:${PORT}...`);
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 15000 });
  });

  try {
    // 1. 在 NAS 端建立 tar.gz 壓縮檔
    console.log(`[2/6] 在 NAS 端以 sudo 打包正式資料目錄 ${REMOTE_DATA}...`);
    await execRemote(conn, `rm -f ${REMOTE_TAR}`, true);
    const tarRes = await execRemote(
      conn,
      `tar -czf ${REMOTE_TAR} -C ${REMOTE_DATA} . && chmod 666 ${REMOTE_TAR}`,
      true
    );
    if (tarRes.c !== 0) {
      throw new Error(`NAS tar 失敗: ${tarRes.o}`);
    }
    const statRes = await execRemote(conn, `ls -lh ${REMOTE_TAR}`, false);
    console.log(`  NAS 打包完成: ${statRes.o.trim()}`);

    // 2. 下載 tar.gz 檔案到本機
    console.log(`[3/6] 下載正式資料壓縮檔到本機...`);
    const fileStream = fs.createWriteStream(LOCAL_TAR);
    let downloadedBytes = 0;
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      conn.exec(`cat ${REMOTE_TAR}`, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes % (10 * 1024 * 1024) < chunk.length) {
            process.stdout.write(`  已下載 ${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB...\r`);
          }
        });
        stream.pipe(fileStream);
        stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
      });
    });
    console.log(`\n  下載完成：${LOCAL_TAR} (${(fs.statSync(LOCAL_TAR).size / (1024 * 1024)).toFixed(1)} MB)`);

    // 3. 使用 node-tar 解壓到本機暫存區
    console.log(`[4/6] 解壓資料至暫存區 ${STAGING_DIR}...`);
    if (fs.existsSync(STAGING_DIR)) {
      fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    }
    ensureDir(STAGING_DIR);
    await tar.x({
      file: LOCAL_TAR,
      cwd: STAGING_DIR,
    });
    console.log('  解壓完成。');

    // 4. 處理「除了公司名稱及 Logo」的例外保護
    console.log(`[5/6] 處理公司名稱與 Logo 例外保護...`);
    let localCompanyName = '雅士博科技股份有限公司';
    let localLogoFile = null;
    const localSettingsPath = path.join(LOCAL_DATA, 'system-settings.json');
    if (fs.existsSync(localSettingsPath)) {
      try {
        const cur = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
        if (cur.companyName) localCompanyName = cur.companyName;
        if (cur.logoFile !== undefined) localLogoFile = cur.logoFile;
      } catch (e) {
        console.warn('讀取既有本機設定失敗', e.message);
      }
    }
    console.log(`  保留公司名稱: "${localCompanyName}"`);
    console.log(`  保留 Logo 設定: ${JSON.stringify(localLogoFile)}`);

    const stagingSettingsPath = path.join(STAGING_DIR, 'system-settings.json');
    if (fs.existsSync(stagingSettingsPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(stagingSettingsPath, 'utf8'));
        s.companyName = localCompanyName;
        s.logoFile = localLogoFile;
        if (s.pdfSignSignerName && s.pdfSignSignerName.includes('Cats')) {
          s.pdfSignSignerName = localCompanyName;
        }
        fs.writeFileSync(stagingSettingsPath, JSON.stringify(s, null, 2), 'utf8');
        console.log('  已將 NAS system-settings.json 注入本機公司名稱與簽署人名稱。');
      } catch (e) {
        console.error('更新 system-settings.json 失敗', e.message);
      }
    }

    // 排除 branding（避免把正式站 CatsHome Logo 蓋掉本機）
    const stagingBranding = path.join(STAGING_DIR, 'branding');
    if (fs.existsSync(stagingBranding)) {
      fs.rmSync(stagingBranding, { recursive: true, force: true });
      console.log('  排除 branding/ 目錄覆蓋（保留本機 Logo 檔案）。');
    }

    // 5. 鏡像同步：將 staging 同步至 local data，並刪除 local 多的檔案
    console.log(`[6/6] 開始檔案鏡像比對與刪除多餘檔案...`);
    const stagingFiles = walkDir(STAGING_DIR);
    const stagingRelSet = new Set(stagingFiles.map((f) => f.rel));

    // A. 拷貝/覆蓋 NAS 檔案
    let copiedCount = 0;
    for (const sf of stagingFiles) {
      const dest = path.join(LOCAL_DATA, ...sf.rel.split('/'));
      ensureDir(path.dirname(dest));
      fs.copyFileSync(sf.full, dest);
      copiedCount++;
    }
    console.log(`  已複製 / 覆蓋 ${copiedCount} 個 NAS 正式環境檔案。`);

    // B. 刪除本機存在但 NAS 不存在的檔案（「不同的就直接刪除，完全一樣」）
    const localFiles = walkDir(LOCAL_DATA);
    let deletedCount = 0;
    for (const lf of localFiles) {
      // 保留 branding
      if (lf.rel.startsWith('branding/')) continue;

      if (!stagingRelSet.has(lf.rel)) {
        try {
          fs.unlinkSync(lf.full);
          deletedCount++;
        } catch (e) {
          console.warn('  刪除失敗:', lf.rel, e.message);
        }
      }
    }
    console.log(`  已刪除 ${deletedCount} 個本機多餘差異檔案。`);

    // C. 清除空目錄
    function cleanEmptyDirs(dir) {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) {
          cleanEmptyDirs(p);
          try {
            if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
          } catch {}
        }
      }
    }
    cleanEmptyDirs(LOCAL_DATA);

    // 6. 清理暫存檔（本機與 NAS）
    fs.rmSync(LOCAL_TAR, { force: true });
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    await execRemote(conn, `rm -f ${REMOTE_TAR}`, true);

    console.log('\n========================================');
    console.log('✅ 正式環境資料完全同步完成！');
    console.log(`- 同步檔案數: ${copiedCount}`);
    console.log(`- 刪除差異數: ${deletedCount}`);
    console.log(`- 本機公司名稱: ${localCompanyName}`);
    console.log(`- 本機 Logo: 保持不變`);
    console.log('========================================\n');
  } finally {
    conn.end();
  }
}

main().catch((e) => {
  console.error('[ERROR]', e);
  process.exit(1);
});
