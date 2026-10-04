/** 渲染部門主管步驟：自選成員或略過 */
function renderDeptHeadChooserHtml(step) {
  const fieldId = `dept_head_${step.order}`;
  const { deptMembers, others, myDeptLabel } = splitUsersForDeptHeadChooser();
  const opt = (u) =>
    `<option value="${u.id}">${esc(u.name)}${
      u.department ? `（${esc(u.department)}）` : ''
    }</option>`;
  let groups = '';
  if (deptMembers.length) {
    groups += `<optgroup label="同部門成員${myDeptLabel ? `（${esc(myDeptLabel)}）` : ''}">${deptMembers
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (others.length) {
    groups += `<optgroup label="${deptMembers.length ? '其他人員' : '全體人員'}">${others
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (!deptMembers.length && !others.length) {
    groups = `<option value="" disabled>尚無可選人員</option>`;
  }
  return `
    <div class="field" data-dept-head-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '部門主管簽核')}
        <span class="muted" style="font-weight:400">（可指定成員或略過）</span>
      </label>
      <select name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}" data-type="dept_head">
        <option value="skip" selected>不需要經過部門主管（略過此步驟）</option>
        ${groups}
      </select>
    </div>`;
}

/**
 * 會簽人員：申請人可多位勾選，非必填（不勾＝略過）
 * 名單為全體啟用成員（排除本人）
 */
function renderCosignChooserHtml(step) {
  const fieldId = `cosign_${step.order}`;
  const me = state.user?.id;
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  const checks = all
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" data-ff="${esc(fieldId)}" data-type="cosign_pick"
          value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-cosign-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '會簽人員')}
        <span class="muted" style="font-weight:400">（選填・可多選・不勾則略過）</span>
      </label>
      <div class="approver-list" style="margin-top:6px;max-height:220px">
        ${
          checks ||
          '<span class="muted">尚無可選人員</span>'
        }
      </div>
    </div>`;
}

/**
 * 申請人自選簽核人（如副總）：勾選方式（可多位）
 * 候選名單來自步驟 approverIds
 * skipIfNoApprover=true 時為非必填，可不勾選（略過此步驟）
 */
function renderUsersPickChooserHtml(step) {
  const fieldId = `users_pick_${step.order}`;
  const optional = !!step.skipIfNoApprover;
  const poolIds = (step.approverIds || []).map(Number).filter(Boolean);
  const me = state.user?.id;
  const openPool = !poolIds.length && /與會/.test(String(step.name || ''));
  let candidates = (state.users || []).filter(
    (u) =>
      u.active !== 0 &&
      u.id !== me &&
      (openPool || poolIds.includes(u.id))
  );
  // 若 pool 在 state.users 對不到，仍顯示 id
  if (!candidates.length && poolIds.length) {
    candidates = poolIds
      .filter((id) => id !== me)
      .map((id) => ({ id, name: `使用者 #${id}`, department: '' }));
  }
  const modeHintText =
    candidates.length > 1
      ? (step.mode || 'any') === 'all'
        ? '多位需全部核准'
        : '多位任一核准即可'
      : '';
  const stepLabel = step.name || '副總經理簽核';
  const reqMark = optional
    ? ''
    : ' <span style="color:#b91c1c">*</span>';
  const hint = optional
    ? `選填・可不勾選（略過此步驟）・可勾選多位${modeHintText ? '・' + modeHintText : ''}`
    : `必填・可勾選多位${modeHintText ? '・' + modeHintText : ''}`;
  const checks = candidates
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}"
          data-type="users_pick" value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-users-pick-chooser="${esc(fieldId)}" data-users-pick-optional="${optional ? '1' : '0'}" style="grid-column:1/-1">
      <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
        <span style="white-space:nowrap">${esc(stepLabel)}${reqMark}</span>
        <span class="muted" style="font-weight:400;font-size:0.82rem;white-space:nowrap">${hint}</span>
        <button type="button" class="btn sm outline" data-users-pick-all="${esc(fieldId)}">全選</button>
        <button type="button" class="btn sm outline" data-users-pick-none="${esc(fieldId)}">${optional ? '不需此步驟' : '取消全選'}</button>
      </label>
      <div class="approver-list" style="margin-top:0;max-height:280px">
        ${
          candidates.length
            ? checks
            : `<span class="muted">尚無可選簽核人，請聯絡管理員設定流程</span>`
        }
      </div>
    </div>`;
}

/** 綁定副總等 users_pick 全選／取消全選 */
function renderAttendeePickHtml(f, defaults) {
  const me = state.user;
  const selected = new Set(
    String(defaults?.attendee_ids || '')
      .split(/[,，\s]+/)
      .map(Number)
      .filter((n) => n > 0)
  );
  const candidates = (state.users || []).filter(
    (u) => u.active !== 0 && Number(u.id) !== Number(me?.id)
  );
  const checks = candidates
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" name="ff_attendee_ids" data-ff="attendee_ids"
          data-type="attendee_pick" value="${u.id}" ${
            selected.has(Number(u.id)) ? 'checked' : ''
          } />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  const selfName = me?.name || '申請人';
  const selfDept = me?.department ? `（${esc(me.department)}）` : '';
  return `
    <div class="field field-full" data-col-span="full" data-attendee-pick="1" style="grid-column:1/-1">
      <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
        <span>與會人員</span>
        <span class="muted" style="font-weight:400;font-size:0.82rem">申請人固定出席；勾選的人列入出席並須簽核</span>
        <button type="button" class="btn sm outline" data-attendee-all>全選</button>
        <button type="button" class="btn sm outline" data-attendee-none>取消全選</button>
      </label>
      <div class="approver-list" style="margin-top:0;max-height:280px">
        <label class="member-pick-row" style="opacity:0.85">
          <input type="checkbox" checked disabled />
          <span>${esc(selfName)}${selfDept}（申請人）</span>
        </label>
        ${checks || '<span class="muted">尚無可選人員</span>'}
      </div>
    </div>`;
}

function bindAttendeePickChooser(root) {
  if (!root) return;
  root.querySelectorAll('[data-attendee-all]').forEach((btn) => {
    btn.onclick = () => {
      root
        .querySelectorAll('input[data-type="attendee_pick"]')
        .forEach((cb) => {
          cb.checked = true;
        });
    };
  });
  root.querySelectorAll('[data-attendee-none]').forEach((btn) => {
    btn.onclick = () => {
      root
        .querySelectorAll('input[data-type="attendee_pick"]')
        .forEach((cb) => {
          cb.checked = false;
        });
    };
  });
}

function bindUsersPickChooser(root) {
  root.querySelectorAll('[data-users-pick-all]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickAll;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = true;
        });
    };
  });
  root.querySelectorAll('[data-users-pick-none]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickNone;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = false;
        });
    };
  });
}

function welfareCurrentRocYear(formData) {
  const s = String(formData?.period_roc_year || '').trim();
  if (/^\d{2,4}$/.test(s) && Number(s) > 0) return String(Number(s));
  return String(new Date().getFullYear() - 1911);
}

function welfareAutoOpeningSummary(month, year) {
  const m = Number(String(month || '').replace(/[^\d]/g, ''));
  const y = Number(year) || Number(welfareCurrentRocYear());
  if (!m) return '';
  const prevM = m <= 1 ? 12 : m - 1;
  const prevY = m <= 1 ? y - 1 : y;
  return `${prevY}年${prevM}月份結轉`;
}

function parseWelfareItemsClient(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.rows)) return v.rows;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function welfareAmtNumClient(v) {
  const n = Number(String(v ?? '').replace(/[,，\s元萬]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatWelfareAmtClient(v, blankZero = true) {
  const n = welfareAmtNumClient(v);
  if (blankZero && n === 0) return '';
  return Math.round(n).toLocaleString('zh-TW');
}

function renderWelfareItemsViewHtml(value, formData) {
  const items = parseWelfareItemsClient(value);
  const opening = welfareAmtNumClient(formData?.opening_balance);
  let openingSummary = String(formData?.opening_summary || '').trim();
  const year = welfareCurrentRocYear(formData);
  const month = String(formData?.period_month || '').replace(/[^\d]/g, '');
  if (!openingSummary && month) {
    openingSummary = welfareAutoOpeningSummary(month, year);
  }
  let bal = opening;
  let sumIn = 0;
  let sumOut = 0;
  const rows = items
    .map((it) => {
      const dep = welfareAmtNumClient(it.deposit);
      const wd = welfareAmtNumClient(it.withdraw);
      bal += dep - wd;
      sumIn += dep;
      sumOut += wd;
      return `<tr>
        <td>${esc(it.date || '')}</td>
        <td>${esc(it.summary || '')}</td>
        <td style="text-align:right">${esc(formatWelfareAmtClient(dep))}</td>
        <td style="text-align:right">${esc(formatWelfareAmtClient(wd))}</td>
        <td style="text-align:right">${esc(formatWelfareAmtClient(bal, false))}</td>
      </tr>`;
    })
    .join('');
  return `<table class="form-view-table" style="width:100%;min-width:420px">
    <thead><tr>
      <th>日期</th><th>摘要</th><th>存入</th><th>支出</th><th>餘額</th>
    </tr></thead>
    <tbody>
      <tr>
        <td></td>
        <td>${esc(openingSummary || '上月結轉')}</td>
        <td></td><td></td>
        <td style="text-align:right">${esc(formatWelfareAmtClient(opening, false))}</td>
      </tr>
      ${rows}
      <tr>
        <td></td><td><strong>合計</strong></td>
        <td style="text-align:right"><strong>${esc(formatWelfareAmtClient(sumIn, false))}</strong></td>
        <td style="text-align:right"><strong>${esc(formatWelfareAmtClient(sumOut, false))}</strong></td>
        <td style="text-align:right"><strong>${esc(formatWelfareAmtClient(opening + sumIn - sumOut, false))}</strong></td>
      </tr>
    </tbody>
  </table>`;
}

function renderWelfareItemsField(f, defaults = {}) {
  const items = parseWelfareItemsClient(defaults[f.id]);
  const rows =
    items.length > 0
      ? items
      : [
          { date: '', summary: '', deposit: '', withdraw: '' },
          { date: '', summary: '', deposit: '', withdraw: '' },
          { date: '', summary: '', deposit: '', withdraw: '' },
        ];
  const rowHtml = (it, i) => `
    <tr data-welfare-row="${i}">
      <td><input type="date" data-welfare-col="date" value="${esc(it.date || '')}" /></td>
      <td><input type="text" data-welfare-col="summary" size="28" maxlength="80" value="${esc(it.summary || '')}" placeholder="例如：薪資提撥、住院慰問金" /></td>
      <td><input type="number" data-welfare-col="deposit" step="1" min="0" inputmode="decimal" size="8" value="${esc(it.deposit || '')}" /></td>
      <td><input type="number" data-welfare-col="withdraw" step="1" min="0" inputmode="decimal" size="8" value="${esc(it.withdraw || '')}" /></td>
      <td class="welfare-bal" style="text-align:right;padding:6px 8px;white-space:nowrap">—</td>
      <td><button type="button" class="btn sm outline" data-welfare-del="${i}">刪</button></td>
    </tr>`;
  return `<div class="field field-full" data-col-span="full" data-welfare-table="1">
    <label>${esc(f.label || '收支明細')}${f.required ? ' *' : ''}</label>
    <div style="overflow:auto">
      <table class="form-view-table welfare-ledger">
        <thead><tr>
          <th style="width:9rem">日期</th>
          <th>摘要</th>
          <th style="width:8.5rem">存入</th>
          <th style="width:8.5rem">支出</th>
          <th style="width:7.5rem">餘額</th>
          <th style="width:3.2rem"></th>
        </tr></thead>
        <tbody data-welfare-body>
          ${rows.map((it, i) => rowHtml(it, i)).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td></td>
            <td><strong>合計</strong></td>
            <td data-welfare-sum-in style="text-align:right"></td>
            <td data-welfare-sum-out style="text-align:right"></td>
            <td data-welfare-sum-bal style="text-align:right"></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn sm outline" data-welfare-add>＋ 新增一列</button>
      <span class="muted" style="font-size:0.82rem">餘額＝上月結轉＋存入−支出，會自動計算。</span>
    </div>
    <input type="hidden" name="ff_${esc(f.id)}" data-ff="${esc(f.id)}" data-type="table" value="${esc(JSON.stringify(rows))}" />
  </div>`;
}

function syncWelfareLedger(root) {
  const wrap = root?.querySelector?.('[data-welfare-table]') || root;
  if (!wrap || !wrap.matches?.('[data-welfare-table]')) {
    root?.querySelectorAll?.('[data-welfare-table]')?.forEach((w) => syncWelfareLedger(w));
    return;
  }
  const form = wrap.closest('form') || wrap.parentElement;
  const openingEl = form?.querySelector?.('[data-ff="opening_balance"]');
  const opening = welfareAmtNumClient(openingEl?.value);
  let bal = opening;
  let sumIn = 0;
  let sumOut = 0;
  const items = [];
  wrap.querySelectorAll('[data-welfare-row]').forEach((tr) => {
    const date = tr.querySelector('[data-welfare-col="date"]')?.value || '';
    const summary = tr.querySelector('[data-welfare-col="summary"]')?.value || '';
    const deposit = tr.querySelector('[data-welfare-col="deposit"]')?.value || '';
    const withdraw = tr.querySelector('[data-welfare-col="withdraw"]')?.value || '';
    const dep = welfareAmtNumClient(deposit);
    const wd = welfareAmtNumClient(withdraw);
    bal += dep - wd;
    sumIn += dep;
    sumOut += wd;
    const cell = tr.querySelector('.welfare-bal');
    if (cell) cell.textContent = formatWelfareAmtClient(bal, false);
    if (date || summary || deposit || withdraw) {
      items.push({ date, summary, deposit, withdraw });
    }
  });
  const sumInEl = wrap.querySelector('[data-welfare-sum-in]');
  const sumOutEl = wrap.querySelector('[data-welfare-sum-out]');
  const sumBalEl = wrap.querySelector('[data-welfare-sum-bal]');
  if (sumInEl) sumInEl.textContent = formatWelfareAmtClient(sumIn, false);
  if (sumOutEl) sumOutEl.textContent = formatWelfareAmtClient(sumOut, false);
  if (sumBalEl) sumBalEl.textContent = formatWelfareAmtClient(opening + sumIn - sumOut, false);
  const hidden = wrap.querySelector('[data-ff][data-type="table"]');
  if (hidden) hidden.value = JSON.stringify(items);
}

function welfareRowHtml(it, i) {
  return `
    <tr data-welfare-row="${i}">
      <td><input type="date" data-welfare-col="date" value="${esc(it.date || '')}" /></td>
      <td><input type="text" data-welfare-col="summary" size="28" maxlength="80" value="${esc(it.summary || '')}" placeholder="例如：薪資提撥、住院慰問金" /></td>
      <td><input type="number" data-welfare-col="deposit" step="1" min="0" inputmode="decimal" size="8" value="${esc(it.deposit || '')}" /></td>
      <td><input type="number" data-welfare-col="withdraw" step="1" min="0" inputmode="decimal" size="8" value="${esc(it.withdraw || '')}" /></td>
      <td class="welfare-bal" style="text-align:right;padding:6px 8px;white-space:nowrap">—</td>
      <td><button type="button" class="btn sm outline" data-welfare-del>刪</button></td>
    </tr>`;
}

function hydrateWelfareLedger(wrap) {
  if (!wrap) return;
  const hidden = wrap.querySelector('[data-ff][data-type="table"]');
  const body = wrap.querySelector('[data-welfare-body]');
  if (!hidden || !body) return;
  const items = parseWelfareItemsClient(hidden.value);
  const rows = items.length
    ? items
    : [{ date: '', summary: '', deposit: '', withdraw: '' }];
  body.innerHTML = rows.map((it, i) => welfareRowHtml(it, i)).join('');
  syncWelfareLedger(wrap);
}

function layoutWelfarePeriodRow(root) {
  if (!root) return;
  const summary =
    root.querySelector('.welfare-summary-field') ||
    root.querySelector('[data-ff="opening_summary"]')?.closest('.field');
  const month =
    root.querySelector('.welfare-month-field') ||
    root.querySelector('[data-ff="period_month"]')?.closest('.field');
  if (!summary || !month) return;
  if (summary.parentElement?.classList.contains('welfare-period-row')) return;
  const wrap = document.createElement('div');
  wrap.className = 'welfare-period-row';
  summary.parentNode.insertBefore(wrap, summary);
  wrap.appendChild(summary);
  wrap.appendChild(month);
}

function bindWelfarePeriodFields(root) {
  if (!root) return;
  const month = root.querySelector('[data-ff="period_month"]');
  const summary = root.querySelector('[data-ff="opening_summary"]');
  const yearEl = root.querySelector('[data-ff="period_roc_year"]');
  if (!month || !summary) return;
  if (month.dataset.welfarePeriodBound === '1') return;
  month.dataset.welfarePeriodBound = '1';
  const isAuto = (v) =>
    !String(v || '').trim() || /^\d{2,4}年\d{1,2}月份結轉$/.test(String(v).trim());
  month.addEventListener('change', () => {
    if (!isAuto(summary.value)) return;
    summary.value = welfareAutoOpeningSummary(month.value, yearEl?.value);
  });
}

function parseFollowupItemsClient(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function renderFollowupItemsField(f, defaults) {
  let rows = parseFollowupItemsClient(defaults[f.id]);
  if (!rows.length) rows = [{ item: '', owner: '', due: '' }, { item: '', owner: '', due: '' }];
  const rowHtml = (it, i) => `
    <tr data-followup-row="${i}">
      <td><input type="text" data-followup-col="item" value="${esc(it.item || '')}" placeholder="交辦事項" /></td>
      <td><input type="text" data-followup-col="owner" value="${esc(it.owner || '')}" placeholder="承辦人" /></td>
      <td><input type="date" data-followup-col="due" value="${esc(it.due || '')}" /></td>
      <td><button type="button" class="btn sm outline" data-followup-del="${i}">刪</button></td>
    </tr>`;
  return `<div class="field field-full" data-col-span="full" data-followup-table="1">
    <label>${esc(f.label || '後續交辦事項')}${f.required ? ' *' : ''}</label>
    <div style="overflow:auto">
      <table class="form-view-table followup-ledger">
        <thead><tr>
          <th>後續交辦事項</th>
          <th style="width:8rem">承辦人</th>
          <th style="width:9rem">完成期限</th>
          <th style="width:3.2rem"></th>
        </tr></thead>
        <tbody data-followup-body>
          ${rows.map((it, i) => rowHtml(it, i)).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:8px">
      <button type="button" class="btn sm outline" data-followup-add>＋ 新增一列</button>
    </div>
    <input type="hidden" name="ff_${esc(f.id)}" data-ff="${esc(f.id)}" data-type="table" value="${esc(JSON.stringify(rows))}" />
  </div>`;
}

function syncFollowupTable(root) {
  const wrap = root?.querySelector?.('[data-followup-table]') || root;
  if (!wrap || !wrap.matches?.('[data-followup-table]')) {
    root?.querySelectorAll?.('[data-followup-table]')?.forEach((w) => syncFollowupTable(w));
    return;
  }
  const items = [];
  wrap.querySelectorAll('[data-followup-row]').forEach((tr) => {
    const item = tr.querySelector('[data-followup-col="item"]')?.value || '';
    const owner = tr.querySelector('[data-followup-col="owner"]')?.value || '';
    const due = tr.querySelector('[data-followup-col="due"]')?.value || '';
    if (item || owner || due) items.push({ item, owner, due });
  });
  const hidden = wrap.querySelector('[data-ff="followup_items"]');
  if (hidden) hidden.value = JSON.stringify(items);
}

function bindFollowupTable(root) {
  if (!root) return;
  root.querySelectorAll('[data-followup-table]').forEach((wrap) => {
    if (wrap.dataset.followupBound === '1') {
      syncFollowupTable(wrap);
      return;
    }
    wrap.dataset.followupBound = '1';
    wrap.addEventListener('input', () => syncFollowupTable(wrap));
    wrap.addEventListener('change', () => syncFollowupTable(wrap));
    wrap.querySelector('[data-followup-add]')?.addEventListener('click', () => {
      const body = wrap.querySelector('[data-followup-body]');
      if (!body) return;
      const i = body.querySelectorAll('[data-followup-row]').length;
      const tr = document.createElement('tr');
      tr.setAttribute('data-followup-row', String(i));
      tr.innerHTML = `
        <td><input type="text" data-followup-col="item" placeholder="交辦事項" /></td>
        <td><input type="text" data-followup-col="owner" placeholder="承辦人" /></td>
        <td><input type="date" data-followup-col="due" /></td>
        <td><button type="button" class="btn sm outline" data-followup-del="${i}">刪</button></td>`;
      body.appendChild(tr);
      wrap.querySelector(`[data-followup-del="${i}"]`)?.addEventListener('click', () => {
        tr.remove();
        syncFollowupTable(wrap);
      });
      syncFollowupTable(wrap);
    });
    wrap.querySelectorAll('[data-followup-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('[data-followup-row]')?.remove();
        syncFollowupTable(wrap);
      });
    });
    syncFollowupTable(wrap);
  });
}

function bindWelfareLedger(root) {
  if (!root) return;
  root.querySelectorAll('[data-welfare-table]').forEach((wrap) => {
    if (wrap.dataset.welfareBound === '1') {
      syncWelfareLedger(wrap);
      return;
    }
    wrap.dataset.welfareBound = '1';
    wrap.addEventListener('input', () => syncWelfareLedger(wrap));
    wrap.addEventListener('change', () => syncWelfareLedger(wrap));
    wrap.querySelector('[data-welfare-add]')?.addEventListener('click', () => {
      const body = wrap.querySelector('[data-welfare-body]');
      if (!body) return;
      const i = body.querySelectorAll('[data-welfare-row]').length;
      const tr = document.createElement('tr');
      tr.setAttribute('data-welfare-row', String(i));
      tr.innerHTML = `
        <td><input type="date" data-welfare-col="date" value="" /></td>
        <td><input type="text" data-welfare-col="summary" size="28" maxlength="80" value="" placeholder="例如：薪資提撥、住院慰問金" /></td>
        <td><input type="number" data-welfare-col="deposit" step="1" min="0" inputmode="decimal" size="8" value="" /></td>
        <td><input type="number" data-welfare-col="withdraw" step="1" min="0" inputmode="decimal" size="8" value="" /></td>
        <td class="welfare-bal" style="text-align:right;padding:6px 8px;white-space:nowrap">—</td>
        <td><button type="button" class="btn sm outline" data-welfare-del>刪</button></td>`;
      body.appendChild(tr);
      syncWelfareLedger(wrap);
    });
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-welfare-del]');
      if (!btn) return;
      const tr = btn.closest('[data-welfare-row]');
      const body = wrap.querySelector('[data-welfare-body]');
      if (tr && body && body.querySelectorAll('[data-welfare-row]').length > 1) {
        tr.remove();
      } else if (tr) {
        tr.querySelectorAll('input').forEach((inp) => {
          inp.value = '';
        });
      }
      syncWelfareLedger(wrap);
    });
    const form = wrap.closest('form');
    form?.querySelector('[data-ff="opening_balance"]')?.addEventListener('input', () => {
      syncWelfareLedger(wrap);
    });
    syncWelfareLedger(wrap);
  });
}


function isItRepairNoncompliantValue(val) {
  const s = String(val == null ? '' : val);
  return s.includes('不符合') || /低於\s*70/.test(s);
}

const IT_REPAIR_CHECK_IDS = [
  'check_os',
  'check_memory',
  'check_disk',
  'check_3dmark',
  'check_email',
  'check_backup',
  'check_battery',
];

function bindItRepairNoncompliantNote(root) {
  if (!root) return;
  const syncOne = (id) => {
    const sel = root.querySelector(`[data-ff="${id}"]`);
    const note = root.querySelector(`[data-ff="${id}_note"]`);
    if (!note) return;
    const wrap = note.closest('.field');
    const ng = !!(sel && isItRepairNoncompliantValue(sel.value));
    if (wrap) wrap.style.display = ng ? '' : 'none';
    if (ng) note.setAttribute('required', 'required');
    else note.removeAttribute('required');
    const lab = wrap?.querySelector('label');
    if (lab) {
      const base = (lab.dataset.baseLabel || lab.textContent || '')
        .replace(/\s*\*\s*$/, '')
        .trim();
      lab.dataset.baseLabel = base;
      lab.textContent = ng ? `${base} *` : base;
    }
  };
  IT_REPAIR_CHECK_IDS.forEach((id) => {
    syncOne(id);
    root.querySelector(`[data-ff="${id}"]`)?.addEventListener('change', () => syncOne(id));
  });
}

function renderDynamicFieldHtml(f, defaults = {}, opts = {}) {
  const req = f.required ? ' *' : '';
  const reqAttr = f.required ? 'required' : '';
  const ph = f.placeholder ? esc(f.placeholder) : '';
  const name = `ff_${esc(f.id)}`;
  const defVal =
    defaults[f.id] != null && defaults[f.id] !== ''
      ? String(defaults[f.id])
      : '';
  if (f.id === 'void_target_id') {
    return `<div class="field field-full" data-void-target-field="1">
      <label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="void_target_id" ${reqAttr}>
        <option value="${esc(defVal)}">${
          defVal ? `已選 #${esc(defVal)}` : '載入已核准申請單…'
        }</option>
      </select>
      <p class="muted" style="font-size:0.82rem;margin:4px 0 0">
        選定後，簽核流程會改為該單<strong>實際簽核人</strong>依序再簽；全部通過後原單自動改為已作廢。
      </p>
      <div id="void-flow-preview" style="margin-top:10px"></div>
    </div>`;
  }
  if (f.id === 'followup_items') {
    return renderFollowupItemsField(f, defaults);
  }
  if (f.id === 'attendees') return '';
  if (f.id === 'attendee_ids') {
    return renderAttendeePickHtml(f, defaults);
  }
  if (f.id === 'period_roc_year') {
    const y = String(defVal || welfareCurrentRocYear()).trim() || welfareCurrentRocYear();
    return `<input type="hidden" name="${name}" data-ff="period_roc_year" value="${esc(y)}" />`;
  }
  if (f.type === 'table' || f.id === 'welfare_items') {
    return renderWelfareItemsField(f, defaults);
  }
  // 手續費方式：併入「手續費」欄位 UI，不單獨顯示
  if (f.id === 'handling_fee_mode') {
    return '';
  }
  // 請購：手續費＝文字 + 內扣／外加（勾選，二選一）
  if (f.id === 'handling_fee') {
    const modeRaw =
      defaults.handling_fee_mode != null && defaults.handling_fee_mode !== ''
        ? String(defaults.handling_fee_mode)
        : '';
    const mode =
      modeRaw === '內扣' || modeRaw === '外加'
        ? modeRaw
        : /內扣/.test(modeRaw)
          ? '內扣'
          : /外加/.test(modeRaw)
            ? '外加'
            : '';
    return `<div class="field" data-handling-fee-field="1">
      <label>${esc(f.label || '手續費')}${req}</label>
      <div class="handling-fee-row" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <input type="text" name="${name}" data-ff="handling_fee" ${reqAttr}
          placeholder="${ph || '金額或說明'}" value="${esc(defVal)}"
          style="flex:1 1 7rem;min-width:6rem" />
        <label style="display:inline-flex;align-items:center;gap:4px;margin:0;cursor:pointer;white-space:nowrap">
          <input type="checkbox" data-handling-fee-mode="內扣" ${
            mode === '內扣' ? 'checked' : ''
          } /> 內扣
        </label>
        <label style="display:inline-flex;align-items:center;gap:4px;margin:0;cursor:pointer;white-space:nowrap">
          <input type="checkbox" data-handling-fee-mode="外加" ${
            mode === '外加' ? 'checked' : ''
          } /> 外加
        </label>
        <input type="hidden" name="ff_handling_fee_mode" data-ff="handling_fee_mode"
          value="${esc(mode)}" />
      </div>
      <div class="muted field-hint">可填金額／說明，並勾選內扣或外加（二選一）</div>
      <div class="fee-calc-summary-badge" id="handling-fee-calc-summary" style="display:none"></div>
    </div>`;
  }
  // 請假／電腦異常報修：不使用富文字／自繪表格
  const allowRich = opts.enableRich !== false;
  if (f.type === 'textarea') {
    // 說明／事由等：Word 式富文字（顏色、字級、表格、可貼上）
    // 請假、電腦異常報修整份表單關閉（enableRich: false）
    const useRich =
      allowRich &&
      !/作廢/.test(String(f.label || '')) &&
      f.id !== 'check_noncompliant_note' &&
      !/_note$/.test(String(f.id || '')) &&
      (/說明|事由|用途|內容|備註|主旨|廠商/.test(String(f.label || '')) ||
        f.id === 'subject' ||
        f.id === 'reason' ||
        f.id === 'purpose' ||
        f.id === 'desc');
    // 舊版 __table 物件轉提示（合併顯示於初始 HTML）
    let initial = defVal;
    const legacyTable = defaults[`${f.id}__table`];
    if (
      useRich &&
      legacyTable &&
      typeof legacyTable === 'object' &&
      Array.isArray(legacyTable.cells)
    ) {
      const rows = legacyTable.cells
        .map(
          (row, ri) =>
            `<tr>${(row || [])
              .map((c) => {
                const tag = ri === 0 ? 'th' : 'td';
                return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
              })
              .join('')}</tr>`
        )
        .join('');
      const tbl = `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      if (initial && !/<table/i.test(initial)) {
        initial =
          (typeof RichEditor !== 'undefined'
            ? RichEditor.plainToHtml(initial)
            : esc(initial).replace(/\n/g, '<br>')) + tbl;
      } else if (!initial) {
        initial = tbl;
      }
    }
    // 請假等純文字：若誤存 HTML，顯示為純文字
    if (!useRich && typeof RichEditor !== 'undefined' && RichEditor.isProbablyHtml(initial)) {
      initial = RichEditor.htmlToPlain(initial);
    }
    const taRows = useRich ? 5 : opts.compactTextarea ? 2 : 3;
    return `<div class="field field-full" data-col-span="full">
      <label>${esc(f.label)}${req}</label>
      <textarea name="${name}" data-ff="${esc(f.id)}" ${useRich ? 'data-rich="1"' : ''}
        ${reqAttr} placeholder="${
          useRich
            ? ph || '可輸入文字、設定顏色／字級、插入或貼上表格…'
            : ph || ''
        }"
        rows="${taRows}">${esc(initial)}</textarea>
      ${
        useRich
          ? `<div class="muted field-hint">支援粗體／顏色／字級／插入表格；可從 Word、Excel 直接貼上</div>`
          : ''
      }
    </div>`;
  }
  if (f.type === 'select') {
    let selected = defVal;
    if ((f.id === 'period_month' || f.id === 'submit_month') && !selected) {
      const m = String(new Date().getMonth() + 1);
      const optsList = (f.options || []).map((o) => String(o));
      selected = optsList.includes(`${m}月`) ? `${m}月` : m;
    }
    if (f.id === 'submit_year' && !selected) {
      const yAd = String(new Date().getFullYear());
      const yRoc = String(new Date().getFullYear() - 1911);
      const optsList = (f.options || []).map((o) => String(o));
      selected = optsList.includes(yAd)
        ? yAd
        : optsList.includes(yRoc)
          ? yRoc
          : yAd;
    }
    const opts = (f.options || [])
      .map(
        (o) =>
          `<option value="${esc(o)}" ${selected === String(o) ? 'selected' : ''}>${esc(o)}</option>`
      )
      .join('');
    const monthClass = f.id === 'period_month' ? ' welfare-month-field' : '';
    return `<div class="field${monthClass}"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" ${reqAttr}>
        <option value="">請選擇…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'user') {
    const me = state.user?.id;
    // 請假職務代理人（agent）可選本人；其餘人員欄位仍排除自己
    const allowSelf =
      f.id === 'agent' || /代理/.test(String(f.label || '') + String(f.id || ''));
    const opts = (state.users || [])
      .filter((u) => u.active !== 0 && (allowSelf || u.id !== me))
      .map(
        (u) =>
          `<option value="${u.id}" ${defVal === String(u.id) ? 'selected' : ''}>${esc(u.name)}${
            u.department ? `（${esc(u.department)}）` : ''
          }${
            allowSelf && Number(u.id) === Number(me) ? '（本人）' : ''
          }</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" data-type="user" ${reqAttr}>
        <option value="">請選擇人員…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'datetime') {
    // 請假：09:00～17:30；延長工時／實際工時：00:00～24:00（全日）；其餘：00:00～23:30
    const isLeaveRange = f.id === 'start_date' || f.id === 'end_date';
    const isOtRange =
      f.id === 'ot_start' ||
      f.id === 'ot_end' ||
      f.id === 'actual_start' ||
      f.id === 'actual_end' ||
      /延長工時|實際工時/.test(String(f.label || ''));
    const isEnd =
      f.id === 'end_date' ||
      f.id === 'ot_end' ||
      f.id === 'actual_end' ||
      /結束|迄/.test(String(f.label || ''));
    const tStart = isLeaveRange
      ? WORK_TIME_START
      : isOtRange
        ? OT_TIME_START
        : '00:00';
    const tEnd = isLeaveRange
      ? WORK_TIME_END
      : isOtRange
        ? OT_TIME_END
        : '23:30';
    const defaultTime = isEnd
      ? isLeaveRange
        ? WORK_TIME_END
        : isOtRange
          ? OT_DEFAULT_END
          : '18:00'
      : isLeaveRange
        ? WORK_TIME_START
        : isOtRange
          ? OT_DEFAULT_START
          : '18:00';
    const parts = parseDateTimeParts('', defaultTime);
    const selTime = clampWorkTime(parts.time, defaultTime, tStart, tEnd);
    // 日期時間：多欄模式下佔 1～2 欄；延長工時起迄並排
    const dtSpan = isOtRange ? '1' : '2';
    const compactHint = opts.compactHints || isOtRange;
    return `<div class="field${dtSpan === '2' ? ' field-span-2' : ''}" data-col-span="${dtSpan}">
      <label>${esc(f.label)}${req}</label>
      <div class="datetime-row" data-datetime-field="${esc(f.id)}">
        <input type="date" data-ff-date="${esc(f.id)}" ${reqAttr} title="日期" />
        <select data-ff-time="${esc(f.id)}" ${reqAttr}
          title="時間 ${tStart}～${tEnd}（每 30 分鐘）"
          data-default-time="${defaultTime}">
          ${halfHourTimeOptions(selTime, { start: tStart, end: tEnd })}
        </select>
      </div>
      <input type="hidden" name="${name}" data-ff="${esc(f.id)}" data-type="datetime" value="" />
      ${
        compactHint
          ? `<div class="muted field-hint">${tStart}～${tEnd} · 每 30 分</div>`
          : `<div class="muted field-hint">可選時間 ${tStart}～${tEnd}（每 30 分鐘）</div>`
      }
    </div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" name="${name}" data-ff="${esc(f.id)}" data-type="checkbox" ${reqAttr} />
        ${esc(f.label)}${req}
      </label></div>`;
  }
  const type = ['number', 'date'].includes(f.type) ? f.type : 'text';
  let filled = defVal;
  if (f.id === 'opening_summary' && !filled) {
    filled = welfareAutoOpeningSummary(
      defaults.period_month || String(new Date().getMonth() + 1),
      welfareCurrentRocYear(defaults)
    );
  }
  if (f.id === 'report_date' && !filled) {
    const d = new Date();
    filled = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const valAttr = filled !== '' ? ` value="${esc(filled)}"` : '';
  // 天數／小時：最小單位 0.5（避免瀏覽器 step 預設為 1 導致 22.5 被拒）
  const isHalfStep =
    f.type === 'number' &&
    (f.id === 'hours' ||
      f.id === 'days' ||
      f.id === 'actual_hours' ||
      f.id === 'comp_leave_balance' ||
      f.id === 'remaining_special_leave_days' ||
      f.id === 'remaining_special_leave_hours' ||
      /小時|天數|時數/.test(String(f.label || '')));
  const halfHint = isHalfStep
    ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">最小單位 0.5（例：0、0.5、1、3.5、7.5、22.5）</div>`
    : '';
  if (type === 'number' && isHalfStep) {
    const numHint = opts.compactHints
      ? `<div class="muted field-hint">最小 0.5</div>`
      : halfHint;
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <input type="number" name="${name}" data-ff="${esc(f.id)}" data-half-step="1"
        step="0.5" min="0" inputmode="decimal" ${reqAttr}
        placeholder="${ph}"${valAttr} />
      ${numHint}
    </div>`;
  }
  const extraClass = f.id === 'opening_summary' ? ' welfare-summary-field' : '';
  const isAmountFx =
    f.type === 'number' &&
    (f.id === 'amount' || f.id === 'budget' || /預估金額|金額|費用/.test(String(f.label || '')));
  const numStep = isAmountFx ? '0.0001' : type === 'number' ? 'any' : '';
  const numAttrs =
    type === 'number'
      ? ` step="${numStep}" inputmode="decimal"${isAmountFx ? ' data-amount-fx="1"' : ''}`
      : '';
  const amountHint = isAmountFx
    ? `<div class="muted field-hint" data-amount-fx-hint>外幣可至小數 4 位</div>
       <div class="amount-cn-preview" data-amount-cn="${esc(f.id)}"></div>
       <div class="tax-calc-toolbar" data-tax-toolbar="${esc(f.id)}">
         <button type="button" class="tax-btn tax-btn-add" data-tax-action="add" title="以目前金額為未稅，加 5% 營業稅換算為含稅總額">🧮 ＋5% 稅 (含稅)</button>
         <button type="button" class="tax-btn tax-btn-sub" data-tax-action="sub" title="以目前金額為含稅，反推 5% 營業稅算出未稅金額">🧮 －5% 稅 (未稅)</button>
         <span class="tax-calc-hint" data-tax-hint="${esc(f.id)}"></span>
       </div>`
    : '';
  return `<div class="field${extraClass}"><label>${esc(f.label)}${req}</label>
    <input type="${type}" name="${name}" data-ff="${esc(f.id)}" ${reqAttr}
      placeholder="${ph}"${valAttr}${numAttrs} />
    ${amountHint}
  </div>`;
}

/** 對齊 0.5 單位（小時／天數） */
function snapHalfUnit(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 2) / 2);
}

/** 請購／支付手續費：內扣／外加二選一勾選與動態試算 */
function bindHandlingFeeMode(root) {
  if (!root) return;
  root.querySelectorAll('[data-handling-fee-field]').forEach((box) => {
    const hidden = box.querySelector('[data-ff="handling_fee_mode"]');
    const boxes = [...box.querySelectorAll('[data-handling-fee-mode]')];
    const feeInp = box.querySelector('[data-ff="handling_fee"]');
    const summaryEl = box.querySelector('#handling-fee-calc-summary');
    if (!hidden || !boxes.length) return;

    const calcSummary = () => {
      if (!summaryEl) return;
      const mode = String(hidden.value || '').trim();
      const amountInp = root.querySelector('[data-ff="amount"]');
      const amt = Number(amountInp?.value || 0);
      const feeNum = Number(String(feeInp?.value || '').replace(/[^\d.]/g, ''));

      if (amt > 0 && feeNum > 0 && (mode === '內扣' || mode === '外加')) {
        summaryEl.style.display = 'flex';
        if (mode === '內扣') {
          const net = Math.max(0, amt - feeNum);
          summaryEl.innerHTML = `💡 <strong>支付算定：</strong> 申請金額 $${amt.toLocaleString()} － 內扣手續費 $${feeNum.toLocaleString()} ＝ <strong>實付撥款 $${net.toLocaleString()}</strong>`;
        } else {
          const total = amt + feeNum;
          summaryEl.innerHTML = `💡 <strong>支付算定：</strong> 受款金額 $${amt.toLocaleString()} ＋ 外加手續費 $${feeNum.toLocaleString()} ＝ <strong>公司支出總計 $${total.toLocaleString()}</strong>`;
        }
      } else {
        summaryEl.style.display = 'none';
        summaryEl.innerHTML = '';
      }
    };

    const syncFromHidden = () => {
      const v = String(hidden.value || '');
      boxes.forEach((cb) => {
        cb.checked = cb.getAttribute('data-handling-fee-mode') === v;
      });
      calcSummary();
    };

    boxes.forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) {
          boxes.forEach((o) => {
            if (o !== cb) o.checked = false;
          });
          hidden.value = cb.getAttribute('data-handling-fee-mode') || '';
        } else {
          // 取消勾選＝不選
          hidden.value = '';
        }
        calcSummary();
      };
    });

    if (feeInp) feeInp.addEventListener('input', calcSummary);
    const amountInp = root.querySelector('[data-ff="amount"]');
    if (amountInp && !amountInp.dataset.feeBound) {
      amountInp.dataset.feeBound = '1';
      amountInp.addEventListener('input', calcSummary);
    }
    hidden.addEventListener('change', calcSummary);

    syncFromHidden();
  });
}

function voidStepsPathText(steps) {
  const names = (steps || []).map((s) => String(s.name || '').trim()).filter(Boolean);
  return names.length ? `申請人送出 → ${names.join(' → ')} → 原單自動作廢` : '';
}

async function bindVoidTargetPicker(root, previewEl, workflow) {
  const sel = root?.querySelector('[data-ff="void_target_id"]');
  if (!sel) return;
  const box = root.querySelector('#void-flow-preview');
  const current = String(sel.value || '');
  try {
    const data = await api('/api/requests/void-targets');
    const list = data.requests || [];
    if (!list.length) {
      sel.innerHTML = '<option value="">目前沒有可作廢的已核准申請</option>';
      if (box) box.innerHTML = '';
      return;
    }
    sel.innerHTML =
      `<option value="">請選擇已核准申請單…</option>` +
      list
        .map((r) => {
          const when = String(r.completed_at || '').slice(0, 16);
          const label = `#${r.id}　${r.title}${
            r.requester_name ? `（${r.requester_name}）` : ''
          }${when ? `　${when}` : ''}`;
          return `<option value="${r.id}" ${
            String(r.id) === current ? 'selected' : ''
          }>${esc(label)}</option>`;
        })
        .join('');
  } catch (e) {
    sel.innerHTML = `<option value="">載入失敗：${esc(e.message || '')}</option>`;
    return;
  }

  const renderPreview = async () => {
    const id = Number(sel.value);
    if (!id) {
      if (box) box.innerHTML = '';
      if (previewEl) {
        previewEl.innerHTML = `<div class="muted">${esc(
          workflow?.description || '請先選擇欲作廢的已核准申請單，簽核人將依原單帶入。'
        )}</div>`;
      }
      return;
    }
    try {
      const p = await api(`/api/requests/${id}/void-preview`);
      const steps = p.steps || [];
      const html = `
        <div class="muted" style="margin-bottom:6px">此作廢申請將由原單簽核人依序核准：</div>
        ${flowChartHtml(steps, { showLegend: false })}
        <div class="muted" style="margin-top:6px">${esc(voidStepsPathText(steps))}</div>`;
      if (box) box.innerHTML = html;
      if (previewEl) previewEl.innerHTML = html;
    } catch (e) {
      if (box) box.innerHTML = `<div class="error-msg">${esc(e.message || '無法預覽')}</div>`;
    }
  };
  sel.onchange = renderPreview;
  if (sel.value) renderPreview();
}

/**
 * 將 textarea 的值同步到富文字編輯表面（草稿回填後必做，否則畫面空白且再存會蓋成空）
 */
function syncRichEditorSurfacesFromTextareas(root) {
  if (!root || typeof RichEditor === 'undefined') return;
  root.querySelectorAll('textarea[data-rich="1"]').forEach((ta) => {
    const fid = ta.dataset.ff;
    if (!fid) return;
    const surface =
      root.querySelector(`[data-re-surface="${fid}"]`) ||
      root.querySelector(`.rich-editor[data-rich-for="${fid}"] [data-re-surface]`);
    if (!surface) return;
    const raw = ta.value || '';
    const html = RichEditor.plainToHtml(raw);
    surface.innerHTML = html && String(html).trim() ? html : '<div><br></div>';
    const clean = RichEditor.sanitizeHtml(surface.innerHTML);
    const plain = RichEditor.htmlToPlain(clean).trim();
    if (!plain && !/<table/i.test(clean)) {
      ta.value = '';
      surface.classList.add('re-empty');
    } else {
      ta.value = clean;
      surface.classList.remove('re-empty');
    }
  });
}

/**
 * 請假最小計算單位（與後端 labor.getLeaveMinUnit 一致）
 * 補休／公假／公傷／病假 → 0.5 小時
 * 事假 → 天數與小時各自填寫，不自動換算
 * 特休 → 0.5 日
 * 產假／喪假／曠職 → 1 日
 */
const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5, noConvert: true },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};
const WORK_DAY_HOURS_CLIENT = 7.5;

function matchLeaveTypeIdClient(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (/特別休假|特休/.test(t) && !/不休假|代金/.test(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
  // 公傷須先於病假（避免「公傷病假」命中病假）
  if (/公傷/.test(t)) return 'occupational';
  if (/住院/.test(t)) return 'hospital';
  if (/普通傷病|病假/.test(t)) return 'sick';
  if (/事假/.test(t)) return 'personal';
  if (/婚假/.test(t)) return 'marriage';
  if (/祭儀/.test(t)) return 'ritual';
  if (/喪假|喪葬/.test(t)) return 'funeral';
  if (/產假|分娩/.test(t) && !/陪產|產檢/.test(t)) return 'maternity';
  if (/產檢/.test(t) && !/陪產/.test(t)) return 'prenatal';
  if (/安胎/.test(t)) return 'tocolysis';
  if (/陪產/.test(t)) return 'paternity';
  if (/生理/.test(t)) return 'menstrual';
  if (/家庭照顧|家照/.test(t)) return 'family';
  if (/公假/.test(t)) return 'official';
  if (/補休|調休/.test(t)) return 'comp';
  return 'other';
}

function getLeaveMinUnitClient(typeName) {
  const id = matchLeaveTypeIdClient(typeName);
  const base = LEAVE_MIN_UNIT_BY_ID[id] || { unit: 'day', step: 0.5 };
  const label =
    base.unit === 'hour' ? `${base.step} 小時` : `${base.step} 日`;
  return { id, unit: base.unit, step: base.step, noConvert: !!base.noConvert, label };
}

function snapToStepClient(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return 0;
  if (!Number.isFinite(s) || s <= 0) return x;
  return Math.round((Math.round(x / s) * s) * 1000) / 1000;
}

/** 依假別對齊天數／小時（試算與手動修改） */
function applyLeaveMinUnitClient(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnitClient(leaveType);
  let days = Number(daysIn);
  let hours = Number(hoursIn);
  if (!Number.isFinite(days) || days < 0) days = 0;
  if (!Number.isFinite(hours) || hours < 0) hours = 0;

  if (rule.noConvert || rule.id === 'personal') {
    let d = days;
    let h = hours;
    if (h > 0) h = snapToStepClient(h, 0.5);
    if (d > 0) d = snapToStepClient(d, 0.5);
    return { days: d, hours: h, rule };
  }
  if (rule.unit === 'hour') {
    let h = hours > 0 ? hours : days * WORK_DAY_HOURS_CLIENT;
    h = snapToStepClient(h, rule.step);
    if (h > 0 && h < rule.step) h = rule.step;
    return {
      days: Math.round((h / WORK_DAY_HOURS_CLIENT) * 1000) / 1000,
      hours: h,
      rule,
    };
  }
  let d = days > 0 ? days : hours / WORK_DAY_HOURS_CLIENT;
  d = snapToStepClient(d, rule.step);
  if (d > 0 && d < rule.step) d = rule.step;
  // 特休：只以日計，不換算／填寫小時
  if (rule.id === 'special') {
    return { days: d, hours: 0, rule };
  }
  return {
    days: d,
    hours: snapToStepClient(d * WORK_DAY_HOURS_CLIENT, 0.5),
    rule,
  };
}

function leaveUnitHintText(leaveType) {
  const rule = getLeaveMinUnitClient(leaveType);
  if (rule.id === 'special') {
    return `此假別（特休）最小單位 0.5 日，以日計算，不換算小時`;
  }
  if (rule.noConvert || rule.id === 'personal') {
    return `事假不自動以 7.5 小時換算天數；天數與小時各自填寫（最小 0.5）`;
  }
  if (rule.unit === 'hour') {
    return `此假別最小單位 ${rule.label}（以小時為準；全日＝7.5 小時）。例：0.5、1、1.5、3.5、7.5 小時`;
  }
  if (rule.step === 1) {
    return `此假別最小單位 1 日（僅能請整天，不可半日／小時）`;
  }
  return `此假別最小單位 0.5 日（例：0.5、1、1.5 日；全日＝7.5 小時）`;
}

function rocToAdYearClient(y) {
  const n = Number(y);
  if (Number.isFinite(n) && n >= 1 && n <= 200) return n + 1911;
  return n;
}

function parseLeaveDateTimeClient(val) {
  const s = String(val || '').trim().replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  const y = rocToAdYearClient(Number(m[1]));
  const hh = m[4] != null ? Number(m[4]) : 9;
  const mm = m[5] != null ? Number(m[5]) : 0;
  return new Date(y, Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0);
}

function formatLeaveTitlePeriodClient(start, end) {
  const one = (val) => {
    const raw = String(val || '').trim();
    if (!raw) return '';
    const dt = parseLeaveDateTimeClient(raw);
    if (!dt || Number.isNaN(dt.getTime())) return raw.replace('T', ' ').slice(0, 16);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const hasTime = /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(raw);
    return hasTime ? `${y}-${mo}-${d} ${hh}:${mm}` : `${y}-${mo}-${d}`;
  };
  const a = one(start);
  const b = one(end);
  if (a && b && a.slice(0, 10) === b.slice(0, 10) && b.length > 11) {
    return `${a}～${b.slice(11)}`;
  }
  return [a, b].filter(Boolean).join('～');
}

function snapHalfHourClient(h) {
  if (!Number.isFinite(h) || h <= 0) return 0;
  let x = Math.round(h * 2) / 2;
  if (x > 0 && x < 0.5) x = 0.5;
  return x;
}

function personalLeavePortionOnDayClient(dateKey, rangeStart, rangeEnd) {
  const [y, mo, d] = String(dateKey).split('-').map(Number);
  if (!y || !mo || !d) return { days: 0, hours: 0 };
  const at = (hh, mm) => new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  const dayStart = at(9, 0);
  const amEnd = at(12, 30);
  const lunchEnd = at(13, 30);
  const dayEnd = at(17, 30);
  const from = Math.max(rangeStart, dayStart);
  const to = Math.min(rangeEnd, dayEnd);
  if (!(to > from)) return { days: 0, hours: 0 };
  if (from <= dayStart && to >= dayEnd) return { days: 1, hours: 0 };
  let days = 0;
  let hours = 0;
  const amFrom = Math.max(from, dayStart);
  const amTo = Math.min(to, amEnd);
  if (amTo > amFrom) {
    if (from <= dayStart && to >= amEnd) days += 0.5;
    else hours += snapHalfHourClient((amTo - amFrom) / 3600000);
  }
  const pmFrom = Math.max(from, lunchEnd);
  const pmTo = Math.min(to, dayEnd);
  if (pmTo > pmFrom) {
    if (from <= lunchEnd && to >= dayEnd) days += 0.5;
    else hours += snapHalfHourClient((pmTo - pmFrom) / 3600000);
  }
  return { days, hours };
}

/** 事假顯示：09:00～12:30 → 0.5 天；到 15:00 → 0.5 天＋1.5 小時；到 17:30 → 1 天 */
function computePersonalLeaveDisplay(formData) {
  const start = parseLeaveDateTimeClient(formData?.start_date);
  const end = parseLeaveDateTimeClient(formData?.end_date);
  if (!start || !end || end < start) return null;
  const isWorkday = (key) => {
    if (typeof TwCalendar !== 'undefined' && typeof TwCalendar.isWorkday === 'function') {
      return TwCalendar.isWorkday(key);
    }
    const dt = parseLeaveDateTimeClient(`${key}T09:00`);
    if (!dt) return true;
    const w = dt.getDay();
    return w !== 0 && w !== 6;
  };
  let days = 0;
  let hours = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(
      cur.getDate()
    ).padStart(2, '0')}`;
    if (isWorkday(key)) {
      const p = personalLeavePortionOnDayClient(key, start.getTime(), end.getTime());
      days += p.days;
      hours += p.hours;
    }
    cur.setDate(cur.getDate() + 1);
  }
  hours = snapHalfHourClient(hours);
  days = Math.round(days * 2) / 2;
  if (!days && !hours) return null;
  const text =
    days && hours
      ? `${days} 天又 ${hours} 小時`
      : days
        ? `${days} 天`
        : `${hours} 小時`;
  return { days, hours, text };
}

