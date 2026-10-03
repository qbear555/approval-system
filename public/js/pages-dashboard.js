async function renderDashboard(body) {
  const { stats } = await api('/api/stats');
  const { requests } = await api('/api/requests?filter=pending_me');
  let announcements = [];
  try {
    const annRes = await api('/api/announcement');
    announcements = Array.isArray(annRes.announcements)
      ? annRes.announcements
      : annRes.announcement
        ? [annRes.announcement]
        : [];
  } catch {
    /* ignore */
  }
  const activeAnnouncements = announcements.filter((a) => a && a.active);
  const pendingList = requests.slice(0, 4);
  const canWf = hasPerm('workflows');
  const canUsers = hasPerm('users_leave');
  const isFinanceStaff = typeof isFinanceStaffUser === 'function' && isFinanceStaffUser();

  let workflows = [];
  try {
    workflows = await loadWorkflows(false);
  } catch {
    workflows = [];
  }

  const favIds = getFavWorkflowIds(workflows);
  const commonForms = favIds
    .map((id) => workflows.find((w) => w.id === id))
    .filter(Boolean);

  const commonFormsHtml = `
    <div class="card dashboard-common-forms-card">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px">
          <h3 style="margin:0">⭐ 常用申請表單</h3>
          <span class="muted" style="font-size:0.82rem">點擊直接開始填寫</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn outline sm" id="btn-custom-common-forms" title="勾選自訂常用表單">⚙️ 自訂常用</button>
          <button type="button" class="btn outline sm" data-go="new-request">全部表單 (${workflows.length}) →</button>
        </div>
      </div>
      ${commonForms.length ? `
        <div class="dash-common-grid">
          ${commonForms
            .map((w) => {
              const icon = getWorkflowIcon(w.name, w.category);
              const catCls = getCategoryClass(w.category);
              return `
                <div class="dash-form-card" data-dash-wf="${w.id}" role="button" tabindex="0" title="填寫「${esc(w.name)}」">
                  <button type="button" class="dash-form-remove" data-remove-fav="${w.id}" title="從常用表單移除">✕</button>
                  <div class="dash-form-icon ${catCls}">${icon}</div>
                  <div class="dash-form-info">
                    <div class="dash-form-name">${esc(w.name)}</div>
                    <div class="dash-form-cat">
                      <span class="catalog-category-tag ${catCls}">${esc(w.category || '一般簽呈')}</span>
                    </div>
                  </div>
                  <span class="dash-form-arrow" aria-hidden="true">→</span>
                </div>
              `;
            })
            .join('')}
        </div>
      ` : `
        <div class="dash-common-empty" style="text-align:center;padding:24px 16px;background:#f8fafc;border:1px dashed var(--border);border-radius:10px;margin-top:10px">
          <div style="font-size:1.6rem;margin-bottom:6px">📋</div>
          <div style="font-weight:600;color:var(--text-heading);margin-bottom:4px">尚未設定常用申請表單</div>
          <p class="muted" style="font-size:0.85rem;margin:0 0 12px">您可以自行挑選最常使用的表單，建立專屬快捷清單。</p>
          <div style="display:flex;justify-content:center;gap:8px">
            <button type="button" class="btn primary sm" id="btn-empty-custom-fav">＋ 選擇常用表單</button>
            <button type="button" class="btn outline sm" id="btn-empty-reset-fav">恢復預設推薦</button>
          </div>
        </div>
      `}
    </div>
  `;

  // 同一區塊：「公告」下 1.／2. 黃色系（樣式＋hover 在 CSS）
  const announcementHtml = activeAnnouncements.length
    ? `<div class="card announcement-card">
        <div class="announcement-card-title">
          <span class="announcement-card-bar" aria-hidden="true"></span>
          公告
        </div>
        <ol class="announcement-list">
          ${activeAnnouncements
            .map((ann, idx) => {
              const n = idx + 1;
              const tone = (idx % 2) + 1;
              const showNum = activeAnnouncements.length > 1;
              const numBadge = showNum
                ? `<span class="ann-item-badge" aria-hidden="true">${n}</span>`
                : '';
              return `<li class="announcement-list-item">
                <button type="button" class="announcement-open ann-item ann-item-${tone}" data-ann-slot="${Number(ann.slot) || idx}">
                  ${numBadge}
                  <div class="ann-item-body">
                    <strong class="ann-item-title">${esc(ann.title || '公司公告')}</strong>
                    ${
                      ann.body
                        ? `<p class="ann-item-text">${esc(ann.body)}</p>`
                        : ''
                    }
                  </div>
                  <span class="btn outline sm ann-item-btn">查看</span>
                </button>
              </li>`;
            })
            .join('')}
        </ol>
      </div>`
    : '';

  const finNoticeHtml =
    isFinanceStaff && stats.pendingFinanceConfirm > 0
      ? `<div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#065f46;font-size:1.05rem">📊 待財務部授信額度建檔確認（${stats.pendingFinanceConfirm} 筆）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
                總經理已完成核定。請於 ERP 完成授信額度設定後，點擊「前往處理」進行建檔確認。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往處理 (${stats.pendingFinanceConfirm})</button>
          </div>
        </div>`
      : '';

  const applicantAckNoticeHtml =
    stats.pendingApplicantAck > 0
      ? `<div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#166534;font-size:1.05rem">📊 財務部已完成授信額度建檔（${stats.pendingApplicantAck} 筆待您確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#15803d">
                財務部已完成您申請的授信額度建檔。請點擊「前往確認」並點選「我知道了」。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingApplicantAck})</button>
          </div>
        </div>`
      : '';

  const finalNotifyNoticeHtml =
    stats.pendingFinalNotify > 0
      ? `<div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#1e40af;font-size:1.05rem">🔔 最終核准通知（${stats.pendingFinalNotify} 筆待確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8">
                有申請單已最終核准。請假相關請<strong>設定 Email 自動回覆</strong>後，開啟單據點確認。
              </p>
            </div>
            <button type="button" class="btn primary" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingFinalNotify})</button>
          </div>
        </div>`
      : '';

  body.innerHTML = `
    ${finNoticeHtml}
    ${applicantAckNoticeHtml}
    ${finalNotifyNoticeHtml}
    ${announcementHtml}
    <div class="stats-grid">
      ${statCardHtml({
        label: '待我簽核',
        value: stats.pendingMe ?? 0,
        go: 'inbox',
        hint: '前往待簽核列表',
        tone: 'rose',
      })}
      ${
        isFinanceStaff
          ? statCardHtml({
              label: '待財務建檔',
              value: stats.pendingFinanceConfirm ?? 0,
              go: 'inbox',
              hint: '待財務部額度建檔確認',
              tone: 'green',
            })
          : ''
      }
      ${
        stats.pendingApplicantAck > 0
          ? statCardHtml({
              label: '待確認建檔',
              value: stats.pendingApplicantAck ?? 0,
              go: 'inbox',
              hint: '待您確認財務建檔結果',
              tone: 'teal',
            })
          : ''
      }
      ${statCardHtml({
        label: '我的進行中',
        value: stats.minePending ?? 0,
        go: 'mine',
        status: 'pending',
        hint: '查看簽核中的申請',
        tone: 'blue',
      })}
      ${statCardHtml({
        label: '我已完成',
        value: stats.mineDone ?? 0,
        go: 'mine',
        status: 'approved',
        hint: '查看已核准的申請',
        tone: 'purple',
      })}
      ${statCardHtml({
        label: '啟用中流程',
        value: stats.workflows ?? 0,
        go: canWf ? 'workflows' : undefined,
        hint: canWf ? '管理簽核流程' : '需流程管理權限',
        disabled: !canWf,
        tone: 'indigo',
      })}
    </div>
    <div class="card dashboard-pending-card">
      <div class="card-head">
        <h3>待辦簽核</h3>
        ${
          pendingList.length
            ? `<button type="button" class="btn outline sm" data-go="inbox">查看全部</button>`
            : ''
        }
      </div>
      ${requestTable(pendingList, {
        empty: {
          title: '目前沒有待簽核項目',
          desc: '有單據輪到您時會顯示於此。',
          actions: [
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '我的申請', go: 'mine', outline: true },
          ],
        },
      })}
    </div>
    ${commonFormsHtml}
    <div class="card">
      <h3>快速開始</h3>
      <div class="form-actions">
        <button type="button" class="btn primary" data-go="new-request">＋ 新增申請</button>
        ${
          canWf
            ? `<button type="button" class="btn outline" data-go="workflows">管理簽核流程</button>`
            : ''
        }
        ${
          hasPerm('backups')
            ? `<button type="button" class="btn outline" data-go="backups">備份資料</button>`
            : ''
        }
        ${
          isAdmin()
            ? `<button type="button" class="btn outline" data-go="users">成員權限</button>`
            : canUsers
              ? `<button type="button" class="btn outline" data-go="users">成員休假</button>`
              : ''
        }
        <button type="button" class="btn outline" data-go="inbox">查看待簽核</button>
      </div>
    </div>
  `;
  bindDataGo(body);
  bindRequestRows(body);

  $('#btn-custom-common-forms')?.addEventListener('click', () => {
    openCustomizeCommonFormsModal(workflows, () => renderDashboard(body));
  });
  $('#btn-empty-custom-fav')?.addEventListener('click', () => {
    openCustomizeCommonFormsModal(workflows, () => renderDashboard(body));
  });
  $('#btn-empty-reset-fav')?.addEventListener('click', () => {
    resetFavWorkflowIds();
    toast('已恢復系統預設推薦選項', 'success');
    renderDashboard(body);
  });

  body.querySelectorAll('[data-remove-fav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wfId = Number(btn.dataset.removeFav);
      const curIds = getFavWorkflowIds(workflows).filter((id) => id !== wfId);
      saveFavWorkflowIds(curIds);
      const w = workflows.find((x) => x.id === wfId);
      toast(`已將「${w ? w.name : '表單'}」從常用表單移除`, 'info');
      renderDashboard(body);
    });
  });

  body.querySelectorAll('[data-dash-wf]').forEach((card) => {
    const trigger = (e) => {
      if (e?.target?.closest('[data-remove-fav]')) return;
      const id = Number(card.getAttribute('data-dash-wf'));
      if (id) navigate('new-request', { workflowId: id });
    };
    card.addEventListener('click', trigger);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger(e);
      }
    });
  });

  body.querySelectorAll('.announcement-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = Number(btn.getAttribute('data-ann-slot'));
      const ann =
        activeAnnouncements.find((a) => Number(a.slot) === slot) ||
        activeAnnouncements[0];
      if (ann) openAnnouncementModal(ann);
    });
  });
}

