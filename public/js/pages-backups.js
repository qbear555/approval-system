async function renderBackups(body) {
  if (!canAccessBackupsPage()) {
    body.innerHTML = `<div class="error-msg">您沒有備份資料或人事請假相關權限</div>`;
    return;
  }

  const canFullBackup = hasPerm('backups');
  const canLeaveDl = canDownloadLeaveForms();
  let meta = { departments: [], workflows: [], years: [], total: 0, encrypt: {} };
  if (canFullBackup) {
    try {
      const data = await api('/api/backups/meta');
      meta = data.meta || meta;
    } catch (e) {
      toast(e.message, 'error');
    }
  } else if (canLeaveDl) {
    try {
      const data = await api('/api/backups/leave-forms-meta');
      meta.departments = data.departments || [];
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const deptOpts = (meta.departments || [])
    .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`)
    .join('');
  const wfOpts = (meta.workflows || [])
    .map((w) => `<option value="${esc(w)}">${esc(w)}</option>`)
    .join('');
  const yearOpts = (meta.years || [])
    .map((y) => `<option value="${esc(y)}">${esc(y)}</option>`)
    .join('');
  const monthOpts = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return `<option value="${m}">${m}</option>`;
  }).join('');

  const STATUS_OPT = [
    ['approved', '已核准'],
    ['all', '全部狀態'],
    ['pending', '簽核中'],
    ['rejected', '已駁回'],
    ['cancelled', '已取消'],
    ['voided', '已作廢'],
  ];

  const now = new Date();
  const ytdFrom = `${now.getFullYear()}-01-01`;
  const ytdTo = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const enc = meta.encrypt || {};
  const encNote = enc.ready
    ? `<span style="color:#15803d">已啟用 AES-256 加密</span>（一律存加密 ZIP；請用 7-Zip 等工具以系統設定密碼解壓）`
    : enc.enabled && !enc.hasPass
      ? `<span style="color:#b45309">已勾選加密但尚未設定密碼</span> — 請至「系統設定 → 備份加密」設定後再備份`
      : `未加密。可於「系統設定 → 備份加密」啟用 AES-256 密碼保護`;

  const leaveCard = canLeaveDl
    ? `
    <div class="card" style="margin-bottom:16px;border-color:#bfdbfe;background:#f8fbff">
      <h3 style="margin-top:0">人事：查詢／下載請假申請單</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        條件查詢<strong>僅請假申請</strong>，勾選後下載 PDF ZIP；亦可全選後一次下載。單次最多 500 筆。
      </p>
      <form id="leave-forms-query-form" class="form-grid two">
        <div class="field"><label>請假期間起 *</label>
          <input type="date" name="date_from" required value="${esc(ytdFrom)}" /></div>
        <div class="field"><label>請假期間迄 *</label>
          <input type="date" name="date_to" required value="${esc(ytdTo)}" /></div>
        <div class="field"><label>狀態</label>
          <select name="status">
            ${STATUS_OPT.map(([v, l]) => `<option value="${v}"${v === 'approved' ? ' selected' : ''}>${l}</option>`).join('')}
          </select></div>
        <div class="field"><label>部門（選填）</label>
          <select name="department"><option value="">全部部門</option>${deptOpts}</select></div>
        <div class="field"><label>假別（選填）</label>
          <input name="leave_type" placeholder="例如：事假、特休" maxlength="40" /></div>
        <div class="field"><label>關鍵字（選填）</label>
          <input name="keyword" placeholder="姓名／帳號／單號／主旨" maxlength="80" /></div>
        <div class="form-actions" style="grid-column:1/-1;flex-wrap:wrap;gap:8px">
          <button type="submit" class="btn primary" id="btn-leave-forms-query">查詢請假單</button>
          <button type="button" class="btn outline" id="btn-leave-forms-reset">清除條件</button>
        </div>
      </form>
      <div id="leave-forms-list" style="margin-top:14px"><div class="muted">請先設定條件後按「查詢請假單」。</div></div>
      <div id="leave-forms-dl-result" class="muted" style="margin-top:8px"></div>
    </div>`
    : '';

  if (!canFullBackup) {
    body.innerHTML =
      leaveCard +
      (canLeaveDl
        ? `<p class="muted">您目前僅有人事請假權限，可使用上方「查詢／下載請假申請單」。完整備份需「備份資料」權限。</p>`
        : '');
    bindLeaveFormsUi({ ytdFrom, ytdTo });
    return;
  }

  body.innerHTML = `
    ${leaveCard}
    <div class="card">
      <h3 style="margin-top:0">執行備份</h3>
      <p class="muted" style="margin-top:0">
        備份目錄：<strong>部門 / 申請表單類別 / 年月</strong>。<br/>
        無附件時存 <strong>PDF</strong>；有上傳附件時存 <strong>ZIP</strong>（簽核單 PDF + 附件資料夾）。<br/>
        加密：${encNote}。<br/>
        目前已備份 <strong>${meta.total || 0}</strong> 筆。
      </p>
      <form id="backup-run-form" class="form-grid two">
        <div class="field">
          <label>備份狀態</label>
          <select name="status">
            ${STATUS_OPT.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>部門（選填）</label>
          <select name="department">
            <option value="">全部部門</option>
            ${deptOpts}
          </select>
        </div>
        <div class="field">
          <label>申請表單類別（選填）</label>
          <select name="workflow_name">
            <option value="">全部表單</option>
            ${wfOpts}
          </select>
        </div>
        <div class="field">
          <label>強制覆寫既有備份</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer">
            <input type="checkbox" name="force" /> 是（重新產生 PDF）
          </label>
        </div>
        <div class="field">
          <label>起始日期（選填）</label>
          <input type="date" name="date_from" />
        </div>
        <div class="field">
          <label>結束日期（選填）</label>
          <input type="date" name="date_to" />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary" id="btn-run-backup">開始備份</button>
        </div>
      </form>
      <div id="backup-run-result" class="muted" style="margin-top:8px"></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">查詢備份</h3>
      <form id="backup-query-form" class="form-grid two">
        <div class="field">
          <label>部門</label>
          <select name="department">
            <option value="">全部</option>
            ${deptOpts}
          </select>
        </div>
        <div class="field">
          <label>申請表單類別</label>
          <select name="workflow_name">
            <option value="">全部</option>
            ${wfOpts}
          </select>
        </div>
        <div class="field">
          <label>年</label>
          <select name="year">
            <option value="">全部</option>
            ${yearOpts}
          </select>
        </div>
        <div class="field">
          <label>月</label>
          <select name="month">
            <option value="">全部</option>
            ${monthOpts}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>關鍵字（主旨／申請人／單號）</label>
          <input name="keyword" placeholder="例如：請假、張祖銘、6" />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">查詢</button>
          <button type="button" class="btn outline" id="btn-backup-reset">清除條件</button>
        </div>
      </form>
      <div id="backup-list" style="margin-top:12px">
        <div class="muted">請按「查詢」載入備份清單。</div>
      </div>
    </div>
  `;

  const STATUS_MAP = {
    draft: '草稿',
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
    voided: '已作廢',
  };

  const canDeleteBackup = isAdmin();

  async function loadList(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    const box = $('#backup-list');
    box.innerHTML = `<div class="muted">載入中…</div>`;
    try {
      const { backups } = await api(`/api/backups?${q.toString()}`);
      if (!backups.length) {
        box.innerHTML = emptyState({
          title: '沒有符合條件的備份',
          desc: '請調整篩選條件，或先執行備份作業產生檔案。',
        });
        return;
      }
      box.innerHTML = `
        ${
          canDeleteBackup
            ? `<div class="form-actions" style="margin-bottom:10px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" id="chk-all-backups" /> 全選
                </label>
                <button type="button" class="btn danger sm" id="btn-bulk-del-backups">刪除選取</button>
                <span class="muted" id="backup-sel-count">已選 0 筆</span>
              </div>`
            : ''
        }
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                ${canDeleteBackup ? '<th style="width:40px"></th>' : ''}
                <th>單號</th><th>部門</th><th>表單類別</th><th>年月</th>
                <th>主旨</th><th>申請人</th><th>狀態</th><th>備份時間</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${backups
                .map(
                  (b) => `
                <tr>
                  ${
                    canDeleteBackup
                      ? `<td><input type="checkbox" data-backup-check value="${b.id}" /></td>`
                      : ''
                  }
                  <td>#${b.request_id}</td>
                  <td>${esc(b.department)}</td>
                  <td>${esc(b.workflow_name)}</td>
                  <td>${esc(b.period_year)}-${esc(b.period_month)}</td>
                  <td>${esc(b.title)}</td>
                  <td>${esc(b.requester_name)}</td>
                  <td>${esc(STATUS_MAP[b.status] || b.status)}</td>
                  <td class="muted">${esc(b.created_at)}</td>
                  <td style="white-space:nowrap">
                    <button type="button" class="btn sm primary" data-dl="${b.id}" data-fname="${esc(b.file_name || '')}">
                      ${/\.zip$/i.test(b.file_name || '') ? '下載 ZIP' : '下載 PDF'}
                    </button>
                    ${
                      canDeleteBackup
                        ? `<button type="button" class="btn sm danger" data-del-backup="${b.id}">刪除</button>`
                        : ''
                    }
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:8px">路徑規則：部門 / 表單類別 / 年月 / 檔名.pdf（共 ${backups.length} 筆）${
          canDeleteBackup ? '。系統管理員可刪除備份。' : ''
        }</p>`;
      box.querySelectorAll('[data-dl]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const blob = await api(`/api/backups/${btn.dataset.dl}/download`);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const fname = btn.dataset.fname || '';
            const isZip = /\.zip$/i.test(fname) || blob.type.includes('zip');
            a.download =
              fname ||
              (isZip
                ? `backup-${btn.dataset.dl}.zip`
                : `backup-${btn.dataset.dl}.pdf`);
            a.click();
            URL.revokeObjectURL(url);
            toast(isZip ? 'ZIP 已開始下載（含 PDF 與附件）' : 'PDF 已開始下載', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        };
      });
      if (canDeleteBackup) {
        const updateSel = () => {
          const n = [...box.querySelectorAll('input[data-backup-check]:checked')].length;
          const el = $('#backup-sel-count');
          if (el) el.textContent = `已選 ${n} 筆`;
        };
        $('#chk-all-backups')?.addEventListener('change', (e) => {
          box.querySelectorAll('input[data-backup-check]').forEach((c) => {
            c.checked = e.target.checked;
          });
          updateSel();
        });
        box.querySelectorAll('input[data-backup-check]').forEach((c) => {
          c.onchange = updateSel;
        });
        box.querySelectorAll('[data-del-backup]').forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm(`確定刪除此備份 PDF？\n（不會刪除原始簽核單據）`)) return;
            try {
              await api(`/api/backups/${btn.dataset.delBackup}`, { method: 'DELETE' });
              toast('已刪除備份', 'success');
              await loadList(params);
            } catch (e) {
              toast(e.message, 'error');
            }
          };
        });
        $('#btn-bulk-del-backups')?.addEventListener('click', async () => {
          const ids = [...box.querySelectorAll('input[data-backup-check]:checked')].map((c) =>
            Number(c.value)
          );
          if (!ids.length) {
            toast('請先勾選要刪除的備份', 'error');
            return;
          }
          if (!confirm(`確定刪除選取的 ${ids.length} 筆備份 PDF？`)) return;
          try {
            const data = await api('/api/backups/bulk-delete', {
              method: 'POST',
              body: { ids },
            });
            toast(data.message || '已批次刪除', 'success');
            await loadList(params);
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      }
    } catch (e) {
      box.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
    }
  }

  $('#backup-run-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      status: fd.get('status'),
      department: fd.get('department') || '',
      workflow_name: fd.get('workflow_name') || '',
      date_from: fd.get('date_from') || '',
      date_to: fd.get('date_to') || '',
      force: !!fd.get('force'),
    };
    const btn = $('#btn-run-backup');
    const out = $('#backup-run-result');
    btn.disabled = true;
    out.textContent = '備份進行中，請稍候…';
    try {
      const { result } = await api('/api/backups/run', { method: 'POST', body: payload });
      out.innerHTML = `完成：成功 <strong>${result.success}</strong>、略過（已存在） <strong>${result.skipped}</strong>、失敗 <strong>${result.failed}</strong>（共掃描 ${result.total} 筆）`;
      if (result.errors?.length) {
        out.innerHTML += `<div class="error-msg" style="margin-top:8px">${result.errors
          .slice(0, 5)
          .map((x) => `#${x.request_id}: ${esc(x.error)}`)
          .join('<br/>')}</div>`;
      }
      toast('備份作業完成', 'success');
      await loadList({});
    } catch (err) {
      out.textContent = '';
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

  $('#backup-query-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await loadList({
      department: fd.get('department'),
      workflow_name: fd.get('workflow_name'),
      year: fd.get('year'),
      month: fd.get('month'),
      keyword: fd.get('keyword'),
    });
  };
  $('#btn-backup-reset').onclick = () => {
    $('#backup-query-form').reset();
    loadList({});
  };

  bindLeaveFormsUi({ ytdFrom, ytdTo });

  // 預設載入全部
  await loadList({});
}

/** 人事：請假申請單條件查詢／勾選／全選下載 */
function bindLeaveFormsUi({ ytdFrom, ytdTo }) {
  if (!$('#leave-forms-query-form')) return;
  const STATUS_LEAVE = {
    draft: '草稿',
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
    voided: '已作廢',
  };
  let lastLeaveItems = [];

  function updateLeaveSelCount() {
    const n = [
      ...document.querySelectorAll('#leave-forms-list input[data-leave-check]:checked'),
    ].length;
    const el = $('#leave-sel-count');
    if (el) el.textContent = `已選 ${n} / ${lastLeaveItems.length} 筆`;
    const all = $('#chk-all-leave-forms');
    if (all && lastLeaveItems.length) {
      const checked = [
        ...document.querySelectorAll('#leave-forms-list input[data-leave-check]'),
      ];
      all.checked = checked.length > 0 && checked.every((c) => c.checked);
      all.indeterminate =
        checked.some((c) => c.checked) && !checked.every((c) => c.checked);
    }
  }

  function renderLeaveList(items) {
    const box = $('#leave-forms-list');
    if (!box) return;
    lastLeaveItems = items || [];
    if (!lastLeaveItems.length) {
      box.innerHTML = emptyState({
        title: '沒有符合條件的請假單',
        desc: '請調整期間、部門、狀態或關鍵字後再查詢。',
      });
      return;
    }
    box.innerHTML = `
      <div class="form-actions" style="margin-bottom:10px;flex-wrap:wrap;align-items:center;gap:8px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="chk-all-leave-forms" checked /> 全選
        </label>
        <button type="button" class="btn primary sm" id="btn-leave-dl-selected">下載選取（ZIP）</button>
        <button type="button" class="btn outline sm" id="btn-leave-dl-all">下載本頁全部</button>
        <span class="muted" id="leave-sel-count">已選 ${lastLeaveItems.length} / ${lastLeaveItems.length} 筆</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th>單號</th><th>申請人</th><th>部門</th><th>假別</th>
              <th>請假起</th><th>請假迄</th><th>天／時</th><th>狀態</th><th>主旨</th>
            </tr>
          </thead>
          <tbody>
            ${lastLeaveItems
              .map((r) => {
                const dh =
                  [
                    r.days != null ? `${r.days} 日` : '',
                    r.hours != null && Number(r.hours) > 0 ? `${r.hours} 時` : '',
                  ]
                    .filter(Boolean)
                    .join(' / ') || '—';
                return `<tr>
                  <td><input type="checkbox" data-leave-check value="${r.id}" checked /></td>
                  <td>#${r.id}</td>
                  <td>${esc(r.requester_name || '')}</td>
                  <td>${esc(r.requester_dept || '—')}</td>
                  <td>${esc(r.leave_type || '—')}</td>
                  <td style="white-space:nowrap">${esc(r.leave_start || '—')}</td>
                  <td style="white-space:nowrap">${esc(r.leave_end || '—')}</td>
                  <td style="white-space:nowrap">${esc(dh)}</td>
                  <td>${esc(STATUS_LEAVE[r.status] || r.status || '')}</td>
                  <td title="${esc(r.title || '')}">${esc((r.title || '').slice(0, 40))}${(r.title || '').length > 40 ? '…' : ''}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:8px">共 ${lastLeaveItems.length} 筆請假申請。勾選後按「下載選取」；或「下載本頁全部」。</p>`;

    $('#chk-all-leave-forms')?.addEventListener('change', (e) => {
      box.querySelectorAll('input[data-leave-check]').forEach((c) => {
        c.checked = e.target.checked;
      });
      updateLeaveSelCount();
    });
    box.querySelectorAll('input[data-leave-check]').forEach((c) => {
      c.onchange = updateLeaveSelCount;
    });

    async function downloadLeaveIds(ids) {
      if (!ids.length) {
        toast('請至少勾選一筆請假單', 'error');
        return;
      }
      const out = $('#leave-forms-dl-result');
      const btnSel = $('#btn-leave-dl-selected');
      const btnAll = $('#btn-leave-dl-all');
      if (btnSel) btnSel.disabled = true;
      if (btnAll) btnAll.disabled = true;
      if (out) out.textContent = `正在打包 ${ids.length} 筆請假 PDF，請稍候…`;
      try {
        const metaDl = await api('/api/backups/leave-forms-download', {
          method: 'POST',
          body: { ids },
          expectBlob: true,
          returnMeta: true,
        });
        const blob = metaDl.blob || metaDl;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = metaDl.filename || `請假申請單_${ids.length}筆.zip`;
        a.click();
        URL.revokeObjectURL(url);
        if (out) out.textContent = `已開始下載 ZIP（${ids.length} 筆）。`;
        toast(`請假申請單 ZIP 已開始下載（${ids.length} 筆）`, 'success');
      } catch (err) {
        if (out) out.textContent = '';
        toast(err.message, 'error');
      } finally {
        if (btnSel) btnSel.disabled = false;
        if (btnAll) btnAll.disabled = false;
      }
    }

    $('#btn-leave-dl-selected')?.addEventListener('click', () => {
      const ids = [
        ...box.querySelectorAll('input[data-leave-check]:checked'),
      ].map((c) => Number(c.value));
      downloadLeaveIds(ids);
    });
    $('#btn-leave-dl-all')?.addEventListener('click', () => {
      box.querySelectorAll('input[data-leave-check]').forEach((c) => {
        c.checked = true;
      });
      const all = $('#chk-all-leave-forms');
      if (all) {
        all.checked = true;
        all.indeterminate = false;
      }
      updateLeaveSelCount();
      downloadLeaveIds(lastLeaveItems.map((r) => r.id));
    });
    updateLeaveSelCount();
  }

  $('#leave-forms-query-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      date_from: fd.get('date_from') || '',
      date_to: fd.get('date_to') || '',
      status: fd.get('status') || 'approved',
      department: fd.get('department') || '',
      leave_type: String(fd.get('leave_type') || '').trim(),
      keyword: String(fd.get('keyword') || '').trim(),
    };
    if (!payload.date_from || !payload.date_to) {
      toast('請指定請假期間起迄', 'error');
      return;
    }
    const btn = $('#btn-leave-forms-query');
    const box = $('#leave-forms-list');
    if (btn) btn.disabled = true;
    if (box) box.innerHTML = `<div class="muted">查詢中…</div>`;
    try {
      const data = await api('/api/backups/leave-forms-query', {
        method: 'POST',
        body: payload,
      });
      renderLeaveList(data.items || []);
      toast(`查詢完成：${data.total || 0} 筆`, 'success');
    } catch (err) {
      if (box) box.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#btn-leave-forms-reset')?.addEventListener('click', () => {
    const form = $('#leave-forms-query-form');
    if (!form) return;
    form.reset();
    const fromEl = form.querySelector('[name=date_from]');
    const toEl = form.querySelector('[name=date_to]');
    if (fromEl) fromEl.value = ytdFrom;
    if (toEl) toEl.value = ytdTo;
    const st = form.querySelector('[name=status]');
    if (st) st.value = 'approved';
    lastLeaveItems = [];
    const box = $('#leave-forms-list');
    if (box) {
      box.innerHTML = `<div class="muted">請先設定條件後按「查詢請假單」。</div>`;
    }
    const out = $('#leave-forms-dl-result');
    if (out) out.textContent = '';
  });
}

const PERM_LABEL = {
  workflows: '管理簽核流程',
  backups: '備份資料',
  records_all: '查看全部簽核紀錄',
  records_delete: '刪除簽核紀錄',
  leave_delete: '刪除請假申請',
  leave_report: '請假報表匯出',
  users_leave: '成員休假已休管理',
  finance_confirm: '財務部授信額度建檔確認',
};

/**
 * 財務部／授信額度建檔人員（僅財務）
 * 「確認完成額度建檔」僅財務可見；總經理／一般 admin 不會因最高權限而顯示。
 */
function isFinanceStaffUser(u) {
  const user = u || state.user;
  if (!user) return false;
  if (user.department === '財務部') return true;
  if (Array.isArray(user.departments) && user.departments.includes('財務部')) {
    return true;
  }
  if (user.username === 'Gigi' || user.name === '張美雯') return true;
  if (user.username === 'Joan' || user.name === '詹慈敏') return true;
  // hasPerm 對 admin 一律 true，故僅一般使用者看 finance_confirm 權限
  if (user.role !== 'admin' && hasPerm('finance_confirm')) return true;
  return false;
}

function formatPerms(u) {
  if (u.role === 'admin') return '全部權限（系統管理員）';
  const list = u.permissions || [];
  if (!list.length) return '一般（僅本人簽核）';
  return list.map((p) => PERM_LABEL[p] || p).join('、');
}

function getSelectedUserIds(root) {
  return [...(root || document).querySelectorAll('input[data-user-check]:checked')]
    .map((c) => Number(c.value))
    .filter(Boolean);
}

async function downloadUsersExcel(ids, { resetPasswords = false } = {}) {
  const blob = await api('/api/users/export', {
    method: 'POST',
    body: { ids: ids || [], resetPasswords },
    expectBlob: true,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `成員名單_${formatTaiwanDateTime(new Date(), { dateOnly: true })}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