function formatSickLeaveDisplayText(days, hours) {
  if (days) return `${days}日`;
  if (hours) return `${hours}小時`;
  return '';
}

function computeSickLeaveDisplay(formData) {
  const base = computePersonalLeaveDisplay(formData);
  if (!base) return null;
  const text = formatSickLeaveDisplayText(base.days, base.hours);
  if (!text) return null;
  return { days: base.days, hours: base.hours, text };
}

/**
 * 解析日期時間（支援 24:00＝當日結束／次日 00:00）
 * @returns {Date|null}
 */
function parseOtDateTime(val) {
  if (!val) return null;
  const m = String(val)
    .trim()
    .replace(' ', 'T')
    .match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(5, 7)) - 1;
  const d = Number(m[1].slice(8, 10));
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // 24:00 → 次日 00:00
  if (hh === 24 && mm === 0) {
    const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * 延長工時時數：結束−開始，對齊 0.5 小時
 * @returns {number|null} 無效或結束≤開始時回傳 null
 */
function calcOvertimeHours(startStr, endStr) {
  const a = parseOtDateTime(startStr);
  const b = parseOtDateTime(endStr);
  if (!a || !b) return null;
  if (b.getTime() <= a.getTime()) return null;
  let h = (b.getTime() - a.getTime()) / 3600000;
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  return h;
}

/**
 * 綁定起迄時間 → 時數自動換算
 * @param {HTMLElement} root
 * @param {{ startId: string, endId: string, hoursId: string, hintId?: string, hintText?: string }} cfg
 */
function bindHoursAutoCalc(root, cfg) {
  if (!root || !cfg) return;
  const { startId, endId, hoursId, hintId, hintText } = cfg;
  const startDate = root.querySelector(`[data-ff-date="${startId}"]`);
  const startTime = root.querySelector(`[data-ff-time="${startId}"]`);
  const endDate = root.querySelector(`[data-ff-date="${endId}"]`);
  const endTime = root.querySelector(`[data-ff-time="${endId}"]`);
  const hoursInp = root.querySelector(`[data-ff="${hoursId}"]`);
  if (!hoursInp || (!startDate && !startTime && !endDate && !endTime)) return;

  // 時數改為唯讀自動帶入（仍可後端驗證）
  hoursInp.readOnly = true;
  hoursInp.title = '依起迄時間自動換算（最小 0.5 小時）';
  hoursInp.placeholder = '依起迄自動換算';
  if (hoursInp.hasAttribute('required')) {
    // 保持 required，送出前會寫入值
  }

  let hint = hintId ? root.querySelector(`#${hintId}`) : null;
  const hintHost = hoursInp.parentElement;
  if (hintHost && hintId && !hint) {
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'muted';
    hint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
    hint.textContent =
      hintText ||
      '時數依開始／結束自動換算（00:00～24:00 全日，最小 0.5 小時／30 分鐘）';
    hintHost.appendChild(hint);
  }

  const recalc = () => {
    syncDateTimeHidden(root, startId);
    syncDateTimeHidden(root, endId);
    const a = root.querySelector(`[data-ff="${startId}"]`)?.value;
    const b = root.querySelector(`[data-ff="${endId}"]`)?.value;
    if (!a || !b) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent =
          hintText ||
          '時數依開始／結束自動換算（00:00～24:00 全日，最小 0.5 小時／30 分鐘）';
      }
      return;
    }
    const h = calcOvertimeHours(a, b);
    if (h == null) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent = '結束時間須晚於開始時間，才能換算時數';
        hint.style.color = '#b45309';
      }
      return;
    }
    hoursInp.value = snapHalfUnit(h);
    if (hint) {
      hint.style.color = '';
      const st = a.slice(11, 16);
      const et = b.slice(11, 16);
      const sameDay = a.slice(0, 10) === b.slice(0, 10);
      hint.textContent = sameDay
        ? `自動換算：${st}～${et}＝${h} 小時（最小單位 0.5）`
        : `自動換算：${a.slice(0, 16).replace('T', ' ')}～${b
            .slice(0, 16)
            .replace('T', ' ')}＝${h} 小時`;
    }
  };

  [startDate, startTime, endDate, endTime].forEach((el) => {
    if (el) el.addEventListener('change', recalc);
  });
  // 初次若已有值則試算
  recalc();
}

