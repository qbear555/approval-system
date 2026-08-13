/**
 * 簽核單、附件、備份與統計路由
 * 由 server/index.js 傳入執行期 ctx。
 */
module.exports = function register(ctx) {
  const {
    app,
    db,
    fs,
    path,
    express,
    tz,
    mail,
    labor,
    pdfSign,
    onlyoffice,
    workflowModule,
    flowEngine,
    lineNotify,
    archiver,
    authMiddleware,
    adminOnly,
    requirePerm,
    writeApprovalPdf,
    buildApprovalPdfFileName,
    buildApprovalZipFileName,
    contentDispositionAttachment,
    runBackupJob,
    listBackups,
    getBackupMeta,
    getBackupById,
    resolveBackupAbsPath,
    backupOneRequest,
    deleteBackup,
    deleteBackups,
    isZipBackup,
    decodeUploadFilename,
    saveAttachments,
    getAttachments,
    isFinalApprovalStep,
    canUserAttachOnStep,
    getClientIp,
    logAudit,
    handleP2ApprovedSideEffects,
    hasApproverSigned,
    isFinanceUser,
    isCreditLimitRequestRow,
    canDeleteApprovalRecords,
    isLeaveApprovalRequest,
    canDeleteLeaveRequests,
    diagnoseApproverEmails,
    fireAndForgetMail,
    fireAndForgetLine,
    getAppBaseUrl,
    getUsernameById,
    findStepByOrder,
    getPendingApproverIds,
    notifyCurrentApprovers,
    userHasPermission,
    parseSteps,
    resolveLeaveTypeOptions,
    parseFormFields,
    mergeFormTables,
    validateFormData,
    mergeDeptHeadFormData,
    mergeUsersPickFormData,
    mergeCosignFormData,
    resolveStepsForRequest,
    loadStepsForRequest,
    createFinalNotifyReceipts,
    getPendingFinalNotifyCount,
    getPendingFinalNotifyRequests,
    getPendingFinanceConfirmRequests,
    getPendingApplicantAckRequests,
    enrichFinalNotifyUsers,
    buildResolvedGraph,
    getRequestGraph,
    resolveActionableStep,
    getRequestDetail,
    checkUserApprovalRight,
    canUserApproveStep,
    isStepComplete,
    evaluateStepCondition,
    advanceToNextEligibleStep,
    upload,
    REQUEST_LIST_SELECT,
    REQUEST_NOT_DELETED,
    CREDIT_LIMIT_COND,
    STEP_FINANCE_CONFIRM,
    STEP_APPLICANT_ACK,
    UPLOAD_DIR,
    MSG_LOCKED_AFTER_SIGN,
  } = ctx;
// ---------- Approval requests ----------
/** 單據是否與登入使用者有關（申請人、歷程簽核人、步驟指定簽核人、或財務部對信用額度單） */
function isRequestRelatedToUser(row, userId) {
  const uid = Number(userId);
  if (!row || !uid) return false;
  if (Number(row.requester_id) === uid) return true;
  // 曾對此單操作
  const acted = db
    .prepare(
      `SELECT id FROM approval_actions WHERE request_id = ? AND actor_id = ? LIMIT 1`
    )
    .get(row.id, uid);
  if (acted) return true;

  // 財務部同仁或具建檔確認權限者，對信用額度申請單預設具備查看權限
  if (isCreditLimitRequestRow(row)) {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
    if (isFinanceUser(user)) return true;
  }

  // 最終核准系統通知收件人
  const fn = db
    .prepare(
      `SELECT id FROM final_notify_receipts WHERE request_id = ? AND user_id = ? LIMIT 1`
    )
    .get(row.id, uid);
  if (fn) return true;

  // 步驟：優先已解析的 steps，否則由快照／流程模板載入
  const steps = Array.isArray(row.steps) && row.steps.length
    ? row.steps
    : loadStepsForRequest(row);
  for (const s of steps) {
    if ((s.approverIds || []).map(Number).includes(uid)) return true;
  }
  return false;
}

app.get('/api/requests', authMiddleware, (req, res) => {
  const filter = req.query.filter || 'related'; // related | mine | pending_me | done | all
  const uid = req.user.id;
  let rows;

  if (filter === 'mine') {
    // 僅本人申請
    rows = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.requester_id = ?
           AND ${REQUEST_NOT_DELETED}
         ORDER BY r.updated_at DESC`
      )
      .all(uid);
  } else if (filter === 'pending_finance_confirm') {
    // 待財務部授信額度建檔確認（總經理已核准，財務部尚未點確認）
    rows = getPendingFinanceConfirmRequests();
  } else if (filter === 'pending_me') {
    // 待我簽核（使用送出時步驟快照，勿用流程模板）
    const allPending = db
      .prepare(
        `${REQUEST_LIST_SELECT}
         WHERE r.status = 'pending' AND ${REQUEST_NOT_DELETED}
         ORDER BY r.updated_at DESC`
      )
      .all();
    rows = [];
    for (const r of allPending) {
      const steps = loadStepsForRequest(r);
      const step = findStepByOrder(steps, r.current_step);
      const check = checkUserApprovalRight(uid, step, r.id);
      if (check.canApprove) {
        if (check.isDelegated) {
          rows.push({
            ...r,
            is_delegated: true,
            delegated_for_name: check.delegatedFor.name,
          });
        } else {
          rows.push(r);
        }
      }
    }

    // 財務部：併入待建檔確認的已核准信用額度單
    if (isFinanceUser(req.user)) {
      const finReqs = getPendingFinanceConfirmRequests();
      const existingIds = new Set(rows.map((x) => x.id));
      for (const fr of finReqs) {
        if (!existingIds.has(fr.id)) rows.push(fr);
      }
    }

    // 申請人待確認財務建檔
    const ackReqs = getPendingApplicantAckRequests(uid);
    const existingIdsAck = new Set(rows.map((x) => x.id));
    for (const ar of ackReqs) {
      if (!existingIdsAck.has(ar.id)) rows.push(ar);
    }

    // 最終核准系統通知：待我確認收到
    const fnReqs = getPendingFinalNotifyRequests(uid);
    const existingIdsFn = new Set(rows.map((x) => x.id));
    for (const fr of fnReqs) {
      if (!existingIdsFn.has(fr.id)) {
        rows.push({
          ...fr,
          needsFinalNotifyAck: true,
          final_notify_label: fr.final_notify_label,
        });
      } else {
        const hit = rows.find((x) => x.id === fr.id);
        if (hit) {
          hit.needsFinalNotifyAck = true;
          hit.final_notify_label = fr.final_notify_label;
        }
      }
    }
  } else if (filter === 'pending_final_notify') {
    rows = getPendingFinalNotifyRequests(uid).map((fr) => ({
      ...fr,
      needsFinalNotifyAck: true,
      final_notify_label: fr.final_notify_label,
    }));
  } else if (filter === 'done') {
    // 已結案：預設僅本人相關；records_all／leave_delete（請假）／管理員可擴大範圍
    const allDone = db
      .prepare(
        `${REQUEST_LIST_SELECT}
         WHERE r.status IN ('approved', 'rejected', 'cancelled')
           AND ${REQUEST_NOT_DELETED}
         ORDER BY r.completed_at DESC, r.updated_at DESC
         LIMIT 800`
      )
      .all();
    const seeAll =
      req.user.role === 'admin' || userHasPermission(uid, 'records_all');
    const seeAllLeave = canDeleteLeaveRequests(req.user);
    rows = seeAll
      ? allDone
      : allDone.filter(
          (r) =>
            isRequestRelatedToUser(r, uid) ||
            (seeAllLeave && isLeaveApprovalRequest(r))
        );
  } else {
    // related / all：預設僅本人相關；records_all／leave_delete（請假）／管理員可擴大範圍
    const candidates = db
      .prepare(
        `${REQUEST_LIST_SELECT}
         WHERE ${REQUEST_NOT_DELETED}
         ORDER BY r.updated_at DESC
         LIMIT 800`
      )
      .all();
    const seeAll =
      req.user.role === 'admin' || userHasPermission(uid, 'records_all');
    const seeAllLeave = canDeleteLeaveRequests(req.user);
    rows = seeAll
      ? candidates
      : candidates.filter(
          (r) =>
            isRequestRelatedToUser(r, uid) ||
            (seeAllLeave && isLeaveApprovalRequest(r))
        );
  }

  // ---- 進階查詢：申請類別／狀態／關鍵字／日期 ----
  const q = String(req.query.q || req.query.keyword || '')
    .trim()
    .toLowerCase();
  const workflowId = Number(req.query.workflow_id) || 0;
  const workflowName = String(
    req.query.workflow || req.query.workflow_name || req.query.category || ''
  ).trim();
  const statusQ = String(req.query.status || '')
    .trim()
    .toLowerCase();
  const dateFrom = labor.toDateOnly(req.query.dateFrom || req.query.from || '');
  const dateTo = labor.toDateOnly(req.query.dateTo || req.query.to || '');

  if (workflowId > 0) {
    rows = rows.filter((r) => Number(r.workflow_id) === workflowId);
  }
  if (workflowName) {
    rows = rows.filter((r) => String(r.workflow_name || '') === workflowName);
  }
  if (statusQ && statusQ !== 'all') {
    // 支援逗號多狀態：approved,rejected
    const statuses = statusQ.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      rows = rows.filter((r) => String(r.status) === statuses[0]);
    } else if (statuses.length > 1) {
      rows = rows.filter((r) => statuses.includes(String(r.status)));
    }
  }
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.id,
        r.title,
        r.requester_name,
        r.workflow_name,
        r.status,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }
  if (dateFrom || dateTo) {
    rows = rows.filter((r) => {
      const raw = String(r.updated_at || r.created_at || r.completed_at || '').slice(0, 10);
      const d = labor.toDateOnly(raw);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  // 申請類別選項（目前結果集＋系統啟用流程，供前端下拉）
  const categorySet = new Set();
  for (const r of rows) {
    if (r.workflow_name) categorySet.add(String(r.workflow_name));
  }
  try {
    const wfs = db
      .prepare(
        `SELECT name FROM workflows WHERE active = 1 AND IFNULL(purged,0)=0 ORDER BY name COLLATE NOCASE`
      )
      .all();
    for (const w of wfs) if (w.name) categorySet.add(String(w.name));
  } catch {
    /* ignore */
  }

  const isAdminUser = req.user.role === 'admin';
  const canDeleteRecords = canDeleteApprovalRecords(req.user);
  const canDeleteLeave = canDeleteLeaveRequests(req.user);
  const list = rows.map(({ steps_json, steps_snapshot_json, ...rest }) => {
    const signed = hasApproverSigned(rest.id, rest);
    const isOwner = Number(rest.requester_id) === Number(uid);
    const isLeave = isLeaveApprovalRequest(rest);
    // 系統管理員：可刪任何狀態；請假＋leave_delete：可刪；其餘：已簽署鎖定
    const can_delete =
      isAdminUser ||
      (isLeave && canDeleteLeave) ||
      (!signed &&
        (canDeleteRecords || (isOwner && rest.status !== 'approved')));
    return {
      ...rest,
      approver_signed: signed,
      is_leave: isLeave,
      can_delete,
    };
  });
  res.json({
    requests: list,
    filters: {
      q: q || '',
      workflow_id: workflowId || '',
      workflow: workflowName || '',
      status: statusQ || '',
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
    },
    categories: [...categorySet].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
  });
});

app.get('/api/requests/:id', authMiddleware, (req, res) => {
  const detail = getRequestDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  const isLeaveReq =
    isLeaveApprovalRequest(detail) ||
    !!(
      detail.form_data &&
      (detail.form_data.leave_type ||
        detail.form_data.假別 ||
        detail.form_data.days != null)
    );
  // 詳情：本人相關，或管理員／全部紀錄／請假刪除權限（僅請假單）
  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  const seeLeave = isLeaveReq && canDeleteLeaveRequests(req.user);
  if (!seeAll && !seeLeave && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權查看此簽核單（僅顯示與您相關的紀錄）' });
  }
  const steps = detail.steps;
  const current = findStepByOrder(steps, detail.current_step);
  const canApprove =
    detail.status === 'pending' && canUserApproveStep(req.user.id, current, detail.id);
  const canAttach = canUserAttachOnStep(req.user.id, detail);
  const isFinalStep = current ? isFinalApprovalStep(detail.steps || [], current) : false;
  const approverSigned = hasApproverSigned(detail.id, detail);
  // 草稿可取消；簽核中僅「尚無簽署人核准」可取消
  const canCancel =
    (detail.requester_id === req.user.id || req.user.role === 'admin') &&
    (detail.status === 'draft' ||
      (detail.status === 'pending' && !approverSigned));
  // 刪除：系統管理員可刪任何狀態；請假＋leave_delete 可刪；其餘已簽署則不可
  // 具備「刪除簽核紀錄」：可刪他人／非鎖定單據；申請人可刪自己的未核准單
  const canDelete =
    req.user.role === 'admin' ||
    (isLeaveReq && canDeleteLeaveRequests(req.user)) ||
    (!approverSigned &&
      (canDeleteApprovalRecords(req.user) ||
        (detail.requester_id === req.user.id && detail.status !== 'approved')));
  // 會簽進度：目前步驟已簽 / 未簽人員
  let coApprovers = null;
  if (current && detail.status === 'pending') {
    const pendingIds = getPendingApproverIds(detail.id, current);
    const allIds = (current.approverIds || []).map(Number);
    const doneIds = allIds.filter((id) => !pendingIds.includes(id));
    const nameOf = (id) => {
      const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(id);
      return u?.name || `#${id}`;
    };
    coApprovers = {
      mode: current.mode === 'all' ? 'all' : 'any',
      all: allIds.map((id) => ({ id, name: nameOf(id) })),
      approved: doneIds.map((id) => ({ id, name: nameOf(id) })),
      pending: pendingIds.map((id) => ({ id, name: nameOf(id) })),
    };
  }

  // 人事步驟：帶入申請人年資與特休剩餘（代理人等步驟不顯示特休狀態）
  let applicantLabor = null;
  const stepFields = Array.isArray(current?.approverFields) ? current.approverFields : [];
  const isAgentStep =
    /代理/.test(String(current?.name || '')) ||
    current?.assignType === 'form_user';
  const isHrStep =
    !isAgentStep &&
    (/人事/.test(String(current?.name || '')) ||
      stepFields.some((f) =>
        /remaining_special|hr_leave|剩餘特休|假別/.test(
          String(f.id || '') + String(f.label || '')
        )
      ));

  /** 申請表單全部假別選項（人事核定下拉用） */
  function getLeaveTypeOptionsFromDetail(d) {
    return resolveLeaveTypeOptions(d.formFields);
  }

  /** 依人事核定假別計算剩餘日／小時建議值（僅特休自動帶入數字；其他假別留白） */
  function suggestRemainByLeaveType(lab, leaveType, thisLeaveDays) {
    const remainingBefore = lab.specialLeave ? lab.specialLeave.remaining : null;
    const remainingHoursBefore = lab.specialLeave
      ? lab.specialLeave.remainingHours
      : null;
    // 僅依「人事選定／表單假別」判斷是否特休，不用標題強制（避免誤判）
    const isSpecial = labor.isSpecialLeaveType(leaveType);
    let remainingAfter = null;
    let prefillDays = '';
    let prefillHours = '';
    if (isSpecial && lab.specialLeave) {
      if (Number.isFinite(thisLeaveDays) && thisLeaveDays > 0) {
        remainingAfter = labor.snapHalf(remainingBefore - thisLeaveDays);
      }
      const suggestRemain =
        remainingAfter != null
          ? remainingAfter
          : remainingBefore != null
            ? remainingBefore
            : null;
      if (suggestRemain != null) {
        prefillDays = String(Math.max(0, suggestRemain));
        prefillHours = String(
          labor.snapHalf(Math.max(0, suggestRemain) * labor.WORK_DAY_HOURS)
        );
      } else if (remainingHoursBefore != null) {
        prefillHours = String(remainingHoursBefore);
      }
    }
    // 非特休：不帶入數字（表格留白）
    return {
      isSpecial,
      remainingBefore,
      remainingHoursBefore,
      remainingAfter,
      suggestRemain: isSpecial
        ? remainingAfter != null
          ? remainingAfter
          : remainingBefore
        : null,
      prefillDays,
      prefillHours,
    };
  }

  // 請假：人事「假別（人事核定）」下拉帶入申請表單全部假別；移除特休小時欄
  let currentStepOut = current || null;
  if (currentStepOut && isLeaveReq) {
    const leaveOpts = getLeaveTypeOptionsFromDetail(detail);
    currentStepOut = {
      ...currentStepOut,
      approverFields: (currentStepOut.approverFields || [])
        .filter(
          (f) =>
            f &&
            f.id !== 'remaining_special_leave_hours' &&
            !/剩餘.*特休.*小時|特休.*小時/.test(String(f.label || ''))
        )
        .map((f) => {
          if (
            f.id === 'hr_leave_type' ||
            (/假別/.test(String(f.label || '')) &&
              (f.type === 'select' || f.id === 'hr_leave_type'))
          ) {
            return {
              ...f,
              type: 'select',
              options: leaveOpts.length ? leaveOpts : f.options || [],
            };
          }
          if (f.id === 'remaining_special_leave_days') {
            return {
              ...f,
              placeholder:
                f.placeholder || '例如：7 或 7.5（以日為單位，不換算小時）',
            };
          }
          return f;
        }),
    };
  }

  // 僅人事核定步驟帶入特休／假別試算；代理人簽核不顯示申請人特休狀態
  if (canApprove && isHrStep) {
    const requester = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(detail.requester_id);
    if (requester) {
      const lab = labor.buildLaborSummary(requester);
      const fd = detail.form_data || {};
      const leaveType = String(fd.leave_type || fd.假別 || '').trim();
      // 本單請假量：天數與小時是同一段期間的兩種單位，不可相加
      // 優先用 days；僅當未填天數時才以 hours÷7.5 換算
      const thisDaysRaw = Number(fd.days);
      const thisHoursRaw = Number(fd.hours);
      let thisLeaveDays = null;
      if (Number.isFinite(thisDaysRaw) && thisDaysRaw > 0) {
        thisLeaveDays = labor.snapHalf(thisDaysRaw);
      } else if (Number.isFinite(thisHoursRaw) && thisHoursRaw > 0) {
        thisLeaveDays = labor.snapHalf(thisHoursRaw / labor.WORK_DAY_HOURS);
      }
      if (!(thisLeaveDays > 0)) thisLeaveDays = null;

      const calc = suggestRemainByLeaveType(lab, leaveType, thisLeaveDays);
      const leaveTypeOptions = getLeaveTypeOptionsFromDetail(detail);

      applicantLabor = {
        ...lab,
        leaveType,
        leaveTypeOptions,
        thisLeaveDays,
        thisIsSpecial: calc.isSpecial,
        remainingBefore: calc.remainingBefore,
        remainingHoursBefore: calc.remainingHoursBefore,
        remainingAfter: calc.remainingAfter,
        suggestRemainingDays: calc.suggestRemain,
        workDayHours: labor.WORK_DAY_HOURS,
        fieldPrefill: {
          hr_leave_type: leaveType || '',
          remaining_special_leave_days: calc.prefillDays,
          // 特休不再換算／帶入小時
        },
        // 前端切換假別時可本地重算（僅日數）
        remainByLeaveType: leaveTypeOptions.reduce((acc, opt) => {
          const c = suggestRemainByLeaveType(lab, opt, thisLeaveDays);
          acc[opt] = {
            days: c.prefillDays,
            isSpecial: c.isSpecial,
          };
          return acc;
        }, {}),
      };
    }
  }

  res.json({
    request: detail,
    canApprove,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    approverSigned,
    currentStep: currentStepOut,
    coApprovers,
    applicantLabor,
  });
});

