const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Resolve a Chinese font that PDFKit can actually embed.
 * 優先使用無襯線（Noto Sans / 黑體），不使用標楷體（kaiu）。
 * PDFKit does NOT support TrueType Collections (.ttc) well.
 */
function resolveChineseFont() {
  const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const projectFonts = path.join(__dirname, '..', 'fonts');

  // 預設：無襯線 TTF（等線／黑體）；避免標楷體與部分 CJK OTF（PDFKit 會亂碼）
  const candidates = [
    path.join(projectFonts, 'Deng.ttf'), // 等線（推薦）
    path.join(projectFonts, 'simhei.ttf'),
    path.join(projectFonts, 'NotoSansTC-Regular.ttf'),
    path.join(projectFonts, 'SourceHanSansTC-Regular.otf'),
    path.join(winFonts, 'Deng.ttf'),
    path.join(winFonts, 'Dengb.ttf'),
    path.join(winFonts, 'simhei.ttf'),
    path.join(winFonts, 'msyh.ttf'),
    path.join(winFonts, 'msjh.ttf'),
    path.join(winFonts, 'simfang.ttf'),
    path.join(winFonts, 'simsunb.ttf'),
    // 部分 Subset OTF 在 PDFKit 會亂碼，排在後面
    path.join(projectFonts, 'NotoSansTC-Regular.otf'),
    path.join(projectFonts, 'NotoSansCJKtc-Regular.otf'),
    // 最後備援（標楷體）
    path.join(projectFonts, 'kaiu.ttf'),
    path.join(winFonts, 'kaiu.ttf'),
    path.join(winFonts, 'simkai.ttf'),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    if (/\.ttc$/i.test(p)) continue;
    if (/-VF\.ttf$/i.test(p) || /Variable/i.test(p)) continue;
    return p;
  }
  return null;
}

function canUseFont(fontPath) {
  try {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.addPage();
    doc.registerFont('__probe__', fontPath);
    doc.font('__probe__').fontSize(10).text('測試中文ABC', 50, 50);
    doc.end();
    return true;
  } catch {
    return false;
  }
}

let cachedFontPath = undefined;

function getChineseFontPath() {
  if (cachedFontPath !== undefined) return cachedFontPath;
  const preferred = resolveChineseFont();
  if (preferred && canUseFont(preferred)) {
    cachedFontPath = preferred;
    return cachedFontPath;
  }
  const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  try {
    const files = fs.readdirSync(winFonts);
    for (const name of files) {
      if (!/\.ttf$/i.test(name)) continue;
      if (/-VF/i.test(name)) continue;
      const lower = name.toLowerCase();
      // 掃描 Windows 字型時優先無襯線；略過標楷／楷體檔名（仍可由 candidates 備援）
      if (
        !/msyh|msjh|simhei|simfang|deng|noto|sourcehan|uming|wqy|firefly|ming|yuan|hei/.test(
          lower
        )
      ) {
        continue;
      }
      const full = path.join(winFonts, name);
      if (canUseFont(full)) {
        cachedFontPath = full;
        return cachedFontPath;
      }
    }
  } catch {
    /* ignore */
  }
  cachedFontPath = preferred;
  return cachedFontPath;
}

/** 公司名稱（PDF 抬頭；讀取系統設定） */
function getCompanyNameForPdf() {
  try {
    const n = require('./system-settings').getCompanyName();
    return n != null ? String(n) : '';
  } catch {
    return '';
  }
}
const COMPANY_NAME = ''; // 相容舊常數名

const STATUS_LABEL = {
  draft: '草稿',
  pending: '簽核中',
  approved: '已核准',
  rejected: '已駁回',
  cancelled: '已取消',
  voided: '已作廢',
};

function tryDrawSignatureImage(doc, dataUrl, x, y, maxW, maxH) {
  try {
    const buf = require('./signature').bufferFromDataUrl(dataUrl);
    if (!buf) return false;
    doc.image(buf, x, y, { fit: [maxW, maxH] });
    return true;
  } catch {
    return false;
  }
}

const ACTION_LABEL = {
  submit: '送出申請',
  approve: '核准',
  reject: '駁回',
  cancel: '取消',
  return: '退回',
  comment: '留言',
  forward: '轉簽',
  cosign: '加簽',
  void: '作廢',
};

const AUTO_APPROVAL_COMMENTS = new Set(['同意', '駁回', '取消申請']);

function isUserWrittenApprovalComment(a) {
  const c = String(a?.comment || '').trim();
  if (!c) return false;
  if (/Email\s*催辦/.test(c)) return false;
  const act = String(a.action || '');
  if (!['approve', 'reject', 'return', 'forward', 'cosign', 'void'].includes(act)) {
    return false;
  }
  if (AUTO_APPROVAL_COMMENTS.has(c)) return false;
  if (/^代理\s+.+\s+核准$/.test(c)) return false;
  if (/^代理\s+.+\s+駁回$/.test(c)) return false;
  return true;
}

/** 簽核歷程「意見」欄：只顯示同意／駁回等簡稱，不放簽核人自填意見 */
function historyOpinionCell(a) {
  const act = String(a?.action || '');
  if (act === 'approve') return '同意';
  if (act === 'reject') return '駁回';
  if (act === 'return') return '退回';
  if (act === 'submit') return '送出';
  if (act === 'cancel') return '取消';
  if (act === 'forward') return '轉簽';
  if (act === 'cosign') return '加簽';
  if (act === 'void') return '作廢';
  if (act === 'comment') {
    const c = String(a.comment || '').trim();
    if (!c || /Email\s*催辦/.test(c)) return '—';
    return ACTION_LABEL.comment;
  }
  return ACTION_LABEL[act] || '—';
}

/**
 * 將簽核人填寫的意見畫在簽核歷程上方
 * api: { doc, useFont, leftX, contentW, C, ensureSpace, textAt, fillRect, strokeRect, getY, setY }
 */
function drawApprovalCommentsAboveHistory(api, actions) {
  const items = (actions || []).filter(isUserWrittenApprovalComment);
  if (!items.length) return;
  const {
    doc,
    useFont,
    leftX,
    contentW,
    C,
    ensureSpace,
    textAt,
    fillRect,
    strokeRect,
    getY,
    setY,
  } = api;
  let y = getY();
  ensureSpace(40);
  y = getY();
  if (typeof fillRect === 'function' && C.header) {
    fillRect(leftX, y, 4, 16, C.header);
    textAt('簽核意見', leftX + 12, y, contentW - 16, {
      size: 12,
      color: C.headerDark || C.header || C.ink,
    });
  } else {
    textAt('簽核意見', leftX, y, contentW, {
      size: 11.5,
      color: C.header || C.ink,
    });
  }
  y += 20;
  setY(y);
  for (const a of items) {
    const who = [a.step_name, a.actor_name].filter(Boolean).join(' · ') || '簽核人';
    const comment = String(a.comment || '').trim();
    useFont();
    const bodyH = Math.max(
      18,
      doc.heightOfString(comment, { width: contentW - 20, fontSize: 10 }) + 6
    );
    const boxH = 20 + bodyH + 8;
    ensureSpace(boxH + 6);
    y = getY();
    fillRect(leftX, y, contentW, boxH, C.altBg || '#f8fafc');
    if (typeof strokeRect === 'function') {
      strokeRect(leftX, y, contentW, boxH, C.softLine || C.line, 0.45);
    }
    textAt(who, leftX + 10, y + 6, contentW - 20, {
      size: 9.5,
      color: C.softInk || C.muted || C.ink,
    });
    textAt(comment, leftX + 10, y + 22, contentW - 20, {
      size: 10.5,
      color: C.ink,
    });
    y += boxH + 6;
    setY(y);
  }
  y = getY() + 4;
  setY(y);
}

const AD_LABELS = {
  hr_leave_type: '假別（人事核定）',
  remaining_special_leave_days: '剩餘特休日數',
  leave_month_days: '本月累計日數',
  leave_month_hours: '本月累計時數',
  leave_year_days: '本年累計日數',
  leave_year_hours: '本年累計時數',
  hr_note: '人事備註',
  pc_acquired_date: '原電腦取得日期',
  check_os: '作業系統（Windows10）',
  check_memory: '記憶體（4G 以上）',
  check_disk: '硬碟（SSD 500G 以上）',
  check_3dmark: '3DMARK 分數（500 分以上）',
  check_email: '電子郵件定期清理',
  check_backup: '重要資料定期備份',
  check_battery: '電池容量（70% 以下）',
  check_os_note: '作業系統不符合說明',
  check_memory_note: '記憶體不符合說明',
  check_disk_note: '硬碟不符合說明',
  check_3dmark_note: '3DMARK 分數不符合說明',
  check_email_note: '電子郵件不符合說明',
  check_backup_note: '重要資料不符合說明',
  check_battery_note: '電池容量不符合說明',
  handle_result: '電腦處理情形',
  handle_note: '處理說明／其他',
  actual_start: '實際工時開始',
  actual_end: '實際工時結束',
  actual_hours: '實際總計（小時）',
  comp_leave_balance: '目前累計可用時數（補休）',
  sales_revenue: '銷貨收入（元）',
  sales_cost: '銷貨成本（元）',
  sales_gross_profit: '銷貨毛利（元）',
  sales_gross_diff_note: '毛利差異說明',
  sales_remark: '備註說明',
};

/** 假別短名（PDF 標籤用） */
function shortLeaveTypeNamePdf(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypePdf(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

function isPersonalLeaveTypePdf(type) {
  return /事假/.test(String(type || ''));
}

function isSickLeaveTypePdf(type) {
  const t = String(type || '');
  if (/公傷|住院/.test(t)) return false;
  return /普通傷病假|病假/.test(t);
}

function rocToAdYearPdf(y) {
  const n = Number(y);
  if (Number.isFinite(n) && n >= 1 && n <= 200) return n + 1911;
  return n;
}

function parseLeaveDateTimePdf(val) {
  const s = String(val || '').trim().replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  const y = rocToAdYearPdf(Number(m[1]));
  const hh = m[4] != null ? Number(m[4]) : 9;
  const mm = m[5] != null ? Number(m[5]) : 0;
  return new Date(y, Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0);
}

function snapHalfHourPdf(h) {
  if (!Number.isFinite(h) || h <= 0) return 0;
  let x = Math.round(h * 2) / 2;
  if (x > 0 && x < 0.5) x = 0.5;
  return x;
}

/** 事假單日：上午 09:00～12:30＝0.5 天；下午未滿 17:30＝另計小時；到 17:30＝1 天 */
function personalLeavePortionOnDay(dateKey, rangeStart, rangeEnd) {
  const [y, mo, d] = String(dateKey)
    .split('-')
    .map(Number);
  if (!y || !mo || !d) return { days: 0, hours: 0 };
  const at = (hh, mm) => new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  const dayStart = at(9, 0);
  const amEnd = at(12, 30);
  const lunchEnd = at(13, 30);
  const dayEnd = at(17, 30);
  const from = Math.max(rangeStart, dayStart);
  const to = Math.min(rangeEnd, dayEnd);
  if (!(to > from)) return { days: 0, hours: 0 };
  if (from <= dayStart && to >= dayEnd) return { days: 1, hours: 0 };

  let days = 0;
  let hours = 0;
  const amFrom = Math.max(from, dayStart);
  const amTo = Math.min(to, amEnd);
  if (amTo > amFrom) {
    if (from <= dayStart && to >= amEnd) days += 0.5;
    else hours += snapHalfHourPdf((amTo - amFrom) / 3600000);
  }
  const pmFrom = Math.max(from, lunchEnd);
  const pmTo = Math.min(to, dayEnd);
  if (pmTo > pmFrom) {
    if (from <= lunchEnd && to >= dayEnd) days += 0.5;
    else hours += snapHalfHourPdf((pmTo - pmFrom) / 3600000);
  }
  return { days, hours };
}

function formatPersonalLeavePortionText(days, hours) {
  if (days && hours) return `${days} 天又 ${hours} 小時`;
  if (days) return `${days} 天`;
  if (hours) return `${hours} 小時`;
  return '';
}

/**
 * 事假合計：09:00～12:30 → 0.5 天；到下午 15:00 → 0.5 天又 1.5 小時；到 17:30 → 1 天
 */
function computePersonalLeavePortion(formData) {
  const start = parseLeaveDateTimePdf(formData?.start_date);
  const end = parseLeaveDateTimePdf(formData?.end_date);
  if (!start || !end || end < start) return null;
  let isWorkday = (key) => {
    const dt = parseLeaveDateTimePdf(`${key}T09:00`);
    if (!dt) return true;
    const w = dt.getDay();
    return w !== 0 && w !== 6;
  };
  try {
    const tw = require('./tw-calendar');
    if (typeof tw.isWorkday === 'function') isWorkday = (key) => tw.isWorkday(key);
  } catch {
    /* ignore */
  }

  let days = 0;
  let hours = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(
      cur.getDate()
    ).padStart(2, '0')}`;
    if (isWorkday(key)) {
      const p = personalLeavePortionOnDay(key, start.getTime(), end.getTime());
      days += p.days;
      hours += p.hours;
    }
    cur.setDate(cur.getDate() + 1);
  }
  hours = snapHalfHourPdf(hours);
  days = Math.round(days * 2) / 2;
  if (!days && !hours) return null;
  return { days, hours, text: formatPersonalLeavePortionText(days, hours) };
}

function formatPersonalLeavePdfTotal(formData) {
  return computePersonalLeavePortion(formData)?.text || null;
}

/** 病假：滿半日只顯示日（0.5日／1日）；不到半日只顯示小時 */
function formatSickLeavePortionText(days, hours) {
  if (days) return `${days}日`;
  if (hours) return `${hours}小時`;
  return '';
}

function formatSickLeavePdfTotal(formData) {
  const p = computePersonalLeavePortion(formData);
  if (!p) return null;
  return formatSickLeavePortionText(p.days, p.hours) || null;
}

function formatLeaveTitlePeriod(start, end) {
  const one = (val) => {
    const raw = String(val || '').trim();
    if (!raw) return '';
    const dt = parseLeaveDateTimePdf(raw);
    if (!dt || Number.isNaN(dt.getTime())) {
      return raw.replace('T', ' ').slice(0, 16);
    }
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const hasTime = /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(raw);
    return hasTime ? `${y}-${mo}-${d} ${hh}:${mm}` : `${y}-${mo}-${d}`;
  };
  const a = one(start);
  const b = one(end);
  if (a && b && a.slice(0, 10) === b.slice(0, 10) && b.length > 11) {
    return `${a}～${b.slice(11)}`;
  }
  return [a, b].filter(Boolean).join('～');
}

/** 請假單主旨：事假用 0.5 天／又 N 小時，不用 7.5 小時換算 */
function buildLeaveAutoTitle(formData, opts = {}) {
  const fd = formData || {};
  const type = String(fd.leave_type || fd.假別 || '').trim();
  const parts = [opts.asDraft ? '草稿 · 請假申請' : '請假申請'];
  if (type) parts.push(type);
  const period = formatLeaveTitlePeriod(fd.start_date, fd.end_date);
  if (period) parts.push(period);
  if (/事假/.test(type)) {
    const personal = formatPersonalLeavePdfTotal(fd);
    if (personal) parts.push(personal);
    else {
      if (fd.days != null && fd.days !== '') parts.push(`${fd.days}日`);
      if (fd.hours != null && fd.hours !== '' && Number(fd.hours) > 0) {
        parts.push(`${fd.hours}小時`);
      }
    }
  } else if (isSickLeaveTypePdf(type)) {
    const sick = formatSickLeavePdfTotal(fd);
    if (sick) parts.push(sick);
    else if (fd.days != null && fd.days !== '' && Number(fd.days) >= 0.5) {
      parts.push(`${fd.days}日`);
    } else if (fd.hours != null && fd.hours !== '' && Number(fd.hours) > 0) {
      parts.push(`${fd.hours}小時`);
    }
  } else if (isSpecialLeaveTypePdf(type)) {
    if (fd.days != null && fd.days !== '') parts.push(`${fd.days}日`);
  } else {
    if (fd.days != null && fd.days !== '') parts.push(`${fd.days}日`);
    if (fd.hours != null && fd.hours !== '' && Number(fd.hours) > 0) {
      parts.push(`${fd.hours}小時`);
    }
  }
  return parts.join(' · ').slice(0, 200);
}

/**
 * 依人事核定假別產生標籤
 * 例：祭儀假 → 剩餘祭儀假日數（目前）；特休 → 剩餘特休日數（核准後）
 */
function hrLeaveLabelsPdf(hrLeaveType) {
  const t = String(hrLeaveType || '').trim();
  const shortName = shortLeaveTypeNamePdf(t);
  const isSpecial = isSpecialLeaveTypePdf(t);
  return {
    hr_leave_type: '假別（人事核定）',
    remaining_special_leave_days: t
      ? isSpecial
        ? `剩餘${shortName}日數（核准後）`
        : `剩餘${shortName}日數（目前）`
      : '剩餘日數',
    // 表格短標籤（特休僅以日顯示，不換算小時）
    remDaysShort: t ? `剩餘${shortName}日` : '剩餘日數',
    leave_month_days: '本月累計日數',
    leave_month_hours: '本月累計時數',
    leave_year_days: '本年累計日數',
    leave_year_hours: '本年累計時數',
    hr_note: '人事備註',
  };
}

/** 簽核單位欄位標籤（含人事假別動態） */
function adLabelPdf(key, adFlat) {
  const hr = hrLeaveLabelsPdf(adFlat?.hr_leave_type || adFlat?.假別 || '');
  if (hr[key]) return hr[key];
  return AD_LABELS[key] || key;
}

function looksLikeRichHtml(s) {
  return /<\/?(p|div|br|table|span|b|strong|font|u|i|em)\b/i.test(String(s || ''));
}

function formatDisplayValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (typeof val === 'object') {
    // 自繪表格物件不直接 JSON 顯示
    if (Array.isArray(val.cells)) return '（見附表）';
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  let s = String(val);
  // 富文字 HTML → 純文字（表格改由欄位下方繪製，此處只留文字）
  if (looksLikeRichHtml(s)) {
    s = /<table/i.test(s) ? richHtmlBodyPlain(s) : richHtmlToPlain(s);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.replace('T', ' ').slice(0, 16);
  }
  return s;
}

/**
 * 量測富文字高度（與 drawColoredRuns 換行演算法對齊，避免 PDF 多行被裁切）
 */
function measureRichOrPlainHeight(doc, useFont, raw, width, fontSize, lineGap) {
  const size = fontSize || 11;
  const lg = lineGap != null ? lineGap : 2;
  useFont();
  doc.fontSize(size);
  const plain = looksLikeRichHtml(raw)
    ? runsToPlain(parseRichHtmlRuns(raw)) || '—'
    : String(raw ?? '—');
  const w = Math.max(12, width);
  // 與 drawColoredRuns 相同的行高
  const lineH = size * 1.2 + lg;
  // 以模擬換行計算實際行數（中文無空白也能對）
  let lines = 1;
  let cx = 0;
  const text = String(plain || ' ');
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      lines += 1;
      cx = 0;
      i += 1;
      continue;
    }
    let space = w - cx;
    if (space < size * 0.35) {
      lines += 1;
      cx = 0;
      space = w;
      continue;
    }
    let lo = 1;
    let hi = text.length - i;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      let piece = text.slice(i, i + mid);
      const nl = piece.indexOf('\n');
      if (nl >= 0) piece = piece.slice(0, nl);
      if (!piece.length) {
        best = 0;
        break;
      }
      if (doc.widthOfString(piece) <= space + 0.01) {
        best = piece.length;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best <= 0) {
      if (cx > 0.5) {
        lines += 1;
        cx = 0;
        continue;
      }
      best = 1;
    }
    const piece = text.slice(i, i + best);
    cx += doc.widthOfString(piece);
    i += best;
  }
  // 加少許安全邊，避免字型量測誤差裁到最後一行
  return Math.max(lineH, lines * lineH) + 6;
}

/**
 * 繪製儲存格內富文字（保留 color／底線）；非 HTML 則純文字
 */
function drawRichOrPlainText(doc, useFont, raw, x, y, w, h, opts = {}) {
  const ink = opts.color || '#0f172a';
  const size = opts.size || 11;
  const lineGap = opts.lineGap != null ? opts.lineGap : 2;
  const maxH = Math.max(8, h != null ? h : 9999);
  if (looksLikeRichHtml(raw)) {
    const runs = parseRichHtmlRuns(raw, ink);
    const painted = drawColoredRuns(doc, runs, x, y, w, {
      fontSize: size,
      lineGap,
      useFont,
      defaultColor: ink,
      maxHeight: maxH,
    });
    return painted && painted.height != null ? painted.height : 0;
  }
  useFont();
  doc.fillColor(ink).fontSize(size).text(String(raw ?? '—'), x, y, {
    width: w,
    height: maxH,
    lineGap,
    align: opts.align || 'left',
  });
  return measureRichOrPlainHeight(doc, useFont, raw, w, size, lineGap);
}

/**
 * 依表單名稱配色，讓不同申請表單在 PDF 上容易辨識。
 * 常見表單固定色；其餘依名稱穩定雜湊選色。
 */
const FORM_THEME_PALETTE = [
  {
    // 深藍
    primary: '#1e3a5f',
    headerBg: '#1e3a5f',
    sectionBg: '#e2eaf5',
    labelBg: '#e8eef6',
    rowAlt: '#f1f5f9',
    border: '#94a3b8',
    accentSoft: '#cbd5e1',
    companyText: '#e2e8f0',
    metaText: '#cbd5e1',
  },
  {
    // 葉綠（請假類）
    primary: '#166534',
    headerBg: '#166534',
    sectionBg: '#dcfce7',
    labelBg: '#e8f8ee',
    rowAlt: '#f0fdf4',
    border: '#86efac',
    accentSoft: '#bbf7d0',
    companyText: '#dcfce7',
    metaText: '#bbf7d0',
  },
  {
    // 琥珀橘（請購／費用）
    primary: '#9a3412',
    headerBg: '#c2410c',
    sectionBg: '#ffedd5',
    labelBg: '#fff1e6',
    rowAlt: '#fff7ed',
    border: '#fdba74',
    accentSoft: '#fed7aa',
    companyText: '#ffedd5',
    metaText: '#fed7aa',
  },
  {
    // 靛紫
    primary: '#5b21b6',
    headerBg: '#6d28d9',
    sectionBg: '#ede9fe',
    labelBg: '#f1edfe',
    rowAlt: '#f5f3ff',
    border: '#c4b5fd',
    accentSoft: '#ddd6fe',
    companyText: '#ede9fe',
    metaText: '#ddd6fe',
  },
  {
    // 青綠
    primary: '#0f766e',
    headerBg: '#0f766e',
    sectionBg: '#ccfbf1',
    labelBg: '#e0faf5',
    rowAlt: '#f0fdfa',
    border: '#5eead4',
    accentSoft: '#99f6e4',
    companyText: '#ccfbf1',
    metaText: '#99f6e4',
  },
  {
    // 薔薇紅
    primary: '#9f1239',
    headerBg: '#be123c',
    sectionBg: '#ffe4e6',
    labelBg: '#ffecee',
    rowAlt: '#fff1f2',
    border: '#fda4af',
    accentSoft: '#fecdd3',
    companyText: '#ffe4e6',
    metaText: '#fecdd3',
  },
  {
    // 天藍
    primary: '#075985',
    headerBg: '#0369a1',
    sectionBg: '#e0f2fe',
    labelBg: '#e8f6fe',
    rowAlt: '#f0f9ff',
    border: '#7dd3fc',
    accentSoft: '#bae6fd',
    companyText: '#e0f2fe',
    metaText: '#bae6fd',
  },
  {
    // 酒紅
    primary: '#7f1d1d',
    headerBg: '#991b1b',
    sectionBg: '#fee2e2',
    labelBg: '#feecec',
    rowAlt: '#fef2f2',
    border: '#fca5a5',
    accentSoft: '#fecaca',
    companyText: '#fee2e2',
    metaText: '#fecaca',
  },
  {
    // 橄欖
    primary: '#3f6212',
    headerBg: '#4d7c0f',
    sectionBg: '#ecfccb',
    labelBg: '#f2fde0',
    rowAlt: '#f7fee7',
    border: '#bef264',
    accentSoft: '#d9f99d',
    companyText: '#ecfccb',
    metaText: '#d9f99d',
  },
  {
    // 石板
    primary: '#334155',
    headerBg: '#334155',
    sectionBg: '#e2e8f0',
    labelBg: '#e9eef4',
    rowAlt: '#f8fafc',
    border: '#94a3b8',
    accentSoft: '#cbd5e1',
    companyText: '#e2e8f0',
    metaText: '#cbd5e1',
  },
];

/** 常見表單關鍵字 → 調色盤索引（固定色，方便辨識） */
const FORM_THEME_KEYWORDS = [
  { re: /作廢申請/, idx: 3 }, // 紫（優先於原單請假／請購等關鍵字）
  { re: /請假|休假|特休|病假|事假|喪假|產假|婚假/, idx: 1 }, // 綠
  { re: /請購|採購|訂購|支付|付款/, idx: 2 }, // 橘
  { re: /費用|報支|報銷|核銷|請款/, idx: 5 }, // 薔薇紅
  { re: /加班|補休|工時|延長/, idx: 3 }, // 紫
  { re: /出差|公差|旅費/, idx: 4 }, // 青綠
  { re: /電腦|資訊|IT|設備|報修/, idx: 6 }, // 天藍
  { re: /福利金/, idx: 0 }, // 深藍（職工福利金明細表）
  { re: /部門月會|會議記錄/, idx: 0 }, // 深藍會議記錄
  { re: /用印|印章|合約|契約|簽呈/, idx: 0 }, // 深藍
  { re: /離職|到職|人事|任用/, idx: 7 }, // 酒紅
  { re: /交通|車輛/, idx: 8 }, // 橄欖
];

function hashString(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 依 workflow 名稱／id 取得 PDF 主題色
 */
function resolveFormTheme(request) {
  const name = String(
    request?.workflow_name || request?.form_name || '簽核申請'
  ).trim();
  let idx = -1;
  for (const item of FORM_THEME_KEYWORDS) {
    if (item.re.test(name)) {
      idx = item.idx;
      break;
    }
  }
  if (idx < 0) {
    const key = request?.workflow_id != null ? `id:${request.workflow_id}` : name;
    idx = hashString(key) % FORM_THEME_PALETTE.length;
  }
  const base = FORM_THEME_PALETTE[idx] || FORM_THEME_PALETTE[0];
  return {
    ...base,
    text: '#0f172a',
    muted: '#475569',
    white: '#ffffff',
    themeIndex: idx,
    formName: name,
  };
}

/**
 * 解析 PDF 版面類型（優先流程模組 pdfLayout，否則依名稱推斷）
 * @returns {'leave'|'credit_limit'|'welfare'|'dept_meeting'|'purchase'|'expense'|'travel'|'it_repair'|'overtime'|'general'}
 */
function isVoidApplicationRequest(request) {
  if (!request) return false;
  if (Number(request.void_of_request_id) > 0) return true;
  const name = String(request.workflow_name || request.form_name || '');
  if (/作廢申請/.test(name)) return true;
  return /^作廢申請/.test(String(request.title || '').trim());
}

function resolvePdfLayoutType(request) {
  if (isVoidApplicationRequest(request)) return 'general';
  const pl = request?.pdfLayout;
  if (pl) {
    const t = String(pl.resolvedType || pl.type || '').trim();
    if (t && t !== 'auto') return t;
  }
  try {
    const { detectPdfLayoutType } = require('./workflow-module');
    return detectPdfLayoutType(
      request?.workflow_name || request?.form_name || request?.title || ''
    );
  } catch {
    /* fall through name heuristics below */
  }
  const name = String(request?.workflow_name || request?.form_name || request?.title || '');
  if (/請假|休假|leave/i.test(name)) return 'leave';
  if (/信用額度|授信額度|額度申請/i.test(name)) return 'credit_limit';
  if (/福利金/i.test(name)) return 'welfare';
  if (/請購|採購|訂購|支付|付款|purchase|payment/i.test(name)) return 'purchase';
  if (/費用|報支|報銷|請款|expense/i.test(name)) return 'expense';
  if (/出差|公出|差旅|travel|business.?trip/i.test(name)) return 'travel';
  if (/電腦|報修|資訊設備/i.test(name)) return 'it_repair';
  if (/加班|延長工時|超時|overtime/i.test(name)) return 'overtime';
  if (/部門月會|會議記錄/.test(name)) return 'dept_meeting';
  if (/簽呈/.test(name)) return 'general';
  return 'general';
}

/**
 * 流程模組已明確指定 pdfLayout.type（非 auto）時，以該類型為準。
 * type=auto 或無 pdfLayout 時：先看 resolved／名稱推斷，再退回欄位啟發式。
 */
function hasExplicitPdfLayout(request) {
  const pl = request?.pdfLayout;
  if (!pl) return false;
  const t = String(pl.type || '').trim();
  return Boolean(t && t !== 'auto');
}

/** @returns {boolean|null} true/false=已決定；null=交給啟發式 */
function matchPdfLayout(request, type) {
  if (hasExplicitPdfLayout(request)) {
    return resolvePdfLayoutType(request) === type;
  }
  // auto：resolved 命中專用版面時直接 true；general 不強制，避免誤用簽呈版面
  const resolved = resolvePdfLayoutType(request);
  if (resolved === type && type !== 'general') return true;
  return null;
}

/** 是否為請假類表單（使用專用請假單版面） */
function isLeaveRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'leave');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/請假|休假|leave/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('leave_type') && (ids.has('start_date') || ids.has('days'));
}

/** 職工福利金明細表 */
function isWelfareRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'welfare');
  if (m !== null) return m;
  const name = String(
    request?.workflow_name || request?.form_name || request?.title || ''
  );
  if (/福利金/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('welfare_items') || ids.has('opening_balance');
}

/** 部門月會會議記錄 */
function isDeptMeetingRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'dept_meeting');
  if (m !== null) return m;
  const name = String(
    request?.workflow_name || request?.form_name || request?.title || ''
  );
  if (/部門月會|會議記錄/.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('meeting_subject') && ids.has('minutes');
}

function parseFollowupItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.rows)) return p.rows;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function resolveMeetingAttendeeNames(request) {
  const fd = request?.form_data || {};
  const fromText = String(fd.attendees || '').trim();
  const ids = String(fd.attendee_ids || '')
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0);
  if (!ids.length && fromText) return fromText;
  const names = [];
  const seen = new Set();
  const push = (n) => {
    const s = String(n || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    names.push(s);
  };
  push(request?.requester_name);
  if (ids.length) {
    try {
      const db = require('./db');
      const ph = ids.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT id, name FROM users WHERE id IN (${ph})`)
        .all(...ids);
      const map = new Map(rows.map((r) => [Number(r.id), r.name]));
      for (const id of ids) push(map.get(id));
    } catch {
      /* ignore */
    }
  }
  if (names.length) return names.join('、');
  return fromText || '—';
}

