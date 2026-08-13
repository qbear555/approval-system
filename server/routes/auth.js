/**
 * 帳號／部門／系統設定路由
 * 由 server/index.js 傳入執行期 ctx。
 */
/* eslint-disable no-with */
module.exports = function register(ctx) {
  with (ctx) {
// ---------- Departments ----------
/**
 * 台灣國定假日／補班（請假試算用）
 * GET：需登入；POST refresh：管理員強制從遠端更新
 */
app.get('/api/tw-calendar', authMiddleware, (req, res) => {
  res.json(twCalendar.getPublic());
});

app.get('/api/tw-calendar/detail', authMiddleware, adminOnly, (req, res) => {
  res.json(twCalendar.getDetail());
});

app.post('/api/tw-calendar/refresh', authMiddleware, adminOnly, async (req, res) => {
  try {
    const data = await twCalendar.refresh({ force: true });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message || '更新失敗' });
  }
});

app.get('/api/departments', authMiddleware, (req, res) => {
  const departments = db
    .prepare(
      `SELECT id, name, sort_order FROM departments WHERE active = 1 ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({ departments });
});

app.get('/api/departments/stats', authMiddleware, (req, res) => {
  const departments = db
    .prepare(
      `SELECT d.id, d.name, d.sort_order,
              (
                SELECT COUNT(DISTINCT u.id) FROM users u
                WHERE u.active = 1 AND (
                  u.department = d.name
                  OR EXISTS (
                    SELECT 1 FROM user_departments ud
                    WHERE ud.user_id = u.id AND ud.department = d.name
                  )
                )
              ) AS member_count
       FROM departments d
       WHERE d.active = 1
       ORDER BY d.sort_order ASC, d.id ASC`
    )
    .all()
    .map((d) => {
      const members = db
        .prepare(
          `SELECT DISTINCT u.id, u.username, u.name, u.role, u.email, u.department
           FROM users u
           WHERE u.active = 1 AND (
             u.department = ?
             OR EXISTS (
               SELECT 1 FROM user_departments ud
               WHERE ud.user_id = u.id AND ud.department = ?
             )
           )
           ORDER BY
             CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
             u.name COLLATE NOCASE`
        )
        .all(d.name, d.name)
        .map((m) => ({
          ...m,
          departments: getUserDepartments(m.id),
        }));
      return { ...d, members };
    });
  res.json({ departments });
});

/** 將已註冊成員加入部門（可同時隸屬多個部門） */
app.post('/api/departments/:id/members', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });

  let userIds = req.body?.user_ids;
  if (!Array.isArray(userIds)) userIds = [];
  userIds = userIds.map(Number).filter(Boolean);
  if (!userIds.length) {
    return res.status(400).json({ error: '請選擇至少一位已註冊成員' });
  }

  const added = [];
  const skipped = [];
  for (const uid of userIds) {
    try {
      const already = db
        .prepare(
          `SELECT 1 FROM user_departments WHERE user_id = ? AND department = ?`
        )
        .get(uid, dept.name);
      if (already) {
        skipped.push(uid);
        continue;
      }
      addUserToDepartment(uid, dept.name);
      added.push(uid);
    } catch (e) {
      skipped.push(uid);
    }
  }
  res.json({
    ok: true,
    department: dept.name,
    added_count: added.length,
    skipped_count: skipped.length,
    added,
    skipped,
  });
});

/** 移出部門成員（僅移出該部門，帳號保留，其他部門隸屬保留） */
app.delete(
  '/api/departments/:id/members/:userId',
  authMiddleware,
  adminOnly,
  (req, res) => {
    const id = Number(req.params.id);
    const userId = Number(req.params.userId);
    const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
    if (!dept) return res.status(404).json({ error: '找不到部門' });
    removeUserFromDepartment(userId, dept.name);
    res.json({ ok: true });
  }
);

/** 系統管理員新增部門 */
app.post('/api/departments', authMiddleware, adminOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '請輸入部門名稱' });
  if (name.length > 40) return res.status(400).json({ error: '部門名稱請勿超過 40 字' });

  const existing = db
    .prepare(`SELECT id, active FROM departments WHERE name = ?`)
    .get(name);
  if (existing) {
    if (existing.active) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    // 重新啟用已刪除的同名部門
    const maxSort = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
    db.prepare(
      `UPDATE departments SET active = 1, sort_order = ? WHERE id = ?`
    ).run(maxSort + 1, existing.id);
    const row = db
      .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
      .get(existing.id);
    return res.status(201).json({ department: row });
  }

  try {
    const maxSort = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
    const info = db
      .prepare(`INSERT INTO departments (name, sort_order, active) VALUES (?, ?, 1)`)
      .run(name, maxSort + 1);
    const row = db
      .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
      .get(info.lastInsertRowid);
    res.status(201).json({ department: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    console.error(e);
    res.status(500).json({ error: '新增部門失敗' });
  }
});

/** 系統管理員修改部門名稱（同步更新成員所屬部門） */
app.put('/api/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const newName = String(req.body?.name || '').trim();
  if (!newName) return res.status(400).json({ error: '請輸入部門名稱' });
  if (newName.length > 40) return res.status(400).json({ error: '部門名稱請勿超過 40 字' });

  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });
  if (dept.name === newName) {
    return res.json({
      department: { id: dept.id, name: dept.name, sort_order: dept.sort_order, active: dept.active },
    });
  }

  const clash = db
    .prepare(`SELECT id, active FROM departments WHERE name = ? AND id != ?`)
    .get(newName, id);
  if (clash && clash.active) {
    return res.status(400).json({ error: '此部門名稱已存在' });
  }
  // 若有停用的同名部門，先改掉其名稱以免 UNIQUE 衝突
  if (clash && !clash.active) {
    db.prepare(`UPDATE departments SET name = ? WHERE id = ?`).run(
      `${newName}__old_${clash.id}`,
      clash.id
    );
  }

  const oldName = dept.name;
  try {
    db.prepare(`UPDATE departments SET name = ? WHERE id = ?`).run(newName, id);
    // 同步成員主部門、多部門隸屬、備份索引
    db.prepare(`UPDATE users SET department = ? WHERE department = ?`).run(newName, oldName);
    db.prepare(`UPDATE user_departments SET department = ? WHERE department = ?`).run(
      newName,
      oldName
    );
    try {
      db.prepare(`UPDATE backup_files SET department = ? WHERE department = ?`).run(
        newName,
        oldName
      );
    } catch {
      /* backup table may be empty / ignore */
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    console.error(e);
    return res.status(500).json({ error: '修改部門名稱失敗' });
  }

  const row = db
    .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
    .get(id);
  res.json({ department: row, renamed_from: oldName });
});

/** 系統管理員刪除部門（軟刪除；有成員時不可刪） */
app.delete('/api/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });

  const memberCount = db
    .prepare(
      `SELECT COUNT(DISTINCT u.id) AS c FROM users u
       WHERE u.active = 1 AND (
         u.department = ?
         OR EXISTS (
           SELECT 1 FROM user_departments ud
           WHERE ud.user_id = u.id AND ud.department = ?
         )
       )`
    )
    .get(dept.name, dept.name).c;
  if (memberCount > 0) {
    return res.status(400).json({
      error: `「${dept.name}」尚有 ${memberCount} 位成員，請先將成員「移出部門」後再刪`,
    });
  }

  db.prepare(`UPDATE departments SET active = 0 WHERE id = ?`).run(id);
  res.json({ ok: true, id });
});

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

// ---------- LINE 通知設定 ----------
app.get('/api/line/config', authMiddleware, (req, res) => {
  const pub = lineNotify.publicConfig();
  const canConfigure = canConfigureLineSettings(req.user);
  if (!canConfigure) {
    return res.json({
      enabled: pub.enabled,
      ready: pub.ready,
      canConfigure: false,
      configAccess: pub.configAccess,
    });
  }
  res.json({ ...pub, canConfigure: true });
});

app.put('/api/line/config', authMiddleware, lineSettingsOnly, (req, res) => {
  const body = req.body || {};
  const partial = {
    enabled: body.enabled,
    serviceUrl: body.serviceUrl,
    events: body.events,
    configAccess: body.configAccess,
  };
  // 空字串＝不變更 API Key（與 mail 密碼相同）
  if (body.apiKey != null && String(body.apiKey).trim() !== '') {
    partial.apiKey = String(body.apiKey).trim();
  } else {
    partial.apiKey = '';
  }
  // 僅內建 Admin 可變更「誰可設定 LINE」，避免權限被下放後失控
  if (!isBuiltinAdminUsername(req.user.username)) {
    delete partial.configAccess;
  }
  const saved = lineNotify.saveConfig(partial);
  res.json({
    ok: true,
    config: { ...lineNotify.publicConfig(saved), canConfigure: true },
  });
});

app.post('/api/line/test', authMiddleware, lineSettingsOnly, async (req, res) => {
  const username = String(req.body?.username || req.user.username || '').trim();
  const lineUserId = String(req.body?.lineUserId || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!username && !lineUserId) {
    return res.status(400).json({ error: '請指定簽核帳號或 LINE userId' });
  }
  if (!lineNotify.isReady()) {
    return res.status(400).json({
      error: '請先啟用 LINE 通知並填寫服務網址與 API 金鑰後儲存',
    });
  }
  const result = await lineNotify.testPush({
    username: username || undefined,
    lineUserId: lineUserId || undefined,
    text: text || undefined,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '測試推播失敗', result });
  }
  res.json({ ok: true, result });
});

app.get('/api/line/health', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.healthCheck();
  res.json(result);
});

app.get('/api/line/bindings', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.fetchBindings();
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '無法取得綁定列表' });
  }
  res.json(result);
});

// ---------- Mail settings ----------
app.get('/api/mail/config', authMiddleware, (req, res) => {
  // 所有登入者可見是否啟用；完整 SMTP 僅管理員
  const pub = mail.publicConfig();
  if (req.user.role !== 'admin') {
    return res.json({
      enabled: pub.enabled,
      ready: pub.ready,
      fromName: pub.fromName,
    });
  }
  res.json(pub);
});

app.put('/api/mail/config', authMiddleware, builtinAdminOnly, (req, res) => {
  const body = req.body || {};
  const saved = mail.saveConfig({
    enabled: body.enabled,
    host: body.host,
    port: body.port,
    secure: body.secure,
    ignoreTLS: body.ignoreTLS,
    requireTLS: body.requireTLS,
    tlsRejectUnauthorized: body.tlsRejectUnauthorized,
    user: body.user,
    pass: body.pass,
    from: body.from,
    fromName: body.fromName,
    baseUrl: body.baseUrl,
  });
  res.json({ ok: true, config: mail.publicConfig(saved) });
});

app.post('/api/mail/test', authMiddleware, builtinAdminOnly, async (req, res) => {
  const to = String(req.body?.to || '').trim() || req.user.email;
  // 從 DB 取管理員 email
  const me = db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(req.user.id);
  const target = to || me?.email;
  if (!target) {
    return res.status(400).json({ error: '請指定測試收件 Email，或先在帳號設定填寫自己的 Email' });
  }
  if (!mail.isEnabled()) {
    return res.status(400).json({ error: '請先啟用 Email 提醒並儲存設定' });
  }
  const result = await mail.sendMail({
    to: target,
    subject: '【簽核系統】Email 測試信',
    text: `您好 ${me?.name || ''}，\n\n這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。\n`,
    html: `<p>您好 <strong>${me?.name || ''}</strong>，</p><p>這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。</p>`,
    meta: { type: 'test' },
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '寄送失敗', result });
  }
  res.json({ ok: true, result });
});

// ---------- 系統設定（僅內建 Admin 帳號，其他最高權限亦不可見）----------
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

/** 公開：登入頁品牌（公司名／Logo／版本），不含部門與簽章狀態 */
app.get('/api/system/branding', (req, res) => {
  res.json(systemSettings.getBrandingSettings());
});

/** 已登入：公司名稱／Logo／版本／是否啟用 PDF 簽章 */
app.get('/api/system/settings', authMiddleware, (req, res) => {
  res.json(systemSettings.getPublicSettings());
});

/** 已登入：應用程式版本宣告 */
app.get('/api/system/version', authMiddleware, (req, res) => {
  res.json(appVersion.getVersionInfo());
});

/** 內建 Admin：自動部署／修改紀錄 */
app.get('/api/system/deploy-log', authMiddleware, builtinAdminOnly, (req, res) => {
  const limit = req.query.limit || 30;
  res.json({
    ok: true,
    latest: deployLog.getLatest(),
    ...deployLog.listHistory(limit),
  });
});

/** 公開：自訂 Logo 圖檔（無自訂則 404，前端改用預設） */
app.get('/api/system/logo', (req, res) => {
  const filePath = systemSettings.getLogoFilePath();
  if (!filePath) return res.status(404).end();
  res.sendFile(filePath);
});

/** 內建 Admin：完整系統設定（含 PDF 簽章狀態，不含明文密碼） */
app.get('/api/system/settings/admin', authMiddleware, builtinAdminOnly, (req, res) => {
  const settings = systemSettings.getAdminSettings();
  const sign = pdfSign.getSigningStatus();
  res.json({
    ...settings,
    pdfSign: { ...(settings.pdfSign || {}), ...sign },
  });
});

app.put('/api/system/settings', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    systemSettings.updateSettings({
      companyName: body.companyName,
      pdfSignEnabled: body.pdfSignEnabled,
      pdfSignOnlyApproved: body.pdfSignOnlyApproved,
      pdfSignReason: body.pdfSignReason,
      pdfSignLocation: body.pdfSignLocation,
      pdfSignContact: body.pdfSignContact,
      pdfSignSignerName: body.pdfSignSignerName,
      pdfSignPass: body.pdfSignPass,
      pdfSignPassClear: body.pdfSignPassClear,
      backupEncryptEnabled: body.backupEncryptEnabled,
      backupEncryptPass: body.backupEncryptPass,
      backupEncryptPassClear: body.backupEncryptPassClear,
      ...(Object.prototype.hasOwnProperty.call(body, 'backupDir') ? { backupDir: body.backupDir } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'intranetOnly')
        ? { intranetOnly: body.intranetOnly }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'loginCidrs') ? { loginCidrs: body.loginCidrs } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'deviceBindEnabled')
        ? { deviceBindEnabled: body.deviceBindEnabled }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'deviceBindMax')
        ? { deviceBindMax: body.deviceBindMax }
        : {}),
    });
    res.json({
      ok: true,
      settings: systemSettings.getAdminSettings(),
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

app.post(
  '/api/system/logo',
  authMiddleware,
  builtinAdminOnly,
  logoUpload.single('logo'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 Logo 圖檔' });
      const settings = systemSettings.saveLogoFile({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/logo', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearLogo();
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/** 登入使用者：讀取總覽公告（未啟用則 active=false） */
app.get('/api/announcement', authMiddleware, (req, res) => {
  res.json({ announcement: systemSettings.getAnnouncementPublic() });
});

/** 下載／檢視公告附件（需登入；未啟用或無檔則 404） */
app.get('/api/announcement/file', authMiddleware, (req, res) => {
  try {
    const ann = systemSettings.getAnnouncementPublic();
    if (!ann.active || !ann.hasFile) {
      return res.status(404).json({ error: '目前沒有可下載的公告附件' });
    }
    const info = systemSettings.getAnnouncementFilePath();
    if (!info) return res.status(404).json({ error: '附件不存在' });
    const inline = String(req.query.inline || '') === '1';
    const ext = path.extname(info.originalName || '').toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    if (inline && mimeMap[ext]) {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName).replace(
          /^attachment/i,
          'inline'
        )
      );
    } else {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName)
      );
    }
    fs.createReadStream(info.fullPath).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message || '下載失敗' });
  }
});

/** 內建 Admin：更新公告文字／啟用 */
app.put('/api/system/announcement', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const announcement = systemSettings.updateAnnouncement({
      enabled: body.enabled,
      title: body.title,
      body: body.body,
      startAt: body.startAt,
      endAt: body.endAt,
    });
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

const announceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/** 內建 Admin：上傳公告附件 */
app.post(
  '/api/system/announcement/file',
  authMiddleware,
  builtinAdminOnly,
  (req, res, next) => {
    announceUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: '附件請小於 15MB' });
        }
        return res.status(400).json({ error: err.message || '上傳失敗' });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇附件檔案' });
      // 修正中文檔名（multer 預設 latin1）
      let originalname = req.file.originalname || 'attachment';
      try {
        originalname = Buffer.from(originalname, 'latin1').toString('utf8');
      } catch {
        /* keep */
      }
      const announcement = systemSettings.saveAnnouncementFile({
        buffer: req.file.buffer,
        originalname,
        mimetype: req.file.mimetype,
      });
      res.json({
        ok: true,
        announcement,
        settings: systemSettings.getAdminSettings(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

/** 內建 Admin：移除公告附件 */
app.delete('/api/system/announcement/file', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const announcement = systemSettings.clearAnnouncementFile();
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '移除失敗' });
  }
});

const certUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** 上傳公司 PDF 數位簽章憑證（.p12 / .pfx） */
app.post(
  '/api/system/pdf-sign/cert',
  authMiddleware,
  builtinAdminOnly,
  certUpload.single('cert'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 .p12 或 .pfx 憑證檔' });
      const settings = systemSettings.savePdfSignCert({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
      });
      // 若同表單有帶密碼一併更新
      if (req.body && req.body.passphrase != null && String(req.body.passphrase) !== '') {
        systemSettings.updateSettings({ pdfSignPass: req.body.passphrase });
      }
      res.json({
        ok: true,
        settings: systemSettings.getAdminSettings(),
        pdfSign: pdfSign.getSigningStatus(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/pdf-sign/cert', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearPdfSignCert();
    res.json({
      ok: true,
      settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/**
 * 製作公司自簽數位簽章憑證（.p12）
 * 必填：commonName、organization、country、passphrase（與確認密碼）
 */
app.post('/api/system/pdf-sign/create', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const result = systemSettings.createSelfSignedPdfSignCert(req.body || {});
    res.json({
      ok: true,
      message: '已製作並儲存自簽公司憑證',
      meta: result.meta,
      settings: result.settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    console.error('[pdf-sign create]', e);
    res.status(400).json({ error: e.message || '製作憑證失敗' });
  }
});

/** 測試數位簽章（產生最小 PDF 並簽署；使用中文字型避免亂碼） */
app.post('/api/system/pdf-sign/test', authMiddleware, builtinAdminOnly, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { PassThrough } = require('stream');
    const chunks = [];
    const pass = new PassThrough();
    pass.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      pass.on('end', resolve);
      pass.on('error', reject);
    });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(pass);

    // 註冊中文字型（與正式簽核 PDF 相同）
    let useCjk = false;
    const fontPath = getChineseFontPath();
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
        useCjk = true;
      } catch (e) {
        console.warn('[pdf-sign test] font register failed', e.message);
      }
    }
    const text = (str, opts) => {
      if (useCjk) {
        try {
          doc.font('CJK');
        } catch {
          /* ignore */
        }
      }
      doc.text(str, opts);
    };

    const company = systemSettings.getCompanyName();
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    doc.fontSize(18);
    text('PDF 數位簽章測試', { align: 'center' });
    doc.moveDown(1.2);
    doc.fontSize(12);
    text(`公司名稱：${company}`);
    text(`產生時間：${now}`);
    text('簽署者：' + (systemSettings.getPdfSignConfig().signerName || company));
    doc.moveDown(0.8);
    text('說明：若可正常開啟本檔，並在 Acrobat「簽名」面板看到簽章資訊，表示公司憑證設定正確。');
    doc.moveDown(0.5);
    text('注意：自簽憑證可能顯示「簽發者不被信任」，屬正常現象；內部使用不影響防竄改驗證。');
    doc.end();
    await done;
    let buf = Buffer.concat(chunks);
    // 測試時強制簽署（略過 onlyApproved）
    const cfg = systemSettings.getPdfSignConfig();
    if (!cfg.hasCert) throw new Error('請先上傳 .p12 / .pfx 憑證');
    buf = await pdfSign.signPdfBuffer(buf, {
      force: true,
      request: { id: 'TEST', workflow_name: '簽章測試' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment('簽章測試.pdf', 'pdf-sign-test.pdf')
    );
    res.send(buf);
  } catch (e) {
    console.error('[pdf-sign test]', e);
    res.status(400).json({ error: e.message || '測試簽署失敗' });
  }
});

// ---------- Users ----------
/** 非內建 Admin 不可看見內建 Admin 帳號（含其他最高權限） */
function canViewerSeeUser(viewer, targetUser) {
  if (!targetUser) return false;
  if (isBuiltinAdminUser(targetUser) && !isBuiltinAdminUsername(viewer?.username)) {
    return false;
  }
  return true;
}

app.get('/api/users', authMiddleware, (req, res) => {
  const isAdminUser = req.user.role === 'admin';
  const canLabor =
    isAdminUser || userHasPermission(req.user.id, 'users_leave');
  const viewerIsBuiltin = isBuiltinAdminUsername(req.user.username);
  // 特休／年資：管理員或「成員休假已休管理」權限
  const withLabor =
    canLabor && (req.query.labor === '1' || req.query.labor === 'true');
  const users = db
    .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE`)
    .all()
    .filter((u) => canViewerSeeUser(req.user, u))
    .map((u) => {
      const pu = publicUser(u, { withLabor });
      // 無權限者：名單不回傳到職／特休相關欄位（保護隱私）
      if (!canLabor) {
        delete pu.hire_date;
        delete pu.sl_used_days;
        delete pu.sl_used_hours;
        delete pu.leave_used;
        delete pu.leave_entitled;
        delete pu.labor;
        delete pu.seniority_label;
        delete pu.special_leave_entitled;
      }
      // 前端標記：內建 Admin 不可刪、不可改帳號
      if (isBuiltinAdminUser(u)) {
        pu.isBuiltinAdmin = true;
        pu.lockedUsername = true;
        pu.undeletable = true;
      }
      return pu;
    });
  res.json({
    users,
    permissionDefs: PERMISSION_DEFS,
    viewerIsBuiltinAdmin: viewerIsBuiltin,
    canUsersLeave: canLabor,
    canUsersFull: isAdminUser,
  });
});

