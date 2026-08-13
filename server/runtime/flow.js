/**
 * 簽核步驟、表單、關卡推進
 */
const db = require('../db');
const tz = require('../tz');
const labor = require('../labor');
const flowGraph = require('../flow-graph');
const flowEngineFactory = require('../flow-engine');
const workflowModule = require('../workflow-module');
const {
  isFinanceUser,
  getUserDepartments,
  userHasPermission,
} = require('./perms');
function loadFinalNotifyReceiptsForRequest(...a) {
  return require('./notify').loadFinalNotifyReceiptsForRequest(...a);
}
function enrichFinalNotifyUsers(...a) {
  return require('./notify').enrichFinalNotifyUsers(...a);
}

function isFinalApprovalStep(steps, step) {
  if (!step || !Array.isArray(steps) || !steps.length) return false;
  const maxOrder = Math.max(...steps.map((s) => Number(s.order) || 0));
  return Number(step.order) === maxOrder;
}

/** 目前使用者可否在簽核中補充附件（非最終審核步驟） */

function canUserAttachOnStep(userId, detail) {
  if (!detail || detail.status !== 'pending') return false;
  const steps = detail.steps || [];
  const step = findStepByOrder(steps, detail.current_step);
  if (!canUserApproveStep(userId, step, detail.id)) return false;
  if (isFinalApprovalStep(steps, step)) return false;
  return true;
}


function hasApproverSigned(requestId, detail = null) {
  const id = Number(requestId);
  if (!id) return false;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_actions
       WHERE request_id = ? AND action = 'approve'`
    )
    .get(id);
  if ((row?.c || 0) > 0) return true;
  const stepOrder =
    detail && detail.current_step != null
      ? Number(detail.current_step)
      : Number(
          db
            .prepare(`SELECT current_step FROM approval_requests WHERE id = ?`)
            .get(id)?.current_step || 0
        );
  // 已前進到下一關（預設第一關 order 多為 1）
  if (Number.isFinite(stepOrder) && stepOrder > 1) return true;
  return false;
}


const MSG_LOCKED_AFTER_SIGN =
  '下一位簽署人已簽核，此申請單無法取消或刪除';

/** 可指派給成員的功能權限（系統管理員 role=admin 預設擁有全部） */

function findStepByOrder(steps, order) {
  const o = Number(order);
  if (!Array.isArray(steps) || !Number.isFinite(o)) return null;
  return steps.find((s) => Number(s.order) === o) || null;
}

/** 取得某步驟尚未核准的簽核人 id（會簽 mode=all 用） */

function getPendingApproverIds(requestId, step) {
  if (!step) return [];
  const ids = (step.approverIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  if (step.mode !== 'all') return ids;
  return ids.filter((aid) => {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, step.order, aid);
    return !row;
  });
}

/** 依單據目前步驟通知簽核人 */

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime', 'select', 'checkbox', 'user'];

/** 申請單列表共用的 SELECT／JOIN（後面接 WHERE／ORDER BY） */

const REQUEST_LIST_SELECT = `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
              u.name AS requester_name
       FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id`;

const REQUEST_NOT_DELETED = `(IFNULL(r.deleted_at,'') = '')`;

const CREDIT_LIMIT_COND = `(IFNULL(w.name, '') LIKE '%信用額度%' OR r.title LIKE '%信用額度%')`;
/** 信用額度單的兩段建檔確認步驟名稱 */

const STEP_FINANCE_CONFIRM = '財務部額度建檔確認';

const STEP_APPLICANT_ACK = '申請人建檔確認';

/** 出勤可選時間範圍（請假起迄與前端一致） */

const WORK_TIME_START_MIN = 9 * 60; // 09:00

const WORK_TIME_END_MIN = 17 * 60 + 30; // 17:30
/** 延長工時／實際工時可選：17:30～24:00（每 30 分鐘） */

const OT_TIME_START_MIN = 17 * 60 + 30; // 17:30

const OT_TIME_END_MIN = 24 * 60; // 24:00

/**
 * 正規化並驗證「日期+時間」且分鐘僅能 00 或 30
 * @param {string} val
 * @param {{ workHoursOnly?: boolean, overtimeHoursOnly?: boolean }} opts
 *   workHoursOnly：09:00～17:30（請假）
 *   overtimeHoursOnly：17:30～24:00（延長工時；允許 24:00）
 */

function normalizeDateTime30(val, opts = {}) {
  if (val == null || val === '') return { ok: true, value: '' };
  let s = String(val).trim().replace(' ', 'T');
  // 接受 YYYY-MM-DDTHH:mm 或 YYYY-MM-DDTHH:mm:ss（含 24:00）
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return { ok: false, error: '格式須為 日期 + 時間（例如 2026-07-20 17:30）' };
  const date = m[1];
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    return { ok: false, error: '時間格式無效' };
  }
  // 允許 24:00（僅整點，表示當日結束）
  if (hh === 24) {
    if (mm !== 0) return { ok: false, error: '24:00 僅能為整點' };
  } else if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return { ok: false, error: '小時須為 00–23（或 24:00）' };
  }
  // 四捨五入到最近 30 分鐘（24:00 不需再對齊）
  if (!(hh === 24 && mm === 0) && mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
      if (hh > 24 || (hh === 24 && mm !== 0)) {
        return { ok: false, error: '時間不可超過 24:00' };
      }
    }
  }
  let mins = hh * 60 + mm;
  if (opts.workHoursOnly) {
    if (mins < WORK_TIME_START_MIN || mins > WORK_TIME_END_MIN) {
      return {
        ok: false,
        error: '時間須在 09:00～17:30 之間（每 30 分鐘）',
      };
    }
  }
  if (opts.overtimeHoursOnly) {
    if (mins < OT_TIME_START_MIN || mins > OT_TIME_END_MIN) {
      return {
        ok: false,
        error: '時間須在 17:30～24:00 之間（每 30 分鐘）',
      };
    }
  }
  const value = `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return { ok: true, value };
}
/** 簽核步驟指派類型 */

