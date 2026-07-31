/**
 * 休假餘額試算
 *
 * 【可休天數】一律由成員名單「手動」設定（leave_entitled_json），
 * 不再依到職年資／勞基法第 38 條自動計算特休。
 *
 * 統計年度採「曆年制」：每年 1/1～12/31。
 * 已休＝成員名單手動已休（天數＋小時）＋本系統已核准請假。
 * 剩餘＝可休 − 已休（全日＝7.5 小時）。
 *
 * 到職日／年資僅供顯示參考，不影響可休日數。
 */
const db = require('./db');

/** 與請假試算一致：全日 7.5 小時 */
const WORK_DAY_HOURS = 7.5;

function snapHalf(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 2) / 2;
}

/** 正規化非負 0.5 單位數值；空白視為 0 */
function parseHalfUnit(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return snapHalf(n);
}

/** 正規化日期字串 YYYY-MM-DD */
function toDateOnly(val) {
  if (!val) return null;
  const s = String(val).trim().replace(/\//g, '-').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function parseLocalDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 計算年資（到 asOf 為止）
 * @returns {{ years: number, months: number, totalMonths: number, label: string }}
 */
function calcSeniority(hireDate, asOf = new Date()) {
  const hire = toDateOnly(hireDate);
  if (!hire) {
    return { years: 0, months: 0, totalMonths: 0, label: '—', hireDate: null };
  }
  const h = parseLocalDate(hire);
  const a =
    asOf instanceof Date
      ? new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
      : parseLocalDate(toDateOnly(asOf) || formatYmd(new Date()));

  if (a < h) {
    return { years: 0, months: 0, totalMonths: 0, label: '未滿到職日', hireDate: hire };
  }

  let years = a.getFullYear() - h.getFullYear();
  let months = a.getMonth() - h.getMonth();
  let days = a.getDate() - h.getDate();
  if (days < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalMonths = years * 12 + months;
  const label =
    totalMonths <= 0 && a >= h
      ? '未滿 1 個月'
      : years > 0
        ? `${years} 年 ${months} 個月`
        : `${months} 個月`;

  return { years, months, totalMonths, label, hireDate: hire };
}

/**
 * 依勞基法第 38 條計算特休應給日數（依「已滿」年資）
 * - 6 個月以上 1 年未滿：3 日
 * - 1 年以上 2 年未滿：7 日
 * - 2 年以上 3 年未滿：10 日
 * - 3 年以上 5 年未滿：14 日
 * - 5 年以上 10 年未滿：15 日
 * - 10 年以上：每一年加給 1 日，加至 30 日（滿 10 年＝16 日）
 */
function specialLeaveEntitlementDays(totalMonths) {
  const m = Number(totalMonths) || 0;
  if (m < 6) return 0;
  if (m < 12) return 3;
  const years = Math.floor(m / 12);
  if (years < 2) return 7;
  if (years < 3) return 10;
  if (years < 5) return 14;
  if (years < 10) return 15;
  // 滿 10 年：16 日；其後每年 +1，上限 30
  return Math.min(30, 15 + (years - 9));
}

/** 兩日期間含首尾的天數（例：1/1～1/1＝1） */
function inclusiveDayCount(startDate, endDate) {
  const a = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const b = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * 曆年制特休「應有」日數（比例法）
 *
 * 當到職週年日落在該曆年中：
 *   應有 = 週年前年資日數 × (1/1～週年前一日) / 年日數
 *        + 週年後年資日數 × (週年日～12/31) / 年日數
 *
 * 例：到職 2009-07-01，2026 年
 *   週年前 16 年→22 日 × 181/365 + 週年後 17 年→23 日 × 184/365 ≈ 22.5 日
 *
 * 當年中途到職：自到職日至 12/31 按「到職時年資對應日數」比例計算。
 * 結果以 0.5 日為單位（四捨五入至 0.5）。
 */
function specialLeaveEntitlementDaysCalendar(hireDate, asOf = new Date()) {
  const hire = toDateOnly(hireDate);
  if (!hire) return { entitled: 0, detail: null };

  const a =
    asOf instanceof Date
      ? new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
      : parseLocalDate(toDateOnly(asOf) || formatYmd(new Date()));
  const h = parseLocalDate(hire);
  if (a < h) return { entitled: 0, detail: null };

  const y = a.getFullYear();
  const yearStart = new Date(y, 0, 1);
  const yearEnd = new Date(y, 11, 31);
  const yearDays = inclusiveDayCount(yearStart, yearEnd); // 365 或 366

  // 本曆年實際起算日（當年才到職則自到職日）
  const periodStart = h > yearStart ? h : yearStart;
  if (periodStart > yearEnd) return { entitled: 0, detail: null };

  // 該曆年內的到職週年日（月／日同到職日）
  let anniversary = new Date(y, h.getMonth(), h.getDate());
  // 處理 2/29 到職在非閏年
  if (anniversary.getMonth() !== h.getMonth()) {
    anniversary = new Date(y, h.getMonth() + 1, 0); // 該月最後一天
  }

  // —— 當年才到職：僅一段（到職～年底），應休日數依「到職滿半年後」等法定，採到年底時年資 ——
  // 實務上曆年制新人：多以「到職日至年底」占全年比例 × 滿一年後年資日數，
  // 但未滿 6 個月仍為 0。此處採：依「週年日前若尚未滿一年」用當下已滿月數對應日數 × 剩餘日數/年日數
  if (h.getFullYear() === y) {
    // 新人：以年底年資計算法定日數，再 × (在職天數/年日數)
    const senAtEnd = calcSeniority(hire, yearEnd);
    const baseDays = specialLeaveEntitlementDays(senAtEnd.totalMonths);
    const workDays = inclusiveDayCount(periodStart, yearEnd);
    const entitled = snapHalf((baseDays * workDays) / yearDays);
    return {
      entitled,
      detail: {
        mode: 'calendar-prorate-newhire',
        year: y,
        yearDays,
        workDays,
        baseDays,
        formula: `${baseDays} × ${workDays}/${yearDays}`,
      },
    };
  }

  // —— 週年日不在本曆年內（理論上不會，月日總會落在年中）——
  // 若週年日落在 periodStart 之前（例如到職 1/1），整年同一年資（以年底／週年為準用較高段）
  if (anniversary < periodStart) {
    const sen = calcSeniority(hire, yearEnd);
    const days = specialLeaveEntitlementDays(sen.totalMonths);
    return {
      entitled: days,
      detail: { mode: 'calendar-full', year: y, days },
    };
  }
  if (anniversary > yearEnd) {
    const sen = calcSeniority(hire, yearEnd);
    const days = specialLeaveEntitlementDays(sen.totalMonths);
    return {
      entitled: days,
      detail: { mode: 'calendar-full', year: y, days },
    };
  }

  // 週年日前一日之年資 → 前段應休
  const dayBeforeAnn = new Date(
    anniversary.getFullYear(),
    anniversary.getMonth(),
    anniversary.getDate() - 1
  );
  const senBefore = calcSeniority(hire, dayBeforeAnn < h ? h : dayBeforeAnn);
  const daysBefore = specialLeaveEntitlementDays(senBefore.totalMonths);

  // 週年日當日之年資 → 後段應休
  const senAfter = calcSeniority(hire, anniversary);
  const daysAfter = specialLeaveEntitlementDays(senAfter.totalMonths);

  const preStart = periodStart;
  const preEnd = dayBeforeAnn < periodStart ? periodStart : dayBeforeAnn;
  let preDays = 0;
  if (preEnd >= preStart && anniversary > periodStart) {
    preDays = inclusiveDayCount(preStart, preEnd);
  }

  const postStart = anniversary < periodStart ? periodStart : anniversary;
  const postEnd = yearEnd;
  let postDays = 0;
  if (postEnd >= postStart) {
    postDays = inclusiveDayCount(postStart, postEnd);
  }

  // 安全：pre+post 應等於 period 天數
  const periodDays = inclusiveDayCount(periodStart, yearEnd);
  if (preDays + postDays !== periodDays && periodDays > 0) {
    // 微調：以 period 為準（避免日期邊界差 1）
    if (preDays + postDays === periodDays + 1 && preDays > 0) preDays -= 1;
    else if (preDays + postDays === periodDays - 1) postDays += 1;
  }

  const raw = (daysBefore * preDays + daysAfter * postDays) / yearDays;
  const entitled = snapHalf(raw);

  return {
    entitled,
    detail: {
      mode: 'calendar-prorate',
      year: y,
      yearDays,
      anniversary: formatYmd(anniversary),
      daysBeforeAnniv: daysBefore,
      daysAfterAnniv: daysAfter,
      preCalendarDays: preDays,
      postCalendarDays: postDays,
      raw: Math.round(raw * 1000) / 1000,
      formula: `${daysBefore}×${preDays}/${yearDays} + ${daysAfter}×${postDays}/${yearDays}`,
    },
  };
}

/**
 * 目前特休年度區間（曆年制）
 * 例：今天 2026-07-18 → 本年度 2026-01-01～2026-12-31
 * 若當年 3/15 到職 → 2026-03-15～2026-12-31
 */
function currentLeaveYearRange(hireDate, asOf = new Date()) {
  const a =
    asOf instanceof Date
      ? new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
      : parseLocalDate(toDateOnly(asOf) || formatYmd(new Date()));
  if (Number.isNaN(a.getTime())) return null;

  const y = a.getFullYear();
  let start = new Date(y, 0, 1); // 1/1
  const end = new Date(y, 11, 31); // 12/31

  const hire = toDateOnly(hireDate);
  if (hire) {
    const h = parseLocalDate(hire);
    // 當年中途到職：年度起日自到職日（不回溯到職前）
    if (h.getFullYear() === y && h > start) {
      start = h;
    }
  }

  return {
    start: formatYmd(start),
    end: formatYmd(end),
    label: `${formatYmd(start)} ～ ${formatYmd(end)}（曆年制）`,
    mode: 'calendar',
    calendarYear: y,
  };
}

/** 判斷是否為特別休假（特休） */
function isSpecialLeaveType(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

/**
 * 台灣勞基法／勞工請假規則／性別工作平等法 — 各假別法定可休日數（試算）
 * entitled 為 null 表示依法無固定日數上限（依事實／醫師／加班折換）
 */
const STATUTORY_LEAVE_RULES = [
  {
    id: 'special',
    names: ['特別休假（特休）', '特別休假', '特休'],
    entitled: (ctx) => ctx.specialEntitled,
    law: '勞基法第38條',
  },
  {
    id: 'personal',
    names: ['事假'],
    entitled: () => 14,
    law: '勞工請假規則第7條：一年內合計不得超過14日（不給工資）',
  },
  {
    id: 'sick',
    names: ['普通傷病假（病假）', '普通傷病假', '病假'],
    entitled: () => 30,
    law: '勞工請假規則第4條：一年內合計不得超過30日（半薪）',
  },
  {
    id: 'hospital',
    names: ['住院傷病假'],
    entitled: () => 365,
    displayEntitled: '一年（二年內合計）',
    law: '勞工請假規則第4條：二年內合計不得超過一年',
  },
  {
    id: 'occupational',
    names: ['公傷病假'],
    entitled: null,
    displayEntitled: '醫療期間',
    law: '勞基法第59條：醫療中不能工作期間，工資補償依規定',
  },
  {
    id: 'marriage',
    names: ['婚假'],
    entitled: () => 8,
    law: '勞工請假規則第2條：結婚給婚假8日（工資照給）',
  },
  {
    id: 'funeral',
    names: ['喪假'],
    entitled: () => 8,
    displayEntitled: '3～8日（依親屬）',
    law: '勞工請假規則第3條',
    note: '父母／配偶：8日；祖父母、子女、配偶之父母：6日；曾祖父母、兄弟姊妹、配偶之祖父母：3日',
  },
  {
    id: 'ritual',
    names: ['祭儀假'],
    entitled: () => 3,
    law: '公司規定：每年可休3日',
    note: '本系統試算以曆年制每年3日計；實際給假以人事核定為準',
  },
  {
    id: 'maternity',
    names: ['產假'],
    entitled: () => 56,
    displayEntitled: '8週（56日）',
    law: '性平法第15條：分娩前後給產假8星期',
    note: '妊娠3個月以上流產：4週；2個月以上未滿3個月：1週；未滿2個月：5日（依法另計）',
  },
  {
    id: 'prenatal',
    names: ['產檢假'],
    entitled: () => 7,
    law: '性平法第15條：妊娠期間產檢假7日（工資照給）',
  },
  {
    id: 'tocolysis',
    names: ['安胎休養'],
    entitled: null,
    displayEntitled: '依醫師診斷',
    law: '性平法第15條：安胎休養期間依相關規定請假',
  },
  {
    id: 'paternity',
    names: ['陪產檢及陪產假', '陪產假', '陪產檢假'],
    entitled: () => 7,
    law: '性平法第15條：陪產檢及陪產假合計7日（工資照給）',
  },
  {
    id: 'menstrual',
    names: ['生理假'],
    entitled: () => 12,
    displayEntitled: '每月1日',
    law: '性平法第14條：每月得請生理假1日',
    note: '全年未逾3日之生理假，不併入病假；超過部分以半薪病假計',
  },
  {
    id: 'family',
    names: ['家庭照顧假'],
    entitled: () => 7,
    law: '性平法第20條：每年7日，工資不給；日數併入事假計算',
    note: '與事假合計時，事假年度上限仍為14日（家庭照顧假7日計入事假）',
  },
  {
    id: 'official',
    names: ['公假'],
    entitled: null,
    displayEntitled: '依實際需要',
    law: '勞工請假規則第8條：依法令應給公假者，工資照給',
  },
  {
    id: 'comp',
    names: ['補休'],
    entitled: null,
    displayEntitled: '依加班折換',
    law: '勞基法第32條之1：延長工時後選擇補休',
  },
  {
    id: 'absence',
    names: ['曠職'],
    entitled: null,
    displayEntitled: '—',
    law: '未請假或核准前缺勤，依公司規定與勞基法處理',
    note: '最小計算單位 1 日',
  },
  {
    id: 'other',
    names: ['其他', '其他請假'],
    entitled: null,
    displayEntitled: '—',
    law: '依公司規定或人事核定',
  },
];

/**
 * 請假申請「天數／小時」最小計算單位（依假別）
 * - unit=hour, step=0.5：補休／公假／公傷／病假／事假（以小時為準）
 * - unit=day,  step=0.5：特休
 * - unit=day,  step=1  ：產假／喪假／曠職
 * - 其餘假別：預設 0.5 日
 */
const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5 },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};

const DEFAULT_LEAVE_MIN_UNIT = { unit: 'day', step: 0.5 };

function leaveMinUnitLabel(rule) {
  if (!rule) return '0.5 日';
  if (rule.unit === 'hour') return `${rule.step} 小時`;
  return `${rule.step} 日`;
}

/** 對齊任意 step（例 0.5、1） */
function snapToStep(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return null;
  if (!Number.isFinite(s) || s <= 0) return x;
  const snapped = Math.round(x / s) * s;
  // 避免浮點誤差（0.30000000004）
  return Math.round(snapped * 1000) / 1000;
}

function isMultipleOfStep(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return false;
  if (!Number.isFinite(s) || s <= 0) return true;
  const q = x / s;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

/**
 * 依假別名稱或 id 取得最小計算單位
 * @returns {{ id: string, unit: 'hour'|'day', step: number, label: string }}
 */
function getLeaveMinUnit(typeNameOrId) {
  const raw = String(typeNameOrId || '').trim();
  let id = raw;
  if (raw && !LEAVE_MIN_UNIT_BY_ID[raw] && !STATUTORY_LEAVE_RULES.some((r) => r.id === raw)) {
    if (/曠職/.test(raw)) id = 'absence';
    else id = matchStatutoryLeaveId(raw);
  }
  const base = LEAVE_MIN_UNIT_BY_ID[id] || DEFAULT_LEAVE_MIN_UNIT;
  return {
    id: id || 'other',
    unit: base.unit,
    step: base.step,
    label: leaveMinUnitLabel(base),
  };
}

/**
 * 依假別正規化請假天數／小時
 * @returns {{ ok: true, days: number, hours: number, rule: object } | { ok: false, error: string, rule?: object }}
 */
function normalizeLeaveDaysHours(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnit(leaveType);
  let days =
    daysIn === '' || daysIn == null ? null : Number(daysIn);
  let hours =
    hoursIn === '' || hoursIn == null ? null : Number(hoursIn);
  if (days != null && (!Number.isFinite(days) || days < 0)) {
    return { ok: false, error: '天數須為 0 以上數字', rule };
  }
  if (hours != null && (!Number.isFinite(hours) || hours < 0)) {
    return { ok: false, error: '小時須為 0 以上數字', rule };
  }
  if (days == null) days = 0;
  if (hours == null) hours = 0;

  if (rule.unit === 'hour') {
    // 以小時為準（最小 0.5 小時）；若只填天數則換算
    if (hours > 0) {
      if (!isMultipleOfStep(hours, rule.step)) {
        return {
          ok: false,
          error: `此假別小時最小單位為 ${rule.label}（例如 0、0.5、1、1.5、3.5、7.5）`,
          rule,
        };
      }
      hours = snapToStep(hours, rule.step);
      days = Math.round((hours / WORK_DAY_HOURS) * 1000) / 1000;
    } else if (days > 0) {
      // 由天數換算小時後對齊
      hours = snapToStep(days * WORK_DAY_HOURS, rule.step);
      if (hours == null) hours = 0;
      days = Math.round((hours / WORK_DAY_HOURS) * 1000) / 1000;
    } else {
      days = 0;
      hours = 0;
    }
  } else {
    // 以日為準
    if (days > 0) {
      if (!isMultipleOfStep(days, rule.step)) {
        return {
          ok: false,
          error:
            rule.step === 1
              ? '此假別天數最小單位為 1 日（請填整數日）'
              : `此假別天數最小單位為 ${rule.label}（例如 0、0.5、1、1.5）`,
          rule,
        };
      }
      days = snapToStep(days, rule.step);
      hours = snapToStep(days * WORK_DAY_HOURS, 0.5);
    } else if (hours > 0) {
      // 由小時反推日數
      let d = hours / WORK_DAY_HOURS;
      d = snapToStep(d, rule.step);
      if (d == null || d < rule.step) {
        return {
          ok: false,
          error:
            rule.step === 1
              ? '此假別最小單位為 1 日，請以整天計算'
              : `此假別最小單位為 ${rule.label}`,
          rule,
        };
      }
      if (!isMultipleOfStep(d, rule.step)) {
        return {
          ok: false,
          error: `此假別天數最小單位為 ${rule.label}`,
          rule,
        };
      }
      days = d;
      hours = snapToStep(days * WORK_DAY_HOURS, 0.5);
    } else {
      days = 0;
      hours = 0;
    }
  }
  return { ok: true, days, hours, rule };
}

/**
 * 將試算結果（days/hours）依假別最小單位對齊
 */
function applyLeaveMinUnitToCalc(leaveType, calc) {
  const days = Number(calc?.days) || 0;
  const hours = Number(calc?.hours) || 0;
  const norm = normalizeLeaveDaysHours(leaveType, days, hours);
  if (!norm.ok) {
    // 試算時放寬：強制對齊
    const rule = getLeaveMinUnit(leaveType);
    if (rule.unit === 'hour') {
      let h = snapToStep(hours || days * WORK_DAY_HOURS, rule.step) || 0;
      if (h > 0 && h < rule.step) h = rule.step;
      return {
        days: Math.round((h / WORK_DAY_HOURS) * 1000) / 1000,
        hours: h,
        rule,
      };
    }
    let d = snapToStep(days || hours / WORK_DAY_HOURS, rule.step) || 0;
    if (d > 0 && d < rule.step) d = rule.step;
    return {
      days: d,
      hours: snapToStep(d * WORK_DAY_HOURS, 0.5) || 0,
      rule,
    };
  }
  return { days: norm.days, hours: norm.hours, rule: norm.rule };
}

/** 將表單假別名稱對應到法定規則 id */
function matchStatutoryLeaveId(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (isSpecialLeaveType(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
  // 先比對較長／易混淆名稱（避免「公傷病假」被「病假」命中）
  if (/公傷/.test(t)) return 'occupational';
  if (/住院/.test(t)) return 'hospital';
  if (/普通傷病|病假/.test(t)) return 'sick';
  if (/事假/.test(t)) return 'personal';
  if (/婚假/.test(t)) return 'marriage';
  if (/祭儀/.test(t)) return 'ritual';
  if (/喪假|喪葬/.test(t)) return 'funeral';
  if (/產假|分娩/.test(t) && !/陪產|產檢/.test(t)) return 'maternity';
  if (/產檢/.test(t) && !/陪產/.test(t)) return 'prenatal';
  if (/安胎/.test(t)) return 'tocolysis';
  if (/陪產/.test(t)) return 'paternity';
  if (/生理/.test(t)) return 'menstrual';
  if (/家庭照顧|家照/.test(t)) return 'family';
  if (/公假/.test(t)) return 'official';
  if (/補休|調休/.test(t)) return 'comp';
  // 其餘：完整名稱比對（較長名稱優先）
  const candidates = [];
  for (const rule of STATUTORY_LEAVE_RULES) {
    if (rule.id === 'special' || rule.id === 'other') continue;
    for (const n of rule.names) {
      if (t === n || t.includes(n) || n.includes(t)) {
        candidates.push({ id: rule.id, len: String(n).length });
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.len - a.len);
    return candidates[0].id;
  }
  return 'other';
}

/**
 * 依法有日數上限、可於成員名單填寫「手動已休」的假別 id
 * （不含公傷／安胎／公假／補休等無固定年度上限者）
 */
const MANUAL_LEAVE_TRACK_IDS = [
  'special',
  'personal',
  'sick',
  'hospital',
  'marriage',
  'funeral',
  'ritual',
  'maternity',
  'prenatal',
  'paternity',
  'menstrual',
  'family',
];

function isManualLeaveTrackId(id) {
  return MANUAL_LEAVE_TRACK_IDS.includes(id);
}

/** 供前端表單：可填寫手動已休的假別清單 */
function getManualLeaveTrackRules() {
  return STATUTORY_LEAVE_RULES.filter((r) => isManualLeaveTrackId(r.id)).map((r) => ({
    id: r.id,
    name: r.names[0],
    law: r.law || '',
    note: r.note || '',
    displayEntitled: r.displayEntitled || null,
  }));
}

function emptyLeaveUsedMap() {
  const m = {};
  for (const id of MANUAL_LEAVE_TRACK_IDS) {
    m[id] = { days: 0, hours: 0 };
  }
  return m;
}

function emptyLeaveEntitledMap() {
  const m = {};
  for (const id of MANUAL_LEAVE_TRACK_IDS) {
    m[id] = { days: 0 };
  }
  return m;
}

/**
 * 解析成員「可休／應休」天數（手動）
 * leave_entitled_json：{ special:{days}, personal:{days}, … }
 */
function parseLeaveEntitledManual(userRow) {
  const map = emptyLeaveEntitledMap();
  let raw = userRow?.leave_entitled_json;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t) {
      try {
        raw = JSON.parse(t);
      } catch {
        raw = null;
      }
    } else {
      raw = null;
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const id of MANUAL_LEAVE_TRACK_IDS) {
      const v = raw[id];
      if (v == null) continue;
      if (typeof v === 'object') {
        const d = parseHalfUnit(v.days, 0);
        map[id] = { days: d == null ? 0 : d };
      } else {
        const d = parseHalfUnit(v, 0);
        map[id] = { days: d == null ? 0 : d };
      }
    }
  }
  return map;
}

/**
 * 合併 leave_entitled 寫入
 */
function mergeLeaveEntitledFromRequest(body, existingUser) {
  const base = parseLeaveEntitledManual(existingUser || {});
  let input = body?.leave_entitled;
  if (input == null && body?.leave_entitled_json != null) {
    if (typeof body.leave_entitled_json === 'string') {
      try {
        input = JSON.parse(body.leave_entitled_json || '{}');
      } catch {
        return { ok: false, error: 'leave_entitled_json 格式錯誤' };
      }
    } else {
      input = body.leave_entitled_json;
    }
  }
  if (input != null && typeof input === 'object') {
    for (const id of MANUAL_LEAVE_TRACK_IDS) {
      if (input[id] === undefined) continue;
      const v = input[id];
      if (v == null || v === '') {
        base[id] = { days: 0 };
        continue;
      }
      if (typeof v === 'object') {
        const d = parseHalfUnit(v.days != null ? v.days : 0, 0);
        if (d === null) {
          const rule = STATUTORY_LEAVE_RULES.find((r) => r.id === id);
          return {
            ok: false,
            error: `${rule?.names?.[0] || id}可休天數須為 0 以上，最小單位 0.5`,
          };
        }
        base[id] = { days: d };
      } else {
        const d = parseHalfUnit(v, 0);
        if (d === null) {
          const rule = STATUTORY_LEAVE_RULES.find((r) => r.id === id);
          return {
            ok: false,
            error: `${rule?.names?.[0] || id}可休天數須為 0 以上，最小單位 0.5`,
          };
        }
        base[id] = { days: d };
      }
    }
  }
  return { ok: true, map: base, json: JSON.stringify(base) };
}

/** 手動已休換算成天數（天 + 小時/7.5） */
function manualEntryAsDays(entry) {
  const days = snapHalf(entry?.days || 0);
  const hours = snapHalf(entry?.hours || 0);
  return snapHalf(days + hours / WORK_DAY_HOURS);
}

/**
 * 解析成員手動已休
 * - leave_used_json：各假別 { days, hours }
 * - 相容舊欄 sl_used_days / sl_used_hours → special
 */
function parseLeaveUsedManual(userRow) {
  const map = emptyLeaveUsedMap();
  let raw = userRow?.leave_used_json;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t) {
      try {
        raw = JSON.parse(t);
      } catch {
        raw = null;
      }
    } else {
      raw = null;
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const id of MANUAL_LEAVE_TRACK_IDS) {
      const v = raw[id];
      if (v == null) continue;
      if (typeof v === 'object') {
        const d = parseHalfUnit(v.days, 0);
        const h = parseHalfUnit(v.hours, 0);
        map[id] = {
          days: d == null ? 0 : d,
          hours: h == null ? 0 : h,
        };
      } else {
        const d = parseHalfUnit(v, 0);
        map[id] = { days: d == null ? 0 : d, hours: 0 };
      }
    }
  }
  // 舊欄位：若 JSON 未寫 special（或全空），以 sl_used_* 為特休手動
  const hasJsonSpecial =
    raw &&
    typeof raw === 'object' &&
    raw.special != null &&
    (typeof raw.special === 'object'
      ? raw.special.days != null || raw.special.hours != null
      : true);
  if (!hasJsonSpecial) {
    const d = parseHalfUnit(userRow?.sl_used_days, 0);
    const h = parseHalfUnit(userRow?.sl_used_hours, 0);
    map.special = {
      days: d == null ? 0 : d,
      hours: h == null ? 0 : h,
    };
  }
  return map;
}

/**
 * 合併 leave_used 與可選的 sl_used_days/hours
 */
function mergeLeaveUsedFromRequest(body, existingUser) {
  const base = parseLeaveUsedManual(existingUser || {});
  let input = body?.leave_used;
  if (input == null && body?.leave_used_json != null) {
    if (typeof body.leave_used_json === 'string') {
      try {
        input = JSON.parse(body.leave_used_json || '{}');
      } catch {
        return { ok: false, error: 'leave_used_json 格式錯誤' };
      }
    } else {
      input = body.leave_used_json;
    }
  }
  if (input != null && typeof input === 'object') {
    for (const id of MANUAL_LEAVE_TRACK_IDS) {
      if (input[id] === undefined) continue;
      const v = input[id];
      if (v == null || v === '') {
        base[id] = { days: 0, hours: 0 };
        continue;
      }
      if (typeof v === 'object') {
        const d = parseHalfUnit(v.days != null ? v.days : 0, 0);
        const h = parseHalfUnit(v.hours != null ? v.hours : 0, 0);
        if (d === null || h === null) {
          const rule = STATUTORY_LEAVE_RULES.find((r) => r.id === id);
          return {
            ok: false,
            error: `${rule?.names?.[0] || id}已休須為 0 以上，最小單位 0.5`,
          };
        }
        base[id] = { days: d, hours: h };
      }
    }
  }
  // 相容：直接傳 sl_used_days / sl_used_hours
  if (body && body.sl_used_days !== undefined) {
    const d = parseHalfUnit(body.sl_used_days, 0);
    if (d === null) {
      return { ok: false, error: '特休已休天數須為 0 以上，最小單位 0.5' };
    }
    base.special.days = d;
  }
  if (body && body.sl_used_hours !== undefined) {
    const h = parseHalfUnit(body.sl_used_hours, 0);
    if (h === null) {
      return { ok: false, error: '特休已休小時須為 0 以上，最小單位 0.5' };
    }
    base.special.hours = h;
  }
  return {
    ok: true,
    map: base,
    json: JSON.stringify(base),
    specialDays: base.special.days,
    specialHours: base.special.hours,
  };
}

/**
 * 彙總各假別：可休（手動）／已休／剩餘
 * 已休＝手動已休（成員名單）＋系統已核准（本年度）
 * 可休＝成員名單手動設定（不依年資）
 * @param {{ specialEntitled?: number, specialUsed?: number, usedByType: Object, manualUsedById?: Object, systemUsedById?: Object, manualEntitledById?: Object }} ctx
 */
function buildLeaveBalances(ctx) {
  const usedByType = ctx.usedByType || {};
  const systemById = {};
  const manualById = {};
  const entitledById = {};
  const extraNames = {};

  for (const [typeName, days] of Object.entries(usedByType)) {
    const id = matchStatutoryLeaveId(typeName);
    systemById[id] = snapHalf((systemById[id] || 0) + Number(days || 0));
    if (!extraNames[id]) extraNames[id] = String(typeName);
  }
  if (ctx.systemUsedById && typeof ctx.systemUsedById === 'object') {
    for (const [id, days] of Object.entries(ctx.systemUsedById)) {
      systemById[id] = snapHalf(Number(days || 0));
    }
  }
  if (ctx.manualUsedById && typeof ctx.manualUsedById === 'object') {
    for (const [id, days] of Object.entries(ctx.manualUsedById)) {
      manualById[id] = snapHalf(Number(days || 0));
    }
  }
  if (ctx.manualEntitledById && typeof ctx.manualEntitledById === 'object') {
    for (const [id, days] of Object.entries(ctx.manualEntitledById)) {
      entitledById[id] = snapHalf(Number(days || 0));
    }
  }
  // 特休合計以 specialUsed 為準（手動＋系統）
  if (ctx.specialUsed != null && Number.isFinite(Number(ctx.specialUsed))) {
    systemById.special = snapHalf(
      Math.max(0, Number(ctx.specialUsed) - (manualById.special || 0))
    );
  }
  // 特休可休：手動優先
  if (ctx.specialEntitled != null && Number.isFinite(Number(ctx.specialEntitled))) {
    entitledById.special = snapHalf(Number(ctx.specialEntitled));
  }

  return STATUTORY_LEAVE_RULES.map((rule) => {
    const manualUsed = snapHalf(manualById[rule.id] || 0);
    let systemUsed = snapHalf(systemById[rule.id] || 0);
    let used = snapHalf(manualUsed + systemUsed);
    if (
      rule.id === 'special' &&
      ctx.specialUsed != null &&
      Number.isFinite(Number(ctx.specialUsed))
    ) {
      used = snapHalf(ctx.specialUsed);
      systemUsed = snapHalf(Math.max(0, used - manualUsed));
    }

    let entitled = null;
    let entitledLabel = '—';
    // 可追蹤假別：一律用手動可休天數（未填＝0）
    if (isManualLeaveTrackId(rule.id)) {
      entitled = snapHalf(
        entitledById[rule.id] != null ? entitledById[rule.id] : 0
      );
      entitledLabel = `${entitled} 日（手動）`;
    } else {
      // 公傷／安胎／公假／補休等：無固定可休日數
      entitledLabel = rule.displayEntitled || '—';
    }
    let remaining = null;
    let remainingLabel = '—';
    if (entitled != null && Number.isFinite(entitled)) {
      remaining = snapHalf(entitled - used);
      remainingLabel = `${remaining} 日`;
    } else {
      remainingLabel = '—';
    }
    return {
      id: rule.id,
      name: rule.names[0],
      entitled,
      entitledLabel: entitledLabel || '—',
      used,
      manualUsed,
      systemUsed,
      remaining,
      remainingLabel,
      law: rule.law || '',
      note: rule.note || '',
      hasFixedQuota: entitled != null,
      canTrackManual: isManualLeaveTrackId(rule.id),
      entitledSource: isManualLeaveTrackId(rule.id) ? 'manual' : 'none',
    };
  });
}

function parseFormJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s || '{}') : s || {};
  } catch {
    return {};
  }
}