/** 單一成員勞動摘要（年資／特休） */
app.get('/api/users/:id/labor', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const canLabor =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'users_leave');
  // 本人、管理員、或有成員休假權限可查看
  if (req.user.id !== id && !canLabor) {
    return res.status(403).json({ error: '無權查看此成員勞動資料' });
  }
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!canViewerSeeUser(req.user, user) && req.user.id !== id) {
    return res.status(404).json({ error: '找不到使用者' });
  }
  res.json({
    user: publicUser(user, { withLabor: true }),
    labor: labor.buildLaborSummary(user),
  });
});

app.get('/api/permissions', authMiddleware, adminOnly, (req, res) => {
  res.json({ permissionDefs: PERMISSION_DEFS });
});

app.put('/api/users/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const isAdminUser = req.user.role === 'admin';
  const canLaborOnly =
    !isAdminUser && userHasPermission(req.user.id, 'users_leave');
  if (!isAdminUser && !canLaborOnly) {
    return res.status(403).json({ error: '需要管理員權限' });
  }

  const {
    username,
    name,
    email,
    phone,
    extension,
    department,
    departments,
    role,
    active,
    permissions,
    password,
    hire_date,
    sl_used_days,
    sl_used_hours,
    leave_used,
    leave_used_json,
    leave_entitled,
    leave_entitled_json,
  } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!user.active) {
    return res.status(400).json({ error: '此帳號已停用，無法修改' });
  }
  // 內建 Admin：僅本人（內建 Admin）可維護；其他最高權限不可見、不可改
  if (isBuiltinAdminUser(user)) {
    if (!isBuiltinAdminUsername(req.user.username)) {
      return res.status(403).json({ error: '無權修改系統內建 Admin 帳號' });
    }
  }

  // 僅「成員休假已休管理」：到職日／手動可休／手動已休
  if (canLaborOnly) {
    if (!canViewerSeeUser(req.user, user)) {
      return res.status(404).json({ error: '找不到使用者' });
    }
    const hireDateRes = resolveNextHireDate(hire_date, user.hire_date);
    if (!hireDateRes.ok) return res.status(400).json({ error: hireDateRes.error });
    const nextHireDate = hireDateRes.value;
    const leaveMerged = labor.mergeLeaveUsedFromRequest(
      { leave_used, leave_used_json, sl_used_days, sl_used_hours },
      user
    );
    if (!leaveMerged.ok) {
      return res.status(400).json({ error: leaveMerged.error });
    }
    const entMerged = labor.mergeLeaveEntitledFromRequest(
      { leave_entitled, leave_entitled_json },
      user
    );
    if (!entMerged.ok) {
      return res.status(400).json({ error: entMerged.error });
    }
    try {
      db.prepare(
        `UPDATE users SET hire_date = ?, sl_used_days = ?, sl_used_hours = ?, leave_used_json = ?, leave_entitled_json = ? WHERE id = ?`
      ).run(
        nextHireDate,
        leaveMerged.specialDays,
        leaveMerged.specialHours,
        leaveMerged.json,
        entMerged.json,
        id
      );
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: '更新失敗' });
    }
    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    return res.json({
      user: publicUser(updated, { withLabor: true }),
      laborOnly: true,
    });
  }

  if (department != null && department !== '' && !isValidDepartment(department)) {
    return res.status(400).json({ error: '請選擇有效的部門' });
  }
  const hireDateRes = resolveNextHireDate(hire_date, user.hire_date);
  if (!hireDateRes.ok) return res.status(400).json({ error: hireDateRes.error });
  const nextHireDate = hireDateRes.value;
  // 各有上限假別：手動可休＋手動已休（leave_entitled / leave_used）＋相容 sl_used_*
  const leaveMerged = labor.mergeLeaveUsedFromRequest(
    { leave_used, leave_used_json, sl_used_days, sl_used_hours },
    user
  );
  if (!leaveMerged.ok) {
    return res.status(400).json({ error: leaveMerged.error });
  }
  const entMerged = labor.mergeLeaveEntitledFromRequest(
    { leave_entitled, leave_entitled_json },
    user
  );
  if (!entMerged.ok) {
    return res.status(400).json({ error: entMerged.error });
  }
  const nextSlDays = leaveMerged.specialDays;
  const nextSlHours = leaveMerged.specialHours;
  const nextLeaveUsedJson = leaveMerged.json;
  const nextLeaveEntitledJson = entMerged.json;

  let nextUsername = user.username;
  if (username != null && String(username).trim() !== '') {
    const uname = normalizeUsername(username);
    // 內建 Admin 帳號名稱鎖定，不可修改
    if (isBuiltinAdminUser(user)) {
      if (!isBuiltinAdminUsername(uname)) {
        return res.status(400).json({ error: '系統內建 Admin 帳號名稱不可修改' });
      }
      nextUsername = BUILTIN_ADMIN_USERNAME;
    } else {
      if (uname.length < 3) {
        return res.status(400).json({ error: '帳號至少 3 個字元' });
      }
      if (!/^[A-Za-z0-9._@-]+$/.test(uname)) {
        return res.status(400).json({ error: '帳號僅可使用英數、. _ @ -' });
      }
      // 不可搶用內建 admin 名稱
      if (isBuiltinAdminUsername(uname)) {
        return res.status(400).json({ error: 'Admin 為系統保留帳號，請使用其他帳號' });
      }
      const clash = findUserByUsername(uname, { activeOnly: false });
      if (clash && clash.id !== id) {
        return res.status(400).json({ error: '此帳號已被使用' });
      }
      nextUsername = uname;
    }
  }

  let nextRole = user.role;
  if (role === 'admin' || role === 'user') {
    nextRole = role;
  }
  // 內建 Admin 永遠保持系統管理員
  if (isBuiltinAdminUser(user)) {
    nextRole = 'admin';
  }

  // 不可取消最後一位系統管理員
  if (user.role === 'admin' && nextRole !== 'admin') {
    const adminCount = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1`)
      .get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '系統至少需保留一位系統管理員' });
    }
  }
  // 不可停用自己；內建 Admin 不可停用
  if (id === req.user.id && (active === 0 || active === false)) {
    return res.status(400).json({ error: '不可停用目前登入的帳號' });
  }
  if (isBuiltinAdminUser(user) && (active === 0 || active === false)) {
    return res.status(400).json({ error: '系統內建 Admin 帳號不可停用' });
  }

  let permJson = user.permissions_json || '[]';
  if (permissions !== undefined) {
    const cleaned = parsePermissions(permissions);
    permJson = JSON.stringify(cleaned);
  }
  // 系統管理員不需個別權限位元（一律全開）
  if (nextRole === 'admin') {
    permJson = '[]';
  }

  const nextActive =
    typeof active === 'number' || typeof active === 'boolean' ? (active ? 1 : 0) : user.active;

  let nextPasswordHash = null;
  if (password != null && String(password).trim() !== '') {
    if (String(password).length < 6) {
      return res.status(400).json({ error: '新密碼至少 6 字元' });
    }
    nextPasswordHash = hashPassword(String(password));
  }

  // 多部門
  let nextPrimary =
    department != null ? String(department).trim() : user.department || '';
  let nextDepts = null;
  if (Array.isArray(departments)) {
    nextDepts = [
      ...new Set(
        departments
          .map((d) => String(d || '').trim())
          .filter(Boolean)
      ),
    ];
    for (const d of nextDepts) {
      if (!isValidDepartment(d)) {
        return res.status(400).json({ error: `無效的部門：${d}` });
      }
    }
    if (!nextPrimary && nextDepts.length) nextPrimary = nextDepts[0];
    if (nextPrimary && !nextDepts.includes(nextPrimary)) {
      nextDepts = [nextPrimary, ...nextDepts];
    }
  }

  try {
    db.prepare(
      `UPDATE users SET
        username = ?,
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        extension = COALESCE(?, extension),
        department = COALESCE(?, department),
        role = ?,
        active = ?,
        permissions_json = ?,
        password_hash = COALESCE(?, password_hash),
        hire_date = ?,
        sl_used_days = ?,
        sl_used_hours = ?,
        leave_used_json = ?,
        leave_entitled_json = ?
       WHERE id = ?`
    ).run(
      nextUsername,
      name != null ? String(name).trim() : null,
      email != null ? String(email).trim() : null,
      phone != null ? String(phone).trim() : null,
      extension != null ? String(extension).trim() : null,
      department != null ? String(department).trim() : null,
      nextRole,
      nextActive,
      permJson,
      nextPasswordHash,
      nextHireDate,
      nextSlDays,
      nextSlHours,
      nextLeaveUsedJson,
      nextLeaveEntitledJson,
      id
    );

    if (nextDepts) {
      db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(id);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
      );
      for (const d of nextDepts) ins.run(id, d);
      if (nextPrimary) {
        db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(nextPrimary, id);
      }
    } else if (department != null && String(department).trim()) {
      // 僅更新主部門時，確保多部門表有此部門
      try {
        addUserToDepartment(id, String(department).trim());
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }
    console.error(e);
    return res.status(500).json({ error: '更新失敗' });
  }

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  // 若改了自己的帳號，回傳新 username 供前端刷新 token 提示
  res.json({
    user: publicUser(updated, { withLabor: true }),
    selfUsernameChanged:
      id === req.user.id && nextUsername !== user.username ? nextUsername : null,
  });
});

/**
 * 系統管理員重設／修改任一成員密碼（不需舊密碼）
 * body: { password, confirmPassword? }
 */
app.put('/api/users/:id/password', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { password, newPassword, confirmPassword } = req.body || {};
  const pwd = password != null ? password : newPassword;
  if (pwd == null || !String(pwd)) {
    return res.status(400).json({ error: '請輸入新密碼' });
  }
  if (String(pwd).length < 6) {
    return res.status(400).json({ error: '新密碼至少 6 字元' });
  }
  if (confirmPassword != null && String(confirmPassword) !== String(pwd)) {
    return res.status(400).json({ error: '兩次輸入的密碼不一致' });
  }
  const user = db.prepare(`SELECT id, username, name, active FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!user.active) {
    return res.status(400).json({ error: '此帳號已停用，無法修改密碼' });
  }
  // 內建 Admin 密碼僅本人可改（其他最高權限不可改 Admin 密碼）
  if (isBuiltinAdminUser(user) && !isBuiltinAdminUsername(req.user.username)) {
    return res.status(403).json({ error: '無權修改系統內建 Admin 密碼' });
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(String(pwd)), id);
  res.json({
    ok: true,
    message: `已更新「${user.name}」（${user.username}）的密碼`,
    userId: id,
    username: user.username,
  });
});

