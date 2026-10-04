/**
 * 申請列表／送出／催辦／刪除／總覽統計
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
  const { isRequestRelatedToUser } = require('./request-helpers')(ctx);
app.get('/api/requests', authMiddleware, (req, res) => {
  const filter = req.query.filter || 'related'; // related | mine | pending_me | done | all | deleted
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
  } else if (filter === 'deleted') {
    const canSeeDeleted =
      req.user.role === 'admin' || canDeleteApprovalRecords(req.user);
    if (!canSeeDeleted) {
      return res.status(403).json({ error: '沒有查看已刪申請的權限' });
    }
    rows = db
      .prepare(
        `${REQUEST_LIST_SELECT}
         WHERE IFNULL(r.deleted_at,'') <> ''
         ORDER BY r.deleted_at DESC, r.updated_at DESC
         LIMIT 800`
      )
      .all();
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
      can_delete: can_delete && !rest.deleted_at,
      can_restore: !!(rest.deleted_at && (isAdminUser || canDeleteRecords)),
      deleted: !!rest.deleted_at,
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

const crypto = require('crypto');

/** 將指定的已核准單據 PDF 轉存為目標單據的附件 */
async function attachApprovedRequests(targetRequestId, userId, linkedIds, stepOrder = null) {
  if (!Array.isArray(linkedIds) || !linkedIds.length) return [];
  const validIds = linkedIds.map(Number).filter((n) => n > 0);
  if (!validIds.length) return [];

  const saved = [];
  for (const srcId of validIds) {
    try {
      const srcDetail = getRequestDetail(srcId);
      if (!srcDetail || srcDetail.status !== 'approved') continue;

      const pdfBuf = await pdfSign.buildApprovalPdfBuffer(srcDetail, writeApprovalPdf);
      if (!pdfBuf || !pdfBuf.length) continue;

      const pdfName = buildApprovalPdfFileName(srcDetail);
      const originalName = `已核准_${pdfName}`;
      const storedName = `${Date.now()}_linked_${srcId}_${crypto.randomBytes(6).toString('hex')}.pdf`;
      const filePath = path.join(UPLOAD_DIR, storedName);

      fs.writeFileSync(filePath, pdfBuf);

      const r = db.prepare(
        `INSERT INTO request_attachments
          (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, step_order, source_request_id)
         VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, ?)`
      ).run(
        targetRequestId,
        originalName,
        storedName,
        pdfBuf.length,
        userId,
        stepOrder != null ? Number(stepOrder) : null,
        srcId
      );

      saved.push({
        id: Number(r.lastInsertRowid),
        original_name: originalName,
        size_bytes: pdfBuf.length,
        mime_type: 'application/pdf',
        step_order: stepOrder != null ? Number(stepOrder) : null,
        source_request_id: srcId,
      });
    } catch (err) {
      console.error(`Failed to attach approved request #${srcId}:`, err);
    }
  }
  return saved;
}

/** 供「附加已核准申請單」挑選清單使用 */
app.get('/api/requests/approved-for-attach', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
  const excludeId = Number(req.query.exclude_id) || 0;

  const seeAll = req.user.role === 'admin' || userHasPermission(uid, 'records_all');
  const seeLeave = canDeleteLeaveRequests(req.user);

  let sql = `
    SELECT r.id, r.workflow_id, r.requester_id, r.title, r.status, r.created_at, r.updated_at, r.completed_at,
           w.name AS workflow_name, u.name AS requester_name, u.department AS requester_dept
    FROM approval_requests r
    JOIN workflows w ON w.id = r.workflow_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.status = 'approved' AND ${REQUEST_NOT_DELETED}
  `;
  const params = [];
  if (excludeId > 0) {
    sql += ` AND r.id <> ?`;
    params.push(excludeId);
  }
  sql += ` ORDER BY r.completed_at DESC, r.id DESC LIMIT 500`;

  let rows = db.prepare(sql).all(...params);

  // 權限過濾：管理員或 records_all 可看全部已核准；一般使用者可選本人、同一部門、或相關單據
  if (!seeAll) {
    const userDept = req.user.department || '';
    rows = rows.filter((r) => {
      if (seeLeave && isLeaveApprovalRequest(r)) return true;
      if (userDept && r.requester_dept === userDept) return true;
      return isRequestRelatedToUser(r, uid);
    });
  }

  // 搜尋過濾（單號、主旨、流程名、申請人、部門）
  if (q) {
    rows = rows.filter((r) => {
      const text = `${r.id} ${r.title || ''} ${r.workflow_name || ''} ${r.requester_name || ''} ${r.requester_dept || ''}`.toLowerCase();
      return text.includes(q);
    });
  }

  if (rows.length > limit) {
    rows = rows.slice(0, limit);
  }

  res.json({ requests: rows });
});

