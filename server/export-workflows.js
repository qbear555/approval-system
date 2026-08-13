/**
 * 匯出啟用中的簽核流程模組到資料夾
 * 含：表單欄位 + 簽核步驟 + PDF 排版類型
 * 不含：系統設定、Email、使用者、歷史單據
 * 用法：node server/export-workflows.js [輸出目錄]
 */
const tz = require('./tz');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildExportModule,
  parsePdfLayoutJson,
  parseFinalNotifyJson,
} = require('./workflow-module');

function getDesktopDir() {
  const candidates = [
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop'),
    path.join(os.homedir(), 'Desktop'),
    'F:\\TsuMing\\Desktop',
    'C:\\Users\\TsuMing\\Desktop',
  ].filter(Boolean);
  for (const d of candidates) {
    if (d && fs.existsSync(d)) return d;
  }
  return path.join(os.homedir(), 'Desktop');
}

function safeName(name) {
  return String(name || 'workflow')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function resolveApproverNames(ids) {
  return (ids || []).map((id) => {
    const u = db.prepare(`SELECT id, username, name FROM users WHERE id = ?`).get(id);
    return u
      ? { id: u.id, username: u.username, name: u.name }
      : { id, username: null, name: null };
  });
}

function normalizeSteps(stepsJson) {
  let steps = [];
  try {
    steps = JSON.parse(stepsJson || '[]');
  } catch {
    steps = [];
  }
  return (steps || []).map((s, i) => {
    const order = s.order != null ? s.order : i + 1;
    return {
      order,
      name: s.name || `步驟${order}`,
      assignType: s.assignType || 'users',
      mode: s.mode || 'any',
      formFieldId: s.formFieldId || '',
      department: s.department || '',
      approverIds: Array.isArray(s.approverIds) ? s.approverIds.map(Number).filter(Boolean) : [],
      approvers: resolveApproverNames(s.approverIds),
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      skipIfNoApprover: Boolean(s.skipIfNoApprover),
    };
  });
}

function normalizeFields(fieldsJson) {
  try {
    return JSON.parse(fieldsJson || '[]') || [];
  } catch {
    return [];
  }
}

const outDir =
  process.argv[2] ||
  path.join(getDesktopDir(), '簽核流程_表單匯出');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const workflows = db
  .prepare(
    `SELECT id, name, description, steps_json, form_fields_json, pdf_layout_json, final_notify_json, active, created_at, updated_at
     FROM workflows
     WHERE active = 1 AND COALESCE(purged, 0) = 0
     ORDER BY id`
  )
  .all();

const pack = {
  format: 'approval-system-workflows',
  version: 2,
  module: 'workflow+form+pdfLayout+finalNotify',
  exportedAt: tz.nowIso(),
  systemUrl: 'http://127.0.0.1:3847/',
  count: workflows.length,
  workflows: [],
};

function enrichNotifyForExport(raw) {
  const n = parseFinalNotifyJson(raw);
  const users = (n.userIds || []).map((id) => {
    const u = db.prepare(`SELECT id, username, name FROM users WHERE id = ?`).get(id);
    return u
      ? { id: u.id, username: u.username, name: u.name }
      : { id, username: null, name: null };
  });
  return {
    enabled: n.enabled,
    userIds: n.userIds,
    users,
    label: n.label,
  };
}

const files = [];
workflows.forEach((w, idx) => {
  const formFields = normalizeFields(w.form_fields_json);
  const steps = normalizeSteps(w.steps_json);
  const pdfLayout = parsePdfLayoutJson(w.pdf_layout_json, w.name);
  const finalNotify = enrichNotifyForExport(w.final_notify_json);
  const item = buildExportModule({
    id: w.id,
    name: w.name,
    description: w.description || '',
    formFields,
    steps,
    pdfLayout,
    finalNotify,
    exportedAt: pack.exportedAt,
  });
  pack.workflows.push(item);

  const fname = `${String(idx + 1).padStart(2, '0')}_${safeName(w.name)}.json`;
  const fpath = path.join(outDir, fname);
  fs.writeFileSync(fpath, JSON.stringify(item, null, 2), 'utf8');
  files.push(fname);
  console.log(
    'WROTE',
    fname,
    'fields=',
    formFields.length,
    'steps=',
    steps.length,
    'finalNotify=',
    finalNotify.enabled ? finalNotify.userIds.length : 'off'
  );
});

const packPath = path.join(outDir, '全部簽核流程_可匯入.json');
fs.writeFileSync(packPath, JSON.stringify(pack, null, 2), 'utf8');
files.push('全部簽核流程_可匯入.json');

const readme = `線上簽核系統 — 簽核流程模組匯出包（流程＋表單＋PDF 排版）
========================================
產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}
流程數量：${workflows.length}
輸出目錄：${outDir}
格式版本：2（module: workflow+form+pdfLayout+finalNotify）

【檔案說明】
1. 01_xxx.json …
   各申請表單獨立模組：
   - formFields   申請單欄位
   - steps        簽核步驟
   - pdfLayout    PDF 排版類型（leave／credit_limit／…）
   - finalNotify  最終核准完成通知（enabled／選定人員）
2. 全部簽核流程_可匯入.json
   一次匯入全部模組

【如何匯入】
  登入 → 簽核流程 →「匯入流程模組」
  或：node server/import-workflows.js "…\\全部簽核流程_可匯入.json"

【注意】
- 匯入依「流程名稱」更新或新增；不影響系統設定／Email／使用者／歷史單據
- 指定人員／最終通知對象依 username 對應；帳號不存在則略過
- PDF 版面隨模組匯入；type=auto 時依流程名稱自動判斷
- finalNotify.enabled=true 時，最終一步（如總經理）核定後會 Email 通知選定人員

【目前匯出流程】
${workflows.map((w, i) => `${i + 1}. ${w.name}`).join('\n')}
`;
fs.writeFileSync(path.join(outDir, 'README_匯入說明.txt'), readme, 'utf8');

console.log('DIR', outDir);
console.log('COUNT', workflows.length);
console.log('FILES', files.join(', '));