/**
 * 從已核准請假申請單統計特休已用天數（本特休年度內）
 * 以 form_data.days 為主；假別取 leave_type 或人事核定 hr_leave_type
 */
function sumUsedSpecialLeaveDays(userId, yearStart, yearEnd) {
  const rows = db
    .prepare(
      `SELECT id, title, form_data, approver_data_json, status, created_at, completed_at
       FROM approval_requests
       WHERE requester_id = ? AND status = 'approved'
       ORDER BY id ASC`
    )
    .all(userId);

  let used = 0;
  const details = [];
  const y0 = yearStart ? parseLocalDate(yearStart) : null;
  const y1 = yearEnd ? parseLocalDate(yearEnd) : null;

  for (const r of rows) {
    const fd = parseFormJson(r.form_data);
    const ad = parseFormJson(r.approver_data_json);
    const leaveType = ad.hr_leave_type || fd.leave_type || fd.假別 || '';
    // 僅統計請假相關（有假別或標題含請假）
    const looksLikeLeave =
      leaveType ||
      /請假/.test(String(r.title || '')) ||
      fd.start_date ||
      fd.end_date;
    if (!looksLikeLeave) continue;
    if (!isSpecialLeaveType(leaveType) && !isSpecialLeaveType(r.title)) {
      // 標題含特休也算
      if (!/特休|特別休假/.test(String(r.title || ''))) continue;
    }

    // 請假起始日落在本特休年度內
    const startStr = toDateOnly(fd.start_date) || toDateOnly(String(r.completed_at || r.created_at).slice(0, 10));
    if (y0 && y1 && startStr) {
      const s = parseLocalDate(startStr);
      if (s < y0 || s > y1) continue;
    }

    let days = Number(fd.days);
    if (!Number.isFinite(days) || days <= 0) {
      // 嘗試由起迄粗算（若無 days）
      days = 0;
    }
    used += days;
    details.push({
      requestId: r.id,
      title: r.title,
      leaveType: leaveType || '特別休假（特休）',
      days,
      start: startStr,
    });
  }

  // 四捨五入到 0.5
  used = Math.round(used * 2) / 2;
  return { used, details };
}

