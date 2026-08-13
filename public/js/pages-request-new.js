/**
 * 新建申請
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
async function renderNewRequest(body) {
  await loadUsers();
  const workflows = await loadWorkflows(false);
  if (!workflows.length) {
    body.innerHTML = emptyState({
      title: '尚無可用的簽核流程',
      desc: hasPerm('workflows')
        ? '請先建立簽核流程，才能讓同仁送出申請。'
        : '目前沒有已啟用的流程，請洽系統管理員建立或啟用。',
      actions: hasPerm('workflows')
        ? [{ label: '前往簽核流程', go: 'workflows', primary: true }]
        : [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  body.innerHTML = `
    <div class="card">
      <form id="req-form" class="form-grid">
        <div class="field">
          <label>簽核流程 *</label>
          <select name="workflow_id" required>
            <option value="">請選擇…</option>
            ${workflows
              .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`)
              .join('')}
          </select>
        </div>
        <div id="wf-preview" class="muted"></div>
        <div id="leave-balance-box"></div>
        <div class="field hidden" id="title-field-wrap">
          <label>主旨 *（僅一般簽呈）</label>
          <input name="title" id="req-title" maxlength="200" placeholder="請填寫簽呈主旨" />
          <p class="muted" style="font-size:0.8rem;margin:4px 0 0">其他申請表單不顯示主旨，送出時由系統依表單內容自動產生。</p>
        </div>
        <div id="custom-form-area" class="hidden">
          <div class="form-section-title"><strong>流程表單</strong><span class="muted">依所選流程自動顯示</span></div>
          <div class="custom-form-block form-preview-grid form-fields-multi" id="custom-form-fields"></div>
        </div>
        <div class="field" id="attach-area">
          <label>附件（選填，可多檔上傳）</label>
          <input type="file" id="req-attachments" name="attachments" multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">可一次選取多個檔案上傳（按住 Ctrl／Shift 多選），最多 20 個檔，每個上限 10MB（PDF／圖片／Word／Excel 等）</div>
        </div>
        <div class="field" id="notify-prefs-box">
          <label style="white-space:nowrap">Email 提醒通知${
            state.user?.email
              ? ` <span class="muted" style="font-weight:400">（${esc(state.user.email)}）</span>`
              : ` <span style="color:#b45309;font-weight:400">（尚未設定 Email）</span>`
          }</label>
          <div id="notify-prefs-detail" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" name="notify_email" id="notify-email-cb" value="1"
                ${state.user?.email_notify !== 0 ? 'checked' : ''} />
              開啟通知
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-all-cb" />
              全部（核准／駁回／下一步）
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-approved-cb" class="notify-event-cb" data-event="approved" checked />
              核准
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-rejected-cb" class="notify-event-cb" data-event="rejected" />
              駁回
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-step-cb" class="notify-event-cb" data-event="step" />
              下一步
            </label>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">送出申請</button>
        </div>
      </form>
    </div>`;

  const sel = body.querySelector('[name=workflow_id]');
  const preview = $('#wf-preview');
  const formArea = $('#custom-form-area');
  const formFieldsBox = $('#custom-form-fields');

  // Email 通知：全部／個別勾選連動
  const bindNotifyPrefsUi = () => {
    const master = $('#notify-email-cb');
    const allCb = $('#notify-all-cb');
    const detail = $('#notify-prefs-detail');
    const events = [
      $('#notify-approved-cb'),
      $('#notify-rejected-cb'),
      $('#notify-step-cb'),
    ].filter(Boolean);
    if (!master || !allCb || !events.length) return;

    const syncAllFromEvents = () => {
      const every = events.every((c) => c.checked);
      const some = events.some((c) => c.checked);
      allCb.checked = every;
      allCb.indeterminate = some && !every;
    };
    const setEventsEnabled = (on) => {
      allCb.disabled = !on;
      events.forEach((c) => {
        c.disabled = !on;
      });
      if (detail) detail.style.opacity = on ? '1' : '0.5';
    };
    const onMaster = () => {
      const on = master.checked;
      setEventsEnabled(on);
      if (on) {
        // 開啟時若全無勾選，預設僅「核准」
        if (!events.some((c) => c.checked)) {
          events.forEach((c) => {
            c.checked = c.id === 'notify-approved-cb' || c.dataset?.event === 'approved';
          });
        }
      }
      syncAllFromEvents();
    };
    master.addEventListener('change', onMaster);
    allCb.addEventListener('change', () => {
      const on = allCb.checked;
      events.forEach((c) => {
        c.checked = on;
      });
      allCb.indeterminate = false;
      if (on && !master.checked) {
        master.checked = true;
        setEventsEnabled(true);
      }
    });
    events.forEach((c) => {
      c.addEventListener('change', () => {
        syncAllFromEvents();
        // 若個別有勾選，確保主開關開啟
        if (events.some((x) => x.checked) && !master.checked) {
          master.checked = true;
          setEventsEnabled(true);
        }
      });
    });
    onMaster();
  };
  bindNotifyPrefsUi();

  const isLeaveWorkflow = (w) => {
    const n = String(w?.name || '');
    return /請假/.test(n);
  };
  /** 一般簽呈：唯一需手動填寫系統「主旨」的流程 */
  const isGeneralMemoWorkflow = (w) => {
    const n = String(w?.name || '');
    return /一般簽呈|簽呈/.test(n) && !/信用額度|請假|請購|報支|出差|加班|報修/.test(n);
  };
  /** 是否顯示主旨輸入（僅一般簽呈） */
  const showTitleField = (w) => isGeneralMemoWorkflow(w);

  /** 電腦異常報修：不使用說明欄富文字／自繪 */
  const isItRepairWorkflow = (w) => {
    const n = String(w?.name || '');
    return /電腦異常|異常報修|報修申請|IT.?Repair/i.test(n);
  };

  /** 請假申請：自動產生主旨 */
  const buildLeaveTitle = (formEl) => {
    const data = collectFormData(formEl);
    const type = data.leave_type || data.假別 || '';
    const start = (data.start_date || '').toString().slice(0, 16);
    const end = (data.end_date || '').toString().slice(0, 16);
    const days = data.days != null && data.days !== '' ? `${data.days}日` : '';
    const hours =
      data.hours != null && data.hours !== '' && Number(data.hours) > 0
        ? `${data.hours}小時`
        : '';
    const parts = ['請假申請'];
    if (type) parts.push(String(type));
    if (start || end) parts.push([start, end].filter(Boolean).join('～'));
    if (days) parts.push(days);
    if (hours) parts.push(hours);
    return parts.join(' · ').slice(0, 200);
  };

  /**
   * 非一般簽呈：不顯示主旨欄，依表單＋流程名稱自動組成（列表／搜尋仍用 title）
   */
  const buildAutoTitle = (w, formEl) => {
    if (isLeaveWorkflow(w)) return buildLeaveTitle(formEl);
    const data = collectFormData(formEl) || {};
    const wfName = String(w?.name || '申請').trim() || '申請';
    const pick = [
      data.subject,
      data.item_name,
      data.purpose,
      data.reason,
      data.destination,
      data.customer_name,
      data.issue_desc,
      data.expense_type,
      data.desc,
      data.ot_option,
      data.trading_products,
    ]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
    if (pick.length) return `${wfName} · ${pick[0]}`.slice(0, 200);
    return wfName.slice(0, 200);
  };

  const refreshWorkflowUi = () => {
    const w = workflows.find((x) => x.id === Number(sel.value));
    const titleWrap = $('#title-field-wrap');
    const titleInp = $('#req-title');
    const leaveBox = $('#leave-balance-box');
    if (!w) {
      preview.innerHTML = '';
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
      if (leaveBox) leaveBox.innerHTML = '';
      leaveBalanceReqSeq += 1;
      // 未選流程：先隱藏主旨，選定後再依類型顯示
      if (titleWrap) titleWrap.classList.add('hidden');
      if (titleInp) {
        titleInp.required = false;
        titleInp.value = '';
      }
      return;
    }

    const leaveMode = isLeaveWorkflow(w);
    if (leaveBox) {
      if (leaveMode) {
        loadAndRenderLeaveBalance(leaveBox);
      } else {
        leaveBox.innerHTML = '';
        leaveBalanceReqSeq += 1;
      }
    }
    const needTitle = showTitleField(w);
    const plainTextMode = leaveMode || isItRepairWorkflow(w);
    if (titleWrap) titleWrap.classList.toggle('hidden', !needTitle);
    if (titleInp) {
      titleInp.required = needTitle;
      if (!needTitle) titleInp.value = '';
      else {
        titleInp.placeholder = '請填寫簽呈主旨';
      }
    }

    preview.innerHTML = `
      <div class="muted" style="margin-bottom:8px">簽核層級：申請人送出 → 下列步驟依序簽核</div>
      ${flowChartHtml(w.steps || [], { showLegend: false, flow: w.flow || null })}
      <div class="muted">${esc(w.description || '')}</div>`;
    // 請假表單：確保有「小時」欄（接在天數後）
    let fields = [...(w.formFields || [])];
    if (leaveMode && !fields.some((f) => f.id === 'hours')) {
      const daysIdx = fields.findIndex((f) => f.id === 'days');
      const hoursField = {
        id: 'hours',
        label: '小時',
        type: 'number',
        required: false,
        placeholder: '依起迄自動試算（最小 0.5；全日＝7.5 小時）',
      };
      if (daysIdx >= 0) fields.splice(daysIdx + 1, 0, hoursField);
      else fields.push(hoursField);
    }
    // 天數欄位提示更新
    fields = fields.map((f) => {
      if (f.id === 'days') {
        return {
          ...f,
          placeholder: f.placeholder || '全日 09:00～17:30＝1 日',
        };
      }
      return f;
    });
    const deptHeadSteps = (w.steps || []).filter((s) => s.assignType === 'dept_head');
    const cosignSteps = (w.steps || []).filter((s) => s.assignType === 'cosign_pick');
    const usersPickSteps = (w.steps || []).filter((s) => s.assignType === 'users_pick');
    const hasDeptHead = deptHeadSteps.length > 0;
    const hasCosign = cosignSteps.length > 0;
    const hasUsersPick = usersPickSteps.length > 0;
    if (fields.length || hasDeptHead || hasCosign || hasUsersPick) {
      formArea.classList.remove('hidden');
      const deptHeadHtml = deptHeadSteps.map(renderDeptHeadChooserHtml).join('');
      const cosignHtml = cosignSteps.map(renderCosignChooserHtml).join('');
      const usersPickHtml = usersPickSteps.map(renderUsersPickChooserHtml).join('');
      // 不另開分段標題：標籤與選項同一列／同一區塊橫向顯示
      formFieldsBox.innerHTML =
        fields
          .map((f) =>
            renderDynamicFieldHtml(f, {}, { enableRich: !plainTextMode })
          )
          .join('') +
        deptHeadHtml +
        cosignHtml +
        usersPickHtml;
      bindDateTimeFields(formFieldsBox);
      bindUsersPickChooser(formFieldsBox);
      // 請假、電腦異常報修不綁定富文字／自繪
      if (!plainTextMode) {
        if (typeof RichEditor !== 'undefined') {
          RichEditor.bindAll(formFieldsBox);
        } else {
          bindFormTableEditors(formFieldsBox);
        }
      }
      // 請購：支付方式切換時，更新支付說明提示
      const payMethodSel = formFieldsBox.querySelector('[data-ff="payment_method"]');
      const payNoteInp = formFieldsBox.querySelector('[data-ff="payment_note"]');
      if (payMethodSel && payNoteInp) {
        const payNoteField = payNoteInp.closest('.field');
        const payNoteLabel = payNoteField?.querySelector('label');
        const syncPayNoteHint = () => {
          const m = payMethodSel.value || '';
          if (m === '期票') {
            payNoteInp.placeholder = '請註明期票到期日（例如：115/08/31）';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '期票到期日';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '其他') {
            payNoteInp.placeholder = '請說明其他支付方式';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '其他支付說明';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '現金') {
            payNoteInp.placeholder = '現金支付可不填';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '支付說明（選填）';
            }
          } else {
            payNoteInp.placeholder = '選「期票」請填到期日；選「其他」請說明';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent =
                '支付說明（期票到期日／其他說明）';
            }
          }
        };
        payMethodSel.addEventListener('change', syncPayNoteHint);
        syncPayNoteHint();
      }
      // 請假：起始／結束變更時試算天數＋小時（依假別最小單位）
      const startDate = formFieldsBox.querySelector('[data-ff-date="start_date"]');
      const startTime = formFieldsBox.querySelector('[data-ff-time="start_date"]');
      const endDate = formFieldsBox.querySelector('[data-ff-date="end_date"]');
      const endTime = formFieldsBox.querySelector('[data-ff-time="end_date"]');
      const daysInp = formFieldsBox.querySelector('[data-ff="days"]');
      const hoursInp = formFieldsBox.querySelector('[data-ff="hours"]');
      const leaveTypeSel = formFieldsBox.querySelector('[data-ff="leave_type"]');
      // 試算說明列
      let leaveHint = formFieldsBox.querySelector('#leave-days-hint');
      const hintHost = hoursInp?.parentElement || daysInp?.parentElement;
      if (leaveMode && hintHost && !leaveHint) {
        leaveHint = document.createElement('div');
        leaveHint.id = 'leave-days-hint';
        leaveHint.className = 'muted';
        leaveHint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
        leaveHint.textContent =
          '試算：全日＝1 日／7.5 小時；最小單位依假別（事假／病假／公假／公傷／補休＝0.5 小時；特休＝0.5 日；產假／喪假／曠職＝1 日）';
        hintHost.appendChild(leaveHint);
      }
      const syncLeaveFieldSteps = () => {
        if (!leaveMode) return;
        const lt = leaveTypeSel?.value || '';
        const rule = getLeaveMinUnitClient(lt);
        if (daysInp) {
          daysInp.step = rule.unit === 'day' ? String(rule.step) : 'any';
          daysInp.min = '0';
          if (rule.unit === 'day' && rule.step === 1) {
            daysInp.placeholder = '整日（最小 1 日）';
          } else if (rule.unit === 'day') {
            daysInp.placeholder = '最小 0.5 日（全日＝1）';
          } else {
            daysInp.placeholder = '由小時換算（最小 0.5 小時）';
          }
        }
        if (hoursInp) {
          const hoursWrap = hoursInp.closest('.field');
          // 特休：隱藏小時欄（以日為準，不換算小時）
          if (rule.id === 'special') {
            if (hoursWrap) hoursWrap.classList.add('hidden');
            hoursInp.value = '';
            hoursInp.required = false;
          } else {
            if (hoursWrap) hoursWrap.classList.remove('hidden');
            hoursInp.step = rule.unit === 'hour' ? String(rule.step) : 'any';
            hoursInp.min = '0';
            if (rule.unit === 'hour') {
              hoursInp.placeholder = '最小 0.5 小時（全日＝7.5）';
            } else if (rule.step === 1) {
              hoursInp.placeholder = '整日假＝天數×7.5 小時';
            } else {
              hoursInp.placeholder = '依起迄自動試算';
            }
          }
        }
        if (leaveHint && !startDate?.value) {
          leaveHint.textContent = leaveUnitHintText(lt);
        }
      };
      const maybeFillDays = () => {
        if (!startDate?.value || !endDate?.value) {
          syncLeaveFieldSteps();
          return;
        }
        syncDateTimeHidden(formFieldsBox, 'start_date');
        syncDateTimeHidden(formFieldsBox, 'end_date');
        const a = formFieldsBox.querySelector('[data-ff="start_date"]')?.value;
        const b = formFieldsBox.querySelector('[data-ff="end_date"]')?.value;
        if (!a || !b) return;
        const leaveType = leaveTypeSel?.value || '';
        let rawDays = 0;
        let rawHours = 0;
        if (typeof TwCalendar === 'undefined' || !TwCalendar.calcLeaveDays) {
          const t0 = new Date(a.replace(' ', 'T')).getTime();
          const t1 = new Date(b.replace(' ', 'T')).getTime();
          if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return;
          const sameDay = a.slice(0, 10) === b.slice(0, 10);
          const st = a.slice(11, 16);
          const et = b.slice(11, 16);
          let h = Math.max(0, (t1 - t0) / 3600000);
          h = Math.round(h * 2) / 2;
          if (h > 0 && h < 0.5) h = 0.5;
          let d = 0;
          if (sameDay && st === '09:00' && et === '12:30') d = 0.5;
          else if (sameDay && st >= '13:30' && et === '17:30') d = 0.5;
          else if (sameDay && st === '09:00' && et === '17:30') {
            d = 1;
            h = 7.5;
          }
          rawDays = d;
          rawHours = h;
        } else {
          const result = TwCalendar.calcLeaveDays(a, b);
          rawDays = result.days > 0 ? result.days : 0;
          rawHours = result.hours > 0 ? result.hours : 0;
        }
        const aligned = applyLeaveMinUnitClient(leaveType, rawDays, rawHours);
        if (daysInp) daysInp.value = String(aligned.days);
        if (hoursInp) {
          if (aligned.rule?.id === 'special') {
            hoursInp.value = '';
          } else {
            hoursInp.value = String(aligned.hours);
          }
        }
        if (leaveHint) {
          leaveHint.textContent =
            aligned.rule?.id === 'special'
              ? `試算：${aligned.days} 日（特休以日計算，不換算小時）`
              : `試算：${aligned.days} 日、${aligned.hours} 小時（${leaveUnitHintText(leaveType)}）`;
        }
        syncLeaveFieldSteps();
      };
      if (leaveMode) {
        [startDate, startTime, endDate, endTime].forEach((el) => {
          if (el) el.addEventListener('change', maybeFillDays);
        });
        if (leaveTypeSel) {
          leaveTypeSel.addEventListener('change', () => {
            // 切換假別：若已有起迄則重算；否則只更新提示與 step
            if (startDate?.value && endDate?.value) maybeFillDays();
            else syncLeaveFieldSteps();
          });
        }
        syncLeaveFieldSteps();
      }
      // 延長工時：起迄 → 申請時數自動換算
      if (
        formFieldsBox.querySelector('[data-ff-date="ot_start"]') ||
        formFieldsBox.querySelector('[data-ff-time="ot_start"]')
      ) {
        bindHoursAutoCalc(formFieldsBox, {
          startId: 'ot_start',
          endId: 'ot_end',
          hoursId: 'hours',
          hintId: 'ot-hours-hint',
          hintText:
            '申請時數依延長工時開始／結束自動換算（17:30～24:00，最小 0.5 小時）',
        });
      }
      // 手動修改小時／天數時對齊單位（請假依假別；其餘 0.5）
      formFieldsBox.querySelectorAll('[data-half-step]').forEach((inp) => {
        if (inp.readOnly) return;
        const snap = () => {
          if (inp.value === '' || inp.value == null) return;
          const ff = inp.getAttribute('data-ff') || '';
          if (leaveMode && (ff === 'days' || ff === 'hours')) {
            const lt = leaveTypeSel?.value || '';
            const d =
              ff === 'days'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="days"]')?.value;
            const h =
              ff === 'hours'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="hours"]')?.value;
            const aligned = applyLeaveMinUnitClient(lt, d, h);
            const daysEl = formFieldsBox.querySelector('[data-ff="days"]');
            const hoursEl = formFieldsBox.querySelector('[data-ff="hours"]');
            if (daysEl) daysEl.value = String(aligned.days);
            if (hoursEl) hoursEl.value = String(aligned.hours);
            return;
          }
          inp.value = snapHalfUnit(inp.value);
        };
        inp.addEventListener('change', snap);
        inp.addEventListener('blur', snap);
      });
    } else {
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
    }
  };

  sel.onchange = refreshWorkflowUi;

  $('#req-form').onsubmit = async (e) => {
    e.preventDefault();
    const pickErr = validateUsersPickRequired(e.target);
    if (pickErr) {
      toast(pickErr, 'error');
      return;
    }
    const fd = new FormData(e.target);
    const fileInput = $('#req-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    try {
      const w = workflows.find((x) => x.id === Number(fd.get('workflow_id')));
      let title = String(fd.get('title') || '').trim();
      // 僅一般簽呈需手動填主旨；其餘（含請假）自動組成
      if (!showTitleField(w)) {
        title = buildAutoTitle(w, e.target);
      }
      if (!title) {
        toast(showTitleField(w) ? '請填寫主旨' : '無法產生主旨，請檢查表單', 'error');
        return;
      }
      // 一律用 FormData，方便帶附件（不再送申請內容）
      const body = new FormData();
      body.append('workflow_id', String(fd.get('workflow_id')));
      body.append('title', title);
      body.append('content', '');
      body.append('form_data', JSON.stringify(collectFormData(e.target)));
      const notifyOn = !!e.target.querySelector('#notify-email-cb')?.checked;
      const nApproved = !!e.target.querySelector('#notify-approved-cb')?.checked;
      const nRejected = !!e.target.querySelector('#notify-rejected-cb')?.checked;
      const nStep = !!e.target.querySelector('#notify-step-cb')?.checked;
      const anyEvent = nApproved || nRejected || nStep;
      body.append('notify_email', notifyOn && anyEvent ? '1' : '0');
      body.append(
        'notify_prefs',
        JSON.stringify({
          enabled: notifyOn && anyEvent,
          approved: notifyOn && nApproved,
          rejected: notifyOn && nRejected,
          step: notifyOn && nStep,
          submitted: notifyOn && anyEvent,
          cancelled: notifyOn && anyEvent,
        })
      );
      files.forEach((f) => body.append('attachments', f));
      const { request } = await api('/api/requests', {
        method: 'POST',
        body,
      });
      toast('申請已送出', 'success');
      navigate('detail', { id: request.id });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
