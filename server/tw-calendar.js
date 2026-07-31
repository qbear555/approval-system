/**
 * 台灣辦公日曆：自動抓取 + 本地快取
 *
 * 資料來源（優先序）：
 *  1. jsDelivr CDN — ruyut/TaiwanCalendar（依人事總處辦公日曆彙整）
 *  2. GitHub raw 備援
 *  3. 本地 data/tw-calendar-cache.json
 *  4. 內建備援表（2024–2027）
 *
 * 每年 6–8 月官方公告次年後，遠端資料集通常會更新；
 * 本模組啟動時與每日檢查，自動拉取「前年～次年」（7 月後含後年）。
 */
const fs = require('fs');
const path = require('path');

const CACHE_PATH =
  process.env.TW_CALENDAR_CACHE ||
  path.join(__dirname, '..', 'data', 'tw-calendar-cache.json');

const SOURCES = [
  (y) =>
    `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar@master/data/${y}.json`,
  (y) =>
    `https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/${y}.json`,
];

const REFRESH_MS = 24 * 60 * 60 * 1000; // 每日
const FETCH_TIMEOUT_MS = 12000;

/** 內建備援：國定／補假（非純例假）；補班日 */
const BUILTIN = {
  holidays: [
    '2024-01-01',
    '2024-02-08',
    '2024-02-09',
    '2024-02-10',
    '2024-02-11',
    '2024-02-12',
    '2024-02-13',
    '2024-02-14',
    '2024-02-28',
    '2024-04-04',
    '2024-04-05',
    '2024-05-01',
    '2024-06-10',
    '2024-09-17',
    '2024-10-10',
    '2025-01-01',
    '2025-01-25',
    '2025-01-26',
    '2025-01-27',
    '2025-01-28',
    '2025-01-29',
    '2025-01-30',
    '2025-01-31',
    '2025-02-01',
    '2025-02-02',
    '2025-02-28',
    '2025-04-03',
    '2025-04-04',
    '2025-04-05',
    '2025-04-06',
    '2025-05-01',
    '2025-05-30',
    '2025-05-31',
    '2025-09-28',
    '2025-09-29',
    '2025-10-04',
    '2025-10-05',
    '2025-10-06',
    '2025-10-10',
    '2025-10-24',
    '2025-10-25',
    '2026-01-01',
    '2026-02-14',
    '2026-02-15',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-21',
    '2026-02-22',
    '2026-02-27',
    '2026-02-28',
    '2026-03-01',
    '2026-04-03',
    '2026-04-04',
    '2026-04-05',
    '2026-04-06',
    '2026-05-01',
    '2026-05-02',
    '2026-05-03',
    '2026-06-19',
    '2026-06-20',
    '2026-06-21',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
    '2026-09-28',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
    '2026-10-24',
    '2026-10-25',
    '2026-10-26',
    '2026-12-25',
    '2026-12-26',
    '2026-12-27',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-02-04',
    '2027-02-05',
    '2027-02-06',
    '2027-02-07',
    '2027-02-08',
    '2027-02-09',
    '2027-02-10',
    '2027-02-27',
    '2027-02-28',
    '2027-03-01',
    '2027-04-03',
    '2027-04-04',
    '2027-04-05',
    '2027-04-06',
    '2027-04-30',
    '2027-05-01',
    '2027-05-02',
    '2027-06-09',
    '2027-09-25',
    '2027-09-28',
    '2027-10-09',
    '2027-10-10',
    '2027-10-11',
    '2027-10-25',
    '2027-12-25',
  ],
  makeup: ['2024-02-17'],
};

/** @type {{ holidays: string[], makeup: string[], years: number[], items: object[], updatedAt: string|null, source: string, errors: string[] }} */
let state = {
  holidays: [...BUILTIN.holidays],
  makeup: [...BUILTIN.makeup],
  years: [],
  items: [],
  updatedAt: null,
  source: 'builtin',
  errors: [],
};

let refreshTimer = null;
let refreshing = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromCompact(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayOfWeek(ymd) {
  const d = new Date(`${ymd}T12:00:00`);
  return d.getDay(); // 0=Sun … 6=Sat
}

function isWeekendYmd(ymd) {
  const w = dayOfWeek(ymd);
  return w === 0 || w === 6;
}

/**
 * 解析 ruyut/TaiwanCalendar 年度 JSON
 * - 放假：isHoliday=true 且（非純週末 或 有說明＝國定／補假）
 * - 補班：週末但 isHoliday=false
 */
function parseYearPayload(year, rows) {
  const holidays = [];
  const makeup = [];
  const items = [];
  if (!Array.isArray(rows) || rows.length < 300) {
    throw new Error(`${year} 資料筆數異常（${rows?.length || 0}）`);
  }
  for (const row of rows) {
    const ymd = ymdFromCompact(row.date);
    if (!ymd) continue;
    const desc = String(row.description || '').trim();
    const off = row.isHoliday === true;
    const weekend = isWeekendYmd(ymd);
    if (off) {
      // 平日放假，或週末但有國定／補假說明 → 列入假日表
      if (!weekend || desc) {
        holidays.push(ymd);
      }
      items.push({ date: ymd, type: 'holiday', description: desc || (weekend ? '例假' : '放假') });
    } else if (weekend) {
      makeup.push(ymd);
      items.push({ date: ymd, type: 'makeup', description: desc || '補行上班' });
    }
  }
  if (holidays.length < 5) {
    throw new Error(`${year} 解析後假日過少（${holidays.length}）`);
  }
  return { year, holidays, makeup, items };
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ApprovalSystem-TWCalendar/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchYear(year) {
  const errors = [];
  for (const makeUrl of SOURCES) {
    const url = makeUrl(year);
    try {
      const data = await fetchJson(url);
      return { parsed: parseYearPayload(year, data), url };
    } catch (e) {
      errors.push(`${url}: ${e.message || e}`);
    }
  }
  throw new Error(errors.join(' | '));
}

function yearsToFetch(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1–12
  // 前年、今年、明年；7 月起再抓後年（官方通常 6 月底前公告次年）
  const list = [y - 1, y, y + 1];
  if (m >= 7) list.push(y + 2);
  return [...new Set(list)].sort((a, b) => a - b);
}

function loadCacheFile() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!raw || !Array.isArray(raw.holidays) || raw.holidays.length < 5) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveCacheFile(payload) {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.warn('[tw-calendar] 寫入快取失敗:', e.message);
  }
}