function meetingDateTextPdf(val) {
  const p = toRocParts(val);
  if (p.y === '') return '—';
  const yAd = Number(p.y) > 1911 ? Number(p.y) : Number(p.y) + 1911;
  const dt = new Date(yAd, Number(p.m) - 1, Number(p.d));
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const w = Number.isNaN(dt.getTime()) ? '' : `（星期${week[dt.getDay()]}）`;
  return `民國 ${p.y} 年 ${Number(p.m)} 月 ${Number(p.d)} 日${w}`;
}

function parseWelfareItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.rows)) return v.rows;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function welfareAmtNum(v) {
  const n = Number(String(v ?? '').replace(/[,，\s元萬]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function welfareAmtText(v, { blankZero = true } = {}) {
  const n = welfareAmtNum(v);
  if (blankZero && n === 0) return '';
  return Math.round(n).toLocaleString('zh-TW');
}

function welfareRocDate(val) {
  const p = toRocParts(val);
  if (p.y === '') return val ? String(val) : '';
  return `${p.y}/${p.m}/${p.d}`;
}

/** 信用額度申請表 */
function isCreditLimitRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'credit_limit');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || request?.title || '');
  if (/信用額度|授信額度|額度申請/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    ids.has('requested_credit_limit') ||
    ids.has('customer_name') ||
    ids.has('sales_credit_limit') ||
    ids.has('credit_limit')
  );
}

/** 請購／支付類表單 */
function isPurchaseRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'purchase');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/請購|採購|支付|付款|purchase|payment/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    (ids.has('item_name') || ids.has('vendor')) &&
    (ids.has('amount') || ids.has('currency'))
  );
}

/** 費用報支主旨：去掉「費用報支 ·」前綴，給 PDF 抬頭／主旨欄用 */
function expenseSubjectFromTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^草稿\s*·\s*/, '')
    .replace(/^(費用報支|費用申請)\s*·\s*/, '')
    .trim();
}

/** 費用報支 */
function isExpenseRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'expense');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/費用|報支|報銷|核銷|請款|expense/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    ids.has('expense_type') ||
    (ids.has('expense_date') && ids.has('amount') && !ids.has('item_name'))
  );
}

/** 出差申請 */
function isTravelRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'travel');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/出差|公差|旅費|travel|business.?trip/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('destination') && (ids.has('purpose') || ids.has('budget'));
}

/** 電腦異常報修 */
function isItRepairRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'it_repair');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/電腦|報修|資訊設備/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('issue_desc') && ids.has('computer_spec');
}

/** 延長工時／加班 */
function isOvertimeRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const m = matchPdfLayout(request, 'overtime');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/加班|延長工時|延時|overtime/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('ot_start') || ids.has('ot_end') || ids.has('ot_option');
}

/** 一般簽呈 */
function isGeneralMemoRequest(request) {
  if (isVoidApplicationRequest(request)) return false;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/呈交紀錄表/.test(name)) return false;
  if (/部門月會|會議記錄/.test(name)) return false;
  const m = matchPdfLayout(request, 'general');
  if (m !== null) return m;
  if (/簽呈/.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('subject') && ids.has('category');
}

/** 簽呈類 PDF 抬頭：一般簽呈維持「簽呈」，其餘用表單名稱（如呈交紀錄表） */
function generalMemoHeaderTitle(request) {
  const name = String(
    request?.workflow_name || request?.form_name || ''
  ).trim();
  if (!name || /^(一般)?簽呈$/.test(name)) return '簽　　呈';
  return name;
}

/**
 * 各申請單專用色系（抬頭／標籤／區塊／框線）
 * 請假：綠｜請購：橘｜費用：薔薇紅｜報修：藍｜加班：紫｜簽呈：深藍
 */
const FORM_UI_THEMES = {
  leave: {
    header: '#0f766e',
    headerSoft: '#ccfbf1',
    labelBg: '#f0fdfa',
    sectionBg: '#99f6e4',
    line: '#5eead4',
    lineDark: '#0f766e',
    softLine: '#99f6e4',
    softInk: '#115e59',
    altBg: '#f0fdfa',
  },
  purchase: {
    header: '#c2410c',
    headerSoft: '#ffedd5',
    labelBg: '#fff7ed',
    sectionBg: '#fed7aa',
    line: '#fdba74',
    lineDark: '#ea580c',
    softLine: '#fdba74',
    softInk: '#9a3412',
    altBg: '#fffbeb',
  },
  it: {
    header: '#0369a1',
    headerSoft: '#e0f2fe',
    labelBg: '#f0f9ff',
    sectionBg: '#bae6fd',
    line: '#7dd3fc',
    lineDark: '#0284c7',
    softLine: '#7dd3fc',
    softInk: '#075985',
    altBg: '#f0f9ff',
  },
  overtime: {
    header: '#6d28d9',
    headerSoft: '#ede9fe',
    labelBg: '#f5f3ff',
    sectionBg: '#ddd6fe',
    line: '#c4b5fd',
    lineDark: '#7c3aed',
    softLine: '#c4b5fd',
    softInk: '#5b21b6',
    altBg: '#faf5ff',
  },
  memo: {
    header: '#1e3a5f',
    headerSoft: '#e2e8f0',
    labelBg: '#f1f5f9',
    sectionBg: '#cbd5e1',
    line: '#94a3b8',
    lineDark: '#334155',
    softLine: '#94a3b8',
    softInk: '#1e293b',
    altBg: '#f8fafc',
  },
  expense: {
    header: '#be123c',
    headerSoft: '#ffe4e6',
    labelBg: '#fff1f2',
    sectionBg: '#fecdd3',
    line: '#fda4af',
    lineDark: '#e11d48',
    softLine: '#fda4af',
    softInk: '#9f1239',
    altBg: '#fff1f2',
  },
  travel: {
    header: '#4d7c0f',
    headerSoft: '#ecfccb',
    labelBg: '#f7fee7',
    sectionBg: '#d9f99d',
    line: '#a3e635',
    lineDark: '#65a30d',
    softLine: '#bef264',
    softInk: '#3f6212',
    altBg: '#f7fee7',
  },
};

/**
 * 簡單整齊表格繪製工具（各申請單共用，依 theme 換色）
 */
function createSimpleTableKit(ctx, theme = {}) {
  const { doc, useFont, leftX, contentW, pageH, margin } = ctx;
  let y = margin;
  const C = {
    ink: theme.ink || '#111827',
    softInk: theme.softInk || '#374151',
    muted: theme.muted || '#6b7280',
    line: theme.line || '#9ca3af',
    lineDark: theme.lineDark || '#4b5563',
    softLine: theme.softLine || '#d1d5db',
    header: theme.header || '#374151',
    headerSoft: theme.headerSoft || '#f3f4f6',
    labelBg: theme.labelBg || '#f9fafb',
    sectionBg: theme.sectionBg || '#e5e7eb',
    white: '#ffffff',
    cellBg: '#ffffff',
    altBg: theme.altBg || '#f9fafb',
    ok: '#166534',
    ng: '#b91c1c',
  };
  const FS_LABEL = 10.5;
  const FS_VALUE = 11;
  const FS_SMALL = 9.5;

  function ensureSpace(need) {
    if (y + need > pageH - margin - 16) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  }
  function fillRect(x, yy, w, h, color) {
    doc.rect(x, yy, w, h).fill(color);
  }
  function strokeRect(x, yy, w, h, color, width) {
    doc
      .rect(x, yy, w, h)
      .strokeColor(color || C.lineDark)
      .lineWidth(width || 0.7)
      .stroke();
  }
  function textAt(str, x, yy, w, opts = {}) {
    useFont();
    const o = {
      width: w,
      align: opts.align || 'left',
      lineBreak: opts.lineBreak !== false,
    };
    if (opts.height != null) o.height = opts.height;
    if (opts.lineGap != null) o.lineGap = opts.lineGap;
    if (opts.ellipsis) o.ellipsis = true;
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(opts.size || FS_VALUE)
      .text(String(str ?? ''), x, yy, o);
  }
  function textMid(str, x, yy, w, h, opts = {}) {
    useFont();
    const size = opts.size || FS_VALUE;
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(String(str ?? ''), x, ty, {
        width: w,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /** 量測多行文字高度（必須先設好字型／字級，與繪製一致） */
  function measureTextH(str, w, opts = {}) {
    useFont();
    const size = opts.size != null ? opts.size : FS_VALUE;
    doc.fontSize(size);
    const h = doc.heightOfString(String(str ?? ''), {
      width: Math.max(8, w),
      lineGap: opts.lineGap != null ? opts.lineGap : 2,
    });
    return h;
  }

  /** 單行自動縮放，避免文字溢出相鄰欄位 */
  function textFitOneLine(str, x, yy, w, h, opts = {}) {
    useFont();
    const text = String(str ?? '');
    const maxSize = opts.maxSize != null ? opts.maxSize : FS_VALUE;
    const minSize = opts.minSize != null ? opts.minSize : 7.5;
    let size = maxSize;
    const maxW = Math.max(6, w);
    while (size > minSize) {
      doc.fontSize(size);
      if (doc.widthOfString(text) <= maxW) break;
      size -= 0.5;
    }
    let draw = text;
    if (doc.widthOfString(draw) > maxW && draw.length > 1) {
      while (draw.length > 1 && doc.widthOfString(draw + '…') > maxW) {
        draw = draw.slice(0, -1);
      }
      draw += '…';
    }
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(draw, x, ty, {
        width: maxW,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /** cells: [{ w, label?, value, labelW?, multi?, bg?, valueColor?, align? }] */
  function drawRow(cells, h) {
    ensureSpace(h + 1);
    // 校正最後一欄寬度，確保列寬合計 = contentW（格線對齊）
    const cellsAdj = cells.map((c) => ({ ...c }));
    if (cellsAdj.length) {
      const sum = cellsAdj.reduce((a, c) => a + (c.w || 0), 0);
      if (sum !== contentW) {
        cellsAdj[cellsAdj.length - 1].w =
          (cellsAdj[cellsAdj.length - 1].w || 0) + (contentW - sum);
      }
    }
    let x = leftX;
    fillRect(leftX, y, contentW, h, C.cellBg);
    for (const c of cellsAdj) {
      const lw = c.label != null ? c.labelW || 70 : 0;
      if (c.label != null) fillRect(x, y, lw, h, c.labelBg || C.labelBg);
      if (c.bg) fillRect(x + lw, y, c.w - lw, h, c.bg);
      x += c.w;
    }
    strokeRect(leftX, y, contentW, h, C.lineDark, 0.65);
    x = leftX;
    for (let i = 0; i < cellsAdj.length; i++) {
      const c = cellsAdj[i];
      const lw = c.label != null ? c.labelW || 70 : 0;
      if (i > 0) {
        doc
          .moveTo(x, y)
          .lineTo(x, y + h)
          .strokeColor(C.line)
          .lineWidth(0.55)
          .stroke();
      }
      if (c.label != null) {
        doc
          .moveTo(x + lw, y)
          .lineTo(x + lw, y + h)
          .strokeColor(C.line)
          .lineWidth(0.55)
          .stroke();
        textFitOneLine(c.label, x + 2, y, lw - 4, h, {
          maxSize: FS_LABEL,
          minSize: 8,
          color: C.softInk,
          align: 'center',
        });
        if (c.multi) {
          // 富文字保留顏色；限制高度避免超出儲存格
          drawRichOrPlainText(
            doc,
            useFont,
            c.html != null ? c.html : c.value || '—',
            x + lw + 6,
            y + 6,
            c.w - lw - 12,
            Math.max(10, h - 12),
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              lineGap: 2,
            }
          );
        } else {
          textFitOneLine(
            looksLikeRichHtml(c.value) ? richHtmlToPlain(c.value) : c.value || '—',
            x + lw + 6,
            y,
            c.w - lw - 12,
            h,
            {
              maxSize: c.valueSize || FS_VALUE,
              minSize: 8,
              color: c.valueColor || C.ink,
              align: c.align || 'left',
            }
          );
        }
      } else if (c.value != null || c.html != null) {
        if (c.multi) {
          drawRichOrPlainText(
            doc,
            useFont,
            c.html != null ? c.html : c.value || '—',
            x + 6,
            y + 6,
            c.w - 12,
            Math.max(10, h - 12),
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              lineGap: 2,
            }
          );
        } else {
          textFitOneLine(
            looksLikeRichHtml(c.value) ? richHtmlToPlain(c.value) : c.value,
            x + 6,
            y,
            c.w - 12,
            h,
            {
              maxSize: c.valueSize || FS_VALUE,
              minSize: 8,
              color: c.valueColor || C.ink,
              align: c.align || 'left',
            }
          );
        }
      }
      x += c.w;
    }
    y += h;
  }

  function sectionBar(title) {
    const h = 24;
    ensureSpace(h + 2);
    fillRect(leftX, y, contentW, h, C.sectionBg);
    strokeRect(leftX, y, contentW, h, C.lineDark, 0.65);
    textMid(title, leftX + 10, y, contentW - 20, h, {
      size: 11,
      color: C.header,
      align: 'left',
    });
    y += h;
  }

  function drawHeader(formTitle, applyDateText, metaRight, subtitle) {
    const sub = String(subtitle || '').trim();
    useFont();
    let subH = 0;
    if (sub) {
      doc.fontSize(11);
      subH = Math.min(
        28,
        Math.max(14, doc.heightOfString(sub, { width: contentW - 40 }) + 2)
      );
    }
    const headH = (sub ? 70 : 66) + subH;
    // 頂部主色條 + 淺色抬頭底
    fillRect(leftX, y, contentW, 5, C.header);
    fillRect(leftX, y + 5, contentW, headH - 5, C.headerSoft);
    strokeRect(leftX, y, contentW, headH, C.lineDark, 0.95);
    useFont();
    doc
      .fillColor(C.header)
      .fontSize(12)
      .text(getCompanyNameForPdf(), leftX, y + 14, {
        width: contentW,
        align: 'center',
      });
    doc
      .moveTo(leftX + contentW * 0.3, y + 32)
      .lineTo(leftX + contentW * 0.7, y + 32)
      .strokeColor(C.header)
      .lineWidth(0.9)
      .stroke();
    doc
      .fillColor(C.header)
      .fontSize(sub ? 16 : 18)
      .text(formTitle, leftX, y + 38, {
        width: contentW,
        align: 'center',
      });
    if (sub) {
      doc
        .fillColor(C.headerDark || C.header)
        .fontSize(11)
        .text(sub, leftX + 20, y + 58, {
          width: contentW - 40,
          align: 'center',
          height: subH,
        });
    }
    y += headH + 6;
    const metaH = 22;
    fillRect(leftX, y, contentW, metaH, C.altBg);
    strokeRect(leftX, y, contentW, metaH, C.softLine, 0.55);
    fillRect(leftX, y, 3, metaH, C.header);
    textMid(`申請日期：${applyDateText}`, leftX + 10, y, contentW * 0.55, metaH, {
      size: FS_SMALL,
      color: C.softInk,
    });
    textMid(metaRight || '', leftX + contentW * 0.45, y, contentW * 0.55 - 10, metaH, {
      size: FS_SMALL,
      color: C.muted,
      align: 'right',
    });
    y += metaH + 8;
  }

  function drawActionsHistory(actions) {
    drawApprovalCommentsAboveHistory(
      {
        doc,
        useFont,
        leftX,
        contentW,
        C,
        ensureSpace,
        textAt,
        fillRect,
        strokeRect,
        getY: () => y,
        setY: (v) => {
          y = v;
        },
      },
      actions
    );
    const list = (actions || []).filter(
      (a) =>
        a.action !== 'comment' ||
        (a.comment && !/Email 催辦/.test(a.comment || ''))
    );
    if (!list.length) return;
    ensureSpace(36);
    textAt('簽核歷程', leftX, y, contentW, {
      size: 11.5,
      color: C.header,
    });
    y += 16;
    const colW = {
      step: Math.floor(contentW * 0.28),
      action: Math.floor(contentW * 0.12),
      actor: Math.floor(contentW * 0.16),
      time: Math.floor(contentW * 0.22),
    };
    colW.comment =
      contentW - colW.step - colW.action - colW.actor - colW.time;
    const headH = 24;
    ensureSpace(headH + 12);
    fillRect(leftX, y, contentW, headH, C.header);
    let x = leftX;
    for (const [lab, w] of [
      ['步驟', colW.step],
      ['動作', colW.action],
      ['簽核人', colW.actor],
      ['時間', colW.time],
      ['意見', colW.comment],
    ]) {
      textMid(lab, x + 4, y, w - 8, headH, {
        size: 10,
        color: C.white,
      });
      x += w;
    }
    y += headH;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const cells = [
        `${a.step_order}${a.step_name ? ` · ${a.step_name}` : ''}`,
        ACTION_LABEL[a.action] || a.action,
        a.actor_name || '—',
        String(a.created_at || '').replace('T', ' ').slice(0, 16),
        historyOpinionCell(a),
      ];
      const widths = [
        colW.step,
        colW.action,
        colW.actor,
        colW.time,
        colW.comment,
      ];
      useFont();
      let maxH = 22;
      for (let j = 0; j < cells.length; j++) {
        const hh =
          doc.heightOfString(String(cells[j]), {
            width: widths[j] - 8,
            fontSize: 9.5,
          }) + 10;
        if (hh > maxH) maxH = hh;
      }

      ensureSpace(maxH + 1);
      if (i % 2 === 1) fillRect(leftX, y, contentW, maxH, C.altBg);
      strokeRect(leftX, y, contentW, maxH, C.softLine, 0.4);
      x = leftX;
      for (let j = 0; j < cells.length; j++) {
        if (j > 0) {
          doc
            .moveTo(x, y)
            .lineTo(x, y + maxH)
            .strokeColor(C.softLine)
            .lineWidth(0.35)
            .stroke();
        }
        textAt(cells[j], x + 4, y + 5, widths[j] - 8, {
          size: 9.5,
          color: C.ink,
        });

        x += widths[j];
      }
      y += maxH;
    }
  }

  function drawAttachments(atts) {
    if (!atts || !atts.length) return;
    ensureSpace(28);
    textAt('附件', leftX, y, contentW, { size: 11.5, color: C.header });
    y += 14;
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      ensureSpace(15);
      textAt(
        `${i + 1}. ${a.original_name || a.filename || '—'}`,
        leftX + 4,
        y,
        contentW - 8,
        { size: 10, color: C.softInk }
      );
      y += 14;
    }
  }

  return {
    C,
    get y() {
      return y;
    },
    set y(v) {
      y = v;
    },
    ensureSpace,
    fillRect,
    strokeRect,
    textAt,
    textMid,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    drawEmbeddedFormTable: (table, opts = {}) =>
      drawEmbeddedFormTableOnKit(
        {
          C,
          get y() {
            return y;
          },
          set y(v) {
            y = v;
          },
          ensureSpace,
          fillRect,
          strokeRect,
          textAt,
          textMid,
          FS_VALUE,
          FS_LABEL,
        },
        table,
        {
          ctx,
          title: opts.title,
          hideTitle: opts.hideTitle,
          inset: opts.inset,
          maxRowH: opts.maxRowH,
        }
      ),
    FS_VALUE,
    FS_LABEL,
    FS_SMALL,
  };
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[\uF000-\uF8FF]/g, '•')
    .replace(/[░▒▓█]/g, '■')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) ? String.fromCharCode(c) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return Number.isFinite(c) ? String.fromCharCode(c) : '';
    });
}

/** Word Wingdings／Webdings 字母 → 系統字型畫得到的標記 */
function mapSymbolFontText(text, family) {
  const f = String(family || '').toLowerCase();
  const src = String(text || '');
  if (!/wingdings|webdings|\bsymbol\b/i.test(f)) return src;
  const W = {
    n: '■',
    l: '●',
    u: '■',
    v: '◆',
    w: '●',
    x: '✗',
    o: '☐',
    p: '☐',
    '§': '■',
    q: '●',
    r: '■',
    t: '★',
    s: '▪',
    m: '◆',
    j: '☺',
    k: '☺',
  };
  let out = '';
  for (const ch of src) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u00a0') {
      out += ch;
      continue;
    }
    const mapped = W[ch] || W[ch.toLowerCase()];
    out += mapped || '■';
  }
  return out;
}

function parseHtmlFontSizePt(html, attrs) {
  const blob = `${styleFromHtmlAttrs(attrs)};${html || ''}`;
  const m = String(blob).match(/font-size\s*:\s*([\d.]+)\s*pt/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(16, n)) : 0;
}

function styleHasBoxBorder(style) {
  const s = String(style || '');
  if (!s || /border\s*:\s*(none|0\b)/i.test(s)) return false;
  return /border(?:-width|-style)?\s*:\s*(?!none)[^;]*(solid|double|dotted|dashed)/i.test(
    s
  );
}

function cssLenToPt(style, prop) {
  const re = new RegExp(
    `(?:^|;)\\s*${prop.replace(/-/g, '\\-')}\\s*:\\s*([-+]?[\\d.]+)\\s*(pt|px|cm|mm|em|rem|in)?`,
    'i'
  );
  const m = String(style || '').match(re);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const u = (m[2] || 'pt').toLowerCase();
  if (u === 'px') return n * 0.75;
  if (u === 'cm') return n * 28.346;
  if (u === 'mm') return n * 2.835;
  if (u === 'in') return n * 72;
  if (u === 'em' || u === 'rem') return n * 11;
  return n;
}

/** Word <p> 的 text-indent / margin-left → 前置空白數 */
function blockIndentSpaces(style) {
  const pt =
    Math.max(0, cssLenToPt(style, 'text-indent')) +
    Math.max(0, cssLenToPt(style, 'margin-left')) +
    Math.max(0, cssLenToPt(style, 'padding-left'));
  if (pt <= 3) return 0;
  return Math.min(30, Math.round(pt / 5.5));
}

/** 摺疊行內空白，但保留行首縮排（Word &nbsp;） */
function normalizeKeepLeadingSpaces(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*)(.*)$/);
      if (!m) return line;
      return m[1] + m[2].replace(/[^\S\n]+/g, ' ').replace(/ +$/g, '');
    })
    .join('\n');
}