/** 簽核過程補充附件（非最終審核步驟） */
app.post(
  '/api/requests/:id/attachments',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (!canUserAttachOnStep(req.user.id, detail)) {
      return res.status(403).json({
        error: '僅非最終審核步驟的目前簽核人可新增附件',
      });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: '請選擇要上傳的檔案' });
    }
    const step = (detail.steps || []).find((s) => s.order === detail.current_step);
    const saved = saveAttachments(id, req.user.id, req.files, step?.order ?? detail.current_step);
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
    ).run(
      id,
      step?.order ?? detail.current_step,
      step?.name || '補充附件',
      req.user.id,
      `上傳附件 ${saved.length} 個：${saved.map((s) => s.original_name).join('、')}`
    );
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    res.status(201).json({
      ok: true,
      attachments: getAttachments(id),
      saved,
      message: `已上傳 ${saved.length} 個附件`,
    });
  }
);

app.post('/api/requests', authMiddleware, upload.array('attachments', 20), (req, res) => {
  // 支援 JSON 與 multipart（含附件）
  let workflow_id = req.body?.workflow_id;
  let title = req.body?.title;
  let content = req.body?.content;
  let form_data = req.body?.form_data;
  let notify_email = req.body?.notify_email;
  let notify_prefs = req.body?.notify_prefs;
  if (typeof form_data === 'string') {
    try {
      form_data = JSON.parse(form_data || '{}');
    } catch {
      return res.status(400).json({ error: '表單資料格式錯誤' });
    }
  }
  if (typeof notify_prefs === 'string') {
    try {
      notify_prefs = JSON.parse(notify_prefs || 'null');
    } catch {
      notify_prefs = null;
    }
  }

  if (!workflow_id) {
    return res.status(400).json({ error: '請選擇流程' });
  }
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ? AND active = 1').get(Number(workflow_id));
  if (!wf) return res.status(400).json({ error: '流程不存在或已停用' });
  const templateSteps = parseSteps(wf.steps_json);
  if (!templateSteps?.length) return res.status(400).json({ error: '流程未設定簽核步驟' });

  const formFields = parseFormFields(wf.form_fields_json);
  const validated = validateFormData(formFields, form_data);
  if (validated.error) return res.status(400).json({ error: validated.error });

  // 合併部門主管自選（不在 formFields 定義內，不可被 validate 丟掉）
  const withDept = mergeDeptHeadFormData(validated.data, form_data, templateSteps);
  if (withDept.error) return res.status(400).json({ error: withDept.error });
  const withPick = mergeUsersPickFormData(
    withDept.data || validated.data,
    form_data,
    templateSteps
  );
  if (withPick.error) return res.status(400).json({ error: withPick.error });
  const withCosign = mergeCosignFormData(
    withPick.data || withDept.data || validated.data,
    form_data,
    templateSteps
  );
  if (withCosign.error) return res.status(400).json({ error: withCosign.error });
  const fullFormData = mergeFormTables(
    withCosign.data || withPick.data || withDept.data || validated.data || {},
    form_data
  );

  // 主旨：僅「一般簽呈」需申請人填寫；其餘流程由系統依表單自動產生
  const wfName = String(wf.name || '');
  const isLeave = /請假/.test(wfName);
  const isGeneralMemo =
    /一般簽呈|簽呈/.test(wfName) &&
    !/信用額度|請假|請購|報支|出差|加班|報修/.test(wfName);
  if (!isGeneralMemo) {
    const fd = fullFormData || {};
    if (isLeave) {
      const type = fd.leave_type || '';
      const start = String(fd.start_date || '').slice(0, 16);
      const end = String(fd.end_date || '').slice(0, 16);
      const days = fd.days != null && fd.days !== '' ? `${fd.days}日` : '';
      const hours =
        fd.hours != null && fd.hours !== '' && Number(fd.hours) > 0
          ? `${fd.hours}小時`
          : '';
      const parts = ['請假申請'];
      if (type) parts.push(String(type));
      if (start || end) parts.push([start, end].filter(Boolean).join('～'));
      if (days) parts.push(days);
      if (hours) parts.push(hours);
      title = parts.join(' · ').slice(0, 200);
    } else {
      const pick = [
        fd.subject,
        fd.item_name,
        fd.purpose,
        fd.reason,
        fd.destination,
        fd.customer_name,
        fd.issue_desc,
        fd.expense_type,
        fd.desc,
        fd.ot_option,
        fd.trading_products,
      ]
        .map((v) => (v == null ? '' : String(v).trim()))
        .filter(Boolean)
        .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
      const base = wfName.trim() || '申請';
      title = (pick.length ? `${base} · ${pick[0]}` : base).slice(0, 200);
    }
  }
  // 所有申請一律不使用「申請內容」欄
  content = '';
  if (!title || !String(title).trim()) {
    return res.status(400).json({
      error: isGeneralMemo ? '請填寫主旨' : '無法產生主旨，請檢查表單內容',
    });
  }

  const requester = db
    .prepare(`SELECT id, name, department, role, email, email_notify FROM users WHERE id = ?`)
    .get(req.user.id);
  if (!requester) return res.status(400).json({ error: '申請人資料異常' });

  const resolved = resolveStepsForRequest(requester, fullFormData, templateSteps);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  // 預設：帳號有開 email_notify 且有填 email 則開啟
  let notifyFlag = 1;
  if (notify_email === 0 || notify_email === false || notify_email === '0' || notify_email === 'false') {
    notifyFlag = 0;
  } else if (notify_email === 1 || notify_email === true || notify_email === '1' || notify_email === 'true') {
    notifyFlag = 1;
  } else {
    notifyFlag = requester.email_notify === 0 ? 0 : 1;
  }

  // 細項：核准／駁回／下一步（可全選或個別勾選）
  let prefsObj = null;
  if (notifyFlag === 0) {
    prefsObj = {
      enabled: false,
      approved: false,
      rejected: false,
      step: false,
      submitted: false,
      cancelled: false,
    };
  } else if (notify_prefs && typeof notify_prefs === 'object') {
    // 缺漏鍵＝false（僅勾「核准」時，下一步／駁回必須關閉）
    const flag = (k) => {
      const v = notify_prefs[k];
      if (v === true || v === 1 || v === '1' || v === 'true') return true;
      if (v === false || v === 0 || v === '0' || v === 'false') return false;
      return false;
    };
    const approved = flag('approved');
    const rejected = flag('rejected');
    const step = flag('step');
    // 若三項皆關，視為整筆關閉
    const any = approved || rejected || step;
    prefsObj = {
      enabled: any,
      approved,
      rejected,
      step,
      // 送出／取消：僅在「開啟通知」時通知，不強制等於 any
      submitted: flag('submitted') || false,
      cancelled: flag('cancelled') || false,
    };
    if (!any) notifyFlag = 0;
  } else {
    prefsObj = {
      enabled: true,
      approved: true,
      rejected: true,
      step: true,
      submitted: true,
      cancelled: true,
    };
  }
  const prefsJson = JSON.stringify(prefsObj);

  const formJson = JSON.stringify(fullFormData || {});
  const schemaJson = JSON.stringify(formFields);
  const snapshotJson = JSON.stringify(resolved.steps);
  const info = db
    .prepare(
      `INSERT INTO approval_requests
        (workflow_id, title, content, form_data, form_schema_json, steps_snapshot_json,
         requester_id, status, current_step, notify_email, notify_prefs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`
    )
    .run(
      wf.id,
      String(title).trim(),
      content ? String(content) : '',
      formJson,
      schemaJson,
      snapshotJson,
      req.user.id,
      notifyFlag,
      prefsJson
    );

  const requestId = info.lastInsertRowid;
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
     VALUES (?, 0, '申請人送出', ?, 'submit', ?, '{}')`
  ).run(requestId, req.user.id, '送出簽核申請');

  // 附件
  try {
    saveAttachments(requestId, req.user.id, req.files || []);
  } catch (e) {
    console.error('save attachments', e);
  }

  let detail = getRequestDetail(requestId);

  if (Number(wf.flow_version) === 2) {
    // ── v2 圖模型 ──
    // 送單時把「已解析出實際簽核人」的圖凍結進 flow_snapshot_json，
    // 之後改流程定義不影響進行中的單據（與 steps_snapshot_json 同一設計）
    const graph = buildResolvedGraph(wf, resolved.steps);
    db.prepare(`UPDATE approval_requests SET flow_snapshot_json = ? WHERE id = ?`).run(
      JSON.stringify(graph),
      requestId
    );
    flowEngine.start(requestId, graph, fullFormData || {});
    detail = getRequestDetail(requestId);
  } else {
    // ── v1 線性引擎（既有行為完全不變）──
    const initialSteps = detail.steps || [];
    if (initialSteps.length > 0) {
      const firstStep = initialSteps[0];
      const cond = evaluateStepCondition(firstStep, detail);
      if (!cond.required) {
        advanceToNextEligibleStep(requestId, detail, initialSteps, { order: 0 });
        detail = getRequestDetail(requestId);
      }
    }
  }
  // Email／LINE：通知目前步驟簽核人；申請人確認送出（若有開通知）
  notifyCurrentApprovers(detail, 'pending', requester.name);
  if (notifyFlag) {
    fireAndForgetMail(
      'applicant-submit',
      mail.notifyApplicant(detail, 'submitted', { actorName: requester.name })
    );
    fireAndForgetLine(
      'applicant-submit',
      lineNotify.notifyApplicantLine(detail, 'submitted', {
        actorName: requester.name,
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
  }

  logAudit(req, {
    action_type: 'submit_request',
    category: 'approval',
    description: `送出簽核申請 #${requestId}「${detail.title}」`,
    target_id: requestId,
  });

  res.status(201).json({ request: detail });
});

