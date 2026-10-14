import { calcLeaveDays, isWorkday as calendarIsWorkday } from '../tw-calendar.js';

const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5, noConvert: true },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};
const WORK_DAY_HOURS = 7.5;

export function matchLeaveTypeId(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (/特別休假|特休/.test(t) && !/不休假|代金/.test(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
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
  return 'other';
}

export function isSpecialLeaveType(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

export function isSickLeaveType(type) {
  const t = String(type || '');
  if (/公傷|住院/.test(t)) return false;
  return /普通傷病假|病假/.test(t);
}

function rocToAdYear(y) {
  const n = Number(y);
  if (Number.isFinite(n) && n >= 1 && n <= 200) return n + 1911;
  return n;
}

export function parseLeaveDateTime(val) {
  const s = String(val || '').trim().replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  const y = rocToAdYear(Number(m[1]));
  const hh = m[4] != null ? Number(m[4]) : 9;
  const mm = m[5] != null ? Number(m[5]) : 0;
  return new Date(y, Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0);
}

function snapHalfHour(h) {
  if (!Number.isFinite(h) || h <= 0) return 0;
  let x = Math.round(h * 2) / 2;
  if (x > 0 && x < 0.5) x = 0.5;
  return x;
}

function personalLeavePortionOnDay(dateKey, rangeStart, rangeEnd) {
  const [y, mo, d] = String(dateKey).split('-').map(Number);
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
    else hours += snapHalfHour((amTo - amFrom) / 3600000);
  }
  const pmFrom = Math.max(from, lunchEnd);
  const pmTo = Math.min(to, dayEnd);
  if (pmTo > pmFrom) {
    if (from <= lunchEnd && to >= dayEnd) days += 0.5;
    else hours += snapHalfHour((pmTo - pmFrom) / 3600000);
  }
  return { days, hours };
}

function isWorkday(key) {
  return calendarIsWorkday(key);
}

export function computePersonalLeaveDisplay(formData) {
  const start = parseLeaveDateTime(formData?.start_date);
  const end = parseLeaveDateTime(formData?.end_date);
  if (!start || !end || end < start) return null;
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
  hours = snapHalfHour(hours);
  days = Math.round(days * 2) / 2;
  if (!days && !hours) return null;
  const text =
    days && hours ? `${days} 天又 ${hours} 小時` : days ? `${days} 天` : `${hours} 小時`;
  return { days, hours, text };
}

export function computeSickLeaveDisplay(formData) {
  const base = computePersonalLeaveDisplay(formData);
  if (!base) return null;
  const text = base.days ? `${base.days}日` : base.hours ? `${base.hours}小時` : '';
  if (!text) return null;
  return { days: base.days, hours: base.hours, text };
}

export function leaveDisplayForForm(formData) {
  const leaveTypeVal = String(formData?.leave_type || formData?.假別 || '');
  if (/事假/.test(leaveTypeVal)) return computePersonalLeaveDisplay(formData);
  if (isSickLeaveType(leaveTypeVal)) return computeSickLeaveDisplay(formData);
  return null;
}

export function getLeaveMinUnit(typeName) {
  const id = matchLeaveTypeId(typeName);
  const base = LEAVE_MIN_UNIT_BY_ID[id] || { unit: 'day', step: 0.5 };
  const label = base.unit === 'hour' ? `${base.step} 小時` : `${base.step} 日`;
  return { id, unit: base.unit, step: base.step, noConvert: !!base.noConvert, label };
}

function snapToStep(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return 0;
  if (!Number.isFinite(s) || s <= 0) return x;
  return Math.round(Math.round(x / s) * s * 1000) / 1000;
}

/** 依假別對齊天數／小時（試算與手動修改） */
export function applyLeaveMinUnit(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnit(leaveType);
  let days = Number(daysIn);
  let hours = Number(hoursIn);
  if (!Number.isFinite(days) || days < 0) days = 0;
  if (!Number.isFinite(hours) || hours < 0) hours = 0;

  if (rule.noConvert || rule.id === 'personal') {
    let d = days;
    let h = hours;
    if (h > 0) h = snapToStep(h, 0.5);
    if (d > 0) d = snapToStep(d, 0.5);
    return { days: d, hours: h, rule };
  }
  if (rule.unit === 'hour') {
    let h = hours > 0 ? hours : days * WORK_DAY_HOURS;
    h = snapToStep(h, rule.step);
    if (h > 0 && h < rule.step) h = rule.step;
    return {
      days: Math.round((h / WORK_DAY_HOURS) * 1000) / 1000,
      hours: h,
      rule,
    };
  }
  let d = days > 0 ? days : hours / WORK_DAY_HOURS;
  d = snapToStep(d, rule.step);
  if (d > 0 && d < rule.step) d = rule.step;
  if (rule.id === 'special') {
    return { days: d, hours: 0, rule };
  }
  return {
    days: d,
    hours: snapToStep(d * WORK_DAY_HOURS, 0.5),
    rule,
  };
}

export function leaveUnitHintText(leaveType) {
  const rule = getLeaveMinUnit(leaveType);
  if (rule.id === 'special') {
    return '此假別（特休）最小單位 0.5 日，以日計算，不換算小時';
  }
  if (rule.noConvert || rule.id === 'personal') {
    return '事假不自動以 7.5 小時換算天數；天數與小時各自填寫（最小 0.5）';
  }
  if (rule.unit === 'hour') {
    return `此假別最小單位 ${rule.label}（以小時為準；全日＝7.5 小時）。例：0.5、1、1.5、3.5、7.5 小時`;
  }
  if (rule.step === 1) {
    return '此假別最小單位 1 日（僅能請整天，不可半日／小時）';
  }
  return '此假別最小單位 0.5 日（例：0.5、1、1.5 日；全日＝7.5 小時）';
}

export function formatLeaveTitlePeriod(start, end) {
  const one = (val) => {
    const raw = String(val || '').trim();
    if (!raw) return '';
    const dt = parseLeaveDateTime(raw);
    if (!dt || Number.isNaN(dt.getTime())) return raw.replace('T', ' ').slice(0, 16);
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

function fallbackLeaveDaysHours(start, end) {
  const t0 = new Date(String(start).replace(' ', 'T')).getTime();
  const t1 = new Date(String(end).replace(' ', 'T')).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) {
    return { days: 0, hours: 0, skippedWeekends: [], skippedHolidays: [] };
  }
  const a = String(start);
  const b = String(end);
  const sameDay = a.slice(0, 10) === b.slice(0, 10);
  const st = a.slice(11, 16);
  const et = b.slice(11, 16);
  let h = Math.max(0, (t1 - t0) / 3600000);
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  let d = 0;
  if (sameDay && st === '09:00' && et === '12:30') d = 0.5;
  else if (sameDay && st >= '13:30' && et === '17:30') d = 0.5;
  else if (sameDay && st === '09:00' && et === '17:30') {
    d = 1;
    h = 7.5;
  }
  return { days: d, hours: h, skippedWeekends: [], skippedHolidays: [] };
}

export function calcLeaveDaysHours(start, end) {
  const result = calcLeaveDays(start, end);
  if (!result || result.note === '起迄時間無效') return fallbackLeaveDaysHours(start, end);
  return {
    days: result.days > 0 ? result.days : 0,
    hours: result.hours > 0 ? result.hours : 0,
    skippedWeekends: result.skippedWeekends || [],
    skippedHolidays: result.skippedHolidays || [],
  };
}

export { WORK_DAY_HOURS };
