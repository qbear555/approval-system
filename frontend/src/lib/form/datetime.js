export const WORK_TIME_START = '09:00';
export const WORK_TIME_END = '17:30';
export const OT_TIME_START = '00:00';
export const OT_TIME_END = '24:00';
export const OT_DEFAULT_START = '18:00';
export const OT_DEFAULT_END = '21:00';

export function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  if (Number(h) === 24 && (Number(m) || 0) === 0) return 24 * 60;
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(mins) {
  if (mins >= 24 * 60) return '24:00';
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function clampWorkTime(
  time,
  fallback = WORK_TIME_START,
  rangeStart = WORK_TIME_START,
  rangeEnd = WORK_TIME_END
) {
  let t = time || fallback;
  const [hh0, mm0] = String(t).split(':').map(Number);
  let hh = Number.isFinite(hh0) ? hh0 : 9;
  let mm = Number.isFinite(mm0) ? mm0 : 0;
  if (mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
    }
  }
  let mins = hh * 60 + mm;
  const minM = timeToMinutes(rangeStart);
  const maxM = timeToMinutes(rangeEnd);
  if (mins < minM) mins = minM;
  if (mins > maxM) mins = maxM;
  return minutesToTime(mins);
}

export function halfHourTimes(range = {}) {
  const rStart = range.start || WORK_TIME_START;
  const rEnd = range.end || WORK_TIME_END;
  const startM = timeToMinutes(rStart);
  const endM = timeToMinutes(rEnd);
  const out = [];
  for (let mins = startM; mins <= endM; mins += 30) {
    out.push(minutesToTime(mins));
  }
  return out;
}

export function parseDateTimeParts(val, defaultTime = WORK_TIME_START) {
  if (!val) return { date: '', time: clampWorkTime(defaultTime) };
  const s = String(val).replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/);
  if (!m) return { date: '', time: clampWorkTime(defaultTime) };
  let time = m[2] || defaultTime;
  time = clampWorkTime(time, defaultTime);
  return { date: m[1], time };
}

export function formatDateTimeDisplay(val) {
  if (!val) return '—';
  const s = String(val).replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

export function datetimeRangeForField(field) {
  const id = String(field?.id || '');
  const label = String(field?.label || '');
  const isLeaveRange = id === 'start_date' || id === 'end_date';
  const isOtRange =
    id === 'ot_start' ||
    id === 'ot_end' ||
    id === 'actual_start' ||
    id === 'actual_end' ||
    /延長工時|實際工時/.test(label);
  const isEnd = id === 'end_date' || id === 'ot_end' || id === 'actual_end' || /結束|迄/.test(label);
  const tStart = isLeaveRange ? WORK_TIME_START : isOtRange ? OT_TIME_START : '00:00';
  const tEnd = isLeaveRange ? WORK_TIME_END : isOtRange ? OT_TIME_END : '23:30';
  const defaultTime = isEnd
    ? isLeaveRange
      ? WORK_TIME_END
      : isOtRange
        ? OT_DEFAULT_END
        : '18:00'
    : isLeaveRange
      ? WORK_TIME_START
      : isOtRange
        ? OT_DEFAULT_START
        : '18:00';
  return { tStart, tEnd, defaultTime, isOtRange, isLeaveRange, span: isOtRange ? 1 : 2 };
}

export function combineDateTime(date, time, fallbackTime) {
  if (!date) return '';
  const t = time || fallbackTime || '09:00';
  return `${date}T${t}`;
}

export function parseOtDateTime(val) {
  if (!val) return null;
  const m = String(val)
    .trim()
    .replace(' ', 'T')
    .match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(5, 7)) - 1;
  const d = Number(m[1].slice(8, 10));
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh === 24 && mm === 0) {
    const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function calcOvertimeHours(startStr, endStr) {
  const a = parseOtDateTime(startStr);
  const b = parseOtDateTime(endStr);
  if (!a || !b) return null;
  if (b.getTime() <= a.getTime()) return null;
  let h = (b.getTime() - a.getTime()) / 3600000;
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  return h;
}
