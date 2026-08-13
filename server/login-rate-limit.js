/**
 * 登入防爆破（行程內記憶體）。
 * 同一 IP＋帳號 15 分鐘內失敗 5 次鎖定 15 分鐘；
 * 同一 IP 不論帳號 15 分鐘內失敗 20 次亦鎖定（防帳號掃射）。
 */
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_PER_KEY = 5;
const MAX_PER_IP = 20;

class Counter {
  constructor() {
    this.map = new Map();
  }

  prune(now) {
    if (this.map.size < 200) return;
    for (const [k, rec] of this.map) {
      const lockOver = rec.lockedUntil && rec.lockedUntil <= now;
      const windowOver = !rec.lockedUntil && now - rec.firstAt > WINDOW_MS;
      if (lockOver || windowOver) this.map.delete(k);
    }
  }

  _fresh(now) {
    return { count: 0, firstAt: now, lockedUntil: 0 };
  }

  check(key, max) {
    const now = Date.now();
    this.prune(now);
    const rec = this.map.get(key);
    if (!rec) return { blocked: false, remainingSec: 0 };
    if (rec.lockedUntil && rec.lockedUntil > now) {
      return { blocked: true, remainingSec: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    if (rec.lockedUntil && rec.lockedUntil <= now) {
      this.map.delete(key);
      return { blocked: false, remainingSec: 0 };
    }
    if (now - rec.firstAt > WINDOW_MS) {
      this.map.delete(key);
      return { blocked: false, remainingSec: 0 };
    }
    if (rec.count >= max) {
      rec.lockedUntil = now + LOCK_MS;
      return { blocked: true, remainingSec: Math.ceil(LOCK_MS / 1000) };
    }
    return { blocked: false, remainingSec: 0 };
  }

  fail(key, max) {
    const now = Date.now();
    let rec = this.map.get(key);
    if (
      !rec ||
      (rec.lockedUntil && rec.lockedUntil <= now) ||
      now - rec.firstAt > WINDOW_MS
    ) {
      rec = this._fresh(now);
    }
    rec.count += 1;
    if (rec.count >= max) rec.lockedUntil = now + LOCK_MS;
    this.map.set(key, rec);
    return {
      blocked: !!(rec.lockedUntil && rec.lockedUntil > now),
      remainingSec: rec.lockedUntil ? Math.max(1, Math.ceil((rec.lockedUntil - now) / 1000)) : 0,
      count: rec.count,
    };
  }

  reset(key) {
    this.map.delete(key);
  }
}

const byKey = new Counter();
const byIp = new Counter();

function normUser(username) {
  return String(username || '').trim().toLowerCase();
}

function normIp(ip) {
  const s = String(ip || 'unknown').trim() || 'unknown';
  return s;
}

function checkLogin(ip, username) {
  const ipk = normIp(ip);
  const key = `${ipk}:${normUser(username)}`;
  const a = byKey.check(key, MAX_PER_KEY);
  if (a.blocked) return a;
  const b = byIp.check(ipk, MAX_PER_IP);
  if (b.blocked) return b;
  return { blocked: false, remainingSec: 0 };
}

function recordFail(ip, username) {
  const ipk = normIp(ip);
  const key = `${ipk}:${normUser(username)}`;
  const a = byKey.fail(key, MAX_PER_KEY);
  const b = byIp.fail(ipk, MAX_PER_IP);
  if (a.blocked) return a;
  if (b.blocked) return b;
  return { blocked: false, remainingSec: 0, count: a.count };
}

function recordSuccess(ip, username) {
  const ipk = normIp(ip);
  byKey.reset(`${ipk}:${normUser(username)}`);
}

function lockMessage(remainingSec) {
  const sec = Math.max(1, Number(remainingSec) || 0);
  const min = Math.ceil(sec / 60);
  if (sec < 60) return `登入失敗次數過多，請 ${sec} 秒後再試`;
  return `登入失敗次數過多，請約 ${min} 分鐘後再試`;
}

module.exports = {
  WINDOW_MS,
  LOCK_MS,
  MAX_PER_KEY,
  MAX_PER_IP,
  checkLogin,
  recordFail,
  recordSuccess,
  lockMessage,
  // 僅供單元測試
  _resetAll() {
    byKey.map.clear();
    byIp.map.clear();
  },
};
