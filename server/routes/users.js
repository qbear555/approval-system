/**
 * 成員名單／權限／匯入匯出
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
};
