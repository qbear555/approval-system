/**
 * 應用程式版本
 * - 主版號：package.json 的 version（重大功能可手動調整）
 * - 自動建置戳：掃描 server/、public/ 等原始檔的內容指紋
 *   任一檔案修改後重啟服務，版本字串會自動變更
 */
const tz = require('./tz');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

/** 納入指紋的路徑（相對專案根） */
const SCAN_ENTRIES = ['package.json', 'server', 'public'];

/** 納入指紋的副檔名 */
const SCAN_EXTS = new Set([
  '.js',
  '.json',
  '.html',
  '.css',
  '.md',
  '.yml',
  '.yaml',
]);

let cached = null;
/** @type {Record<string, { size: number, mtimeMs: number, sha1: string }>|null} */
let cachedFiles = null;

function shouldScanFile(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return false;
  const ext = path.extname(base).toLowerCase();
  if (!ext) return false;
  return SCAN_EXTS.has(ext);
}

function walkFiles(absDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === 'node_modules' ||
        ent.name === 'data' ||
        ent.name === '.git' ||
        ent.name === 'uploads' ||
        ent.name === 'backups'
      ) {
        continue;
      }
      walkFiles(full, out);
    } else if (ent.isFile() && shouldScanFile(full)) {
      out.push(full);
    }
  }
}

function collectSourceFiles() {
  const files = [];
  for (const rel of SCAN_ENTRIES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isFile()) {
      if (shouldScanFile(abs) || path.basename(abs) === 'package.json') {
        files.push(abs);
      }
    } else if (st.isDirectory()) {
      walkFiles(abs, files);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/**
 * 逐檔快照（相對路徑 → size / mtime / sha1）
 * 供部署紀錄比對變更清單
 */
function buildFileSnapshots(files) {
  /** @type {Record<string, { size: number, mtimeMs: number, sha1: string }>} */
  const map = {};
  let maxMtimeMs = 0;
  const totalHash = crypto.createHash('sha1');

  for (const abs of files) {
    let st;
    let buf;
    try {
      st = fs.statSync(abs);
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const mtimeMs = Math.floor(st.mtimeMs);
    if (mtimeMs > maxMtimeMs) maxMtimeMs = mtimeMs;
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
    map[rel] = { size: st.size, mtimeMs, sha1 };

    totalHash.update(rel);
    totalHash.update('\0');
    totalHash.update(String(st.size));
    totalHash.update('\0');
    totalHash.update(String(mtimeMs));
    totalHash.update('\0');
    totalHash.update(buf);
    totalHash.update('\n');
  }

  const digest = totalHash.digest('hex');
  const short = digest.slice(0, 7);
  const d = maxMtimeMs ? new Date(maxMtimeMs) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`;

  return {
    files: map,
    hash: digest,
    short,
    stamp,
    builtAt: tz.nowIso(d),
    fileCount: Object.keys(map).length,
  };
}

function loadPackageMeta() {
  const pkgPath = path.join(ROOT, 'package.json');
  let version = '0.0.0';
  let name = 'approval-system';
  let description = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = String(pkg.version || '0.0.0');
    name = String(pkg.name || name);
    description = String(pkg.description || '');
  } catch {
    /* defaults */
  }
  return { version, name, description };
}

function load() {
  if (cached) return cached;

  const pkg = loadPackageMeta();
  const fileList = collectSourceFiles();
  const fp = buildFileSnapshots(fileList);
  cachedFiles = fp.files;

  const fullVersion = `${pkg.version}+${fp.stamp}.${fp.short}`;
  const label = `v${pkg.version}+${fp.short}`;
  const labelFull = `v${fullVersion}`;
  const banner = `線上簽核系統 ${label}`;

  cached = {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    fullVersion,
    label,
    labelFull,
    banner,
    build: fp.short,
    buildHash: fp.hash,
    buildStamp: fp.stamp,
    builtAt: fp.builtAt,
    sourceFiles: fp.fileCount,
    auto: true,
  };
  return cached;
}

function getVersionInfo() {
  return { ...load() };
}

/** 目前掃描到的原始檔快照（需先 load） */
function getFileSnapshots() {
  load();
  return { ...(cachedFiles || {}) };
}

function resetCache() {
  cached = null;
  cachedFiles = null;
}

module.exports = {
  getVersionInfo,
  getFileSnapshots,
  load,
  resetCache,
  ROOT,
};
