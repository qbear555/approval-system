/**
 * 同步程式碼到 D:\一鍵安裝包 三平台
 * 使用 Node.js 避開 PowerShell 中文編碼問題
 */
const fs = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..');
const ROOT = 'D:\\一鍵安裝包';

if (!fs.existsSync(ROOT)) {
  console.error('找不到', ROOT);
  process.exit(1);
}

const TARGETS = [
  { name: 'NAS',     path: path.join(ROOT, 'NAS', 'ApprovalSystem-NAS-Install') },
  { name: 'Ubuntu',  path: path.join(ROOT, 'Ubuntu', 'ApprovalSystem-Ubuntu-Install') },
  { name: 'Windows', path: path.join(ROOT, 'Windows', 'ApprovalSystem-Portable', 'app') },
];

const DIRS  = ['server', 'public', 'fonts', 'docs', 'seed-workflows'];
const FILES = [
  'package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml',
  'docker-entrypoint.sh', '.dockerignore', 'start-server.js', 'CHANGELOG.md', 'README.md',
];

function copyDirSync(src, dst) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const t of TARGETS) {
  if (!fs.existsSync(t.path)) {
    console.log(`略過不存在: ${t.name} -> ${t.path}`);
    continue;
  }
  console.log(`\n=== ${t.name} ===`);

  for (const d of DIRS) {
    const s = path.join(SRC, d);
    if (!fs.existsSync(s)) continue;
    copyDirSync(s, path.join(t.path, d));
    console.log(`  dir  ${d}/`);
  }

  for (const f of FILES) {
    const s = path.join(SRC, f);
    if (!fs.existsSync(s)) continue;
    fs.copyFileSync(s, path.join(t.path, f));
    console.log(`  file ${f}`);
  }

  // 清除 mail 密鑰
  const mc = path.join(t.path, 'data', 'mail-config.json');
  if (fs.existsSync(mc)) { fs.unlinkSync(mc); console.log('  strip data/mail-config.json'); }

  // entrypoint LF 換行
  const ep = path.join(t.path, 'docker-entrypoint.sh');
  if (fs.existsSync(ep)) {
    let c = fs.readFileSync(ep, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    fs.writeFileSync(ep, c, 'utf8');
  }
}

// 寫同步紀錄
const stamp = new Date().toISOString().slice(0, 10);
const pkg   = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
const log   = [
  `同步時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
  `來源: ${SRC}`,
  `版本: ${pkg.version}`,
  `功能: admin 可設定備份目錄（backupDir）`,
  `目標: NAS / Ubuntu / Windows 一鍵安裝包`,
].join('\n');

const logPath = path.join(ROOT, `同步紀錄-${stamp}-備份目錄設定.txt`);
fs.writeFileSync(logPath, log, 'utf8');
console.log(`\n同步紀錄: ${logPath}`);
console.log('DONE');