/** 假別顯示用短名：祭儀假、病假、特休… */
function shortLeaveTypeLabel(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypeClient(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

function isSickLeaveTypeClient(type) {
  const t = String(type || '');
  if (/公傷|住院/.test(t)) return false;
  return /普通傷病假|病假/.test(t);
}

/** 更新欄位 label，保留必填 * 標記 */
function setFieldLabelText(inputEl, text) {
  const lab = inputEl?.closest('.field')?.querySelector('label');
  if (!lab) return;
  const hadReq = !!lab.querySelector('.req') || !!inputEl?.required;
  lab.textContent = '';
  lab.appendChild(document.createTextNode(text));
  if (hadReq) {
    lab.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = 'req';
    sp.textContent = '*';
    lab.appendChild(sp);
  }
}

/**
 * 人事簽核：假別（人事核定）變更時
 * - 標籤改為「剩餘{假別}日數（目前／核准後）」
 * - 特休：自動帶入剩餘日數（核准後＝目前−本單）；不再使用／換算小時
 * - 非特休：數值留白，不帶入
 * - 隱藏「剩餘特休小時」欄（若流程定義仍殘留）
 */
function bindSalesGrossAutoCalc(root) {
  if (!root) return;
  const rev = root.querySelector('[data-ff="sales_revenue"]');
  const cost = root.querySelector('[data-ff="sales_cost"]');
  const profit = root.querySelector('[data-ff="sales_gross_profit"]');
  if (!rev || !cost || !profit) return;
  if (profit.dataset.salesGrossBound === '1') return;
  profit.dataset.salesGrossBound = '1';
  const num = (el) => {
    const n = Number(String(el.value || '').replace(/[,，\s元萬]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const sync = () => {
    if (profit.dataset.manual === '1') return;
    profit.value = String(Math.round(num(rev) - num(cost)));
  };
  rev.addEventListener('input', sync);
  cost.addEventListener('input', sync);
  profit.addEventListener('input', () => {
    profit.dataset.manual = '1';
  });
}

function bindHrLeaveTypeAutoRemain(root, labor) {
  if (!root || !labor) return;
  const typeSel = root.querySelector('[data-ff="hr_leave_type"]');
  const daysInp = root.querySelector('[data-ff="remaining_special_leave_days"]');
  const hoursInp = root.querySelector(
    '[data-ff="remaining_special_leave_hours"]'
  );
  // 特休不以小時計算：隱藏殘留的小時欄
  if (hoursInp) {
    const wrap = hoursInp.closest('.field');
    if (wrap) wrap.classList.add('hidden');
    hoursInp.required = false;
    hoursInp.value = '';
    hoursInp.removeAttribute('name');
  }
  if (!typeSel || !daysInp) return;

  // 確保下拉含全部假別選項
  const opts =
    Array.isArray(labor.leaveTypeOptions) && labor.leaveTypeOptions.length
      ? labor.leaveTypeOptions
      : labor.remainByLeaveType
        ? Object.keys(labor.remainByLeaveType)
        : [];
  if (opts.length && typeSel.tagName === 'SELECT') {
    const cur = typeSel.value || labor.leaveType || '';
    const existing = new Set(
      [...typeSel.options].map((o) => o.value).filter(Boolean)
    );
    opts.forEach((opt) => {
      if (!existing.has(opt)) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        typeSel.appendChild(o);
      }
    });
    if (cur && !existing.has(cur) && !opts.includes(cur)) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      typeSel.appendChild(o);
    }
    if (cur) typeSel.value = cur;
  }

  const applyRemain = () => {
    const t = typeSel.value || '';
    const isSpecial = isSpecialLeaveTypeClient(t);
    const shortName = shortLeaveTypeLabel(t);
    let days = '';

    if (isSpecial) {
      const map = labor.remainByLeaveType || {};
      if (map[t] && map[t].days !== '' && map[t].days != null) {
        days = map[t].days ?? '';
      } else {
        const before = Number(labor.remainingBefore);
        const thisDays = Number(labor.thisLeaveDays);
        let remain = Number.isFinite(before) ? before : null;
        if (remain != null && Number.isFinite(thisDays) && thisDays > 0) {
          remain = Math.round((remain - thisDays) * 2) / 2;
        }
        if (remain != null) {
          remain = Math.max(0, remain);
          days = String(remain);
        }
      }
    }
    // 非特休：強制留白

    if (daysInp) {
      daysInp.value = isSpecial ? days : '';
      daysInp.required = isSpecial;
      daysInp.placeholder = isSpecial
        ? '例如：7 或 7.5（核准後剩餘日數）'
        : '非特休可留白';
      daysInp.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 標籤依假別變動（僅日數，不換算小時）
    const dayLabel = isSpecial
      ? `剩餘${shortName}日數（核准後）`
      : `剩餘${shortName}日數（目前）`;
    if (daysInp) setFieldLabelText(daysInp, dayLabel);
  };

  typeSel.addEventListener('change', applyRemain);
  applyRemain();
}

/** 人事簽核：申請人特休剩餘提示區塊 */
function renderApplicantLaborBanner(labor, request) {
  if (!labor) return '';
  const sl = labor.specialLeave || {};
  const thisDays = labor.thisLeaveDays;
  const after =
    labor.remainingAfter != null
      ? labor.remainingAfter
      : labor.suggestRemainingDays;
  const warnAfter = after != null && after < 0;
  const entitled = sl.entitled ?? 0;
  return `
    <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
      <strong>申請人特休（成員名單手動可休）</strong>
      <div style="margin-top:8px;font-size:0.9rem;line-height:1.55">
        <div>申請人：${esc(request.requester_name || '')}${
          request.requester_dept ? `（${esc(request.requester_dept)}）` : ''
        }</div>
        <div>到職日：${esc(labor.hireDate || '未設定')}${
          labor.seniority?.label ? ` · 年資：${esc(labor.seniority.label)}（僅顯示）` : ''
        }</div>
        <div>統計年度：${esc(sl.yearLabel || '—')}</div>
        <div>
          可休 <strong>${entitled}</strong> 日（手動）·
          已休 ${sl.used ?? '—'} 日
          ${
            sl.manualUsedDays
              ? `（含手動 ${sl.manualUsedDays || 0} 日）`
              : ''
          } ·
          目前剩餘 <strong style="color:#15803d">${
            labor.remainingBefore != null ? labor.remainingBefore : sl.remaining ?? '—'
          }</strong> 日
        </div>
        ${
          entitled === 0
            ? `<div class="muted" style="margin-top:4px">可休為 0：請至「成員名單」手動填寫特休可休天數。</div>`
            : ''
        }
        ${
          labor.thisIsSpecial && thisDays != null
            ? `<div>
                本單特休申請 <strong>${thisDays}</strong> 日 →
                核准後剩餘
                <strong style="color:${warnAfter ? '#b91c1c' : '#15803d'}">${after}</strong> 日
                ${warnAfter ? '（已超休，請確認）' : '（已自動填入下方「剩餘特休日數」）'}
              </div>`
            : labor.leaveType
              ? `<div>本單假別：${esc(labor.leaveType)}${
                  thisDays != null ? ` · ${thisDays} 日` : ''
                }（非特休時，剩餘欄位可留白）</div>`
              : ''
        }
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
        特休以<strong>日</strong>計算（不換算小時）。可休日數由成員名單手動設定；統計年度為曆年制（1/1～12/31）。實際給假以人事核定為準。
      </p>
    </div>`;
}

function syncDateTimeHidden(root, fieldId) {
  const dateEl = root.querySelector(`[data-ff-date="${fieldId}"]`);
  const timeEl = root.querySelector(`[data-ff-time="${fieldId}"]`);
  const hidden = root.querySelector(
    `[data-ff="${fieldId}"][data-type="datetime"]`
  );
  if (!hidden) return;
  // 日期＋時間：寫入 ISO 風格供後端驗證
  // 僅有日期時（草稿常見）：仍保留日期，時間用預設或 00:00，避免存草稿後遺失
  if (dateEl?.value && timeEl?.value) {
    hidden.value = `${dateEl.value}T${timeEl.value}`;
  } else if (dateEl?.value) {
    const fallback =
      timeEl?.getAttribute('data-default-time') ||
      timeEl?.value ||
      '09:00';
    if (timeEl && !timeEl.value && fallback) {
      // 對齊選項
      const has = [...(timeEl.options || [])].some((o) => o.value === fallback);
      timeEl.value = has ? fallback : timeEl.options?.[0]?.value || fallback;
    }
    const t = timeEl?.value || fallback;
    hidden.value = `${dateEl.value}T${t}`;
  } else {
    hidden.value = '';
  }
}

function bindDateTimeFields(root) {
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    const id = wrap.dataset.datetimeField;
    const dateEl = wrap.querySelector(`[data-ff-date="${id}"]`);
    const timeEl = wrap.querySelector(`[data-ff-time="${id}"]`);
    const onChange = () => syncDateTimeHidden(root, id);
    if (dateEl) dateEl.addEventListener('change', onChange);
    if (timeEl) timeEl.addEventListener('change', onChange);
    onChange();
  });
}

/** 正規化自繪表格資料 */
function normalizeFormTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  let cells = obj.cells;
  if (!Array.isArray(cells) || !cells.length) return null;
  cells = cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(
    1,
    ...cells.map((r) => r.length),
    Number(obj.cols) || 0
  );
  cells = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  // 全空白表格視為無
  const hasContent = cells.some((r) => r.some((c) => String(c).trim()));
  if (!hasContent) return null;
  return {
    rows: cells.length,
    cols,
    header: obj.header !== false,
    cells,
  };
}

function emptyFormTable(rows = 3, cols = 3) {
  const r = Math.min(20, Math.max(1, Number(rows) || 3));
  const c = Math.min(10, Math.max(1, Number(cols) || 3));
  return {
    rows: r,
    cols: c,
    header: true,
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  };
}

/** 數字轉中文大寫金額（新臺幣） */
function numberToChineseCurrency(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return '';
  const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '萬', '億', '兆'];

  let integerPart = Math.floor(n);
  if (integerPart === 0) return '零元整';
  if (integerPart > 999999999999) return `新臺幣 ${integerPart.toLocaleString()} 元整`;

  let str = '';
  let bigIdx = 0;
  while (integerPart > 0) {
    const chunk = integerPart % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let zero = false;
      const cStr = String(chunk).padStart(4, '0');
      for (let i = 0; i < 4; i++) {
        const d = Number(cStr[i]);
        const u = 3 - i;
        if (d > 0) {
          if (zero) chunkStr += '零';
          chunkStr += digits[d] + units[u];
          zero = false;
        } else if (chunkStr) {
          zero = true;
        }
      }
      str = chunkStr + bigUnits[bigIdx] + str;
    }
    integerPart = Math.floor(integerPart / 10000);
    bigIdx++;
  }
  return `新臺幣 ${str}元整`;
}