/** CSS / HTML color → #rrggbb */
function normalizePdfColor(input, fallback = '#0f172a') {
  if (input == null || input === '') return fallback;
  let s = String(input).trim().toLowerCase();
  const named = {
    black: '#000000',
    white: '#ffffff',
    red: '#b91c1c',
    maroon: '#991b1b',
    orange: '#c2410c',
    green: '#15803d',
    blue: '#1d4ed8',
    navy: '#1e3a8a',
    purple: '#7e22ce',
    gray: '#4b5563',
    grey: '#4b5563',
    silver: '#9ca3af',
    windowtext: '#000000',
    currentcolor: fallback,
    lime: '#00ff00',
    yellow: '#ffff00',
    aqua: '#00ffff',
    cyan: '#00ffff',
    fuchsia: '#ff00ff',
    magenta: '#ff00ff',
    orange: '#ff9900',
    pink: '#ffc0cb',
    gold: '#ffd700',
    navy: '#000080',
    teal: '#008080',
    olive: '#808000',
    maroon: '#800000',
    purple: '#800080',
    green: '#008000',
    blue: '#0000ff',
    red: '#ff0000',
  };
  if (named[s]) return named[s];
  if (s.startsWith('#')) {
    if (s.length === 4) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    if (/^#[0-9a-f]{6}/i.test(s)) return s.slice(0, 7);
    return fallback;
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const hex = (n) =>
      Math.max(0, Math.min(255, Number(n) || 0))
        .toString(16)
        .padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return fallback;
}

function parseInlineStyleColor(styleAttr) {
  if (!styleAttr) return null;
  const m = String(styleAttr).match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return m ? normalizePdfColor(m[1].trim(), null) : null;
}

function styleFromHtmlAttrs(attrs) {
  const m = String(attrs || '').match(/style\s*=\s*(["'])([\s\S]*?)\1/i);
  return m ? m[2] : '';
}

function parseCssBackground(style, attrs) {
  const s = `${style || ''};${styleFromHtmlAttrs(attrs)}`;
  const m = s.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
  if (m) {
    let raw = m[1].trim();
    const rgb = raw.match(/rgba?\([^)]+\)/i);
    if (rgb) raw = rgb[0];
    else raw = raw.split(/\s+/)[0];
    if (raw && !/^(none|transparent|inherit)$/i.test(raw)) {
      return normalizePdfColor(raw, null);
    }
  }
  const bg = String(attrs || '').match(/\bbgcolor\s*=\s*["']?([^"'\s>]+)/i);
  if (bg) return normalizePdfColor(bg[1], null);
  return null;
}

function parseHtmlAlign(attrs, inner) {
  const a = String(attrs || '');
  const am = a.match(/\balign\s*=\s*["']?(left|center|right|middle)/i);
  if (am) return am[1].toLowerCase() === 'middle' ? 'center' : am[1].toLowerCase();
  const st = styleFromHtmlAttrs(attrs);
  const tm = st.match(/text-align\s*:\s*(left|center|right|middle)/i);
  if (tm) return tm[1].toLowerCase() === 'middle' ? 'center' : tm[1].toLowerCase();
  if (/text-align\s*:\s*center/i.test(inner || '')) return 'center';
  if (/align\s*=\s*["']center/i.test(inner || '')) return 'center';
  return '';
}

function firstHtmlTextColor(inner, attrs) {
  const fromStyle = parseInlineStyleColor(styleFromHtmlAttrs(attrs));
  if (fromStyle) return fromStyle;
  const m = String(inner || '').match(/[^-]color\s*:\s*([^;"}]+)/i);
  if (m) return normalizePdfColor(m[1].trim(), null);
  const fm = String(inner || '').match(/\bcolor\s*=\s*["']?([^"'\s>]+)/i);
  if (fm) return normalizePdfColor(fm[1], null);
  return null;
}

/**
 * 富文字 HTML → 著色文字片段（不含 table）
 * 支援 <span style="color:…">、<font color="…">、粗體、底線
 * @returns {{ text: string, color: string, bold?: boolean, underline?: boolean }[]}
 */
function parseRichHtmlRuns(html, defaultColor = '#0f172a') {
  let src = String(html || '');
  // 移除 table（由表格流程處理）
  const ranges = findHtmlTableRanges(src);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    src = `${src.slice(0, r.start)}\n${src.slice(r.end)}`;
  }
  src = src
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  if (!src.trim()) return [{ text: '', color: defaultColor }];

  const runs = [];
  const stack = [
    {
      color: defaultColor,
      bold: false,
      underline: false,
      bg: null,
      box: false,
      fontFamily: '',
    },
  ];
  const cur = () => stack[stack.length - 1];
  const BLOCK_TAGS = [
    'p',
    'div',
    'li',
    'tr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'section',
    'article',
  ];
  const endsWithNewline = () => {
    for (let i = runs.length - 1; i >= 0; i--) {
      const t = String(runs[i].text || '');
      if (!t) continue;
      return /\n$/.test(t);
    }
    return false;
  };
  const hasAnyText = () =>
    runs.some((r) => String(r.text || '').replace(/\n/g, '').trim());
  /** 區塊換行：已有內容且尚未以換行結尾時補 \n（對應 contenteditable 首行裸文字 + 後續 div） */
  const ensureBlockBreak = () => {
    if (hasAnyText() && !endsWithNewline()) pushText('\n');
  };

  let pendingIndent = 0;
  let paraHadGlyph = false;

  const pushText = (raw) => {
    let t = decodeHtmlEntities(raw).replace(/[\uF000-\uF8FF]/g, '•');
    if (!t) return;
    t = mapSymbolFontText(t, cur().fontFamily);
    t = normalizeKeepLeadingSpaces(t);
    if (!t) return;
    const st0 = cur();
    if (pendingIndent > 0) {
      const pad = ' '.repeat(pendingIndent);
      pendingIndent = 0;
      runs.push({
        text: pad,
        color: st0.color,
        bg: null,
        bold: false,
        underline: false,
        box: false,
      });
    }
    if (/[^\s]/.test(t)) paraHadGlyph = true;
    const st = cur();
    if (st.box) t = t.replace(/[ \t\u00a0]+$/g, '');
    if (!t) return;
    const last = runs[runs.length - 1];
    if (
      last &&
      last.color === st.color &&
      last.bg === st.bg &&
      !!last.bold === !!st.bold &&
      !!last.underline === !!st.underline &&
      !!last.box === !!st.box
    ) {
      last.text += t;
    } else {
      runs.push({
        text: t,
        color: st.color,
        bg: st.bg || null,
        bold: !!st.bold,
        underline: !!st.underline,
        box: !!st.box,
      });
    }
  };

  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g;
  let m;
  while ((m = tokenRe.exec(src))) {
    if (m[3] != null) {
      const raw = m[3];
      // 只丟掉標籤間排版換行；Word 的 &nbsp; 縮排要留下來
      if (!/&nbsp;|&#160;|&#x0*a0;/i.test(raw) && /^\s*$/.test(raw)) continue;
      pushText(raw);
      continue;
    }
    const tag = String(m[1] || '').toLowerCase();
    const attrs = m[2] || '';
    const isClose = /^<\//.test(m[0]);
    if (tag === 'br' || tag === 'hr') {
      pushText('\n');
      continue;
    }
    if (isClose) {
      if (BLOCK_TAGS.includes(tag)) {
        // 區塊結束只補一個換行。空 <div><br></div> 的 <br> 已寫入 \n，
        // 再補一次會把 Word 貼上的間隔變成整頁空白、擠掉後文。
        if (!endsWithNewline()) pushText('\n');
        pendingIndent = 0;
      }
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (BLOCK_TAGS.includes(tag)) {
      ensureBlockBreak();
      paraHadGlyph = false;
      const sm0 = attrs.match(/style\s*=\s*(["'])([\s\S]*?)\1/i);
      pendingIndent = sm0 ? blockIndentSpaces(sm0[2]) : 0;
    }
    const next = { ...cur() };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'u') next.underline = true;
    if (tag === 'mark') next.bg = '#fff59d';
    if (tag === 'li') pushText('• ');
    const sm = attrs.match(/style\s*=\s*(["'])([\s\S]*?)\1/i);
    const style = sm ? sm[2] : '';
    if (styleHasBoxBorder(style)) next.box = true;
    const ff = style.match(/font-family\s*:\s*([^;]+)/i);
    if (ff) {
      next.fontFamily = ff[1]
        .replace(/["']/g, '')
        .split(',')[0]
        .trim();
    }
    const colStyle = style ? parseInlineStyleColor(style) : null;
    const cm = attrs.match(/\bcolor\s*=\s*(["']?)([^"'\s>]+)\1/i);
    const colAttr = cm ? normalizePdfColor(cm[2], null) : null;
    if (colStyle) next.color = colStyle;
    else if (colAttr) next.color = colAttr;
    const bg = parseCssBackground(style, attrs);
    if (bg) next.bg = bg;
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.bold = true;
    if (/text-decoration\s*:[^;]*underline/i.test(style)) next.underline = true;
    stack.push(next);
  }

  // 收尾：去掉首尾多餘換行；空段落最多留一行空白
  for (const r of runs) {
    r.text = String(r.text || '').replace(/\n{3,}/g, '\n\n');
  }
  while (runs.length && !String(runs[0].text).replace(/\n/g, '').trim()) {
    runs.shift();
  }
  while (
    runs.length &&
    !String(runs[runs.length - 1].text).replace(/\n/g, '').trim()
  ) {
    runs.pop();
  }
  if (runs[0]) runs[0].text = String(runs[0].text).replace(/^\n+/, '');
  if (runs.length) {
    runs[runs.length - 1].text = String(runs[runs.length - 1].text).replace(
      /\n+$/,
      ''
    );
  }
  if (!runs.length) return [{ text: '', color: defaultColor }];
  return collapseRunNewlines(runs, 2);
}

/**
 * 跨 run 收斂連續換行（不同 color/font 的空 div 各自帶 \n，不能只在單一 run 內 collapse）
 * maxConsecutive=2 → 段落間最多空一行
 */
function collapseRunNewlines(runs, maxConsecutive = 2) {
  const cap = Math.max(1, Number(maxConsecutive) || 2);
  let streak = 0;
  for (const r of runs || []) {
    let out = '';
    const t = String(r.text || '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '\n') {
        streak += 1;
        if (streak <= cap) out += ch;
      } else {
        streak = 0;
        out += ch;
      }
    }
    r.text = out;
  }
  return (runs || []).filter((r) => String(r.text || '').length);
}

function runsToPlain(runs) {
  return (runs || []).map((r) => r.text || '').join('');
}

/** 依字元區間切片 runs（用於分頁裁切） */
function sliceRichRuns(runs, start, end) {
  const out = [];
  let pos = 0;
  for (const r of runs || []) {
    const t = String(r.text || '');
    const a = pos;
    const b = pos + t.length;
    pos = b;
    if (b <= start || a >= end) continue;
    const from = Math.max(0, start - a);
    const to = Math.min(t.length, end - a);
    if (from < to) {
      out.push({
        text: t.slice(from, to),
        color: r.color,
        bg: r.bg || null,
        bold: r.bold,
        underline: r.underline,
        box: r.box,
      });
    }
  }
  return out.length ? out : [{ text: '', color: '#0f172a' }];
}

/**
 * 繪製多色文字（自動換行；支援中文無空白）
 * @returns {{ height: number, consumed: number }}
 */
function drawColoredRuns(doc, runs, x, y, width, opts = {}) {
  const fontSize = opts.fontSize || 11;
  const lineGap = opts.lineGap != null ? opts.lineGap : 2;
  const useFont = typeof opts.useFont === 'function' ? opts.useFont : () => {};
  const defaultColor = opts.defaultColor || '#0f172a';
  const maxHeight = opts.maxHeight != null ? opts.maxHeight : Infinity;
  const savedBottom = doc.page && doc.page.margins ? doc.page.margins.bottom : null;
  if (doc.page && doc.page.margins) doc.page.margins.bottom = 0;
  useFont();
  doc.fontSize(fontSize);
  const lineH = fontSize * 1.2 + lineGap;
  let cx = x;
  let cy = y;
  let hangX = x;
  let sawGlyph = false;
  let consumed = 0;
  const endY = y + maxHeight;
  const isWs = (ch) => ch === ' ' || ch === '\t' || ch === '\u00a0';
  const finish = (h) => {
    if (savedBottom != null) doc.page.margins.bottom = savedBottom;
    return { height: h, consumed };
  };

  const newline = (keepHang) => {
    cx = keepHang ? hangX : x;
    cy += lineH;
    if (!keepHang) {
      hangX = x;
      sawGlyph = false;
    }
  };

  for (const run of runs || []) {
    const color = run.color || defaultColor;
    const text = String(run.text || '');
    let i = 0;
    while (i < text.length) {
      if (cy + lineH > endY + 0.5) {
        const bottom = sawGlyph ? cy + lineH : cy;
        return finish(Math.max(lineH, bottom - y));
      }
      if (text[i] === '\n') {
        newline(false);
        i += 1;
        consumed += 1;
        continue;
      }
      let space = x + width - cx;
      if (space < fontSize * 0.35) {
        newline(sawGlyph);
        continue;
      }
      let lo = 1;
      let hi = text.length - i;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        let piece = text.slice(i, i + mid);
        const nl = piece.indexOf('\n');
        if (nl >= 0) piece = piece.slice(0, nl);
        if (!piece.length) {
          best = 0;
          break;
        }
        if (doc.widthOfString(piece) <= space + 0.01) {
          best = piece.length;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best <= 0) {
        if (cx > x + 0.5) {
          newline(sawGlyph);
          continue;
        }
        best = 1;
      }
      const drawPiece = text.slice(i, i + best);
      const ww = doc.widthOfString(drawPiece);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(ww)) {
        i += best;
        consumed += best;
        continue;
      }
      const fill = color && /^#[0-9a-f]{6}$/i.test(color) ? color : defaultColor;
      try {
        if (run.bg && ww > 0.3) {
          doc.save();
          doc.rect(cx, cy - 0.5, ww, fontSize * 1.18 + 1).fill(run.bg);
          doc.restore();
        }
        if (run.box && ww > 0.8 && /[^\s]/.test(drawPiece)) {
          doc.save();
          doc
            .rect(cx - 1.2, cy - 1.1, ww + 2.4, fontSize * 1.2 + 2)
            .strokeColor('#111827')
            .lineWidth(0.7)
            .stroke();
          doc.restore();
        }
        doc.fillColor(fill).text(drawPiece, cx, cy, {
          lineBreak: false,
          underline: false,
        });
        if (run.bold) {
          doc.fillColor(fill).text(drawPiece, cx + 0.35, cy, {
            lineBreak: false,
            underline: false,
          });
        }
        if (run.underline && ww > 0.8 && Number.isFinite(cx) && Number.isFinite(cy)) {
          doc
            .moveTo(cx, cy + fontSize + 0.8)
            .lineTo(cx + ww, cy + fontSize + 0.8)
            .strokeColor(fill)
            .lineWidth(0.65)
            .stroke();
        }
      } catch {
        /* skip glyph */
      }
      cx += ww;
      if (!sawGlyph) {
        let g = -1;
        for (let k = 0; k < drawPiece.length; k++) {
          if (!isWs(drawPiece[k])) {
            g = k;
            break;
          }
        }
        if (g >= 0) {
          hangX = cx - ww + doc.widthOfString(drawPiece.slice(0, g));
          sawGlyph = true;
        }
      }
      i += best;
      consumed += best;
    }
  }
  return finish(Math.max(lineH, cy + lineH - y));
}

/** 富文字 HTML → 純文字（PDF 量測／顯示用；保留填寫時的分行） */
function richHtmlToPlain(html) {
  return String(html || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 區塊開始：若前已有字元則先換行（contenteditable 常見：首行裸文字 + 後續 div）
    .replace(/(.)<(div|p|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, '$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[\uF000-\uF8FF]/g, '•')
    // 保留單行換行；僅收斂過多空行
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 以深度掃描切出 HTML 中的 <table>…</table>（支援巢狀 table）
 * @returns {{ start:number, end:number, body:string }[]}
 */
function findHtmlTableRanges(html) {
  const src = String(html || '');
  const lower = src.toLowerCase();
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const start = lower.indexOf('<table', i);
    if (start < 0) break;
    const openGt = src.indexOf('>', start);
    if (openGt < 0) break;
    let depth = 1;
    let pos = openGt + 1;
    let closeAt = -1;
    while (pos < src.length && depth > 0) {
      const nextOpen = lower.indexOf('<table', pos);
      const nextClose = lower.indexOf('</table', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        pos = nextOpen + 6;
      } else {
        depth -= 1;
        if (depth === 0) {
          closeAt = nextClose;
          break;
        }
        pos = nextClose + 7;
      }
    }
    if (closeAt < 0) break;
    const endGt = src.indexOf('>', closeAt);
    if (endGt < 0) break;
    ranges.push({
      start,
      end: endGt + 1,
      body: src.slice(openGt + 1, closeAt),
    });
    i = endGt + 1;
  }
  return ranges;
}

function parseHtmlWidthHint(attrs) {
  const s = String(attrs || '');
  const pt = s.match(/width\s*:\s*([\d.]+)\s*pt/i);
  if (pt) return Number(pt[1]);
  const px = s.match(/width\s*:\s*([\d.]+)\s*px/i);
  if (px) return Number(px[1]) * 0.75;
  const w = s.match(/\bwidth\s*=\s*["']?(\d+)/i);
  if (w) return Number(w[1]) * 0.75;
  return 0;
}

function isPdfNumericCell(s) {
  const t = String(s || '')
    .replace(/[\s元萬]/g, '')
    .replace(/^\$/, '')
    .replace(/%$/, '');
  if (!t || t === '-' || t === '—' || t === '–') {
    return /\$/.test(String(s || ''));
  }
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return true;
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return true;
  return false;
}

/** 日期／短代碼／無空白短字：禁止折行（避免 2026/7/27 拆成兩行） */
function isPdfNoWrapCell(s) {
  if (isPdfNumericCell(s)) return true;
  const t = String(s || '').trim();
  if (!t) return false;
  if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(t)) return true;
  if (/^\d{1,2}月\d{1,2}日$/.test(t)) return true;
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(t)) return true;
  if (!/[\s,，、;；]/.test(t) && t.length <= 48) return true;
  return false;
}

/** Word／Excel 儲存格 HTML 常把金額斷成「$」+ 換行 +「392」；畫表時要壓成一行 */
function flattenTableCellHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '[[BR]]')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\[\[BR\]\]/g, '<br>');
}

function flattenRunsToSingleLine(runs) {
  return (runs || [])
    .map((r) => ({
      ...r,
      text: String(r.text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\t\u00a0 ]+/g, ' '),
    }))
    .filter((r) => String(r.text || '').length);
}

function parseHtmlSpanCount(attrs, name) {
  const m = String(attrs || '').match(
    new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i')
  );
  return m ? Math.min(20, Math.max(1, Number(m[1]) || 1)) : 1;
}

function mergeCovering(t, ri, ci) {
  for (const m of t?.merges || []) {
    const rs = Math.max(1, Number(m.rowspan) || 1);
    const cs = Math.max(1, Number(m.colspan) || 1);
    if (ri >= m.r && ri < m.r + rs && ci >= m.c && ci < m.c + cs) return m;
  }
  return null;
}

function isMergeOrigin(t, ri, ci) {
  const m = mergeCovering(t, ri, ci);
  return m && m.r === ri && m.c === ci ? m : null;
}

function isMergeCovered(t, ri, ci) {
  const m = mergeCovering(t, ri, ci);
  return !!(m && (m.r !== ri || m.c !== ci));
}

function sumRange(arr, start, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += Number(arr[start + i] || 0);
  return s;
}

/** 依 Excel／Word 欄寬或內容估算 PDF 欄寬；有原始寬度時不拉滿整頁 */
function layoutPdfTableColWidths(doc, useFont, t, tableW, fontSize) {
  const cols = Math.max(1, Number(t?.cols) || (t?.cells?.[0] || []).length);
  const minCol = cols >= 8 ? 16 : 20;
  const pad = cols >= 8 ? 6 : 8;
  const size = fontSize || (cols >= 8 ? 8 : 9);
  const hints = Array.isArray(t?.colHints) ? t.colHints.slice(0, cols) : [];
  while (hints.length < cols) hints.push(0);
  const hinted = hints.filter((h) => h > 0);
  let raw;
  let fillToMax = true;
  if (hinted.length >= Math.max(1, Math.ceil(cols * 0.4))) {
    const avg = hinted.reduce((a, b) => a + b, 0) / hinted.length;
    const filled = hints.map((h) => (h > 0 ? h : avg));
    const sum = filled.reduce((a, b) => a + b, 0) || 1;
    if (sum > tableW) {
      raw = filled.map((h) => (h / sum) * tableW);
      fillToMax = true;
    } else {
      raw = filled.slice();
      fillToMax = false;
    }
  } else {
    if (typeof useFont === 'function') useFont();
    doc.fontSize(size);
    raw = [];
    for (let ci = 0; ci < cols; ci++) {
      let need = minCol;
      for (const row of t.cells || []) {
        const s = String((row && row[ci]) || '');
        const w = doc.widthOfString(s) + pad;
        if (w > need) need = w;
      }
      raw.push(Math.min(tableW * 0.28, Math.max(minCol, need)));
    }
  }
  const floors = raw.map((x) => Math.max(minCol, Math.floor(x)));
  const targetW = fillToMax ? tableW : Math.min(tableW, raw.reduce((a, b) => a + b, 0));
  let rem = targetW - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (rem > 0 && fillToMax && k < 400) {
    floors[order[k % cols].i] += 1;
    rem -= 1;
    k += 1;
  }
  while (rem < 0) {
    let widest = 0;
    for (let i = 1; i < cols; i++) {
      if (floors[i] > floors[widest]) widest = i;
    }
    if (floors[widest] <= minCol) break;
    floors[widest] -= 1;
    rem += 1;
  }
  if (fillToMax) {
    const drift = tableW - floors.reduce((a, b) => a + b, 0);
    floors[cols - 1] += drift;
  }
  const minSize = Math.min(6.5, size);
  const nowrapFloor = [];
  if (typeof useFont === 'function') useFont();
  doc.fontSize(minSize);
  for (let ci = 0; ci < cols; ci++) {
    let need = minCol;
    for (let ri = 0; ri < (t.cells || []).length; ri++) {
      if (isMergeCovered(t, ri, ci)) continue;
      const mg = isMergeOrigin(t, ri, ci);
      if (mg && Math.max(1, mg.colspan || 1) > 1) continue;
      const s = String((t.cells[ri] && t.cells[ri][ci]) || '');
      if (!isPdfNoWrapCell(s)) continue;
      const w = doc.widthOfString(s) + (cols >= 8 ? 4 : 6);
      if (w > need) need = w;
    }
    nowrapFloor[ci] = Math.min(tableW * 0.42, Math.ceil(need));
  }
  for (let ci = 0; ci < cols; ci++) {
    if (floors[ci] >= nowrapFloor[ci]) continue;
    let deficit = nowrapFloor[ci] - floors[ci];
    for (let k = 0; k < cols && deficit > 0; k++) {
      if (k === ci) continue;
      const spare = floors[k] - Math.max(minCol, nowrapFloor[k]);
      if (spare <= 0) continue;
      const take = Math.min(spare, deficit);
      floors[k] -= take;
      floors[ci] += take;
      deficit -= take;
    }
  }
  if (fillToMax) {
    const drift2 = tableW - floors.reduce((a, b) => a + b, 0);
    floors[cols - 1] += drift2;
  }
  return floors;
}

function fitPdfCellFont(doc, useFont, text, maxW, startSize, minSize) {
  if (typeof useFont === 'function') useFont();
  let size = startSize;
  doc.fontSize(size);
  const t = String(text || '');
  while (size > minSize && doc.widthOfString(t) > maxW) {
    size -= 0.5;
    doc.fontSize(size);
  }
  return size;
}

/**
 * 找出目前層級的 HTML 標籤，略過巢狀 <table> 內的列／儲存格
 * （Word 貼上常把整份會議紀錄包在單欄大表裡）
 */
function findHtmlElementsTopLevel(html, tags) {
  const src = String(html || '');
  const lower = src.toLowerCase();
  const tagSet = (tags || []).map((t) => String(t).toLowerCase());
  const out = [];
  let i = 0;
  let tableDepth = 0;
  const isOpenTag = (rest, tag) => {
    if (!rest.startsWith('<' + tag)) return false;
    const ch = rest.charAt(tag.length + 1) || '>';
    return ch === '>' || ch === '/' || /\s/.test(ch);
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    const rest = lower.slice(lt);
    if (rest.startsWith('<table') && isOpenTag(rest, 'table')) {
      tableDepth += 1;
      const gt = src.indexOf('>', lt);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (rest.startsWith('</table')) {
      tableDepth = Math.max(0, tableDepth - 1);
      const gt = src.indexOf('>', lt);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (tableDepth > 0) {
      i = lt + 1;
      continue;
    }
    let matched = null;
    for (const tag of tagSet) {
      if (isOpenTag(rest, tag)) {
        matched = tag;
        break;
      }
    }
    if (!matched) {
      i = lt + 1;
      continue;
    }
    const openGt = src.indexOf('>', lt);
    if (openGt < 0) break;
    const attrs = src.slice(lt + matched.length + 1, openGt);
    let depth = 1;
    let innerTable = 0;
    let pos = openGt + 1;
    let closeAt = -1;
    while (pos < src.length && depth > 0) {
      const nlt = src.indexOf('<', pos);
      if (nlt < 0) break;
      const r2 = lower.slice(nlt);
      if (r2.startsWith('<table') && isOpenTag(r2, 'table')) {
        innerTable += 1;
        const gt = src.indexOf('>', nlt);
        pos = gt < 0 ? src.length : gt + 1;
        continue;
      }
      if (r2.startsWith('</table')) {
        innerTable = Math.max(0, innerTable - 1);
        const gt = src.indexOf('>', nlt);
        pos = gt < 0 ? src.length : gt + 1;
        continue;
      }
      if (innerTable > 0) {
        pos = nlt + 1;
        continue;
      }
      if (r2.startsWith('</' + matched)) {
        depth -= 1;
        if (depth === 0) {
          closeAt = nlt;
          break;
        }
        const gt = src.indexOf('>', nlt);
        pos = gt < 0 ? src.length : gt + 1;
        continue;
      }
      if (isOpenTag(r2, matched)) {
        depth += 1;
        const gt = src.indexOf('>', nlt);
        pos = gt < 0 ? src.length : gt + 1;
        continue;
      }
      pos = nlt + 1;
    }
    if (closeAt < 0) break;
    const endGt = src.indexOf('>', closeAt);
    if (endGt < 0) break;
    out.push({
      tag: matched,
      attrs,
      inner: src.slice(openGt + 1, closeAt),
      start: lt,
      end: endGt + 1,
    });
    i = endGt + 1;
  }
  return out;
}

function collectTopLevelTableCells(bodyHtml) {
  const trs = findHtmlElementsTopLevel(bodyHtml, ['tr']);
  const cells = [];
  for (const tr of trs) {
    cells.push(...findHtmlElementsTopLevel(tr.inner, ['td', 'th']));
  }
  return cells;
}

/** Word／Outlook 單欄包版大表：應拆成內文＋內層表格，不可當資料表 */
function isHtmlLayoutWrapperTable(table, bodyHtml) {
  const cells = collectTopLevelTableCells(bodyHtml);
  if (!cells.length) return false;
  const inner = cells.map((c) => c.inner || '').join('');
  if (/<table\b/i.test(inner)) return true;
  const pCount = (inner.match(/<p\b/gi) || []).length;
  if ((table?.cols || 1) === 1 && pCount >= 3) return true;
  const textLen = (table?.cells || []).reduce(
    (n, r) => n + String((r && r[0]) || '').length,
    0
  );
  if ((table?.cols || 1) === 1 && (table?.rows || 0) <= 3 && textLen > 400) {
    return true;
  }
  return false;
}

/**
 * Word 貼上常把 Excel「目標(跨2欄)+成果」拆成 [目標][成果][空]。
 * 若下一列已有 colspan≥3 的群組，把此模式還原成附件原表頭。
 */
function inferExcelHeaderColspans(rawRows) {
  if (!rawRows || rawRows.length < 2) return;
  for (let ri = 0; ri < rawRows.length - 1; ri++) {
    const groups = [];
    let col = 0;
    for (const c of rawRows[ri + 1]) {
      const cs = Math.max(1, c.colspan || 1);
      if (cs >= 3) groups.push({ start: col, span: cs });
      col += cs;
    }
    if (!groups.length) continue;
    const row = rawRows[ri];
    const out = [];
    let cpos = 0;
    let i = 0;
    while (i < row.length) {
      const cs = Math.max(1, row[i].colspan || 1);
      const g = groups.find((x) => x.start === cpos && x.span === 3);
      if (
        g &&
        i + 2 < row.length &&
        Math.max(1, row[i].colspan || 1) === 1 &&
        Math.max(1, row[i + 1].colspan || 1) === 1 &&
        Math.max(1, row[i + 2].colspan || 1) === 1 &&
        String(row[i].text || '').trim() &&
        String(row[i + 1].text || '').trim() &&
        !String(row[i + 2].text || '').trim()
      ) {
        const a = { ...row[i], colspan: 2 };
        a.hint = (Number(row[i].hint) || 0) + (Number(row[i + 1].hint) || 0);
        const b = { ...row[i + 1], colspan: 1 };
        out.push(a, b);
        cpos += 3;
        i += 3;
        continue;
      }
      out.push(row[i]);
      cpos += cs;
      i += 1;
    }
    rawRows[ri] = out;
  }
}

/** 解析單一 table body → { rows, cols, header, cells, merges }（支援 rowspan/colspan） */
function parseTableBodyToStruct(bodyHtml) {
  const body = String(bodyHtml || '');
  const rawRows = [];
  const trs = findHtmlElementsTopLevel(body, ['tr']);
  for (const tr of trs) {
    const cells = [];
    for (const c of findHtmlElementsTopLevel(tr.inner, ['td', 'th'])) {
      const attrs = c.attrs || '';
      const inner = flattenTableCellHtml(c.inner);
      const plain = richHtmlToPlain(inner)
        .replace(/\t/g, ' ')
        .replace(/\n+/g, ' ')
        .replace(/[ \u00a0]+/g, ' ')
        .trim();
      cells.push({
        text: plain,
        colspan: parseHtmlSpanCount(attrs, 'colspan'),
        rowspan: parseHtmlSpanCount(attrs, 'rowspan'),
        hint: parseHtmlWidthHint(attrs),
        isTh: String(c.tag || '').toLowerCase() === 'th',
        html: inner,
        attrs,
      });
    }
    if (cells.length) rawRows.push(cells);
  }
  if (!rawRows.length) return null;
  inferExcelHeaderColspans(rawRows);

  const occupancy = [];
  const grid = [];
  const meta = [];
  const merges = [];
  const firstRowHints = [];

  function ensureRow(r) {
    if (!occupancy[r]) occupancy[r] = [];
    if (!grid[r]) grid[r] = [];
    if (!meta[r]) meta[r] = [];
  }
  function occupied(r, c) {
    ensureRow(r);
    return !!occupancy[r][c];
  }
  function mark(r, c, rs, cs) {
    for (let i = 0; i < rs; i++) {
      ensureRow(r + i);
      for (let j = 0; j < cs; j++) occupancy[r + i][c + j] = true;
    }
  }

  for (let ri = 0; ri < rawRows.length; ri++) {
    ensureRow(ri);
    let col = 0;
    for (const cell of rawRows[ri]) {
      while (occupied(ri, col)) col += 1;
      const cs = cell.colspan;
      const rs = cell.rowspan;
      mark(ri, col, rs, cs);
      while (grid[ri].length < col) grid[ri].push('');
      grid[ri][col] = cell.text;
      meta[ri][col] = {
        bg: parseCssBackground('', cell.attrs),
        color: firstHtmlTextColor(cell.html, cell.attrs),
        bold: /<b\b|<strong\b|font-weight\s*:\s*(bold|[6-9]00)/i.test(
          String(cell.html || '')
        ),
        align: parseHtmlAlign(cell.attrs, cell.html),
        html: cell.html || '',
        fontSize: parseHtmlFontSizePt(cell.html, cell.attrs),
      };
      for (let j = 1; j < cs; j++) {
        if (grid[ri][col + j] == null) grid[ri][col + j] = '';
      }
      if (rs > 1 || cs > 1) {
        merges.push({ r: ri, c: col, rowspan: rs, colspan: cs });
      }
      if (cell.hint > 0) {
        const per = cell.hint / cs;
        for (let j = 0; j < cs; j++) {
          const idx = col + j;
          const prev = firstRowHints[idx] || 0;
          if (!prev || cs === 1) firstRowHints[idx] = per;
        }
      }
      col += cs;
    }
  }

  const occCols = occupancy.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const cols = Math.max(
    1,
    occCols,
    ...grid.map((r) => (r || []).length)
  );
  while (grid.length < occupancy.length) grid.push([]);
  const cells = grid.map((r) => {
    const next = (r || []).slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  const colHints = [];
  const cg = body.match(/<colgroup[\s\S]*?<\/colgroup>/i);
  if (cg) {
    const colRe = /<col\b([^>]*)\/?>/gi;
    let m;
    while ((m = colRe.exec(cg[0]))) colHints.push(parseHtmlWidthHint(m[1]));
  }
  const hints =
    firstRowHints.filter((h) => h > 0).length >= cols * 0.5
      ? firstRowHints
      : colHints;
  while (hints.length < cols) hints.push(0);
  const firstTr = body.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  const cellMeta = cells.map((r, ri) => {
    const row = [];
    for (let ci = 0; ci < cols; ci++) {
      row.push((meta[ri] && meta[ri][ci]) || null);
    }
    return row;
  });
  const hasWordFill = cellMeta.some((r) =>
    (r || []).some((c) => c && c.bg)
  );
  // Word 貼上表格：不要把第一列自動刷成系統表頭底色，只在真正 <th> 才當表頭
  const header = !!(firstTr && /<th\b/i.test(firstTr[1])) && !hasWordFill;
  return {
    rows: cells.length,
    cols,
    header,
    cells,
    cellMeta,
    colHints: hints.slice(0, cols),
    merges,
  };
}

/** 從 HTML 抽出 table → 自繪表格結構（依出現順序） */
function extractHtmlTables(html) {
  return findHtmlTableRanges(html)
    .map((r) => parseTableBodyToStruct(r.body))
    .filter(Boolean);
}

/**
 * 將富文字 HTML 拆成「文字／表格」區塊（維持貼上順序，表格留在說明流內）
 * @returns {{ type:'text'|'table', text?:string, table?:object }[]}
 */
function splitRichHtmlBlocks(html) {
  const src = String(html || '');
  if (!src.trim()) return [{ type: 'text', text: '—', runs: [{ text: '—', color: '#0f172a' }] }];
  const ranges = findHtmlTableRanges(src);
  const pushTextBlock = (htmlSlice) => {
    const runs = parseRichHtmlRuns(htmlSlice);
    const text = runsToPlain(runs).trim();
    if (text) blocks.push({ type: 'text', text, runs });
  };
  if (!ranges.length) {
    const runs = parseRichHtmlRuns(src);
    const t = runsToPlain(runs).trim();
    return [{ type: 'text', text: t || '—', runs }];
  }
  const blocks = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      pushTextBlock(src.slice(cursor, r.start));
    }
    const table = parseTableBodyToStruct(r.body);
    if (isHtmlLayoutWrapperTable(table, r.body)) {
      const topCells = collectTopLevelTableCells(r.body);
      for (const cell of topCells) {
        const innerBlocks = splitRichHtmlBlocks(cell.inner || '');
        for (const b of innerBlocks) blocks.push(b);
      }
    } else if (table) {
      blocks.push({ type: 'table', table });
    }
    cursor = r.end;
  }
  if (cursor < src.length) {
    pushTextBlock(src.slice(cursor));
  }
  if (!blocks.length) {
    const runs = parseRichHtmlRuns(src);
    blocks.push({
      type: 'text',
      text: runsToPlain(runs) || '—',
      runs,
    });
  }
  const meaningful = blocks.filter((b) => {
    if (b.type === 'table') return true;
    return String(b.text || '').replace(/[—\-\s]/g, '').length > 0;
  });
  return meaningful.length ? meaningful : blocks;
}

/** 說明文字（去掉 table 後的純文字） */
function richHtmlBodyPlain(html) {
  let s = String(html || '');
  // 以深度切出的 table 區間移除，避免巢狀誤切
  const ranges = findHtmlTableRanges(s);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    s = s.slice(0, r.start) + '\n' + s.slice(r.end);
  }
  return richHtmlToPlain(s);
}

/** 正規化 form_data 內嵌自繪表格 */
function normalizeEmbeddedTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || !Array.isArray(obj.cells) || !obj.cells.length) return null;
  const cells = obj.cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(1, ...cells.map((r) => r.length));
  const normalized = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  if (!normalized.some((r) => r.some((c) => String(c).trim()))) return null;
  return {
    rows: normalized.length,
    cols,
    header: obj.header !== false,
    cells: normalized,
    cellMeta: Array.isArray(obj.cellMeta) ? obj.cellMeta : [],
    colHints: Array.isArray(obj.colHints) ? obj.colHints.slice(0, cols) : [],
    merges: Array.isArray(obj.merges) ? obj.merges : [],
  };
}

function getFormFieldTable(formData, fieldId) {
  if (!formData || !fieldId) return null;
  return normalizeEmbeddedTable(formData[`${fieldId}__table`]);
}

/**
 * 在 simple-table kit 上繪製內嵌表格（說明欄／貼上表格）
 * opts.hideTitle：不顯示「附表」標題（表格留在說明欄內）
 * opts.inset：左右內縮（貼齊說明內文區）
 * opts.maxRowH：列高上限（預設 200，完整顯示儲存格）
 */
function drawEmbeddedFormTableOnKit(kit, table, opts = {}) {
  const t = normalizeEmbeddedTable(table);
  if (!t || !kit) return;
  const { C, ensureSpace, fillRect, strokeRect } = kit;
  const ctx = opts.ctx;
  if (!ctx) return;
  const { doc, useFont, leftX, contentW } = ctx;
  const inset = Number(opts.inset) || 0;
  const tableX = leftX + inset;
  const tableW = Math.max(40, contentW - inset * 2);
  const cols = t.cols;
  const colWs = layoutPdfTableColWidths(
    doc,
    useFont,
    t,
    tableW,
    cols >= 8 ? 8 : 9.5
  );
  const maxRowH = opts.maxRowH != null ? opts.maxRowH : 200;
  const hideTitle = !!opts.hideTitle || opts.title === '';

  useFont();
  doc.fontSize(9.5);
  const rowHeights = t.cells.map((row) => {
    let maxH = 18;
    for (let i = 0; i < cols; i++) {
      const hh =
        doc.heightOfString(String(row[i] || ' ') || ' ', {
          width: Math.max(12, colWs[i] - 8),
          lineGap: 1,
        }) + 10;
      if (hh > maxH) maxH = hh;
    }
    return Math.min(maxRowH, Math.max(18, maxH));
  });

  if (!hideTitle) {
    ensureSpace(18);
    useFont();
    doc
      .fillColor(C.softInk || C.muted || '#374151')
      .fontSize(9)
      .text(opts.title || '附表', tableX + 2, kit.y, { width: tableW });
    kit.y += 14;
  } else {
    ensureSpace(6);
    kit.y += 4;
  }

  for (let ri = 0; ri < t.cells.length; ri++) {
    const h = rowHeights[ri];
    ensureSpace(h + 2);
    const y0 = kit.y;
    fillRect(
      tableX,
      y0,
      tableW,
      h,
      ri === 0 && t.header ? C.sectionBg || C.labelBg : C.cellBg || C.white
    );
    // 列外框（加強）
    strokeRect(tableX, y0, tableW, h, C.lineDark || '#334155', 1.15);
    let x = tableX;
    for (let ci = 0; ci < cols; ci++) {
      if (ci > 0) {
        // 直向內框線（加強）
        doc
          .moveTo(x, y0)
          .lineTo(x, y0 + h)
          .strokeColor(C.lineDark || '#334155')
          .lineWidth(1.0)
          .stroke();
      }
      const cell = String(t.cells[ri][ci] || '');
      const isHead = t.header && ri === 0;
      useFont();
      doc
        .fillColor(isHead ? C.header || C.softInk : C.ink)
        .fontSize(isHead ? 9.5 : 9)
        .text(cell, x + 4, y0 + 5, {
          width: colWs[ci] - 8,
          height: h - 8,
          lineGap: 1,
          align: isHead ? 'center' : 'left',
        });
      x += colWs[ci];
    }
    kit.y = y0 + h;
  }
  kit.y += 6;
}

/**
 * 在「說明」欄內繪製富文字：
 * ┌─ 說　　明 ─────────────────┐  ← 標題列
 * │  前文文字…                  │
 * │   ┌────┬────┬────┐         │  ← 框內「獨立表格」（有自己的格線）
 * │   │    │    │    │         │
 * │   └────┴────┴────┘         │
 * │  後文文字…                  │
 * └────────────────────────────┘  ← 單一說明外框（不被表格切成兩段）
 */
function drawRichContentInExplainSection(kit, ctx, html, opts = {}) {
  if (!kit || !ctx) return;
  const { C, ensureSpace, fillRect, strokeRect, textMid } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const secH = 26;
  const padX = 12;
  const padY = 10;
  const textW = contentW - padX * 2;
  const bodyFontSize = opts.fontSize || 11;
  const lineGap = 2;
  const safety = 6;
  const tableInset = 16;
  const pageBottom = () => ctx.pageH - ctx.margin - 20;
  const sectionTitle = opts.sectionTitle || '說　　明';
  // 說明外框用中灰；表格內框線用更深、更粗，獨立清楚
  const lineColor = C.lineDark || C.line || '#475569';
  const tableLine = '#1e293b';
  const tableInnerW = 1.15;
  const tableOuterW = 1.35;
  const ink = C.ink || '#0f172a';

  const blocks = splitRichHtmlBlocks(html);
  const legacy = normalizeEmbeddedTable(opts.legacyTable);
  if (legacy) blocks.push({ type: 'table', table: legacy });
  if (!blocks.length) blocks.push({ type: 'text', text: '—' });

  /** 本頁說明「內容區」頂端（標題列下方），結束時畫一次完整外框 */
  let contentTop = null;

  function drawHeader(continued) {
    ensureSpace(secH + 60);
    fillRect(leftX, kit.y, contentW, secH, C.sectionBg);
    strokeRect(leftX, kit.y, contentW, secH, lineColor, 0.7);
    const contTitle = /（續）\s*$/.test(sectionTitle)
      ? sectionTitle
      : `${sectionTitle}（續）`;
    textMid(
      continued ? contTitle : sectionTitle,
      leftX + 10,
      kit.y,
      contentW - 20,
      secH,
      { size: continued ? 11 : 12, color: C.header }
    );
    kit.y += secH;
    contentTop = kit.y;
  }

  function strokeContentFrame() {
    if (contentTop == null) return;
    const h = Math.max(18, kit.y - contentTop);
    // 只描邊，不填色（避免蓋住文字／表格）
    strokeRect(leftX, contentTop, contentW, h, lineColor, 0.7);
    contentTop = null;
  }

  function newPage() {
    strokeContentFrame();
    doc.addPage();
    kit.y = ctx.margin;
    drawHeader(true);
    kit.y += padY;
  }

  function textHeight(str) {
    useFont();
    doc.fontSize(bodyFontSize);
    return (
      doc.heightOfString(String(str || ' '), { width: textW, lineGap }) + safety
    );
  }

  function fitText(text, availInnerH) {
    useFont();
    doc.fontSize(bodyFontSize);
    if (textHeight(text) <= availInnerH) return { chunk: text, rest: '' };
    let lo = 0;
    let hi = text.length;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      let cut = mid;
      if (cut > 0 && cut < text.length) {
        const slice = text.slice(0, cut);
        const breakAt = Math.max(
          slice.lastIndexOf('\n'),
          slice.lastIndexOf('。'),
          slice.lastIndexOf('；'),
          slice.lastIndexOf('，'),
          slice.lastIndexOf('、'),
          slice.lastIndexOf(' ')
        );
        if (breakAt > cut * 0.45) cut = breakAt + 1;
      }
      cut = Math.max(1, cut);
      if (textHeight(text.slice(0, cut)) <= availInnerH) {
        best = cut;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best <= 0) best = Math.min(40, text.length);
    return {
      chunk: text.slice(0, best),
      rest: text.slice(best).replace(/^\n+/, ''),
    };
  }

  function tableFontSize(t) {
    const sizes = [];
    for (const row of t?.cellMeta || []) {
      for (const c of row || []) {
        if (c && c.fontSize) sizes.push(c.fontSize);
      }
    }
    if (sizes.length) {
      sizes.sort((a, b) => a - b);
      return sizes[Math.floor(sizes.length / 2)];
    }
    return t && t.cols >= 8 ? 8 : 9;
  }

  function tableColWidths(t) {
    const maxW = Math.max(40, contentW - tableInset * 2);
    const cols = t && typeof t === 'object' ? t.cols : Number(t) || 1;
    const struct =
      t && typeof t === 'object' && Array.isArray(t.cells)
        ? t
        : { cols, cells: [], colHints: [] };
    const colWs = layoutPdfTableColWidths(
      doc,
      useFont,
      struct,
      maxW,
      tableFontSize(struct)
    );
    const tableW = Math.max(
      40,
      Math.min(
        maxW,
        colWs.reduce((a, b) => a + b, 0)
      )
    );
    return { tableW, colWs };
  }

  function rowHeightsOf(t) {
    const { colWs } = tableColWidths(t);
    const size = tableFontSize(t);
    useFont();
    doc.fontSize(size);
    const minH = t.cols >= 8 ? 16 : 20;
    const heights = t.cells.map((row, ri) => {
      let maxH = minH;
      for (let i = 0; i < t.cols; i++) {
        if (isMergeCovered(t, ri, i)) continue;
        const m = isMergeOrigin(t, ri, i);
        const spanC = m ? Math.max(1, m.colspan || 1) : 1;
        const spanR = m ? Math.max(1, m.rowspan || 1) : 1;
        const cell = String(row[i] || ' ') || ' ';
        const nowrap =
          isPdfNoWrapCell(cell) || (t.header && ri === 0 && isPdfNoWrapCell(cell));
        const cellW = Math.max(12, sumRange(colWs, i, spanC) - 6);
        const hh = nowrap
          ? size + 8
          : doc.heightOfString(cell, {
              width: cellW,
              lineGap: 0.5,
            }) + 8;
        const perRow = spanR > 1 ? Math.max(minH, Math.ceil(hh / spanR)) : hh;
        if (perRow > maxH) maxH = perRow;
      }
      return Math.min(160, Math.max(minH, maxH));
    });
    return heights;
  }

  function measureTableHeight(table) {
    const t = normalizeEmbeddedTable(table);
    if (!t) return 0;
    const rhs = rowHeightsOf(t);
    return 12 + rhs.reduce((a, b) => a + b, 0) + 10;
  }

  /**
   * 在說明框「內部」畫獨立表格（完整格線，左右內縮）
   * 盡量整表同一頁；若頁高不足才從列中間換頁（續頁仍在說明框內）
   */
  function drawIndepTable(table) {
    const t = normalizeEmbeddedTable(table);
    if (!t) return;
    const { tableW, colWs } = tableColWidths(t);
    const size = tableFontSize(t);
    const tableX = leftX + tableInset;
    const rhs = rowHeightsOf(t);
    const totalH = rhs.reduce((a, b) => a + b, 0);

    // 整表放得下就換頁後一次畫完，避免「說明被切兩段」的感覺
    const avail = pageBottom() - kit.y - padY;
    if (totalH + 12 > avail && totalH + 12 < pageBottom() - ctx.margin - secH - padY * 2 - 20) {
      // 下一頁放得下整表
      newPage();
    } else if (avail < 50) {
      newPage();
    }

    kit.y += 6;
    let segTop = kit.y; // 本頁表格區段頂端（換頁會重設）
    let segRows = [];

    function strokeTableSegment() {
      if (kit.y <= segTop) return;
      strokeRect(
        tableX,
        segTop,
        tableW,
        kit.y - segTop,
        tableLine,
        tableOuterW
      );
    }

    /** 填色之後再畫格線，避免下一列底色蓋掉橫線／直線 */
    function strokeGridSegment() {
      if (!segRows.length) return;
      const vline = (x, y1, y2) => {
        if (y2 <= y1) return;
        doc
          .moveTo(x, y1)
          .lineTo(x, y2)
          .strokeColor(tableLine)
          .lineWidth(tableInnerW)
          .stroke();
      };
      const hline = (x1, x2, y) => {
        if (x2 <= x1) return;
        doc
          .moveTo(x1, y)
          .lineTo(x2, y)
          .strokeColor(tableLine)
          .lineWidth(tableInnerW)
          .stroke();
      };
      const colX = [tableX];
      for (let i = 0; i < t.cols; i++) colX.push(colX[i] + colWs[i]);
      for (const r of segRows) {
        for (let ci = 0; ci <= t.cols; ci++) {
          if (ci > 0 && ci < t.cols) {
            const left = mergeCovering(t, r.ri, ci - 1);
            const spanC = left ? Math.max(1, left.colspan || 1) : 1;
            if (left && ci > left.c && ci < left.c + spanC) continue;
          }
          vline(colX[ci], r.y0, r.y0 + r.h);
        }
      }
      for (const r of segRows) {
        for (let ci = 0; ci < t.cols; ci++) {
          const m = mergeCovering(t, r.ri, ci);
          if (m && r.ri > m.r) continue;
          hline(colX[ci], colX[ci + 1], r.y0);
        }
      }
      const last = segRows[segRows.length - 1];
      for (let ci = 0; ci < t.cols; ci++) {
        hline(colX[ci], colX[ci + 1], last.y0 + last.h);
      }
    }

    for (let ri = 0; ri < t.cells.length; ri++) {
      const h = rhs[ri];
      let need = h;
      for (let ci = 0; ci < t.cols; ci++) {
        const om = isMergeOrigin(t, ri, ci);
        if (om && (om.rowspan || 1) > 1) {
          need = Math.max(need, sumRange(rhs, ri, om.rowspan || 1));
        }
      }
      if (pageBottom() - kit.y < need + 2) {
        strokeGridSegment();
        strokeTableSegment();
        newPage();
        kit.y += 6;
        segTop = kit.y;
        segRows = [];
      }
      const y0 = kit.y;
      const isHead = t.header && ri === 0;
      const hasWordFill = (t.cellMeta || []).some((r) =>
        (r || []).some((c) => c && c.bg)
      );
      if (!hasWordFill) {
        fillRect(
          tableX,
          y0,
          tableW,
          h,
          isHead ? C.sectionBg || '#e2e8f0' : '#ffffff'
        );
      }
      let x = tableX;
      for (let ci = 0; ci < t.cols; ci++) {
        const covered = isMergeCovered(t, ri, ci);
        const meta = (t.cellMeta && t.cellMeta[ri] && t.cellMeta[ri][ci]) || {};
        if (!covered) {
          const m = isMergeOrigin(t, ri, ci);
          const spanC = m ? Math.max(1, m.colspan || 1) : 1;
          const spanR = m ? Math.max(1, m.rowspan || 1) : 1;
          const cellWfull = sumRange(colWs, ci, spanC);
          const cellH = sumRange(rhs, ri, spanR);
          const bg = meta.bg || (hasWordFill ? '#ffffff' : null);
          if (bg) fillRect(x, y0, cellWfull, cellH, bg);
        }
        if (!covered) {
          const m = isMergeOrigin(t, ri, ci);
          const spanC = m ? Math.max(1, m.colspan || 1) : 1;
          const spanR = m ? Math.max(1, m.rowspan || 1) : 1;
          const cellText = String(t.cells[ri][ci] || '')
            .replace(/\s+/g, ' ')
            .trim();
          const numeric = isPdfNumericCell(cellText) && !isHead;
          const nowrap = isPdfNoWrapCell(cellText) || (isHead && !hasWordFill);
          const cellW = Math.max(8, sumRange(colWs, ci, spanC) - 6);
          const cellH = sumRange(rhs, ri, spanR);
          const startSize =
            meta.fontSize ||
            (isHead && !hasWordFill ? Math.min(8.5, size + 0.5) : size);
          const usedSize =
            numeric || nowrap
              ? fitPdfCellFont(doc, useFont, cellText, cellW, startSize, 5.5)
              : startSize;
          const textColor =
            meta.color || (isHead && !hasWordFill ? C.header || '#1e3a5f' : ink);
          const align =
            meta.align ||
            (isHead || spanC > 1 ? 'center' : numeric ? 'right' : 'left');
          useFont();
          const tx = x + 3;
          const ty = y0 + Math.max(3, (Math.min(h, cellH) - usedSize) / 2 - 1);
          const richHtml = flattenTableCellHtml(meta.html || '');
          const richMarks =
            richHtml &&
            /color:|background|<b|<strong|<u\b|wingdings/i.test(richHtml);
          const mixedColor =
            richHtml &&
            /#9[Cc]0006|#fff|#ffffff|rgb\(\s*156/i.test(richHtml) &&
            /color:\s*(black|#000|#111|windowtext)/i.test(richHtml);
          if (richMarks && mixedColor) {
            const runs = flattenRunsToSingleLine(
              parseRichHtmlRuns(richHtml, textColor)
            ).filter((r) => String(r.text || '').replace(/[\s\u3000]/g, ''));
            if (runs.length) {
              drawColoredRuns(doc, runs, tx, ty, cellW, {
                fontSize: usedSize,
                lineGap: 0.3,
                useFont,
                defaultColor: textColor,
                maxHeight: Math.max(8, cellH - 4),
              });
            }
          } else if (cellText) {
            doc
              .fillColor(textColor)
              .fontSize(usedSize)
              .text(cellText, tx, ty, {
                width: cellW,
                height: Math.max(8, cellH - 4),
                lineGap: 0.4,
                align,
                lineBreak: !(numeric || nowrap),
              });
            if (meta.bold) {
              doc.fillColor(textColor).text(cellText, tx + 0.35, ty, {
                width: cellW,
                height: Math.max(8, cellH - 4),
                lineGap: 0.4,
                align,
                lineBreak: !(numeric || nowrap),
              });
            }
          }
        }
        x += colWs[ci];
      }
      segRows.push({ ri, y0, h });
      kit.y = y0 + h;
    }
    strokeGridSegment();
    // 本頁獨立表格外框（完整四邊，比內框略粗）
    strokeTableSegment();
    kit.y += 10;
  }

  function drawTextInside(text, runsIn) {
    const runs0 =
      Array.isArray(runsIn) && runsIn.length
        ? runsIn
        : parseRichHtmlRuns(text || '—', ink);
    let plain = runsToPlain(runs0);
    if (!String(plain || '').trim()) return;
    let offset = 0;
    let guard = 0;
    const lineH = bodyFontSize * 1.2 + lineGap;
    const minAvail = lineH + 4;
    while (offset < plain.length && guard++ < 200) {
      let avail = pageBottom() - kit.y - padY;
      if (avail < minAvail) {
        newPage();
        avail = pageBottom() - kit.y - padY;
      }
      const chunkRuns = sliceRichRuns(runs0, offset, plain.length);
      const painted = drawColoredRuns(doc, chunkRuns, leftX + padX, kit.y, textW, {
        fontSize: bodyFontSize,
        lineGap,
        useFont,
        defaultColor: ink,
        maxHeight: avail,
      });
      const th = painted && painted.height != null ? painted.height : textHeight(' ');
      const consumed = painted && painted.consumed != null ? painted.consumed : 0;
      kit.y += th;
      if (consumed <= 0) {
        newPage();
        continue;
      }
      offset += consumed;
      while (offset < plain.length && plain[offset] === '\n') offset += 1;
      if (offset < plain.length) newPage();
    }
  }

  // ===== 開始 =====
  drawHeader(false);
  kit.y += padY;

  for (const block of blocks) {
    if (block.type === 'table' && block.table) {
      drawIndepTable(block.table);
    } else {
      drawTextInside(block.text || '—', block.runs);
    }
  }

  kit.y += padY;
  // 最後畫「單一」說明內容外框（文字+表格都在框內）
  strokeContentFrame();
  kit.y += 10;
}

/**
 * 在欄位值之後、同一區塊內繪製 HTML 表格（不另標附表）
 * @param {string} [rawOverride] 若欄位 id 不確定，可直接傳已取得的 HTML 字串
 */
function appendFieldTable(kit, ctx, formData, fieldId, title, rawOverride) {
  if (!kit || !formData) return;
  const hideTitle = title === '' || title == null;
  const t = getFormFieldTable(formData, fieldId);
  if (t) {
    kit.drawEmbeddedFormTable(t, {
      title: hideTitle ? '' : title || '附表',
      hideTitle,
    });
  }
  const raw =
    rawOverride != null
      ? rawOverride
      : formData[fieldId] != null
        ? formData[fieldId]
        : null;
  if (typeof raw === 'string' && /<table/i.test(raw)) {
    extractHtmlTables(raw).forEach((tbl, idx) => {
      kit.drawEmbeddedFormTable(tbl, {
        title: hideTitle
          ? ''
          : idx > 0
            ? `${title || '附表'} ${idx + 1}`
            : title || '附表',
        hideTitle,
      });
    });
  }
  // 若指定 fieldId 無表格，掃其他字串欄位中含 table 且尚未畫過的（避免漏掉動態 id）
  if (
    typeof raw !== 'string' ||
    !/<table/i.test(raw)
  ) {
    // no-op：由呼叫端傳 rawOverride 即可
  }
}

/**
 * 從任意字串（欄位值）抽出並繪製表格，留在當前欄位流內
 */
function drawInlineHtmlTablesFromValue(kit, ctx, value, opts = {}) {
  if (!kit || value == null) return;
  if (typeof value === 'object' && Array.isArray(value.cells)) {
    kit.drawEmbeddedFormTable(value, {
      title: '',
      hideTitle: true,
      inset: opts.inset || 0,
    });
    return;
  }
  if (typeof value !== 'string' || !/<table/i.test(value)) return;
  extractHtmlTables(value).forEach((tbl) => {
    kit.drawEmbeddedFormTable(tbl, {
      title: '',
      hideTitle: true,
      inset: opts.inset || 0,
      maxRowH: opts.maxRowH || 220,
    });
  });
}

/**
 * 金額顯示（元，只一種格式）：
 * - 未滿 10 萬：12,406 元
 * - ≥ 10 萬：100萬1000元（整萬則 25萬元）
 */
function formatYuanWanStyle(val) {
  if (val == null || val === '') return '—';
  const raw = String(val).replace(/[,，\s元萬]/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(val);
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  const sign = neg ? '-' : '';
  if (abs < 100000) {
    return `${sign}${abs.toLocaleString('zh-TW')} 元`;
  }
  const wan = Math.floor(abs / 10000);
  const rest = abs % 10000;
  if (rest === 0) return `${sign}${wan}萬元`;
  return `${sign}${wan}萬${rest}元`;
}

function isForeignCurrency(cur) {
  const s = String(cur || '').trim().toUpperCase();
  if (!s) return false;
  return !/^(NTD|TWD|NT\$|NTD\$|新台幣|新臺幣|台幣|臺幣)$/.test(s);
}

/** 外幣金額：最多小數 4 位（不走萬元整數） */
function formatForeignAmount(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n)) return String(val);
  const rounded = Math.round(n * 10000) / 10000;
  return rounded.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatMoneyByCurrency(val, currency) {
  if (isForeignCurrency(currency)) {
    const t = formatForeignAmount(val);
    return t === '—' ? t : `${t} ${String(currency).trim()}`.trim();
  }
  return formatYuanWanStyle(val);
}

/** 金額顯示（相容舊呼叫；改採「萬元」混合格式） */
function formatMoney(val) {
  return formatYuanWanStyle(val);
}

/** 西元日期時間 → 民國年、月、日、時、分 */
function toRocParts(val) {
  if (val == null || val === '') {
    return { y: '', m: '', d: '', hh: '', mm: '', text: '—' };
  }
  const s = String(val).trim().replace(' ', 'T');
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/
  );
  if (!m) {
    return { y: '', m: '', d: '', hh: '', mm: '', text: String(val) };
  }
  const adY = Number(m[1]);
  const rocY = adY >= 1911 ? adY - 1911 : adY;
  return {
    y: String(rocY),
    m: String(Number(m[2])),
    d: String(Number(m[3])),
    hh: m[4] != null ? m[4] : '',
    mm: m[5] != null ? m[5] : '',
    text: `${rocY}/${Number(m[2])}/${Number(m[3])}${
      m[4] != null ? ` ${m[4]}:${m[5] || '00'}` : ''
    }`,
  };
}

function formFieldByLabel(formFields, re) {
  return (formFields || []).find((f) => re.test(String(f.label || '')));
}

function pickFormValue(formData, formFields, ids, labelRe) {
  const data = formData || {};
  for (const id of ids || []) {
    if (data[`${id}__label`]) return data[`${id}__label`];
    if (data[`${id}__name`]) return data[`${id}__name`];
    if (data[id] != null && data[id] !== '') return data[id];
  }
  if (labelRe) {
    const f = formFieldByLabel(formFields, labelRe);
    if (f) {
      if (data[`${f.id}__label`]) return data[`${f.id}__label`];
      if (data[`${f.id}__name`]) return data[`${f.id}__name`];
      if (data[f.id] != null && data[f.id] !== '') return data[f.id];
    }
  }
  return '';
}

/** 從簽核歷程取某步驟核准人（多人則以、串接）；matcher 可為 RegExp 或 (stepName)=>boolean */
function actorsForStep(actions, matcher) {
  const match =
    typeof matcher === 'function'
      ? matcher
      : (name) => matcher.test(String(name || ''));
  const list = (actions || []).filter(
    (a) => a.action === 'approve' && match(String(a.step_name || ''))
  );
  if (!list.length) return { names: '', times: '' };
  const names = [...new Set(list.map((a) => a.actor_name).filter(Boolean))];
  const times = list
    .map((a) => {
      const t = String(a.created_at || '');
      return t.replace('T', ' ').slice(0, 16);
    })
    .filter(Boolean);
  return {
    names: names.join('、'),
    times: times[times.length - 1] || '',
  };
}

function flattenApproverData(ad) {
  const flat = {};
  const src = ad || {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  return flat;
}

/**
 * 請假單專用版面（參考紙本 HR 請假單，表格優化美化）
 */
function drawLeaveForm(ctx, request) {
  const { doc, useFont, leftX, contentW, pageH, margin } = ctx;
  let y = margin;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data);

  // 請假單：青綠系（與其他申請單區隔）
  const T = FORM_UI_THEMES.leave;
  const C = {
    ink: '#0f172a',
    softInk: T.softInk,
    muted: '#64748b',
    line: T.line,
    lineDark: T.lineDark,
    softLine: T.softLine,
    header: T.header,
    headerDark: T.softInk,
    headerSoft: T.headerSoft,
    labelBg: T.labelBg,
    noticeBg: '#fffbeb',
    noticeBorder: '#f59e0b',
    white: '#ffffff',
    cellBg: '#ffffff',
    altBg: T.altBg,
    totalBg: T.headerSoft,
  };

  // 統一欄寬格線（整表外框一次描，內線對齊）
  const LW = 70; // 左側標籤寬
  const FS_LABEL = 10.5;
  const FS_VALUE = 11.5;
  const FS_SMALL = 9.5;

  function ensureSpace(need) {
    if (y + need > pageH - margin - 18) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  }

  function strokeRect(x, yy, w, h, color, width) {
    doc
      .rect(x, yy, w, h)
      .strokeColor(color || C.line)
      .lineWidth(width || 0.7)
      .stroke();
  }

  function fillRect(x, yy, w, h, color) {
    doc.rect(x, yy, w, h).fill(color);
  }

  function textAt(str, x, yy, w, opts = {}) {
    useFont();
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(opts.size || FS_VALUE)
      .text(String(str ?? ''), x, yy, {
        width: w,
        align: opts.align || 'left',
        lineBreak: opts.lineBreak !== false,
      });
  }

  /** 垂直置中單行文字 */
  function textMid(str, x, yy, w, h, opts = {}) {
    useFont();
    const size = opts.size || FS_VALUE;
    const approx = size * 0.9;
    const ty = yy + Math.max(4, (h - approx) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(String(str ?? ''), x, ty, {
        width: w,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /**
   * 單行文字自動縮放以符合寬度（不換行、不分段）
   * @param {string} str
   * @param {number} x
   * @param {number} yy 列頂
   * @param {number} w 可用寬度
   * @param {number} h 列高
   * @param {{ maxSize?: number, minSize?: number, color?: string, align?: string }} opts
   */
  function textFitOneLine(str, x, yy, w, h, opts = {}) {
    useFont();
    const text = String(str ?? '');
    const maxSize = opts.maxSize != null ? opts.maxSize : FS_VALUE;
    const minSize = opts.minSize != null ? opts.minSize : 7;
    let size = maxSize;
    const maxW = Math.max(8, w);
    while (size > minSize) {
      doc.fontSize(size);
      const tw = doc.widthOfString(text);
      if (tw <= maxW) break;
      size -= 0.5;
    }
    doc.fontSize(size);
    // 仍超寬時截斷尾端加 …
    let draw = text;
    let tw = doc.widthOfString(draw);
    if (tw > maxW && draw.length > 1) {
      while (draw.length > 1 && doc.widthOfString(draw + '…') > maxW) {
        draw = draw.slice(0, -1);
      }
      draw = draw + '…';
    }
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(draw, x, ty, {
        width: maxW,
        align: opts.align || 'left',
        lineBreak: false,
        ellipsis: false,
      });
  }

  /**
   * 畫一列表格列：cells = [{ w, label?, value, labelW?, bg?, labelBg?, align? }]
   * 同一列高度 h，外框 + 內部分隔線
   */
  function drawRow(cells, h, opts = {}) {
    ensureSpace(h + 1);
    const lineW = opts.lineW || 0.65;
    let x = leftX;
    // 底
    fillRect(leftX, y, contentW, h, opts.bg || C.cellBg);
    for (const c of cells) {
      const lw = c.label != null ? c.labelW || LW : 0;
      if (c.label != null) {
        fillRect(x, y, lw, h, c.labelBg || C.labelBg);
      }
      if (c.bg) fillRect(x + lw, y, c.w - lw, h, c.bg);
      x += c.w;
    }
    // 外框
    strokeRect(leftX, y, contentW, h, C.lineDark, lineW);
    // 內線與文字
    x = leftX;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const lw = c.label != null ? c.labelW || LW : 0;
      if (i > 0) {
        doc
          .moveTo(x, y)
          .lineTo(x, y + h)
          .strokeColor(C.line)
          .lineWidth(lineW)
          .stroke();
      }
      if (c.label != null) {
        doc
          .moveTo(x + lw, y)
          .lineTo(x + lw, y + h)
          .strokeColor(C.line)
          .lineWidth(lineW)
          .stroke();
        textMid(c.label, x + 3, y, lw - 6, h, {
          size: FS_LABEL,
          color: C.softInk,
          align: 'center',
        });
        if (c.multi) {
          drawRichOrPlainText(
            doc,
            useFont,
            c.html != null ? c.html : c.value || '—',
            x + lw + 8,
            y + 7,
            c.w - lw - 14,
            Math.max(10, h - 14),
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              lineGap: 2,
            }
          );
        } else {
          textMid(
            looksLikeRichHtml(c.value) ? richHtmlToPlain(c.value) : c.value || '—',
            x + lw + 8,
            y,
            c.w - lw - 14,
            h,
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              align: c.align || 'left',
            }
          );
        }
      } else if (c.value != null || c.html != null) {
        if (c.multi) {
          drawRichOrPlainText(
            doc,
            useFont,
            c.html != null ? c.html : c.value || '—',
            x + 8,
            y + 7,
            c.w - 14,
            Math.max(10, h - 14),
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              lineGap: 2,
            }
          );
        } else {
          textMid(
            looksLikeRichHtml(c.value) ? richHtmlToPlain(c.value) : c.value,
            x + 6,
            y,
            c.w - 12,
            h,
            {
              size: c.valueSize || FS_VALUE,
              color: c.valueColor || C.ink,
              align: c.align || 'left',
            }
          );
        }
      }
      x += c.w;
    }
    y += h;
  }

  // ========== 取值 ==========
  // 代理人：優先顯示姓名（部門改放在「單位」欄，避免重複）
  const agentRaw =
    formData.agent__name ||
    pickFormValue(formData, formFields, ['agent'], /代理/) ||
    '';
  const agent = String(agentRaw)
    .replace(/（[^）]*）\s*$/g, '')
    .replace(/\([^)]*\)\s*$/g, '')
    .trim() || '—';
  // 單位欄：申請人部門
  const unitDept =
    (request.requester_dept && String(request.requester_dept).trim()) ||
    (request.department && String(request.department).trim()) ||
    (formData.department && String(formData.department).trim()) ||
    (formData.unit && String(formData.unit).trim()) ||
    '';
  const leaveType =
    pickFormValue(formData, formFields, ['leave_type'], /假別/) || '—';
  const reason =
    pickFormValue(formData, formFields, ['reason'], /事由/) ||
    request.title ||
    '—';
  const handover =
    pickFormValue(
      formData,
      formFields,
      ['handover', 'hand_over', '交接事項'],
      /交接/
    ) || '';
  const days = formData.days != null && formData.days !== '' ? formData.days : '';
  const hours =
    formData.hours != null && formData.hours !== '' ? formData.hours : '';
  const startP = toRocParts(formData.start_date);
  const endP = toRocParts(formData.end_date);
  // 特休以日為準，不顯示小時換算
  const leaveIsSpecial = isSpecialLeaveTypePdf(leaveType);
  const leaveIsPersonal = isPersonalLeaveTypePdf(leaveType);
  const leaveIsSick = isSickLeaveTypePdf(leaveType);
  const personalTotalText = leaveIsPersonal
    ? formatPersonalLeavePdfTotal(formData)
    : null;
  const sickTotalText = leaveIsSick ? formatSickLeavePdfTotal(formData) : null;
  const totalText = personalTotalText
    ? personalTotalText
    : sickTotalText
    ? sickTotalText
    : leaveIsSpecial
    ? days !== '' && days != null
      ? `${days} 天`
      : '—'
    : [
        days !== '' && days != null ? `${days} 天` : '',
        hours !== '' && hours != null ? `${hours} 時` : '',
      ]
        .filter(Boolean)
        .join('　') || '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  // 請假期間文字（精簡、易讀）
  const fmtPeriodLine = (p, prefix, suffix) => {
    if (!p || p.y === '') return `${prefix}　—　${suffix}`;
    const hm =
      p.hh !== ''
        ? ` ${p.hh}:${(p.mm || '00').padStart(2, '0')}`
        : '';
    return `${prefix} 民國${p.y}年${p.m}月${p.d}日${hm} ${suffix}`;
  };

  // ========== 抬頭（僅中文公司名） ==========
  const headH = 72;
  // 頂部主色條
  fillRect(leftX, y, contentW, 4, C.header);
  fillRect(leftX, y + 4, contentW, headH - 4, C.headerSoft);
  strokeRect(leftX, y, contentW, headH, C.header, 1.1);

  useFont();
  doc
    .fillColor(C.headerDark)
    .fontSize(13)
    .text(getCompanyNameForPdf(), leftX, y + 14, {
      width: contentW,
      align: 'center',
    });
  // 底線分隔
  doc
    .moveTo(leftX + contentW * 0.28, y + 34)
    .lineTo(leftX + contentW * 0.72, y + 34)
    .strokeColor(C.header)
    .lineWidth(0.8)
    .stroke();
  doc
    .fillColor(C.headerDark)
    .fontSize(22)
    .text('請　假　單', leftX, y + 40, {
      width: contentW,
      align: 'center',
    });
  y += headH + 6;

  // 申請日／單號（單行資訊列）
  const metaH = 22;
  fillRect(leftX, y, contentW, metaH, C.altBg);
  strokeRect(leftX, y, contentW, metaH, C.softLine, 0.5);
  textMid(
    `申請日：${applyDateText}`,
    leftX + 10,
    y,
    contentW * 0.55,
    metaH,
    { size: FS_SMALL, color: C.softInk }
  );
  textMid(
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`,
    leftX + contentW * 0.45,
    y,
    contentW * 0.55 - 10,
    metaH,
    { size: FS_SMALL, color: C.muted, align: 'right' }
  );
  y += metaH + 8;

  // ========== 主表：統一格線 ==========
  // 第1列：申請人 | 單位（部門）| 職務代理人
  const colApplicant = Math.floor(contentW * 0.30);
  const colUnit = Math.floor(contentW * 0.30);
  const colAgent = contentW - colApplicant - colUnit;
  useFont();
  doc.fontSize(FS_VALUE);
  const row1H = Math.max(
    32,
    doc.heightOfString(String(agent), { width: colAgent - 78 - 12 }) + 14,
    doc.heightOfString(String(unitDept || '—'), {
      width: colUnit - 56 - 12,
    }) + 14
  );
  drawRow(
    [
      {
        w: colApplicant,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 52,
      },
      {
        w: colUnit,
        // 紙本「單位」欄：填入申請人部門
        label: '單位',
        value: unitDept || '—',
        labelW: 48,
        multi: String(unitDept || '').length > 8,
      },
      {
        w: colAgent,
        label: '職務代理人',
        value: agent,
        labelW: 72,
        multi: String(agent).length > 6,
      },
    ],
    row1H
  );

  // 第2列：假別 + 事由
  const leaveCol = Math.floor(contentW * 0.38);
  const reasonCol = contentW - leaveCol;
  useFont();
  doc.fontSize(FS_VALUE);
  const leaveTypeStr = String(leaveType || '—');
  const reasonHtml = reason || '—';
  const reasonPlain = looksLikeRichHtml(reasonHtml)
    ? richHtmlToPlain(reasonHtml) || '—'
    : String(reasonHtml);
  const reasonH = Math.max(
    34,
    doc.heightOfString(leaveTypeStr, { width: leaveCol - 48 - 14 }) + 16,
    doc.heightOfString(reasonPlain, { width: reasonCol - 48 - 14 }) + 16
  );
  drawRow(
    [
      {
        w: leaveCol,
        label: '假別',
        value: leaveTypeStr,
        labelW: 48,
        multi: leaveTypeStr.length > 8,
      },
      {
        w: reasonCol,
        label: '事由',
        value: reasonPlain,
        html: reasonHtml,
        labelW: 48,
        multi: true,
      },
    ],
    reasonH
  );

  // 第3列：請假期間 + 合計（事假「0.5 天又 1.5 小時」需較寬）
  const totalW = 138;
  const periodW = contentW - totalW;
  const periodH = 52;
  ensureSpace(periodH + 1);
  fillRect(leftX, y, periodW, periodH, C.cellBg);
  fillRect(leftX, y, LW, periodH, C.labelBg);
  fillRect(leftX + periodW, y, totalW, periodH, C.totalBg);
  strokeRect(leftX, y, contentW, periodH, C.lineDark, 0.65);
  doc
    .moveTo(leftX + LW, y)
    .lineTo(leftX + LW, y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.65)
    .stroke();
  doc
    .moveTo(leftX + periodW, y)
    .lineTo(leftX + periodW, y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.65)
    .stroke();
  textMid('請假期間', leftX + 3, y, LW - 6, periodH, {
    size: FS_LABEL,
    color: C.softInk,
    align: 'center',
  });
  const pInnerX = leftX + LW + 10;
  const pInnerW = periodW - LW - 16;
  textAt(fmtPeriodLine(startP, '自', '起'), pInnerX, y + 10, pInnerW, {
    size: 11,
  });
  textAt(fmtPeriodLine(endP, '至', '止'), pInnerX, y + 28, pInnerW, {
    size: 11,
  });
  textMid('合計', leftX + periodW + 4, y + 6, totalW - 8, 18, {
    size: FS_LABEL,
    color: C.header,
    align: 'center',
  });
  textMid(totalText, leftX + periodW + 4, y + 24, totalW - 8, 22, {
    size: 12.5,
    color: C.headerDark,
    align: 'center',
  });
  y += periodH;

  // 第4列：交接事項
  const handText = String(handover || '').trim() || '—';
  useFont();
  doc.fontSize(FS_VALUE);
  const handH = Math.max(
    36,
    doc.heightOfString(handText, {
      width: contentW - LW - 18,
    }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '交接事項',
        value: handText,
        labelW: LW,
        multi: true,
      },
    ],
    handH
  );

  // 說明／事由／交接等自繪表格
  {
    const leaveKit = {
      C,
      get y() {
        return y;
      },
      set y(v) {
        y = v;
      },
      ensureSpace,
      fillRect,
      strokeRect,
    };
    const tableFields = (formFields || []).filter((f) => f.type === 'textarea');
    for (const f of tableFields) {
      const tbl = getFormFieldTable(formData, f.id);
      if (tbl) {
        drawEmbeddedFormTableOnKit(leaveKit, tbl, {
          ctx,
          title: `${f.label || '附表'}附表`,
        });
      }
    }
    // 無 schema 時仍嘗試常見鍵
    for (const [fid, title] of [
      ['reason', '事由附表'],
      ['f_mrssswlt_nrkz', '交接事項附表'],
    ]) {
      if (tableFields.some((f) => f.id === fid)) continue;
      const tbl = getFormFieldTable(formData, fid);
      if (tbl) drawEmbeddedFormTableOnKit(leaveKit, tbl, { ctx, title });
    }
  }

  // 注意列（併入表格風格）
  const noteH = 26;
  ensureSpace(noteH + 2);
  fillRect(leftX, y, contentW, noteH, C.noticeBg);
  strokeRect(leftX, y, contentW, noteH, C.noticeBorder, 0.7);
  textMid(
    '※ 業務部、管理部、工程部同仁，如有請休假，都必須設定 email 自動回覆。',
    leftX + 10,
    y,
    contentW - 20,
    noteH,
    { size: FS_SMALL, color: '#92400e' }
  );
  y += noteH + 10;

  // ========== 差假統計（三欄：核定假別／本次天數／剩餘日數；不顯示特休小時） ==========
  // 另列：本月累計／本年累計（不影響特休欄位）
  const hrTypeRaw = String(ad.hr_leave_type || leaveType || '').trim();
  const hrType = hrTypeRaw || '—';
  const hrLab = hrLeaveLabelsPdf(hrTypeRaw);
  const remDays =
    ad.remaining_special_leave_days != null &&
    ad.remaining_special_leave_days !== ''
      ? String(ad.remaining_special_leave_days)
      : '—';
  const hrNote = ad.hr_note ? String(ad.hr_note) : '';
  const fmtCumDayHour = (d, h) => {
    const hasD = d != null && d !== '';
    const hasH = h != null && h !== '';
    if (!hasD && !hasH) return '—';
    const parts = [];
    if (hasD) parts.push(`${d} 日`);
    if (hasH) parts.push(`${h} 時`);
    return parts.join(' ');
  };
  const monthCumText = fmtCumDayHour(ad.leave_month_days, ad.leave_month_hours);
  const yearCumText = fmtCumDayHour(ad.leave_year_days, ad.leave_year_hours);
  const hasCumRow =
    monthCumText !== '—' || yearCumText !== '—';

  // 差假統計整塊表格：標題列 + 資料列（＋累計列＋可選備註列），線條最後一次畫齊
  const remDayLab = hrLab.remDaysShort || '剩餘日數';
  const remLabW = Math.min(78, Math.max(52, Math.ceil(remDayLab.length * 10.5)));
  const s3 = Math.floor(contentW / 3);
  const s3last = contentW - s3 * 2;
  // 特休：本次欄改稱「本次天數」；其他假別仍可顯示日／時
  const amountLab = isSpecialLeaveTypePdf(hrTypeRaw)
    ? '本次天數'
    : isPersonalLeaveTypePdf(hrTypeRaw) || isSickLeaveTypePdf(hrTypeRaw)
      ? '本次請假'
      : '本次時數';
  const amountVal = isSpecialLeaveTypePdf(hrTypeRaw)
    ? days !== '' && days != null
      ? `${days} 天`
      : totalText
    : isPersonalLeaveTypePdf(hrTypeRaw)
      ? formatPersonalLeavePdfTotal(formData) || totalText
      : isSickLeaveTypePdf(hrTypeRaw)
        ? formatSickLeavePdfTotal(formData) || totalText
        : totalText;
  const statCells = [
    { w: s3, label: '核定假別', value: hrType, labelW: 52 },
    { w: s3, label: amountLab, value: amountVal, labelW: 52 },
    { w: s3last, label: remDayLab, value: remDays, labelW: remLabW },
  ];
  // 驗證欄寬合計 = contentW
  const statWSum = statCells.reduce((a, c) => a + c.w, 0);
  if (statWSum !== contentW && statCells.length) {
    statCells[statCells.length - 1].w += contentW - statWSum;
  }
  const halfW = Math.floor(contentW / 2);
  const cumCells = hasCumRow
    ? [
        {
          w: halfW,
          label: '本月累計',
          value: monthCumText,
          labelW: 64,
        },
        {
          w: contentW - halfW,
          label: '本年累計',
          value: yearCumText,
          labelW: 64,
        },
      ]
    : [];

  const titleH = 26;
  const statRowH = 32;
  const cumRowH = hasCumRow ? 30 : 0;
  useFont();
  doc.fontSize(FS_VALUE);
  const noteLabW = 70;
  const hrNoteH = hrNote
    ? Math.max(
        28,
        doc.heightOfString(hrNote, {
          width: contentW - noteLabW - 16,
        }) + 14
      )
    : 0;
  const blockH = titleH + statRowH + cumRowH + hrNoteH;
  ensureSpace(blockH + 4);

  const blockTop = y;
  const dataTop = blockTop + titleH;
  const cumTop = dataTop + statRowH;
  const noteTop = cumTop + cumRowH;
  const lineW = 0.75;
  const lineColor = C.lineDark;

  // —— 1) 填底色（不畫線）——
  fillRect(leftX, blockTop, contentW, titleH, C.header);
  fillRect(leftX, dataTop, contentW, statRowH, C.cellBg);
  let sx = leftX;
  for (const c of statCells) {
    fillRect(sx, dataTop, c.labelW, statRowH, C.labelBg);
    sx += c.w;
  }
  if (hasCumRow) {
    fillRect(leftX, cumTop, contentW, cumRowH, C.cellBg);
    sx = leftX;
    for (const c of cumCells) {
      fillRect(sx, cumTop, c.labelW, cumRowH, C.labelBg);
      sx += c.w;
    }
  }
  if (hrNote) {
    fillRect(leftX, noteTop, contentW, hrNoteH, C.cellBg);
    fillRect(leftX, noteTop, noteLabW, hrNoteH, C.labelBg);
  }

  // —— 2) 文字 ——
  textMid('差假統計（人事核定）', leftX + 10, blockTop, contentW - 20, titleH, {
    size: 11.5,
    color: C.white,
  });
  sx = leftX;
  for (const c of statCells) {
    textFitOneLine(c.label, sx + 3, dataTop, c.labelW - 6, statRowH, {
      maxSize: 9.5,
      minSize: 6.5,
      color: C.softInk,
      align: 'center',
    });
    textFitOneLine(
      c.value,
      sx + c.labelW + 4,
      dataTop,
      c.w - c.labelW - 8,
      statRowH,
      {
        maxSize: 11,
        minSize: 7,
        color: C.ink,
        align: 'center',
      }
    );
    sx += c.w;
  }
  if (hasCumRow) {
    sx = leftX;
    for (const c of cumCells) {
      textFitOneLine(c.label, sx + 3, cumTop, c.labelW - 6, cumRowH, {
        maxSize: 9.5,
        minSize: 6.5,
        color: C.softInk,
        align: 'center',
      });
      textFitOneLine(
        c.value,
        sx + c.labelW + 4,
        cumTop,
        c.w - c.labelW - 8,
        cumRowH,
        {
          maxSize: 11,
          minSize: 7,
          color: C.ink,
          align: 'center',
        }
      );
      sx += c.w;
    }
  }
  if (hrNote) {
    textFitOneLine('人事備註', leftX + 3, noteTop, noteLabW - 6, hrNoteH, {
      maxSize: 10,
      minSize: 7,
      color: C.softInk,
      align: 'center',
    });
    useFont();
    doc
      .fillColor(C.ink)
      .fontSize(FS_VALUE)
      .text(hrNote, leftX + noteLabW + 8, noteTop + 7, {
        width: contentW - noteLabW - 16,
        align: 'left',
        lineBreak: true,
      });
  }

  // —— 3) 線條（最後畫，確保不被底色蓋住）——
  // 外框
  doc
    .rect(leftX, blockTop, contentW, blockH)
    .strokeColor(lineColor)
    .lineWidth(lineW)
    .stroke();
  // 標題列底線
  doc
    .moveTo(leftX, dataTop)
    .lineTo(leftX + contentW, dataTop)
    .strokeColor(lineColor)
    .lineWidth(lineW)
    .stroke();
  // 累計列頂線
  if (hasCumRow) {
    doc
      .moveTo(leftX, cumTop)
      .lineTo(leftX + contentW, cumTop)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    // 累計列中線
    doc
      .moveTo(leftX + halfW, cumTop)
      .lineTo(leftX + halfW, cumTop + cumRowH)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    // 累計標籤右界
    sx = leftX;
    for (const c of cumCells) {
      doc
        .moveTo(sx + c.labelW, cumTop)
        .lineTo(sx + c.labelW, cumTop + cumRowH)
        .strokeColor(lineColor)
        .lineWidth(lineW)
        .stroke();
      sx += c.w;
    }
  }
  // 資料列底線（有備註時）
  if (hrNote) {
    doc
      .moveTo(leftX, noteTop)
      .lineTo(leftX + contentW, noteTop)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    // 備註標籤右界
    doc
      .moveTo(leftX + noteLabW, noteTop)
      .lineTo(leftX + noteLabW, noteTop + hrNoteH)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
  }
  // 資料列垂直分隔（欄界 + 標籤／值中線）
  sx = leftX;
  for (let i = 0; i < statCells.length; i++) {
    const c = statCells[i];
    if (i > 0) {
      doc
        .moveTo(sx, dataTop)
        .lineTo(sx, dataTop + statRowH)
        .strokeColor(lineColor)
        .lineWidth(lineW)
        .stroke();
    }
    doc
      .moveTo(sx + c.labelW, dataTop)
      .lineTo(sx + c.labelW, dataTop + statRowH)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    sx += c.w;
  }

  y = blockTop + blockH;

  y += 8;
  // 規定
  ensureSpace(36);
  textAt(
    '1. 申請事假、年休假、公假須事前提出申請。　2. 申請病假請檢附掛號費影本，公假請檢附相關證明文件。',
    leftX + 2,
    y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  y += 18;

  // 流程
  ensureSpace(30);
  fillRect(leftX, y, contentW, 28, C.headerSoft);
  strokeRect(leftX, y, contentW, 28, C.header, 0.55);
  textMid(
    '流程：申請人 → 職務代理人 → 單位主管 → 人事單位 → 副總經理 → 總經理 → 人事留存',
    leftX + 6,
    y,
    contentW - 12,
    28,
    { size: 9, color: C.headerDark, align: 'center' }
  );
  y += 36;

  drawApprovalCommentsAboveHistory(
    {
      doc,
      useFont,
      leftX,
      contentW,
      C,
      ensureSpace,
      textAt,
      fillRect,
      strokeRect,
      getY: () => y,
      setY: (v) => {
        y = v;
      },
    },
    request.actions
  );

  // ========== 簽核歷程 ==========
  const actions = (request.actions || []).filter(
    (a) =>
      a.action !== 'comment' || (a.comment && !/Email 催辦/.test(a.comment || ''))
  );
  if (actions.length) {
    ensureSpace(40);
    fillRect(leftX, y, 4, 16, C.header);
    textAt('簽核歷程', leftX + 12, y, contentW - 16, {
      size: 12,
      color: C.headerDark,
    });
    y += 20;

    const colW = {
      step: Math.floor(contentW * 0.26),
      action: Math.floor(contentW * 0.12),
      actor: Math.floor(contentW * 0.16),
      time: Math.floor(contentW * 0.22),
    };
    colW.comment =
      contentW - colW.step - colW.action - colW.actor - colW.time;
    const headH2 = 26;
    ensureSpace(headH2 + 16);
    fillRect(leftX, y, contentW, headH2, C.header);
    let x = leftX;
    const heads = [
      ['步驟', colW.step],
      ['動作', colW.action],
      ['簽核人', colW.actor],
      ['時間', colW.time],
      ['意見', colW.comment],
    ];
    for (const [lab, w] of heads) {
      textMid(lab, x + 4, y, w - 8, headH2, {
        size: 10,
        color: C.white,
      });
      x += w;
    }
    y += headH2;

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const cells = [
        `${a.step_order}${a.step_name ? ` · ${a.step_name}` : ''}`,
        ACTION_LABEL[a.action] || a.action,
        a.actor_name || '—',
        String(a.created_at || '').replace('T', ' ').slice(0, 16),
        historyOpinionCell(a),
      ];
      const widths = [
        colW.step,
        colW.action,
        colW.actor,
        colW.time,
        colW.comment,
      ];
      useFont();
      let maxH = 24;
      for (let j = 0; j < cells.length; j++) {
        const hh =
          doc.heightOfString(String(cells[j]), {
            width: widths[j] - 8,
            fontSize: 9.5,
          }) + 10;
        if (hh > maxH) maxH = hh;
      }

      ensureSpace(maxH + 1);
      if (i % 2 === 1) fillRect(leftX, y, contentW, maxH, C.altBg);
      strokeRect(leftX, y, contentW, maxH, C.softLine, 0.4);
      x = leftX;
      for (let j = 0; j < cells.length; j++) {
        if (j > 0) {
          doc
            .moveTo(x, y)
            .lineTo(x, y + maxH)
            .strokeColor(C.softLine)
            .lineWidth(0.35)
            .stroke();
        }
        textAt(cells[j], x + 4, y + 5, widths[j] - 8, {
          size: 9.5,
          color: C.ink,
        });

        x += widths[j];
      }
      y += maxH;
    }
    y += 6;
  }

  // 附件
  const atts = request.attachments || [];
  if (atts.length) {
    ensureSpace(28);
    fillRect(leftX, y, 4, 16, C.header);
    textAt('附件', leftX + 12, y, contentW - 16, {
      size: 12,
      color: C.headerDark,
    });
    y += 18;
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      ensureSpace(16);
      textAt(
        `${i + 1}. ${a.original_name || a.filename || '—'}`,
        leftX + 8,
        y,
        contentW - 12,
        { size: 10, color: C.softInk }
      );
      y += 15;
    }
  }
}

/**
 * 請購申請專用版面
 * 參考支付申請欄位，風格與其他申請單一致（簡潔灰階表格）
 */
function drawPurchaseForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.purchase);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    drawAttachments,
    FS_VALUE,
    FS_LABEL,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  const itemName =
    pickFormValue(formData, formFields, ['item_name', 'item'], /品名|項目/) ||
    '—';
  const qty = pickFormValue(formData, formFields, ['qty', 'quantity'], /數量/);
  const currency =
    pickFormValue(formData, formFields, ['currency'], /幣別|幣種/) || 'NTD';
  const amountRaw = pickFormValue(
    formData,
    formFields,
    ['amount', 'total'],
    /金額|總額/
  );
  const vendor =
    pickFormValue(
      formData,
      formFields,
      ['vendor', 'supplier', 'customer'],
      /廠商|供應|客戶/
    ) || '—';
  const reasonRaw =
    pickFormValue(
      formData,
      formFields,
      ['reason', 'purpose', 'usage'],
      /事由|用途|說明/
    ) || '';
  const reason = richHtmlBodyPlain(reasonRaw) || '—';
  const reasonHtml = reasonRaw || '—';
  const needDate = pickFormValue(
    formData,
    formFields,
    ['need_date', 'needDate', 'required_date'],
    /需用|需求日/
  );
  const needP = toRocParts(needDate);
  const needDateText =
    needP.y !== ''
      ? `民國 ${needP.y} 年 ${needP.m} 月 ${needP.d} 日`
      : needDate
        ? formatDisplayValue(needDate)
        : '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const qtyText = qty != null && qty !== '' ? String(qty) : '—';
  const amountDisp = formatMoneyByCurrency(amountRaw, currency);

  const purchaseTitle = /支付|付款/.test(String(request.workflow_name || ''))
    ? '支  付  申  請  單'
    : '請  購  申  請  單';
  drawHeader(
    purchaseTitle,
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 申請人 / 單位
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 64,
      },
      {
        w: contentW - half,
        label: '單位',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 品名 / 數量
  const itemW = Math.floor(contentW * 0.7);
  const qtyW = contentW - itemW;
  useFont();
  doc.fontSize(FS_VALUE);
  const itemH = Math.max(
    32,
    doc.heightOfString(String(itemName), {
      width: itemW - 78 - 16,
    }) + 14
  );
  drawRow(
    [
      {
        w: itemW,
        label: '品名／項目',
        value: itemName,
        labelW: 78,
        multi: String(itemName).length > 14,
      },
      {
        w: qtyW,
        label: '數量',
        value: qtyText,
        labelW: 48,
        align: 'center',
      },
    ],
    itemH
  );

  // 幣別 / 預估金額 / 需用日期
  const c1 = Math.floor(contentW * 0.28);
  const c2 = Math.floor(contentW * 0.36);
  const c3 = contentW - c1 - c2;
  drawRow(
    [
      {
        w: c1,
        label: '幣別',
        value: String(currency || '—'),
        labelW: 48,
        align: 'center',
      },
      {
        w: c2,
        label: '預估金額',
        value: amountDisp,
        labelW: 64,
        align: 'center',
        valueSize: 12,
      },
      {
        w: c3,
        label: '需用日期',
        value: needDateText,
        labelW: 64,
      },
    ],
    32
  );

  // 合計列
  drawRow(
    [
      {
        w: contentW,
        label: '合計金額',
        value: `${currency || ''} ${amountDisp}　／　數量 ${qtyText}`.trim(),
        labelW: 70,
      },
    ],
    30
  );

  // 支付方式（整列，勾選清楚）＋ 手續費（下一列）
  const payMethod = String(
    pickFormValue(
      formData,
      formFields,
      ['payment_method', 'pay_method', 'pay_type'],
      /支付方式|付款方式/
    ) || ''
  ).trim();
  const payNote = String(
    pickFormValue(
      formData,
      formFields,
      ['payment_note', 'pay_note', 'payment_detail'],
      /支付說明|到期日|付款說明/
    ) || ''
  ).trim();
  // 勾選選項：優先用流程表單設定（含電匯等），否則預設
  const payFieldDef = (formFields || []).find(
    (f) =>
      f &&
      (f.id === 'payment_method' ||
        f.id === 'pay_method' ||
        /支付方式|付款方式/.test(String(f.label || '')))
  );
  const payOptsFromForm = Array.isArray(payFieldDef?.options)
    ? payFieldDef.options.map((o) => String(o).trim()).filter(Boolean)
    : [];
  const payOpts = payOptsFromForm.length
    ? payOptsFromForm
    : ['現金', '期票', '電匯', '其他'];
  const isPayOn = (o) =>
    payMethod === o ||
    (payMethod && o && (payMethod.includes(o) || o.includes(payMethod)));
  // 選項一列橫排（整列寬較不擠）
  const payCheckLine = payOpts
    .map((o) => `${isPayOn(o) ? '■' : '□'} ${o}`)
    .join('　　');
  const anyOptChecked = payOpts.some(isPayOn);
  // 排版：勾選列為主；若選項未命中則顯示實際文字；說明另起一行
  let payValue = '—';
  if (payMethod || payNote) {
    const lines = [];
    if (payOpts.length && (anyOptChecked || !payMethod)) {
      lines.push(payCheckLine);
    }
    if (payMethod && !anyOptChecked) {
      lines.unshift(payMethod);
      if (payOpts.length) lines.push(payCheckLine);
    } else if (payMethod && anyOptChecked && !payOpts.includes(payMethod)) {
      // 部分相符（例：含「期票」字樣）仍顯示實際值
      lines.unshift(payMethod);
    }
    if (payNote) {
      lines.push(
        /期票/.test(payMethod) ? `到期日／說明：${payNote}` : `說明：${payNote}`
      );
    }
    payValue = lines.filter(Boolean).join('\n') || '—';
  }
  const feeText = String(
    pickFormValue(
      formData,
      formFields,
      ['handling_fee', 'fee', 'service_fee'],
      /手續費/
    ) || ''
  ).trim();
  const feeModeRaw = String(
    pickFormValue(
      formData,
      formFields,
      ['handling_fee_mode', 'fee_mode'],
      /內扣|外加|手續費方式/
    ) || ''
  ).trim();
  const feeMode =
    feeModeRaw === '內扣' || feeModeRaw === '外加'
      ? feeModeRaw
      : /內扣/.test(feeModeRaw)
        ? '內扣'
        : /外加/.test(feeModeRaw)
          ? '外加'
          : '';
  // 手續費：金額／說明 與 內扣／外加 同一列，較易讀
  const feeModePart = `□ 內扣　□ 外加`
    .replace('□ 內扣', feeMode === '內扣' ? '■ 內扣' : '□ 內扣')
    .replace('□ 外加', feeMode === '外加' ? '■ 外加' : '□ 外加');
  const feeValue =
    feeText || feeMode
      ? [feeText || '—', feeModePart].filter(Boolean).join('　　')
      : '—';

  useFont();
  doc.fontSize(FS_VALUE);
  const payTextW = contentW - 70 - 14;
  const payH = Math.max(
    34,
    measureRichOrPlainHeight(doc, useFont, payValue, payTextW, FS_VALUE, 2) + 12
  );
  drawRow(
    [
      {
        w: contentW,
        label: '支付方式',
        value: payValue,
        labelW: 70,
        multi: true,
      },
    ],
    payH
  );

  const feeTextW = contentW - 56 - 14;
  const feeH = Math.max(
    32,
    measureRichOrPlainHeight(doc, useFont, feeValue, feeTextW, FS_VALUE, 2) + 12
  );
  drawRow(
    [
      {
        w: contentW,
        label: '手續費',
        value: feeValue,
        labelW: 56,
        multi: true,
      },
    ],
    feeH
  );

  // 廠商（多行完整顯示）
  useFont();
  doc.fontSize(FS_VALUE);
  const vendorTextW = contentW - 56 - 12;
  const vendorH = Math.max(
    32,
    measureRichOrPlainHeight(doc, useFont, vendor, vendorTextW, FS_VALUE, 2) + 12
  );
  drawRow(
    [
      {
        w: contentW,
        label: '廠商',
        value: vendor,
        labelW: 56,
        multi: true,
      },
    ],
    vendorH
  );

  // 用途／事由：可跨頁完整顯示多行／富文字（避免固定列高裁切）
  drawRichContentInExplainSection(kit, ctx, reasonRaw || reasonHtml || reason || '—', {
    sectionTitle: '用途／事由',
    legacyTable: getFormFieldTable(formData, 'reason'),
  });

  // 附件
  const atts = request.attachments || [];
  sectionBar('附件');
  if (atts.length) {
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: `附件 ${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: 64,
          },
        ],
        26
      );
    }
  } else {
    drawRow(
      [
        {
          w: contentW,
          label: '附件',
          value: '（無上傳附件）',
          labelW: 56,
        },
      ],
      28
    );
  }

  kit.y += 8;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 部門主管 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 32;

  drawActionsHistory(request.actions);
}

/**
 * 費用報支專用版面（薔薇紅系，與其他申請單同風格）
 */
function drawExpenseForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.expense);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    FS_VALUE,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  const expenseType =
    pickFormValue(
      formData,
      formFields,
      ['expense_type', 'type', 'category'],
      /費用類別|類別|費用種類/
    ) || '—';
  const currency =
    pickFormValue(formData, formFields, ['currency'], /幣別|幣種/) || 'NTD';
  const amountRaw = pickFormValue(
    formData,
    formFields,
    ['amount', 'total'],
    /金額|總額/
  );
  const expenseDate = pickFormValue(
    formData,
    formFields,
    ['expense_date', 'date', 'occur_date'],
    /發生|費用日|日期/
  );
  const descRaw =
    pickFormValue(
      formData,
      formFields,
      ['desc', 'description', 'reason', '說明'],
      /費用說明|說明|事由/
    ) || '';
  const desc = richHtmlBodyPlain(descRaw) || '—';

  const expP = toRocParts(expenseDate);
  const expenseDateText =
    expP.y !== ''
      ? `民國 ${expP.y} 年 ${expP.m} 月 ${expP.d} 日`
      : expenseDate
        ? formatDisplayValue(expenseDate)
        : '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const amountDisp = formatMoney(amountRaw);
  const amountLine = `${currency || ''} ${amountDisp}`.trim();

  const subject =
    expenseSubjectFromTitle(request.title) ||
    String(expenseType || '').trim() ||
    '';
  drawHeader(
    '費  用  報  支  單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 主旨（抬頭下方第一列）
  useFont();
  doc.fontSize(FS_VALUE);
  const titleH = Math.max(
    30,
    doc.heightOfString(subject || '—', { width: contentW - 56 - 14 }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: subject || '—',
        labelW: 56,
        multi: true,
      },
    ],
    titleH
  );

  // 申請人 / 單位
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 64,
      },
      {
        w: contentW - half,
        label: '單位',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 費用類別 / 發生日期
  const cA = Math.floor(contentW * 0.5);
  const cB = contentW - cA;
  drawRow(
    [
      {
        w: cA,
        label: '費用類別',
        value: String(expenseType),
        labelW: 70,
      },
      {
        w: cB,
        label: '發生日期',
        value: expenseDateText,
        labelW: 70,
      },
    ],
    32
  );

  // 幣別 / 金額
  const c1 = Math.floor(contentW * 0.32);
  const c2 = contentW - c1;
  drawRow(
    [
      {
        w: c1,
        label: '幣別',
        value: String(currency || '—'),
        labelW: 48,
        align: 'center',
      },
      {
        w: c2,
        label: '金額',
        value: amountDisp,
        labelW: 48,
        align: 'center',
        valueSize: 13,
      },
    ],
    34
  );

  // 合計強調列
  drawRow(
    [
      {
        w: contentW,
        label: '報支合計',
        value: amountLine,
        labelW: 70,
      },
    ],
    32
  );

  // 費用說明（左）＋申請人簽收（右，列印後手簽）
  const signW = 142;
  const descColW = contentW - signW;
  useFont();
  doc.fontSize(FS_VALUE);
  const descStr = String(desc || '—');
  const descH = Math.max(
    96,
    doc.heightOfString(descStr, { width: descColW - 70 - 16 }) + 16
  );
  drawRow(
    [
      {
        w: descColW,
        label: '費用說明',
        value: descStr,
        html: descRaw || descStr,
        labelW: 70,
        multi: true,
      },
      { w: signW },
    ],
    descH
  );

  // 右側手簽區（drawRow 後 y 已下移）
  const signTop = kit.y - descH;
  const signX = leftX + descColW;
  const signHeadH = 22;
  fillRect(signX + 0.6, signTop + 0.6, signW - 1.2, signHeadH - 0.6, C.labelBg);
  doc
    .moveTo(signX, signTop + signHeadH)
    .lineTo(signX + signW, signTop + signHeadH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  textMid('申請人簽收', signX + 4, signTop, signW - 8, signHeadH, {
    size: 10.5,
    color: C.softInk,
    align: 'center',
  });
  const signPadX = 10;
  const signLineY = signTop + descH - 34;
  useFont();
  doc
    .fillColor(C.softInk)
    .fontSize(8.5)
    .text('簽名', signX + signPadX, signLineY, {
      width: 26,
      lineBreak: false,
    });
  doc
    .moveTo(signX + signPadX + 24, signLineY + 11)
    .lineTo(signX + signW - signPadX, signLineY + 11)
    .strokeColor(C.lineDark)
    .lineWidth(0.65)
    .stroke();
  doc
    .fillColor(C.muted)
    .fontSize(8)
    .text('日期：　　年　　月　　日', signX + signPadX, signTop + descH - 16, {
      width: signW - signPadX * 2,
      align: 'left',
      lineBreak: false,
    });
  strokeRect(leftX, signTop, contentW, descH, C.lineDark, 0.65);
  doc
    .moveTo(signX, signTop)
    .lineTo(signX, signTop + descH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  appendFieldTable(kit, ctx, formData, 'desc', '', descRaw);

  // 附件
  const atts = request.attachments || [];
  sectionBar('附件（單據／發票）');
  if (atts.length) {
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: `附件 ${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: 64,
          },
        ],
        26
      );
    }
  } else {
    drawRow(
      [
        {
          w: contentW,
          label: '附件',
          value: '（無上傳附件）',
          labelW: 56,
        },
      ],
      28
    );
  }

  kit.y += 8;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 部門主管 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 32;

  drawActionsHistory(request.actions);
}

/**
 * 出差申請專用版面（橄欖綠系）
 * 表格：統一標籤寬、等分欄寬、單行自動縮放，格線對齊
 */
function drawTravelForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.travel);
  const {
    C,
    drawHeader,
    drawRow,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    FS_VALUE,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  // 統一標籤寬，全表垂直對齊
  const LW = 70;
  const RH = 30; // 標準列高

  const destination =
    pickFormValue(
      formData,
      formFields,
      ['destination', 'place', 'location'],
      /地點|出差地|目的地/
    ) || '—';
  const startDate = pickFormValue(
    formData,
    formFields,
    ['start_date', 'begin_date'],
    /起始|開始/
  );
  const endDate = pickFormValue(
    formData,
    formFields,
    ['end_date', 'finish_date'],
    /結束|迄/
  );
  const purposeRaw =
    pickFormValue(
      formData,
      formFields,
      ['purpose', 'reason', 'desc'],
      /事由|目的|說明/
    ) || '';
  const purpose = richHtmlBodyPlain(purposeRaw) || '—';
  const budgetRaw = pickFormValue(
    formData,
    formFields,
    ['budget', 'amount', 'cost'],
    /預估|費用|預算/
  );
  // 是否申請預支費用（動態欄位 id 或標籤）
  let advance = pickFormValue(
    formData,
    formFields,
    ['advance', 'prepay', 'f_mrsy2tt8_77gi'],
    /預支/
  );
  if (advance === '' || advance == null) {
    for (const [k, v] of Object.entries(formData)) {
      if (k.includes('__')) continue;
      const f = (formFields || []).find((x) => x.id === k);
      if (f && /預支/.test(String(f.label || ''))) {
        advance = v;
        break;
      }
    }
  }
  const advanceYes =
    advance === true ||
    advance === 1 ||
    advance === '1' ||
    advance === 'true' ||
    advance === 'on' ||
    advance === '是';

  const startP = toRocParts(startDate);
  const endP = toRocParts(endDate);
  // 表格日期（單行自動縮放，格線不溢出）
  const fmtDateCell = (p, raw) =>
    p.y !== ''
      ? `民國${p.y}年${p.m}月${p.d}日`
      : raw
        ? formatDisplayValue(raw)
        : '—';
  const startText = fmtDateCell(startP, startDate);
  const endText = fmtDateCell(endP, endDate);
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const budgetDisp = formatMoney(budgetRaw);
  const budgetText =
    budgetDisp === '—' ? '—' : `NTD ${budgetDisp}`;
  // 天數粗算（含首尾）
  let daysText = '—';
  if (startP.y && endP.y) {
    try {
      const a = new Date(
        Number(startP.y) + 1911,
        Number(startP.m) - 1,
        Number(startP.d)
      );
      const b = new Date(
        Number(endP.y) + 1911,
        Number(endP.m) - 1,
        Number(endP.d)
      );
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b >= a) {
        const d =
          Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
        daysText = `${d} 天`;
      }
    } catch {
      /* ignore */
    }
  }

  // 等分欄寬（最後一欄吸收餘數）
  const half = Math.floor(contentW / 2);
  const col3 = Math.floor(contentW / 3);

  drawHeader(
    '出  差  申  請  單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 1) 申請人 / 單位（等分、統一標籤寬）
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: LW,
      },
      {
        w: contentW - half,
        label: '單位',
        value: request.requester_dept || '—',
        labelW: LW,
      },
    ],
    RH
  );

  // 2) 主旨
  const title = String(request.title || '').trim();
  if (title) {
    useFont();
    doc.fontSize(FS_VALUE);
    const titleH = Math.max(
      RH,
      doc.heightOfString(title, { width: contentW - LW - 16 }) + 14
    );
    drawRow(
      [
        {
          w: contentW,
          label: '主旨',
          value: title,
          labelW: LW,
          multi: true,
        },
      ],
      titleH
    );
  }

  // 3) 出差地點
  useFont();
  doc.fontSize(FS_VALUE);
  const destStr = String(destination || '—');
  const destH = Math.max(
    RH,
    doc.heightOfString(destStr, { width: contentW - LW - 16 }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '出差地點',
        value: destStr,
        labelW: LW,
        multi: destStr.length > 20,
      },
    ],
    destH
  );

  // 4) 起始日 / 結束日 / 天數（等分三欄，格線對齊）
  drawRow(
    [
      {
        w: col3,
        label: '起始日',
        value: startText,
        labelW: LW,
        align: 'center',
      },
      {
        w: col3,
        label: '結束日',
        value: endText,
        labelW: LW,
        align: 'center',
      },
      {
        w: contentW - col3 * 2,
        label: '天數',
        value: daysText,
        labelW: LW,
        align: 'center',
      },
    ],
    32
  );

  // 5) 預估費用 / 申請預支（等分兩欄）
  drawRow(
    [
      {
        w: half,
        label: '預估費用',
        value: budgetText,
        labelW: LW,
        align: 'center',
      },
      {
        w: contentW - half,
        label: '申請預支',
        value: advanceYes ? '■ 是　□ 否' : '□ 是　■ 否',
        labelW: LW,
        align: 'center',
      },
    ],
    32
  );

  // 6) 出差事由
  useFont();
  doc.fontSize(FS_VALUE);
  const purposeStr = String(purpose || '—');
  const purposeH = Math.max(
    44,
    doc.heightOfString(purposeStr, { width: contentW - LW - 16 }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '出差事由',
        value: purposeStr,
        labelW: LW,
        multi: true,
      },
    ],
    purposeH
  );
  appendFieldTable(kit, ctx, formData, 'purpose', '', purposeRaw);

  // 8) 附件（同一表格風格）

  const atts = request.attachments || [];
  if (atts.length) {
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: i === 0 ? '附件' : `附件${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: LW,
          },
        ],
        28
      );
    }
  } else {
    drawRow(
      [
        {
          w: contentW,
          label: '附件',
          value: '（無上傳附件）',
          labelW: LW,
        },
      ],
      RH
    );
  }

  // 流程列
  kit.y += 6;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.lineDark, 0.55);
  textMid(
    '流程：申請人 → 人事單位 → 部門主管 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 30;

  drawActionsHistory(request.actions);
}

/**
 * 電腦異常報修申請單（參考紙本，簡單整齊）
 */
function drawItRepairForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.it);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    drawAttachments,
    FS_VALUE,
  } = kit;
  const { useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data);

  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);

  drawHeader(
    '電 腦 異 常 報 修 申 請 單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 申請人 / 部門
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 64,
      },
      {
        w: contentW - half,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 設備異常說明
  sectionBar('設備異常說明');
  const issueRaw =
    pickFormValue(formData, formFields, ['issue_desc'], /異常|故障|說明/) || '';
  const issue = richHtmlBodyPlain(issueRaw) || '—';
  useFont();
  const issueH = Math.max(
    52,
    ctx.doc.heightOfString(String(issue), {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(issueH + 1);
  fillRect(leftX, kit.y, contentW, issueH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, issueH, C.lineDark, 0.65);
  textAt(issue, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
    height: issueH - 12,
  });
  kit.y += issueH;
  appendFieldTable(kit, ctx, formData, 'issue_desc', '', issueRaw);

  // 電腦規格
  sectionBar('電腦規格（申請人填寫）');
  const specRaw =
    pickFormValue(formData, formFields, ['computer_spec'], /規格|電腦/) || '';
  const spec = richHtmlBodyPlain(specRaw) || '—';
  useFont();
  const specH = Math.max(
    40,
    ctx.doc.heightOfString(String(spec), {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(specH + 1);
  fillRect(leftX, kit.y, contentW, specH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, specH, C.lineDark, 0.65);
  textAt(spec, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
    height: specH - 12,
  });
  kit.y += specH;
  appendFieldTable(kit, ctx, formData, 'computer_spec', '', specRaw);

  // 管理部填寫
  sectionBar('以下由管理部填寫');
  const checks = [
    {
      key: 'pc_acquired_date',
      label: '原電腦取得日期',
      std: '—',
      isDate: true,
    },
    { key: 'check_os', label: '作業系統', std: 'Windows10' },
    { key: 'check_memory', label: '記憶體', std: '4G 以上' },
    { key: 'check_disk', label: '硬碟', std: 'SSD 500G 以上' },
    { key: 'check_3dmark', label: '3DMARK 分數', std: '500 分以上' },
    { key: 'check_email', label: '電子郵件', std: '定期清理' },
    { key: 'check_backup', label: '重要資料', std: '定期備份' },
    { key: 'check_battery', label: '電池容量', std: '70%以上／低於70%' },
  ];

  // 表頭
  const colLabel = Math.floor(contentW * 0.28);
  const colVal = Math.floor(contentW * 0.28);
  const colStd = Math.floor(contentW * 0.24);
  const colOk = contentW - colLabel - colVal - colStd;
  const headH = 26;
  ensureSpace(headH);
  fillRect(leftX, kit.y, contentW, headH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, headH, C.lineDark, 0.65);
  let x = leftX;
  const heads = [
    ['檢查項目', colLabel],
    ['填寫／結果', colVal],
    ['檢核標準', colStd],
    ['是否符合', colOk],
  ];
  for (let i = 0; i < heads.length; i++) {
    const [lab, w] = heads[i];
    if (i > 0) {
      ctx.doc
        .moveTo(x, kit.y)
        .lineTo(x, kit.y + headH)
        .strokeColor(C.line)
        .lineWidth(0.5)
        .stroke();
    }
    textMid(lab, x + 4, kit.y, w - 8, headH, {
      size: 10,
      color: C.softInk,
      align: 'center',
    });
    x += w;
  }
  kit.y += headH;

  for (const row of checks) {
    const raw = ad[row.key];
    let val = '—';
    let okText = '—';
    let okColor = C.muted;
    if (row.isDate) {
      val = raw ? formatDisplayValue(raw) : '—';
      okText = '—';
    } else {
      const s = raw != null && raw !== '' ? String(raw) : '';
      const note = String(ad[`${row.key}_note`] || ad.check_noncompliant_note || '').trim();
      if (!s) {
        val = '—';
        okText = '—';
      } else if (s.includes('不符合')) {
        val = note || '—';
        okText = '□ 不符合';
        okColor = C.ng;
      } else if (/^(N\/?A|不適用)$/i.test(s.trim())) {
        val = 'NA';
        okText = 'NA';
        okColor = C.muted;
      } else if (row.key === 'check_battery' && s.includes('低於')) {
        val = note || s;
        okText = '低於70%';
        okColor = C.ng;
      } else if (row.key === 'check_battery' && s.includes('以上')) {
        val = s;
        okText = '70%以上';
        okColor = C.ok;
      } else if (s.includes('符合')) {
        val = s;
        okText = '■ 符合';
        okColor = C.ok;
      } else {
        val = s;
        okText = '—';
      }
    }

    useFont();
    const valNeed = ctx.doc.heightOfString(String(val || '—'), {
      width: colVal - 8,
      fontSize: 10.5,
    });
    const rh = Math.max(26, Math.ceil(valNeed) + 10);
    ensureSpace(rh);
    fillRect(leftX, kit.y, contentW, rh, C.cellBg);
    strokeRect(leftX, kit.y, contentW, rh, C.lineDark, 0.55);
    const vals = [row.label, val, row.std, okText];
    const widths = [colLabel, colVal, colStd, colOk];
    const colors = [C.softInk, C.ink, C.muted, okColor];
    x = leftX;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        ctx.doc
          .moveTo(x, kit.y)
          .lineTo(x, kit.y + rh)
          .strokeColor(C.line)
          .lineWidth(0.5)
          .stroke();
      }
      if (i === 0) fillRect(x, kit.y, widths[i], rh, C.labelBg);
      if (i === 1 && String(val).length > 12) {
        textAt(vals[i], x + 4, kit.y + 5, widths[i] - 8, {
          size: 10.5,
          color: colors[i],
          align: 'left',
        });
      } else {
        textMid(vals[i], x + 4, kit.y, widths[i] - 8, rh, {
          size: 10.5,
          color: colors[i],
          align: i === 0 || i === 3 ? 'center' : 'left',
        });
      }
      x += widths[i];
    }
    kit.y += rh;
  }

  // 電腦處理情形
  sectionBar('電腦處理情形');
  const handleResult = ad.handle_result ? String(ad.handle_result) : '—';
  const handleNote = ad.handle_note ? String(ad.handle_note) : '';
  const handleText = handleNote
    ? `${handleResult}\n說明：${handleNote}`
    : handleResult;
  useFont();
  const handleH = Math.max(
    48,
    ctx.doc.heightOfString(handleText, {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(handleH + 1);
  fillRect(leftX, kit.y, contentW, handleH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, handleH, C.lineDark, 0.65);
  textAt(handleText, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
  });
  kit.y += handleH + 8;

  // 備註
  textAt(
    '※ 檢核標準自 2024 年 3 月核定，日後將依照符合當時電腦規格提升而變動。',
    leftX + 2,
    kit.y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  kit.y += 14;
  textAt(
    '流程：申請人 → 管理部檢修 → 副總經理 → 總經理',
    leftX + 2,
    kit.y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  kit.y += 16;

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

/**
 * 延長工時申請表（參考紙本，簡單整齊）
 */
function drawOvertimeForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.overtime);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    drawAttachments,
    FS_VALUE,
  } = kit;
  const { useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data);

  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);

  drawHeader(
    '延 長 工 時 申 請 表',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 部門 / 姓名
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 56,
      },
      {
        w: contentW - half,
        label: '姓名',
        value: request.requester_name || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 事由（富文字顏色）
  const reasonRawOt =
    pickFormValue(formData, formFields, ['reason'], /事由/) || '';
  const reason = richHtmlBodyPlain(reasonRawOt) || '—';
  useFont();
  const reasonH = Math.max(
    40,
    ctx.doc.heightOfString(String(reason), {
      width: contentW - 70 - 14,
      fontSize: FS_VALUE,
    }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '事由',
        value: reason,
        html: reasonRawOt || reason,
        labelW: 56,
        multi: true,
      },
    ],
    reasonH
  );
  appendFieldTable(kit, ctx, formData, 'reason', '', reasonRawOt);

  // 延長工時時間
  const startP = toRocParts(formData.ot_start);
  const endP = toRocParts(formData.ot_end);
  const hours =
    formData.hours != null && formData.hours !== ''
      ? String(formData.hours)
      : '—';
  const periodH = 56;
  ensureSpace(periodH + 1);
  const labelW = 90;
  fillRect(leftX, kit.y, contentW, periodH, C.cellBg);
  fillRect(leftX, kit.y, labelW, periodH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, periodH, C.lineDark, 0.65);
  ctx.doc
    .moveTo(leftX + labelW, kit.y)
    .lineTo(leftX + labelW, kit.y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  textMid('延長工時時間', leftX + 2, kit.y, labelW - 4, periodH, {
    size: 10.5,
    color: C.softInk,
    align: 'center',
  });
  const pX = leftX + labelW + 10;
  const pW = contentW - labelW - 18;
  textAt(
    `從　民國 ${startP.y || '　'} 年 ${startP.m || '　'} 月 ${startP.d || '　'} 日　${startP.hh || '　'} 時 ${startP.mm || '　'} 分`,
    pX,
    kit.y + 8,
    pW,
    { size: 11 }
  );
  textAt(
    `至　民國 ${endP.y || '　'} 年 ${endP.m || '　'} 月 ${endP.d || '　'} 日　${endP.hh || '　'} 時 ${endP.mm || '　'} 分`,
    pX,
    kit.y + 26,
    pW,
    { size: 11 }
  );
  textAt(`總計：${hours} 時`, pX, kit.y + 42, pW, {
    size: 11,
    color: C.ink,
  });
  kit.y += periodH;

  // 選擇項目
  const opt = String(
    pickFormValue(formData, formFields, ['ot_option'], /選擇|項目/) || ''
  );
  const optOther = String(
    pickFormValue(formData, formFields, ['ot_option_other'], /其他/) || ''
  );
  const options = ['補休', '誤餐費', '其他'];
  const optParts = options.map((o) => {
    const on = opt === o || opt.includes(o);
    return `${on ? '■' : '□'} ${o}`;
  });
  let optDisplay = optParts.join('　　');
  if (opt === '其他' || opt.includes('其他')) {
    optDisplay += optOther ? `：${optOther}` : '';
  } else if (opt && !options.includes(opt)) {
    optDisplay = opt;
  }
  drawRow(
    [
      {
        w: contentW,
        label: '選擇項目',
        value: optDisplay || '—',
        labelW: 70,
      },
    ],
    32
  );

  // 人事單位核算
  sectionBar('以下由人事單位核算');
  const actStart = toRocParts(ad.actual_start || formData.ot_start);
  const actEnd = toRocParts(ad.actual_end || formData.ot_end);
  const actHours =
    ad.actual_hours != null && ad.actual_hours !== ''
      ? String(ad.actual_hours)
      : hours;
  const balance =
    ad.comp_leave_balance != null && ad.comp_leave_balance !== ''
      ? String(ad.comp_leave_balance)
      : '—';
  const hrNote = ad.hr_note ? String(ad.hr_note) : '';

  const actH = 56;
  ensureSpace(actH + 1);
  fillRect(leftX, kit.y, contentW, actH, C.cellBg);
  fillRect(leftX, kit.y, labelW, actH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, actH, C.lineDark, 0.65);
  ctx.doc
    .moveTo(leftX + labelW, kit.y)
    .lineTo(leftX + labelW, kit.y + actH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  textMid('實際工時', leftX + 2, kit.y, labelW - 4, actH, {
    size: 10.5,
    color: C.softInk,
    align: 'center',
  });
  textAt(
    `從　民國 ${actStart.y || '　'} 年 ${actStart.m || '　'} 月 ${actStart.d || '　'} 日　${actStart.hh || '　'} 時 ${actStart.mm || '　'} 分`,
    pX,
    kit.y + 8,
    pW,
    { size: 11 }
  );
  textAt(
    `至　民國 ${actEnd.y || '　'} 年 ${actEnd.m || '　'} 月 ${actEnd.d || '　'} 日　${actEnd.hh || '　'} 時 ${actEnd.mm || '　'} 分`,
    pX,
    kit.y + 26,
    pW,
    { size: 11 }
  );
  textAt(
    `總計：${actHours} 時　　目前累計可用時數：${balance} 時`,
    pX,
    kit.y + 42,
    pW,
    { size: 11 }
  );
  kit.y += actH;

  if (hrNote) {
    drawRow(
      [
        {
          w: contentW,
          label: '備註',
          value: hrNote,
          labelW: 56,
          multi: true,
        },
      ],
      Math.max(
        32,
        ctx.doc.heightOfString(hrNote, {
          width: contentW - 56 - 14,
          fontSize: FS_VALUE,
        }) + 14
      )
    );
  }

  kit.y += 8;
  // 附註
  const notes = [
    '一、各部門確有延時工作需要，由部門主管事先核實指派，於隔日由人事單位核算並於每月底由本表填完後送管理部查核登錄。',
    '二、實際工作時間依刷卡時間時數查核後，以憑填報每月誤餐費請領清冊。',
    '三、延時工作人員均應於工作完成後刷卡，實際工作時數以小時為單位。',
    '四、誤餐費及換特休僅可擇一，不得同時申請。',
    '五、如換特休，最多累計 40 小時，限一年內休完。',
  ];
  for (const n of notes) {
    ensureSpace(20);
    textAt(n, leftX + 2, kit.y, contentW - 4, {
      size: 8.5,
      color: C.muted,
    });
    kit.y += 13;
  }
  kit.y += 4;
  textAt(
    '流程：申請人 → 部門主管 → 副總經理 → 人事單位 → 總經理',
    leftX + 2,
    kit.y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  kit.y += 16;

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

/**
 * 一般簽呈（參考 ARGO-簽呈.docx，公文式整齊版面）
 */
function drawGeneralMemoForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.memo);
  const {
    C,
    drawRow,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    measureTextH,
    FS_VALUE,
    FS_SMALL,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const atts = request.attachments || [];

  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at);

  const subjectTitle = String(request.title || '').trim() || '—';
  // 說明欄（富文字）：文字與貼上表格依序完整留在「說明」欄內
  const bodyField =
    (formFields || []).find(
      (f) =>
        f &&
        (f.id === 'subject' ||
          /主旨說明|說明|內容/.test(String(f.label || '')))
    ) || null;
  const bodyFieldId = bodyField?.id || 'subject';
  const bodyRaw =
    pickFormValue(
      formData,
      formFields,
      [bodyFieldId, 'subject', 'desc', 'description', 'reason'],
      /主旨說明|說明|內容|事由/
    ) ||
    formData[bodyFieldId] ||
    formData.subject ||
    '';
  const category =
    pickFormValue(formData, formFields, ['category'], /類別/) || '—';
  const urgentRaw = formData.urgent;
  const isUrgent =
    urgentRaw === true ||
    urgentRaw === 1 ||
    urgentRaw === '1' ||
    urgentRaw === 'true' ||
    urgentRaw === 'on' ||
    urgentRaw === '急件';

  // 抬頭：公司 + 表單名稱（深藍系）
  const memoTitle = generalMemoHeaderTitle(request);
  const headH = 70;
  fillRect(leftX, kit.y, contentW, 5, C.header);
  fillRect(leftX, kit.y + 5, contentW, headH - 5, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, headH, C.lineDark, 0.9);
  useFont();
  doc
    .fillColor(C.header)
    .fontSize(12)
    .text(getCompanyNameForPdf(), leftX, kit.y + 14, {
      width: contentW,
      align: 'center',
    });
  doc
    .moveTo(leftX + contentW * 0.32, kit.y + 34)
    .lineTo(leftX + contentW * 0.68, kit.y + 34)
    .strokeColor(C.header)
    .lineWidth(0.9)
    .stroke();
  doc
    .fillColor(C.header)
    .fontSize(memoTitle.length > 6 ? 16 : 20)
    .text(memoTitle, leftX, kit.y + 40, {
      width: contentW,
      align: 'center',
    });
  kit.y += headH + 8;

  // 單號列
  const metaH = 20;
  fillRect(leftX, kit.y, contentW, metaH, C.altBg);
  strokeRect(leftX, kit.y, contentW, metaH, C.softLine, 0.5);
  textMid(
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}${
      isUrgent ? '　·　【急件】' : ''
    }`,
    leftX + 8,
    kit.y,
    contentW - 16,
    metaH,
    { size: FS_SMALL, color: isUrgent ? '#b91c1c' : C.muted, align: 'right' }
  );
  kit.y += metaH + 6;

  // 公文表頭（對照 ARGO-簽呈）
  // 列1：正本受文者 | 發文日期
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '正本受文者',
        value: '總經理／相關單位',
        labelW: 78,
      },
      {
        w: contentW - half,
        label: '發文日期',
        value: applyDateText,
        labelW: 64,
      },
    ],
    28
  );
  // 列2：副本受文者 | 機密等級／類別
  drawRow(
    [
      {
        w: half,
        label: '副本受文者',
        value: '—',
        labelW: 78,
      },
      {
        w: contentW - half,
        label: '類別／等級',
        value: isUrgent ? `${category}（急件）` : String(category),
        labelW: 72,
      },
    ],
    28
  );
  // 列3：承辦人 | 部門 | 頁數
  const c3a = Math.floor(contentW * 0.4);
  const c3b = Math.floor(contentW * 0.35);
  const c3c = contentW - c3a - c3b;
  drawRow(
    [
      {
        w: c3a,
        label: '承辦人',
        value: request.requester_name || '—',
        labelW: 56,
      },
      {
        w: c3b,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 48,
      },
      {
        w: c3c,
        label: '頁數',
        value: '1',
        labelW: 40,
        align: 'center',
      },
    ],
    28
  );

  // 主旨（量測字級與繪製一致，並加安全邊距）
  const titleValSize = 12;
  useFont();
  doc.fontSize(titleValSize);
  const titleH = Math.max(
    32,
    measureTextH(subjectTitle, contentW - 56 - 14, {
      size: titleValSize,
      lineGap: 2,
    }) + 18
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: subjectTitle,
        labelW: 56,
        multi: true,
        valueSize: titleValSize,
      },
    ],
    titleH
  );

  // 附件
  const attText = atts.length
    ? atts
        .map((a, i) => `${i + 1}. ${a.original_name || a.filename || '附件'}`)
        .join('；')
    : '無';
  useFont();
  doc.fontSize(FS_VALUE);
  const attH = Math.max(
    28,
    measureTextH(attText, contentW - 56 - 14, { size: FS_VALUE, lineGap: 2 }) +
      16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '附件',
        value: attText,
        labelW: 56,
        multi: true,
      },
    ],
    attH
  );

  // ========== 說明（文字 + 貼上表格完整留在此欄，依原始順序）==========
  drawRichContentInExplainSection(kit, ctx, bodyRaw, {
    sectionTitle: '說　　明',
    legacyTable:
      formData[`${bodyFieldId}__table`] || formData.subject__table || null,
  });

  // 呈請核示
  ensureSpace(36);
  textAt('呈請　核示', leftX, kit.y, contentW, {
    size: 13,
    color: C.ink,
    align: 'center',
  });
  kit.y += 22;
  textAt(
    `${request.requester_dept ? request.requester_dept + '　' : ''}${
      request.requester_name || ''
    }　謹呈`,
    leftX,
    kit.y,
    contentW - 10,
    { size: 11, color: C.softInk, align: 'right' }
  );
  kit.y += 18;

  // 流程
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 部門主管 → 會簽人員 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 32;

  drawActionsHistory(request.actions);
}

/**
 * 已核准 PDF：右上角紅色「核准」印章（類似傳統橡皮章）
 * 於各頁繪製；需 PDFDocument bufferPages: true
 */
function drawApprovedStamp(doc, useFont) {
  const pageW = doc.page.width;
  const margin = 40;
  // 右上角
  const cx = pageW - margin - 40;
  const cy = margin + 48;
  const r = 38;
  const red = '#c41e3a';

  doc.save();
  try {
    doc.translate(cx, cy);
    doc.rotate(-16);

    // 雙層圓環
    doc
      .circle(0, 0, r)
      .lineWidth(3)
      .strokeColor(red)
      .stroke();
    doc
      .circle(0, 0, r - 6)
      .lineWidth(1.4)
      .strokeColor(red)
      .stroke();

    // 內文「核准」
    if (typeof useFont === 'function') useFont();
    doc.fillColor(red).fontSize(20);
    const label = '核准';
    const tw = doc.widthOfString(label);
    doc.text(label, -tw / 2, -9, { lineBreak: false });

    // 底部小字（可選）
    doc.fontSize(7);
    const sub = 'APPROVED';
    const sw = doc.widthOfString(sub);
    doc.text(sub, -sw / 2, 14, { lineBreak: false });
  } finally {
    doc.restore();
  }
}

/** 會議記錄文件代碼：第一頁必印，有第二頁（及之後）也印在右下角 */
function stampMeetingDocCode(doc, useFont, box) {
  const code = 'QP04-01B';
  const leftX = box.leftX;
  const contentW = box.contentW;
  const pageH = box.pageH;
  const y = pageH - 28;
  let range;
  try {
    range = doc.bufferedPageRange();
  } catch {
    range = { start: 0, count: 1 };
  }
  const n = Math.max(1, Number(range.count) || 1);
  for (let i = 0; i < n; i++) {
    try {
      doc.switchToPage(range.start + i);
    } catch {
      if (i > 0) break;
    }
    if (typeof useFont === 'function') useFont();
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      doc
        .fillColor('#64748b')
        .fontSize(9)
        .text(code, leftX, y, {
          width: contentW,
          align: 'right',
          lineBreak: false,
        });
    } finally {
      doc.page.margins.bottom = saved;
    }
  }
}

/** 僅在第一頁蓋核准章後結束文件（後續頁不蓋） */
function endPdfWithApprovedStamp(doc, request, useFont) {
  try {
    if (request && request.status === 'approved') {
      const range = doc.bufferedPageRange();
      if (range.count > 0) {
        doc.switchToPage(range.start); // 僅第一頁
        drawApprovedStamp(doc, useFont);
      }
    }
  } catch (e) {
    console.warn('[pdf] approved stamp failed', e && e.message ? e.message : e);
  }
  doc.end();
}

/**
 * resolveFormTheme → createSimpleTableKit 主題（與既有專用表單同一套表格風格）
 */
function kitThemeFromRequest(request) {
  const t = resolveFormTheme(request);
  return {
    header: t.headerBg || t.primary || '#1e3a5f',
    headerSoft: t.sectionBg || '#e2e8f0',
    labelBg: t.labelBg || '#f1f5f9',
    sectionBg: t.sectionBg || '#e2e8f0',
    line: t.border || '#94a3b8',
    lineDark: t.primary || '#334155',
    softLine: t.accentSoft || t.border || '#cbd5e1',
    softInk: t.primary || '#334155',
    altBg: t.rowAlt || '#f8fafc',
    ink: t.text || '#0f172a',
    muted: t.muted || '#64748b',
  };
}

/**
 * 標準簽核 PDF 版型（新建流程的預設）
 * 與現有請假／請購／出差／簽呈等同一套：
 * 彩色抬頭＋標籤格線表格＋區塊標題＋簽核歷程＋附件
 * 依 formFields／form_data 動態排版，無需為新流程另寫專用函式。
 */
function drawStandardWorkflowForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, kitThemeFromRequest(request));
  const {
    C,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    ensureSpace,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = Array.isArray(request.formFields) ? request.formFields : [];
  const formName = isVoidApplicationRequest(request)
    ? '作廢申請'
    : String(request.workflow_name || request.form_name || '簽核申請');
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at);
  const LW = 78;

  drawHeader(
    formName,
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 基本資料
  sectionBar('基本資料');
  const applicant = `${request.requester_name || '—'}${
    request.requester_dept ? `（${request.requester_dept}）` : ''
  }`;
  drawRow(
    [
      { w: contentW * 0.5, label: '申請人', value: applicant, labelW: LW },
      {
        w: contentW * 0.5,
        label: '狀態',
        value: STATUS_LABEL[request.status] || request.status || '—',
        labelW: LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: formatDisplayValue(request.title) || '—',
        labelW: LW,
        multi: true,
      },
    ],
    Math.max(
      28,
      Math.min(
        72,
        measureTextH(formatDisplayValue(request.title) || '—', contentW - LW - 16) + 14
      )
    )
  );
  if (request.created_at || request.completed_at) {
    drawRow(
      [
        {
          w: contentW * 0.5,
          label: '建立時間',
          value: formatDisplayValue(request.created_at),
          labelW: LW,
        },
        {
          w: contentW * 0.5,
          label: '完成時間',
          value: request.completed_at
            ? formatDisplayValue(request.completed_at)
            : '—',
          labelW: LW,
        },
      ],
      28
    );
  }

  // 申請表單（動態欄位）
  // 銷貨統計：申請單時間在上、內容在下；PDF 改為內容在上、統計時間在下，且不顯示「申請表單」列
  let pdfFields = formFields;
  const isSalesStatForm =
    formFields.some((f) => f && f.id === 'content') &&
    formFields.some((f) => f && f.id === 'stats_start');
  if (isSalesStatForm) {
    const ids = (f) => String(f?.id || '');
    pdfFields = [
      ...formFields.filter((f) => ids(f) === 'content'),
      ...formFields.filter((f) => ids(f) === 'stats_start' || ids(f) === 'stats_end'),
      ...formFields.filter(
        (f) => !['content', 'stats_start', 'stats_end'].includes(ids(f))
      ),
    ];
  }
  const renderedIds = new Set();
  if (pdfFields.length) {
    if (!isSalesStatForm) sectionBar('申請表單');
    for (const f of pdfFields) {
      if (!f || !f.id) continue;
      if (f.id === 'stats_end' && renderedIds.has('stats_start')) continue;
      if (f.id === 'stats_start') {
        const endField = formFields.find((x) => x && x.id === 'stats_end');
        const a = toRocParts(formData.stats_start);
        const b = toRocParts(formData.stats_end);
        const fmt = (p) =>
          p.y !== '' ? `民國 ${p.y} 年 ${p.m} 月 ${p.d} 日` : '—';
        renderedIds.add('stats_start');
        if (endField) renderedIds.add('stats_end');
        drawRow(
          [
            {
              w: contentW,
              label: '統計時間',
              value: `${fmt(a)} ～ ${fmt(b)}`,
              labelW: LW,
              multi: true,
            },
          ],
          28
        );
        continue;
      }
      if (f.id === 'submit_month' && renderedIds.has('submit_year')) continue;
      if (f.id === 'submit_year') {
        const monthField = formFields.find((x) => x && x.id === 'submit_month');
        const y = String(formData.submit_year || '').trim() || '—';
        const mRaw = String(formData.submit_month || '').replace(/[^\d]/g, '');
        const m = mRaw ? `${Number(mRaw)}月` : '—';
        renderedIds.add('submit_year');
        if (monthField) renderedIds.add('submit_month');
        drawRow(
          [
            {
              w: contentW * 0.5,
              label: f.label || '年份',
              value: y,
              labelW: LW,
            },
            {
              w: contentW * 0.5,
              label: (monthField && monthField.label) || '呈交月份',
              value: m,
              labelW: LW,
            },
          ],
          28
        );
        continue;
      }
      const isContentField =
        f.id === 'content' ||
        (f.type === 'textarea' &&
          /^(內容)$/.test(String(f.label || '').trim()));
      if (isContentField) {
        renderedIds.add(f.id);
        drawRichContentInExplainSection(kit, ctx, formData[f.id] || '', {
          sectionTitle: f.label || '內容',
          legacyTable: formData[`${f.id}__table`] || null,
        });
        continue;
      }
      renderedIds.add(f.id);
      let val = formData[f.id];
      if (f.type === 'checkbox') {
        val = val ? '是' : '否';
      } else if (f.type === 'user') {
        val =
          formData[`${f.id}__label`] ||
          formData[`${f.id}__name`] ||
          val ||
          '—';
      } else if (f.type === 'datetime') {
        val = val ? String(val).replace('T', ' ').slice(0, 16) : '—';
      }
      const display = formatDisplayValue(val);
      const isLong =
        f.type === 'textarea' ||
        (typeof display === 'string' &&
          (display.length > 40 || display.includes('\n')));
      const rowH = isLong
        ? Math.max(
            32,
            Math.min(
              160,
              measureTextH(display, contentW - LW - 16) + 16
            )
          )
        : 28;
      drawRow(
        [
          {
            w: contentW,
            label: f.label || f.id,
            value: display,
            labelW: LW,
            multi: isLong,
          },
        ],
        rowH
      );
      // 富文字／內嵌表格
      if (
        (typeof formData[f.id] === 'string' && /<table/i.test(formData[f.id])) ||
        formData[`${f.id}__table`]
      ) {
        appendFieldTable(kit, ctx, formData, f.id, '');
      }
    }
  }

  // 無 schema 時列出其他鍵（略過 meta）
  const extraRows = [];
  for (const [k, v] of Object.entries(formData)) {
    if (k.includes('__')) continue;
    if (/^dept_head_\d+$/.test(k) || /^users_pick_\d+$/.test(k)) continue;
    if (renderedIds.has(k)) continue;
    if (/^cosign_\d+$/.test(k)) {
      const label = formData[`${k}__label`];
      extraRows.push([
        '會簽人員',
        label || (v && v !== 'skip' ? String(v) : '略過（無會簽）'),
      ]);
      continue;
    }
    if (!formFields.length && typeof v !== 'object') {
      extraRows.push([k, formatDisplayValue(v)]);
    }
  }
  if (extraRows.length) {
    if (!formFields.length) sectionBar('申請表單');
    for (const [lab, val] of extraRows) {
      drawRow(
        [{ w: contentW, label: lab, value: val, labelW: LW, multi: true }],
        Math.max(28, Math.min(100, measureTextH(String(val), contentW - LW - 16) + 14))
      );
    }
  }

  // 簽核單位填寫
  const ad = flattenApproverData(request.approver_data);
  const adKeys = Object.keys(ad || {});
  if (adKeys.length) {
    const secTitle =
      ad.sales_revenue != null ||
      ad.sales_cost != null ||
      ad.sales_gross_profit != null
        ? '財務單位填寫'
        : ad.hr_leave_type != null ||
            ad.remaining_special_leave_days != null ||
            ad.leave_month_days != null ||
            ad.leave_year_days != null
          ? '人事／簽核單位填寫'
          : ad.pc_acquired_date != null || ad.handle_result != null
            ? '管理部／簽核單位填寫'
            : '簽核單位填寫';
    sectionBar(secTitle);
    const adOrder = [
      'sales_revenue',
      'sales_cost',
      'sales_gross_profit',
      'sales_gross_diff_note',
      'sales_remark',
      'hr_leave_type',
      'remaining_special_leave_days',
      'leave_month_days',
      'leave_month_hours',
      'leave_year_days',
      'leave_year_hours',
      'hr_note',
    ];
    const ordered = [
      ...adOrder.filter((k) => adKeys.includes(k)),
      ...adKeys.filter(
        (k) =>
          !adOrder.includes(k) &&
          k !== 'remaining_special_leave_hours' &&
          !/特休.*小時|剩餘.*小時/.test(String(k))
      ),
    ];
    const fmtCum = (d, h) => {
      const hasD = d != null && d !== '';
      const hasH = h != null && h !== '';
      if (!hasD && !hasH) return null;
      const parts = [];
      if (hasD) parts.push(`${d} 日`);
      if (hasH) parts.push(`${h} 時`);
      return parts.join(' ');
    };
    const monthCum = fmtCum(ad.leave_month_days, ad.leave_month_hours);
    const yearCum = fmtCum(ad.leave_year_days, ad.leave_year_hours);
    const skipCum = new Set([
      'leave_month_days',
      'leave_month_hours',
      'leave_year_days',
      'leave_year_hours',
    ]);
    let insertedCum = false;
    for (const k of ordered) {
      if (skipCum.has(k)) continue;
      let val = ad[k];
      if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
        val = '—';
      }
      if (
        /^(sales_revenue|sales_cost|sales_gross_profit)$/.test(k) &&
        val != null &&
        val !== ''
      ) {
        val = formatMoney(val);
      }
      const displayVal = formatDisplayValue(val);
      const isLongNote = /^(sales_gross_diff_note|sales_remark)$/.test(k);
      const rowH = isLongNote
        ? Math.max(
            32,
            Math.min(160, measureTextH(String(displayVal), contentW - LW - 16) + 16)
          )
        : 28;
      drawRow(
        [
          {
            w: contentW,
            label: adLabelPdf(k, ad),
            value: displayVal,
            labelW: LW,
            multi: true,
          },
        ],
        rowH
      );
      if (k === 'remaining_special_leave_days' && !insertedCum) {
        if (monthCum) {
          drawRow(
            [
              {
                w: contentW,
                label: '本月累計',
                value: monthCum,
                labelW: LW,
              },
            ],
            28
          );
        }
        if (yearCum) {
          drawRow(
            [
              {
                w: contentW,
                label: '本年累計',
                value: yearCum,
                labelW: LW,
              },
            ],
            28
          );
        }
        insertedCum = true;
      }
    }
    if (!insertedCum) {
      if (monthCum) {
        drawRow(
          [{ w: contentW, label: '本月累計', value: monthCum, labelW: LW }],
          28
        );
      }
      if (yearCum) {
        drawRow(
          [{ w: contentW, label: '本年累計', value: yearCum, labelW: LW }],
          28
        );
      }
    }
  }

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

/**
 * 將簽核單寫入串流（表格化版面）
 */
function drawCreditLimitForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.purchase || {});
  const {
    C,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    ensureSpace,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const ad = flattenApproverData(request.approver_data) || {};

  // —— 統一欄寬（整數，避免浮點誤差造成格線錯位）——
  // 雙欄：左半／右半；標籤寬全表一致
  const HALF = Math.floor(contentW / 2);
  const HALF_R = contentW - HALF;
  const STD_LW = 88; // 一般雙欄標籤寬
  // 四欄放帳
  const Q = Math.floor(contentW / 4);
  const Q_LAST = contentW - Q * 3;
  const Q_LW = 62;
  // 核決區：左欄（額度）／右欄（條件）固定比例，標籤寬固定 → 垂直格線對齊
  const COL_L = Math.floor(contentW * 0.48);
  const COL_R = contentW - COL_L;
  const LW_L = 118; // 左標籤（業務員申請額度、副總建議…）
  const LW_R = 96; // 右標籤（要求條件、建檔備註）

  const created = toRocParts(request.created_at || formData.apply_date);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at || formData.apply_date);

  const groupName = formData.group_name || '—';

  // 1. 抬頭
  drawHeader(
    '信 用 額 度 申 請 表',
    `申請日期：${applyDateText}　｜　組別：${groupName}`,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 基本資料 (申請人/部門)
  sectionBar('申請資訊');
  const applicant = request.requester_name || '—';
  const dept = request.requester_dept || '—';
  drawRow(
    [
      { w: HALF, label: '申請人', value: applicant, labelW: STD_LW },
      { w: HALF_R, label: '部門', value: dept, labelW: STD_LW },
    ],
    28
  );

  // 2. 第一區塊：客戶基本資料與申請內容
  sectionBar('一、客戶基本資料與申請內容');
  drawRow(
    [
      {
        w: HALF,
        label: '客戶名稱',
        value: formatDisplayValue(formData.customer_name),
        labelW: STD_LW,
      },
      {
        w: HALF_R,
        label: '客戶代號',
        value: formatDisplayValue(formData.tax_id),
        labelW: STD_LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: HALF,
        label: '公司性質',
        value: formatDisplayValue(formData.company_type),
        labelW: STD_LW,
      },
      {
        w: HALF_R,
        label: '客戶類別',
        value: formatDisplayValue(formData.customer_type),
        labelW: STD_LW,
      },
    ],
    28
  );

  const tradingProducts = formatDisplayValue(formData.trading_products);
  const tpHeight = Math.max(
    32,
    Math.min(100, measureTextH(tradingProducts, contentW - STD_LW - 16) + 14)
  );
  drawRow(
    [
      {
        w: contentW,
        label: '交易產品',
        value: tradingProducts,
        labelW: STD_LW,
        multi: true,
      },
    ],
    tpHeight
  );

  const reqLimitVal =
    ad.requested_credit_limit ?? formData.requested_credit_limit;
  const requestedLimit = formatYuanWanStyle(reqLimitVal);
  const reasonText = formatDisplayValue(
    ad.reason_for_increase ?? formData.reason_for_increase
  );
  const reasonHeight = Math.max(
    32,
    Math.min(120, measureTextH(reasonText, COL_R - STD_LW - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '申請信用額度',
        value: requestedLimit,
        labelW: STD_LW,
        valueColor: '#c2410c',
      },
      {
        w: COL_R,
        label: '增加額度原由',
        value: reasonText,
        labelW: STD_LW,
        multi: true,
      },
    ],
    reasonHeight
  );

  // 3. 第二區塊：截至目前放帳金額（四欄等寬、標籤同寬）
  sectionBar('二、截至目前放帳金額（含已收未兌現票據及未收款）');
  const creditLimitVal = formatYuanWanStyle(formData.credit_limit_current);
  const arVal = formatYuanWanStyle(formData.accounts_receivable);
  const nrVal = formatYuanWanStyle(formData.notes_receivable);
  const balVal = formatYuanWanStyle(formData.credit_balance);
  drawRow(
    [
      {
        w: Q,
        label: '授信額度',
        value: creditLimitVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q,
        label: '待收帳款',
        value: arVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q,
        label: '待收票據',
        value: nrVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q_LAST,
        label: '授信餘額',
        value: balVal,
        labelW: Q_LW,
        align: 'center',
        valueColor: '#0f766e',
      },
    ],
    28
  );

  // 4. 第三區塊：銀行徵信與收款狀況（雙欄對齊）
  sectionBar('三、銀行徵信與收款狀況');
  const BANK_LW = 100;
  drawRow(
    [
      {
        w: HALF,
        label: '往來銀行及分行',
        value: formatDisplayValue(formData.bank_name),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '甲存帳號／開戶日',
        value: formatDisplayValue(formData.bank_account),
        labelW: BANK_LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: HALF,
        label: '存款基數／往來',
        value: formatDisplayValue(formData.bank_status),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '收款狀況',
        value: formatDisplayValue(formData.payment_status),
        labelW: BANK_LW,
      },
    ],
    28
  );

  // 業務人員：取「業務人員」步驟核准人
  const salesActors = actorsForStep(
    request.actions,
    (name) =>
      /業務/.test(String(name || '')) &&
      !/副總|總經|財務/.test(String(name || ''))
  );
  const salesName = salesActors.names || '';
  drawRow(
    [
      {
        w: HALF,
        label: '徵信人',
        value: formatDisplayValue(formData.credit_checker),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '業務人員',
        value: salesName || '—',
        labelW: BANK_LW,
      },
    ],
    28
  );

  // 5. 第四區塊：核決（左額度／右條件，標籤寬固定 → 格線垂直對齊）
  sectionBar('四、核決權限與審核建議');

  const salesVal =
    ad.requested_credit_limit ??
    ad.sales_requested_limit ??
    formData.requested_credit_limit ??
    ad.finance_suggested_limit;
  // 金額僅顯示數值；業務姓名已改至「業務人員」欄
  const salesLimit = formatYuanWanStyle(salesVal);
  const salesCond = formatDisplayValue(
    ad.sales_conditions || ad.finance_conditions
  );
  const salesH = Math.max(
    30,
    Math.min(80, measureTextH(salesCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '業務員申請額度',
        value: salesLimit,
        labelW: LW_L,
        valueColor: '#c2410c',
      },
      {
        w: COL_R,
        label: '業務員要求條件',
        value: salesCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    salesH
  );

  // 副總
  const vpLimit = formatYuanWanStyle(ad.vp_suggested_limit);
  const vpCond = formatDisplayValue(ad.vp_conditions);
  const vpH = Math.max(
    30,
    Math.min(80, measureTextH(vpCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '副總建議（權限1,000,000元）',
        value: vpLimit,
        labelW: LW_L,
      },
      {
        w: COL_R,
        label: '副總要求條件',
        value: vpCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    vpH
  );

  // 總經理
  const gmApprovedRaw =
    ad.gm_approved_limit != null && ad.gm_approved_limit !== ''
      ? ad.gm_approved_limit
      : null;
  const gmLimit = formatYuanWanStyle(gmApprovedRaw);
  const gmCond = formatDisplayValue(ad.gm_conditions);
  const gmH = Math.max(
    32,
    Math.min(80, measureTextH(gmCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '總經理核定額度',
        value: gmLimit,
        labelW: LW_L,
        valueColor: '#b91c1c',
      },
      {
        w: COL_R,
        label: '總經理要求條件',
        value: gmCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    gmH
  );

  // 財務部建立額度／建檔備註
  const finAction = (request.actions || []).find(
    (a) =>
      a &&
      (a.step_name === '財務部額度建檔確認' ||
        /財務部.*建檔|額度建檔確認/.test(String(a.step_name || '')))
  );
  let finFd = {};
  if (finAction?.form_data) {
    if (typeof finAction.form_data === 'string') {
      try {
        finFd = JSON.parse(finAction.form_data || '{}') || {};
      } catch {
        finFd = {};
      }
    } else if (typeof finAction.form_data === 'object') {
      finFd = finAction.form_data || {};
    }
  }
  const financeConfirmed =
    !!finAction ||
    ad.limit_established_status === '已完成建立' ||
    finFd.limit_established_status === '已完成建立';

  const estLimitVal =
    gmApprovedRaw != null
      ? formatYuanWanStyle(gmApprovedRaw)
      : financeConfirmed &&
          (finFd.gm_approved_limit != null || ad.finance_established_limit != null)
        ? formatYuanWanStyle(
            finFd.gm_approved_limit ?? ad.finance_established_limit
          )
        : '—';
  const estNote = financeConfirmed
    ? String(
        finFd.finance_establishment_extra_note ||
          ad.finance_establishment_extra_note ||
          finFd.finance_establishment_note ||
          ad.finance_establishment_note ||
          ''
      ).trim() || '已於ERP系統完成授信額度設定'
    : request.status === 'approved'
      ? '待財務部建檔'
      : '—';
  const estH = Math.max(
    30,
    Math.min(80, measureTextH(String(estNote), COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '財務部建立額度',
        value: estLimitVal,
        labelW: LW_L,
        valueColor: '#0f766e',
      },
      {
        w: COL_R,
        label: '財務部建檔備註',
        value: estNote,
        labelW: LW_R,
        multi: true,
      },
    ],
    estH
  );

  // 6. 備註說明區塊
  ensureSpace(55);
  kit.y += 8;
  useFont();

  // 底色背框
  const noteBoxH = 45;
  doc.rect(leftX, kit.y, contentW, noteBoxH)
     .fillAndStroke('#f8fafc', '#cbd5e1');

  doc.fontSize(8.5).fillColor('#334155');
  doc.text('備註說明：', leftX + 8, kit.y + 6);
  doc.text('(一) 授信餘額 ＝ 授信額度(信用額度) － 待收帳款(應收帳款) － 待收票據(應收票據)', leftX + 55, kit.y + 6);
  doc.text(
    '(二) 應備附件：(a) 客戶最近3年交易清單　(b) 應收帳款餘額表　(c) 商工登記公示資料查詢（可由網路取得）',
    leftX + 55,
    kit.y + 18
  );
  doc.text('(三) 表單流程：申請人提出申請 → 業務人員確認 → 副總經理核示 → 總經理核定 → 財務部建立額度。', leftX + 55, kit.y + 30);
  kit.y += noteBoxH + 8;

  // 附件與歷程
  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

/**
 * 職工福利金明細表（對齊紙本：日期／摘要／存入／支出／餘額）
 */
function drawWelfareForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.memo);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    FS_VALUE,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  let rocYear = String(
    pickFormValue(formData, formFields, ['period_roc_year', 'roc_year'], /民國年|年度/) ||
      ''
  ).trim();
  if (!rocYear) {
    const createdY = toRocParts(request.created_at);
    rocYear = String(createdY.y || new Date().getFullYear() - 1911);
  }
  const monthRaw = String(
    pickFormValue(formData, formFields, ['period_month', 'month'], /月份|所屬月/) || ''
  ).trim();
  const monthNum = String(monthRaw).replace(/[^\d]/g, '');
  const reportDate = pickFormValue(
    formData,
    formFields,
    ['report_date', 'sheet_date'],
    /製表日期|製表日/
  );
  const opening = welfareAmtNum(
    pickFormValue(
      formData,
      formFields,
      ['opening_balance'],
      /結轉餘額|上月結轉|期初/
    )
  );
  let openingSummary = String(
    pickFormValue(
      formData,
      formFields,
      ['opening_summary'],
      /結轉摘要|上月結轉摘要/
    ) || ''
  ).trim();
  if (!openingSummary && rocYear && monthNum) {
    const m = Number(monthNum);
    const prevM = m <= 1 ? 12 : m - 1;
    const prevY = m <= 1 ? Number(rocYear) - 1 : rocYear;
    openingSummary = `${prevY}年${prevM}月份結轉`;
  }

  const items = parseWelfareItems(
    formData.welfare_items || formData.items || formData.明細
  );
  const reportP = toRocParts(reportDate || request.created_at);
  const reportDateText =
    reportP.y !== ''
      ? `民國 ${reportP.y} 年 ${reportP.m} 月 ${reportP.d} 日`
      : formatDisplayValue(reportDate || request.created_at);
  const periodTitle =
    rocYear && monthNum
      ? `${rocYear}年${Number(monthNum)}月份福利金明細月報表`
      : '福利金明細月報表';

  drawHeader(
    periodTitle,
    reportDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '製表人',
        value: request.requester_name || '—',
        labelW: 56,
      },
      {
        w: contentW - half,
        label: '單位',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: half,
        label: '所屬月份',
        value:
          rocYear && monthNum ? `民國 ${rocYear} 年 ${Number(monthNum)} 月` : '—',
        labelW: 70,
      },
      {
        w: contentW - half,
        label: '製表日期',
        value: reportDateText,
        labelW: 70,
      },
    ],
    28
  );

  const dateW = 62;
  const moneyW = 78;
  const balW = 72;
  const sumW = contentW - dateW - moneyW * 2 - balW;
  const rowH = 24;
  const headerH = 26;
  const minBody = 8;

  const ledger = [];
  ledger.push({
    date: '',
    summary: openingSummary || '上月結轉',
    deposit: '',
    withdraw: '',
    balance: opening,
    opening: true,
  });
  let bal = opening;
  let sumIn = 0;
  let sumOut = 0;
  for (const it of items) {
    const dep = welfareAmtNum(it.deposit);
    const wd = welfareAmtNum(it.withdraw);
    bal += dep - wd;
    sumIn += dep;
    sumOut += wd;
    ledger.push({
      date: welfareRocDate(it.date),
      summary: String(it.summary || '').trim(),
      deposit: dep,
      withdraw: wd,
      balance: bal,
    });
  }
  while (ledger.length < minBody) {
    ledger.push({
      date: '',
      summary: '',
      deposit: '',
      withdraw: '',
      balance: '',
      empty: true,
    });
  }

  function drawLedgerRow(cells, h, opts = {}) {
    ensureSpace(h + 1);
    const y0 = kit.y;
    fillRect(leftX, y0, contentW, h, opts.bg || C.white);
    if (opts.head) fillRect(leftX, y0, contentW, h, C.sectionBg);
    strokeRect(leftX, y0, contentW, h, C.lineDark, 0.65);
    let x = leftX;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (i > 0) {
        doc
          .moveTo(x, y0)
          .lineTo(x, y0 + h)
          .strokeColor(C.line)
          .lineWidth(0.55)
          .stroke();
      }
      if (c.wrap) {
        useFont();
        const size = opts.head ? 10.5 : c.size || FS_VALUE;
        doc.fontSize(size);
        const th = doc.heightOfString(String(c.text || ' '), {
          width: Math.max(8, c.w - 8),
          lineGap: 1,
        });
        const ty = y0 + Math.max(3, (h - Math.min(th, h - 4)) / 2);
        doc
          .fillColor(opts.head ? C.header : C.ink)
          .text(String(c.text || ''), x + 4, ty, {
            width: Math.max(8, c.w - 8),
            lineGap: 1,
            height: h - 4,
          });
      } else {
        textMid(c.text, x + 4, y0, c.w - 8, h, {
          size: opts.head ? 10.5 : c.size || FS_VALUE,
          color: opts.head ? C.header : C.ink,
          align: c.align || 'left',
        });
      }
      x += c.w;
    }
    kit.y += h;
  }

  kit.y += 6;
  drawLedgerRow(
    [
      { w: dateW, text: '日期', align: 'center' },
      { w: sumW, text: '摘　　要', align: 'center' },
      { w: moneyW, text: '存　　入', align: 'center' },
      { w: moneyW, text: '支　　出', align: 'center' },
      { w: balW, text: '餘　　額', align: 'center' },
    ],
    headerH,
    { head: true }
  );

  for (const row of ledger) {
    useFont();
    doc.fontSize(10);
    const sumTextH = doc.heightOfString(String(row.summary || ' '), {
      width: Math.max(8, sumW - 8),
      lineGap: 1,
    });
    const thisH = Math.max(rowH, Math.min(44, sumTextH + 8));
    drawLedgerRow(
      [
        { w: dateW, text: row.date || '', align: 'center', size: 10 },
        {
          w: sumW,
          text: row.summary || '',
          align: 'left',
          size: 10,
          wrap: true,
        },
        {
          w: moneyW,
          text: row.empty ? '' : welfareAmtText(row.deposit),
          align: 'right',
          size: 10,
        },
        {
          w: moneyW,
          text: row.empty ? '' : welfareAmtText(row.withdraw),
          align: 'right',
          size: 10,
        },
        {
          w: balW,
          text: row.empty ? '' : welfareAmtText(row.balance, { blankZero: false }),
          align: 'right',
          size: 10,
        },
      ],
      thisH,
      { bg: row.opening ? C.altBg : C.white }
    );
  }

  drawLedgerRow(
    [
      { w: dateW, text: '', align: 'center' },
      { w: sumW, text: '合　　計', align: 'center' },
      { w: moneyW, text: welfareAmtText(sumIn, { blankZero: false }), align: 'right' },
      { w: moneyW, text: welfareAmtText(sumOut, { blankZero: false }), align: 'right' },
      {
        w: balW,
        text: welfareAmtText(opening + sumIn - sumOut, { blankZero: false }),
        align: 'right',
      },
    ],
    28,
    { bg: C.headerSoft, head: true }
  );

  // 簽核欄：總經理／副總／財務部／福利委員會（該關核准人；委員會另含申請人）
  const collectSignNames = (matcher, includeRequester) => {
    const names = [];
    const seen = new Set();
    const push = (n) => {
      const s = String(n || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      names.push(s);
    };
    if (includeRequester) push(request.requester_name);
    const match =
      typeof matcher === 'function'
        ? matcher
        : (name) => matcher.test(String(name || ''));
    const steps = request.steps || request.templateSteps || [];
    const orders = new Set(
      steps
        .filter(
          (s) =>
            match(String(s.name || '')) || match(String(s.department || ''))
        )
        .map((s) => Number(s.order))
        .filter((n) => n > 0)
    );
    for (const a of request.actions || []) {
      if (String(a.action || '') !== 'approve') continue;
      const sn = String(a.step_name || '');
      const so = Number(a.step_order);
      if (match(sn) || orders.has(so)) push(a.actor_name);
    }
    return names;
  };
  const signBoxes = [
    {
      label: '總經理',
      names: collectSignNames(
        (n) => /總經理/.test(n) && !/副總/.test(n)
      ),
    },
    { label: '副總', names: collectSignNames(/副總/) },
    { label: '財務部', names: collectSignNames(/財務/) },
    {
      label: '福利委員會',
      names: collectSignNames(/福利委員會/, true),
    },
  ];
  const maxNames = Math.max(1, ...signBoxes.map((b) => b.names.length || 1));
  const signH = Math.max(64, 42 + Math.min(4, maxNames) * 14);
  kit.y += 10;
  ensureSpace(signH + 8);
  const signW = Math.floor(contentW / 4);
  const signY = kit.y;
  for (let i = 0; i < 4; i++) {
    const x = leftX + signW * i;
    const w = i === 3 ? contentW - signW * 3 : signW;
    fillRect(x, signY, w, signH, C.white);
    strokeRect(x, signY, w, signH, C.lineDark, 0.65);
    textMid(signBoxes[i].label, x + 4, signY + 4, w - 8, 18, {
      size: 10,
      color: C.softInk,
      align: 'center',
    });
    const text = (signBoxes[i].names || []).join('、');
    if (!text) continue;
    useFont();
    const size = signBoxes[i].names.length > 2 ? 8.5 : 10.5;
    doc.fontSize(size);
    const th = doc.heightOfString(text, {
      width: Math.max(8, w - 10),
      lineGap: 1,
    });
    const ty =
      signY + 22 + Math.max(0, (signH - 28 - Math.min(th, signH - 30)) / 2);
    doc.fillColor(C.ink).text(text, x + 5, ty, {
      width: Math.max(8, w - 10),
      align: 'center',
      lineGap: 1,
      height: signH - 28,
    });
  }
  kit.y += signH + 8;

  const atts = request.attachments || [];
  if (atts.length) {
    sectionBar('附件');
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: `附件 ${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: 64,
          },
        ],
        24
      );
    }
  }

  kit.y += 8;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 福利委員會 → 財務部 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 32;
  drawActionsHistory(request.actions);
}

function drawDeptMeetingForm(ctx, request) {
  const { doc, useFont, leftX, contentW, pageH, margin } = ctx;
  const formData = request.form_data || {};
  const T = FORM_UI_THEMES.memo || {
    header: '#1e3a5f',
    headerSoft: '#e8eef6',
    sectionBg: '#dbe4f0',
    labelBg: '#eef2f7',
    line: '#94a3b8',
    lineDark: '#334155',
    altBg: '#f8fafc',
  };
  const C = {
    ink: '#0f172a',
    muted: '#64748b',
    header: T.header || '#1e3a5f',
    headerSoft: T.headerSoft || '#e8eef6',
    sectionBg: T.sectionBg || '#dbe4f0',
    labelBg: T.labelBg || '#eef2f7',
    line: T.line || '#94a3b8',
    lineDark: T.lineDark || '#334155',
    white: '#ffffff',
    altBg: T.altBg || '#f8fafc',
  };
  const kit = createSimpleTableKit(ctx, C);
  const { fillRect, strokeRect, textMid, drawRow, ensureSpace } = kit;
  const LW = 78;

  const company = getCompanyNameForPdf();
  const headH = 78;
  fillRect(leftX, kit.y, contentW, 5, C.header);
  fillRect(leftX, kit.y + 5, contentW, headH - 5, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, headH, C.lineDark, 0.9);
  useFont();
  doc
    .fillColor(C.header)
    .fontSize(10)
    .text('ARGO TECHNOLOGY CO., Ltd.', leftX, kit.y + 10, {
      width: contentW,
      align: 'center',
    });
  doc
    .fontSize(12)
    .text(company, leftX, kit.y + 26, { width: contentW, align: 'center' });
  doc
    .moveTo(leftX + contentW * 0.28, kit.y + 44)
    .lineTo(leftX + contentW * 0.72, kit.y + 44)
    .strokeColor(C.header)
    .lineWidth(0.9)
    .stroke();
  doc
    .fontSize(18)
    .text('會　　議　　記　　錄', leftX, kit.y + 50, {
      width: contentW,
      align: 'center',
    });
  kit.y += headH + 8;

  const metaH = 22;
  fillRect(leftX, kit.y, contentW, metaH, C.altBg);
  strokeRect(leftX, kit.y, contentW, metaH, C.line, 0.5);
  textMid(
    `單號 #${request.id}　${STATUS_LABEL[request.status] || request.status || ''}`,
    leftX + 8,
    kit.y,
    contentW - 16,
    metaH,
    { size: 9, color: C.muted, align: 'right' }
  );
  kit.y += metaH + 6;

  const subject = String(formData.meeting_subject || '').trim() || '—';
  const chair = String(formData.chair || '').trim() || '—';
  const place = String(formData.meeting_place || '').trim() || '—';
  const attendees = resolveMeetingAttendeeNames(request);
  const when = meetingDateTextPdf(formData.meeting_date);

  drawRow(
    [{ w: contentW, label: '會議主題', value: subject, labelW: LW }],
    28
  );
  drawRow(
    [
      { w: contentW * 0.5, label: '主席', value: chair, labelW: LW },
      { w: contentW * 0.5, label: '會議時間', value: when, labelW: LW },
    ],
    28
  );
  drawRow(
    [{ w: contentW, label: '會議地點', value: place, labelW: LW }],
    28
  );
  const attH = Math.max(
    36,
    Math.min(90, kit.measureTextH(attendees, contentW - LW - 16) + 16)
  );
  drawRow(
    [
      {
        w: contentW,
        label: '出席人員',
        value: attendees,
        labelW: LW,
        multi: true,
      },
    ],
    attH
  );

  drawRichContentInExplainSection(kit, ctx, formData.minutes || '', {
    sectionTitle: '會議討論內容摘要及決議',
    legacyTable: formData.minutes__table || null,
  });

  const items = parseFollowupItems(formData.followup_items).filter(
    (it) => it && (it.item || it.owner || it.due)
  );
  while (items.length < 2) items.push({ item: '', owner: '', due: '' });
  const colItem = Math.floor(contentW * 0.56);
  const colOwner = Math.floor(contentW * 0.18);
  const colDue = contentW - colItem - colOwner;
  const headH2 = 26;
  ensureSpace(headH2 + 28);
  fillRect(leftX, kit.y, contentW, headH2, C.sectionBg);
  strokeRect(leftX, kit.y, contentW, headH2, C.lineDark, 0.7);
  textMid('後續交辦事項', leftX + 4, kit.y, colItem - 8, headH2, {
    size: 11,
    color: C.header,
  });
  textMid('承辦人', leftX + colItem, kit.y, colOwner, headH2, {
    size: 11,
    color: C.header,
  });
  textMid('完成期限', leftX + colItem + colOwner, kit.y, colDue, headH2, {
    size: 11,
    color: C.header,
  });
  doc
    .moveTo(leftX + colItem, kit.y)
    .lineTo(leftX + colItem, kit.y + headH2)
    .strokeColor(C.lineDark)
    .lineWidth(0.6)
    .stroke();
  doc
    .moveTo(leftX + colItem + colOwner, kit.y)
    .lineTo(leftX + colItem + colOwner, kit.y + headH2)
    .strokeColor(C.lineDark)
    .lineWidth(0.6)
    .stroke();
  kit.y += headH2;
  for (const it of items) {
    const itemText = String(it.item || '').trim() || ' ';
    const h = Math.max(
      26,
      Math.min(70, kit.measureTextH(itemText, colItem - 10) + 12)
    );
    ensureSpace(h + 2);
    const y = kit.y;
    fillRect(leftX, y, contentW, h, C.white);
    strokeRect(leftX, y, contentW, h, C.line, 0.55);
    doc
      .moveTo(leftX + colItem, y)
      .lineTo(leftX + colItem, y + h)
      .strokeColor(C.line)
      .lineWidth(0.5)
      .stroke();
    doc
      .moveTo(leftX + colItem + colOwner, y)
      .lineTo(leftX + colItem + colOwner, y + h)
      .strokeColor(C.line)
      .lineWidth(0.5)
      .stroke();
    useFont();
    doc
      .fillColor(C.ink)
      .fontSize(10)
      .text(itemText, leftX + 6, y + 6, {
        width: colItem - 12,
        height: h - 8,
      });
    textMid(String(it.owner || ''), leftX + colItem, y, colOwner, h, {
      size: 10,
      color: C.ink,
    });
    const due = String(it.due || '').trim();
    const dueText = /^\d{4}-\d{2}-\d{2}/.test(due)
      ? (() => {
          const p = toRocParts(due);
          return p.y !== '' ? `${p.y}/${Number(p.m)}/${Number(p.d)}` : due;
        })()
      : due;
    textMid(dueText, leftX + colItem + colOwner, y, colDue, h, {
      size: 10,
      color: C.ink,
    });
    kit.y = y + h;
  }

  kit.y += 8;
  kit.drawActionsHistory(request.actions);
}

function writeApprovalPdf(request, destStream) {
  const pl = request.pdfLayout || {};
  if (pl.type === 'pdf_template' && pl.templateFile) {
    const templateRel = String(pl.templateFile).replace(/^[/\\]+/, '');
    const templateAbs = path.join(__dirname, '..', 'data', templateRel);
    if (fs.existsSync(templateAbs)) {
      const { renderPdfTemplate } = require('./pdf-template-engine');
      const db = require('./db');
      return renderPdfTemplate({
        templateAbsPath: templateAbs,
        fields: pl.fields || [],
        formData: request.form_data || {},
        actions: request.actions || [],
        requester: {
          id: request.requester_id,
          name: request.requester_name,
          username: request.requester_username,
        },
        request: {
          id: request.id,
          title: request.title,
          created_at: request.created_at,
          status: request.status,
        },
        db,
      }).then((buf) => {
        destStream.end(buf);
      });
    }
  }

  return new Promise((resolve, reject) => {
    const fontPath = getChineseFontPath();
    const margin = 40;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      autoFirstPage: true,
      bufferPages: true, // 供最後在各頁蓋「核准」章
      info: {
        Title: `${request.workflow_name || '簽核單'}-${request.id}`,
        Author: getCompanyNameForPdf(),
      },
    });

    destStream.on('error', reject);
    doc.on('error', reject);
    doc.on('end', () => resolve());
    doc.pipe(destStream);

    let fontReady = false;
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
        fontReady = true;
        console.log('[pdf] using font:', fontPath);
      } catch (e) {
        console.error('[pdf] font register failed:', fontPath, e.message);
        fontReady = false;
      }
    }

    function useFont() {
      if (fontReady) {
        try {
          doc.font('CJK');
        } catch {
          /* ignore */
        }
      }
    }

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const leftX = margin;

    // 作廢申請：標準表單，抬頭顯示「作廢申請」（勿套用原單請假／簽呈版面）
    if (isVoidApplicationRequest(request)) {
      try {
        drawStandardWorkflowForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] void application form failed', e);
        reject(e);
      }
      return;
    }

    // 部門月會會議記錄
    if (isDeptMeetingRequest(request)) {
      try {
        drawDeptMeetingForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        stampMeetingDocCode(doc, useFont, { leftX, contentW, pageH });
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] dept meeting form failed', e);
        reject(e);
      }
      return;
    }

    // 職工福利金明細表
    if (isWelfareRequest(request)) {
      try {
        drawWelfareForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] welfare form failed', e);
        reject(e);
      }
      return;
    }

    // 信用額度申請表
    if (isCreditLimitRequest(request)) {
      try {
        drawCreditLimitForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] credit limit form failed', e);
        reject(e);
      }
      return;
    }

    // 請假單：專用版面
    if (isLeaveRequest(request)) {
      try {
        drawLeaveForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] leave form failed', e);
        reject(e);
      }
      return;
    }

    // 請購申請
    if (isPurchaseRequest(request)) {
      try {
        drawPurchaseForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] purchase form failed', e);
        reject(e);
      }
      return;
    }

    // 費用報支
    if (isExpenseRequest(request)) {
      try {
        drawExpenseForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] expense form failed', e);
        reject(e);
      }
      return;
    }

    // 出差申請
    if (isTravelRequest(request)) {
      try {
        drawTravelForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] travel form failed', e);
        reject(e);
      }
      return;
    }

    // 電腦異常報修
    if (isItRepairRequest(request)) {
      try {
        drawItRepairForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] it repair form failed', e);
        reject(e);
      }
      return;
    }

    // 延長工時／加班
    if (isOvertimeRequest(request)) {
      try {
        drawOvertimeForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] overtime form failed', e);
        reject(e);
      }
      return;
    }

    // 一般簽呈
    if (isGeneralMemoRequest(request)) {
      try {
        drawGeneralMemoForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] general memo form failed', e);
        reject(e);
      }
      return;
    }

    // 其餘／新建簽核流程：一律使用標準表單版型（與現行各表風格一致）
    try {
      drawStandardWorkflowForm(
        { doc, useFont, leftX, contentW, pageH, margin },
        request
      );
      endPdfWithApprovedStamp(doc, request, useFont);
    } catch (e) {
      console.error('[pdf] standard form failed', e);
      reject(e);
    }
  });
}