/** 系統管理員新增成員 */
app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const {
    username,
    password,
    name,
    email,
    department,
    role,
    permissions,
    hire_date,
    sl_used_days,
    sl_used_hours,
    leave_used,
    leave_used_json,
    leave_entitled,
    leave_entitled_json,
  } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: '帳號、密碼、姓名為必填' });
  }
  const uname = normalizeUsername(username);
  if (uname.length < 3) {
    return res.status(400).json({ error: '帳號至少 3 個字元' });
  }
  if (!/^[A-Za-z0-9._@-]+$/.test(uname)) {
    return res.status(400).json({ error: '帳號僅可使用英數、. _ @ -' });
  }
  if (isBuiltinAdminUsername(uname)) {
    return res.status(400).json({ error: 'Admin 為系統保留帳號，請使用其他帳號' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密碼至少 6 字元' });
  }
  const deptName = department ? String(department).trim() : '';
  if (deptName && !isValidDepartment(deptName)) {
    return res.status(400).json({ error: '請選擇有效的部門' });
  }
  let hireDate = null;
  if (hire_date) {
    hireDate = labor.toDateOnly(hire_date);
    if (!hireDate) return res.status(400).json({ error: '到職日格式須為 YYYY-MM-DD' });
  }
  const leaveMerged = labor.mergeLeaveUsedFromRequest(
    { leave_used, leave_used_json, sl_used_days, sl_used_hours },
    null
  );
  if (!leaveMerged.ok) {
    return res.status(400).json({ error: leaveMerged.error });
  }
  const entMerged = labor.mergeLeaveEntitledFromRequest(
    { leave_entitled, leave_entitled_json },
    null
  );
  if (!entMerged.ok) {
    return res.status(400).json({ error: entMerged.error });
  }
  const slDays = leaveMerged.specialDays;
  const slHours = leaveMerged.specialHours;
  const leaveUsedJson = leaveMerged.json;
  const leaveEntitledJson = entMerged.json;
  const nextRole = role === 'admin' ? 'admin' : 'user';
  const permJson =
    nextRole === 'admin' ? '[]' : JSON.stringify(parsePermissions(permissions || []));

  // 帳號不區分大小寫；儲存首字母大寫
  if (findUserByUsername(uname, { activeOnly: false })) {
    return res.status(400).json({ error: '此帳號已被使用' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, name, email, department, role, permissions_json, active, hire_date, sl_used_days, sl_used_hours, leave_used_json, leave_entitled_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        uname,
        hashPassword(password),
        String(name).trim(),
        email ? String(email).trim() : null,
        deptName,
        nextRole,
        permJson,
        hireDate,
        slDays,
        slHours,
        leaveUsedJson,
        leaveEntitledJson
      );
    const created = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ user: publicUser(created, { withLabor: true }) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }
    console.error(e);
    res.status(500).json({ error: '新增成員失敗' });
  }
});

