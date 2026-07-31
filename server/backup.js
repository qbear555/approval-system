/**
 * 管理員備份：依 部門 / 申請表單類別 / 年月 存放
 * - 未啟用加密且無附件：簽核單 PDF
 * - 未啟用加密且有附件：ZIP（簽核單.pdf + 附件/…）
 * - 啟用 AES-256 加密：一律 ZIP（含僅 PDF），需在系統設定設定密碼
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('./db');
const {
  writeApprovalPdf,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
} = require('./pdf');
const pdfSign = require('./pdf-sign');
const systemSettings = require('./system-settings');

const BACKUP_ROOT = path.join(__dirname, '..', 'data', 'backups');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

let encryptedFormatRegistered = false;

function ensureEncryptedFormat() {
  if (encryptedFormatRegistered) return;
  archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));
  encryptedFormatRegistered = true;
}

/**
 * 建立 ZIP archive
 * @param {{ password?: string }} [opts]
 */
function createZipArchive(opts = {}) {
  const password = opts.password ? String(opts.password) : '';
  if (password) {
    ensureEncryptedFormat();
    return archiver.create('zip-encrypted', {
      zlib: { level: 8 },
      encryptionMethod: 'aes256',
      password,
    });
  }
  return archiver('zip', { zlib: { level: 8 } });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeSegment(name) {
  return (
    String(name || '未分類')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '未分類'
  );
}

function safeZipEntryName(name, fallback = 'file') {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

function periodFromRequest(row) {
  const raw = row.completed_at || row.created_at || '';
  const m = String(raw).match(/(\d{4})-(\d{2})/);
  if (m) return { year: m[1], month: m[2] };
  const d = new Date();
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'),
  };
}

function getRequestAttachments(requestId) {
  return db
    .prepare(
      `SELECT id, original_name, stored_name FROM request_attachments
       WHERE request_id = ? ORDER BY id ASC`
    )
    .all(Number(requestId));
}

/** 產生簽核 PDF Buffer（含可選公司憑證數位簽章） */
async function buildPdfBuffer(detail) {
  return pdfSign.buildApprovalPdfBuffer(detail, writeApprovalPdf);
}

/** 將 stream 寫入完成 */
function waitStreamFinish(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * 寫入 ZIP（可選 AES-256 密碼）
 * @param {string} absFile
 * @param {Buffer} pdfBuf
 * @param {object} detail
 * @param {Array} atts
 * @param {string} [password]
 */
async function writeZipBackup(absFile, pdfBuf, detail, atts, password) {
  const out = fs.createWriteStream(absFile);
  const finished = waitStreamFinish(out);
  const archive = createZipArchive({ password: password || '' });
  archive.on('error', (err) => {
    out.destroy(err);
  });
  archive.pipe(out);

  const pdfInner = safeZipEntryName(
    buildApprovalPdfFileName(detail),
    `approval-${detail.id}.pdf`
  );
  archive.append(pdfBuf, { name: pdfInner });

  const usedNames = new Set([pdfInner.toLowerCase()]);
  for (const att of atts) {
    const abs = path.join(UPLOAD_DIR, att.stored_name);
    if (!fs.existsSync(abs)) continue;
    let entry = safeZipEntryName(att.original_name, `附件-${att.id}`);
    let finalName = entry;
    let n = 1;
    while (usedNames.has(finalName.toLowerCase())) {
      const ext = path.extname(entry);
      const stem = ext ? entry.slice(0, -ext.length) : entry;
      finalName = `${stem}_${n}${ext}`;
      n += 1;
    }
    usedNames.add(finalName.toLowerCase());
    archive.file(abs, { name: `附件/${finalName}` });
  }
  await archive.finalize();
  await finished;
}

/**
 * 備份單一簽核單（需完整 detail）
 * 有上傳附件時改存 ZIP；啟用備份加密時一律 ZIP（AES-256）
 */
async function backupOneRequest(detail, adminId) {
  if (!detail?.id) throw new Error('無效的簽核單');

  const encryptCfg = systemSettings.getBackupEncryptConfig();
  if (encryptCfg.enabled && !encryptCfg.hasPass) {
    throw new Error(
      '已啟用備份加密，但尚未設定密碼。請於系統設定 → 備份加密 設定密碼後再執行。'
    );
  }
  const useEncrypt = !!encryptCfg.ready;
  const password = useEncrypt ? encryptCfg.passphrase : '';

  const department = safeSegment(detail.requester_dept || '未設定部門');
  const workflowName = safeSegment(detail.workflow_name || '未分類表單');
  const { year, month } = periodFromRequest(detail);
  const status = detail.status || '';

  const atts = getRequestAttachments(detail.id).filter((a) => {
    if (!a.stored_name) return false;
    return fs.existsSync(path.join(UPLOAD_DIR, a.stored_name));
  });
  const hasAttachments = atts.length > 0;
  // 加密時一律 ZIP；否則有附件才 ZIP
  const asZip = useEncrypt || hasAttachments;

  // 檔名：表單名稱_申請人_日期+五位流水號；僅有附件才加「_含附件」
  const fileName = asZip
    ? buildApprovalZipFileName(detail, { hasAttachments })
    : buildApprovalPdfFileName(detail);
  const relDir = path.join(department, workflowName, `${year}-${month}`);
  const absDir = path.join(BACKUP_ROOT, relDir);
  ensureDir(absDir);
  const absFile = path.join(absDir, fileName);
  const relFile = path.join(relDir, fileName).replace(/\\/g, '/');

  // 舊檔清理（同一 request_id 可能改名或 PDF↔ZIP 互換）
  const prev = db.prepare(`SELECT file_rel_path FROM backup_files WHERE request_id = ?`).get(detail.id);
  if (prev?.file_rel_path) {
    const oldAbs = path.join(BACKUP_ROOT, prev.file_rel_path);
    if (fs.existsSync(oldAbs) && path.resolve(oldAbs) !== path.resolve(absFile)) {
      try {
        fs.unlinkSync(oldAbs);
      } catch {
        /* ignore */
      }
    }
  }

  const pdfBuf = await buildPdfBuffer(detail);
  if (asZip) {
    await writeZipBackup(absFile, pdfBuf, detail, atts, password);
  } else {
    fs.writeFileSync(absFile, pdfBuf);
  }

  db.prepare(
    `INSERT INTO backup_files (
       request_id, department, workflow_name, period_year, period_month,
       file_rel_path, file_name, title, requester_name, status, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(request_id) DO UPDATE SET
       department = excluded.department,
       workflow_name = excluded.workflow_name,
       period_year = excluded.period_year,
       period_month = excluded.period_month,
       file_rel_path = excluded.file_rel_path,
       file_name = excluded.file_name,
       title = excluded.title,
       requester_name = excluded.requester_name,
       status = excluded.status,
       created_by = excluded.created_by,
       created_at = datetime('now','localtime')`
  ).run(
    detail.id,
    department,
    workflowName,
    year,
    month,
    relFile,
    fileName,
    detail.title || '',
    detail.requester_name || '',
    status,
    adminId || null
  );

  return {
    request_id: detail.id,
    department,
    workflow_name: workflowName,
    period: `${year}-${month}`,
    file_name: fileName,
    file_rel_path: relFile,
    has_attachments: hasAttachments,
    attachment_count: atts.length,
    encrypted: useEncrypt,
  };
}

/**
 * 批次備份
 */
async function runBackupJob(opts, getDetail, adminId) {
  const {
    status = 'approved',
    department = '',
    workflow_name = '',
    date_from = '',
    date_to = '',
    force = false,
  } = opts || {};

  // 啟用加密卻未設密碼時，整批先失敗（避免只部分寫入）
  const encryptCfg = systemSettings.getBackupEncryptConfig();
  if (encryptCfg.enabled && !encryptCfg.hasPass) {
    throw new Error(
      '已啟用備份加密，但尚未設定密碼。請於系統設定 → 備份加密 設定密碼後再執行。'
    );
  }

  let sql = `
    SELECT r.id, r.status, r.created_at, r.completed_at,
           w.name AS workflow_name, u.department AS requester_dept, u.name AS requester_name
    FROM approval_requests r
    JOIN workflows w ON w.id = r.workflow_id
    JOIN users u ON u.id = r.requester_id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    sql += ` AND r.status = ?`;
    params.push(status);
  }
  if (department) {
    sql += ` AND u.department = ?`;
    params.push(department);
  }
  if (workflow_name) {
    sql += ` AND w.name = ?`;
    params.push(workflow_name);
  }
  if (date_from) {
    sql += ` AND date(COALESCE(r.completed_at, r.created_at)) >= date(?)`;
    params.push(date_from);
  }
  if (date_to) {
    sql += ` AND date(COALESCE(r.completed_at, r.created_at)) <= date(?)`;
    params.push(date_to);
  }
  sql += ` ORDER BY r.id ASC LIMIT 500`;

  const rows = db.prepare(sql).all(...params);
  const results = { total: rows.length, success: 0, skipped: 0, failed: 0, items: [], errors: [] };

  for (const row of rows) {
    if (!force) {
      const exists = db.prepare(`SELECT id FROM backup_files WHERE request_id = ?`).get(row.id);
      if (exists) {
        results.skipped += 1;
        continue;
      }
    }
    try {
      const detail = getDetail(row.id);
      if (!detail) throw new Error('找不到詳情');
      const item = await backupOneRequest(detail, adminId);
      results.success += 1;
      results.items.push(item);
    } catch (e) {
      results.failed += 1;
      results.errors.push({ request_id: row.id, error: e.message || String(e) });
    }
  }

  return results;
}

function listBackups(query = {}) {
  const {
    department = '',
    workflow_name = '',
    year = '',
    month = '',
    keyword = '',
    status = '',
    limit = 200,
  } = query;

  let sql = `SELECT * FROM backup_files WHERE 1=1`;
  const params = [];
  if (department) {
    sql += ` AND department = ?`;
    params.push(department);
  }
  if (workflow_name) {
    sql += ` AND workflow_name = ?`;
    params.push(workflow_name);
  }
  if (year) {
    sql += ` AND period_year = ?`;
    params.push(year);
  }
  if (month) {
    sql += ` AND period_month = ?`;
    params.push(String(month).padStart(2, '0'));
  }
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (keyword) {
    sql += ` AND (title LIKE ? OR requester_name LIKE ? OR file_name LIKE ? OR CAST(request_id AS TEXT) LIKE ?)`;
    const k = `%${keyword}%`;
    params.push(k, k, k, k);
  }
  sql += ` ORDER BY period_year DESC, period_month DESC, id DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 200, 500));

  return db.prepare(sql).all(...params);
}