/** 綁定表單中之金額欄位：中文大寫預覽、5% 營業稅快算與單價自動換算 */
function bindAmountCalculators(root) {
  if (!root) return;
  root.querySelectorAll('[data-amount-fx="1"], [data-ff="amount"]').forEach((input) => {
    if (input.dataset.calcBound === '1') return;
    input.dataset.calcBound = '1';

    const fieldBox = input.closest('.field') || input.parentElement;
    const previewEl = fieldBox?.querySelector('.amount-cn-preview');
    const toolbarEl = fieldBox?.querySelector('.tax-calc-toolbar');
    const hintEl = toolbarEl?.querySelector('.tax-calc-hint');

    const updateCalc = () => {
      const val = Number(input.value);
      if (previewEl) {
        if (Number.isFinite(val) && val > 0) {
          previewEl.textContent = numberToChineseCurrency(val);
        } else {
          previewEl.textContent = '';
        }
      }
      // 若同表單內有數量 qty，自動試算換算單價
      const qtyInp = root.querySelector('[data-ff="qty"]');
      if (qtyInp && hintEl) {
        const q = Number(qtyInp.value);
        if (q > 0 && val > 0) {
          const unitP = Math.round((val / q) * 100) / 100;
          hintEl.textContent = `（約單價 $${unitP.toLocaleString()} / 單位）`;
        }
      }
    };

    input.addEventListener('input', updateCalc);

    // 數量變更連動觸發
    const qtyInp = root.querySelector('[data-ff="qty"]');
    if (qtyInp && !qtyInp.dataset.qtyBound) {
      qtyInp.dataset.qtyBound = '1';
      qtyInp.addEventListener('input', updateCalc);
    }

    if (toolbarEl) {
      toolbarEl.querySelectorAll('[data-tax-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.dataset.taxAction;
          const curVal = Number(input.value);
          if (!Number.isFinite(curVal) || curVal <= 0) {
            if (hintEl) hintEl.textContent = '請先填入數值再試算';
            return;
          }
          if (action === 'add') {
            const tax = Math.round(curVal * 0.05);
            const total = curVal + tax;
            input.value = total;
            if (hintEl) {
              hintEl.textContent = `原未稅 $${curVal.toLocaleString()} ＋ 5% 營業稅 $${tax.toLocaleString()} ＝ 含稅 $${total.toLocaleString()}`;
            }
          } else if (action === 'sub') {
            const untaxed = Math.round(curVal / 1.05);
            const tax = curVal - untaxed;
            input.value = untaxed;
            if (hintEl) {
              hintEl.textContent = `原含稅 $${curVal.toLocaleString()} － 5% 營業稅 $${tax.toLocaleString()} ＝ 未稅 $${untaxed.toLocaleString()}`;
            }
          }
          updateCalc();
          // 手續費連動計算
          const feeHidden = root.querySelector('[data-ff="handling_fee_mode"]');
          if (feeHidden) feeHidden.dispatchEvent(new Event('change'));
        });
      });
    }

    updateCalc();
  });
}

if (typeof window !== 'undefined') {
  window.numberToChineseCurrency = numberToChineseCurrency;
  window.bindAmountCalculators = bindAmountCalculators;
}