const ASSIGN_TYPES = [
  'users',
  'form_user',
  'dept_head',
  'department',
  'users_pick',
  'cosign_pick', // 申請人自選會簽（可多位勾選、非必填，可略過）
];

/** 解析會簽欄位：'skip' | userId | '1,2,3' | [1,2,3] → number[] 或 null（略過） */

function parseCosignIds(val) {
  if (val === undefined || val === null || val === '' || val === 'skip' || val === '0') {
    return null;
  }
  if (Array.isArray(val)) {
    const ids = val.map(Number).filter((n) => n > 0 && Number.isFinite(n));
    return ids.length ? [...new Set(ids)] : null;
  }
  if (typeof val === 'number') {
    return val > 0 ? [val] : null;
  }
  const s = String(val).trim();
  if (!s || s === 'skip') return null;
  const ids = s
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0 && Number.isFinite(n));
  return ids.length ? [...new Set(ids)] : null;
}

/**
 * 解析使用者更新時的到職日：未帶欄位沿用原值、空值清除、格式錯誤回報
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */

function resolveNextHireDate(hireDate, current) {
  if (hireDate === undefined) return { ok: true, value: current || null };
  if (hireDate === null || hireDate === '') return { ok: true, value: null };
  const hd = labor.toDateOnly(hireDate);
  if (!hd) return { ok: false, error: '到職日格式須為 YYYY-MM-DD' };
  return { ok: true, value: hd };
}

/** 使用者 id 陣列 → 「姓名（部門）」顯示字串；查無此人顯示 #id */

function formatUserLabels(ids) {
  return ids
    .map((uid) => {
      const u = db.prepare(`SELECT name, department FROM users WHERE id = ?`).get(uid);
      if (!u) return `#${uid}`;
      return u.department ? `${u.name}（${u.department}）` : u.name;
    })
    .join('、');
}
/** 單位別名 → 實際部門名稱（人事由管理部代理） */

const UNIT_ALIASES = {
  人事: '管理部',
  人事單位: '管理部',
  人資: '管理部',
  財務: '財務部',
  財務單位: '財務部',
  採購: '採購部',
  採購單位: '採購部',
  倉管: '倉管部',
  倉管單位: '倉管部',
  工程: '工程部',
  業務: '業務部',
  管理: '管理部',
  管理單位: '管理部',
};


function parseSteps(json) {
  try {
    const steps = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(steps) || !steps.length) throw new Error('empty');
    return steps.map((s, i) => {
      const assignType = ASSIGN_TYPES.includes(s.assignType) ? s.assignType : 'users';
      // 簽核人在此步驟可填寫的欄位（如人事：剩餘特休）
      let approverFields = [];
      try {
        approverFields = parseFormFields(s.approverFields || s.approver_fields || []);
      } catch {
        approverFields = [];
      }
      return {
        order: i + 1,
        name: String(s.name || `步驟 ${i + 1}`).trim(),
        assignType,
        formFieldId: s.formFieldId ? String(s.formFieldId).trim().slice(0, 40) : 'agent',
        department: s.department ? String(s.department).trim() : '',
        approverIds: Array.isArray(s.approverIds)
          ? s.approverIds.map(Number).filter(Boolean)
          : [],
        mode: s.mode === 'all' ? 'all' : 'any',
        approverFields,
        // 關卡條件式動態分支。舊版此處未保留 condition，編輯器設定完存檔即被
        // 靜默丟棄，導致條件式分支永遠無法生效（正式環境 0 個流程啟用）。
        condition: parseStepCondition(s.condition),
        // v2 圖模型的節點 id；v1 流程為 undefined
        nodeId: s.nodeId ? String(s.nodeId).trim().slice(0, 60) : undefined,
      };
    });
  } catch {
    return null;
  }
}


const COND_OPERATORS = ['>=', '>', '<=', '<', '==', '!=', 'contains'];

/** 正規化關卡條件；無效或未啟用一律回傳 { enabled: false } */
function parseStepCondition(c) {
  if (!c || typeof c !== 'object' || !c.enabled) return { enabled: false };
  const fieldId = String(c.fieldId || '').trim().slice(0, 40);
  const operator = COND_OPERATORS.includes(c.operator) ? c.operator : '';
  if (!fieldId || !operator) return { enabled: false };
  return {
    enabled: true,
    fieldId,
    operator,
    value: c.value != null ? String(c.value).trim().slice(0, 100) : '',
    action: c.action === 'skip' ? 'skip' : 'require',
  };
}

const TW_LEAVE_TYPES = [
  '特別休假（特休）',
  '事假',
  '普通傷病假（病假）',
  '住院傷病假',
  '公傷病假',
  '婚假',
  '喪假',
  '祭儀假',
  '產假',
  '產檢假',
  '安胎休養',
  '陪產檢及陪產假',
  '生理假',
  '家庭照顧假',
  '公假',
  '補休',
  '曠職',
  '其他',
];

/** 假別下拉的後備選項（表單未自訂 options 時使用；不含「曠職」） */

const LEAVE_TYPE_FALLBACK_OPTIONS = [
  '特別休假（特休）',
  '事假',
  '普通傷病假（病假）',
  '住院傷病假',
  '公傷病假',
  '婚假',
  '喪假',
  '產假',
  '產檢假',
  '安胎休養',
  '陪產檢及陪產假',
  '生理假',
  '家庭照顧假',
  '公假',
  '補休',
  '祭儀假',
  '其他',
];

/** 由表單欄位取假別選項；表單沒定義就用後備清單 */

function resolveLeaveTypeOptions(formFields) {
  const lf = (formFields || []).find(
    (f) => f.id === 'leave_type' || /假別/.test(String(f.label || ''))
  );
  if (Array.isArray(lf?.options) && lf.options.length) {
    return lf.options.map((o) => String(o).trim()).filter(Boolean);
  }
  return [...LEAVE_TYPE_FALLBACK_OPTIONS];
}