/** 軟刪除單一成員 */
function softDeleteUser(id, actorId) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user || !user.active) {
    return { ok: false, error: '找不到使用者或已刪除' };
  }
  if (id === actorId) {
    return { ok: false, error: '不可刪除目前登入的帳號' };
  }
  // 系統內建 Admin 永遠不可刪除
  if (isBuiltinAdminUser(user)) {
    return { ok: false, error: '系統內建 Admin 帳號不可刪除' };
  }
  if (user.role === 'admin') {
    const adminCount = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1`)
      .get().c;
    if (adminCount <= 1) {
      return { ok: false, error: '不可刪除最後一位系統管理員' };
    }
  }
  const stamp = Date.now().toString(36) + '_' + id;
  const newUsername = `${user.username}__del_${stamp}`.slice(0, 80);
  db.prepare(`UPDATE users SET active = 0, username = ? WHERE id = ?`).run(newUsername, id);
  return { ok: true, id, name: user.name, username: user.username };
}

/** 系統管理員刪除成員（軟刪除：停用，帳號加後綴避免占用） */
app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const result = softDeleteUser(id, req.user.id);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ ok: true, id });
});

/** 批次刪除成員 */
app.post('/api/users/bulk-delete', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: '請選擇至少一位成員' });
  }
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    const r = softDeleteUser(id, req.user.id);
    if (r.ok) deleted.push({ id: r.id, name: r.name, username: r.username });
    else failed.push({ id, error: r.error });
  }
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedUsers: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 人${failed.length ? `，${failed.length} 人略過` : ''}`,
  });
});