/**
 * 申請人 Email 催辦目前步驟簽核人
 * 節流：同一單據 10 分鐘內僅能催辦一次
 */
app.post('/api/requests/:id/remind', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '僅簽核中的單據可催辦' });
  }
  if (detail.requester_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '僅申請人或管理員可寄送催辦信' });
  }
  if (!mail.isEnabled()) {
    return res.status(400).json({
      error: '系統尚未啟用 Email 提醒，請洽管理員於「帳號設定 → Email 設定」啟用',
    });
  }

  // 節流
  if (detail.last_remind_at) {
    const last = new Date(String(detail.last_remind_at).replace(' ', 'T')).getTime();
    if (!Number.isNaN(last) && Date.now() - last < 10 * 60 * 1000) {
      const waitMin = Math.ceil((10 * 60 * 1000 - (Date.now() - last)) / 60000);
      return res.status(400).json({
        error: `請稍候再催辦（約 ${waitMin} 分鐘後可再次寄送）`,
      });
    }
  }

  const steps = detail.steps || [];
  const step = findStepByOrder(steps, detail.current_step);
  if (!step) return res.status(400).json({ error: '找不到目前簽核步驟' });

  const targetIds =
    step.mode === 'all' ? getPendingApproverIds(id, step) : step.approverIds || [];
  const diag = diagnoseApproverEmails(targetIds);
  const emails = diag.filter((d) => d.ok).map((d) => d.email);
  const bad = diag.filter((d) => !d.ok);
  if (!emails.length) {
    const detailBad = bad
      .map((d) => `${d.name || d.id}：${d.reason}${d.email ? `（${d.email}）` : ''}`)
      .join('；');
    return res.status(400).json({
      error: `目前簽核人無可寄送的 Email。${detailBad || '請至帳號設定填寫真實信箱'}`,
      diagnose: diag,
    });
  }

  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
  const result = await mail.sendApproverMails(
    detail,
    step,
    emails,
    'remind',
    actor?.name || detail.requester_name
  );

  if (!result.ok) {
    return res.status(400).json({
      error: result.error || '催辦信寄送失敗（SMTP 未成功，信未送達）',
      result,
      diagnose: diag,
    });
  }

  db.prepare(
    `UPDATE approval_requests SET last_remind_at = datetime('now', 'localtime'),
     updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(id);

  const warnBad =
    bad.length > 0
      ? `；略過 ${bad.length} 人無有效信箱`
      : '';
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
     VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
  ).run(
    id,
    step.order,
    step.name || '催辦',
    req.user.id,
    `已寄送 Email 催辦簽核人（${emails.length} 位：${emails.join('、')}${warnBad}）`
  );

  res.json({
    ok: true,
    sentTo: emails.length,
    emails,
    mode: result.mode,
    messageId: result.messageId,
    warning:
      [result.warning, bad.length ? `以下簽核人未寄出：${bad.map((b) => b.name || b.id).join('、')}` : '']
        .filter(Boolean)
        .join('；') || null,
    diagnose: diag,
    request: getRequestDetail(id),
  });
});

/** 下載附件 */
app.get('/api/attachments/:id', authMiddleware, (req, res) => {
  const att = db
    .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
    .get(Number(req.params.id));
  if (!att) return res.status(404).json({ error: '找不到附件' });

  const detail = getRequestDetail(att.request_id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權下載此附件' });
  }

  const abs = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '附件檔案不存在' });

  const downloadName = decodeUploadFilename(att.original_name || `file-${att.id}`);
  const INLINE_PREVIEW_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ]);
  const inline = String(req.query.inline || '') === '1';
  const disposition = contentDispositionAttachment(downloadName, `file-${att.id}`);
  res.setHeader(
    'Content-Disposition',
    inline && INLINE_PREVIEW_MIME.has(att.mime_type)
      ? disposition.replace(/^attachment/i, 'inline')
      : disposition
  );
  if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
  fs.createReadStream(abs).pipe(res);
});

// ---------- OnlyOffice 線上編輯 Word／Excel ----------
app.get('/api/onlyoffice/status', authMiddleware, (req, res) => {
  res.json(onlyoffice.publicStatus(req));
});

/**
 * 開啟編輯器設定
 * 可編輯：簽核中且為目前步驟簽核人（或管理員）
 * 可檢視：其餘有權限看單據者
 */
app.get('/api/onlyoffice/editor/:attachmentId', authMiddleware, (req, res) => {
  try {
    if (!onlyoffice.isEnabled()) {
      return res.status(503).json({
        error:
          'OnlyOffice 未啟用。請在 docker-compose 啟動 onlyoffice 服務，並設定 ONLYOFFICE_ENABLED=1',
      });
    }
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.attachmentId));
    if (!att) return res.status(404).json({ error: '找不到附件' });
    if (!onlyoffice.isOfficeAttachment(att)) {
      return res.status(400).json({ error: '僅 Word／Excel 等 Office 附件可線上編輯' });
    }
    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權開啟此附件' });
    }
    const abs = onlyoffice.resolveAttachmentPath(att);
    if (!abs) return res.status(404).json({ error: '附件檔案不存在' });

    const steps = detail.steps || [];
    const current = findStepByOrder(steps, detail.current_step);
    const isCurrentApprover =
      detail.status === 'pending' &&
      canUserApproveStep(req.user.id, current, detail.id);
    // 僅「簽核中／草稿」可編輯回存；已核准／駁回／取消 → 一律唯讀（含管理員）
    // 簽核中：目前簽核人、管理員、或申請人（非最後關）
    const canEdit =
      detail.status === 'draft'
        ? detail.requester_id === req.user.id || req.user.role === 'admin'
        : detail.status === 'pending' &&
          (isCurrentApprover ||
            req.user.role === 'admin' ||
            (detail.requester_id === req.user.id &&
              !isFinalApprovalStep(steps, current)));

    const editor = onlyoffice.buildEditorConfig({
      att: {
        ...att,
        original_name: decodeUploadFilename(att.original_name || 'file'),
      },
      user: { id: req.user.id, name: req.user.name },
      canEdit,
      requestId: detail.id,
      req,
    });
    res.json({ ok: true, ...editor, requestStatus: detail.status });
  } catch (e) {
    console.error('onlyoffice editor config', e);
    res.status(400).json({ error: e.message || '無法開啟編輯器' });
  }
});

/** Document Server 下載原始檔（token，無需使用者 JWT） */
app.get('/api/onlyoffice/file/:token', (req, res) => {
  try {
    const payload = onlyoffice.verifyFileToken(req.params.token);
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(payload.attachmentId));
    if (!att) return res.status(404).json({ error: '找不到附件' });
    const abs = onlyoffice.resolveAttachmentPath(att);
    if (!abs) return res.status(404).json({ error: '檔案不存在' });
    const name = decodeUploadFilename(att.original_name || `file-${att.id}`);
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(name, `file-${att.id}`)
    );
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    else res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(403).json({ error: '檔案連結無效或已過期' });
  }
});

/**
 * OnlyOffice 儲存 callback
 * 必須回傳 { error: 0 } JSON
 */
app.post('/api/onlyoffice/callback', express.json({ limit: '2mb' }), async (req, res) => {
  const respond = (error = 0) => res.json({ error });
  try {
    const token = req.query.token || req.body?.token;
    if (!token) {
      console.warn('[onlyoffice] callback missing token');
      return respond(1);
    }
    let payload;
    try {
      payload = onlyoffice.verifyCallbackToken(String(token));
    } catch (e) {
      console.warn('[onlyoffice] callback token invalid', e.message);
      return respond(1);
    }
    const result = await onlyoffice.handleCallback(req.body || {}, payload, db);
    if (!result.handled || result.error) {
      console.warn('[onlyoffice] callback fail', result.error);
      return respond(1);
    }
    return respond(0);
  } catch (e) {
    console.error('[onlyoffice] callback error', e);
    return respond(1);
  }
});

app.post(
  '/api/requests/:id/action',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
  const id = Number(req.params.id);
  let { action, comment, step_form_data: stepFormData, signature_image: signatureImage } = req.body || {};
  if (typeof stepFormData === 'string') {
    try {
      stepFormData = JSON.parse(stepFormData || '{}');
    } catch {
      stepFormData = {};
    }
  }
  const allowed = ['approve', 'reject', 'cancel'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: '不支援的操作' });
  }

  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  if (action === 'cancel') {
    if (detail.requester_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅申請人或管理員可取消' });
    }
    if (!['pending', 'draft'].includes(detail.status)) {
      return res.status(400).json({ error: '此單據無法取消' });
    }
    // 簽核中且已有簽署人核准 → 不可取消
    if (detail.status === 'pending' && hasApproverSigned(id, detail)) {
      return res.status(400).json({ error: MSG_LOCKED_AFTER_SIGN });
    }
    db.prepare(
      `UPDATE approval_requests SET status = 'cancelled', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '取消', ?, 'cancel', ?, '{}')`
    ).run(id, detail.current_step, req.user.id, comment || '取消申請');
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-cancel',
      mail.notifyApplicant(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
      })
    );
    fireAndForgetLine(
      'applicant-cancel',
      lineNotify.notifyApplicantLine(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '此單據不在簽核中' });
  }

  const steps = detail.steps;
  // v2 並行分支時可能同時有多個待簽關卡，current_step 只指得到其中一個，
  // 必須改由「這位使用者實際待簽的節點」決定，否則另一條分支的簽核人會被擋
  const step = resolveActionableStep(detail, steps, req.user.id, id);
  const check = checkUserApprovalRight(req.user.id, step, id);
  if (!check.canApprove) {
    return res.status(403).json({ error: '您不是目前步驟的簽核人，或已簽核過' });
  }

  const delegatedForId = check.isDelegated ? check.delegatedFor.id : null;
  let finalComment = comment != null ? String(comment).trim() : '';
  if (check.isDelegated) {
    const proxyTag = `(代理 ${check.delegatedFor.name} 簽核)`;
    if (!finalComment.includes(proxyTag)) {
      finalComment = finalComment ? `${finalComment} ${proxyTag}` : proxyTag;
    }
  } else if (!finalComment) {
    finalComment = action === 'approve' ? '同意' : '駁回';
  }

  // 簽名檔處置：優先本次上傳；否則一律帶入「個人預設簽名」（JWT 無簽名欄，須查 DB）
  let sigImgToSave = signatureImage || null;
  if (sigImgToSave && typeof sigImgToSave === 'string') {
    sigImgToSave = String(sigImgToSave).trim() || null;
  } else {
    sigImgToSave = null;
  }
  if (!sigImgToSave) {
    try {
      const uSig = db
        .prepare(`SELECT signature_image FROM users WHERE id = ?`)
        .get(req.user.id);
      if (uSig?.signature_image) sigImgToSave = uSig.signature_image;
    } catch {
      /* ignore */
    }
  }

  // 中間步驟可隨簽核一併上傳附件；最終審核者不可
  if (req.files?.length) {
    if (isFinalApprovalStep(steps, step)) {
      return res.status(400).json({ error: '最終審核步驟不可新增附件' });
    }
    saveAttachments(id, req.user.id, req.files, step?.order);
  }

  // 簽核步驟附加表單（如人事：剩餘特休）
  let actionFormJson = '{}';
  if (action === 'approve') {
    let fields = Array.isArray(step?.approverFields) ? step.approverFields : [];
    if (fields.length) {
      // 請假人事：非特休時「剩餘日數／小時」可不填（留白）
      const rawStep = stepFormData || {};
      const hrType = String(
        rawStep.hr_leave_type || rawStep.假別 || ''
      ).trim();

      // 假別選項：與詳情頁一致，帶入申請表單全部假別
      const leaveFieldOpts = resolveLeaveTypeOptions(detail.formFields);

      // 特休不以小時計算：略過剩餘特休小時欄
      fields = fields
        .filter(
          (f) =>
            f &&
            f.id !== 'remaining_special_leave_hours' &&
            !(/剩餘.*特休.*小時|特休.*換算.*小時/.test(String(f.label || '')))
        )
        .map((f) => {
          let next = { ...f };
          if (
            f.id === 'hr_leave_type' ||
            (/假別/.test(String(f.label || '')) && f.type === 'select')
          ) {
            const merged = [
              ...new Set(
                [
                  ...(Array.isArray(f.options) ? f.options.map(String) : []),
                  ...leaveFieldOpts,
                  String(detail.form_data?.leave_type || '').trim(),
                  hrType,
                ].filter(Boolean)
              ),
            ];
            next = { ...next, type: 'select', options: merged };
          }
          if (
            hrType &&
            !labor.isSpecialLeaveType(hrType) &&
            (f.id === 'remaining_special_leave_days' ||
              /剩餘.*日數/.test(String(f.label || '')))
          ) {
            next = { ...next, required: false };
          }
          return next;
        });

      // 提交時去掉殘留的小時欄
      if (rawStep && typeof rawStep === 'object') {
        delete rawStep.remaining_special_leave_hours;
      }

      const validated = validateFormData(fields, rawStep);
      if (validated.error) return res.status(400).json({ error: validated.error });
      actionFormJson = JSON.stringify(validated.data || {});
      let merged = {};
      try {
        merged = JSON.parse(
          db.prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`).get(id)
            ?.approver_data_json || '{}'
        );
      } catch {
        merged = {};
      }
      merged[`step_${step.order}`] = {
        step_name: step.name,
        data: validated.data || {},
        by: req.user.id,
        at: tz.nowIso(),
      };
      Object.assign(merged, validated.data || {});
      db.prepare(
        `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(merged), id);
    }
  }

  const reqGraph = getRequestGraph(detail);

  if (action === 'reject') {
    if (reqGraph) {
      // v2：由引擎決定是整單駁回或退回指定節點
      flowEngine.reject(id, reqGraph, step.nodeId || `n${step.order}`);
    } else {
      db.prepare(
        `UPDATE approval_requests SET status = 'rejected', completed_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
    }
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
       VALUES (?, ?, ?, ?, ?, 'reject', ?, ?, ?, ?)`
    ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-reject',
      mail.notifyApplicant(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
      })
    );
    fireAndForgetLine(
      'applicant-reject',
      lineNotify.notifyApplicantLine(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  // approve
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
     VALUES (?, ?, ?, ?, ?, 'approve', ?, ?, ?, ?)`
  ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);

  let mailEvent = null; // approved | step | waiting_co
  let nextStepName = '';
  if (isStepComplete(id, step)) {
    if (reqGraph) {
      // v2：圖引擎推進，可能同時開啟多個並行關卡
      const r = flowEngine.approve(id, reqGraph, step.nodeId || `n${step.order}`, detail.form_data || {});
      mailEvent = r.status === 'approved' ? 'approved' : 'step';
      const idx = flowEngine.indexGraph(reqGraph);
      nextStepName = (r.pending || [])
        .map((nid) => idx.byId.get(nid)?.name || nid)
        .join('、');
    } else {
      const adv = advanceToNextEligibleStep(id, detail, steps, step);
      mailEvent = adv.mailEvent;
      nextStepName = adv.nextStepName;
    }
  } else {
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    mailEvent = 'waiting_co';
  }

  let after = getRequestDetail(id);
  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
  let message = '已核准';
  if (mailEvent === 'approved') {
    const isCredit = isCreditLimitRequestRow(after);
    // 流程模組：最終核准完成後通知選定人員（可開關）
    const finalNotify = enrichFinalNotifyUsers(
      after.finalNotify ||
        workflowModule.parseFinalNotifyJson(
          db
            .prepare(`SELECT final_notify_json FROM workflows WHERE id = ?`)
            .get(after.workflow_id)?.final_notify_json
        )
    );
    const finalNotifyOn = Boolean(finalNotify.enabled);
    const finalNotifyCount = (finalNotify.userIds || []).length;
    const finalNotifyApplies = workflowModule.shouldApplyFinalNotify(
      finalNotify,
      after.requester_id
    );

    if (finalNotifyApplies && finalNotifyCount) {
      message = isCredit
        ? `總經理已完成核定，表單正式「已核准」！系統將通知 ${finalNotifyCount} 位選定人員。`
        : `已核准，簽核流程完成；將系統通知 ${finalNotifyCount} 位選定人員`;
    } else if (finalNotifyOn && !finalNotifyApplies) {
      message = isCredit
        ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知範圍）'
        : '已核准，簽核流程完成（此申請人不在最終通知範圍）';
    } else if (isCredit) {
      message =
        '總經理已完成核定，表單正式「已核准」！系統將通知財務部建檔。';
    } else {
      message = '已核准，簽核流程完成';
    }

    handleP2ApprovedSideEffects(after, req);

    fireAndForgetMail(
      'applicant-approved',
      mail.notifyApplicant(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
      })
    );
    fireAndForgetLine(
      'applicant-approved',
      lineNotify.notifyApplicantLine(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );

    // 1) 流程模組：最終核准 → 系統內通知選定人員（需點「確認收到通知」；非 Email）
    // 注意：單據此時已是 approved，通知失敗不可讓整支 API 500
    // 僅當申請人在「需要通知模組」範圍內才寫入
    if (finalNotifyApplies) {
      try {
        const created = createFinalNotifyReceipts(
          id,
          finalNotify,
          req.user.id,
          after.requester_id
        );
        if (created.created > 0) {
          message = isCredit
            ? `總經理已完成核定，表單正式「已核准」！已在系統通知 ${created.created} 位選定人員（待確認收到）。`
            : `已核准，簽核流程完成；已在系統通知 ${created.created} 位選定人員（待確認收到）`;
        } else if (created.skipped && created.reason === 'applicant_not_in_scope') {
          message = isCredit
            ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知對象範圍內）'
            : '已核准，簽核流程完成（此申請人不在最終通知對象範圍內）';
        }
        after = getRequestDetail(id);
      } catch (fnErr) {
        console.error('[final-notify] create receipts failed', fnErr);
        message = isCredit
          ? '總經理已完成核定，表單正式「已核准」！（系統通知寫入失敗，請管理員檢查）'
          : '已核准，簽核流程完成（系統通知寫入失敗，請管理員檢查）';
      }
    }

    // 2) 相容：信用額度未啟用模組通知時，仍 Email 抄送財務（舊行為；建檔確認仍走系統內按鈕）
    if (isCredit && !finalNotifyOn && mail.sendCcNotice) {
      const finUsers = db
        .prepare(`SELECT * FROM users WHERE active = 1`)
        .all()
        .filter((u) => isFinanceUser(u) && u.role !== 'admin');
      const targets = finUsers.length
        ? finUsers
        : db
            .prepare(`SELECT * FROM users WHERE active = 1`)
            .all()
            .filter((u) => isFinanceUser(u));
      for (const fu of targets) {
        const email = String(fu.email || '').trim();
        if (!email || (mail.isPlaceholderEmail && mail.isPlaceholderEmail(email))) {
          continue;
        }
        fireAndForgetMail(
          'finance-cc-credit',
          mail.sendCcNotice({
            to: email,
            toName: fu.name,
            request: after,
            deptName: '財務部（授信額度建檔）',
            actorName: actor?.name,
            kind: 'final_approved',
          })
        );
      }
    }
  } else if (mailEvent === 'step') {
    message = `已核准，已進入下一步「${nextStepName}」並通知簽核人`;
    fireAndForgetMail(
      'applicant-step',
      mail.notifyApplicant(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
      })
    );
    fireAndForgetLine(
      'applicant-step',
      lineNotify.notifyApplicantLine(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    // 進入下一步（含最終審核步驟）一律通知該步簽核人
    notifyCurrentApprovers(after, 'pending', actor?.name);
  } else if (mailEvent === 'waiting_co') {
    const pendingIds = getPendingApproverIds(id, step);
    const names = pendingIds.map((aid) => {
      const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(aid);
      return u?.name || `#${aid}`;
    });
    message = names.length
      ? `已核准；此步驟為會簽，尚待：${names.join('、')}`
      : '已核准；此步驟尚待其他簽核人';
    // 提醒尚未核准的會簽人（若已啟用 Email）
    notifyCurrentApprovers(after, 'pending', actor?.name);
  }

  res.json({ request: after, message, mailEvent, nextStepName });
});