function applyState(partial) {
  state = {
    holidays: [...(partial.holidays || [])].sort(),
    makeup: [...(partial.makeup || [])].sort(),
    years: partial.years || [],
    items: partial.items || [],
    updatedAt: partial.updatedAt || null,
    source: partial.source || 'unknown',
    errors: partial.errors || [],
  };
}

function applyBuiltin(reason) {
  applyState({
    holidays: BUILTIN.holidays,
    makeup: BUILTIN.makeup,
    years: [2024, 2025, 2026, 2027],
    items: [],
    updatedAt: null,
    source: 'builtin',
    errors: reason ? [reason] : [],
  });
}

/**
 * 從遠端更新；失敗則保留現有 state / 快取 / 內建
 * @param {{ force?: boolean }} opts
 */
async function refresh(opts = {}) {
  if (refreshing) return getPublic();
  refreshing = true;
  const errors = [];
  try {
    const years = yearsToFetch();
    const allHolidays = new Set();
    const allMakeup = new Set();
    const allItems = [];
    const okYears = [];
    const sources = [];

    for (const y of years) {
      try {
        const { parsed, url } = await fetchYear(y);
        parsed.holidays.forEach((d) => allHolidays.add(d));
        parsed.makeup.forEach((d) => allMakeup.add(d));
        allItems.push(...parsed.items);
        okYears.push(y);
        sources.push(url);
      } catch (e) {
        errors.push(`${y}: ${e.message || e}`);
        console.warn(`[tw-calendar] 抓取 ${y} 失敗:`, e.message || e);
      }
    }

    if (okYears.length === 0) {
      // 全失敗：保留既有；若尚無資料則內建
      if (!state.updatedAt && state.source === 'builtin') {
        applyBuiltin(errors.join('; '));
      } else {
        state.errors = errors;
      }
      return getPublic();
    }

    const payload = {
      holidays: [...allHolidays].sort(),
      makeup: [...allMakeup].sort(),
      years: okYears,
      items: allItems,
      updatedAt: new Date().toISOString(),
      source: sources[0] || 'remote',
      sources,
      errors,
    };
    applyState(payload);
    saveCacheFile(payload);
    console.log(
      `[tw-calendar] 已更新 ${okYears.join(',')}：放假 ${payload.holidays.length} 日、補班 ${payload.makeup.length} 日`
    );
    return getPublic();
  } finally {
    refreshing = false;
  }
}

function initFromCacheOrBuiltin() {
  const cached = loadCacheFile();
  if (cached) {
    applyState({
      holidays: cached.holidays,
      makeup: cached.makeup || [],
      years: cached.years || [],
      items: cached.items || [],
      updatedAt: cached.updatedAt || null,
      source: cached.source || 'cache',
      errors: [],
    });
    console.log(
      `[tw-calendar] 載入快取（${state.updatedAt || '未知時間'}），放假 ${state.holidays.length} 日`
    );
  } else {
    applyBuiltin();
    console.log('[tw-calendar] 使用內建備援表');
  }
}

function getPublic() {
  return {
    holidays: state.holidays,
    makeup: state.makeup,
    years: state.years,
    updatedAt: state.updatedAt,
    source: state.source,
    errors: state.errors,
    counts: {
      holidays: state.holidays.length,
      makeup: state.makeup.length,
    },
  };
}

function getDetail() {
  return {
    ...getPublic(),
    items: state.items,
    cachePath: CACHE_PATH,
  };
}

function isHoliday(dateKey) {
  const key = String(dateKey || '').slice(0, 10);
  return state.holidays.includes(key);
}

function isMakeup(dateKey) {
  const key = String(dateKey || '').slice(0, 10);
  return state.makeup.includes(key);
}

function isWeekend(dateKey) {
  return isWeekendYmd(String(dateKey || '').slice(0, 10));
}

function isWorkday(dateKey) {
  const key = String(dateKey || '').slice(0, 10);
  if (isMakeup(key)) return true;
  if (isHoliday(key)) return false;
  if (isWeekend(key)) return false;
  return true;
}

/**
 * 啟動：讀快取 → 背景刷新 → 每日排程
 */
function startAutoRefresh() {
  initFromCacheOrBuiltin();
  // 背景更新，不阻塞啟動
  setTimeout(() => {
    refresh().catch((e) => console.warn('[tw-calendar] 啟動刷新失敗', e.message));
  }, 1500);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refresh().catch((e) => console.warn('[tw-calendar] 定期刷新失敗', e.message));
  }, REFRESH_MS);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

module.exports = {
  startAutoRefresh,
  refresh,
  getPublic,
  getDetail,
  isHoliday,
  isMakeup,
  isWorkday,
  isWeekend,
  yearsToFetch,
};