// ---------- Users Excel import / export ----------
const XLSX = require('xlsx');

function splitDeptNames(text) {
  return String(text || '')
    .split(/[、,，;；\/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureDepartmentExists(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const row = db.prepare(`SELECT id FROM departments WHERE name = ? AND active = 1`).get(n);
  if (row) return true;
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
  db.prepare(`INSERT OR IGNORE INTO departments (name, sort_order, active) VALUES (?, ?, 1)`).run(
    n,
    max + 1
  );
  return true;
}

function setUserDepartmentsList(userId, deptList, primary) {
  const list = [...new Set((deptList || []).map((d) => String(d).trim()).filter(Boolean))];
  for (const d of list) ensureDepartmentExists(d);
  db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(userId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
  );
  for (const d of list) ins.run(userId, d);
  const main = (primary && String(primary).trim()) || list[0] || '';
  if (main) {
    ensureDepartmentExists(main);
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(main, userId);
    ins.run(userId, main);
  }
}

function buildUsersWorkbook(userRows, { includePasswords = false, passwordMap = {} } = {}) {
  const trackRules = labor.getManualLeaveTrackRules();
  const rows = userRows.map((u, i) => {
    const depts = getUserDepartments(u.id);
    const deptDisplay = depts.length ? depts.join('、') : u.department || '';
    const lab = labor.buildLaborSummary(u);
    const manual = lab.leaveUsedManual || labor.parseLeaveUsedManual(u);
    const row = {
      序號: i + 1,
      姓名: u.name,
      帳號: u.username,
      密碼: includePasswords ? passwordMap[u.id] || passwordMap[u.username] || '' : '',
      部門: deptDisplay,
      主部門: u.department || '',
      Email: u.email || '',
      電話: u.phone || '',
      分機: u.extension || '',
      到職日: lab.hireDate || u.hire_date || '',
      年資: lab.seniority?.label || '',
      特休應有天數: lab.specialLeave?.entitled ?? '',
      特休已休天數: lab.specialLeave?.used ?? '',
      特休剩餘天數: lab.specialLeave?.remaining ?? '',
      特休年度: lab.specialLeave?.yearLabel || '',
      角色: u.role === 'admin' ? '系統管理員' : '一般使用者',
      建立時間: u.created_at || '',
    };
    // 各有上限假別：手動已休天數／小時（匯入可寫回）
    for (const r of trackRules) {
      const m = manual[r.id] || { days: 0, hours: 0 };
      row[`${r.name}_手動已休天數`] = m.days ?? 0;
      row[`${r.name}_手動已休小時`] = m.hours ?? 0;
      const bal = (lab.leaveBalances || []).find((b) => b.id === r.id);
      if (bal) {
        row[`${r.name}_合計已休`] = bal.used ?? 0;
        row[`${r.name}_剩餘`] = bal.remaining != null ? bal.remaining : '';
      }
    }
    row.備註 = includePasswords
      ? '密碼欄已填寫之值可直接登入；空白表示未重設'
      : '匯出時密碼欄空白＝保留原密碼；匯入時填寫「假別_手動已休天數／小時」可更新系統外已休；已休合計＝手動＋系統核准';
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 28 },
    { wch: 12 },
    { wch: 24 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 24 },
    { wch: 12 },
    { wch: 20 },
    { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '成員名單');
  const note = XLSX.utils.aoa_to_sheet([
    ['線上簽核系統 — 成員名單 Excel'],
    ['產生時間', new Date().toLocaleString('zh-TW', { hour12: false })],
    ['人數', String(rows.length)],
    [''],
    ['匯入欄位說明'],
    ['姓名', '必填'],
    ['帳號', '必填；英文數字，至少 3 字元'],
    ['密碼', '選填；空白＝不變更既有密碼；新帳號空白則自動產生隨機密碼'],
    ['部門', '可多個，以「、」分隔'],
    ['主部門', '主要顯示部門'],
    ['Email', '選填'],
    ['到職日', '選填；格式 YYYY-MM-DD（例 2020-03-15），供年資／特休試算'],
    ['角色', '系統管理員 或 一般使用者'],
    [''],
    ['注意'],
    ['1. 以「帳號」對應既有成員；不存在則新增。'],
    ['2. 請妥善保管含密碼的匯出檔。'],
  ]);
  note['!cols'] = [{ wch: 12 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, note, '說明');
  return wb;
}

/** 匯出成員 Excel（可指定 ids；可選擇重設並寫入密碼） */
app.post('/api/users/export', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  const resetPasswords = !!req.body?.resetPasswords;
  let users;
  if (ids.length) {
    users = ids
      .map((id) => db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id))
      .filter(Boolean);
  } else {
    users = db
      .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE`)
      .all();
  }
  // 非內建 Admin 匯出時隱藏 Admin 帳號
  users = users.filter((u) => canViewerSeeUser(req.user, u));
  if (!users.length) {
    return res.status(400).json({ error: '沒有可匯出的成員' });
  }

  const passwordMap = {};
  if (resetPasswords) {
    const upd = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);
    for (const u of users) {
      // 非內建 Admin 不可重設 Admin 密碼（已過濾）；內建可重設自己
      if (isBuiltinAdminUser(u) && !isBuiltinAdminUsername(req.user.username)) continue;
      const pwd = generateBootstrapPassword();
      upd.run(hashPassword(pwd), u.id);
      passwordMap[u.id] = pwd;
    }
  }

  const wb = buildUsersWorkbook(users, {
    includePasswords: resetPasswords,
    passwordMap,
  });
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `成員名單_${tz.today()}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.send(Buffer.from(buf));
});

/** 下載空白匯入範本 */
app.get('/api/users/export-template', authMiddleware, adminOnly, (req, res) => {
  const wb = XLSX.utils.book_new();
  const sample = [
    {
      姓名: '王小明',
      帳號: 'wangxm',
      密碼: '',
      部門: '業務部',
      主部門: '業務部',
      Email: 'wang@example.com',
      到職日: '2020-03-15',
      角色: '一般使用者',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  XLSX.utils.book_append_sheet(wb, ws, '成員名單');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="members-template.xlsx"`
  );
  res.send(Buffer.from(buf));
});

/** Excel 匯入成員（新增或更新） */
app.post(
  '/api/users/import',
  authMiddleware,
  adminOnly,
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: '請上傳 Excel 檔（.xlsx）' });
    }
    try {
      const wb = XLSX.readFile(req.file.path);
      const sheetName =
        wb.SheetNames.find((n) => /成員|帳號|密碼/.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) {
        return res.status(400).json({ error: 'Excel 沒有資料列' });
      }

      let created = 0;
      let updated = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row['姓名'] || row.name || '').trim();
        const username = normalizeUsername(row['帳號'] || row.username || '');
        const passwordRaw = String(row['密碼'] || row.password || '').trim();
        const email = String(row['Email'] || row['email'] || row.email || '').trim();
        const phone = String(row['電話'] || row.phone || '').trim();
        const extension = String(row['分機'] || row.extension || '').trim();
        const roleLabel = String(row['角色'] || row.role || '').trim();
        const role = /管理|admin/i.test(roleLabel) ? 'admin' : 'user';
        const primary =
          String(row['主部門'] || '').trim() || splitDeptNames(row['部門'])[0] || '';
        const depts = splitDeptNames(row['部門'] || row['主部門'] || '');
        if (primary && !depts.includes(primary)) depts.unshift(primary);
        // Excel 日期可能是序號或字串
        let hireRaw = row['到職日'] ?? row['hire_date'] ?? row.hire_date ?? '';
        if (typeof hireRaw === 'number' && XLSX.SSF) {
          try {
            const parsed = XLSX.SSF.parse_date_code(hireRaw);
            if (parsed) {
              hireRaw = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
            }
          } catch {
            /* keep */
          }
        }
        const hireDate = hireRaw ? labor.toDateOnly(String(hireRaw)) : null;
        if (hireRaw && !hireDate) {
          errors.push(`第 ${i + 2} 列：到職日格式錯誤（請用 YYYY-MM-DD）`);
          continue;
        }

        if (!name && !username) continue;
        if (!name || !username) {
          errors.push(`第 ${i + 2} 列：姓名與帳號為必填`);
          continue;
        }
        if (username.length < 3) {
          errors.push(`第 ${i + 2} 列：帳號「${username}」至少 3 字元`);
          continue;
        }

        try {
          for (const d of depts) ensureDepartmentExists(d);
          if (primary) ensureDepartmentExists(primary);

          // Excel 各假別手動已休：欄名「{假別}_手動已休天數／小時」
          const leaveUsedFromExcel = {};
          let hasLeaveUsedCols = false;
          for (const rule of labor.getManualLeaveTrackRules()) {
            const dKey = `${rule.name}_手動已休天數`;
            const hKey = `${rule.name}_手動已休小時`;
            const hasD = row[dKey] !== undefined && String(row[dKey]).trim() !== '';
            const hasH = row[hKey] !== undefined && String(row[hKey]).trim() !== '';
            if (hasD || hasH) {
              hasLeaveUsedCols = true;
              leaveUsedFromExcel[rule.id] = {
                days: hasD ? row[dKey] : 0,
                hours: hasH ? row[hKey] : 0,
              };
            }
          }
          // 相容舊範本：僅有「特休已休天數」且無 special 手動欄時，視為特休手動天數
          if (
            !leaveUsedFromExcel.special &&
            row['特休手動已休天數'] !== undefined &&
            String(row['特休手動已休天數']).trim() !== ''
          ) {
            hasLeaveUsedCols = true;
            leaveUsedFromExcel.special = {
              days: row['特休手動已休天數'],
              hours: row['特休手動已休小時'] || 0,
            };
          }

          const applyLeaveUsed = (uid, existing) => {
            if (!hasLeaveUsedCols) return;
            const merged = labor.mergeLeaveUsedFromRequest(
              { leave_used: leaveUsedFromExcel },
              existing || null
            );
            if (!merged.ok) {
              errors.push(`第 ${i + 2} 列（${username}）：${merged.error}`);
              return;
            }
            db.prepare(
              `UPDATE users SET leave_used_json = ?, sl_used_days = ?, sl_used_hours = ? WHERE id = ?`
            ).run(merged.json, merged.specialDays, merged.specialHours, uid);
          };

          let user = findUserByUsername(username, { activeOnly: false });
          if (user && !user.active) {
            // 復用已軟刪的帳號：重新啟用並改回原帳號名
            db.prepare(
              `UPDATE users SET active = 1, username = ?, name = ?, email = ?, phone = ?, extension = ?, department = ?, role = ?, hire_date = COALESCE(?, hire_date) WHERE id = ?`
            ).run(
              username,
              name,
              email || null,
              phone || null,
              extension || null,
              primary || '',
              role,
              hireDate,
              user.id
            );
            if (passwordRaw) {
              if (passwordRaw.length < 6) {
                errors.push(`第 ${i + 2} 列：密碼至少 6 字元`);
                continue;
              }
              db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                hashPassword(passwordRaw),
                user.id
              );
            } else {
              db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                hashPassword(generateBootstrapPassword()),
                user.id
              );
            }
            setUserDepartmentsList(user.id, depts, primary);
            applyLeaveUsed(user.id, user);
            updated += 1;
            continue;
          }

          if (user) {
            db.prepare(
              `UPDATE users SET name = ?, email = ?, phone = ?, extension = ?, department = ?, role = ?, active = 1, hire_date = COALESCE(?, hire_date) WHERE id = ?`
            ).run(
              name,
              email || null,
              phone || null,
              extension || null,
              primary || user.department || '',
              role,
              hireDate,
              user.id
            );
            // 若 Excel 有填到職日則覆寫
            if (hireDate) {
              db.prepare(`UPDATE users SET hire_date = ? WHERE id = ?`).run(hireDate, user.id);
            }
            if (passwordRaw) {
              if (passwordRaw.length < 6) {
                errors.push(`第 ${i + 2} 列（${username}）：密碼至少 6 字元`);
              } else {
                db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                  hashPassword(passwordRaw),
                  user.id
                );
              }
            }
            setUserDepartmentsList(user.id, depts.length ? depts : [primary].filter(Boolean), primary);
            applyLeaveUsed(user.id, user);
            updated += 1;
          } else {
            const pwd = passwordRaw || generateBootstrapPassword();
            if (pwd.length < 6) {
              errors.push(`第 ${i + 2} 列（${username}）：密碼至少 6 字元`);
              continue;
            }
            const info = db
              .prepare(
                `INSERT INTO users (username, password_hash, name, email, phone, extension, department, role, permissions_json, active, hire_date, sl_used_days, sl_used_hours, leave_used_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, 0, 0, '{}')`
              )
              .run(
                username,
                hashPassword(pwd),
                name,
                email || null,
                phone || null,
                extension || null,
                primary || '',
                role,
                hireDate
              );
            const newId = Number(info.lastInsertRowid);
            setUserDepartmentsList(newId, depts.length ? depts : [primary].filter(Boolean), primary);
            applyLeaveUsed(newId, null);
            created += 1;
          }
        } catch (e) {
          errors.push(`第 ${i + 2} 列（${username}）：${e.message || '失敗'}`);
        }
      }

      // cleanup uploaded temp file
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        created,
        updated,
        errors,
        message: `匯入完成：新增 ${created}、更新 ${updated}${errors.length ? `、${errors.length} 筆錯誤` : ''}`,
      });
    } catch (e) {
      console.error(e);
      try {
        if (req.file?.path) fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: '匯入失敗：' + (e.message || '未知錯誤') });
    }
  }
);

// ---------- 系統設定完整包（僅系統管理員）----------
/**
 * 匯出系統設定完整包
 * query: includeHistory=1 含歷史申請與附件
 * 含 SMTP 密碼須同時 includeMailSecrets=1 且 confirmMailSecrets=1（預設不含）
 */
app.get('/api/system/package/export', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const includeHistory =
      req.query.includeHistory === '1' ||
      req.query.includeHistory === 'true' ||
      req.query.history === '1';
    const wantMailSecrets =
      req.query.includeMailSecrets === '1' || req.query.includeMailSecrets === 'true';
    const confirmMailSecrets =
      req.query.confirmMailSecrets === '1' || req.query.confirmMailSecrets === 'true';
    const includeMailSecrets = wantMailSecrets && confirmMailSecrets;
    if (wantMailSecrets && !confirmMailSecrets) {
      return res.status(400).json({
        error: '匯出 SMTP 密碼須再確認（confirmMailSecrets=1）',
      });
    }
    const pack = systemPackage.buildPackage({ includeHistory, includeMailSecrets });
    const tag = includeHistory ? '完整含歷史' : '設定';
    const fname = `簽核系統_${tag}包_${tz.today()}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="approval-config-package.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
    );
    res.send(JSON.stringify(pack, null, 2));
  } catch (e) {
    console.error('system package export', e);
    res.status(500).json({ error: e.message || '匯出失敗' });
  }
});

/** 設定包上傳（multipart 檔案或 JSON body 皆可） */
function uploadPackageMiddleware(req, res, next) {
  uploadPackage.single('package')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上傳失敗' });
    next();
  });
}

/** 從上傳檔案／body 取出設定包 JSON；無法解析回傳 null */
function readPackagePayload(req) {
  // 以記事本另存的 JSON 可能含 BOM，需先去除才能 parse
  if (req.file?.buffer) {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  }
  if (req.body?.package) {
    return typeof req.body.package === 'string'
      ? JSON.parse(req.body.package)
      : req.body.package;
  }
  if (req.body && req.body.format) return req.body;
  return null;
}

/** 預覽設定包摘要（不上傳寫入） */
app.post(
  '/api/system/package/preview',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包（format 不符）',
        });
      }
      res.json({
        ok: true,
        format: data.format,
        version: data.version,
        exportedAt: data.exportedAt,
        includeHistory: Boolean(data.includeHistory),
        summary: data.summary || {
          departments: (data.departments || []).length,
          users: (data.users || []).length,
          workflows: (data.workflows || []).length,
        },
        hasMail: Boolean(data.mailConfig),
        hasMailPass: Boolean(data.mailConfig?.pass),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '無法解析設定包' });
    }
  }
);

