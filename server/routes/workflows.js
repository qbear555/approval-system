/**
 * 簽核流程與請假報表路由
 * 由 server/index.js 傳入執行期 ctx。
 */
module.exports = function register(ctx) {
  const {
    app,
    db,
    tz,
    leaveReport,
    workflowModule,
    flowGraph,
    importPayload,
    authMiddleware,
    requirePerm,
    userHasPermission,
    parseSteps,
    validateStepTemplate,
    parseFormFields,
    resolveFinalNotifyJson,
    enrichFinalNotifyUsers,
    serializeWorkflow,
  } = ctx;
// ---------- Workflow export / import（流程＋表單＋PDF 排版一體模組）----------
// workflowModule 已於檔案頂部 require；匯出／匯入不碰系統設定、Email、使用者

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
  const finalNotify = enrichFinalNotifyUsers(
    workflowModule.parseFinalNotifyJson(row.final_notify_json)
  );
  return workflowModule.buildExportModule({
    id: row.id,
    name: row.name,
    description: row.description || '',
    formFields,
    steps: stepsEnriched,
    pdfLayout,
    finalNotify,
    exportedAt: tz.nowIso(),
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
    exportedAt: tz.nowIso(),
    count: rows.length,
    workflows: rows.map(buildWorkflowExportItem),
  };
  const fname = `全部簽核流程_可匯入_${tz.today()}.json`;
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
    // 允許 body 直接是字串 JSON
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

// ---------- Workflows（僅系統管理員可管理；一般使用者僅可讀取「啟用中」流程以送出申請）----------
app.get('/api/workflows', authMiddleware, (req, res) => {
  const wantAll = req.query.all === '1';
  if (wantAll && req.user.role !== 'admin' && !userHasPermission(req.user.id, 'workflows')) {
    return res.status(403).json({ error: '僅具備「管理簽核流程」權限者可查看全部流程' });
  }
  const onlyActive = !wantAll;
  // 永久刪除（purged）的流程不出現在任何列表
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
  // 管理列表回傳完整設定；一般使用者送出申請時也需 steps／formFields
  const workflows = rows.map((r) => serializeWorkflow(r));
  res.json({ workflows });
});

app.get('/api/workflows/:id', authMiddleware, (req, res) => {
  const r = db
    .prepare(
      `SELECT w.*, u.name AS creator_name FROM workflows w
       JOIN users u ON u.id = w.created_by WHERE w.id = ?`
    )
    .get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: '找不到流程' });
  // 非管理員不可讀取停用流程、亦不可當管理用途讀取（僅啟用中可供申請）
  if (req.user.role !== 'admin' && !r.active) {
    return res.status(403).json({ error: '僅系統管理員可查看此流程' });
  }
  res.json({ workflow: serializeWorkflow(r) });
});

/**
 * 若請求帶了 v2 流程圖，驗證並回傳 { graph, steps }。
 * steps 由圖線性化而來，供既有 UI／PDF 排版沿用。
 * 回傳 { error } 代表驗證失敗。
 */
function acceptFlowGraph(body) {
  if (!body || body.flow == null) return null;
  const graph = flowGraph.normalizeGraph(body.flow);
  if (!graph) return { error: '流程圖格式無效' };
  const errs = flowGraph.validateGraph(graph);
  if (errs.length) return { error: '流程圖驗證未通過：' + errs.join('；') };
  return { graph, steps: flowGraph.graphToLinear(graph) };
}

