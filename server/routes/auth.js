/**
 * 登入／裝置／代理／個人簽名
 */
module.exports = function register(ctx) {
  const {
    app,
    db,
    fs,
    path,
    multer,
    tz,
    mail,
    labor,
    twCalendar,
    systemSettings,
    pdfSign,
    appVersion,
    deployLog,
    systemPackage,
    lineNotify,
    PassThrough,
    authMiddleware,
    adminOnly,
    builtinAdminOnly,
    lineSettingsOnly,
    normalizeUsername,
    isBuiltinAdminUsername,
    isBuiltinAdminUser,
    hashPassword,
    verifyPassword,
    isWeakPlainPassword,
    hashMatchesWeakPassword,
    generateBootstrapPassword,
    signToken,
    setAuthCookie,
    clearAuthCookie,
    loginRateLimit,
    contentDispositionAttachment,
    getChineseFontPath,
    bindOrCheckDevice,
    listUserDevices,
    getClientIp,
    logAudit,
    parsePermissions,
    getUserDepartments,
    publicUser,
    canConfigureLineSettings,
    addUserToDepartment,
    removeUserFromDepartment,
    userHasPermission,
    resolveNextHireDate,
    getActiveDelegationForUser,
    getGrantorUserIdsForDelegate,
    isValidDepartment,
    upload,
    uploadPackage,
    PERMISSION_DEFS,
  } = ctx;
// ---------- Auth ----------
/** 不開放自行註冊；帳號僅能由管理員在「成員名單」建立 */
app.post('/api/auth/register', (req, res) => {
  logAudit(req, {
    action_type: 'register_blocked',
    category: 'auth',
    description: '拒絕公開自行註冊',
  });
  return res.status(403).json({ error: '不開放自行註冊，請洽系統管理員建立帳號' });
});

/** 依帳號查詢（不區分大小寫；優先精確相符） */
function findUserByUsername(username, { activeOnly = true } = {}) {
  const uname = String(username || '').trim();
  if (!uname) return null;
  const activeSql = activeOnly ? ' AND active = 1' : '';
  // 1) 精確相符
  let user = db
    .prepare(`SELECT * FROM users WHERE username = ?${activeSql}`)
    .get(uname);
  if (user) return user;
  // 2) 不區分大小寫（admin / Admin / ADMIN 皆可登入）
  user = db
    .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE${activeSql}`)
    .get(uname);
  return user || null;
}

app.post('/api/auth/login', (req, res) => {
  try {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }
  const uStr = String(username).trim();
  const pStr = String(password);
  const pTrim = pStr.trim();
  const ip = getClientIp(req);
  const limited = loginRateLimit.checkLogin(ip, uStr);
  if (limited.blocked) {
    const msg = loginRateLimit.lockMessage(limited.remainingSec);
    res.setHeader('Retry-After', String(limited.remainingSec || 60));
    logAudit(req, {
      action_type: 'login_rate_limited',
      category: 'auth',
      description: `登入次數過多已鎖定（帳號：${uStr}）`,
    });
    return res.status(429).json({ error: msg });
  }
  const user = findUserByUsername(uStr, { activeOnly: true });
  if (!user || (!verifyPassword(pStr, user.password_hash) && !verifyPassword(pTrim, user.password_hash))) {
    const after = loginRateLimit.recordFail(ip, uStr);
    logAudit(req, { action_type: 'login_fail', category: 'auth', description: `登入失敗（帳號：${uStr}）` });
    if (after.blocked) {
      const msg = loginRateLimit.lockMessage(after.remainingSec);
      res.setHeader('Retry-After', String(after.remainingSec || 60));
      logAudit(req, {
        action_type: 'login_rate_limited',
        category: 'auth',
        description: `登入失敗達上限已鎖定（帳號：${uStr}）`,
      });
      return res.status(429).json({ error: msg });
    }
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginRateLimit.recordSuccess(ip, uStr);
  const device = bindOrCheckDevice(req, res, user);
  if (!device.ok) {
    logAudit(req, {
      action_type: 'device_blocked',
      category: 'auth',
      description: `裝置未綁定（帳號：${user.username}）`,
    });
    return res.status(403).json({ error: device.error });
  }
  const safe = publicUser(user);
  const token = signToken(safe);
  setAuthCookie(req, res, token);
  const mustChangePassword = hashMatchesWeakPassword(user.password_hash);
  logAudit(req, { action_type: 'login', category: 'auth', description: `使用者 ${safe.name} (${safe.username}) 登入成功` });
  res.json({
    ok: true,
    user: safe,
    permissionDefs: PERMISSION_DEFS,
    mustChangePassword,
  });
  } catch (e) {
    console.error('[login]', e);
    if (!res.headersSent) {
      res.status(500).json({ error: '登入時發生錯誤，請稍後再試' });
    }
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/devices/my', authMiddleware, (req, res) => {
  res.json({ devices: listUserDevices(req.user.id), access: systemSettings.getAccessControl() });
});

app.delete('/api/devices/my/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT id FROM user_devices WHERE id = ? AND user_id = ?`).get(id, req.user.id);
  if (!row) return res.status(404).json({ error: '找不到此裝置' });
  db.prepare(`DELETE FROM user_devices WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.get('/api/users/:id/devices', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  res.json({ devices: listUserDevices(id) });
});

app.delete('/api/users/:id/devices/:deviceId', authMiddleware, adminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const deviceId = Number(req.params.deviceId);
  db.prepare(`DELETE FROM user_devices WHERE id = ? AND user_id = ?`).run(deviceId, userId);
  res.json({ ok: true });
});

app.post('/api/users/:id/devices/clear', authMiddleware, adminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const r = db.prepare(`DELETE FROM user_devices WHERE user_id = ?`).run(userId);
  res.json({ ok: true, deleted: r.changes || 0 });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  // 含到職日／年資／特休摘要
  const user = db
    .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
    .get(req.user.id);
  if (!user) return res.status(401).json({ error: '使用者不存在' });
  res.json({
    user: publicUser(user, { withLabor: true }),
    permissionDefs: PERMISSION_DEFS,
    mustChangePassword: hashMatchesWeakPassword(user.password_hash),
  });
});

app.put('/api/auth/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: '請提供正確的舊密碼，且新密碼至少 6 字元' });
  }
  if (isWeakPlainPassword(newPassword)) {
    return res.status(400).json({ error: '新密碼過於常見，請改用更安全的密碼' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ error: '新密碼不可與舊密碼相同' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true, mustChangePassword: false });
});

/** 任何登入成員可自行修改：姓名、Email、分機、電話、Email 通知偏好 */
app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, email, phone, extension, email_notify } = req.body || {};
  if (name == null || !String(name).trim()) {
    return res.status(400).json({ error: '姓名為必填' });
  }
  const trimmedName = String(name).trim();
  if (trimmedName.length > 80) {
    return res.status(400).json({ error: '姓名過長（最多 80 字）' });
  }
  const emailVal = email != null ? String(email).trim() : '';
  if (emailVal && emailVal.length > 120) {
    return res.status(400).json({ error: 'Email 過長' });
  }
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    return res.status(400).json({ error: 'Email 格式不正確' });
  }
  const phoneVal = phone != null ? String(phone).trim() : '';
  const extVal = extension != null ? String(extension).trim() : '';
  if (phoneVal.length > 40) {
    return res.status(400).json({ error: '電話過長' });
  }
  if (extVal.length > 20) {
    return res.status(400).json({ error: '分機過長' });
  }
  const notifyVal =
    email_notify === 0 || email_notify === false || email_notify === '0' ? 0 : 1;

  db.prepare(
    `UPDATE users SET
      name = ?,
      email = ?,
      phone = ?,
      extension = ?,
      email_notify = ?
     WHERE id = ? AND active = 1`
  ).run(
    trimmedName,
    emailVal || null,
    phoneVal || null,
    extVal || null,
    notifyVal,
    req.user.id
  );

  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(req.user.id);
  if (!user) return res.status(401).json({ error: '使用者不存在' });
  res.json({ user: publicUser(user) });
});

// ---------- 簽核代理人 ----------
app.get('/api/delegations/my', authMiddleware, (req, res) => {
  const activeDelegation = getActiveDelegationForUser(req.user.id);
  const rawDelegation = db
    .prepare(
      `SELECT d.*, u.name AS delegate_name, u.username AS delegate_username
       FROM user_delegations d
       JOIN users u ON u.id = d.delegate_user_id
       WHERE d.user_id = ?
       ORDER BY d.id DESC LIMIT 1`
    )
    .get(req.user.id);
  const grantors = getGrantorUserIdsForDelegate(req.user.id);
  res.json({
    activeDelegation,
    delegation: rawDelegation || null,
    grantors,
  });
});

app.post('/api/delegations/my', authMiddleware, (req, res) => {
  const { delegate_user_id, start_time, end_time, active } = req.body || {};
  const delegateId = Number(delegate_user_id);
  if (!delegateId) {
    return res.status(400).json({ error: '請選擇代理對象' });
  }
  if (delegateId === req.user.id) {
    return res.status(400).json({ error: '不能指定自己為代理人' });
  }
  const targetUser = db.prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`).get(delegateId);
  if (!targetUser) {
    return res.status(400).json({ error: '代理人帳號不存在或已停用' });
  }

  const startVal = start_time ? String(start_time).trim() : null;
  const endVal = end_time ? String(end_time).trim() : null;
  const isActive = active === false || active === 0 || active === '0' ? 0 : 1;

  // 將舊的代理設定設為停用
  db.prepare(`UPDATE user_delegations SET active = 0 WHERE user_id = ?`).run(req.user.id);

  db.prepare(
    `INSERT INTO user_delegations (user_id, delegate_user_id, start_time, end_time, active)
     VALUES (?, ?, ?, ?, ?)`
  ).run(req.user.id, delegateId, startVal, endVal, isActive);

  const current = getActiveDelegationForUser(req.user.id);
  res.json({ ok: true, delegation: current, message: `已成功設定 ${targetUser.name} 為您的簽核代理人` });
});

app.delete('/api/delegations/my', authMiddleware, (req, res) => {
  db.prepare(`UPDATE user_delegations SET active = 0 WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true, message: '已取消簽核代理設定' });
});

// ---------- 電子簽名檔 ----------
app.get('/api/users/me/signature', authMiddleware, (req, res) => {
  const row = db.prepare(`SELECT signature_image FROM users WHERE id = ?`).get(req.user.id);
  res.json({ signature_image: row?.signature_image || null });
});

app.post('/api/users/me/signature', authMiddleware, (req, res) => {
  const sig = req.body?.signature_image || req.body?.signature;
  if (!sig || !String(sig).startsWith('data:image/')) {
    return res.status(400).json({ error: '請提供有效的圖檔 Base64 簽名資料' });
  }
  db.prepare(`UPDATE users SET signature_image = ? WHERE id = ?`).run(String(sig), req.user.id);
  res.json({ ok: true, signature_image: String(sig), message: '已儲存個人預設手寫簽名檔' });
});

app.delete('/api/users/me/signature', authMiddleware, (req, res) => {
  db.prepare(`UPDATE users SET signature_image = NULL WHERE id = ?`).run(req.user.id);
  res.json({ ok: true, message: '已清除個人預設手寫簽名檔' });
});
};