function validateStepTemplate(step) {
  if (!step.name) return '步驟名稱不可空白';
  if (
    (step.assignType === 'users' || step.assignType === 'users_pick') &&
    !step.approverIds.length
  ) {
    return `步驟「${step.name}」尚未指定可選簽核人`;
  }
  if (step.assignType === 'form_user' && !step.formFieldId) {
    return `步驟「${step.name}」請指定表單人員欄位（如代理人）`;
  }
  if (step.assignType === 'department' && !step.department) {
    return `步驟「${step.name}」請指定簽核單位／部門`;
  }
  return null;
}

/** Custom form field definitions attached to a workflow */

function parseFormFields(json) {
  try {
    const fields = typeof json === 'string' ? JSON.parse(json || '[]') : json;
    if (!Array.isArray(fields)) return [];
    return fields
      .map((f, i) => {
        const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
        const id =
          String(f.id || `f_${i + 1}`)
            .trim()
            .replace(/[^\w\-]/g, '_')
            .slice(0, 40) || `f_${i + 1}`;
        const label = String(f.label || `欄位 ${i + 1}`).trim().slice(0, 80);
        const field = {
          id,
          label,
          type,
          required: !!f.required,
          placeholder: f.placeholder ? String(f.placeholder).slice(0, 120) : '',
        };
        if (type === 'select') {
          const opts = Array.isArray(f.options)
            ? f.options.map((o) => String(o).trim()).filter(Boolean)
            : String(f.optionsText || '')
                .split(/[\n,]/)
                .map((o) => o.trim())
                .filter(Boolean);
          field.options = opts.slice(0, 50);
        }
        return field;
      })
      .filter((f) => f.label);
  } catch {
    return [];
  }
}

/**
 * 合併說明欄「自繪表格」：鍵名 fieldId__table（validateFormData 會丢掉未知鍵）
 * 格式：{ rows, cols, header, cells: string[][] }
 */

function mergeFormTables(baseData, rawFormData) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  for (const [key, val] of Object.entries(raw)) {
    if (!/__table$/.test(key)) continue;
    let obj = val;
    if (typeof val === 'string') {
      try {
        obj = JSON.parse(val || 'null');
      } catch {
        continue;
      }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.cells)) continue;
    const cells = obj.cells
      .map((row) =>
        (Array.isArray(row) ? row : []).map((c) => String(c ?? '').slice(0, 500))
      )
      .slice(0, 20)
      .map((row) => row.slice(0, 10));
    if (!cells.length) continue;
    const cols = Math.max(1, ...cells.map((r) => r.length));
    const normalized = cells.map((r) => {
      const next = r.slice(0, cols);
      while (next.length < cols) next.push('');
      return next;
    });
    const hasContent = normalized.some((r) => r.some((c) => String(c).trim()));
    if (!hasContent) continue;
    merged[key] = {
      rows: normalized.length,
      cols,
      header: obj.header !== false,
      cells: normalized,
    };
  }
  return merged;
}


