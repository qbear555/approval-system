/**
 * 準備安裝包種子資料：
 * 保留：成員名單、權限、部門、申請表單、簽核流程
 * 清空：所有簽核申請／歷程／附件、PDF 備份、uploads、mail-outbox
 *
 * 輸出：dist/seed-data/
 * 來源：data/approval.db（建議先 pull-nas-data）
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('child_process');

const Root = path.join(__dirname, '..');
const SrcDb = path.join(Root, 'data', 'approval.db');
const SrcData = path.join(Root, 'data');
const OutDir = path.join(Root, 'dist', 'seed-data');
const OutDbDir = path.join(OutDir, 'data');
const OutWfDir = path.join(OutDir, 'workflows');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function rmrf(d) {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

function copyDir(src, dest, { skipFiles = false } = {}) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dest);
  if (skipFiles) return 0;
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      n += copyDir(s, d);
    } else {
      if (/\.log$/i.test(name)) continue;
      if (/^test-|^api-pdf|^font-test|^chinese-fix|^test-download/i.test(name)) continue;
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

/** 清空簽核相關表，保留 users / departments / workflows 等設定 */
function purgeTransactionalData(dbPath) {
  const db = new DatabaseSync(dbPath);
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);

  const keepTables = new Set([
    'users',
    'user_departments',
    'departments',
    'workflows',
    'sqlite_sequence',
  ]);

  // 明確清空的交易表（若存在）
  const purgeList = [
    'approval_actions',
    'request_attachments',
    'approval_requests',
    'attachments',
    'notifications',
    'mail_log',
    'audit_log',
    'system_backups',
  ];

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const t of purgeList) {
      if (tables.includes(t)) {
        db.exec(`DELETE FROM ${t}`);
        console.log('  purged table:', t);
      }
    }
    // 其餘非 keep 表也清空（避免漏掉未來新增的交易表）
    for (const t of tables) {
      if (t.startsWith('sqlite_')) continue;
      if (keepTables.has(t)) continue;
      if (purgeList.includes(t)) continue;
      try {
        db.exec(`DELETE FROM ${t}`);
        console.log('  purged other table:', t);
      } catch (e) {
        console.warn('  skip table', t, e.message);
      }
    }
    // 重置 autoincrement（簽核單從 1 開始）
    if (tables.includes('sqlite_sequence')) {
      db.exec(
        `DELETE FROM sqlite_sequence WHERE name IN (
          'approval_requests','approval_actions','request_attachments','attachments'
        )`
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON');
  try {
    db.exec('VACUUM');
  } catch (e) {
    console.warn('VACUUM warn:', e.message);
  }
  db.close();
}

if (!fs.existsSync(SrcDb)) {
  console.error('Source DB not found:', SrcDb);
  process.exit(1);
}

rmrf(OutDir);
ensureDir(OutDbDir);
ensureDir(OutWfDir);
ensureDir(path.join(OutDbDir, 'uploads'));
ensureDir(path.join(OutDbDir, 'backups'));
ensureDir(path.join(OutDbDir, 'mail-outbox'));

// Checkpoint + clean single-file DB
const src = new DatabaseSync(SrcDb);
try {
  src.exec('PRAGMA wal_checkpoint(TRUNCATE)');
} catch (e) {
  console.warn('checkpoint warn:', e.message);
}

const destDbPath = path.join(OutDbDir, 'approval.db');
try {
  if (fs.existsSync(destDbPath)) fs.unlinkSync(destDbPath);
  src.exec(`VACUUM INTO '${destDbPath.replace(/'/g, "''")}'`);
  console.log('VACUUM INTO seed DB OK');
} catch (e) {
  console.warn('VACUUM INTO failed, fallback copy:', e.message);
  fs.copyFileSync(SrcDb, destDbPath);
  for (const ext of ['-wal', '-shm']) {
    const p = destDbPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
src.close();

// 清空簽核紀錄（保留成員／權限／部門／表單流程）
console.log('Purging approval records from seed DB...');
purgeTransactionalData(destDbPath);

// 不複製 uploads / backups / mail-outbox 內容（僅空目錄）
// calendar 保留（若有辦公日曆）
const nUp = 0;
const nBk = 0;
const nMo = 0;
const nCal = copyDir(path.join(SrcData, 'calendar'), path.join(OutDbDir, 'calendar'));
// 一鍵安裝包規則：不含 Email 設定
// - 不複製 mail-config.json（SMTP 主機／帳密）
// - 不複製 mail-outbox 信件內容
// 安裝後由管理員於 UI 自行設定 Email
console.log('copied files:', {
  uploads: nUp,
  backups: nBk,
  mailOutbox: nMo,
  calendar: nCal,
  note: 'no mail-config.json; uploads/backups/mail-outbox emptied by design',
});

// Verify seed counts
const seed = new DatabaseSync(destDbPath);
const users = seed.prepare(`SELECT COUNT(*) AS c FROM users WHERE active = 1`).get().c;
const workflows = seed
  .prepare(`SELECT COUNT(*) AS c FROM workflows WHERE active = 1 AND IFNULL(purged,0)=0`)
  .get().c;
const depts = seed.prepare(`SELECT COUNT(*) AS c FROM departments WHERE active = 1`).get().c;
const requests = seed.prepare(`SELECT COUNT(*) AS c FROM approval_requests`).get().c;
const attachments = (() => {
  try {
    return seed.prepare(`SELECT COUNT(*) AS c FROM request_attachments`).get().c;
  } catch {
    return 0;
  }
})();
const actions = (() => {
  try {
    return seed.prepare(`SELECT COUNT(*) AS c FROM approval_actions`).get().c;
  } catch {
    return 0;
  }
})();
const wfNames = seed
  .prepare(
    `SELECT id, name FROM workflows WHERE active = 1 AND IFNULL(purged,0)=0 ORDER BY id`
  )
  .all();
const userRows = seed
  .prepare(
    `SELECT id, username, name, department, role, email, permissions_json, hire_date, sl_used_days, sl_used_hours
     FROM users WHERE active = 1 ORDER BY id`
  )
  .all();
const deptRows = seed
  .prepare(`SELECT id, name FROM departments WHERE active = 1 ORDER BY sort_order, id`)
  .all();
seed.close();

if (requests !== 0 || attachments !== 0 || actions !== 0) {
  console.error('ERROR: seed still has transactional data', {
    requests,
    attachments,
    actions,
  });
  process.exit(1);
}

// Export workflow JSON（從目前 data/approval.db 匯出流程定義；與種子流程一致）
const exp = spawnSync(
  process.execPath,
  [path.join(Root, 'server', 'export-workflows.js'), OutWfDir],
  { encoding: 'utf8' }
);
if (exp.stdout) process.stdout.write(exp.stdout);
if (exp.stderr) process.stderr.write(exp.stderr);
if (exp.status !== 0) {
  console.warn('export-workflows exit', exp.status);
}

// Members CSV (UTF-8 BOM for Excel)
const csvLines = [
  '\uFEFFusername,name,department,role,email,default_password_hint',
];
for (const u of userRows) {
  const hint = u.username === 'admin' ? 'admin123' : 'pass1234（若曾改過密碼以實際為準）';
  csvLines.push(
    [
      u.username,
      `"${String(u.name || '').replace(/"/g, '""')}"`,
      `"${String(u.department || '').replace(/"/g, '""')}"`,
      u.role || 'user',
      u.email || '',
      `"${hint}"`,
    ].join(',')
  );
}
fs.writeFileSync(path.join(OutDir, '成員帳號清單.csv'), csvLines.join('\n'), 'utf8');

const manifest = {
  format: 'approval-system-seed',
  version: 3,
  createdAt: new Date().toISOString(),
  description:
    '乾淨種子：成員名單（含權限／到職／特休已休）、部門、申請表單與簽核流程；不含任何簽核紀錄、附件與備份',
  counts: {
    users,
    workflows,
    departments: depts,
    requests: 0,
    attachments: 0,
    actions: 0,
    uploadFiles: 0,
    backupFiles: 0,
  },
  workflows: wfNames,
  departments: deptRows,
  users: userRows.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    department: u.department,
    role: u.role,
    email: u.email || '',
    hire_date: u.hire_date || null,
  })),
  loginHints: {
    admin: 'admin / admin123',
    others: '多數帳號預設密碼 pass1234（若曾修改以實際為準）',
    windowsUrl: 'http://127.0.0.1:8080/',
    dockerUrl: 'http://127.0.0.1:3847/',
  },
};
fs.writeFileSync(path.join(OutDir, 'SEED-MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');

const readme = `線上簽核系統 — 安裝包種子資料（乾淨版）
================================
產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}
成員人數：${users}
簽核流程：${workflows}
部門數量：${depts}
申請單數：0（已清空）
附件／備份：0（已清空）

【保留】
- 成員名單（帳號、密碼、權限、部門、到職日、特休已休）
- 部門設定
- 申請表單與簽核流程

【已清空】
- 所有簽核申請單與簽核歷程
- 附件 uploads
- PDF／ZIP 備份 backups
- 郵件寄送佇列 mail-outbox

【內容】
- data/approval.db     乾淨 SQLite
- data/uploads/        空目錄
- data/backups/        空目錄
- workflows/           簽核流程 JSON（可再匯入）
- 成員帳號清單.csv
- SEED-MANIFEST.json

【啟用中的簽核流程】
${wfNames.map((w, i) => `${i + 1}. ${w.name}`).join('\n')}

【部門】
${deptRows.map((d) => `- ${d.name}`).join('\n')}

【登入】
  Windows 預設：http://127.0.0.1:8080/
  Docker／NAS／Ubuntu 預設：http://主機IP:3847/
  管理員：admin / admin123
  其他成員：見「成員帳號清單.csv」（多為 pass1234）

全新安裝時，安裝程式會自動帶入本種子資料庫。
若目標已有資料庫，安裝會保留舊資料、不覆蓋。
`;
fs.writeFileSync(path.join(OutDir, 'README.txt'), readme, 'utf8');

console.log('SEED OK (clean)', {
  users,
  workflows,
  departments: depts,
  requests: 0,
  attachments: 0,
  out: OutDir,
});
console.log(
  'Workflows:',
  wfNames.map((w) => w.name).join(', ')
);
