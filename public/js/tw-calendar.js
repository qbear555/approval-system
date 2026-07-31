/**
 * 台灣行事曆：國定假日／補假／補班，請假天數試算（排除假日與例假日）
 * 依據行政院人事行政總處辦公日曆（2024–2027 已公告／彙整資料）
 */
(function (global) {
  // 放假日 YYYY-MM-DD（含補假、連假中的平日放假）
  const TW_HOLIDAYS = new Set([
    // ===== 2024 =====
    '2024-01-01',
    '2024-02-08', '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12',
    '2024-02-13', '2024-02-14',
    '2024-02-28',
    '2024-04-04', '2024-04-05',
    '2024-05-01',
    '2024-06-10',
    '2024-09-17',
    '2024-10-10',
    // ===== 2025 =====
    '2025-01-01',
    '2025-01-25', '2025-01-26', '2025-01-27', '2025-01-28', '2025-01-29',
    '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02',
    '2025-02-28',
    '2025-04-03', '2025-04-04', '2025-04-05', '2025-04-06',
    '2025-05-01',
    '2025-05-30', '2025-05-31',
    '2025-09-28', '2025-09-29', // 教師節及補假
    '2025-10-04', '2025-10-05', '2025-10-06', // 中秋連假
    '2025-10-10',
    '2025-10-24', '2025-10-25', // 臺灣光復節相關（10/25 國定；24 視行事曆）
    // ===== 2026（115 年，官方辦公日曆：無補班）=====
    // 元旦
    '2026-01-01',
    // 春節連假 2/14–2/22（小年夜～補假／例假）
    '2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18',
    '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
    // 和平紀念日連假 2/27–3/1
    '2026-02-27', '2026-02-28', '2026-03-01',
    // 兒童節＋清明 4/3–4/6
    '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06',
    // 勞動節 5/1–5/3
    '2026-05-01', '2026-05-02', '2026-05-03',
    // 端午 6/19–6/21
    '2026-06-19', '2026-06-20', '2026-06-21',
    // 中秋＋教師節 9/25–9/28
    '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28',
    // 國慶 10/9–10/11（10/10 週六，9 日補假）
    '2026-10-09', '2026-10-10', '2026-10-11',
    // 光復節 10/24–10/26
    '2026-10-24', '2026-10-25', '2026-10-26',
    // 行憲紀念日 12/25–12/27
    '2026-12-25', '2026-12-26', '2026-12-27',
    // ===== 2027（116 年，0 補班）=====
    '2027-01-01', '2027-01-02', '2027-01-03',
    '2027-02-04', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08',
    '2027-02-09', '2027-02-10',
    '2027-02-27', '2027-02-28', '2027-03-01',
    '2027-04-03', '2027-04-04', '2027-04-05', '2027-04-06',
    '2027-04-30', '2027-05-01', '2027-05-02',
    '2027-06-09',
    '2027-09-25', // 中秋附近（以官方為準）
    '2027-09-28',
    '2027-10-09', '2027-10-10', '2027-10-11',
    '2027-10-25',
    '2027-12-25',
  ]);

  // 補行上班日（週末但要上班）— 2025 下半年起新制原則上不再補班
  const TW_MAKEUP_WORKDAYS = new Set([
    // 2024 常見補班
    '2024-02-17',
    // 2025 上半年若有補班可列於此
  ]);

  // 固定國定（每年）— 用於尚未建檔年份的 fallback
  const FIXED_MONTH_DAY = [
    [1, 1], // 元旦
    [2, 28], // 和平紀念日
    [4, 4], // 兒童節
    [5, 1], // 勞動節
    [9, 28], // 教師節
    [10, 10], // 國慶
    [10, 25], // 臺灣光復節
    [12, 25], // 行憲紀念日
  ];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDateKey(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function parseDateKey(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3], key: `${m[1]}-${m[2]}-${m[3]}` };
  }

  function parseDateTime(s) {
    const str = String(s || '').trim().replace(' ', 'T');
    const m = str.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const date = m[1];
    const hh = m[2] != null ? Number(m[2]) : null;
    const mm = m[3] != null ? Number(m[3]) : null;
    const hasTime = hh != null && mm != null;
    const ms = hasTime
      ? new Date(`${date}T${pad2(hh)}:${pad2(mm)}:00`).getTime()
      : new Date(`${date}T00:00:00`).getTime();
    if (Number.isNaN(ms)) return null;
    return { date, hasTime, hour: hasTime ? hh : 0, minute: hasTime ? mm : 0, ms };
  }

  function isWeekend(dateKey) {
    const p = parseDateKey(dateKey);
    if (!p) return false;
    const day = new Date(`${dateKey}T12:00:00`).getDay();
    return day === 0 || day === 6;
  }

  function isHoliday(dateKey) {
    if (TW_HOLIDAYS.has(dateKey)) return true;
    // fallback：固定國定（尚未列入年度表時）
    const p = parseDateKey(dateKey);
    if (!p) return false;
    // 僅在該年完全沒有任何資料時才用固定日，避免誤傷
    const yearHasData = [...TW_HOLIDAYS].some((k) => k.startsWith(String(p.y)));
    if (yearHasData) return false;
    return FIXED_MONTH_DAY.some(([mo, da]) => mo === p.m && da === p.d);
  }

  /** 是否為應出勤日（排除例假日與國定假日；補班日視為出勤） */
  function isWorkday(dateKey) {
    if (TW_MAKEUP_WORKDAYS.has(dateKey)) return true;
    if (isHoliday(dateKey)) return false;
    if (isWeekend(dateKey)) return false;
    return true;
  }

  function eachDateKey(startKey, endKey, fn) {
    const a = parseDateKey(startKey);
    const b = parseDateKey(endKey);
    if (!a || !b) return;
    let cur = new Date(`${a.key}T12:00:00`);
    const end = new Date(`${b.key}T12:00:00`);
    if (end < cur) return;
    // safety cap 3660 days
    let n = 0;
    while (cur <= end && n < 3660) {
      const key = toDateKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      fn(key);
      cur.setDate(cur.getDate() + 1);
      n += 1;
    }
  }

  /**
   * 當日實際工時（小時）
   * - 出勤 09:00～17:30；午休 12:30～13:30 不計入
   * - 全日 09:00～17:30 → **7.5 小時**
   * - 其他時段依起迄實際計算（例：09:00～12:30＝3.5 小時）
   * - 對齊 0.5 小時；有工時時最小 0.5
   */
  function workHoursOnDay(dateKey, rangeStartMs, rangeEndMs) {
    const dayStart = new Date(`${dateKey}T09:00:00`).getTime();
    const dayEnd = new Date(`${dateKey}T17:30:00`).getTime();
    const lunch0 = new Date(`${dateKey}T12:30:00`).getTime();
    const lunch1 = new Date(`${dateKey}T13:30:00`).getTime();
    const from = Math.max(rangeStartMs, dayStart);
    const to = Math.min(rangeEndMs, dayEnd);
    if (!(to > from)) return 0;

    // 全日 09:00～17:30 → 固定 7.5 小時（扣 1 小時午休）
    if (from <= dayStart && to >= dayEnd) return 7.5;

    let h = (to - from) / 3600000;
    // 扣除午休重疊 12:30～13:30
    const lf = Math.max(from, lunch0);
    const lt = Math.min(to, lunch1);
    if (lt > lf) h -= (lt - lf) / 3600000;

    h = Math.max(0, h);
    // 對齊 0.5 小時
    h = Math.round(h * 2) / 2;
    // 有請假時段但不足 0.5 小時 → 顯示 0.5
    if (h > 0 && h < 0.5) h = 0.5;
    return h;
  }

  /**
   * 當日計入「天數」
   * - 全日 09:00～17:30 → 1 日（7.5 小時）
   * - 上午 09:00～12:30 → 0.5
   * - 下午 13:30～17:30 → 0.5
   * - 未滿半天 → 0（只計小時）
   */
  function workDaysOnDay(dateKey, rangeStartMs, rangeEndMs) {
    const dayStart = new Date(`${dateKey}T09:00:00`).getTime();
    const dayEnd = new Date(`${dateKey}T17:30:00`).getTime();
    const amHalfEnd = new Date(`${dateKey}T12:30:00`).getTime();
    const lunchEnd = new Date(`${dateKey}T13:30:00`).getTime();
    const from = Math.max(rangeStartMs, dayStart);
    const to = Math.min(rangeEndMs, dayEnd);
    if (!(to > from)) return 0;

    // 全日
    if (from <= dayStart && to >= dayEnd) return 1;

    // 上午半天：09:00 起、做到 12:30（或停在午休內）
    if (from <= dayStart && to >= amHalfEnd && to <= lunchEnd) return 0.5;

    // 下午半天：13:30（或午休內）起、做到 17:30
    if (from >= amHalfEnd && from <= lunchEnd && to >= dayEnd) return 0.5;
    if (from >= lunchEnd && to >= dayEnd) return 0.5;

    // 其餘：依實際工時（≥3.5 小時可視為半天；≥7.5 為全日）
    const h = workHoursOnDay(dateKey, rangeStartMs, rangeEndMs);
    if (h >= 7.5) return 1;
    if (h >= 3.5) return 0.5;
    return 0;
  }

  function roundHalf(n) {
    return Math.round(n * 2) / 2;
  }

  /**
   * 請假天數／小時試算
   * 上班 09:00～17:30；午休 12:30～13:30
   * 09:00～12:30＝0.5 日／3.5 小時；13:30～17:30＝0.5 日／4 小時
   * 全日＝1 日／7.5 小時
   */
  function calcLeaveDays(startStr, endStr) {
    const empty = {
      days: 0,
      hours: 0,
      workdays: 0,
      skippedHolidays: [],
      skippedWeekends: [],
      note: '起迄時間無效',
    };
    const start = parseDateTime(startStr);
    const end = parseDateTime(endStr);
    if (!start || !end || end.ms < start.ms) {
      return empty;
    }

    const rangeStart = start.hasTime
      ? start.ms
      : new Date(`${start.date}T09:00:00`).getTime();
    const rangeEnd = end.hasTime
      ? end.ms
      : new Date(`${end.date}T17:30:00`).getTime();

    const skippedHolidays = [];
    const skippedWeekends = [];
    let totalHours = 0;
    let totalDays = 0;
    let workdays = 0;

    eachDateKey(start.date, end.date, (key) => {
      if (!isWorkday(key)) {
        if (TW_MAKEUP_WORKDAYS.has(key)) return;
        if (isHoliday(key)) skippedHolidays.push(key);
        else if (isWeekend(key)) skippedWeekends.push(key);
        return;
      }
      const h = workHoursOnDay(key, rangeStart, rangeEnd);
      const d = workDaysOnDay(key, rangeStart, rangeEnd);
      if (h > 0 || d > 0) {
        workdays += 1;
        totalHours += h;
        totalDays += d;
      }
    });

    totalHours = Math.round(totalHours * 2) / 2;
    let days = roundHalf(totalDays);
    if (days < 0.5) days = 0;

    const noteParts = [];
    if (skippedHolidays.length) {
      noteParts.push(`已排除國定假日 ${skippedHolidays.length} 天`);
    }
    if (skippedWeekends.length) {
      noteParts.push(`已排除例假日 ${skippedWeekends.length} 天`);
    }
    noteParts.push(
      `出勤 ${workdays} 天、實際 ${totalHours} 小時（全日＝1 日／7.5 小時；上午半天＝3.5 小時；下午半天＝4 小時；午休 12:30～13:30 不計）`
    );

    return {
      days,
      hours: totalHours,
      workdays,
      skippedHolidays,
      skippedWeekends,
      note: noteParts.join('；'),
    };
  }

  global.TwCalendar = {
    isWorkday,
    isHoliday,
    isWeekend,
    calcLeaveDays,
    HOLIDAYS: TW_HOLIDAYS,
    MAKEUP: TW_MAKEUP_WORKDAYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