app.post('/api/workflows', authMiddleware, requirePerm('workflows'), (req, res) => {
  const { name, description, formFields } = req.body || {};
  let { steps } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '請輸入流程名稱' });
  }
  // v2：以流程圖為準，steps 由圖推導
  const fromGraph = acceptFlowGraph(req.body);
  if (fromGraph?.error) return res.status(400).json({ error: fromGraph.error });
  if (fromGraph) steps = fromGraph.steps;

  const parsed = parseSteps(steps);
  if (!parsed) {
    return res.status(400).json({ error: '請至少設定一個簽核步驟' });
  }
  for (const s of parsed) {
    const err = validateStepTemplate(s);
    if (err) return res.status(400).json({ error: err });
  }
  const fields = parseFormFields(formFields);
  for (const f of fields) {
    if (f.type === 'select' && (!f.options || !f.options.length)) {
      return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
    }
  }
  // 動態步驟「表單人員」需對應到 user 類型欄位
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
  const finalNotifyJson = resolveFinalNotifyJson((req.body || {}).finalNotify);
  const info = db
    .prepare(
      `INSERT INTO workflows (name, description, created_by, steps_json, form_fields_json,
                              pdf_layout_json, final_notify_json, flow_json, flow_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      wfName,
      description ? String(description).trim() : '',
      req.user.id,
      JSON.stringify(parsed),
      JSON.stringify(fields),
      pdfLayoutJson,
      finalNotifyJson,
      fromGraph ? JSON.stringify(fromGraph.graph) : null,
      fromGraph ? 2 : 1
    );
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ workflow: serializeWorkflow(workflow) });
});

app.put('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '找不到流程' });
  const { name, description, formFields, active, pdfLayout, finalNotify } =
    req.body || {};
  let { steps } = req.body || {};
  // v2：以流程圖為準，steps 由圖推導
  const fromGraph = acceptFlowGraph(req.body);
  if (fromGraph?.error) return res.status(400).json({ error: fromGraph.error });
  if (fromGraph) steps = fromGraph.steps;
  let stepsJson = existing.steps_json;
  let fieldsJson = existing.form_fields_json || '[]';
  let pdfLayoutJson =
    existing.pdf_layout_json || JSON.stringify({ type: 'auto' });
  let finalNotifyJson =
    existing.final_notify_json ||
    JSON.stringify({ enabled: false, userIds: [] });
  if (formFields !== undefined) {
    const fields = parseFormFields(formFields);
    for (const f of fields) {
      if (f.type === 'select' && (!f.options || !f.options.length)) {
        return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
      }
    }
    fieldsJson = JSON.stringify(fields);
  }
  if (steps !== undefined) {
    const parsed = parseSteps(steps);
    if (!parsed) return res.status(400).json({ error: '簽核步驟格式不正確' });
    for (const s of parsed) {
      const err = validateStepTemplate(s);
      if (err) return res.status(400).json({ error: err });
    }
    const fields = parseFormFields(fieldsJson);
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
    // 改名時若版面為 auto，重新正規化 label
    const cur = workflowModule.parsePdfLayoutJson(pdfLayoutJson, finalName);
    pdfLayoutJson = workflowModule.pdfLayoutToJson(cur, finalName);
  }
  if (finalNotify !== undefined) {
    finalNotifyJson = resolveFinalNotifyJson(finalNotify);
  }
  db.prepare(
    `UPDATE workflows SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      steps_json = ?,
      form_fields_json = ?,
      pdf_layout_json = ?,
      final_notify_json = ?,
      flow_json = COALESCE(?, flow_json),
      flow_version = COALESCE(?, flow_version),
      active = COALESCE(?, active),
      updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(
    name != null ? String(name).trim() : null,
    description != null ? String(description).trim() : null,
    stepsJson,
    fieldsJson,
    pdfLayoutJson,
    finalNotifyJson,
    fromGraph ? JSON.stringify(fromGraph.graph) : null,
    fromGraph ? 2 : null,
    typeof active === 'number' || typeof active === 'boolean' ? (active ? 1 : 0) : null,
    id
  );
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  res.json({ workflow: serializeWorkflow(workflow) });
});

app.delete('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '找不到流程' });

  // 支援 query 與 JSON body
  let bodyPermanent = false;
  try {
    if (req.body && typeof req.body === 'object') bodyPermanent = !!req.body.permanent;
  } catch {
    /* ignore */
  }
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
      // 無任何單據：可直接從資料庫刪除
      try {
        db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
        return res.json({ ok: true, permanent: true, mode: 'hard' });
      } catch (e) {
        console.error('workflow hard delete', e);
        // fall through to purge flag
      }
    }

    // 有歷史單據：因外鍵不能物理刪除，標記 purged 並從列表隱藏
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

  // 軟刪除：停用，申請頁不再顯示（列表仍可見，可復原）
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
  res.json({ workflow: serializeWorkflow(workflow) });
});

// ---------- 人事：請假報表 Excel ----------
/**
 * POST body: { userIds: number[], dateFrom, dateTo }
 * 一律僅統計已核准請假單（不接受其他狀態）
 * 權限：admin 或 leave_report
 */
app.post(
  '/api/reports/leave-export',
  authMiddleware,
  requirePerm('leave_report'),
  (req, res) => {
    try {
      const body = req.body || {};
      let userIds = Array.isArray(body.userIds)
        ? body.userIds.map(Number).filter(Boolean)
        : [];
      // 未指定則全部啟用中成員
      if (!userIds.length) {
        userIds = db
          .prepare(`SELECT id FROM users WHERE active = 1 ORDER BY id`)
          .all()
          .map((u) => u.id);
      }
      const dateFrom = body.dateFrom || body.from || body.start;
      const dateTo = body.dateTo || body.to || body.end;

      const { buffer, meta } = leaveReport.buildLeaveReportWorkbook({
        userIds,
        dateFrom,
        dateTo,
        statuses: ['approved'],
      });

      const fname = `請假報表_${meta.dateFrom}_${meta.dateTo}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="leave-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
      );
      res.send(buffer);
    } catch (e) {
      console.error('leave-export', e);
      res.status(400).json({ error: e.message || '匯出失敗' });
    }
  }
);
};