/**
 * 加簽請託 (Ad-hoc Co-signer)
 * POST /api/requests/:id/cosign
 * Body: { target_user_id: number, comment: string, position: 'current' | 'after' }
 */
app.post('/api/requests/:id/cosign', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment, position = 'current' } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇加簽同仁' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能加簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '加簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行加簽' });
    }

    // ── v2 圖模型：改這張單凍結的圖，不動流程定義 ──
    const cosignGraph = getRequestGraph(detail);
    if (cosignGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const newNode = {
        id: `cosign_${Date.now().toString(36)}`,
        type: 'approval',
        name: `加簽：${targetUser.name}`,
        assignType: 'users',
        mode: 'any',
        approverIds: [targetId],
        approverFields: [],
        rejectTo: 'requester',
      };
      // v1 的 position=current 語意是「加簽者先簽，簽完才輪到原關卡」
      const pos = position === 'after' ? 'after' : 'before';
      const nextGraph = flowEngine.insertAdHoc(id, cosignGraph, anchorId, newNode, pos);
      if (!nextGraph) return res.status(400).json({ error: '加簽失敗：流程圖更新錯誤' });

      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);
      flowEngine.syncCurrentStep(id, nextGraph);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'cosign_request',
        category: 'approval',
        description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: afterG });
    }

    const curOrder = Number(detail.current_step);
    const updatedSteps = [];
    const cosignName = `加簽：${targetUser.name}`;
    let insertedOrder = curOrder;

    if (position === 'after') {
      insertedOrder = curOrder + 1;
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd <= curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: insertedOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    } else {
      // position === 'current'
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd < curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: curOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    }

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'cosign_request',
      category: 'approval',
      description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('cosign error', e);
    res.status(500).json({ error: e.message || '加簽失敗' });
  }
});

