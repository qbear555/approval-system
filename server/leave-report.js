/**
 * 人事：請假資料 Excel 報表（多人精簡）
 * - 人員餘額：一人一列，僅「有上限」假別的 應有／已請／剩餘／可請（天數）
 * - 請假明細：期間已核准單據精簡欄
 */
const db = require('./db');
const labor = require('./labor');
const XLSX = require('xlsx');

const DEFAULT_LEAVE_TYPES = [
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

/** 報表用短名（欄寬精簡） */
const LEAVE_SHORT = {
  special: '特休',
  personal: '事假',
  sick: '病假',
  hospital: '住院',
  marriage: '婚假',
  funeral: '喪假',
  ritual: '祭儀',
  maternity: '產假',
  prenatal: '產檢',
  paternity: '陪產',
  menstrual: '生理',
  family: '家照',
};

function parseFormJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s || '{}') : s || {};
  } catch {
    return {};
  }
}

function statusLabel(s) {
  const map = {
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
    draft: '草稿',
  };
  return map[s] || s || '';
}

function isLeaveRequest(row, fd, ad) {
  const leaveType = ad.hr_leave_type || fd.leave_type || fd.假別 || '';
  if (leaveType) return true;
  if (/請假/.test(String(row.title || ''))) return true;
  if (fd.start_date || fd.end_date || fd.days != null) {
    if (/請假/.test(String(row.workflow_name || ''))) return true;
  }
  return false;
}

function cellDays(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return labor.snapHalf(Number(v));
}

/**
 * 查詢請假明細
 * @param {{ userIds: number[], dateFrom: string, dateTo: string, statuses?: string[] }} opts
 */