/**
 * 是否為出差／公差／旅費類申請（不計入休假明細）
 */
function isTravelLikeRequest(requestRow, formData, leaveType) {
  const fd = formData || {};
  const blob = [
    requestRow?.title,
    leaveType,
    fd.leave_type,
    fd.假別,
    fd.destination,
    fd.dest,
    fd.location,
    fd.purpose,
    fd.trip_type,
  ]
    .map((x) => String(x || ''))
    .join(' ');
  if (/出差|公差|旅費|business\s*trip|\btravel\b/i.test(blob)) return true;
  // 出差表單常見欄位組合（無假別、但有出差地／目的）
  if (
    !String(leaveType || '').trim() &&
    (fd.destination || fd.dest || fd.travel_place || fd.trip_days) &&
    !/請假/.test(String(requestRow?.title || ''))
  ) {
    return true;
  }
  return false;
}

/**
 * 是否為請假類申請（須有假別或標題含「請假」；排除出差）
 */
function isLeaveLikeRequest(requestRow, formData, leaveType) {
  if (isTravelLikeRequest(requestRow, formData, leaveType)) return false;
  const lt = String(leaveType || '').trim();
  if (lt) return true;
  if (/請假/.test(String(requestRow?.title || ''))) return true;
  // 有 leave_type 欄位語意的其他鍵
  if (formData && (formData.leave_type || formData.假別)) return true;
  return false;
}

