/**
 * 裝置綁定與來源 IP
 */
const db = require('../db');
const crypto = require('crypto');
const { parseCookies, isBuiltinAdminUser } = require('../auth');
const systemSettings = require('../system-settings');

const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));


const DEVICE_COOKIE = 'approval_device';

const DEVICE_COOKIE_MS = 400 * 24 * 60 * 60 * 1000;

/** 信用額度單判定（流程名稱或主旨含「信用額度」） */

function setDeviceCookie(req, res, token) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MS,
    secure: !!(req && req.secure),
  });
}


function bindOrCheckDevice(req, res, user) {
  const cfg = systemSettings.getAccessControl();
  // 開發階段停用：DEVICE_BIND_FEATURE_ENABLED=false（見 system-settings.js）
  if (!cfg.deviceBindEnabled) return { ok: true };
  const cookies = parseCookies(req);
  let token = String(cookies[DEVICE_COOKIE] || '').trim();
  if (token) {
    const row = db
      .prepare(`SELECT id FROM user_devices WHERE user_id = ? AND device_token = ?`)
      .get(user.id, token);
    if (row) {
      db.prepare(
        `UPDATE user_devices SET last_seen_at = datetime('now','localtime'), ip_address = ? WHERE id = ?`
      ).run(getClientIp(req), row.id);
      setDeviceCookie(req, res, token);
      return { ok: true };
    }
  }
  const count = db.prepare(`SELECT COUNT(*) AS c FROM user_devices WHERE user_id = ?`).get(user.id).c;
  const max = cfg.deviceBindMax || 3;
  if (count >= max && !isBuiltinAdminUser(user)) {
    return {
      ok: false,
      error: `此電腦尚未綁定（本帳號已達 ${max} 台）。請洽系統管理員在成員名單解除舊裝置。`,
    };
  }
  token = crypto.randomBytes(16).toString('hex');
  const ua = String(req.headers['user-agent'] || '').slice(0, 180);
  db.prepare(
    `INSERT INTO user_devices (user_id, device_token, label, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(user.id, token, ua.slice(0, 80) || '瀏覽器', getClientIp(req), ua);
  setDeviceCookie(req, res, token);
  return { ok: true };
}


function listUserDevices(userId) {
  return db
    .prepare(
      `SELECT id, label, ip_address, last_seen_at, created_at FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC`
    )
    .all(userId);
}

function normalizeClientIp(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') return '127.0.0.1';
  s = s.replace(/%[0-9a-zA-Z]+$/, '');
  return s;
}

function isLoopbackIp(ip) {
  const s = normalizeClientIp(ip);
  return s === '127.0.0.1' || s === 'localhost' || s === '::1';
}

/** 從 X-Forwarded-For／X-Real-IP 取第一個看起來像 IP 的值 */
function firstForwardedIp(headerVal) {
  const parts = String(headerVal || '')
    .split(',')
    .map((s) => normalizeClientIp(s))
    .filter(Boolean);
  return parts[0] || '';
}

/**
 * 取得請求端 IP。
 * Synology Docker 埠對應會把來源變成 172.x.0.1，簽核服務需用 host 網路才能看到真實 IP。
 * 僅在對端是本機（127.0.0.1）或明確 TRUST_PROXY 時才採信 X-Forwarded-For，
 * 避免任意客戶端偽造稽核 IP。
 */
function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const socketIp = normalizeClientIp(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );
  const canTrustHop = TRUST_PROXY || isLoopbackIp(socketIp);
  if (canTrustHop) {
    const forwarded = firstForwardedIp(
      req.headers['x-real-ip'] || req.headers['x-forwarded-for']
    );
    if (forwarded) return forwarded;
    if (TRUST_PROXY && req.ip) return normalizeClientIp(req.ip) || '127.0.0.1';
  }
  return socketIp || '127.0.0.1';
}

/** 寫入系統進階稽核日誌 (P3-1) */

const auditLog = require('../audit-log');

function logAudit(req, opts = {}) {
  auditLog.write(opts, req);
}

/**
 * P2-1: 處理最終核准時的自動連動 (銷假單扣回 & 加班轉補休)
 */

module.exports = {
  TRUST_PROXY,
  DEVICE_COOKIE,
  DEVICE_COOKIE_MS,
  setDeviceCookie,
  bindOrCheckDevice,
  listUserDevices,
  getClientIp,
  logAudit,
};