/**
 * 轉簽改派 (Forwarding / Re-assign)
 * POST /api/requests/:id/forward
 * Body: { target_user_id: number, comment: string }
 */
app.post('/api/requests/:id/forward', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇轉簽對象' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能轉簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '轉簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    const curOrder = Number(detail.current_step);
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行轉簽' });
    }

    // ── v2 圖模型：轉簽不改流程結構，只換該節點的簽核人 ──
    const fwdGraph = getRequestGraph(detail);
    if (fwdGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const nextGraph = {
        ...fwdGraph,
        nodes: fwdGraph.nodes.map((n) =>
          n.id === anchorId
            ? {
                ...n,
                approverIds: [targetId],
                mode: 'any',
                name: /改派:/.test(n.name || '') ? n.name : `${n.name} (改派: ${targetUser.name})`,
              }
            : n
        ),
      };
      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'forward_request',
        category: 'approval',
        description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: afterG });
    }

    const updatedSteps = steps.map((s) => {
      if (Number(s.order) === curOrder) {
        return {
          ...s,
          approverIds: [targetId],
          name: `${s.name} (改派: ${targetUser.name})`,
        };
      }
      return s;
    });

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'forward_request',
      category: 'approval',
      description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('forward error', e);
    res.status(500).json({ error: e.message || '轉簽失敗' });
  }
});