/**
 * 彙總本年度已核准請假：各假別合計 + 每筆單號明細
 * （不含出差／公差／旅費）
 * @returns {{ byType: Object<string, number>, details: Array }}
 */
function sumUsedLeaveByType(userId, yearStart, yearEnd) {
  const rows = db
    .prepare(
      `SELECT r.id, r.title, r.form_data, r.approver_data_json, r.status,
              r.created_at, r.completed_at, w.name AS workflow_name
       FROM approval_requests r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       WHERE r.requester_id = ? AND r.status = 'approved'
       ORDER BY r.id ASC`
    )
    .all(userId);

  const byType = {};
  const details = [];
  const y0 = yearStart ? parseLocalDate(yearStart) : null;
  const y1 = yearEnd ? parseLocalDate(yearEnd) : null;

  for (const r of rows) {
    const fd = parseFormJson(r.form_data);
    const ad = parseFormJson(r.approver_data_json);
    const leaveType = String(ad.hr_leave_type || fd.leave_type || fd.假別 || '').trim();
    // 流程名稱含出差也排除
    if (/出差|公差|旅費/i.test(String(r.workflow_name || ''))) continue;
    if (!isLeaveLikeRequest(r, fd, leaveType)) continue;

    const startStr =
      toDateOnly(fd.start_date) ||
      toDateOnly(String(r.completed_at || r.created_at).slice(0, 10));
    if (y0 && y1 && startStr) {
      const s = parseLocalDate(startStr);
      if (s < y0 || s > y1) continue;
    }

    // 天數：依假別最小單位（小時制以 hours 為準）
    const rule = getLeaveMinUnit(leaveType);
    let days = Number(fd.days);
    let hours = Number(fd.hours);
    if (!Number.isFinite(days) || days < 0) days = 0;
    if (!Number.isFinite(hours) || hours < 0) hours = 0;
    if (rule.unit === 'hour') {
      if (hours > 0) days = hours / WORK_DAY_HOURS;
      else if (days > 0) days = days;
      // 小時制累計保留至小數 3 位（0.5h＝1/15 日）
      days = Math.round(days * 1000) / 1000;
    } else {
      if (days === 0 && hours > 0) days = hours / WORK_DAY_HOURS;
      if (rule.step === 1) days = Math.round(days);
      else days = Math.round(days * 2) / 2;
    }
    const key = leaveType || '其他請假';
    byType[key] = (byType[key] || 0) + days;
    details.push({
      requestId: r.id,
      title: r.title,
      leaveType: key,
      days,
      start: startStr || '',
      end: toDateOnly(fd.end_date) || '',
    });
  }
  for (const k of Object.keys(byType)) {
    const rule = getLeaveMinUnit(k);
    if (rule.unit === 'hour') {
      byType[k] = Math.round(byType[k] * 1000) / 1000;
    } else if (rule.step === 1) {
      byType[k] = Math.round(byType[k]);
    } else {
      byType[k] = Math.round(byType[k] * 2) / 2;
    }
  }
  // 明細依起始日、單號排序
  details.sort((a, b) => {
    const da = String(a.start || '');
    const db = String(b.start || '');
    if (da !== db) return da < db ? -1 : 1;
    return (a.requestId || 0) - (b.requestId || 0);
  });
  return { byType, details };
}