function getBackupMeta() {
  const departments = db
    .prepare(
      `SELECT DISTINCT department AS name FROM backup_files WHERE department != '' ORDER BY department`
    )
    .all()
    .map((r) => r.name);
  const allDepts = db
    .prepare(`SELECT name FROM departments WHERE active = 1 ORDER BY sort_order, name`)
    .all()
    .map((r) => r.name);
  // 申請表單類別：僅列出「未刪除」的流程（purged=0），已刪除表單不出現在下拉選單
  const activeWfNames = db
    .prepare(
      `SELECT DISTINCT name FROM workflows
       WHERE IFNULL(purged, 0) = 0
       ORDER BY name`
    )
    .all()
    .map((r) => r.name);
  const activeWfSet = new Set(activeWfNames);
  // 備份紀錄中若有舊表單名，也只保留仍存在且未刪除者
  const workflowsFromBackup = db
    .prepare(
      `SELECT DISTINCT workflow_name AS name FROM backup_files
       WHERE workflow_name != '' ORDER BY workflow_name`
    )
    .all()
    .map((r) => r.name)
    .filter((n) => activeWfSet.has(n));
  const years = db
    .prepare(
      `SELECT DISTINCT period_year AS y FROM backup_files WHERE period_year != '' ORDER BY y DESC`
    )
    .all()
    .map((r) => r.y);
  const count = db.prepare(`SELECT COUNT(*) AS c FROM backup_files`).get().c;
  const encryptCfg = systemSettings.getBackupEncryptConfig();
  return {
    departments: [...new Set([...allDepts, ...departments])],
    workflows: [...new Set([...activeWfNames, ...workflowsFromBackup])].sort((a, b) =>
      String(a).localeCompare(String(b), 'zh-Hant')
    ),
    years,
    total: count,
    backup_root: BACKUP_ROOT,
    encrypt: {
      enabled: encryptCfg.enabled,
      hasPass: encryptCfg.hasPass,
      ready: encryptCfg.ready,
    },
  };
}

