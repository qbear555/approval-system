/**
 * 簽核動作／轉簽／PDF
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
};
