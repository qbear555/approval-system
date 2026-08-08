/**
 * 系統時區：一律使用台灣時間（Asia/Taipei, UTC+8）
 *
 * 背景：資料庫的時間欄位都以 SQLite 的 datetime('now','localtime') 寫入，
 * 也就是「行程所在時區」的時間。但程式各處另外用 new Date().toISOString()
 * 產生時間字串，那是 UTC，比台灣慢 8 小時。兩者混用會出現：
 *   - 顯示錯誤：PDF 浮水印、通知文字的時間都少 8 小時
 *   - 判斷錯誤：代理人生效區間拿 UTC 的 now 去比對台灣時間的欄位，
 *              整整晚 8 小時才生效／失效
 *   - 檔名錯誤：以 UTC 取日期，台灣時間 08:00 前會標成前一天
 *
 * 本模組做兩件事：
 *   1. 在載入時把 process.env.TZ 固定為 Asia/Taipei，讓 new Date() 的
 *      本地方法與 SQLite 的 localtime 一致（部署到 UTC 主機也不會跑掉）
 *   2. 提供台灣時間的格式化函式，取代各處的 toISOString()
 *
 * 需在 require('./db') 之前載入，時區才會套用到資料庫連線。
 */

const TAIPEI = 'Asia/Taipei';

// 行程「啟動時」的實際時區位移，必須在改 TZ 之前取得。
// 這一項決定 SQLite 的 datetime('now','localtime') 會寫入什麼時間：
// SQLite 由 C runtime 在行程啟動時決定時區，之後再改 process.env.TZ
// 對它無效（Node 自己的 Date 則會跟著改）。
const HOST_OFFSET_MIN = -new Date().getTimezoneOffset(); // 台灣為 +480

// 允許以環境變數覆寫（例如未來有海外據點），未設定時固定台灣時間
if (!process.env.TZ) process.env.TZ = TAIPEI;

/**
 * 主機時區若不是 UTC+8，資料庫寫入的時間會是錯的。
 * 這種情況只能在啟動前設定 TZ 環境變數解決，所以啟動時大聲提醒。
 */
function warnIfHostTzMismatch(log) {
  if (HOST_OFFSET_MIN === 480) return true;
  const h = (HOST_OFFSET_MIN / 60).toFixed(1);
  (log || console.warn)(
    `[tz] ⚠️ 主機時區為 UTC${HOST_OFFSET_MIN >= 0 ? '+' : ''}${h}，不是台灣的 UTC+8。\n` +
      `     資料庫的 datetime('now','localtime') 會寫入非台灣時間，且無法在程式內修正——\n` +
      `     SQLite 於行程啟動時決定時區。請在啟動前設定環境變數 TZ=Asia/Taipei\n` +
      `     （Docker 已於 docker-compose.yml／Dockerfile 設定；原生部署請設在 systemd 或啟動腳本）。`
  );
  return false;
}

/** 取得台灣時間的各時間欄位 */
function parts(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const o = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') o[p.type] = p.value;
  }
  // Intl 在午夜可能回傳 24，正規化為 00
  if (o.hour === '24') o.hour = '00';
  return o;
}

/** 'YYYY-MM-DD HH:mm:ss'（台灣時間） */
function nowStamp(date) {
  const p = parts(date);
  if (!p) return '';
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 'YYYY-MM-DD HH:mm'（台灣時間）— 顯示與時間區間比對用 */
function nowMinute(date) {
  return nowStamp(date).slice(0, 16);
}

/** 'YYYY-MM-DD'（台灣時間）— 檔名日期用 */
function today(date) {
  return nowStamp(date).slice(0, 10);
}

/** 帶 +08:00 位移的 ISO 字串，取代 toISOString() 作為紀錄時間戳 */
function nowIso(date) {
  const p = parts(date);
  if (!p) return '';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/** 可安全用於檔名的時間戳：'YYYY-MM-DDTHH-mm-ss' */
function fileStamp(date) {
  const p = parts(date);
  if (!p) return '';
  return `${p.year}-${p.month}-${p.day}T${p.hour}-${p.minute}-${p.second}`;
}

module.exports = { TAIPEI, HOST_OFFSET_MIN, warnIfHostTzMismatch, nowStamp, nowMinute, today, nowIso, fileStamp };