app.get('/api/requests/:id', authMiddleware, (req, res) => {
  const canSeeDeleted =
    req.user.role === 'admin' || canDeleteApprovalRecords(req.user);
  const detail = getRequestDetail(Number(req.params.id), {
    includeDeleted: canSeeDeleted,
  });
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
    !detail.deleted_at &&
    (req.user.role === 'admin' ||
      (isLeaveReq && canDeleteLeaveRequests(req.user)) ||
      (!approverSigned &&
        (canDeleteApprovalRecords(req.user) ||
          (detail.requester_id === req.user.id && detail.status !== 'approved'))));
  const canRestore = !!(detail.deleted_at && canSeeDeleted);
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
    canRestore,
    approverSigned,
    currentStep: currentStepOut,
    coApprovers,
    applicantLabor,
  });
});

/** 簽核過程補充附件（非最終審核步驟，支援檔案上傳與已核准單據關聯） */
app.post(
  '/api/requests/:id/attachments',
  authMiddleware,
  upload.array('attachments', 20),
  async (req, res) => {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (!canUserAttachOnStep(req.user.id, detail)) {
      return res.status(403).json({
        error: '僅非最終審核步驟的目前簽核人可新增附件',
      });
    }

    let linkedIds = [];
    try {
      linkedIds = typeof req.body?.linked_request_ids === 'string'
        ? JSON.parse(req.body.linked_request_ids || '[]')
        : (req.body?.linked_request_ids || []);
    } catch {
      linkedIds = [];
    }

    if (!req.files?.length && (!Array.isArray(linkedIds) || !linkedIds.length)) {
      return res.status(400).json({ error: '請選擇要上傳的檔案或已核准單據' });
    }
    const step = (detail.steps || []).find((s) => s.order === detail.current_step);
    const stepOrder = step?.order ?? detail.current_step;
    const saved = saveAttachments(id, req.user.id, req.files || [], stepOrder);
    const linkedSaved = await attachApprovedRequests(id, req.user.id, linkedIds, stepOrder);
    const allSaved = [...saved, ...linkedSaved];

    if (allSaved.length > 0) {
      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
      ).run(
        id,
        stepOrder,
        step?.name || '補充附件',
        req.user.id,
        `附加檔案 ${allSaved.length} 個：${allSaved.map((s) => s.original_name).join('、')}`
      );
      db.prepare(
        `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
    }
    res.status(201).json({
      ok: true,
      attachments: getAttachments(id),
      saved: allSaved,
      message: `已附加 ${allSaved.length} 個附件`,
    });
  }
);

app.post('/api/requests', authMiddleware, upload.array('attachments', 20), async (req, res) => {
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
    let linkedIds = [];
    try {
      linkedIds = typeof req.body?.linked_request_ids === 'string'
        ? JSON.parse(req.body.linked_request_ids || '[]')
        : (req.body?.linked_request_ids || []);
    } catch {
      linkedIds = [];
    }
    if (Array.isArray(linkedIds) && linkedIds.length) {
      await attachApprovedRequests(requestId, req.user.id, linkedIds, 0);
    }
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

app.post('/api/requests/:id/restore', authMiddleware, (req, res) => {
  const canRestore =
    req.user.role === 'admin' || canDeleteApprovalRecords(req.user);
  if (!canRestore) {
    return res.status(403).json({ error: '沒有還原已刪申請的權限' });
  }
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT r.id, r.title, r.deleted_at FROM approval_requests r WHERE r.id = ?`
    )
    .get(id);
  if (!row) return res.status(404).json({ error: '找不到簽核單' });
  if (!row.deleted_at) {
    return res.status(400).json({ error: '此申請未被刪除' });
  }
  db.prepare(
    `UPDATE approval_requests
     SET deleted_at = NULL,
         updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(id);
  logAudit(req, {
    action_type: 'request_restore',
    category: 'approval',
    description: `還原已刪申請 #${id}「${row.title || ''}」`,
    target_id: id,
  });
  res.json({ ok: true, id, title: row.title });
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