/**
 * 批次簽核 (P2-2)
 * POST /api/requests/bulk-action
 * Body: { ids: number[], action: 'approve' | 'reject', comment?: string, signature_image?: string }
 */
app.post('/api/requests/bulk-action', authMiddleware, async (req, res) => {
  const { ids, action = 'approve', comment, signature_image } = req.body || {};
  const reqIds = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];

  if (!reqIds.length) {
    return res.status(400).json({ error: '請選擇至少一筆簽核單' });
  }

  const successIds = [];
  const failedItems = [];

  for (const id of reqIds) {
    try {
      const detail = getRequestDetail(id);
      if (!detail) {
        failedItems.push({ id, reason: '找不到簽核單' });
        continue;
      }
      if (detail.status !== 'pending') {
        failedItems.push({ id, reason: '此單據不在簽核中' });
        continue;
      }

      const steps = detail.steps || [];
      const step = findStepByOrder(steps, detail.current_step);
      if (!canUserApproveStep(req.user.id, step, id)) {
        failedItems.push({ id, reason: '您非目前步驟簽核人' });
        continue;
      }

      const stepOrder = Number(detail.current_step);
      const stepName = step?.name || `步驟 ${stepOrder}`;
      const defaultComment = action === 'approve' ? '批次同意核准' : '批次駁回';
      const finalComment = comment ? String(comment).trim() : defaultComment;

      if (action === 'approve') {
        // 批次核准：優先本次簽名，否則個人預設簽名（查 DB）
        let sigImg = signature_image ? String(signature_image).trim() : '';
        if (!sigImg) {
          const uSig = db
            .prepare(`SELECT signature_image FROM users WHERE id = ?`)
            .get(req.user.id);
          if (uSig?.signature_image) sigImg = uSig.signature_image;
        }
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data, signature_image)
           VALUES (?, ?, ?, ?, 'approve', ?, '{}', ?)`
        ).run(id, stepOrder, stepName, req.user.id, finalComment, sigImg || null);

        advanceToNextEligibleStep(id, detail, steps, step);
        const after = getRequestDetail(id);

        if (after.status === 'approved') {
          handleP2ApprovedSideEffects(after, req);
        }

        logAudit(req, {
          action_type: 'bulk_approve_request',
          category: 'approval',
          description: `批次核准申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      } else if (action === 'reject') {
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, 'reject', ?, '{}')`
        ).run(id, stepOrder, stepName, req.user.id, finalComment);

        db.prepare(`UPDATE approval_requests SET status = 'rejected', updated_at = datetime('now', 'localtime') WHERE id = ?`)
          .run(id);

        logAudit(req, {
          action_type: 'bulk_reject_request',
          category: 'approval',
          description: `批次駁回申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      }
    } catch (e) {
      failedItems.push({ id, reason: e.message || '簽核失敗' });
    }
  }

  res.json({
    ok: true,
    processedCount: successIds.length,
    failedCount: failedItems.length,
    successIds,
    failedItems,
    message: `批次處理完成：成功 ${successIds.length} 筆${failedItems.length ? `，失敗 ${failedItems.length} 筆` : ''}`,
  });
});

/** 最終核准系統通知：確認收到 */
app.post('/api/requests/:id/final-notify-ack', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const uid = req.user.id;
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });

    const receipt = db
      .prepare(
        `SELECT * FROM final_notify_receipts WHERE request_id = ? AND user_id = ?`
      )
      .get(id, uid);
    if (!receipt) {
      return res.status(403).json({ error: '您不是此單的最終核准通知對象' });
    }
    if (receipt.acked_at) {
      return res.json({
        ok: true,
        already: true,
        message: '您已確認收到此通知',
        request: getRequestDetail(id),
      });
    }

    db.prepare(
      `UPDATE final_notify_receipts SET acked_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(receipt.id);

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 0, '最終核准通知確認', ?, 'comment', ?, ?)`
    ).run(
      id,
      uid,
      `已確認收到最終核准通知（${receipt.label || '最終核准完成通知'}）`,
      JSON.stringify({
        type: 'final_notify_ack',
        receipt_id: receipt.id,
        label: receipt.label,
      })
    );

    res.json({
      ok: true,
      message: '已確認收到通知',
      request: getRequestDetail(id),
    });
  } catch (e) {
    console.error('[final-notify-ack]', e);
    res.status(500).json({ error: '確認失敗：' + (e.message || '未知錯誤') });
  }
});