function validateFormData(fields, raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const cleaned = {};
  for (const f of fields) {
    let val = data[f.id];
    if (f.type === 'checkbox') {
      val = val === true || val === 'true' || val === 1 || val === '1' || val === 'on';
      cleaned[f.id] = val;
      if (f.required && !val) {
        return { error: `請勾選「${f.label}」` };
      }
      continue;
    }
    if (val == null) val = '';
    val = String(val).trim();
    if (f.required && !val) {
      return { error: `請填寫「${f.label}」` };
    }
    if (f.type === 'number' && val !== '') {
      if (Number.isNaN(Number(val))) {
        return { error: `「${f.label}」須為數字` };
      }
      // 天數／小時：請假表單依假別最小單位（見下方 leave_type 合併驗證）；
      // 其餘（剩餘特休、延長工時等）仍為 0.5
      const isLeaveDaysHours = f.id === 'days' || f.id === 'hours';
      const isHalfUnit =
        f.id === 'remaining_special_leave_days' ||
        f.id === 'remaining_special_leave_hours' ||
        f.id === 'actual_hours' ||
        f.id === 'comp_leave_balance' ||
        (/小時|天數|時數/.test(String(f.label || '')) && !isLeaveDaysHours);
      if (isLeaveDaysHours) {
        const n = Number(val);
        if (n < 0) return { error: `「${f.label}」不可為負數` };
        // 先暫存原始數字，假別齊全後再 normalizeLeaveDaysHours
        cleaned[f.id] = n;
        continue;
      }
      if (isHalfUnit) {
        const n = Number(val);
        if (n < 0) return { error: `「${f.label}」不可為負數` };
        const snapped = Math.round(n * 2) / 2;
        if (Math.abs(n - snapped) > 1e-9) {
          return { error: `「${f.label}」最小單位為 0.5（例如 0、0.5、1、3.5、7.5）` };
        }
        cleaned[f.id] = snapped;
        continue;
      }
    }
    if (f.type === 'datetime' && val !== '') {
      // 請假：09:00～17:30；延長工時／實際工時：17:30～24:00
      const workHoursOnly =
        f.id === 'start_date' ||
        f.id === 'end_date' ||
        (/請假/.test(String(f.label || '')) &&
          /起始|開始|結束|迄/.test(String(f.label || '')));
      const overtimeHoursOnly =
        f.id === 'ot_start' ||
        f.id === 'ot_end' ||
        f.id === 'actual_start' ||
        f.id === 'actual_end' ||
        /延長工時|實際工時/.test(String(f.label || ''));
      const n = normalizeDateTime30(val, {
        workHoursOnly: workHoursOnly && !overtimeHoursOnly,
        overtimeHoursOnly,
      });
      if (!n.ok) return { error: `「${f.label}」${n.error}` };
      cleaned[f.id] = n.value;
      continue;
    }
    if (f.type === 'select' && val) {
      const opts = Array.isArray(f.options)
        ? f.options.map((o) => String(o).trim())
        : [];
      // 無 options 定義時不擋；有 options 時比對 trim 後字串
      if (opts.length && !opts.includes(val) && !opts.includes(String(val).trim())) {
        // 人事假別：允許申請表單已選假別／合理文字，避免快照 options 過舊擋核准
        const isHrLeave =
          f.id === 'hr_leave_type' || /假別/.test(String(f.label || ''));
        if (!isHrLeave) {
          return { error: `「${f.label}」選項無效` };
        }
      }
    }
    if (f.type === 'user' && val) {
      const uid = Number(val);
      if (!uid || Number.isNaN(uid)) {
        return { error: `「${f.label}」請選擇有效人員` };
      }
      const u = db
        .prepare(`SELECT id FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) return { error: `「${f.label}」所選人員不存在或已停用` };
      cleaned[f.id] = uid;
      continue;
    }
    cleaned[f.id] = val;
  }

  // 請假：依假別最小計算單位正規化／驗證天數與小時
  const hasLeaveFields = fields.some(
    (f) => f.id === 'days' || f.id === 'hours' || f.id === 'leave_type'
  );
  if (hasLeaveFields && (cleaned.days != null || cleaned.hours != null)) {
    const leaveType =
      cleaned.leave_type ||
      cleaned.假別 ||
      data.leave_type ||
      data.假別 ||
      '';
    const norm = labor.normalizeLeaveDaysHours(
      leaveType,
      cleaned.days != null ? cleaned.days : data.days,
      cleaned.hours != null ? cleaned.hours : data.hours
    );
    if (!norm.ok) {
      return { error: norm.error || '請假天數／小時不符合最小單位' };
    }
    // 有填起迄或假別時才強制寫回（避免無關表單）
    if (leaveType || cleaned.start_date || cleaned.end_date) {
      cleaned.days = norm.days;
      cleaned.hours = norm.hours;
    }
  }

  return { data: cleaned };
}

/**
 * 合併「部門主管」自選欄位（不在 workflow formFields 內，validateFormData 會丢掉）
 * 欄位鍵：dept_head_{步驟序}
 */

function mergeDeptHeadFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const orders = new Set(
    (templateSteps || [])
      .filter((s) => s.assignType === 'dept_head')
      .map((s) => Number(s.order))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  // 接受所有 dept_head_N，或流程中宣告的步驟
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^dept_head_\d+$/.test(k)),
    ...[...orders].map((o) => `dept_head_${o}`),
  ]);
  for (const key of keys) {
    if (!(key in raw) && !(key in merged)) continue;
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    if (val === undefined || val === null || val === '' || val === 'skip') {
      merged[key] = 'skip';
      continue;
    }
    const uid = Number(val);
    if (!uid || Number.isNaN(uid)) {
      merged[key] = 'skip';
      continue;
    }
    const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
    if (!u) {
      return { error: `部門主管所選人員無效（${key}）` };
    }
    merged[key] = uid;
  }
  return { data: merged };
}

/**
 * 合併「申請人自選簽核人」欄位（如副總經理）
 * 欄位鍵：users_pick_{步驟序}
 * 值：'all' | 單一 userId | '1,2,3'（勾選多位）
 */

function mergeUsersPickFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const pickSteps = (templateSteps || []).filter(
    (s) => s.assignType === 'users_pick'
  );
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^users_pick_\d+$/.test(k)),
    ...pickSteps.map((s) => `users_pick_${s.order}`),
  ]);
  for (const key of keys) {
    const m = key.match(/^users_pick_(\d+)$/);
    if (!m) continue;
    const order = Number(m[1]);
    const step =
      pickSteps.find((s) => Number(s.order) === order) ||
      (templateSteps || []).find(
        (s) => s.assignType === 'users_pick' && Number(s.order) === order
      );
    const pool = new Set(
      (step?.approverIds || []).map(Number).filter(Boolean)
    );
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    if (val === undefined || val === null || val === '') {
      return {
        error: `請勾選「${step?.name || '簽核人'}」（至少一位）`,
      };
    }
    if (String(val) === 'all') {
      if (!pool.size) {
        return { error: `步驟「${step?.name || key}」尚未設定可選簽核人` };
      }
      merged[key] = 'all';
      continue;
    }
    // 支援多選：陣列、逗號分隔、或單一 id
    let ids = [];
    if (Array.isArray(val)) {
      ids = val.map(Number).filter((n) => n > 0 && Number.isFinite(n));
    } else if (typeof val === 'number') {
      ids = val > 0 ? [val] : [];
    } else {
      ids = String(val)
        .split(/[,，\s]+/)
        .map(Number)
        .filter((n) => n > 0 && Number.isFinite(n));
    }
    ids = [...new Set(ids)];
    if (!ids.length) {
      return { error: `請勾選「${step?.name || '簽核人'}」（至少一位）` };
    }
    for (const uid of ids) {
      if (pool.size && !pool.has(uid)) {
        return { error: `「${step?.name || '簽核人'}」所選人員不在可選名單內` };
      }
      const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) {
        return { error: `「${step?.name || '簽核人'}」所選人員無效（#${uid}）` };
      }
    }
    merged[key] = ids.length === 1 ? ids[0] : ids.join(',');
  }
  // 每個 users_pick 步驟都必須有值
  for (const s of pickSteps) {
    const key = `users_pick_${s.order}`;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      return { error: `請勾選「${s.name || '簽核人'}」（至少一位）` };
    }
  }
  return { data: merged };
}

/**
 * 合併「會簽人員」自選欄位（非必填，可多位）
 * 欄位鍵：cosign_{步驟序} 值：'skip' | 單一 id | '1,2,3'
 */

function mergeCosignFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const cosignSteps = (templateSteps || []).filter(
    (s) => s.assignType === 'cosign_pick'
  );
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^cosign_\d+$/.test(k)),
    ...cosignSteps.map((s) => `cosign_${s.order}`),
  ]);
  for (const key of keys) {
    if (!(key in raw) && !(key in merged)) {
      if (cosignSteps.some((s) => `cosign_${s.order}` === key)) {
        merged[key] = 'skip';
      }
      continue;
    }
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    const ids = parseCosignIds(val);
    if (!ids || !ids.length) {
      merged[key] = 'skip';
      continue;
    }
    for (const uid of ids) {
      const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) {
        return { error: `會簽所選人員無效（#${uid}）` };
      }
    }
    merged[key] = ids.join(',');
  }
  for (const s of cosignSteps) {
    const key = `cosign_${s.order}`;
    if (merged[key] === undefined) merged[key] = 'skip';
  }
  return { data: merged };
}