/**
 * 將時間字串轉為 Date
 * - 含 Z／時區：依 ISO 解析
 * - 無時區的「YYYY-MM-DD HH:mm」：視為台灣時間（+08:00）
 */
function parseAsDate(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (!s) return null;
  let d;
  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) &&
    !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
  ) {
    d = new Date(s.replace(' ', 'T') + '+08:00');
  } else {
    d = new Date(s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 顯示用：台灣時區（Asia/Taipei）
 * @param {string|Date|number} val
 * @param {{ seconds?: boolean, dateOnly?: boolean }} [opts]
 */
function formatTaiwanDateTime(val, opts = {}) {
  const d = val instanceof Date ? val : parseAsDate(val);
  if (!d) return val == null || val === '' ? '' : String(val);
  const seconds = opts.seconds !== false;
  const dateOnly = !!opts.dateOnly;
  try {
    const fmt = {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    if (!dateOnly) {
      fmt.hour = '2-digit';
      fmt.minute = '2-digit';
      if (seconds) fmt.second = '2-digit';
      fmt.hour12 = false;
    }
    // sv-SE → 2026-08-04 14:30:00
    return new Intl.DateTimeFormat('sv-SE', fmt).format(d).replace('T', ' ');
  } catch {
    return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  }
}

/** ISO → datetime-local 輸入值（台灣時區） */
function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = parseAsDate(iso);
  if (!d) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    let hour = get('hour');
    if (hour === '24') hour = '00';
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
  } catch {
    const pad = (n) => String(n).padStart(2, '0');
    // 後備：以 UTC+8 手動換算
    const tw = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${tw.getUTCFullYear()}-${pad(tw.getUTCMonth() + 1)}-${pad(tw.getUTCDate())}T${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}`;
  }
}

/** 系統設定：公告狀態文字 */
function formatAnnouncementStatus(a) {
  if (!a) return '未設定';
  if (!a.enabled) return '未啟用';
  const hasContent = !!(
    (a.title && String(a.title).trim()) ||
    (a.body && String(a.body).trim()) ||
    a.hasFile
  );
  if (!hasContent) return '已啟用，但尚無標題／內文／附件';
  if (a.scheduleStatus === 'scheduled') return '已啟用，尚未到公布開始時間（總覽暫不顯示）';
  if (a.scheduleStatus === 'expired') return '已過公布結束時間，自動下架（總覽不顯示）';
  if (a.active) return '公布中，顯示於總覽';
  return '已啟用';
}

/** 總覽／系統設定：查看公告全文與附件 */
function openAnnouncementModal(announcement) {
  // 系統設定預覽可在非 active 時查看；總覽僅 active 才開卡
  if (!announcement) return;
  if (announcement.active === false && !announcement._forcePreview) return;
  const slot = Number(announcement.slot) || 0;
  const bodyHtml = announcement.body
    ? `<div class="announcement-modal-body">${esc(announcement.body)}</div>`
    : `<p class="muted" style="margin:0 0 14px;font-size:1.05rem">（無內文）</p>`;
  // 附件僅檢視、不提供下載
  const fileHtml = announcement.hasFile
    ? `<div style="padding:14px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:0.9rem;color:#64748b">附件（僅供檢視）</div>
            <strong style="font-size:1.05rem">${esc(announcement.originalName || '附件')}</strong>
          </div>
          <button type="button" class="btn primary sm" id="ann-file-view">開啟檢視</button>
        </div>
        <div id="ann-file-preview" class="muted" style="font-size:0.9rem">點「開啟檢視」於下方或新分頁瀏覽（不提供下載）</div>
      </div>`
    : '';
  const updated = announcement.updatedAt
    ? formatTaiwanDateTime(announcement.updatedAt)
    : '';
  openModal(`
    <h3 style="margin-top:0;font-size:1.45rem;line-height:1.35">📢 ${esc(announcement.title || '公司公告')}</h3>
    ${updated ? `<p class="muted" style="margin:-4px 0 14px;font-size:0.9rem">更新：${esc(updated)}</p>` : ''}
    ${bodyHtml}
    ${fileHtml}
    <div class="modal-actions" style="margin-top:16px">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  // 公告全文／附件檢視用較寬視窗
  const panel = $('#modal-panel');
  if (panel) {
    panel.classList.add('wide', 'wide-announcement');
  }

  $('#ann-file-view')?.addEventListener('click', async () => {
    try {
      const meta = await api(`/api/announcement/file?inline=1&slot=${slot}`, {
        expectBlob: true,
        returnMeta: true,
      });
      const url = URL.createObjectURL(meta.blob);
      const ct = String(meta.contentType || meta.blob.type || '').toLowerCase();
      const name = String(meta.filename || announcement.originalName || '');
      const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
      const isImg =
        ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name);
      const box = $('#ann-file-preview');
      // 開啟附件時再確保寬版
      $('#modal-panel')?.classList.add('wide', 'wide-announcement');
      if (box && (isPdf || isImg)) {
        if (isPdf) {
          box.innerHTML = `<iframe src="${url}" title="附件預覽" class="ann-file-iframe"></iframe>`;
        } else {
          box.innerHTML = `<img src="${url}" alt="附件預覽" class="ann-file-img" />`;
        }
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } else {
        // 其他格式：新分頁 inline 開啟（仍不觸發下載屬性）
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      toast(err.message || '附件開啟失敗', 'error');
    }
  });
}

/** 是否具備「刪除簽核紀錄」權限（管理員或 records_delete） */
function canDeleteRecordsPerm() {
  return isAdmin() || hasPerm('records_delete');
}

/** 人事：刪除請假申請（含簽核中、所有人） */
function canDeleteLeavePerm() {
  return isAdmin() || hasPerm('leave_delete');
}

function isVoidRequestRow(r) {
  if (!r) return false;
  if (Number(r.void_of_request_id) > 0) return true;
  return /作廢申請/.test(String(r.workflow_name || '')) || /^作廢申請/.test(String(r.title || '').trim());
}

function isLeaveRequestRow(r) {
  if (!r) return false;
  if (isVoidRequestRow(r)) return false;
  if (r.is_leave === true) return true;
  return (
    /請假/.test(String(r.workflow_name || '')) ||
    /請假/.test(String(r.title || ''))
  );
}

/**
 * 列表是否可刪除（與後端一致）
 * - 系統管理員：可刪任何狀態（已核准／駁回／簽核中／已取消／已簽署）
 * - 請假＋leave_delete：可刪任何人、含簽核進行中／已簽核
 * - 其餘：已有簽署人簽核 → 不可刪；已核准一般不可刪
 * - 申請人本人可刪自己的未核准單；records_delete 可刪他人未鎖定單
 */
function canDeleteRequestRow(r, { adminMode = false } = {}) {
  if (!r) return false;
  if (isAdmin()) return true;
  if (r.can_delete === true) return true;
  if (isLeaveRequestRow(r) && canDeleteLeavePerm()) return true;
  if (r.can_delete === false) return false;
  if (r.approver_signed) return false;
  if (r.status === 'approved') return false;
  if (adminMode && canDeleteRecordsPerm()) return true;
  return Number(r.requester_id) === Number(state.user?.id);
}

/**
 * 申請列表表格
 * @param {Array} requests
 * @param {boolean|{ empty?: object }} emptyOkOrOpts  相容舊呼叫 true＝簡易空狀態；或 { empty, allowDelete, adminMode }
 * @param {{ allowDelete?: boolean, adminMode?: boolean, empty?: object }} [opts]
 */
function requestTable(requests, emptyOkOrOpts = false, opts = {}) {
  // 相容：requestTable(list, true) / requestTable(list, false, {…}) / requestTable(list, { empty, … })
  let emptyCfg = null;
  let allowDelete = false;
  let adminMode = false;
  let allowBatchApprove = false;
  if (emptyOkOrOpts && typeof emptyOkOrOpts === 'object' && !Array.isArray(emptyOkOrOpts)) {
    emptyCfg = emptyOkOrOpts.empty || null;
    allowDelete = !!emptyOkOrOpts.allowDelete;
    adminMode = !!emptyOkOrOpts.adminMode;
    allowBatchApprove = !!emptyOkOrOpts.allowBatchApprove;
  } else {
    allowDelete = !!(opts && opts.allowDelete);
    adminMode = !!(opts && opts.adminMode);
    allowBatchApprove = !!(opts && opts.allowBatchApprove);
    emptyCfg = (opts && opts.empty) || null;
    if (!emptyCfg && emptyOkOrOpts === true) {
      emptyCfg = {
        title: '目前沒有項目',
        desc: '此處尚無相關簽核單據。',
      };
    }
  }
  if (!requests.length) {
    return emptyState(
      emptyCfg || {
        title: '尚無資料',
        desc: '目前沒有符合條件的簽核單據。',
      }
    );
  }
  const anyDeletable =
    allowDelete &&
    requests.some((r) => canDeleteRequestRow(r, { adminMode }));
  const showCheckbox = anyDeletable || allowBatchApprove;
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            ${showCheckbox ? '<th style="width:40px"></th>' : ''}
            <th>單號</th><th>主旨</th><th>流程</th><th>申請人</th><th>狀態</th><th>更新時間</th>
            ${anyDeletable ? '<th>操作</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${requests
            .map((r) => {
              const canDel = allowDelete && canDeleteRequestRow(r, { adminMode });
              const canApproveRow = allowBatchApprove && r.status === 'pending';
              return `
            <tr class="clickable" data-id="${r.id}">
              ${
                showCheckbox
                  ? `<td onclick="event.stopPropagation()">
                      ${
                        canApproveRow
                          ? `<input type="checkbox" data-req-check value="${r.id}" />`
                          : canDel
                            ? `<input type="checkbox" data-req-check value="${r.id}" />`
                            : ''
                      }
                    </td>`
                  : ''
              }
              <td>#${r.id}</td>
              <td><strong>${esc(r.title)}</strong>${
                r.is_proxy_pending
                  ? ` <span class="tag" style="background:#fef3c7;color:#92400e;font-size:0.75rem;vertical-align:middle">代簽${
                      r.proxy_principal_name
                        ? `·${esc(r.proxy_principal_name)}`
                        : ''
                    }</span>`
                  : ''
              }${
                r.is_proxy_submit
                  ? ` <span class="tag" style="background:#e0e7ff;color:#3730a3;font-size:0.75rem;vertical-align:middle">代申請</span>`
                  : ''
              }</td>
              <td>${esc(r.workflow_name)}</td>
              <td>${esc(r.requester_name)}${
                r.is_proxy_submit && r.submitted_by_name
                  ? `<div class="muted" style="font-size:0.78rem">代申請：${esc(
                      r.submitted_by_name
                    )}</div>`
                  : ''
              }</td>
              <td>${statusTag(r.status)}</td>
              <td class="muted">${esc(r.updated_at)}</td>
              ${
                anyDeletable
                  ? `<td onclick="event.stopPropagation()">
                      ${
                        canDel
                          ? `<button type="button" class="btn sm danger" data-del-req="${r.id}">刪除</button>`
                          : r.approver_signed || r.can_delete === false
                            ? `<span class="muted" style="font-size:0.82rem" title="下一位簽署人已簽核">已簽核不可刪</span>`
                            : r.status === 'approved'
                              ? `<span class="muted" style="font-size:0.82rem">已核准不可刪</span>`
                              : ''
                      }
                    </td>`
                  : ''
              }
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function bindRequestRows(root) {
  root.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('input,button,a,label')) return;
      navigate('detail', { id: Number(tr.dataset.id) });
    };
  });
}

function getSelectedRequestIds(root) {
  return [...(root || document).querySelectorAll('input[data-req-check]:checked')]
    .map((c) => Number(c.value))
    .filter(Boolean);
}

const REQUEST_LIST_PAGE_SIZE = 20;

function paginateItems(items, page, pageSize = REQUEST_LIST_PAGE_SIZE) {
  const size = Math.max(1, Number(pageSize) || 20);
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  const start = (p - 1) * size;
  return {
    page: p,
    pages,
    total,
    pageSize: size,
    items: list.slice(start, start + size),
    from: total ? start + 1 : 0,
    to: Math.min(start + size, total),
  };
}

function requestListPagerHtml(pg) {
  if (!pg || pg.total <= pg.pageSize) return '';
  const btn = (page, label, disabled) =>
    `<button type="button" class="btn sm outline" data-req-page="${page}" ${
      disabled ? 'disabled' : ''
    }>${label}</button>`;
  return `<div class="req-pager" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px">
    <span class="muted" style="font-size:0.85rem">顯示第 ${pg.from}–${pg.to} 筆，共 ${pg.total} 筆</span>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      ${btn(1, '第一頁', pg.page <= 1)}
      ${btn(pg.page - 1, '上一頁', pg.page <= 1)}
      <span class="muted" style="font-size:0.85rem">第 ${pg.page} / ${pg.pages} 頁</span>
      ${btn(pg.page + 1, '下一頁', pg.page >= pg.pages)}
      ${btn(pg.pages, '最末頁', pg.page >= pg.pages)}
    </div>
  </div>`;
}
