function getWorkflowsActionsHtml() {
  return `
    <button type="button" class="btn success" id="btn-new-paper-wf" style="font-weight:600;" title="上傳紙本 PDF 或掃描圖檔，在線上畫布自訂拖拉欄位與簽章格">📄 匯入紙本文件建立流程</button>
    <button type="button" class="btn outline" id="btn-export-wf" title="含表單欄位、簽核步驟、PDF 排版；不含系統設定">匯出全部流程模組</button>
    <button type="button" class="btn outline" id="btn-import-wf" title="匯入流程＋表單＋PDF 排版；不影響系統設定">匯入流程模組 (.json)</button>
    <button type="button" class="btn primary" id="btn-new-wf">＋ 建立簽核流程</button>
    <input type="file" id="wf-import-file" accept=".json,application/json" class="hidden" />
  `;
}

function bindWorkflowsActions(hostEl, onRefresh) {
  const host = hostEl || document;
  const btnNewPaper = host.querySelector('#btn-new-paper-wf');
  if (btnNewPaper) {
    btnNewPaper.onclick = () => {
      openWorkflowEditor({
        name: '紙本表單簽核流程',
        pdfLayout: { type: 'pdf_template', fields: [] },
        _autoOpenDesigner: true,
      });
    };
  }
  const btnNewWf = host.querySelector('#btn-new-wf');
  if (btnNewWf) btnNewWf.onclick = () => openWorkflowEditor();
  const btnExport = host.querySelector('#btn-export-wf');
  if (btnExport) {
    btnExport.onclick = async () => {
      try {
        const blob = await api('/api/workflows/export', { expectBlob: true });
        // 流程模組：formFields + steps + pdfLayout（version 2）
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `全部簽核流程_可匯入_${formatTaiwanDateTime(new Date(), { dateOnly: true })}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('已匯出流程模組（表單＋步驟＋PDF 排版；不含系統設定）', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  }
  const btnImport = host.querySelector('#btn-import-wf');
  const importFile = host.querySelector('#wf-import-file');
  if (btnImport && importFile) {
    btnImport.onclick = () => importFile.click();
    importFile.onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const data = await api('/api/workflows/import', {
          method: 'POST',
          body: payload,
        });
        toast(
          data.message ||
            `已匯入 ${data.imported} 個流程模組（含 PDF 排版；未變更系統設定）`,
          'success'
        );
        if (typeof onRefresh === 'function') onRefresh();
        else navigate('workflows');
      } catch (err) {
        toast(err.message || '匯入失敗（請確認 JSON 格式）', 'error');
      }
    };
  }
}

function getWorkflowsEmptyHtml() {
  return emptyState({
    title: '尚無簽核流程',
    desc: '建立第一個流程後，同仁即可在「新增申請」選擇表單送出。也可匯入流程模組（含 PDF 排版）。',
    actions: [
      { label: '＋ 建立第一個流程', id: 'btn-new-wf-empty', primary: true },
      { label: '匯入流程模組 JSON', id: 'btn-import-wf-empty', outline: true },
    ],
  });
}

function getWorkflowsTableInnerHtml(workflows) {
  const rowsHtml = workflows
    .map((w) => {
      const steps = [
        '申請人',
        ...(w.steps || []).map((s) => describeStepForList(s)),
      ].join(' → ');
      const fieldCount = (w.formFields || []).length;
      const isOn = !!w.active;
      const pl = w.pdfLayout || {};
      const plLabel = pl.label || pl.type || '自動';
      const plResolved =
        pl.type && pl.type !== 'auto' && pl.resolvedType && pl.resolvedType !== pl.type
          ? ''
          : pl.type === 'auto' && pl.resolvedType
            ? `（${pl.resolvedType}）`
            : '';
      const fn = w.finalNotify || {};
      const fnRecv = (fn.userIds || fn.users || []).length;
      const fnAppMode = fn.applicantMode === 'selected' ? 'selected' : 'all';
      const fnAppN = (fn.applicantUserIds || fn.applicants || []).length;
      const fnText = fn.enabled
        ? `通知 ${fnRecv} 人${
            fnAppMode === 'selected' ? `／限 ${fnAppN} 位申請人` : '／全部申請人'
          }`
        : '關閉';
      return `
    <tr>
      <td>
        <strong>${esc(w.name)}</strong>
        <div class="muted">${esc(w.description || '')}</div>
        <div class="muted" style="margin-top:4px">表單 ${fieldCount} 個欄位</div>
      </td>
      <td style="white-space:nowrap"><span class="field-type-tag">${esc(w.category || '一般簽呈')}</span></td>
      <td style="max-width:420px;font-size:0.88rem;line-height:1.45">${esc(steps) || '—'}</td>
      <td style="font-size:0.85rem;white-space:nowrap" title="${esc(pl.type || 'auto')}">${esc(plLabel)}${esc(plResolved)}</td>
      <td style="font-size:0.85rem;white-space:nowrap" title="${esc(fn.label || '')}">${esc(fnText)}</td>
      <td>${esc(w.creator_name)}</td>
      <td>
        <label class="switch" title="${isOn ? '點擊停用' : '點擊啟用'}">
          <input type="checkbox" data-toggle-wf="${w.id}" data-wf-name="${esc(w.name)}"
            ${isOn ? 'checked' : ''} />
          <span class="switch-slider"></span>
          <span class="switch-text" data-switch-label="${w.id}">${isOn ? '啟用' : '停用'}</span>
        </label>
      </td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <button type="button" class="btn sm outline" data-edit="${w.id}">編輯</button>
          <button type="button" class="btn sm outline" data-flow="${w.id}" title="以流程圖方式編輯關卡順序與連線">🔀 流程圖</button>
          <button type="button" class="btn sm outline" data-export-one="${w.id}">匯出</button>
          ${
            !isOn
              ? `<button type="button" class="btn sm danger" data-purge-wf="${w.id}" data-wf-name="${esc(w.name)}">永久刪除</button>`
              : ''
          }
        </div>
      </td>
    </tr>`;
    })
    .join('');

  return `
      <p class="muted" style="margin-top:0">
        每個申請表單可<strong>啟用</strong>或<strong>停用</strong>：停用後「新增申請」不會出現，歷史單據仍可查閱。
        亦可<strong>建立／編輯</strong>步驟與表單，或<strong>匯出／匯入</strong> JSON。
        不需要的表單可先停用；確認無用再<strong>永久刪除</strong>。
      </p>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>名稱</th><th>分類</th><th>簽核步驟</th><th>PDF 排版</th><th>最終核准通知</th><th>建立者</th><th>狀態</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
  `;
}

function bindWorkflowsTable(body, workflows, onRefresh) {
  body.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => {
      const w = workflows.find((x) => x.id === Number(btn.dataset.edit));
      openWorkflowEditor(w);
    };
  });

  body.querySelectorAll('[data-flow]').forEach((btn) => {
    btn.onclick = async () => {
      const w = workflows.find((x) => x.id === Number(btn.dataset.flow));
      if (!w) return;
      if (typeof openFlowEditor !== 'function') {
        toast('流程圖編輯器尚未載入，請重新整理頁面', 'error');
        return;
      }
      await loadUsers();
      try {
        await loadDepartmentOptions();
      } catch {
        /* ignore */
      }
      openFlowEditor(w, async (graph) => {
        try {
          await api(`/api/workflows/${w.id}`, {
            method: 'PUT',
            body: { flow: graph },
          });
          closeModal();
          toast('流程圖已儲存，並同步更新簽核關卡。進行中單據不受影響。', 'success');
          if (typeof onRefresh === 'function') onRefresh();
          else renderWorkflows(body);
        } catch (e) {
          toast(e.message || '儲存失敗', 'error');
        }
      });
    };
  });

  body.querySelectorAll('[data-export-one]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.exportOne;
      const w = workflows.find((x) => x.id === Number(id));
      try {
        const blob = await api(`/api/workflows/${id}/export`, { expectBlob: true });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(w?.name || 'workflow').replace(/[<>:"/\\|?*]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`已匯出「${w?.name || id}」（含 PDF 排版）`, 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });

  // 開關：啟用／停用
  body.querySelectorAll('[data-toggle-wf]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.toggleWf;
      const name = input.dataset.wfName || '此流程';
      const wantOn = input.checked;
      const label = body.querySelector(`[data-switch-label="${id}"]`);

      if (!wantOn) {
        if (
          !confirm(
            `確定停用申請表單「${name}」？\n停用後「新增申請」將無法再選擇此表單。\n歷史簽核紀錄仍可查閱，之後可再開啟開關啟用。`
          )
        ) {
          input.checked = true;
          return;
        }
      }

      input.disabled = true;
      try {
        if (wantOn) {
          await api(`/api/workflows/${id}/restore`, { method: 'POST' });
          if (label) label.textContent = '啟用';
          toast(`「${name}」已啟用`, 'success');
        } else {
          await api(`/api/workflows/${id}`, { method: 'DELETE' });
          if (label) label.textContent = '停用';
          toast(`「${name}」已停用`, 'success');
        }
        if (typeof onRefresh === 'function') onRefresh();
        else navigate('workflows');
      } catch (e) {
        input.checked = !wantOn;
        toast(e.message, 'error');
      } finally {
        input.disabled = false;
      }
    });
  });

  body.querySelectorAll('[data-purge-wf]').forEach((btn) => {
    btn.onclick = async () => {
      const name = btn.dataset.wfName || '此流程';
      const id = btn.dataset.purgeWf;
      if (
        !confirm(
          `確定【永久刪除】流程「${name}」？\n刪除後列表中不再顯示，無法復原。\n若仍有「進行中」的申請將無法刪除。`
        )
      ) {
        return;
      }
      try {
        // 同時帶 query 與 body，避免參數遺失
        await api(`/api/workflows/${id}?permanent=1`, {
          method: 'DELETE',
          body: { permanent: true },
        });
        toast('流程已永久刪除', 'success');
        if (typeof onRefresh === 'function') onRefresh();
        else navigate('workflows');
      } catch (e) {
        toast(e.message || '永久刪除失敗', 'error');
      }
    };
  });
}

async function renderWorkflows(body) {
  if (!hasPerm('workflows')) {
    body.innerHTML = `<div class="error-msg">您沒有管理簽核流程的權限（請洽系統管理員）</div>`;
    return;
  }
  const workflows = await loadWorkflows(true);
  await loadUsers();
  const pageActions = $('#page-actions');
  if (pageActions) {
    pageActions.innerHTML = getWorkflowsActionsHtml();
    bindWorkflowsActions(pageActions);
  }

  if (!workflows.length) {
    body.innerHTML = getWorkflowsEmptyHtml();
    const b = $('#btn-new-wf-empty');
    if (b) b.onclick = () => openWorkflowEditor();
    const bi = $('#btn-import-wf-empty');
    if (bi) bi.onclick = () => $('#wf-import-file')?.click();
    return;
  }

  body.innerHTML = `
    <div class="card">
      ${getWorkflowsTableInnerHtml(workflows)}
    </div>`;

  bindWorkflowsTable(body, workflows);
}

if (typeof window !== 'undefined') {
  window.getWorkflowsActionsHtml = getWorkflowsActionsHtml;
  window.bindWorkflowsActions = bindWorkflowsActions;
  window.getWorkflowsEmptyHtml = getWorkflowsEmptyHtml;
  window.getWorkflowsTableInnerHtml = getWorkflowsTableInnerHtml;
  window.bindWorkflowsTable = bindWorkflowsTable;
}

function newFormField() {
  return {
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
    optionsText: '',
  };
}

async function openWorkflowEditor(workflow = null) {
  try {
    await loadDepartmentOptions();
  } catch {
    /* ignore */
  }
  const users = state.users;
  const deptNames = collectWorkflowDeptNames(
    (workflow?.steps || []).map((s) => s.department)
  );
  const steps = (workflow && workflow.steps && workflow.steps.length)
    ? JSON.parse(JSON.stringify(workflow.steps || [])).map((s) => ({
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
        ...s,
      }))
    : [
        {
          name: '部門主管',
          assignType: 'dept_head',
          formFieldId: '',
          department: '',
          approverIds: [],
          mode: 'any',
        },
      ];
  const formFields = (workflow && workflow.formFields && workflow.formFields.length)
    ? JSON.parse(JSON.stringify(workflow.formFields || [])).map((f) => ({
        ...f,
        optionsText: Array.isArray(f.options) ? f.options.join('\n') : '',
      }))
    : [];

  const syncStepsFromDom = () => {
    steps.forEach((s, i) => {
      const nameInp = document.querySelector(`[data-field="name"][data-i="${i}"]`);
      const modeSel = document.querySelector(`[data-field="mode"][data-i="${i}"]`);
      const typeSel = document.querySelector(`[data-field="assignType"][data-i="${i}"]`);
      const ffSel = document.querySelector(`[data-field="formFieldId"][data-i="${i}"]`);
      const deptSel = document.querySelector(`[data-field="department"][data-i="${i}"]`);
      if (nameInp) s.name = nameInp.value;
      if (modeSel) s.mode = modeSel.value;
      if (typeSel) s.assignType = typeSel.value;
      if (ffSel) s.formFieldId = ffSel.value;
      if (deptSel) s.department = deptSel.value;
      const skipCb = document.querySelector(
        `[data-field="skipIfNoApprover"][data-i="${i}"]`
      );
      if (skipCb) s.skipIfNoApprover = !!skipCb.checked;
      else if (s.assignType !== 'users_pick') s.skipIfNoApprover = false;
      if (s.assignType === 'users' || s.assignType === 'users_pick') {
        s.approverIds = [...document.querySelectorAll(`[data-approver="${i}"]:checked`)].map((c) =>
          Number(c.value)
        );
      }
    });
  };

  const renderSteps = () => {
    const box = $('#steps-box');
    if (!box) return;
    const userFields = formFields.filter((f) => f.type === 'user');
    box.innerHTML = steps
      .map((s, i) => {
        const at = s.assignType || 'users';
        return `
      <div class="step-card" data-idx="${i}">
        <div class="step-head">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="step-num">${i + 1}</span>
            <strong>簽核步驟</strong>
            <span class="field-type-tag">${esc(ASSIGN_TYPE_LABEL[at] || at)}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn sm outline" data-up="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" class="btn sm outline" data-down="${i}" ${i >= steps.length - 1 ? 'disabled' : ''}>下移</button>
            <button type="button" class="btn sm outline" data-rm="${i}" ${steps.length <= 1 ? 'disabled' : ''}>移除</button>
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label>步驟名稱</label>
            <input data-field="name" data-i="${i}" value="${esc(s.name)}" placeholder="例如：代理人、部門主管、副總經理" />
          </div>
          <div class="field">
            <label>核准模式</label>
            <select data-field="mode" data-i="${i}">
              <option value="any" ${s.mode !== 'all' ? 'selected' : ''}>任一簽核人核准即可</option>
              <option value="all" ${s.mode === 'all' ? 'selected' : ''}>需全部簽核人核准</option>
            </select>
          </div>
          <div class="field">
            <label>簽核人來源 *</label>
            <select data-field="assignType" data-i="${i}">
              ${Object.entries(ASSIGN_TYPE_LABEL)
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${at === k ? 'selected' : ''}>${v}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field ${at === 'form_user' ? '' : 'hidden'}" data-assign-wrap="form_user-${i}">
            <label>對應表單人員欄位</label>
            <select data-field="formFieldId" data-i="${i}">
              ${
                userFields.length
                  ? userFields
                      .map(
                        (f) =>
                          `<option value="${esc(f.id)}" ${
                            s.formFieldId === f.id ? 'selected' : ''
                          }>${esc(f.label)}（${esc(f.id)}）</option>`
                      )
                      .join('')
                  : `<option value="agent">代理人（請先新增「人員選擇」欄位，id=agent）</option>`
              }
            </select>
          </div>
          <div class="field ${at === 'department' ? '' : 'hidden'}" data-assign-wrap="department-${i}">
            <label>簽核單位／部門</label>
            <select data-field="department" data-i="${i}">
              <option value="">請選擇…</option>
              ${deptNames
                .map(
                  (d) =>
                    `<option value="${esc(d)}" ${s.department === d ? 'selected' : ''}>${esc(d)}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="field ${
          at === 'users' || at === 'users_pick' ? '' : 'hidden'
        }" style="margin-top:8px" data-assign-wrap="users-${i}" data-assign-wrap-extra="users_pick-${i}">
          <label>${
            at === 'users_pick'
              ? '可選簽核人名單 *（申請人送出時從中擇一或選全部）'
              : '指定簽核人 *（勾選＝新增、取消勾選＝刪除）'
          }</label>
          <div class="approver-list">
            ${users
              .map(
                (u) => `
              <label>
                <input type="checkbox" data-approver="${i}" value="${u.id}"
                  ${(s.approverIds || []).includes(u.id) ? 'checked' : ''} />
                ${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}
              </label>`
              )
              .join('')}
          </div>
          <p class="muted" style="font-size:0.8rem;margin:6px 0 0">${
            at === 'users_pick'
              ? '申請人從名單勾選一位或多位；若下方勾選「非必填」則可不選（略過此步驟）。'
              : '可隨時增刪指定人員；儲存流程後生效。新申請單會依最新設定解析簽核人。'
          }</p>
        </div>
        ${
          at === 'users_pick'
            ? `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.9rem">
                <input type="checkbox" data-field="skipIfNoApprover" data-i="${i}" ${
                  s.skipIfNoApprover ? 'checked' : ''
                } />
                <span>非必填（申請人可不選，略過「${esc(s.name || '此步驟')}」）</span>
              </label>`
            : ''
        }
        ${
          at === 'dept_head'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                申請時由<strong>申請人自行選擇</strong>同部門（或任一）成員作為此步驟簽核人；
                亦可選擇<strong>不需要經過部門主管</strong>（略過此步驟）。
              </p>`
            : ''
        }
        ${
          at === 'users_pick'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                ${
                  s.skipIfNoApprover
                    ? '申請人<strong>可不選</strong>（略過）；或勾選名單中的一位／多位。'
                    : '申請人<strong>必選</strong>名單中的一位，或選<strong>全部</strong>。'
                }
              </p>`
            : ''
        }
        ${
          at === 'cosign_pick'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                申請時可<strong>勾選多位</strong>會簽人員（皆須核准）；可不選（略過會簽步驟）。
              </p>`
            : ''
        }
      </div>`;
      })
      .join('');

    box.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.onclick = () => {
        syncStepsFromDom();
        steps.splice(Number(btn.dataset.rm), 1);
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-up]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.up);
        if (i <= 0) return;
        syncStepsFromDom();
        const t = steps[i - 1];
        steps[i - 1] = steps[i];
        steps[i] = t;
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-down]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.down);
        if (i >= steps.length - 1) return;
        syncStepsFromDom();
        const t = steps[i + 1];
        steps[i + 1] = steps[i];
        steps[i] = t;
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-field]').forEach((inp) => {
      inp.onchange = inp.oninput = () => {
        const i = Number(inp.dataset.i);
        const field = inp.dataset.field;
        if (inp.type === 'checkbox') {
          steps[i][field] = !!inp.checked;
        } else {
          steps[i][field] = inp.value;
        }
        if (field === 'assignType') renderSteps();
        if (field === 'skipIfNoApprover') renderSteps();
        if (field === 'name') syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-approver]').forEach((cb) => {
      cb.onchange = () => {
        const i = Number(cb.dataset.approver);
        const id = Number(cb.value);
        const set = new Set(steps[i].approverIds || []);
        if (cb.checked) set.add(id);
        else set.delete(id);
        steps[i].approverIds = [...set];
      };
    });
    syncFlowPathFromSteps();
  };

  const syncFormFieldsFromDom = () => {
    formFields.forEach((f, i) => {
      const label = document.querySelector(`[data-ff-label="${i}"]`);
      const type = document.querySelector(`[data-ff-type="${i}"]`);
      const required = document.querySelector(`[data-ff-req="${i}"]`);
      const placeholder = document.querySelector(`[data-ff-ph="${i}"]`);
      const options = document.querySelector(`[data-ff-opts="${i}"]`);
      if (label) f.label = label.value;
      if (type) f.type = type.value;
      if (required) f.required = required.checked;
      if (placeholder) f.placeholder = placeholder.value;
      if (options) {
        f.optionsText = options.value;
        f.options = options.value
          .split(/[\n,]/)
          .map((o) => o.trim())
          .filter(Boolean);
      }
    });
  };

  /** 依目前步驟產生流程路徑文字 */
  const buildFlowPathText = () => {
    const names = steps
      .map((s) => String(s.name || '').trim())
      .filter(Boolean);
    return names.length ? `申請人 → ${names.join(' → ')}` : '申請人';
  };

  /**
   * 步驟新增／刪除／改名／排序後，同步更新「說明」與畫面上的路徑名稱
   * （流程標題若為路徑格式或空白，也一併更新）
   */
  const syncFlowPathFromSteps = () => {
    const path = buildFlowPathText();
    const descEl = document.querySelector('#wf-form [name="description"]');
    const nameEl = document.querySelector('#wf-form [name="name"]');
    const preview = document.querySelector('#flow-path-preview');
    if (descEl) descEl.value = path;
    if (preview) {
      preview.innerHTML = `${flowChartHtml(steps, { showLegend: false })}
        <div class="muted" style="margin-top:6px">${esc(path)}</div>`;
    }
    if (nameEl) {
      const cur = String(nameEl.value || '').trim();
      // 僅在名稱空白、或名稱本身就是路徑字串時自動改寫，避免蓋掉「請假申請」等專名
      if (!cur || cur.startsWith('申請人') || cur.includes(' → ')) {
        nameEl.value = path;
      }
    }
  };

  const renderFormFields = () => {
    const box = $('#form-fields-box');
    if (!box) return;
    if (!formFields.length) {
      box.innerHTML = `<div class="muted" style="padding:8px 0">尚未新增表單欄位。一般簽呈需填主旨；其餘流程主旨由系統自動產生。</div>`;
      return;
    }
    box.innerHTML = formFields
      .map(
        (f, i) => `
      <div class="step-card" data-ff-idx="${i}">
        <div class="step-head">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="step-num">${i + 1}</span>
            <strong>表單欄位</strong>
            <span class="field-type-tag">${esc(FIELD_TYPE_LABEL[f.type] || f.type)}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn sm outline" data-ff-up="${i}" ${
              i === 0 ? 'disabled' : ''
            } title="上移">上移</button>
            <button type="button" class="btn sm outline" data-ff-down="${i}" ${
              i >= formFields.length - 1 ? 'disabled' : ''
            } title="下移">下移</button>
            <button type="button" class="btn sm outline" data-ff-rm="${i}">移除</button>
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label>欄位名稱 *</label>
            <input data-ff-label="${i}" value="${esc(f.label)}" placeholder="例如：請假起日、金額" />
          </div>
          <div class="field">
            <label>欄位類型</label>
            <select data-ff-type="${i}">
              ${Object.entries(FIELD_TYPE_LABEL)
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>提示文字</label>
            <input data-ff-ph="${i}" value="${esc(f.placeholder || '')}" placeholder="選填" />
          </div>
          <div class="field" style="display:flex;align-items:end;padding-bottom:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" data-ff-req="${i}" ${f.required ? 'checked' : ''} />
              必填
            </label>
          </div>
        </div>
        <div class="field ${f.type === 'select' ? '' : 'hidden'}" data-ff-opts-wrap="${i}" style="margin-top:8px">
          <label>下拉選項（每行一個，或用逗號分隔）</label>
          <textarea data-ff-opts="${i}" rows="3" placeholder="事假&#10;病假&#10;特休">${esc(f.optionsText || (f.options || []).join('\n'))}</textarea>
        </div>
      </div>`
      )
      .join('');

    box.querySelectorAll('[data-ff-up]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.ffUp);
        if (i <= 0) return;
        syncFormFieldsFromDom();
        const tmp = formFields[i - 1];
        formFields[i - 1] = formFields[i];
        formFields[i] = tmp;
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-down]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.ffDown);
        if (i >= formFields.length - 1) return;
        syncFormFieldsFromDom();
        const tmp = formFields[i + 1];
        formFields[i + 1] = formFields[i];
        formFields[i] = tmp;
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-rm]').forEach((btn) => {
      btn.onclick = () => {
        syncFormFieldsFromDom();
        formFields.splice(Number(btn.dataset.ffRm), 1);
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-type]').forEach((sel) => {
      sel.onchange = () => {
        const i = Number(sel.dataset.ffType);
        formFields[i].type = sel.value;
        const wrap = document.querySelector(`[data-ff-opts-wrap="${i}"]`);
        if (wrap) wrap.classList.toggle('hidden', sel.value !== 'select');
        const tag = sel.closest('.step-card')?.querySelector('.field-type-tag');
        if (tag) tag.textContent = FIELD_TYPE_LABEL[sel.value] || sel.value;
      };
    });
  };

  const PDF_LAYOUT_OPTIONS = [
    { type: 'auto', label: '依流程名稱自動判斷' },
    { type: 'pdf_template', label: '📄 紙本底圖套印版面（畫布拖拉設計）' },
    { type: 'leave', label: '請假單版面' },
    { type: 'credit_limit', label: '信用額度申請表版面' },
    { type: 'welfare', label: '福利金明細月報表版面' },
    { type: 'purchase', label: '請購申請版面' },
    { type: 'expense', label: '費用報支版面' },
    { type: 'travel', label: '出差申請版面' },
    { type: 'it_repair', label: '電腦異常報修版面' },
    { type: 'overtime', label: '延長工時版面' },
    { type: 'dept_meeting', label: '會議記錄版面' },
    { type: 'general', label: '一般簽呈版面' },
  ];
  let curPdfLayout = workflow?.pdfLayout ? JSON.parse(JSON.stringify(workflow.pdfLayout)) : { type: 'auto' };
  const curPdfType = curPdfLayout.type || 'auto';
  const curFinalNotify = workflow?.finalNotify || {
    enabled: false,
    userIds: [],
    applicantMode: 'all',
    applicantUserIds: [],
    label: '最終核准完成通知',
  };
  const curFinalNotifyIds = new Set(
    (curFinalNotify.userIds || []).map(Number).filter(Boolean)
  );
  const curApplicantMode =
    curFinalNotify.applicantMode === 'selected' ? 'selected' : 'all';
  const curApplicantIds = new Set(
    (curFinalNotify.applicantUserIds || []).map(Number).filter(Boolean)
  );
  // 信用額度預設建議：若未設定過且流程名稱含信用額度，UI 預勾財務相關（不強制）
  const suggestCreditFinance =
    !workflow?.finalNotify &&
    /信用額度|授信額度|額度申請/i.test(String(workflow?.name || ''));
  const isLeaveWorkflowName = /請假|休假|leave/i.test(String(workflow?.name || ''));

  const curCategory = workflow?.category || '一般簽呈';
  const defaultCategories = ['人事差勤', '財務採購', '資訊總務', '業務行政', '一般簽呈'];
  const allKnownCategories = Array.from(
    new Set([
      ...defaultCategories,
      ...(state.workflows || []).map((w) => w.category).filter(Boolean),
      curCategory,
    ])
  );

  openModal(`
    <h3>${workflow && workflow.id ? '編輯流程' : '建立簽核流程'}</h3>
    <form id="wf-form" class="form-grid">
      <div class="field">
        <label>流程名稱 *</label>
        <input name="name" required value="${esc(workflow?.name || '')}" placeholder="例如：請假申請、請購申請" />
        <p class="muted" style="font-size:0.8rem;margin:4px 0 0">若名稱為路徑格式，增刪步驟時會自動同步更新。</p>
      </div>
      <div class="field">
        <label>表單分類 *</label>
        <select id="wf-category-select" style="width:100%">
          ${allKnownCategories
            .map(
              (c) =>
                `<option value="${esc(c)}" ${c === curCategory ? 'selected' : ''}>${esc(c)}</option>`
            )
            .join('')}
          <option value="__custom__">➕ 自訂新分類...</option>
        </select>
        <div id="wf-category-custom-wrap" class="hidden" style="margin-top:6px">
          <input type="text" id="wf-category-custom-inp" placeholder="請輸入新分類名稱，例如：倉儲物流、品保管理" style="width:100%" />
        </div>
        <input type="hidden" name="category" id="wf-category-val" value="${esc(curCategory)}" />
        <p class="muted" style="font-size:0.8rem;margin:4px 0 0">供「新增申請」表單中心分類瀏覽；可直接選擇或自訂新分類。</p>
      </div>
      <div class="field">
        <label>說明（簽核路徑，隨步驟自動更新）</label>
        <input name="description" id="wf-description" value="${esc(workflow?.description || '')}" placeholder="申請人 → …" />
      </div>
      <div class="field">
        <label>啟用狀態</label>
        <label class="switch" style="margin-top:8px">
          <input type="checkbox" name="active" id="wf-active" value="1"
            ${!workflow || workflow.active ? 'checked' : ''} />
          <span class="switch-slider"></span>
          <span class="switch-text" id="wf-active-label">${
            !workflow || workflow.active ? '啟用' : '停用'
          }</span>
        </label>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">開啟＝可在「新增申請」中選擇；關閉＝停用（歷史單據仍可查）。</p>
      </div>
      <div class="field">
        <label>申請單 PDF 排版 *</label>
        <select name="pdfLayoutType" id="wf-pdf-layout">
          ${PDF_LAYOUT_OPTIONS.map(
            (o) =>
              `<option value="${esc(o.type)}" ${curPdfType === o.type ? 'selected' : ''}>${esc(o.label)}</option>`
          ).join('')}
        </select>
        <div id="pdf-template-config-box" class="${curPdfType === 'pdf_template' ? '' : 'hidden'}" style="margin-top:10px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="color:#1e3a5f;">📄 紙本底圖套印設定</strong>
              <div id="pdf-template-status-text" class="muted" style="margin-top:2px;">
                ${curPdfLayout.templateFile ? `已綁定底圖：${curPdfLayout.templateMeta?.originalName || curPdfLayout.templateFile}（${(curPdfLayout.fields || []).length} 個套印欄位）` : '尚未上傳底圖或設計套印欄位'}
              </div>
            </div>
            <button type="button" class="btn sm primary" id="btn-open-pdf-designer">🎨 開啟畫布設計器</button>
          </div>
        </div>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
          與簽核流程一體：匯出／匯入時會一併帶出 PDF 排版，不影響系統設定、Email、使用者。
        </p>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>目前簽核路徑</label>
        <div id="flow-path-preview" style="padding:6px 12px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;color:#1e3a5f;line-height:1.5">
          ${flowChartHtml(workflow?.steps || [], { showLegend: false, flow: workflow?.flow || null })}
          <div class="muted" style="margin-top:6px">${esc(workflow?.description || '申請人')}</div>
        </div>
      </div>
      <div style="grid-column:1/-1;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc">
        <div class="form-section-title" style="margin:0 0 8px">
          <strong>最終核准完成通知（系統內）</strong>
          <span class="field-type-tag">流程模組</span>
        </div>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          ${
            isLeaveWorkflowName
              ? '請假單<strong>最後一步核准</strong>後，以<strong>系統內通知</strong>提醒選定人員<strong>設定 Email 自動回覆</strong>，並請對方點「確認收到」。可再限定哪些申請人的假單才觸發。'
              : '當<strong>最後一步</strong>（例如總經理）核定通過時，在<strong>系統內</strong>通知選定人員，並請對方點<strong>「確認收到通知」</strong>（非 Email）。可指定只有特定申請人的單據才觸發。'
          }
          隨流程匯出／匯入。
        </p>
        <label class="switch" style="margin-bottom:10px">
          <input type="checkbox" id="wf-final-notify-enabled" value="1"
            ${curFinalNotify.enabled || suggestCreditFinance ? 'checked' : ''} />
          <span class="switch-slider"></span>
          <span class="switch-text" id="wf-final-notify-label">${
            curFinalNotify.enabled || suggestCreditFinance
              ? isLeaveWorkflowName
                ? '啟用（設定 Email 自動回覆通知）'
                : '啟用系統內最終通知'
              : '不通知（關閉）'
          }</span>
        </label>
        <div id="wf-final-notify-panel" class="${
          curFinalNotify.enabled || suggestCreditFinance ? '' : 'hidden'
        }">
          <div class="field" style="margin-bottom:10px">
            <label>${
              isLeaveWorkflowName
                ? '被通知人員說明（顯示在待確認畫面）'
                : '通知說明（顯示在待確認畫面）'
            }</label>
            <input type="text" id="wf-final-notify-label-input"
              value="${esc(
                curFinalNotify.label ||
                  (suggestCreditFinance
                    ? '財務部（授信額度建檔）'
                    : isLeaveWorkflowName
                      ? '設定 Email 自動回覆'
                      : '最終核准完成通知')
              )}"
              placeholder="${
                isLeaveWorkflowName
                  ? '設定 Email 自動回覆'
                  : '例如：人資歸檔、財務部建檔'
              }" />
            ${
              isLeaveWorkflowName
                ? `<p class="muted" style="font-size:0.8rem;margin:6px 0 0">請假預設說明：提醒被通知人員為請假同仁設定／確認 <strong>Email 自動回覆</strong>。</p>`
                : ''
            }
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>哪些申請人的單據需要此通知模組？</label>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 8px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="wf-applicant-mode" id="wf-applicant-mode-all" value="all"
                  ${curApplicantMode !== 'selected' ? 'checked' : ''} />
                全部申請人
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="wf-applicant-mode" id="wf-applicant-mode-selected" value="selected"
                  ${curApplicantMode === 'selected' ? 'checked' : ''} />
                僅下列申請人（可多選）
              </label>
            </div>
            <div id="wf-final-notify-applicants-wrap" class="${
              curApplicantMode === 'selected' ? '' : 'hidden'
            }">
              <div id="wf-final-notify-applicants" style="max-height:160px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px">
                ${(users || [])
                  .filter((u) => u.active !== 0)
                  .map((u) => {
                    const checked = curApplicantIds.has(Number(u.id));
                    return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88rem;cursor:pointer">
                      <input type="checkbox" data-final-notify-applicant="${u.id}" ${checked ? 'checked' : ''} />
                      <span>${esc(u.name || u.username)}${u.department ? ` <span class="muted">（${esc(u.department)}）</span>` : ''}</span>
                    </label>`;
                  })
                  .join('') || '<span class="muted">尚無可選使用者</span>'}
              </div>
              <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
                例：請假流程只勾「特定同仁」→ 僅這些人送的假單，最後核准後才通知下方「通知對象」。
              </p>
            </div>
          </div>
          <div class="field">
            <label>${
              isLeaveWorkflowName
                ? '最終被通知人員（請設定 Email 自動回覆）'
                : '通知對象（收件人，可多選）'
            }</label>
            <div id="wf-final-notify-users" style="max-height:180px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px">
              ${(users || [])
                .filter((u) => u.active !== 0)
                .map((u) => {
                  const isFinance =
                    /財務|會計|授信/.test(String(u.department || '')) ||
                    /財務|會計/.test(String(u.name || ''));
                  const checked =
                    curFinalNotifyIds.has(Number(u.id)) ||
                    (suggestCreditFinance && !curFinalNotifyIds.size && isFinance);
                  return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88rem;cursor:pointer">
                    <input type="checkbox" data-final-notify-user="${u.id}" ${checked ? 'checked' : ''} />
                    <span>${esc(u.name || u.username)}${u.department ? ` <span class="muted">（${esc(u.department)}）</span>` : ''}</span>
                  </label>`;
                })
                .join('') || '<span class="muted">尚無可選使用者</span>'}
            </div>
            <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
              ${
                isLeaveWorkflowName
                  ? '假單最終核准後，這些人員會在系統收到待確認，請其<strong>設定 Email 自動回覆</strong>後點「確認收到」。'
                  : '收件人登入後會看到待確認；點「確認收到通知」後才從待辦移除。'
              }
            </p>
          </div>
        </div>
      </div>
      <div>
        <div class="form-section-title">
          <strong>自訂表單欄位</strong>
          <button type="button" class="btn sm outline" id="add-field">＋ 新增欄位</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          建立流程時可一併設計申請表單（文字、數字、日期、下拉、核取等）。
          可用<strong>上移／下移</strong>調整申請單顯示順序（儲存後生效）。
        </p>
        <div class="steps-builder" id="form-fields-box"></div>
      </div>
      <div>
        <div class="form-section-title">
          <strong>簽核步驟（依序）</strong>
          <button type="button" class="btn sm outline" id="add-step">＋ 空白步驟</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          標準層級：<strong>申請人</strong> → 代理人 → 部門主管 → 人事單位 → <strong>副總經理</strong> → <strong>總經理</strong>。<br/>
          下方可<strong>自行新增任何層級</strong>、調整順序、或改簽核人來源；人事單位對應管理部。
        </p>
        <div id="step-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
        <div class="steps-builder" id="steps-box"></div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel').classList.add('wide');
  renderSteps();
  renderFormFields();
  const wfActive = $('#wf-active');
  const wfActiveLabel = $('#wf-active-label');
  if (wfActive && wfActiveLabel) {
    wfActive.addEventListener('change', () => {
      wfActiveLabel.textContent = wfActive.checked ? '啟用' : '停用';
    });
  }

  const catSelect = $('#wf-category-select');
  const catCustomWrap = $('#wf-category-custom-wrap');
  const catCustomInp = $('#wf-category-custom-inp');
  const catVal = $('#wf-category-val');
  if (catSelect && catCustomWrap && catCustomInp && catVal) {
    catSelect.addEventListener('change', () => {
      if (catSelect.value === '__custom__') {
        catCustomWrap.classList.remove('hidden');
        catCustomInp.focus();
        catVal.value = catCustomInp.value.trim();
      } else {
        catCustomWrap.classList.add('hidden');
        catVal.value = catSelect.value;
      }
    });
    catCustomInp.addEventListener('input', () => {
      if (catSelect.value === '__custom__') {
        catVal.value = catCustomInp.value.trim();
      }
    });
  }
  const fnEnabled = $('#wf-final-notify-enabled');
  const fnLabel = $('#wf-final-notify-label');
  const fnPanel = $('#wf-final-notify-panel');
  if (fnEnabled) {
    fnEnabled.addEventListener('change', () => {
      const on = fnEnabled.checked;
      if (fnLabel) {
        fnLabel.textContent = on
          ? isLeaveWorkflowName
            ? '啟用（設定 Email 自動回覆通知）'
            : '啟用系統內最終通知'
          : '不通知（關閉）';
      }
      if (fnPanel) fnPanel.classList.toggle('hidden', !on);
      // 請假：啟用時若說明仍為空白或舊預設，帶入「設定 Email 自動回覆」
      if (on && isLeaveWorkflowName) {
        const inp = document.querySelector('#wf-final-notify-label-input');
        if (
          inp &&
          (!String(inp.value || '').trim() ||
            /^(最終核准完成通知|請假核准完成通知)$/.test(String(inp.value || '').trim()))
        ) {
          inp.value = '設定 Email 自動回覆';
        }
      }
    });
  }
  const syncApplicantModeUi = () => {
    const selected = $('#wf-applicant-mode-selected')?.checked;
    const wrap = $('#wf-final-notify-applicants-wrap');
    if (wrap) wrap.classList.toggle('hidden', !selected);
  };
  document.querySelectorAll('input[name="wf-applicant-mode"]').forEach((r) => {
    r.addEventListener('change', syncApplicantModeUi);
  });
  syncApplicantModeUi();

  const pdfLayoutSel = $('#wf-pdf-layout');
  const templateConfigBox = $('#pdf-template-config-box');
  const templateStatusText = $('#pdf-template-status-text');
  const btnOpenDesigner = $('#btn-open-pdf-designer');

  if (pdfLayoutSel && templateConfigBox) {
    pdfLayoutSel.addEventListener('change', () => {
      const isTemplate = pdfLayoutSel.value === 'pdf_template';
      templateConfigBox.classList.toggle('hidden', !isTemplate);
      if (isTemplate && (!curPdfLayout || curPdfLayout.type !== 'pdf_template')) {
        curPdfLayout = { type: 'pdf_template', fields: [] };
      }
    });
  }

  if (btnOpenDesigner) {
    btnOpenDesigner.addEventListener('click', () => {
      syncStepsFromDom();
      if (!window.PdfFormDesigner) {
        toast('PDF 畫布設計器元件載入中，請稍候重試', 'error');
        return;
      }
      window.PdfFormDesigner.openPdfFormDesignerModal({
        workflow: { ...workflow, steps },
        initialPdfLayout: curPdfLayout,
        onSave: (res) => {
          curPdfLayout = res.pdfLayout;
          if (templateStatusText) {
            templateStatusText.textContent = `已綁定底圖：${curPdfLayout.templateMeta?.originalName || curPdfLayout.templateFile}（${(curPdfLayout.fields || []).length} 個套印欄位）`;
          }
          if (Array.isArray(res.formFields) && res.formFields.length) {
            res.formFields.forEach((cf) => {
              const exist = formFields.find((f) => f.id === cf.id);
              if (!exist) {
                formFields.push(cf);
              } else {
                exist.label = cf.label || exist.label;
                exist.type = cf.type || exist.type;
                exist.required = !!cf.required;
                if (cf.options) exist.options = cf.options;
              }
            });
            renderFormFields();
          }
          toast('紙本底圖模版與欄位已更新', 'success');
        },
      });
    });
  }
  // 常用層級一鍵新增（可任意組合、自行修改）
  const findUserId = (name) => {
    const u = (users || []).find((x) => x.name === name);
    return u ? u.id : null;
  };
  const STEP_PRESETS = [
    {
      label: '代理人',
      step: {
        name: '代理人',
        assignType: 'form_user',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
      ensureAgentField: true,
    },
    {
      label: '部門主管',
      step: {
        name: '部門主管',
        assignType: 'dept_head',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '人事單位',
      step: {
        name: '人事單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '人事單位',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '採購單位',
      step: {
        name: '採購單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '採購部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '財務單位',
      step: {
        name: '財務單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '財務部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '管理部',
      step: {
        name: '管理部',
        assignType: 'department',
        formFieldId: 'agent',
        department: '管理部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '會簽人員（選填）',
      step: {
        name: '會簽人員',
        assignType: 'cosign_pick',
        formFieldId: '',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '副總經理（申請人自選）',
      step: {
        name: '副總經理',
        assignType: 'users_pick',
        formFieldId: 'agent',
        department: '',
        // 預勾：部門或姓名含「副總」者，或帳號 luis / danny
        approverIds: (users || [])
          .filter(
            (u) =>
              /副總/.test(String(u.department || '')) ||
              /副總/.test(String(u.name || '')) ||
              ['luis', 'danny'].includes(String(u.username || '').toLowerCase())
          )
          .map((u) => u.id),
        mode: 'any',
      },
    },
    {
      label: '總經理',
      step: {
        name: '總經理',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: (users || [])
          .filter(
            (u) =>
              /總經理/.test(String(u.department || '')) ||
              /總經理/.test(String(u.name || '')) ||
              String(u.username || '').toLowerCase() === 'martin'
          )
          .map((u) => u.id),
        mode: 'any',
      },
    },
    {
      label: '指定人員',
      step: {
        name: '指定簽核',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
  ];
  const presetDeptSet = new Set(
    STEP_PRESETS.filter((p) => p.step.assignType === 'department').map(
      (p) => p.step.department
    )
  );
  const extraDeptPresets = deptNames
    .filter((name) => name && name !== '人事單位' && !presetDeptSet.has(name))
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hant'))
    .map((name) => ({
      label: name,
      step: {
        name,
        assignType: 'department',
        formFieldId: 'agent',
        department: name,
        approverIds: [],
        mode: 'any',
      },
    }));
  const insertAt = STEP_PRESETS.findIndex((p) => p.label === '會簽人員（選填）');
  if (insertAt >= 0) STEP_PRESETS.splice(insertAt, 0, ...extraDeptPresets);
  else STEP_PRESETS.push(...extraDeptPresets);

  const presetsBox = $('#step-presets');
  if (presetsBox) {
    presetsBox.innerHTML = STEP_PRESETS.map(
      (p, i) =>
        `<button type="button" class="btn sm outline" data-preset="${i}">＋ ${esc(p.label)}</button>`
    ).join('');
    presetsBox.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        syncStepsFromDom();
        syncFormFieldsFromDom();
        const p = STEP_PRESETS[Number(btn.dataset.preset)];
        if (p.ensureAgentField && !formFields.some((f) => f.id === 'agent' || f.type === 'user')) {
          formFields.unshift({
            id: 'agent',
            label: '代理人',
            type: 'user',
            required: true,
            placeholder: '請選擇代理人',
            options: [],
            optionsText: '',
          });
          renderFormFields();
        }
        steps.push(JSON.parse(JSON.stringify(p.step)));
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
  }

  $('#add-step').onclick = () => {
    syncStepsFromDom();
    steps.push({
      name: `步驟 ${steps.length + 1}`,
      assignType: 'users',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      approverFields: [],
    });
    renderSteps();
    syncFlowPathFromSteps();
  };
  $('#add-field').onclick = () => {
    syncFormFieldsFromDom();
    formFields.push(newFormField());
    renderFormFields();
    renderSteps();
  };
  $('#wf-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    syncFormFieldsFromDom();
    syncStepsFromDom();
    for (const f of formFields) {
      if (!String(f.label || '').trim()) {
        toast('請填寫所有表單欄位名稱', 'error');
        return;
      }
      if (f.type === 'select' && !(f.options && f.options.length)) {
        toast(`「${f.label}」請至少設定一個下拉選項`, 'error');
        return;
      }
    }
    for (const s of steps) {
      if (!String(s.name || '').trim()) {
        toast('請填寫所有簽核步驟名稱', 'error');
        return;
      }
      if (
        (s.assignType === 'users' || s.assignType === 'users_pick') &&
        !(s.approverIds && s.approverIds.length)
      ) {
        toast(
          s.assignType === 'users_pick'
            ? `步驟「${s.name}」請勾選可選簽核人名單（申請人將從中選擇）`
            : `步驟「${s.name}」請指定簽核人`,
          'error'
        );
        return;
      }
      if (s.assignType === 'department' && !s.department) {
        toast(`步驟「${s.name}」請選擇單位／部門`, 'error');
        return;
      }
      if (s.assignType === 'form_user') {
        let ff = formFields.find((f) => f.id === s.formFieldId);
        if (!ff) {
          const targetId = s.formFieldId || 'agent';
          const targetLabel = s.name || '指定人員';
          ff = {
            id: targetId,
            label: targetLabel,
            type: 'user',
            required: false,
            placeholder: `請選擇${targetLabel}`,
            options: [],
          };
          formFields.push(ff);
        } else if (ff.type !== 'user') {
          ff.type = 'user';
        }
      }
    }
    // 儲存前依步驟同步說明路徑
    syncFlowPathFromSteps();
    const pathDesc = buildFlowPathText();
    const nameVal = String(fd.get('name') || '').trim() || pathDesc;
    const pdfLayoutType =
      document.querySelector('#wf-pdf-layout')?.value ||
      fd.get('pdfLayoutType') ||
      'auto';
    const finalNotifyEnabled = !!document.querySelector('#wf-final-notify-enabled')?.checked;
    const finalNotifyUserIds = [
      ...document.querySelectorAll('[data-final-notify-user]:checked'),
    ].map((c) => Number(c.dataset.finalNotifyUser || c.value)).filter(Boolean);
    const applicantMode = $('#wf-applicant-mode-selected')?.checked
      ? 'selected'
      : 'all';
    const applicantUserIds = [
      ...document.querySelectorAll('[data-final-notify-applicant]:checked'),
    ]
      .map((c) => Number(c.dataset.finalNotifyApplicant || c.value))
      .filter(Boolean);
    if (finalNotifyEnabled && !finalNotifyUserIds.length) {
      toast('已啟用最終核准通知，請至少勾選一位「通知對象」', 'error');
      return;
    }
    if (finalNotifyEnabled && applicantMode === 'selected' && !applicantUserIds.length) {
      toast('已選「僅下列申請人」，請至少勾選一位申請人', 'error');
      return;
    }

    const catSelectEl = $('#wf-category-select');
    const catCustomInpEl = $('#wf-category-custom-inp');
    let categoryVal = String(fd.get('category') || '').trim();
    if (catSelectEl && catSelectEl.value === '__custom__') {
      const customName = catCustomInpEl ? catCustomInpEl.value.trim() : '';
      if (!customName) {
        toast('請輸入自訂分類名稱', 'error');
        catCustomInpEl?.focus();
        return;
      }
      categoryVal = customName;
    }
    if (!categoryVal) categoryVal = '一般簽呈';

    const payload = {
      name: nameVal,
      category: categoryVal,
      description: pathDesc,
      steps: steps.map((s) => ({
        name: s.name,
        mode: s.mode === 'all' ? 'all' : 'any',
        assignType: s.assignType || 'users',
        formFieldId: s.formFieldId || 'agent',
        department: s.department || '',
        // users / users_pick 都需保存可選簽核人名單
        approverIds:
          s.assignType === 'users' || s.assignType === 'users_pick'
            ? s.approverIds || []
            : [],
        // 保留步驟簽核表單（如人事：剩餘特休）
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
        // 申請人自選：非必填可略過（users_pick）
        skipIfNoApprover:
          s.assignType === 'users_pick' ? !!s.skipIfNoApprover : false,
      })),
      formFields: formFields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder || '',
        options: f.type === 'select' ? f.options || [] : undefined,
      })),
      pdfLayout:
        pdfLayoutType === 'pdf_template'
          ? {
              type: 'pdf_template',
              templateFile: curPdfLayout.templateFile || '',
              templateMeta: curPdfLayout.templateMeta || null,
              fields: curPdfLayout.fields || [],
              formMode: curPdfLayout.formMode || 'paper',
            }
          : { type: String(pdfLayoutType || 'auto') },
      finalNotify: {
        enabled: finalNotifyEnabled,
        userIds: finalNotifyUserIds,
        applicantMode,
        applicantUserIds: applicantMode === 'selected' ? applicantUserIds : [],
        label:
          document.querySelector('#wf-final-notify-label-input')?.value?.trim() ||
          (isLeaveWorkflowName ? '設定 Email 自動回覆' : '最終核准完成通知'),
      },
      active: document.querySelector('#wf-active')?.checked ? 1 : 0,
    };
    try {
      if (workflow && workflow.id) {
        await api(`/api/workflows/${workflow.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/api/workflows', { method: 'POST', body: payload });
      }
      closeModal();
      toast('流程已儲存', 'success');
      navigate('workflows');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (workflow?._autoOpenDesigner) {
    setTimeout(() => {
      $('#btn-open-pdf-designer')?.click();
    }, 150);
  }
}