/**
 * 部門 active 成員（含 user_departments 多部門隸屬）
 * @param {string} dept 已正規化的部門名稱
 * @param {boolean} adminLast true 時把 admin 排到最後（挑部門主管用）
 */

function queryDepartmentUsers(dept, adminLast = false) {
  const order = adminLast
    ? `CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END, u.id ASC`
    : `u.id ASC`;
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.department, u.role FROM users u
       WHERE u.active = 1 AND (
         u.department = ?
         OR EXISTS (
           SELECT 1 FROM user_departments ud
           WHERE ud.user_id = u.id AND ud.department = ?
         )
       )
       ORDER BY ${order}`
    )
    .all(dept, dept);
}

/** 部門主管：同部門 active 使用者（含多部門隸屬），優先非 admin，再依 id */

function getDeptHead(department) {
  const dept = String(department || '').trim();
  if (!dept) return null;
  return queryDepartmentUsers(dept, true)[0] || null;
}


function resolveUnitName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return UNIT_ALIASES[raw] || raw;
}


function getUsersInDepartment(department) {
  const dept = resolveUnitName(department);
  if (!dept) return [];
  return queryDepartmentUsers(dept);
}

/**
 * 依申請人、表單資料，將流程模板步驟解析成實際簽核人
 * 申請人送出本身視為第 0 層（不在 steps 內）
 */

function resolveStepsForRequest(requester, formData, templateSteps) {
  const resolved = [];
  for (const s of templateSteps) {
    let approverIds = [];
    let resolveNote = '';

    if (s.assignType === 'users') {
      approverIds = [...s.approverIds];
      resolveNote = '指定人員';
    } else if (s.assignType === 'users_pick') {
      // 申請人自選：勾選一位或多位，或選全部（候選名單＝步驟 approverIds）
      const pool = (s.approverIds || []).map(Number).filter(Boolean);
      if (!pool.length) {
        return { error: `步驟「${s.name}」尚未設定可選簽核人` };
      }
      const fieldId = `users_pick_${s.order}`;
      const raw = formData?.[fieldId];
      if (raw === undefined || raw === null || raw === '') {
        return { error: `請勾選「${s.name}」（至少一位）` };
      }
      if (String(raw) === 'all') {
        approverIds = [...pool];
        const names = pool
          .map((id) => db.prepare(`SELECT name FROM users WHERE id = ?`).get(id)?.name || `#${id}`)
          .join('、');
        resolveNote = `申請人勾選全部：${names}`;
      } else {
        let ids = [];
        if (Array.isArray(raw)) {
          ids = raw.map(Number).filter((n) => n > 0 && Number.isFinite(n));
        } else {
          ids = String(raw)
            .split(/[,，\s]+/)
            .map(Number)
            .filter((n) => n > 0 && Number.isFinite(n));
        }
        ids = [...new Set(ids)];
        if (!ids.length) {
          return { error: `請勾選「${s.name}」（至少一位）` };
        }
        const names = [];
        for (const uid of ids) {
          if (!pool.includes(uid)) {
            return { error: `步驟「${s.name}」所選人員不在可選名單內` };
          }
          if (uid === requester.id) {
            return { error: `步驟「${s.name}」不可選擇申請人本人` };
          }
          const u = db
            .prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`)
            .get(uid);
          if (!u) return { error: `步驟「${s.name}」所選人員無效` };
          names.push(u.name);
        }
        approverIds = ids;
        resolveNote =
          ids.length === 1
            ? `申請人勾選：${names[0]}`
            : `申請人勾選 ${ids.length} 位：${names.join('、')}`;
      }
    } else if (s.assignType === 'form_user') {
      const uid = Number(formData?.[s.formFieldId]);
      if (!uid) {
        return { error: `請在表單選擇「${s.name}」對應人員（欄位：${s.formFieldId}）` };
      }
      const u = db.prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) return { error: `步驟「${s.name}」所選人員無效` };
      if (u.id === requester.id) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote = `表單指定：${u.name}`;
    } else if (s.assignType === 'dept_head') {
      // 申請人自行選擇部門成員，或選擇略過此步驟
      // 表單欄位鍵：dept_head_{步驟序}（與前端申請單一致）
      const fieldId = `dept_head_${s.order}`;
      const raw = formData?.[fieldId];
      const skip =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0' ||
        Number(raw) === 0 ||
        Number.isNaN(Number(raw));
      if (skip) {
        // 申請人選擇不需要經過部門主管
        continue;
      }
      const uid = Number(raw);
      const u = db
        .prepare(`SELECT id, name, department FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) {
        return { error: `步驟「${s.name}」所選人員無效` };
      }
      if (u.id === requester.id) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote = `申請人指定：${u.name}${u.department ? `（${u.department}）` : ''}`;
    } else if (s.assignType === 'cosign_pick') {
      // 申請人自選會簽（可多位勾選、非必填）；略過則不進入此步驟
      const fieldId = `cosign_${s.order}`;
      const raw = formData?.[fieldId];
      const ids = parseCosignIds(raw);
      if (!ids || !ids.length) {
        continue;
      }
      const names = [];
      approverIds = [];
      for (const uid of ids) {
        if (uid === requester.id) {
          return { error: `步驟「${s.name}」不可選擇申請人本人` };
        }
        const u = db
          .prepare(`SELECT id, name, department FROM users WHERE id = ? AND active = 1`)
          .get(uid);
        if (!u) {
          return { error: `步驟「${s.name}」所選會簽人員無效（#${uid}）` };
        }
        approverIds.push(u.id);
        names.push(u.department ? `${u.name}（${u.department}）` : u.name);
      }
      // 多位會簽：強制全部核准（mode=all）
      resolveNote = `會簽：${names.join('、')}`;
      resolved.push({
        order: s.order,
        name: s.name,
        assignType: s.assignType,
        formFieldId: s.formFieldId,
        department: s.department,
        mode: approverIds.length > 1 ? 'all' : s.mode === 'all' ? 'all' : 'any',
        approverIds,
        resolveNote,
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
        // 條件式分支必須帶進 snapshot：執行引擎讀的是 snapshot 而非流程定義
        condition: s.condition && s.condition.enabled ? s.condition : { enabled: false },
        nodeId: s.nodeId,
      });
      continue;
    } else if (s.assignType === 'department') {
      let members = getUsersInDepartment(s.department).filter((m) => m.id !== requester.id);
      // 若單位僅申請人自己，仍保留該單位其他人；若無人則允許含本人以外的 fallback 管理部
      if (!members.length) {
        members = getUsersInDepartment('管理部').filter((m) => m.id !== requester.id);
      }
      if (!members.length) {
        return {
          error: `步驟「${s.name}」對應單位「${resolveUnitName(s.department) || s.department}」尚無可用簽核人`,
        };
      }
      approverIds = members.map((m) => m.id);
      resolveNote = `單位：${resolveUnitName(s.department)}（${members.map((m) => m.name).join('、')}）`;
    }

    if (!approverIds.length) {
      // 非必填步驟或無人可簽：略過
      continue;
    }

    resolved.push({
      order: s.order,
      name: s.name,
      assignType: s.assignType,
      formFieldId: s.formFieldId,
      department: s.department,
      mode: s.mode,
      approverIds,
      resolveNote,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      // 條件式分支必須帶進 snapshot：執行引擎讀的是 snapshot 而非流程定義
      condition: s.condition && s.condition.enabled ? s.condition : { enabled: false },
      nodeId: s.nodeId,
    });
  }

  if (!resolved.length) {
    return { error: '無法建立簽核步驟（可能缺少可用的簽核人）' };
  }
  // 重新編號，避免略過非必填步驟後 order 不連續
  const renumbered = resolved.map((s, i) => ({ ...s, order: i + 1 }));
  return { steps: renumbered };
}