/**
 * 完整休假摘要（成員名單／個人用）
 * 可休＝手動設定（leave_entitled_json）
 * 剩餘＝可休 −（手動已休天數＋手動已休小時/7.5 ＋ 系統已核准天數）
 * 不依年資計算可休日數。
 */
function buildLaborSummary(userRow, asOf = new Date()) {
  const hireDate = toDateOnly(userRow?.hire_date);
  const seniority = calcSeniority(hireDate, asOf);
  const leaveUsedMap = parseLeaveUsedManual(userRow);
  const leaveEntitledMap = parseLeaveEntitledManual(userRow);
  const manualDays = snapHalf(leaveUsedMap.special?.days || 0);
  const manualHours = snapHalf(leaveUsedMap.special?.hours || 0);
  const manualUsedById = {};
  const manualEntitledById = {};
  for (const id of MANUAL_LEAVE_TRACK_IDS) {
    manualUsedById[id] = manualEntryAsDays(leaveUsedMap[id]);
    manualEntitledById[id] = snapHalf(leaveEntitledMap[id]?.days || 0);
  }

  // 統計年度：一律曆年制（不依賴到職日）
  const a =
    asOf instanceof Date
      ? new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
      : parseLocalDate(toDateOnly(asOf) || formatYmd(new Date()));
  const y = a.getFullYear();
  const yearRange = {
    start: `${y}-01-01`,
    end: `${y}-12-31`,
    label: `${y}-01-01 ～ ${y}-12-31（曆年）`,
    mode: 'calendar',
    calendarYear: y,
  };

  // 特休可休：手動設定（非年資）
  const entitled = snapHalf(manualEntitledById.special || 0);
  const entitledHours = snapHalf(entitled * WORK_DAY_HOURS);
  const usedInfo = userRow?.id
    ? sumUsedSpecialLeaveDays(userRow.id, yearRange.start, yearRange.end)
    : { used: 0, details: [] };
  const systemUsedDays = snapHalf(usedInfo.used);

  const manualAsDays = snapHalf(manualDays + manualHours / WORK_DAY_HOURS);
  const usedDays = snapHalf(manualAsDays + systemUsedDays);
  const usedHours = snapHalf(
    manualDays * WORK_DAY_HOURS + manualHours + systemUsedDays * WORK_DAY_HOURS
  );
  const remainingRaw = snapHalf(entitled - usedDays);
  const remainingHoursRaw = snapHalf(entitledHours - usedHours);
  const remaining = remainingRaw < 0 ? 0 : remainingRaw;
  const remainingHours = remainingHoursRaw < 0 ? 0 : remainingHoursRaw;

  const leaveUsed = userRow?.id
    ? sumUsedLeaveByType(userRow.id, yearRange.start, yearRange.end)
    : { byType: {}, details: [] };
  const leaveUsedByType = leaveUsed.byType || {};
  const leaveUsedDetails = leaveUsed.details || [];
  const systemUsedById = {};
  for (const [typeName, days] of Object.entries(leaveUsedByType)) {
    const id = matchStatutoryLeaveId(typeName);
    systemUsedById[id] = snapHalf((systemUsedById[id] || 0) + Number(days || 0));
  }
  systemUsedById.special = systemUsedDays;

  const leaveBalances = buildLeaveBalances({
    specialEntitled: entitled,
    specialUsed: usedDays,
    usedByType: leaveUsedByType,
    manualUsedById,
    systemUsedById,
    manualEntitledById,
  });

  return {
    hireDate: hireDate || null,
    seniority,
    /** 可休改為手動，不再提供年資特休試算 */
    entitlementMode: 'manual',
    specialLeave: {
      entitled,
      entitledHours,
      entitledByCurrentSeniority: null,
      entitlementDetail: null,
      entitledSource: 'manual',
      /** 合計已休（天）＝手動＋系統 */
      used: usedDays,
      usedHours,
      /** 人資於成員名單填寫 */
      manualUsedDays: manualDays,
      manualUsedHours: manualHours,
      /** 本系統已核准特休（曆年） */
      systemUsed: systemUsedDays,
      remaining,
      remainingHours,
      overUsed: remainingRaw < 0 ? Math.abs(remainingRaw) : 0,
      overUsedHours: remainingHoursRaw < 0 ? Math.abs(remainingHoursRaw) : 0,
      yearStart: yearRange.start,
      yearEnd: yearRange.end,
      yearLabel: yearRange.label,
      yearMode: 'calendar',
      yearModeLabel: '曆年制',
      usedDetails: usedInfo.details,
      workDayHours: WORK_DAY_HOURS,
      basis:
        '可休日數由成員名單手動設定（不依年資）；已休＝手動已休＋系統已核准請假；統計年度＝曆年制（1/1～12/31）；全日＝7.5 小時',
    },
    leaveUsedByType,
    leaveUsedDetails,
    leaveBalances,
    leaveUsed: leaveUsedMap,
    leaveUsedManual: leaveUsedMap,
    leaveEntitled: leaveEntitledMap,
    leaveEntitledManual: leaveEntitledMap,
    manualLeaveTrack: getManualLeaveTrackRules(),
    leaveBalanceYearLabel: yearRange.label,
    note: hireDate ? null : '到職日未設定（不影響手動可休天數）',
    sl_used_days: manualDays,
    sl_used_hours: manualHours,
  };
}

module.exports = {
  toDateOnly,
  calcSeniority,
  specialLeaveEntitlementDays,
  specialLeaveEntitlementDaysCalendar,
  currentLeaveYearRange,
  buildLaborSummary,
  buildLeaveBalances,
  matchStatutoryLeaveId,
  isSpecialLeaveType,
  STATUTORY_LEAVE_RULES,
  MANUAL_LEAVE_TRACK_IDS,
  getManualLeaveTrackRules,
  parseLeaveUsedManual,
  mergeLeaveUsedFromRequest,
  parseLeaveEntitledManual,
  mergeLeaveEntitledFromRequest,
  emptyLeaveEntitledMap,
  manualEntryAsDays,
  emptyLeaveUsedMap,
  WORK_DAY_HOURS,
  snapHalf,
  parseHalfUnit,
  snapToStep,
  isMultipleOfStep,
  LEAVE_MIN_UNIT_BY_ID,
  getLeaveMinUnit,
  normalizeLeaveDaysHours,
  applyLeaveMinUnitToCalc,
};