/**
 * 檔名安全字元（移除路徑／非法字元）
 */
function safeFilePart(s, fallback = '—') {
  const t = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim()
    .slice(0, 40);
  return t || fallback;
}

/**
 * 日期 YYYYMMDD（優先申請建立日）
 */
function formatDateYmdCompact(val) {
  if (!val) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  const s = String(val).trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${mo}${day}`;
  }
  return formatDateYmdCompact(null);
}

/**
 * PDF／ZIP 檔名規則：表單名稱_申請人_日期+五位數流水號
 * 例：請假申請_王小明_2026071800012
 * 流水號採單號 id 右側補滿 5 位
 */
function buildApprovalFileBaseName(request) {
  const form = safeFilePart(request.workflow_name || '簽核申請', '簽核申請');
  const applicant = safeFilePart(request.requester_name || '申請人', '申請人');
  const datePart = formatDateYmdCompact(
    request.created_at || request.completed_at || null
  );
  const serial = String(Math.abs(Number(request.id) || 0))
    .padStart(5, '0')
    .slice(-5);
  return `${form}_${applicant}_${datePart}${serial}`;
}

function buildApprovalPdfFileName(request) {
  return `${buildApprovalFileBaseName(request)}.pdf`;
}

/**
 * ZIP 檔名：僅有附件時才加「_含附件」
 * （例如加密備份無附件時為 xxx.zip，不寫含附件）
 * @param {object} request
 * @param {{ hasAttachments?: boolean }} [opts]
 */
function buildApprovalZipFileName(request, opts = {}) {
  const hasAttachments = opts.hasAttachments !== false;
  const base = buildApprovalFileBaseName(request);
  return hasAttachments ? `${base}_含附件.zip` : `${base}.zip`;
}

/** Content-Disposition（ASCII fallback + UTF-8 檔名） */
function contentDispositionAttachment(utfFileName, asciiFallback) {
  const ascii =
    asciiFallback ||
    String(utfFileName || 'download.bin')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_') ||
    'download.bin';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utfFileName)}`;
}

/** HTTP 下載用 */
function generateApprovalPdf(request, res) {
  res.setHeader('Content-Type', 'application/pdf');
  const utfName = buildApprovalPdfFileName(request);
  const asciiName = `approval-${request.id || 0}.pdf`;
  res.setHeader(
    'Content-Disposition',
    contentDispositionAttachment(utfName, asciiName)
  );
  return writeApprovalPdf(request, res);
}

module.exports = {
  generateApprovalPdf,
  writeApprovalPdf,
  getChineseFontPath,
  resolveChineseFont,
  buildApprovalFileBaseName,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
  safeFilePart,
  formatPersonalLeavePdfTotal,
  computePersonalLeavePortion,
  buildLeaveAutoTitle,
  formatLeaveTitlePeriod,
};