function loadStepsForRequest(row) {
  if (row.steps_snapshot_json) {
    try {
      const snap = JSON.parse(row.steps_snapshot_json);
      if (Array.isArray(snap) && snap.length) return snap;
    } catch {
      /* fall through */
    }
  }
  return parseSteps(row.steps_json) || [];
}

/** 解析 userIds + users(username) → 有效帳號列表 */

function resolveUserIdList(userIds, usersMeta) {
  const ids = new Set();
  const users = [];
  for (const id of userIds || []) {
    const u = db
      .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
      .get(Number(id));
    if (u && !ids.has(u.id)) {
      ids.add(u.id);
      users.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  for (const u of usersMeta || []) {
    if (!u) continue;
    if (u.id && ids.has(Number(u.id))) continue;
    let row = null;
    if (u.username) {
      row = db
        .prepare(`SELECT id, username, name FROM users WHERE username = ? AND active = 1`)
        .get(String(u.username).trim());
    } else if (u.id) {
      row = db
        .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
        .get(Number(u.id));
    }
    if (row && !ids.has(row.id)) {
      ids.add(row.id);
      users.push({ id: row.id, username: row.username, name: row.name });
    }
  }
  return { ids: [...ids], users };
}

/** 將前端／匯入的 finalNotify 正規化並寫入 DB JSON（僅保留有效使用者） */

function serializeWorkflow(r) {
  const pdfLayout = workflowModule.parsePdfLayoutJson(r.pdf_layout_json, r.name);
  const finalNotify = enrichFinalNotifyUsers(
    workflowModule.parseFinalNotifyJson(r.final_notify_json)
  );
  // v2 圖模型：flow_json 為真相來源；steps 仍供既有 UI／PDF 使用
  const flowVersion = Number(r.flow_version) === 2 ? 2 : 1;
  const flow =
    flowVersion === 2 ? flowGraph.normalizeGraph(r.flow_json) : null;
  return {
    ...r,
    steps: parseSteps(r.steps_json) || [],
    formFields: parseFormFields(r.form_fields_json),
    pdfLayout,
    finalNotify,
    flowVersion,
    flow,
    steps_json: undefined,
    form_fields_json: undefined,
    pdf_layout_json: undefined,
    final_notify_json: undefined,
    flow_json: undefined,
  };
}

/** 依 flow_version 取出可執行的流程圖（v1 自動轉成直線圖） */

function getWorkflowGraph(row) {
  if (Number(row.flow_version) === 2) {
    const g = flowGraph.normalizeGraph(row.flow_json);
    if (g) return g;
  }
  return flowGraph.linearToGraph(parseSteps(row.steps_json) || []);
}

/**
 * 把「已解析出實際簽核人」的結果寫回流程圖節點。
 * 動態指派（部門主管、表單人員、申請人自選…）在送單當下才知道是誰，
 * 沿用既有 resolveStepsForRequest 的解析結果，再依 nodeId 對回節點。
 */

function buildResolvedGraph(wfRow, resolvedSteps) {
  const graph = getWorkflowGraph(wfRow);
  const byNodeId = new Map();
  for (const s of resolvedSteps || []) {
    if (s.nodeId) byNodeId.set(s.nodeId, s);
  }
  // v1 轉出的圖節點 id 為 n<order>，解析結果沒有 nodeId 時用 order 對應
  const byOrder = new Map((resolvedSteps || []).map((s) => [Number(s.order), s]));

  const nodes = graph.nodes.map((n) => {
    if (n.type !== 'approval') return n;
    const r =
      byNodeId.get(n.id) ||
      (n.legacyOrder != null ? byOrder.get(Number(n.legacyOrder)) : null);
    if (!r) return n;
    return {
      ...n,
      approverIds: Array.isArray(r.approverIds) ? r.approverIds : n.approverIds,
      mode: r.mode || n.mode,
      resolveNote: r.resolveNote || '',
      approverFields: r.approverFields || n.approverFields,
    };
  });
  return flowGraph.normalizeGraph({ version: 2, nodes, edges: graph.edges });
}

/**
 * 取單據當下應使用的流程圖：送單時凍結的快照。
 * getRequestDetail 已把 flow_snapshot_json 正規化成 detail.flow，
 * 並將原始欄位設為 undefined，故這裡讀 detail.flow。
 */

function getRequestGraph(detail) {
  if (detail?.flow) {
    const g = flowGraph.normalizeGraph(detail.flow);
    if (g) return g;
  }
  if (detail?.flow_snapshot_json) {
    return flowGraph.normalizeGraph(detail.flow_snapshot_json);
  }
  return null;
}

/** 此單據是否走 v2 圖引擎 */

function isGraphRequest(detail) {
  return !!getRequestGraph(detail);
}

/**
 * 找出這位使用者目前實際可簽的關卡。
 * v1：就是 current_step 指到的那一關。
 * v2：可能有多個並行待簽節點，取這位使用者有權簽的那個；
 *     都沒有權限時退回 current_step，讓後續權限檢查給出正確錯誤訊息。
 */

function resolveActionableStep(detail, steps, userId, requestId) {
  const fallback = findStepByOrder(steps, detail.current_step);
  const graph = getRequestGraph(detail);
  if (!graph) return fallback;

  const pending = flowEngine.pendingNodes(requestId);
  if (!pending.length) return fallback;

  const idx = flowEngine.indexGraph(graph);
  const candidates = pending
    .map((nid) => {
      const node = idx.byId.get(nid);
      if (!node || node.type !== 'approval') return null;
      // 轉成 v1 step 形狀，讓既有的權限檢查／簽核流程完全沿用
      const legacy = steps.find((s) => s.nodeId === nid);
      return {
        order: legacy?.order ?? node.legacyOrder ?? 0,
        name: node.name,
        assignType: node.assignType,
        formFieldId: node.formFieldId,
        department: node.department,
        approverIds: node.approverIds || [],
        mode: node.mode,
        approverFields: node.approverFields || [],
        nodeId: nid,
      };
    })
    .filter(Boolean);

  for (const c of candidates) {
    if (checkUserApprovalRight(userId, c, requestId).canApprove) return c;
  }
  return candidates[0] || fallback;
}


const flowEngine = flowEngineFactory.makeEngine(db);


function getActiveDelegationForUser(grantorUserId) {
  const row = db
    .prepare(
      `SELECT d.*, u.name AS delegate_name, u.username AS delegate_username
       FROM user_delegations d
       JOIN users u ON u.id = d.delegate_user_id
       WHERE d.user_id = ? AND d.active = 1
       ORDER BY d.id DESC LIMIT 1`
    )
    .get(Number(grantorUserId));
  if (!row) return null;
  const now = tz.nowMinute();
  if (row.start_time && row.start_time > now) return null;
  if (row.end_time && row.end_time < now) return null;
  return row;
}

/** 取得某代理人 (delegateUserId) 目前代理授權發起人 ID 清單 */

function getGrantorUserIdsForDelegate(delegateUserId) {
  const rows = db
    .prepare(
      `SELECT d.user_id, d.start_time, d.end_time, u.name AS grantor_name, u.username AS grantor_username
       FROM user_delegations d
       JOIN users u ON u.id = d.user_id
       WHERE d.delegate_user_id = ? AND d.active = 1 AND u.active = 1`
    )
    .all(Number(delegateUserId));
  const now = tz.nowMinute();
  const activeList = [];
  for (const r of rows) {
    if (r.start_time && r.start_time > now) continue;
    if (r.end_time && r.end_time < now) continue;
    activeList.push(r);
  }
  return activeList;
}

/**
 * 判斷使用者是否可簽核某步驟（支援直接簽核與代理簽核）
 * @returns {{ canApprove: boolean, isDelegated: boolean, delegatedFor?: { id: number, name: string } }}
 */

function checkUserApprovalRight(userId, step, requestId) {
  if (!step || !Array.isArray(step.approverIds)) return { canApprove: false, isDelegated: false };
  const ids = step.approverIds.map(Number);
  const uid = Number(userId);

  // 1. 本人直接為簽核人
  if (ids.includes(uid)) {
    if (step.mode !== 'all') return { canApprove: true, isDelegated: false };
    const already = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, Number(step.order), uid);
    if (!already) return { canApprove: true, isDelegated: false };
  }

  // 2. 作為代理人代簽
  const grantors = getGrantorUserIdsForDelegate(uid);
  for (const g of grantors) {
    if (ids.includes(Number(g.user_id))) {
      if (step.mode !== 'all') {
        return {
          canApprove: true,
          isDelegated: true,
          delegatedFor: { id: g.user_id, name: g.grantor_name, username: g.grantor_username },
        };
      }
      const alreadyG = db
        .prepare(
          `SELECT id FROM approval_actions
           WHERE request_id = ? AND step_order = ? AND (actor_id = ? OR actor_id = ? OR delegated_for_id = ?) AND action = 'approve'`
        )
        .get(requestId, Number(step.order), Number(g.user_id), uid, Number(g.user_id));
      if (!alreadyG) {
        return {
          canApprove: true,
          isDelegated: true,
          delegatedFor: { id: g.user_id, name: g.grantor_name, username: g.grantor_username },
        };
      }
    }
  }

  return { canApprove: false, isDelegated: false };
}


function canUserApproveStep(userId, step, requestId) {
  return checkUserApprovalRight(userId, step, requestId).canApprove;
}


function isStepComplete(requestId, step) {
  if (!step) return false;
  const stepOrder = Number(step.order);
  if (step.mode !== 'all') {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND action = 'approve' LIMIT 1`
      )
      .get(requestId, stepOrder);
    return !!row;
  }
  // all：全部簽核人皆需核准
  for (const aid of step.approverIds || []) {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, stepOrder, Number(aid));
    if (!row) return false;
  }
  return (step.approverIds || []).length > 0;
}

/**
 * 評估關卡條件式動態分支 (Conditional Routing)
 */

function evaluateStepCondition(step, detail) {
  if (!step?.condition || !step.condition.enabled) return { required: true };
  const { fieldId, operator, value, action } = step.condition;
  if (!fieldId || !operator) return { required: true };

  const formData = detail?.form_data || {};
  let rawVal = formData[fieldId];
  if (rawVal == null || rawVal === '') {
    if (fieldId === 'days' || fieldId === 'hours' || fieldId === 'amount' || fieldId === 'total_amount') {
      rawVal = formData[fieldId] ?? formData['days'] ?? formData['hours'] ?? formData['金額'] ?? formData['總金額'] ?? 0;
    } else {
      rawVal = '';
    }
  }

  const numVal = Number(rawVal);
  const numTarget = Number(value);
  const isNumeric = !Number.isNaN(numVal) && !Number.isNaN(numTarget);

  let matched = false;
  if (isNumeric) {
    if (operator === '>') matched = numVal > numTarget;
    else if (operator === '>=') matched = numVal >= numTarget;
    else if (operator === '<') matched = numVal < numTarget;
    else if (operator === '<=') matched = numVal <= numTarget;
    else if (operator === '==') matched = numVal === numTarget;
    else if (operator === '!=') matched = numVal !== numTarget;
  } else {
    const strVal = String(rawVal ?? '').trim();
    const strTarget = String(value ?? '').trim();
    if (operator === '==') matched = strVal === strTarget;
    else if (operator === '!=') matched = strVal !== strTarget;
    else if (operator === 'contains') matched = strVal.includes(strTarget);
  }

  const fieldLabel = fieldId === 'days' ? '天數' : fieldId === 'hours' ? '小時' : fieldId === 'amount' ? '金額' : fieldId;

  if (action === 'skip') {
    // skip = 符合條件時跳過
    return {
      required: !matched,
      reason: matched
        ? `符合跳關條件 (${fieldLabel} ${operator} ${value})，動態自動跳過關卡`
        : `未達跳關條件 (${fieldLabel} ${operator} ${value})，進行簽核`,
    };
  } else {
    // require (預設) = 符合條件才需要簽核，未符合則自動跳過
    return {
      required: matched,
      reason: matched
        ? `符合簽核條件 (${fieldLabel} ${operator} ${value})，進入本關簽核`
        : `未達簽核門檻 (${fieldLabel} ${operator} ${value})，動態自動跳過關卡`,
    };
  }
}

/**
 * 推進至下一個符合條件的簽核步驟 (可連續跳過多個不符合條件的關卡)
 */

function advanceToNextEligibleStep(id, detail, steps, currentStep) {
  let idx = steps.findIndex((s) => Number(s.order) === Number(currentStep.order));
  let nextIdx = idx < 0 ? 0 : idx + 1;
  let finalNextStep = null;

  while (nextIdx < steps.length) {
    const candidate = steps[nextIdx];
    const cond = evaluateStepCondition(candidate, detail);
    if (cond.required) {
      finalNextStep = candidate;
      break;
    } else {
      // 記錄系統自動略過動作（actor_id 為 NULL：非人為操作，
      // 舊版寫 0 會違反 users 外鍵，加上 CHECK 不含 'system'，跳關必定拋例外）
      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, NULL, 'system', ?, '{}')`
      ).run(id, Number(candidate.order), candidate.name, `[動態條件跳關] ${cond.reason}`);
      nextIdx++;
    }
  }

  if (finalNextStep) {
    db.prepare(
      `UPDATE approval_requests SET current_step = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(finalNextStep.order, id);
    return {
      mailEvent: 'step',
      nextStepName: finalNextStep.name || `步驟 ${finalNextStep.order}`,
      nextStep: finalNextStep,
    };
  } else {
    db.prepare(
      `UPDATE approval_requests SET status = 'approved', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    return { mailEvent: 'approved', nextStepName: '', nextStep: null };
  }
}


