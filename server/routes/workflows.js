/**
 * 簽核流程定義、匯出／匯入、底圖與專用 PDF 模板模組路由
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const workflowModule = require('../workflow-module');
const { importPayload } = require('../import-workflows');

module.exports = function registerWorkflowRoutes(app, ctx) {
  const {
    db,
    authMiddleware,
    requirePerm,
    userHasPermission,
    serializeWorkflow,
    parseSteps,
    validateStepTemplate,
    parseFormFields,
    resolveFinalNotifyJson,
    enrichFinalNotifyUsers,
  } = ctx;

  const templatesDir = path.join(__dirname, '..', '..', 'data', 'templates');
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  const templateStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
      cb(null, templatesDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
      const safeExt = ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext) ? ext : '.pdf';
      const name = `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      cb(null, name);
    },
  });

  const uploadTemplate = multer({
    storage: templateStorage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('僅支援上傳 PDF、PNG 或 JPG 格式檔案'));
      }
    },
  });

  function buildWorkflowExportItem(row) {
    let formFields = [];
    let steps = [];
    try {
      formFields = JSON.parse(row.form_fields_json || '[]') || [];
    } catch {
      formFields = [];
    }
    try {
      steps = JSON.parse(row.steps_json || '[]') || [];
    } catch {
      steps = [];
    }
    const stepsEnriched = (steps || []).map((s, i) => {
      const approverIds = Array.isArray(s.approverIds) ? s.approverIds.map(Number).filter(Boolean) : [];
      const approvers = approverIds.map((id) => {
        const u = db.prepare(`SELECT id, username, name FROM users WHERE id = ?`).get(id);
        return u
          ? { id: u.id, username: u.username, name: u.name }
          : { id, username: null, name: null };
      });
      return {
        order: s.order != null ? s.order : i + 1,
        name: s.name || `步驟${i + 1}`,
        assignType: s.assignType || 'users',
        mode: s.mode || 'any',
        formFieldId: s.formFieldId || '',
        department: s.department || '',
        approverIds,
        approvers,
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
        skipIfNoApprover: Boolean(s.skipIfNoApprover),
      };
    });
    const pdfLayout = workflowModule.parsePdfLayoutJson(row.pdf_layout_json, row.name);
    const finalNotify = typeof enrichFinalNotifyUsers === 'function'
      ? enrichFinalNotifyUsers(workflowModule.parseFinalNotifyJson(row.final_notify_json))
      : workflowModule.parseFinalNotifyJson(row.final_notify_json);
    return workflowModule.buildExportModule({
      id: row.id,
      name: row.name,
      category: row.category || '一般簽呈',
      description: row.description || '',
      formFields,
      steps: stepsEnriched,
      pdfLayout,
      finalNotify,
      exportedAt: new Date().toISOString(),
    });
  }

  /** PDF 排版類型清單（流程編輯用） */
  app.get('/api/workflows/pdf-layout-types', authMiddleware, requirePerm('workflows'), (req, res) => {
    res.json({ types: workflowModule.listPdfLayoutTypes() });
  });

  /** 匯出全部啟用中流程（一個 JSON 包：流程＋表單＋PDF 排版；不含系統設定） */
  app.get('/api/workflows/export', authMiddleware, requirePerm('workflows'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM workflows WHERE active = 1 AND IFNULL(purged, 0) = 0 ORDER BY id`
      )
      .all();
    const pack = {
      format: 'approval-system-workflows',
      version: 2,
      module: 'workflow+form+pdfLayout+finalNotify',
      note: '僅含簽核流程模組（表單欄位＋步驟＋PDF 排版＋最終核准通知）；不含系統設定／Email／使用者／歷史單據',
      exportedAt: new Date().toISOString(),
      count: rows.length,
      workflows: rows.map(buildWorkflowExportItem),
    };
    const fname = `全部簽核流程_可匯入_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="workflows-export.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
    );
    res.send(JSON.stringify(pack, null, 2));
  });

  /** 匯出單一流程 */
  app.get('/api/workflows/:id/export', authMiddleware, requirePerm('workflows'), (req, res) => {
    const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(Number(req.params.id));
    if (!row || row.purged) return res.status(404).json({ error: '找不到流程' });
    const item = buildWorkflowExportItem(row);
    const safe = String(row.name || 'workflow').replace(/[<>:"/\\|?*]/g, '_').slice(0, 40);
    const fname = `${safe}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="workflow.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
    );
    res.send(JSON.stringify(item, null, 2));
  });

  /** 匯入流程 JSON（單一或全部包） */
  app.post('/api/workflows/import', authMiddleware, requirePerm('workflows'), (req, res) => {
    try {
      let data = req.body;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
      if (data && data.payload && typeof data.payload === 'object') {
        data = data.payload;
      }
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: '請提供有效的 JSON 內容' });
      }
      const results = importPayload(data);
      res.json({
        ok: true,
        imported: results.length,
        results,
        message: `已匯入 ${results.length} 個流程（新增或更新）`,
      });
    } catch (e) {
      console.error('workflow import', e);
      res.status(400).json({ error: e.message || '匯入失敗' });
    }
  });

  /** 流程列表 */
  app.get('/api/workflows', authMiddleware, (req, res) => {
    const wantAll = req.query.all === '1';
    if (wantAll && req.user.role !== 'admin' && (typeof userHasPermission === 'function' && !userHasPermission(req.user.id, 'workflows'))) {
      return res.status(403).json({ error: '僅具備「管理簽核流程」權限者可查看全部流程' });
    }
    const onlyActive = !wantAll;
    const where = onlyActive
      ? 'WHERE w.active = 1 AND IFNULL(w.purged, 0) = 0'
      : 'WHERE IFNULL(w.purged, 0) = 0';
    const rows = db
      .prepare(
        `SELECT w.*, u.name AS creator_name
         FROM workflows w
         JOIN users u ON u.id = w.created_by
         ${where}
         ORDER BY w.updated_at DESC`
      )
      .all();
    const workflows = rows.map((r) => typeof serializeWorkflow === 'function' ? serializeWorkflow(r) : r);
    res.json({ workflows });
  });

  /** 單一流程取得 */
  app.get('/api/workflows/:id', authMiddleware, (req, res) => {
    const r = db
      .prepare(
        `SELECT w.*, u.name AS creator_name FROM workflows w
         JOIN users u ON u.id = w.created_by WHERE w.id = ?`
      )
      .get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: '找不到流程' });
    if (req.user.role !== 'admin' && !r.active) {
      return res.status(403).json({ error: '僅系統管理員可查看此流程' });
    }
    res.json({ workflow: typeof serializeWorkflow === 'function' ? serializeWorkflow(r) : r });
  });

  /** 新增流程 */
  app.post('/api/workflows', authMiddleware, requirePerm('workflows'), (req, res) => {
    const { name, description, steps, formFields } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '請輸入流程名稱' });
    }
    const parsed = typeof parseSteps === 'function' ? parseSteps(steps) : null;
    if (!parsed) {
      return res.status(400).json({ error: '請至少設定一個簽核步驟' });
    }
    if (typeof validateStepTemplate === 'function') {
      for (const s of parsed) {
        const err = validateStepTemplate(s);
        if (err) return res.status(400).json({ error: err });
      }
    }
    const fields = typeof parseFormFields === 'function' ? parseFormFields(formFields) : [];
    for (const f of fields) {
      if (f.type === 'select' && (!f.options || !f.options.length)) {
        return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
      }
    }
    for (const s of parsed) {
      if (s.assignType === 'form_user') {
        const ff = fields.find((f) => f.id === s.formFieldId);
        if (!ff) {
          return res.status(400).json({
            error: `步驟「${s.name}」的表單欄位「${s.formFieldId}」不存在，請先新增「人員選擇」欄位`,
          });
        }
        if (ff.type !== 'user') {
          return res.status(400).json({
            error: `步驟「${s.name}」對應欄位「${ff.label}」類型須為「人員選擇」`,
          });
        }
      }
    }
    const wfName = String(name).trim();
    const pdfLayoutBody = (req.body || {}).pdfLayout;
    const pdfLayoutJson = workflowModule.pdfLayoutToJson(
      pdfLayoutBody || { type: 'auto' },
      wfName
    );
    const finalNotifyJson = typeof resolveFinalNotifyJson === 'function'
      ? resolveFinalNotifyJson((req.body || {}).finalNotify)
      : JSON.stringify({ enabled: false, userIds: [] });
    const category = (req.body && req.body.category != null && String(req.body.category).trim())
      ? String(req.body.category).trim()
      : '一般簽呈';
    const info = db
      .prepare(
        `INSERT INTO workflows (name, description, category, created_by, steps_json, form_fields_json, pdf_layout_json, final_notify_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        wfName,
        description ? String(description).trim() : '',
        category,
        req.user.id,
        JSON.stringify(parsed),
        JSON.stringify(fields),
        pdfLayoutJson,
        finalNotifyJson
      );
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ workflow: typeof serializeWorkflow === 'function' ? serializeWorkflow(workflow) : workflow });
  });

  /** 更新流程 */
  app.put('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '找不到流程' });
    const { name, description, category, steps, formFields, active, pdfLayout, finalNotify } =
      req.body || {};
    let stepsJson = existing.steps_json;
    let fieldsJson = existing.form_fields_json || '[]';
    let pdfLayoutJson =
      existing.pdf_layout_json || JSON.stringify({ type: 'auto' });
    let finalNotifyJson =
      existing.final_notify_json ||
      JSON.stringify({ enabled: false, userIds: [] });
    if (formFields !== undefined) {
      const fields = typeof parseFormFields === 'function' ? parseFormFields(formFields) : [];
      for (const f of fields) {
        if (f.type === 'select' && (!f.options || !f.options.length)) {
          return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
        }
      }
      fieldsJson = JSON.stringify(fields);
    }
    if (steps !== undefined) {
      const parsed = typeof parseSteps === 'function' ? parseSteps(steps) : null;
      if (!parsed) return res.status(400).json({ error: '簽核步驟格式不正確' });
      if (typeof validateStepTemplate === 'function') {
        for (const s of parsed) {
          const err = validateStepTemplate(s);
          if (err) return res.status(400).json({ error: err });
        }
      }
      const fields = typeof parseFormFields === 'function' ? parseFormFields(fieldsJson) : [];
      for (const s of parsed) {
        if (s.assignType === 'form_user') {
          const ff = fields.find((f) => f.id === s.formFieldId);
          if (!ff) {
            return res.status(400).json({
              error: `步驟「${s.name}」的表單欄位「${s.formFieldId}」不存在，請先新增「人員選擇」欄位`,
            });
          }
          if (ff.type !== 'user') {
            return res.status(400).json({
              error: `步驟「${s.name}」對應欄位「${ff.label}」類型須為「人員選擇」`,
            });
          }
        }
      }
      stepsJson = JSON.stringify(parsed);
    }
    const finalName =
      name != null ? String(name).trim() : existing.name;
    if (pdfLayout !== undefined) {
      pdfLayoutJson = workflowModule.pdfLayoutToJson(pdfLayout, finalName);
    } else if (name != null) {
      const cur = workflowModule.parsePdfLayoutJson(pdfLayoutJson, finalName);
      pdfLayoutJson = workflowModule.pdfLayoutToJson(cur, finalName);
    }
    if (finalNotify !== undefined && typeof resolveFinalNotifyJson === 'function') {
      finalNotifyJson = resolveFinalNotifyJson(finalNotify);
    }
    db.prepare(
      `UPDATE workflows SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        steps_json = ?,
        form_fields_json = ?,
        pdf_layout_json = ?,
        final_notify_json = ?,
        active = COALESCE(?, active),
        updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(
      name != null ? String(name).trim() : null,
      description != null ? String(description).trim() : null,
      category != null && String(category).trim() ? String(category).trim() : null,
      stepsJson,
      fieldsJson,
      pdfLayoutJson,
      finalNotifyJson,
      typeof active === 'number' || typeof active === 'boolean' ? (active ? 1 : 0) : null,
      id
    );
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    res.json({ workflow: typeof serializeWorkflow === 'function' ? serializeWorkflow(workflow) : workflow });
  });

  /** 刪除流程（軟刪除或永久刪除） */
  app.delete('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '找不到流程' });

    let bodyPermanent = false;
    try {
      if (req.body && typeof req.body === 'object') bodyPermanent = !!req.body.permanent;
    } catch {}
    const permanent =
      req.query.permanent === '1' ||
      req.query.permanent === 'true' ||
      bodyPermanent;

    if (permanent) {
      const pending = db
        .prepare(
          `SELECT COUNT(*) AS c FROM approval_requests
           WHERE workflow_id = ? AND status IN ('pending', 'draft')`
        )
        .get(id).c;
      if (pending > 0) {
        return res.status(400).json({
          error: `此流程尚有 ${pending} 筆進行中的申請，無法永久刪除。請先處理完申請，或使用「刪除」（停用）即可。`,
        });
      }

      const totalReqs = db
        .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE workflow_id = ?`)
        .get(id).c;

      if (totalReqs === 0) {
        try {
          db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
          return res.json({ ok: true, permanent: true, mode: 'hard' });
        } catch (e) {
          console.error('workflow hard delete', e);
        }
      }

      db.prepare(
        `UPDATE workflows
         SET active = 0,
             purged = 1,
             name = CASE
               WHEN name LIKE '%（已永久刪除）' THEN name
               ELSE name || '（已永久刪除）'
             END,
             updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(id);
      return res.json({ ok: true, permanent: true, mode: 'purged' });
    }

    db.prepare(
      `UPDATE workflows SET active = 0, purged = 0, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    res.json({ ok: true, permanent: false });
  });

  /** 復原已停用的流程 */
  app.post('/api/workflows/:id/restore', authMiddleware, requirePerm('workflows'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '找不到流程' });
    db.prepare(
      `UPDATE workflows SET active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    res.json({ workflow: typeof serializeWorkflow === 'function' ? serializeWorkflow(workflow) : workflow });
  });

  /** 紙本 PDF 模版上傳 */
  app.post(
    '/api/workflows/upload-template',
    authMiddleware,
    requirePerm('workflows'),
    uploadTemplate.single('file'),
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: '請選擇要上傳的底圖檔案' });
      }
      let origName = req.file.originalname;
      try {
        origName = Buffer.from(origName, 'latin1').toString('utf8');
      } catch {}
      res.json({
        ok: true,
        templateFile: `templates/${req.file.filename}`,
        originalName: origName,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });
    }
  );

  /** 底圖檔案存取 */
  app.get('/api/templates/:filename', authMiddleware, (req, res) => {
    const fn = path.basename(req.params.filename);
    const fp = path.join(templatesDir, fn);
    if (!fs.existsSync(fp)) {
      return res.status(404).json({ error: '找不到底圖檔案' });
    }
    const ext = path.extname(fn).toLowerCase();
    if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
    else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
    else if (['.jpg', '.jpeg'].includes(ext)) res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(fp);
  });
};
