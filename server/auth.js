const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JWT_EXPIRES = '7d';
const MIN_SECRET_LEN = 24;
const SECRET_FILE = path.join(__dirname, '..', 'data', '.jwt-secret');

/** 公開倉庫／安裝包曾出現的預設值，一律視為弱密鑰 */
const WEAK_SECRETS = new Set([
  '',
  'change-me-to-a-long-random-secret',
  'please-change-this-on-nas',
  'approval-system-secret-change-in-production-2026',
  'please-change-me-in-dotenv-file',
  'onlyoffice-dev-secret-change-me',
  '請改成很長的隨機英數字串',
  '請改成很長的隨機字串',
  '請改成隨機長字串',
  '請換成夠長的隨機字串',
]);

function isWeakSecret(value) {
  const v = String(value || '').trim();
  if (v.length < MIN_SECRET_LEN) return true;
  if (WEAK_SECRETS.has(v)) return true;
  if (/please-change|change-me|change.in.production|請改成|請換成/i.test(v)) return true;
  return false;
}

function readPersistedSecret() {
  try {
    if (!fs.existsSync(SECRET_FILE)) return '';
    return String(fs.readFileSync(SECRET_FILE, 'utf8') || '').trim();
  } catch {
    return '';
  }
}

function persistSecret(secret) {
  const dir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
}

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function resolveJwtSecret() {
  const envSecret = String(process.env.JWT_SECRET || '').trim();
  if (envSecret && !isWeakSecret(envSecret)) {
    return { secret: envSecret, source: 'env' };
  }

  const fileSecret = readPersistedSecret();
  if (fileSecret && !isWeakSecret(fileSecret)) {
    if (envSecret) {
      console.warn(
        '[auth] JWT_SECRET 環境變數為公開預設值或過短，已改用 data/.jwt-secret'
      );
    }
    return { secret: fileSecret, source: 'file' };
  }

  const next = generateSecret();
  try {
    persistSecret(next);
  } catch (e) {
    console.error('[auth] 無法寫入 data/.jwt-secret：', e.message);
    console.error('[auth] 請設定夠長的 JWT_SECRET 環境變數後重啟');
    process.exit(1);
  }
  console.warn(
    '[auth] 已產生新的 JWT 密鑰並寫入 data/.jwt-secret（既有登入需重新登入）'
  );
  return { secret: next, source: 'generated' };
}

const resolved = resolveJwtSecret();
const JWT_SECRET = resolved.secret;
const JWT_SECRET_SOURCE = resolved.source;

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

/** 曾寫進程式／安裝說明的公開弱密碼，禁止再當正式密碼 */
const WEAK_PLAIN_PASSWORDS = ['admin123', 'pass1234', 'password', '123456', 'admin'];

function isWeakPlainPassword(password) {
  const p = String(password || '');
  if (!p) return true;
  return WEAK_PLAIN_PASSWORDS.some((w) => p === w || p.toLowerCase() === w.toLowerCase());
}

function hashMatchesWeakPassword(hash) {
  if (!hash) return false;
  return WEAK_PLAIN_PASSWORDS.some((w) => verifyPassword(w, hash));
}

function generateBootstrapPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

const AUTH_COOKIE = 'approval_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(req) {
  const header = String(req?.headers?.cookie || '');
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function readAuthToken(req) {
  const header = req?.headers?.authorization || '';
  if (header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return parseCookies(req)[AUTH_COOKIE] || '';
}

function authCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
    secure: !!(req && req.secure),
  };
}

function setAuthCookie(req, res, token) {
  res.cookie(AUTH_COOKIE, token, authCookieOptions(req));
}

function clearAuthCookie(req, res) {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: !!(req && req.secure),
  });
}

function authMiddleware(req, res, next) {
  const token = readAuthToken(req);
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
  isWeakPlainPassword,
  hashMatchesWeakPassword,
  generateBootstrapPassword,
  signToken,
  authMiddleware,
  setAuthCookie,
  clearAuthCookie,
  AUTH_COOKIE,
  adminOnly,
  builtinAdminOnly,
  JWT_SECRET,
  JWT_SECRET_SOURCE,
  isWeakSecret,
  MIN_SECRET_LEN,
};