module.exports = {
  isFinalApprovalStep,
  canUserAttachOnStep,
  hasApproverSigned,
  MSG_LOCKED_AFTER_SIGN,
  findStepByOrder,
  getPendingApproverIds,
  FIELD_TYPES,
  REQUEST_LIST_SELECT,
  REQUEST_NOT_DELETED,
  CREDIT_LIMIT_COND,
  STEP_FINANCE_CONFIRM,
  STEP_APPLICANT_ACK,
  WORK_TIME_START_MIN,
  WORK_TIME_END_MIN,
  OT_TIME_START_MIN,
  OT_TIME_END_MIN,
  normalizeDateTime30,
  ASSIGN_TYPES,
  parseCosignIds,
  resolveNextHireDate,
  formatUserLabels,
  UNIT_ALIASES,
  parseSteps,
  parseStepCondition,
  COND_OPERATORS,
  TW_LEAVE_TYPES,
  LEAVE_TYPE_FALLBACK_OPTIONS,
  resolveLeaveTypeOptions,
  validateStepTemplate,
  parseFormFields,
  mergeFormTables,
  validateFormData,
  mergeDeptHeadFormData,
  mergeUsersPickFormData,
  mergeCosignFormData,
  queryDepartmentUsers,
  getDeptHead,
  resolveUnitName,
  getUsersInDepartment,
  resolveStepsForRequest,
  loadStepsForRequest,
  resolveUserIdList,
  serializeWorkflow,
  getWorkflowGraph,
  buildResolvedGraph,
  getRequestGraph,
  isGraphRequest,
  resolveActionableStep,
  flowEngine,
  getActiveDelegationForUser,
  getGrantorUserIdsForDelegate,
  checkUserApprovalRight,
  canUserApproveStep,
  isStepComplete,
  evaluateStepCondition,
  advanceToNextEligibleStep,
};
