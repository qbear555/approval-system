/**
 * 認證、個人偏好、代理人與片語模組路由
 */
module.exports = function registerAuthRoutes(app, ctx) {
  const {
    db,
    auditLog,
    agents,
    commentPhrases,
    authMiddleware,
    hashPassword,
    verifyPassword,
    signToken,
    publicUser,
    normalizeUsername,
    isValidDepartment,
    PERMISSION_DEFS,
  } = ctx;

  /**
   * 公開自我註冊已關閉（資安）。
   * 成員請由管理員於「成員名單」新增。
   * 緊急開放：環境變數 ALLOW_PUBLIC_REGISTER=1（不建議）
   */
  app.post('/api/auth/register', (req, res) => {
    const allow =
      process.env.ALLOW_PUBLIC_REGISTER === '1' ||
      process.env.ALLOW_PUBLIC_REGISTER === 'true';
    if (!allow) {
      return res.status(403).json({
        error: '已關閉公開註冊，請洽管理員於「成員名單」建立帳號',
        code: 'REGISTER_DISABLED',
      });
    }
    const { username, password, name, email, department } = req.body || {};
    if (!username || !password || !name) {
      return res.status(400).json({ error: '帳號、密碼、姓名為必填' });
    }
    if (String(username).length < 3) {
      return res.status(400).json({ error: '帳號至少 3 個字元' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密碼至少 6 字元' });
    }
    const deptName = department ? String(department).trim() : '';
    if (deptName && !isValidDepartment(deptName)) {
      return res.status(400).json({ error: '請選擇有效的部門' });
    }

    const total = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (total >= 50) {
      return res.status(400).json({ error: '使用者數量已達上限（50）' });
    }
    const uname = normalizeUsername(username);
    if (uname.length < 3) {
      return res.status(400).json({ error: '帳號至少 3 個字元' });
    }
    if (findUserByUsername(uname, { activeOnly: false })) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }

    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, name, email, department, role)
           VALUES (?, ?, ?, ?, ?, 'user')`
        )
        .run(
          uname,
          hashPassword(password),
          String(name).trim(),
          email ? String(email).trim() : null,
          deptName
        );
      const user = db
        .prepare(
          `SELECT id, username, name, email, department, role, active, created_at, permissions_json
           FROM users WHERE id = ?`
        )
        .get(info.lastInsertRowid);
      const safe = publicUser(user);
      const token = signToken(safe);
      res.json({ token, user: safe, permissionDefs: PERMISSION_DEFS });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(400).json({ error: '此帳號已被使用' });
      }
      console.error(e);
      res.status(500).json({ error: '註冊失敗' });
    }
  });

  /** 依帳號查詢（不區分大小寫；優先精確相符） */
  function findUserByUsername(username, { activeOnly = true } = {}) {
    const uname = String(username || '').trim();
    if (!uname) return null;
    const activeSql = activeOnly ? ' AND active = 1' : '';
    let user = db
      .prepare(`SELECT * FROM users WHERE username = ?${activeSql}`)
      .get(uname);
    if (user) return user;
    user = db
      .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE${activeSql}`)
      .get(uname);
    return user || null;
  }

  /** 登入失敗鎖定：同一帳號+來源 IP，連續錯誤達上限後暫時鎖定 */
  const LOGIN_MAX_FAILS = Math.max(
    3,
    Number(process.env.LOGIN_MAX_FAILS) || 5
  );
  const LOGIN_LOCK_MS = Math.max(
    60 * 1000,
    Number(process.env.LOGIN_LOCK_MINUTES || 15) * 60 * 1000
  );
  /** @type {Map<string, { fails: number, lockedUntil: number }>} */
  const loginAttemptMap = new Map();

  function clientIp(req) {
    const xf = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    return xf || req.socket?.remoteAddress || req.ip || 'unknown';
  }

  function loginAttemptKey(username, req) {
    const u = String(username || '')
      .trim()
      .toLowerCase() || '_empty';
    return `${u}|${clientIp(req)}`;
  }

  function getLoginAttempt(key) {
    const e = loginAttemptMap.get(key);
    if (!e) return null;
    const now = Date.now();
    if (e.lockedUntil && now >= e.lockedUntil) {
      loginAttemptMap.delete(key);
      return null;
    }
    return e;
  }

  function loginLockStatus(key) {
    const e = getLoginAttempt(key);
    if (e?.lockedUntil && Date.now() < e.lockedUntil) {
      const remainMs = e.lockedUntil - Date.now();
      const mins = Math.max(1, Math.ceil(remainMs / 60000));
      return {
        locked: true,
        mins,
        remainMs,
        lockedUntil: e.lockedUntil,
      };
    }
    return { locked: false, fails: e?.fails || 0 };
  }

  function recordLoginFailure(key) {
    const now = Date.now();
    let e = loginAttemptMap.get(key);
    if (e?.lockedUntil && now < e.lockedUntil) {
      return { ...e, justLocked: false, alreadyLocked: true };
    }
    if (!e || (e.lockedUntil && now >= e.lockedUntil)) {
      e = { fails: 0, lockedUntil: 0 };
    }
    e.fails = (e.fails || 0) + 1;
    let justLocked = false;
    if (e.fails >= LOGIN_MAX_FAILS) {
      e.lockedUntil = now + LOGIN_LOCK_MS;
      e.fails = 0;
      justLocked = true;
    }
    loginAttemptMap.set(key, e);
    if (loginAttemptMap.size > 5000) {
      for (const [k, v] of loginAttemptMap) {
        if (v.lockedUntil && v.lockedUntil < now) loginAttemptMap.delete(k);
      }
    }
    return { ...e, justLocked };
  }

  function clearLoginFailures(key) {
    loginAttemptMap.delete(key);
  }

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '請輸入帳號與密碼' });
    }
    const attemptKey = loginAttemptKey(username, req);
    const lock = loginLockStatus(attemptKey);
    if (lock.locked) {
      auditLog.write({
        category: 'auth',
        action_type: 'login_rate_limited',
        description: `登入失敗次數過多已鎖定（帳號：${username}）`,
        ip: req.ip,
      }, req);
      return res.status(429).json({
        error: `登入失敗次數過多，請約 ${lock.mins} 分鐘後再試`,
        code: 'LOGIN_LOCKED',
        retryAfterMinutes: lock.mins,
      });
    }

    const user = findUserByUsername(username, { activeOnly: true });
    if (!user || !verifyPassword(password, user.password_hash)) {
      const rec = recordLoginFailure(attemptKey);
      if (rec.justLocked) {
        const mins = Math.max(1, Math.ceil(LOGIN_LOCK_MS / 60000));
        auditLog.write({
          category: 'auth',
          action_type: 'login_rate_limited',
          description: `登入失敗次數過多，帳號已鎖定（帳號：${username}）`,
          ip: req.ip,
        }, req);
        return res.status(429).json({
          error: `登入失敗次數過多，帳號已暫時鎖定約 ${mins} 分鐘`,
          code: 'LOGIN_LOCKED',
          retryAfterMinutes: mins,
        });
      }
      auditLog.write({
        category: 'auth',
        action_type: 'login_fail',
        description: `登入失敗（帳號：${username}）`,
        ip: req.ip,
      }, req);
      const left = Math.max(0, LOGIN_MAX_FAILS - (rec.fails || 0));
      return res.status(401).json({
        error:
          left > 0 && left <= 2
            ? `帳號或密碼錯誤（還可嘗試 ${left} 次）`
            : '帳號或密碼錯誤',
        code: 'LOGIN_FAILED',
        attemptsLeft: left,
      });
    }

    clearLoginFailures(attemptKey);
    const safe = publicUser(user);
    auditLog.write({
      category: 'auth',
      action_type: 'login',
      description: `使用者 ${safe.name} (${safe.username}) 登入成功`,
      user: safe,
      ip: req.ip,
    }, req);
    res.json({ token: signToken(safe), user: safe, permissionDefs: PERMISSION_DEFS });
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = db
      .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
      .get(req.user.id);
    if (!user) return res.status(401).json({ error: '使用者不存在' });
    res.json({
      user: publicUser(user, { withLabor: true }),
      permissionDefs: PERMISSION_DEFS,
    });
  });

  app.put('/api/auth/password', authMiddleware, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: '請提供正確的舊密碼，且新密碼至少 6 字元' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: '舊密碼不正確' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    res.json({ ok: true });
  });

  // ---------- 統一代理人 ----------
  app.get('/api/agents/me', authMiddleware, (req, res) => {
    const mine = agents.listMyAgents(req.user.id);
    const asAgentForSetting = agents.listWhereIAmAgent(req.user.id);
    const asLeaveDuty = agents.listWhereIAmLeaveDutyAgent(req.user.id);
    const seen = new Set(asAgentForSetting.map((a) => Number(a.principal_id)));
    const asAgentFor = [
      ...asAgentForSetting,
      ...asLeaveDuty.filter((a) => !seen.has(Number(a.principal_id))),
    ];
    res.json({
      myAgent: mine.find((a) => a.effective) || mine[0] || null,
      myAgents: mine,
      asAgentFor,
      asLeaveDutyAgentFor: asLeaveDuty,
    });
  });

  app.put('/api/agents/me', authMiddleware, (req, res) => {
    const result = agents.setMyAgent(req.user.id, req.body || {}, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, agent: result.agent, message: '代理人已設定' });
  });

  app.delete('/api/agents/me', authMiddleware, (req, res) => {
    agents.clearMyAgent(req.user.id);
    res.json({ ok: true, message: '已清除代理人' });
  });

  app.get('/api/agents/leave-principals', authMiddleware, (req, res) => {
    const list = db
      .prepare(
        `SELECT id, username, name, department, active
         FROM users
         WHERE active = 1 AND id != ?
         ORDER BY name COLLATE NOCASE, id ASC`
      )
      .all(Number(req.user.id));
    res.json({ principals: list });
  });

  app.put('/api/auth/profile', authMiddleware, (req, res) => {
    const { name, email, phone, extension, email_notify } = req.body || {};
    const isAdminUser = req.user.role === 'admin';
    const existing = db
      .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
      .get(req.user.id);
    if (!existing) return res.status(401).json({ error: '使用者不存在' });

    let trimmedName = existing.name || '';
    let emailVal = existing.email ? String(existing.email).trim() : '';

    if (isAdminUser) {
      if (name == null || !String(name).trim()) {
        return res.status(400).json({ error: '姓名為必填' });
      }
      trimmedName = String(name).trim();
      if (trimmedName.length > 80) {
        return res.status(400).json({ error: '姓名過長（最多 80 字）' });
      }
      emailVal = email != null ? String(email).trim() : '';
      if (emailVal && emailVal.length > 120) {
        return res.status(400).json({ error: 'Email 過長' });
      }
      if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        return res.status(400).json({ error: 'Email 格式不正確' });
      }
    } else if (
      (name != null && String(name).trim() !== String(existing.name || '').trim()) ||
      (email != null &&
        String(email).trim() !== String(existing.email || '').trim())
    ) {
      return res.status(403).json({
        error: '姓名與 Email 僅能由系統管理員修改，請聯絡管理員',
      });
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

  app.get('/api/me/comment-phrases', authMiddleware, (req, res) => {
    const row = db.prepare(`SELECT comment_phrases_json FROM users WHERE id = ?`).get(req.user.id);
    if (!row) return res.status(401).json({ error: '使用者不存在' });
    res.json({
      phrases: commentPhrases.parsePhrasesJson(row.comment_phrases_json),
      defaults: commentPhrases.DEFAULT_COMMENT_PHRASES,
      max: commentPhrases.MAX_PHRASES,
      maxLen: commentPhrases.MAX_LEN,
    });
  });

  app.put('/api/me/comment-phrases', authMiddleware, (req, res) => {
    const body = req.body || {};
    const reset = body.reset === true || body.reset === 1 || body.reset === '1';
    const phrases = reset
      ? commentPhrases.DEFAULT_COMMENT_PHRASES.slice()
      : commentPhrases.normalizePhrases(body.phrases);
    if (!phrases.length) {
      return res.status(400).json({ error: '請至少保留一則常用片語，或使用還原預設' });
    }
    db.prepare(`UPDATE users SET comment_phrases_json = ? WHERE id = ?`).run(
      JSON.stringify(phrases),
      req.user.id
    );
    const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(req.user.id);
    res.json({
      ok: true,
      phrases,
      user: publicUser(user),
      message: reset ? '已還原預設片語' : '常用片語已儲存',
    });
  });
};