function queryLeaveDetails(opts) {
  const userIds = [...new Set((opts.userIds || []).map(Number).filter(Boolean))];
  const dateFrom = labor.toDateOnly(opts.dateFrom);
  const dateTo = labor.toDateOnly(opts.dateTo);
  if (!userIds.length) throw new Error('請至少選擇一位人員');
  if (!dateFrom || !dateTo) throw new Error('請指定日期範圍（起迄）');
  if (dateFrom > dateTo) throw new Error('起始日期不可晚於結束日期');

  const statuses = ['approved'];
  const placeholders = userIds.map(() => '?').join(',');
  const statusPh = statuses.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT r.*, w.name AS workflow_name,
              u.name AS requester_name, u.username AS requester_username,
              u.department AS requester_dept, u.hire_date
       FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id
       WHERE r.requester_id IN (${placeholders})
         AND r.status IN (${statusPh})
       ORDER BY u.name COLLATE NOCASE, r.id ASC`
    )
    .all(...userIds, ...statuses);

  const y0 = labor.toDateOnly(dateFrom);
  const y1 = labor.toDateOnly(dateTo);
  const d0 = new Date(y0 + 'T00:00:00');
  const d1 = new Date(y1 + 'T23:59:59');

  const details = [];
  for (const r of rows) {
    const fd = parseFormJson(r.form_data);
    const ad = parseFormJson(r.approver_data_json);
    if (!isLeaveRequest(r, fd, ad)) continue;

    const leaveType = String(ad.hr_leave_type || fd.leave_type || fd.假別 || '其他').trim() || '其他';
    const startStr =
      labor.toDateOnly(fd.start_date) ||
      labor.toDateOnly(String(r.created_at || '').slice(0, 10));
    const endStr = labor.toDateOnly(fd.end_date) || startStr;

    if (startStr && endStr) {
      const s = new Date(startStr + 'T00:00:00');
      const e = new Date(endStr + 'T00:00:00');
      if (e < d0 || s > d1) continue;
    } else if (startStr) {
      const s = new Date(startStr + 'T00:00:00');
      if (s < d0 || s > d1) continue;
    }

    let days = Number(fd.days);
    if (!Number.isFinite(days) || days < 0) days = 0;
    let hours = Number(fd.hours);
    if (!Number.isFinite(hours) || hours < 0) hours = 0;

    details.push({
      requestId: r.id,
      userId: r.requester_id,
      username: r.requester_username,
      name: r.requester_name,
      department: r.requester_dept || '',
      leaveType,
      start: fd.start_date || startStr || '',
      end: fd.end_date || endStr || '',
      days,
      hours,
      status: r.status,
      statusLabel: statusLabel(r.status),
      reason: fd.reason || fd.事由 || '',
      title: r.title || '',
      created_at: r.created_at || '',
      completed_at: r.completed_at || '',
      remainingAfter:
        ad.remaining_special_leave_days != null ? ad.remaining_special_leave_days : '',
    });
  }

  return { details, dateFrom, dateTo, userIds };
}

function buildUserSummaries(userIds, details) {
  const byUser = new Map();
  for (const id of userIds) {
    const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!u || !u.active) continue;
    const lab = labor.buildLaborSummary(u);
    const leaveBalances = Array.isArray(lab.leaveBalances) ? lab.leaveBalances : [];
    const balanceById = {};
    for (const b of leaveBalances) {
      if (b && b.id) balanceById[b.id] = b;
    }
    byUser.set(id, {
      userId: id,
      username: u.username,
      name: u.name,
      department: u.department || '',
      hireDate: lab.hireDate || '',
      seniority: lab.seniority?.label || '—',
      specialYearLabel: lab.specialLeave?.yearLabel || lab.leaveBalanceYearLabel || '',
      leaveBalanceYearLabel: lab.leaveBalanceYearLabel || lab.specialLeave?.yearLabel || '',
      leaveBalances,
      balanceById,
      byType: {},
      totalDays: 0,
      totalHours: 0,
    });
  }

  for (const d of details) {
    const row = byUser.get(d.userId);
    if (!row) continue;
    const t = d.leaveType || '其他';
    if (!row.byType[t]) row.byType[t] = { days: 0, hours: 0 };
    row.byType[t].days += d.days || 0;
    row.byType[t].hours += d.hours || 0;
    row.totalDays += d.days || 0;
    row.totalHours += d.hours || 0;
  }

  for (const row of byUser.values()) {
    row.totalDays = Math.round(row.totalDays * 2) / 2;
    row.totalHours = Math.round(row.totalHours * 2) / 2;
    for (const t of Object.keys(row.byType)) {
      row.byType[t].days = Math.round(row.byType[t].days * 2) / 2;
      row.byType[t].hours = Math.round(row.byType[t].hours * 2) / 2;
    }
  }

  return [...byUser.values()];
}

/**
 * 一人一列：有上限假別的 應有／已請／剩餘／可請（天數）
 * 適合多人匯出比對
 */
function buildPersonSummaryRows(summaries) {
  const track =
    typeof labor.getManualLeaveTrackRules === 'function'
      ? labor.getManualLeaveTrackRules()
      : [];

  return summaries.map((s, i) => {
    const row = {
      序號: i + 1,
      姓名: s.name,
      帳號: s.username,
      部門: s.department || '',
      到職日: s.hireDate || '',
      年資: s.seniority || '—',
      統計年度: s.leaveBalanceYearLabel || s.specialYearLabel || '',
      期間已請天數: s.totalDays || 0,
    };

    for (const rule of track) {
      const short = LEAVE_SHORT[rule.id] || rule.name || rule.id;
      const b = s.balanceById?.[rule.id];
      const hasQuota = b && b.entitled != null && Number.isFinite(Number(b.entitled));
      const used =
        b && b.used != null && Number.isFinite(Number(b.used)) ? Number(b.used) : 0;
      const entitled = hasQuota ? Number(b.entitled) : null;
      const remaining = hasQuota ? labor.snapHalf(entitled - used) : null;
      const available =
        remaining != null ? labor.snapHalf(Math.max(0, remaining)) : null;

      row[`${short}_應有`] = cellDays(entitled);
      row[`${short}_已請`] = cellDays(hasQuota || used ? used : null);
      row[`${short}_剩餘`] = cellDays(remaining);
      row[`${short}_可請`] = cellDays(available);
    }

    return row;
  });
}

function collectLeaveTypes(details, summaries) {
  const set = new Set(DEFAULT_LEAVE_TYPES);
  for (const d of details) if (d.leaveType) set.add(d.leaveType);
  for (const s of summaries) {
    for (const t of Object.keys(s.byType || {})) set.add(t);
  }
  const ordered = [];
  for (const t of DEFAULT_LEAVE_TYPES) {
    if (set.has(t)) {
      ordered.push(t);
      set.delete(t);
    }
  }
  for (const t of [...set].sort()) ordered.push(t);
  return ordered;
}

/**
 * 產生 Excel（多人精簡：一人一列）
 */
function buildLeaveReportWorkbook({ userIds, dateFrom, dateTo, statuses }) {
  const { details, dateFrom: df, dateTo: dt } = queryLeaveDetails({
    userIds,
    dateFrom,
    dateTo,
    statuses,
  });
  const summaries = buildUserSummaries(userIds, details);
  const leaveTypes = collectLeaveTypes(details, summaries);
  const multi = summaries.length > 1;

  const wb = XLSX.utils.book_new();

  // ---- 人員餘額：一人一列 ----
  const personRows = buildPersonSummaryRows(summaries);
  const wsPerson = XLSX.utils.json_to_sheet(
    personRows.length ? personRows : [{ 說明: '無人員資料' }]
  );
  // 基本欄寬
  const cols = [
    { wch: 5 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
  ];
  // 各假別 4 欄
  const trackCount =
    typeof labor.getManualLeaveTrackRules === 'function'
      ? labor.getManualLeaveTrackRules().length
      : 12;
  for (let i = 0; i < trackCount * 4; i++) cols.push({ wch: 8 });
  wsPerson['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, wsPerson, multi ? '人員餘額' : '假別餘額');

  // ---- 請假明細（期間）----
  const detailRows = details.map((d, i) => ({
    序號: i + 1,
    單號: d.requestId,
    姓名: d.name,
    帳號: d.username,
    部門: d.department,
    假別: d.leaveType,
    起始: String(d.start).replace('T', ' ').slice(0, 16),
    結束: String(d.end).replace('T', ' ').slice(0, 16),
    已請天數: d.days,
    已請小時: d.hours,
    事由: d.reason || '',
  }));
  const wsDet = XLSX.utils.json_to_sheet(
    detailRows.length ? detailRows : [{ 說明: '此日期範圍內無已核准請假單據' }]
  );
  XLSX.utils.book_append_sheet(wb, wsDet, '請假明細');

  // ---- 簡短說明（單列）----
  const note = XLSX.utils.aoa_to_sheet([
    ['請假報表', multi ? '多人彙總（一人一列）' : '單人'],
    ['產生時間', new Date().toLocaleString('zh-TW', { hour12: false })],
    ['查詢期間', `${df} ～ ${dt}`],
    ['人員數', String(summaries.length)],
    ['明細筆數', String(details.length)],
    [''],
    ['欄位', '應有＝法定應給；已請＝手動＋系統核准；剩餘＝應有−已請；可請＝max(0,剩餘)'],
    ['單位', '天（全日 7.5 小時）；僅列有上限假別（特休／事假／病假／婚假／祭儀等）'],
    ['期間已請天數', '所選日期範圍內已核准請假合計'],
    ['注意', '系統試算，實際以人資核定為準'],
  ]);
  note['!cols'] = [{ wch: 14 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, note, '說明');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return {
    buffer: Buffer.from(buf),
    meta: {
      dateFrom: df,
      dateTo: dt,
      userCount: summaries.length,
      detailCount: details.length,
      leaveTypes,
      multi,
    },
  };
}

module.exports = {
  buildLeaveReportWorkbook,
  queryLeaveDetails,
  DEFAULT_LEAVE_TYPES,
};
