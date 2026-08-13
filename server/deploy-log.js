/**
 * 部署／重啟自動修改紀錄
 * - 每次行程啟動時比對 data/version-state.json 與目前程式指紋
 * - 若有變更：寫入 data/deploy-history.json，並附加 data/修改紀錄-自動.md（執行期，不進 git）
 * - 產品變更紀錄只維護倉庫根目錄 CHANGELOG.md（單一檔）
 */
const tz = require('./tz');
const fs = require('fs');
const path = require('path');
const appVersion = require('./version');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'version-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'deploy-history.json');
const AUTO_MD_DATA = path.join(DATA_DIR, '修改紀錄-自動.md');
const CHANGELOG_MD = path.join(ROOT, 'CHANGELOG.md');

const MAX_HISTORY = 80;
const MAX_FILES_LIST = 40;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function localNowIso() {
  return tz.nowIso();
}

function formatLocal(dt = new Date()) {
  const d = dt instanceof Date ? dt : new Date(dt);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 比對兩次檔案快照
 * @returns {{ added: string[], removed: string[], modified: string[] }}
 */
function diffSnapshots(prevFiles, nextFiles) {
  const prev = prevFiles || {};
  const next = nextFiles || {};
  const added = [];
  const removed = [];
  const modified = [];
  const all = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const rel of [...all].sort()) {
    const a = prev[rel];
    const b = next[rel];
    if (!a && b) added.push(rel);
    else if (a && !b) removed.push(rel);
    else if (a && b && a.sha1 !== b.sha1) modified.push(rel);
  }
  return { added, removed, modified };
}

function truncateList(arr, max = MAX_FILES_LIST) {
  if (!arr || arr.length <= max) return arr || [];
  return [...arr.slice(0, max), `…另有 ${arr.length - max} 個`];
}