function getBackupById(id) {
  return db.prepare(`SELECT * FROM backup_files WHERE id = ?`).get(Number(id));
}

function resolveBackupAbsPath(row) {
  if (!row?.file_rel_path) return null;
  const abs = path.join(BACKUP_ROOT, row.file_rel_path);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

function isZipBackup(row) {
  const name = String(row?.file_name || row?.file_rel_path || '');
  return /\.zip$/i.test(name);
}

/** 刪除備份紀錄與實體檔 */
function deleteBackup(id) {
  const row = getBackupById(id);
  if (!row) return { ok: false, error: '找不到備份' };
  const abs = resolveBackupAbsPath(row);
  if (abs) {
    try {
      fs.unlinkSync(abs);
    } catch (e) {
      console.warn('[backup] unlink failed', abs, e.message);
    }
  }
  db.prepare(`DELETE FROM backup_files WHERE id = ?`).run(Number(id));
  return {
    ok: true,
    id: Number(id),
    request_id: row.request_id,
    file_name: row.file_name,
  };
}

function deleteBackups(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  const deleted = [];
  const failed = [];
  for (const id of list) {
    const r = deleteBackup(id);
    if (r.ok) deleted.push(r);
    else failed.push({ id, error: r.error });
  }
  return { deleted, failed };
}

module.exports = {
  BACKUP_ROOT,
  backupOneRequest,
  runBackupJob,
  listBackups,
  getBackupMeta,
  getBackupById,
  resolveBackupAbsPath,
  isZipBackup,
  deleteBackup,
  deleteBackups,
  ensureDir,
  createZipArchive,
};