/** 匯入系統設定完整包 */
app.post(
  '/api/system/package/import',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包。請使用「帳號設定 → 系統設定完整包」匯出的 JSON。',
        });
      }

      const importMail =
        req.body?.importMail === '1' ||
        req.body?.importMail === 'true' ||
        req.body?.importMail === true ||
        req.body?.importMail === undefined; // 預設匯入 mail（若包內有）
      // 若 body 明確傳 0/false 則略過
      const skipMail =
        req.body?.importMail === '0' ||
        req.body?.importMail === 'false' ||
        req.body?.importMail === false;
      const importHistory =
        req.body?.importHistory === '1' ||
        req.body?.importHistory === 'true' ||
        req.body?.importHistory === true;

      const result = systemPackage.importPackage(data, {
        importMail: !skipMail && importMail !== false,
        importHistory,
      });

      const parts = [
        `部門 +${result.departments.created}/更新${result.departments.updated}`,
        `成員 +${result.users.created}/更新${result.users.updated}`,
        `流程 ${result.workflows.length} 個`,
      ];
      if (result.mail?.ok) parts.push('Email 設定已套用');
      if (result.history) {
        parts.push(
          `歷史：申請 ${result.history.requests}、歷程 ${result.history.actions}、附件 ${result.history.attachments}`
        );
      }

      res.json({
        ok: true,
        result,
        message: `匯入完成：${parts.join('；')}`,
      });
    } catch (e) {
      console.error('system package import', e);
      res.status(400).json({ error: e.message || '匯入失敗' });
    }
  }
);

  }
};