function buildMarkdownEntry(entry) {
  const lines = [];
  lines.push(`## ${entry.atLocal} — ${entry.label}`);
  lines.push('');
  lines.push(`- **類型**：${entry.typeLabel}`);
  lines.push(`- **完整版號**：\`${entry.fullVersion}\``);
  if (entry.previousFullVersion) {
    lines.push(`- **前一版**：\`${entry.previousFullVersion}\``);
  }
  lines.push(`- **建置指紋**：\`${entry.build}\``);
  lines.push(`- **主版號**：\`${entry.version}\``);
  lines.push(`- **掃描檔案數**：${entry.sourceFiles}`);
  lines.push('');

  const ch = entry.changes || {};
  const hasFileChange =
    (ch.modified && ch.modified.length) ||
    (ch.added && ch.added.length) ||
    (ch.removed && ch.removed.length);

  if (entry.type === 'first') {
    lines.push('首次啟動並建立自動部署基線（尚無前一版可比對）。');
  } else if (entry.type === 'restart') {
    lines.push('程式指紋未變更（僅重啟服務，無原始碼差異）。');
  } else if (hasFileChange) {
    lines.push('### 變更檔案');
    lines.push('');
    if (ch.modified?.length) {
      lines.push('**修改**');
      for (const f of truncateList(ch.modified)) lines.push(`- \`${f}\``);
      lines.push('');
    }
    if (ch.added?.length) {
      lines.push('**新增**');
      for (const f of truncateList(ch.added)) lines.push(`- \`${f}\``);
      lines.push('');
    }
    if (ch.removed?.length) {
      lines.push('**移除**');
      for (const f of truncateList(ch.removed)) lines.push(`- \`${f}\``);
      lines.push('');
    }
  } else {
    lines.push('指紋已變更，但無法列出逐檔差異（可能為舊狀態格式）。');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function prependMarkdown(filePath, entry, headerTitle) {
  const block = buildMarkdownEntry(entry);
  let prev = '';
  try {
    if (fs.existsSync(filePath)) prev = fs.readFileSync(filePath, 'utf8');
  } catch {
    prev = '';
  }
  const header =
    prev && prev.startsWith('#')
      ? ''
      : `# ${headerTitle}\n\n> 本檔由系統於每次啟動／部署時自動更新。持久資料位於 \`data/\`。\n\n`;
  // 若已有標題，把新條目插在標題之後
  let body;
  if (prev.startsWith('# ')) {
    const idx = prev.indexOf('\n');
    const firstLine = prev.slice(0, idx + 1);
    const rest = prev.slice(idx + 1).replace(/^\n+/, '');
    // 去掉舊的開頭說明重複
    body = `${firstLine}\n> 本檔由系統於每次啟動／部署時自動更新（最新在上）。\n\n${block}${rest}`;
  } else {
    body = `${header}${block}${prev}`;
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return false;
    }
  }
  try {
    fs.writeFileSync(filePath, body, 'utf8');
    return true;
  } catch (e) {
    console.warn('[deploy-log] write md failed', filePath, e.message);
    return false;
  }
}

/** 更新 CHANGELOG.md 頂部「最近自動部署」區塊（產品修改紀錄只此一份） */
function updateMainChangelogPointer(entry) {
  if (!fs.existsSync(CHANGELOG_MD)) return false;
  let text;
  try {
    text = fs.readFileSync(CHANGELOG_MD, 'utf8');
  } catch {
    return false;
  }

  const markerStart = '<!-- AUTO-DEPLOY-SUMMARY-START -->';
  const markerEnd = '<!-- AUTO-DEPLOY-SUMMARY-END -->';
  const summary = [
    markerStart,
    '',
    '## 最近自動部署（系統寫入）',
    '',
    `| 項目 | 內容 |`,
    `|------|------|`,
    `| 時間 | ${entry.atLocal} |`,
    `| 版本 | \`${entry.label}\` / \`${entry.fullVersion}\` |`,
    `| 類型 | ${entry.typeLabel} |`,
    `| 指紋 | \`${entry.build}\` |`,
    `| 變更檔 | 修改 ${(entry.changes?.modified || []).length} · 新增 ${(entry.changes?.added || []).length} · 移除 ${(entry.changes?.removed || []).length} |`,
    '',
    '執行期逐次指紋紀錄只寫在伺服器 `data/修改紀錄-自動.md`（不進 git）。產品說明以此檔為準。',
    '',
    markerEnd,
  ].join('\n');

  if (text.includes(markerStart) && text.includes(markerEnd)) {
    text = text.replace(
      new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
      summary
    );
  } else {
    const h1 = text.match(/^# .+\n/);
    if (h1) {
      text = text.replace(h1[0], `${h1[0]}\n${summary}\n`);
    } else {
      text = `${summary}\n\n${text}`;
    }
  }
  try {
    fs.writeFileSync(CHANGELOG_MD, text, 'utf8');
    return true;
  } catch (e) {
    console.warn('[deploy-log] update CHANGELOG.md failed', e.message);
    return false;
  }
}

/**
 * 行程啟動時呼叫：比對並寫入部署紀錄
 * @param {{ recordRestarts?: boolean }} [opts]
 *   recordRestarts=false（預設）時，指紋未變的純重啟不寫入歷史（僅更新 lastSeen）
 */
function recordOnStartup(opts = {}) {
  const recordRestarts = !!opts.recordRestarts;
  const ver = appVersion.getVersionInfo();
  const files = appVersion.getFileSnapshots();
  const prev = readJson(STATE_PATH, null);
  const now = localNowIso();
  const atLocal = formatLocal(new Date());

  let type = 'deploy';
  let typeLabel = '程式變更部署';
  let changes = { added: [], removed: [], modified: [] };

  if (!prev || !prev.build) {
    type = 'first';
    typeLabel = '首次啟動／建立基線';
  } else if (prev.build === ver.build && prev.buildHash === ver.buildHash) {
    type = 'restart';
    typeLabel = '服務重啟（無程式變更）';
    // 仍可比對（理論上應為空）
    changes = diffSnapshots(prev.files || {}, files);
  } else {
    type = 'deploy';
    typeLabel = '程式變更部署';
    changes = diffSnapshots(prev.files || {}, files);
  }

  const entry = {
    id: `${ver.buildStamp || 'boot'}-${ver.build}-${Date.now().toString(36)}`,
    at: now,
    atLocal,
    type,
    typeLabel,
    version: ver.version,
    fullVersion: ver.fullVersion,
    label: ver.label,
    labelFull: ver.labelFull,
    build: ver.build,
    buildHash: ver.buildHash,
    previousBuild: prev?.build || null,
    previousFullVersion: prev?.fullVersion || null,
    sourceFiles: ver.sourceFiles,
    changes: {
      added: changes.added,
      removed: changes.removed,
      modified: changes.modified,
      modifiedCount: changes.modified.length,
      addedCount: changes.added.length,
      removedCount: changes.removed.length,
    },
  };

  // 更新 state（永遠寫）
  writeJson(STATE_PATH, {
    version: ver.version,
    fullVersion: ver.fullVersion,
    label: ver.label,
    build: ver.build,
    buildHash: ver.buildHash,
    buildStamp: ver.buildStamp,
    builtAt: ver.builtAt,
    sourceFiles: ver.sourceFiles,
    files,
    lastBootAt: now,
    lastRecordType: type,
  });

  const shouldWriteHistory = type !== 'restart' || recordRestarts;
  if (shouldWriteHistory) {
    const hist = readJson(HISTORY_PATH, { entries: [] });
    const list = Array.isArray(hist.entries) ? hist.entries : [];
    list.unshift(entry);
    while (list.length > MAX_HISTORY) list.pop();
    writeJson(HISTORY_PATH, {
      updatedAt: now,
      entries: list,
    });

    prependMarkdown(AUTO_MD_DATA, entry, '線上簽核系統 — 自動部署修改紀錄');
    if (type === 'deploy' || type === 'first') {
      updateMainChangelogPointer(entry);
    }

    console.log(
      `[deploy-log] 已記錄：${typeLabel} ${ver.label}（修改 ${entry.changes.modifiedCount} / 新增 ${entry.changes.addedCount} / 移除 ${entry.changes.removedCount}）`
    );
  } else {
    console.log(`[deploy-log] 指紋未變（${ver.label}），略過寫入歷史（純重啟）`);
  }

  return {
    recorded: shouldWriteHistory,
    entry,
    type,
  };
}

function listHistory(limit = 20) {
  const hist = readJson(HISTORY_PATH, { entries: [] });
  const list = Array.isArray(hist.entries) ? hist.entries : [];
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return {
    updatedAt: hist.updatedAt || null,
    total: list.length,
    entries: list.slice(0, n),
  };
}

function getLatest() {
  const hist = listHistory(1);
  return hist.entries[0] || null;
}

module.exports = {
  recordOnStartup,
  listHistory,
  getLatest,
  HISTORY_PATH,
  AUTO_MD_DATA,
};
