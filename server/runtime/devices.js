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

/** 取得請求端 IP：未設 TRUST_PROXY 時不採信 X-Forwarded-For */

function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const raw = TRUST_PROXY
    ? req.ip || req.socket?.remoteAddress
    : req.socket?.remoteAddress || req.connection?.remoteAddress;
  return String(raw || '127.0.0.1').replace(/^::ffff:/, '');
}

/** 寫入系統進階稽核日誌 (P3-1) */

function logAudit(req, { action_type, category = 'general', description, target_id = null, detail = {} }) {
  try {
    const user = req?.user;
    const userId = user?.id || null;
    const userName = user?.name || (userId ? '' : '系統/訪客');
    const userUsername = user?.username || '';
    const ip = getClientIp(req);

    db.prepare(`
      INSERT INTO system_audit_logs (user_id, user_name, user_username, action_type, category, description, ip_address, target_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userName,
      userUsername,
      String(action_type || 'unknown'),
      String(category || 'general'),
      String(description || ''),
      ip,
      target_id ? Number(target_id) : null,
      JSON.stringify(detail || {})
    );
  } catch (e) {
    console.error('[audit-log] record failed:', e.message);
  }
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