/** 財務部授信額度建檔確認 API */
app.post('/api/requests/:id/finance-confirm', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });
    if (!isFinanceUser(req.user)) {
      return res
        .status(403)
        .json({ error: '您沒有財務部授信額度建檔確認之權限（請洽系統管理員設定權限）' });
    }
    if (detail.status !== 'approved') {
      return res.status(400).json({ error: '該單據尚未完全核准' });
    }
    if (!isCreditLimitRequestRow(detail)) {
      return res.status(400).json({ error: '此單據類型非信用額度申請單' });
    }

    const existing = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_FINANCE_CONFIRM);
    if (existing) {
      return res.status(400).json({ error: '財務部已完成額度建檔確認，請勿重複送出' });
    }

    // 合併總經理核定額度至 approver_data，供 PDF「財務部建立額度」顯示
    let adMerged = {};
    try {
      adMerged = JSON.parse(
        db
          .prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`)
          .get(id)?.approver_data_json || '{}'
      );
    } catch {
      adMerged = {};
    }
    if (!adMerged || typeof adMerged !== 'object') adMerged = {};
    const gmLimit =
      adMerged.gm_approved_limit ??
      adMerged.step_3?.data?.gm_approved_limit ??
      null;
    adMerged.limit_established_status = '已完成建立';
    adMerged.finance_establishment_note = '已建立完成';
    if (gmLimit != null && gmLimit !== '') {
      adMerged.finance_established_limit = gmLimit;
    }
    if (note && String(note).trim()) {
      // 備註仍存於歷程；PDF 建檔備註固定顯示「已建立完成」
      adMerged.finance_establishment_extra_note = String(note).trim();
    }

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 4, ?, ?, 'comment', ?, ?)`
    ).run(
      id,
      STEP_FINANCE_CONFIRM,
      req.user.id,
      note ? `已完成核准額度建檔登記：${note}` : '已完成核准額度建檔登記',
      JSON.stringify({
        limit_established_status: '已完成建立',
        finance_establishment_note: '已建立完成',
        finance_established_limit: gmLimit,
        gm_approved_limit: gmLimit,
        finance_establishment_extra_note: note ? String(note).trim() : '',
      })
    );

    db.prepare(
      `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(JSON.stringify(adMerged), id);

    const updated = getRequestDetail(id);

    // 寄送建檔完成通知給申請人
    const requester = db
      .prepare(`SELECT id, name, email FROM users WHERE id = ?`)
      .get(updated.requester_id);
    const reqEmail = String(requester?.email || updated.requester_email || '').trim();
    if (
      reqEmail &&
      !(mail.isPlaceholderEmail && mail.isPlaceholderEmail(reqEmail)) &&
      mail.sendCcNotice
    ) {
      fireAndForgetMail(
        'finance-confirmed',
        mail.sendCcNotice({
          to: reqEmail,
          toName: requester?.name || updated.requester_name,
          request: updated,
          deptName: STEP_FINANCE_CONFIRM,
          actorName: req.user.name,
        })
      );
    }

    res.json({
      ok: true,
      message: '已完成財務部額度建檔登記並通知申請人！',
      request: updated,
    });
  } catch (e) {
    console.error('[finance-confirm error]', e);
    res.status(500).json({ error: '建檔確認失敗：' + e.message });
  }
});

/** 申請人點選確認財務建檔完成 API */
app.post('/api/requests/:id/applicant-ack', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });
    if (
      Number(detail.requester_id) !== Number(req.user.id) &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: '僅本單申請人可點選確認' });
    }
    if (!isCreditLimitRequestRow(detail)) {
      return res.status(400).json({ error: '此單據類型非信用額度申請單' });
    }
    const finDone = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_FINANCE_CONFIRM);
    if (!finDone) {
      return res.status(400).json({ error: '財務部尚未完成建檔確認' });
    }
    const existing = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_APPLICANT_ACK);
    if (existing) {
      return res.status(400).json({ error: '已點選過確認，請勿重複送出' });
    }

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 5, ?, ?, 'comment', '申請人已確認財務部授信額度建檔完成', '{}')`
    ).run(id, STEP_APPLICANT_ACK, req.user.id);

    const updated = getRequestDetail(id);
    res.json({
      ok: true,
      message: '已確認財務部建檔完成並移出待簽核！',
      request: updated,
    });
  } catch (e) {
    console.error('[applicant-ack error]', e);
    res.status(500).json({ error: '確認失敗：' + e.message });
  }
});

/** 安全的壓縮檔內檔名 */
function safeZipEntryName(name, fallback = 'file') {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/**
 * 下載／預覽簽核單 PDF
 * - 與單據相關者、records_all、管理員可存取
 * - preview=1：一律 PDF、inline（詳情頁嵌入；簽核中亦可用）
 * - 已核准且有附件、非 preview：ZIP（PDF＋附件）
 */
app.get('/api/requests/:id/pdf', authMiddleware, async (req, res) => {
  const detail = getRequestDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權下載或預覽此文件' });
  }

  const preview =
    req.query.preview === '1' ||
    req.query.inline === '1' ||
    String(req.query.disposition || '').toLowerCase() === 'inline';

  // 草稿僅申請人／管理員可預覽 PDF
  if (
    detail.status === 'draft' &&
    detail.requester_id !== req.user.id &&
    req.user.role !== 'admin'
  ) {
    return res.status(400).json({ error: '草稿僅申請人可預覽 PDF' });
  }

  try {
    const atts = db
      .prepare(
        `SELECT id, original_name, stored_name FROM request_attachments WHERE request_id = ? ORDER BY id ASC`
      )
      .all(detail.id);

    const clientIp = getClientIp(req);
    const nowStr = tz.nowMinute();
    const watermarkText = `檢視防偽：${req.user.name} (${req.user.username}) · ${nowStr} · IP: ${clientIp}`;
    const detailEnriched = { ...detail, watermarkText };

    logAudit(req, {
      action_type: preview ? 'preview_pdf' : 'download_pdf',
      category: 'approval',
      description: `${preview ? '預覽' : '下載'}簽核單 PDF #${detail.id}「${detail.title}」`,
      target_id: detail.id,
    });

    // 產生 PDF（若系統設定啟用公司憑證則數位簽章；僅已核准通常才加簽）
    const pdfBuf = await pdfSign.buildApprovalPdfBuffer(detailEnriched, writeApprovalPdf);
    if (pdfBuf && pdfBuf._pdfSignSkipped) {
      res.setHeader('X-Pdf-Sign', 'skipped');
      if (pdfBuf._pdfSignError) {
        res.setHeader(
          'X-Pdf-Sign-Error',
          encodeURIComponent(String(pdfBuf._pdfSignError).slice(0, 200))
        );
      }
    }

    const pdfName = buildApprovalPdfFileName(detail);
    const pdfNameSafe = safeZipEntryName(pdfName, `approval-${detail.id}.pdf`);

    // 預覽、或尚未核准、或無附件 → 純 PDF
    const asZip =
      !preview && detail.status === 'approved' && atts.length > 0;

    if (!asZip) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        preview
          ? `inline; filename="approval-${detail.id}.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName)}`
          : contentDispositionAttachment(pdfName, `approval-${detail.id}.pdf`)
      );
      // 預覽時避免快取舊版（簽核中內容可能更新）
      if (preview) {
        res.setHeader('Cache-Control', 'private, no-store');
      }
      return res.send(pdfBuf);
    }

    // 已核准且有附件：ZIP = 簽核單 PDF + 附件/
    const zipName = buildApprovalZipFileName(detail, { hasAttachments: true });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(
        zipName,
        `approval-${detail.id}-with-attachments.zip`
      )
    );

    const archive = archiver('zip', { zlib: { level: 8 } });
    archive.on('error', (err) => {
      console.error('zip error', err);
      if (!res.headersSent) res.status(500).json({ error: '壓縮失敗' });
      else res.end();
    });
    archive.pipe(res);

    archive.append(pdfBuf, { name: pdfNameSafe });

    const usedNames = new Set([pdfNameSafe.toLowerCase()]);
    for (const att of atts) {
      const abs = path.join(UPLOAD_DIR, att.stored_name);
      if (!fs.existsSync(abs)) continue;
      let entry = safeZipEntryName(att.original_name, `附件-${att.id}`);
      // 避免同名覆蓋
      let finalName = entry;
      let n = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        const ext = path.extname(entry);
        const stem = ext ? entry.slice(0, -ext.length) : entry;
        finalName = `${stem}_${n}${ext}`;
        n += 1;
      }
      usedNames.add(finalName.toLowerCase());
      archive.file(abs, { name: `附件/${finalName}` });
    }

    await archive.finalize();
  } catch (e) {
    console.error('PDF/ZIP error', e);
    if (!res.headersSent) {
      const msg = e && e.message ? String(e.message) : 'PDF 產生失敗';
      res.status(500).json({
        error: msg.includes('數位簽章') || msg.includes('PKCS')
          ? msg
          : `PDF 產生失敗：${msg}`,
      });
    }
  }
});

// ---------- 管理員：PDF 備份與查詢 ----------
app.get('/api/backups/meta', authMiddleware, requirePerm('backups'), (req, res) => {
  res.json({ meta: getBackupMeta() });
});

app.get('/api/backups', authMiddleware, requirePerm('backups'), (req, res) => {
  const items = listBackups({
    department: req.query.department || '',
    workflow_name: req.query.workflow_name || '',
    year: req.query.year || '',
    month: req.query.month || '',
    keyword: req.query.keyword || '',
    status: req.query.status || '',
    limit: req.query.limit || 200,
  });
  res.json({ backups: items });
});

app.post('/api/backups/run', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runBackupJob(
      {
        status: body.status || 'approved',
        department: body.department || '',
        workflow_name: body.workflow_name || '',
        date_from: body.date_from || '',
        date_to: body.date_to || '',
        force: !!body.force,
      },
      (id) => getRequestDetail(id),
      req.user.id
    );
    res.json({ ok: true, result });
  } catch (e) {
    console.error('backup run error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.post('/api/backups/request/:id', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const detail = getRequestDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const item = await backupOneRequest(detail, req.user.id);
    res.json({ ok: true, backup: item });
  } catch (e) {
    console.error('backup one error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.get('/api/backups/:id/download', authMiddleware, requirePerm('backups'), (req, res) => {
  const row = getBackupById(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到備份' });
  const abs = resolveBackupAbsPath(row);
  if (!abs) return res.status(404).json({ error: '備份檔案不存在，請重新執行備份' });
  const zip = isZipBackup(row);
  res.setHeader('Content-Type', zip ? 'application/zip' : 'application/pdf');
  const nameHint = String(row.file_name || '');
  const ascii = zip
    ? nameHint.includes('含附件')
      ? `backup-${row.request_id}-with-attachments.zip`
      : `backup-${row.request_id}.zip`
    : `backup-${row.request_id}.pdf`;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name || ascii)}`
  );
  fs.createReadStream(abs).pipe(res);
});

/** 系統管理員刪除單筆備份（含 PDF 檔） */
app.delete('/api/backups/:id', authMiddleware, adminOnly, (req, res) => {
  const result = deleteBackup(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ ok: true, ...result });
});

/** 系統管理員批次刪除備份 */
app.post('/api/backups/bulk-delete', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆備份' });
  const { deleted, failed } = deleteBackups(ids);
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedItems: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 筆備份${failed.length ? `，${failed.length} 筆失敗` : ''}`,
  });
});

