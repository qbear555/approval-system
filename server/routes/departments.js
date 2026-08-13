/**
 * 部門
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
};
