const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'approval-system-secret-change-in-production-2026';
const JWT_EXPIRES = '7d';

/**
 * 帳號顯示／儲存規範：去除首尾空白，英文第一個字母大寫。
 * 例：admin → Admin、tsuming → Tsuming、CHEN → CHEN（僅首字母；其餘維持輸入）
 * 登入仍不區分大小寫（見 findUserByUsername）。
 */
function normalizeUsername(username) {
  const s = String(username || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 系統內建預設管理員帳號（正規化後為 Admin） */
const BUILTIN_ADMIN_USERNAME = 'Admin';

/** 是否為內建 admin 帳號（不分大小寫：admin / Admin / ADMIN） */
function isBuiltinAdminUsername(username) {
  return String(username || '').trim().toLowerCase() === 'admin';
}

function isBuiltinAdminUser(user) {
  return !!(user && isBuiltinAdminUsername(user.username));
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token =
    (header.startsWith('Bearer ') ? header.slice(7) : null) ||
    req.query?.token ||
    null;
  if (!token) {
    return res.status(401).json({ error: '請先登入' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登入已過期，請重新登入' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
}

/**
 * 僅內建 admin 帳號（username=Admin）可通過。
 * 其他「最高權限」系統管理員亦不可進入系統設定等。
 * 須接在 authMiddleware 之後；建議依 JWT 的 username 判斷（與 DB 同步）。
 */
function builtinAdminOnly(req, res, next) {
  if (!isBuiltinAdminUsername(req.user?.username)) {
    return res.status(403).json({ error: '僅系統內建 Admin 帳號可執行此操作' });
  }
  next();
}

module.exports = {
  normalizeUsername,
  BUILTIN_ADMIN_USERNAME,
  isBuiltinAdminUsername,
  isBuiltinAdminUser,
  hashPassword,
  verifyPassword,
  signToken,
  authMiddleware,
  adminOnly,
  builtinAdminOnly,
  JWT_SECRET,
};