/**
 * 稽核日誌查詢條件 → WHERE 子句與參數（查詢與匯出共用）
 * @param {{ q?: string, category?: string, user_id?: string|number, dateFrom?: string, dateTo?: string }} query
 */
function buildAuditLogFilter(query = {}) {
  const { q, category, user_id, dateFrom, dateTo } = query || {};
  const where = [];
  const params = [];

  if (q && String(q).trim()) {
    const kw = `%${String(q).trim()}%`;
    where.push(
      `(user_name LIKE ? OR user_username LIKE ? OR description LIKE ? OR ip_address LIKE ? OR action_type LIKE ?)`
    );
    params.push(kw, kw, kw, kw, kw);
  }
  if (category && String(category).trim()) {
    where.push(`category = ?`);
    params.push(String(category).trim());
  }
  if (user_id) {
    where.push(`user_id = ?`);
    params.push(Number(user_id));
  }
  if (dateFrom && String(dateFrom).trim()) {
    where.push(`created_at >= ?`);
    params.push(`${String(dateFrom).trim()} 00:00:00`);
  }
  if (dateTo && String(dateTo).trim()) {
    where.push(`created_at <= ?`);
    params.push(`${String(dateTo).trim()} 23:59:59`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * 取得系統進階稽核日誌 (P3-1)
 * GET /api/system/audit-logs
 * Query: { q, category, user_id, dateFrom, dateTo, page, limit }
 */
app.get('/api/system/audit-logs', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { page = 1, limit = 50 } = req.query || {};
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(10, Number(limit) || 50));
  const offset = (p - 1) * l;

  const { whereSql, params } = buildAuditLogFilter(req.query);

  const totalCount = db.prepare(`SELECT COUNT(*) AS c FROM system_audit_logs ${whereSql}`).get(...params)?.c || 0;
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, l, offset);

  const categories = ['auth', 'approval', 'user_management', 'workflow', 'system'];

  res.json({
    logs,
    totalCount,
    totalPages: Math.ceil(totalCount / l),
    page: p,
    limit: l,
    categories,
  });
});

/**
 * 匯出系統進階稽核日誌 CSV (P3-1)
 * GET /api/system/audit-logs/export
 */
app.get('/api/system/audit-logs/export', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { whereSql, params } = buildAuditLogFilter(req.query);
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT 5000`).all(...params);

  // UTF-8 BOM CSV output for Excel compatibility
  const BOM = '\uFEFF';
  const headers = ['ID', '時間', '分類', '動作類型', '使用者', '帳號', 'IP 位址', '目標 ID', '說明詳情'];
  const rows = logs.map((l) => [
    l.id,
    l.created_at,
    l.category || '',
    l.action_type || '',
    l.user_name || '',
    l.user_username || '',
    l.ip_address || '',
    l.target_id || '',
    (l.description || '').replace(/"/g, '""'),
  ]);

  const csvContent = BOM + [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="system_audit_logs_${tz.today()}.csv"`);
  res.send(csvContent);
});

/**
 * 硬刪除簽核紀錄（單據、歷程、附件、相關備份）
 * @param {number|string} requestId
 * @param {{ actor: { id: number, role: string } }} opts
 * - 系統管理員：可刪任何狀態（已核准／駁回／簽核中／已取消／已簽署）
 * - 「刪除簽核紀錄」：可刪他人單據（仍受「已簽署鎖定」限制）
 * - 「刪除請假申請」：可刪所有人請假單（含簽核進行中、已簽署）
 * - 申請人本人：可刪除「非已核准」的自己單據
 */
function deleteApprovalRequestHard(requestId, opts = {}) {
  const id = Number(requestId);
  const row = db
    .prepare(
      `SELECT r.id, r.title, r.status, r.requester_id, r.current_step, r.deleted_at,
              w.name AS workflow_name
       FROM approval_requests r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ?`
    )
    .get(id);
  if (!row) return { ok: false, error: '找不到簽核單' };

  const actor = opts.actor;
  const isAdminActor = !!(actor && actor.role === 'admin');
  // 系統管理員：無限制刪除
  if (isAdminActor) {
    // fall through to hard delete
  } else {
    const isLeave = isLeaveApprovalRequest(row);
    const leavePrivileged = actor && isLeave && canDeleteLeaveRequests(actor);
    const recordsPrivileged = actor && canDeleteApprovalRecords(actor);

    // 已有簽署人核准 → 一般不可刪；請假＋leave_delete 可刪
    if (!leavePrivileged && hasApproverSigned(id, row)) {
      return { ok: false, error: MSG_LOCKED_AFTER_SIGN };
    }

    if (actor) {
      const isOwner = Number(row.requester_id) === Number(actor.id);
      if (!leavePrivileged && !recordsPrivileged) {
        if (!isOwner) {
          return { ok: false, error: '只能刪除自己的申請' };
        }
        if (row.status === 'approved') {
          return { ok: false, error: '已核准的申請不可刪除' };
        }
      }
    }
  }

  if (row.deleted_at) {
    return { ok: false, error: '此申請已刪除' };
  }

  db.prepare(
    `UPDATE approval_requests
     SET deleted_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(id);
  logAudit(opts.req || { user: actor }, {
    action_type: 'request_soft_delete',
    category: 'approval',
    description: `軟刪申請 #${id}「${row.title || ''}」`,
    target_id: id,
  });

  return { ok: true, id, title: row.title, status: row.status, soft: true };
}

app.delete('/api/requests/:id', authMiddleware, (req, res) => {
  const result = deleteApprovalRequestHard(req.params.id, { actor: req.user, req });
  if (!result.ok) {
    const code =
      result.error === '找不到簽核單'
        ? 404
        : result.error === '已核准的申請不可刪除' ||
            result.error === '只能刪除自己的申請' ||
            result.error === MSG_LOCKED_AFTER_SIGN
          ? 403
          : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json({ ok: true, ...result });
});

app.post('/api/requests/bulk-delete', authMiddleware, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆簽核紀錄' });
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    const r = deleteApprovalRequestHard(id, { actor: req.user, req });
    if (r.ok) deleted.push({ id: r.id, title: r.title });
    else failed.push({ id, error: r.error });
  }
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedItems: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 筆簽核紀錄${failed.length ? `，${failed.length} 筆失敗` : ''}`,
  });
});

// Dashboard stats
app.get('/api/stats', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const minePending = db
    .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE requester_id = ? AND status = 'pending' AND IFNULL(deleted_at,'') = ''`)
    .get(uid).c;
  const mineDone = db
    .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE requester_id = ? AND status = 'approved' AND IFNULL(deleted_at,'') = ''`)
    .get(uid).c;
  // 必須用 steps_snapshot（實際解析後簽核人），不可只用流程模板
  const allPending = db
    .prepare(
      `SELECT r.*, w.steps_json, r.steps_snapshot_json FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id WHERE r.status = 'pending' AND ${REQUEST_NOT_DELETED}`
    )
    .all();
  const pendingMe = allPending.filter((r) => {
    const steps = loadStepsForRequest(r);
    const step = findStepByOrder(steps, r.current_step);
    return canUserApproveStep(uid, step, r.id);
  }).length;
  const users = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE active = 1`).get().c;
  const workflows = db.prepare(`SELECT COUNT(*) AS c FROM workflows WHERE active = 1`).get().c;
  const isFinance = isFinanceUser(req.user);
  const pendingFinanceConfirm = isFinance
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM approval_requests r
           JOIN workflows w ON w.id = r.workflow_id
           WHERE r.status = 'approved'
             AND ${REQUEST_NOT_DELETED}
             AND ${CREDIT_LIMIT_COND}
             AND r.id NOT IN (
               SELECT request_id FROM approval_actions WHERE step_name = ?
             )`
        )
        .get(STEP_FINANCE_CONFIRM).c
    : 0;
  const pendingApplicantAck = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.status = 'approved'
         AND ${REQUEST_NOT_DELETED}
         AND r.requester_id = ?
         AND ${CREDIT_LIMIT_COND}
         AND r.id IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )`
    )
    .get(uid, STEP_FINANCE_CONFIRM, STEP_APPLICANT_ACK).c;

  const pendingFinalNotify = getPendingFinalNotifyCount(uid);

  const monthlyRequests = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_requests
       WHERE requester_id = ? AND created_at >= date('now', 'start of month', 'localtime')`
    )
    .get(uid).c;
  const avgRow = db
    .prepare(
      `SELECT AVG(julianday(completed_at) - julianday(created_at)) AS d
       FROM approval_requests
       WHERE requester_id = ? AND status = 'approved' AND completed_at IS NOT NULL`
    )
    .get(uid);
  const avgApprovalDays =
    avgRow?.d != null ? Math.round(avgRow.d * 10) / 10 : null;

  res.json({
    stats: {
      minePending,
      mineDone,
      pendingMe:
        pendingMe +
        (isFinance ? pendingFinanceConfirm : 0) +
        pendingApplicantAck +
        pendingFinalNotify,
      pendingFinanceConfirm,
      pendingApplicantAck,
      pendingFinalNotify,
      users,
      workflows,
      monthlyRequests,
      avgApprovalDays,
    },
  });
});
};
