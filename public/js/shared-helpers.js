/**
 * 系統共用工具與狀態載入模組 (Shared Core Helpers & Utilities)
 * 提供使用者載入、流程載入、時間解析、圖表渲染、批次核准等核心共用函式
 */

function safeEsc(s) {
  if (typeof window !== 'undefined' && typeof window.esc === 'function') {
    return window.esc(s);
  }
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
if (typeof esc === 'undefined' && typeof window !== 'undefined') {
  window.esc = safeEsc;
}

function openBulkApproveModal({ selectedRequests = [], onCompleted = null } = {}) {
  if (!selectedRequests || !selectedRequests.length) return;
  const count = selectedRequests.length;

  const itemsHtml = selectedRequests
    .map(
      (r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#e2e8f0);font-size:0.9rem">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:12px">
        <strong>#${r.id}</strong>
        <span style="margin:0 4px;color:var(--text-muted,#64748b)">|</span>
        <span title="${esc(r.title || '')}">${esc(r.title || '')}</span>
        ${
          r.is_proxy_pending
            ? `<span class="tag" style="background:#fef3c7;color:#92400e;font-size:0.75rem;margin-left:4px">代簽${
                r.proxy_principal_name ? `·${esc(r.proxy_principal_name)}` : ''
              }</span>`
            : ''
        }
      </div>
      <div style="color:var(--text-muted,#64748b);font-size:0.85rem;white-space:nowrap">
        ${esc(r.requester_name || '')} · ${esc(r.workflow_name || '')}
      </div>
    </div>`
    )
    .join('');

  const modalHtml = `
    <div class="modal-box" style="max-width:580px;width:100%">
      <div class="modal-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;font-size:1.25rem">✅ 批次簽核核准（共 ${count} 筆）</h3>
        <button type="button" class="btn ghost sm" data-close-modal style="font-size:1.2rem;line-height:1">✕</button>
      </div>

      <div style="margin-bottom:14px;max-height:180px;overflow-y:auto;border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:8px 12px;background:var(--bg-subtle,#f8fafc)">
        ${itemsHtml}
      </div>

      <div class="field" style="margin-bottom:14px">
        <label style="font-weight:600;display:block;margin-bottom:6px">簽核意見</label>
        ${typeof commentPhraseButtonsHtml === 'function' ? commentPhraseButtonsHtml('bulk-approve-comment') : ''}
        <textarea id="bulk-approve-comment" rows="3" style="width:100%;box-sizing:border-box" placeholder="請輸入批次簽核意見…">同意</textarea>
      </div>

      <div style="font-size:0.85rem;color:var(--text-muted,#64748b);background:#eff6ff;padding:10px 12px;border-radius:6px;margin-bottom:16px;border-left:4px solid #3b82f6">
        💡 <strong>貼心提醒：</strong> 若選取單據包含需填寫專屬欄位（如人事特休核算、資訊查檢表、授信額度）的關卡，系統將安全略過並主動提示，不會遺漏任何表單資訊。
      </div>

      <div class="form-actions" style="display:flex;justify-content:flex-end;gap:10px;margin:0">
        <button type="button" class="btn outline" data-close-modal>取消</button>
        <button type="button" class="btn success" id="btn-confirm-bulk-approve">確認核准 (${count} 筆)</button>
      </div>
    </div>
  `;

  openModal(modalHtml);

  if (typeof bindCommentPhraseChips === 'function') {
    bindCommentPhraseChips(document);
  } else {
    document.querySelectorAll('.btn-quick-opinion').forEach((btn) => {
      btn.onclick = () => {
        const textarea = document.getElementById('bulk-approve-comment');
        if (textarea) textarea.value = btn.dataset.val || '';
      };
    });
  }

  const confirmBtn = document.getElementById('btn-confirm-bulk-approve');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '核准處理中…';
      const comment = (document.getElementById('bulk-approve-comment')?.value || '').trim();
      const ids = selectedRequests.map((r) => r.id);
      try {
        const res = await api('/api/requests/bulk-approve', {
          method: 'POST',
          body: { ids, comment },
        });
        closeModal();
        if (res.failureCount > 0) {
          const failMsg = res.failures
            .map((f) => `• #${f.id} (${f.title || ''}): ${f.error}`)
            .join('\n');
          toast(`已核准 ${res.successCount} 筆，${res.failureCount} 筆需個別開啟審核`, 'warning');
          alert(`批次簽核結果：\n\n成功核准：${res.successCount} 筆\n需個別審核：${res.failureCount} 筆\n\n${failMsg}`);
        } else {
          toast(`已成功批次核准 ${res.successCount} 筆單據！`, 'success');
        }
        if (typeof onCompleted === 'function') {
          onCompleted();
        }
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `確認核准 (${count} 筆)`;
        toast(err.message || '批次簽核失敗', 'error');
      }
    };
  }
}
if (typeof window !== 'undefined') {
  window.openBulkApproveModal = openBulkApproveModal;
}


// ===== 儀表板與單據列表共用函式 =====

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


// ===== 使用者、流程與時間/圖表共用函式 =====

async function loadUsers() {
  const { users } = await api('/api/users');
  state.users = users;
  return users;
}

async function loadWorkflows(all = false) {
  // 完整管理列表需 workflows 權限；一般使用者只取啟用中流程（送出申請用）
  if (all && !hasPerm('workflows')) {
    throw new Error('您沒有管理簽核流程的權限');
  }
  const { workflows } = await api(`/api/workflows${all ? '?all=1' : ''}`);
  state.workflows = workflows;
  return workflows;
}

const FIELD_TYPE_LABEL = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  date: '日期',
  datetime: '日期時間（30分）',
  select: '下拉選單',
  checkbox: '核取方塊',
  user: '人員選擇',
  table: '明細表',
};

/** 出勤可選時間：09:00～17:30（每 30 分鐘） */
const WORK_TIME_START = '09:00';
const WORK_TIME_END = '17:30';
/** 延長工時可選時間：00:00～24:00（全日 24 小時，每 30 分鐘） */
const OT_TIME_START = '00:00';
const OT_TIME_END = '24:00';
/** 延長工時預設起迄（僅預填，不限制可選範圍） */
const OT_DEFAULT_START = '18:00';
const OT_DEFAULT_END = '21:00';

function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  // 支援 24:00
  if (Number(h) === 24 && (Number(m) || 0) === 0) return 24 * 60;
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
  if (mins >= 24 * 60) return '24:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 將時間對齊 30 分，並限制在指定範圍（預設出勤 09:00～17:30） */
function clampWorkTime(time, fallback = WORK_TIME_START, rangeStart = WORK_TIME_START, rangeEnd = WORK_TIME_END) {
  let t = time || fallback;
  const [hh0, mm0] = String(t).split(':').map(Number);
  let hh = Number.isFinite(hh0) ? hh0 : 9;
  let mm = Number.isFinite(mm0) ? mm0 : 0;
  if (mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
    }
  }
  let mins = hh * 60 + mm;
  const minM = timeToMinutes(rangeStart);
  const maxM = timeToMinutes(rangeEnd);
  if (mins < minM) mins = minM;
  if (mins > maxM) mins = maxM;
  return minutesToTime(mins);
}

/**
 * 產生半小時時間選項
 * @param {string} selected
 * @param {{ start?: string, end?: string }} range 預設 09:00～17:30
 */
function halfHourTimeOptions(selected = '', range = {}) {
  const rStart = range.start || WORK_TIME_START;
  const rEnd = range.end || WORK_TIME_END;
  const startM = timeToMinutes(rStart);
  const endM = timeToMinutes(rEnd);
  const sel = clampWorkTime(
    selected || rStart,
    rStart,
    rStart,
    rEnd
  );
  const opts = [];
  for (let mins = startM; mins <= endM; mins += 30) {
    const t = minutesToTime(mins);
    opts.push(
      `<option value="${t}" ${sel === t ? 'selected' : ''}>${t}</option>`
    );
  }
  return opts.join('');
}

function parseDateTimeParts(val, defaultTime = WORK_TIME_START) {
  if (!val) return { date: '', time: clampWorkTime(defaultTime) };
  const s = String(val).replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/);
  if (!m) return { date: '', time: clampWorkTime(defaultTime) };
  let time = m[2] || defaultTime;
  time = clampWorkTime(time, defaultTime);
  return { date: m[1], time };
}

function formatDateTimeDisplay(val) {
  if (!val) return '—';
  const s = String(val).replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

const ASSIGN_TYPE_LABEL = {
  users: '指定人員',
  form_user: '表單人員（如代理人）',
  dept_head: '部門主管（申請人自選／可略過）',
  department: '指定單位／部門',
  users_pick: '申請人自選（可多位勾選）',
  cosign_pick: '會簽人員（申請人可多位勾選，非必填）',
};

function flowOpSymbol(op) {
  return (
    {
      '>=': '≥',
      '>': '>',
      '<=': '≤',
      '<': '<',
      '==': '=',
      '!=': '≠',
      contains: '包含',
      not_contains: '不包含',
    }[op] || op
  );
}

function stepAssignLabel(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `表單：${s.formFieldId || 'agent'}`;
  if (s.assignType === 'dept_head') return '自選成員／可略過';
  if (s.assignType === 'department') return `單位：${s.department || '—'}`;
  if (s.assignType === 'users_pick') {
    const n = (s.approverIds || []).length;
    const opt = s.skipIfNoApprover ? '選填可略過' : '必填';
    return n ? `申請人自選（${n} 位・${opt}）` : `申請人自選（${opt}）`;
  }
  if (s.assignType === 'cosign_pick') return '會簽（選填）';
  const n = (s.approverIds || []).length;
  return n ? `指定 ${n} 人` : '指定人員';
}

/** 條件式分支 → 人看得懂的說明文字 */
function flowConditionText(s) {
  const c = s && s.condition;
  if (!c || !c.enabled) return '';
  const op = flowOpSymbol(c.operator);
  const cond = `${c.fieldId || ''} ${op} ${c.value != null ? c.value : ''}`.trim();
  return c.action === 'skip' ? `符合「${cond}」則跳過` : `僅當「${cond}」才需簽核`;
}

/** 單一步驟 → 標籤陣列（會簽／自選／條件式…） */
function flowStepTags(s) {
  const tags = [];
  const condText = flowConditionText(s);
  if (condText) tags.push({ cls: 'cond', text: '🔀 條件式', title: condText });
  if (s.assignType === 'cosign_pick') {
    tags.push({ cls: 'cosign', text: '會簽', title: '申請時可勾選多位會簽人員，皆須核准' });
    tags.push({ cls: 'optional', text: '可略過', title: '未勾選任何人時跳過此關卡' });
  } else if (s.mode === 'all' && (s.approverIds || []).length > 1) {
    tags.push({ cls: 'cosign', text: '需全簽', title: '此關卡所有簽核人都核准後才進入下一關' });
  } else if ((s.approverIds || []).length > 1) {
    tags.push({ cls: '', text: '任一人簽', title: '任一位簽核人核准即可進入下一關' });
  }
  if (s.assignType === 'dept_head') {
    tags.push({ cls: 'optional', text: '可略過', title: '由簽核人自選成員，或直接略過此關卡' });
  }
  if (s.assignType === 'users_pick') {
    tags.push({ cls: '', text: '申請人自選', title: '送出申請時由申請人挑選簽核人' });
  }
  if (s.assignType === 'form_user') {
    tags.push({ cls: '', text: '表單指定', title: '簽核人取自表單欄位的填寫內容' });
  }
  return tags;
}

/** 步驟的簽核人描述（優先顯示實際簽核者） */
function flowStepWho(s, ctx) {
  const nameOf =
    ctx.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });
  const acted = (ctx.actionsByStep && ctx.actionsByStep.get(Number(s.order))) || [];
  const approved = acted.filter((a) => a.action === 'approve' || a.action === 'reject');
  if (approved.length) {
    return approved
      .map((a) =>
        a.on_behalf_of_name
          ? `${a.actor_name}（代理 ${a.on_behalf_of_name}）`
          : a.actor_name
      )
      .join('、');
  }
  const ids = s.approverIds || [];
  if (ids.length) {
    const names = ids.map(nameOf);
    return names.length > 3
      ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人`
      : names.join('、');
  }
  if (s.assignType === 'department') return `單位：${s.department || '未指定'}`;
  if (s.assignType === 'form_user') return `表單「${s.formFieldId || 'agent'}」欄位`;
  return '';
}

function flowGraphLayers(graph) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const inMap = new Map(nodes.map((n) => [n.id, []]));
  const outMap = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (inMap.has(e.to)) inMap.get(e.to).push(e);
    if (outMap.has(e.from)) outMap.get(e.from).push(e);
  }
  const depth = new Map();
  const visit = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = inMap.get(id) || [];
    const d = ins.length ? Math.max(...ins.map((e) => visit(e.from, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id, new Set());
  const maxD = Math.max(0, ...[...depth.values()]);
  const layers = Array.from({ length: maxD + 1 }, () => []);
  for (const n of nodes) layers[depth.get(n.id) || 0].push(n);
  return { layers, inMap, outMap };
}

function flowGraphNodeState(node, states, request) {
  const st = states ? states[node.id] : null;
  if (node.type === 'start') return { cls: 'is-start is-done', icon: '✓' };
  if (node.type === 'end') {
    if (request?.status === 'rejected') return { cls: 'is-end is-rejected', icon: '✕' };
    if (request?.status === 'voided') return { cls: 'is-end is-voided', icon: '⊘' };
    if (st?.state === 'approved' || request?.status === 'approved') {
      return { cls: 'is-end is-done', icon: '✓' };
    }
    return { cls: 'is-end is-todo', icon: '🏁' };
  }
  if (node.type === 'join') {
    return { cls: st?.state === 'approved' ? 'is-join is-done' : 'is-join is-todo', icon: '⋈' };
  }
  if (!st) return { cls: 'is-todo', icon: '' };
  if (st.state === 'approved') return { cls: 'is-done', icon: '✓' };
  if (st.state === 'rejected') return { cls: 'is-rejected', icon: '✕' };
  if (st.state === 'skipped') return { cls: 'is-skipped', icon: '⤳' };
  return { cls: 'is-current', icon: '' };
}

function flowGraphHtml(graph, opts = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return '';
  const states = opts.nodeStates || null;
  const request = opts.request || null;
  const { layers, inMap } = flowGraphLayers(graph);
  const nameOf =
    opts.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });

  const nodeHtml = (node) => {
    const { cls, icon } = flowGraphNodeState(node, states, request);
    const st = states ? states[node.id] : null;
    if (node.type === 'start') {
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">申請人</span></div>
        ${request?.requester_name ? `<div class="fn-who">${esc(request.requester_name)}</div>` : ''}
      </div>`;
    }
    if (node.type === 'end') {
      const label =
        request?.status === 'rejected'
          ? '已駁回'
          : request?.status === 'cancelled'
            ? '已取消'
            : request?.status === 'voided'
              ? '已作廢'
              : '完成';
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">${esc(label)}</span></div>
        ${request?.completed_at ? `<div class="fn-who">${esc(String(request.completed_at).slice(0, 16))}</div>` : ''}
      </div>`;
    }
    if (node.type === 'join') {
      const n = (inMap.get(node.id) || []).length;
      const title =
        node.mode === 'any' ? `任一分支完成即繼續（共 ${n} 條）` : `${n} 條分支全部完成才繼續`;
      return `<div class="flow-node ${cls}" title="${esc(title)}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">匯合${node.mode === 'any' ? '（任一）' : '（全部）'}</span></div>
      </div>`;
    }
    const ids = node.approverIds || [];
    let who = '';
    if (ids.length) {
      const names = ids.map(nameOf);
      who = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人` : names.join('、');
    } else if (node.assignType === 'department') {
      who = `單位：${node.department || '未指定'}`;
    } else if (node.assignType === 'form_user') {
      who = `表單「${node.formFieldId || 'agent'}」欄位`;
    }
    const tags = flowStepTags({
      assignType: node.assignType,
      mode: node.mode,
      approverIds: ids,
    });
    const metaBits = [];
    if (st?.completed_at) metaBits.push(esc(String(st.completed_at).slice(0, 16)));
    if (st?.state === 'skipped') metaBits.push('已略過');
    return `<div class="flow-node ${cls}">
      <div class="fn-head">
        <span class="fn-no">${esc(icon || String(node.name || '').slice(0, 1))}</span>
        <span class="fn-name">${esc(node.name || node.id)}</span>
      </div>
      ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
      ${
        tags.length
          ? `<div class="fn-tags">${tags
              .map((t) => `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`)
              .join('')}</div>`
          : ''
      }
      ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
    </div>`;
  };

  const parts = [];
  layers.forEach((layer, li) => {
    if (li > 0) {
      const incoming = layer.flatMap((n) => inMap.get(n.id) || []);
      const conds = incoming.filter((e) => e.condition);
      const allDone =
        states &&
        incoming.length > 0 &&
        incoming.every((e) => {
          const s = states[e.from];
          return s && (s.state === 'approved' || s.state === 'skipped');
        });
      const label =
        conds.length === 1
          ? `${conds[0].condition.fieldId} ${flowOpSymbol(conds[0].condition.operator)} ${conds[0].condition.value}`
          : conds.length > 1
            ? `${conds.length} 個條件`
            : '';
      parts.push(
        `<div class="flow-link ${allDone ? 'is-done' : ''} ${conds.length ? 'is-cond' : ''}"${
          label ? ` title="${esc(label)}"` : ''
        }>${label ? `<span class="flow-edge-label">${esc(label)}</span>` : ''}</div>`
      );
    }
    parts.push(
      `<div class="flow-layer ${layer.length > 1 ? 'is-parallel' : ''}">${layer.map(nodeHtml).join('')}</div>`
    );
  });

  const legend = opts.showLegend
    ? `<div class="flow-legend">
        <span><i class="done"></i>已完成</span>
        <span><i class="current"></i>簽核中</span>
        <span><i class="todo"></i>未開始</span>
        <span><i class="skipped"></i>已略過</span>
        <span><i class="rejected"></i>駁回</span>
      </div>`
    : '';
  return `<div class="flow-graph">${parts.join('')}</div>${legend}`;
}

function flowChartHtml(steps, opts = {}) {
  const graph = opts.flow || opts.request?.flow || null;
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    return flowGraphHtml(graph, {
      ...opts,
      nodeStates: opts.nodeStates || opts.request?.nodeStates || null,
    });
  }
  return flowChartLinearHtml(steps, opts);
}
if (typeof window !== 'undefined') {
  window.flowChartHtml = flowChartHtml;
}

function flowChartLinearHtml(steps, opts = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const req = opts.request || null;
  const status = req ? String(req.status || '') : '';
  const curStep = req ? Number(req.current_step) : NaN;
  const actionsByStep = new Map();
  for (const a of (req && req.actions) || []) {
    const k = Number(a.step_order);
    if (!actionsByStep.has(k)) actionsByStep.set(k, []);
    actionsByStep.get(k).push(a);
  }
  const ctx = { actionsByStep, userName: opts.userName };
  const parts = [];
  const startDone = !req || status !== 'draft';
  parts.push(`
    <div class="flow-node is-start ${startDone ? 'is-done' : 'is-todo'}">
      <div class="fn-head"><span class="fn-no">${startDone ? '✓' : '0'}</span><span class="fn-name">申請人</span></div>
      ${req ? `<div class="fn-who">${esc(req.requester_name || '')}</div>` : ''}
    </div>`);

  list.forEach((s, i) => {
    const order = Number(s.order != null ? s.order : i + 1);
    const acted = actionsByStep.get(order) || [];
    const hasApprove = acted.some((a) => a.action === 'approve');
    const hasReject = acted.some((a) => a.action === 'reject');
    let cls = 'is-todo';
    let icon = String(order);
    if (!req) {
      cls = 'is-todo';
    } else if (hasReject) {
      cls = 'is-rejected';
      icon = '✕';
    } else if (status === 'approved' || order < curStep) {
      cls = hasApprove ? 'is-done' : 'is-skipped';
      icon = hasApprove ? '✓' : '⤳';
    } else if (status === 'pending' && order === curStep) {
      cls = 'is-current';
    } else if (status === 'rejected' && order === curStep) {
      cls = 'is-rejected';
      icon = '✕';
    }
    const arrowDone = req && (status === 'approved' || order <= curStep);
    const arrowCond = !!(s.condition && s.condition.enabled);
    parts.push(
      `<div class="flow-arrow ${arrowDone ? 'is-done' : ''} ${arrowCond ? 'is-cond' : ''}"${
        arrowCond ? ` title="${esc(flowConditionText(s))}"` : ''
      }></div>`
    );
    const who = flowStepWho(s, ctx);
    const tags = flowStepTags(s);
    const lastAct = [...acted].reverse().find((a) => a.action === 'approve' || a.action === 'reject');
    const metaBits = [];
    if (lastAct && lastAct.created_at) metaBits.push(esc(String(lastAct.created_at).slice(0, 16)));
    if (cls === 'is-skipped') metaBits.push('已略過');
    parts.push(`
      <div class="flow-node ${cls}"${flowConditionText(s) ? ` title="${esc(flowConditionText(s))}"` : ''}>
        <div class="fn-head">
          <span class="fn-no">${esc(icon)}</span>
          <span class="fn-name">${esc(s.name || `關卡 ${order}`)}</span>
        </div>
        ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
        ${
          tags.length
            ? `<div class="fn-tags">${tags
                .map((t) => `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`)
                .join('')}</div>`
            : ''
        }
        ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
      </div>`);
  });

  const endDone = status === 'approved';
  const endRejected = status === 'rejected';
  const endCancelled = status === 'cancelled';
  const endVoided = status === 'voided';
  const endCls = endDone
    ? 'is-done'
    : endRejected
      ? 'is-rejected'
      : endVoided
        ? 'is-voided'
        : 'is-todo';
  const endText = endRejected
    ? '已駁回'
    : endCancelled
      ? '已取消'
      : endVoided
        ? '已作廢'
        : '完成';
  const endIcon = endDone ? '✓' : endRejected ? '✕' : endVoided ? '⊘' : '🏁';
  parts.push(
    `<div class="flow-arrow ${endDone ? 'is-done' : ''}"></div>`,
    `<div class="flow-node is-end ${endCls}">
      <div class="fn-head"><span class="fn-no">${endIcon}</span><span class="fn-name">${esc(endText)}</span></div>
      ${req && req.completed_at ? `<div class="fn-who">${esc(String(req.completed_at).slice(0, 16))}</div>` : ''}
    </div>`
  );
  const legend = opts.showLegend
    ? `<div class="flow-legend">
        <span><i class="done"></i>已完成</span>
        <span><i class="current"></i>簽核中</span>
        <span><i class="todo"></i>未開始</span>
        <span><i class="skipped"></i>已略過</span>
        <span><i class="rejected"></i>駁回</span>
      </div>`
    : '';
  return `<div class="flow-chart">${parts.join('')}</div>${legend}`;
}

/** 申請人同部門成員 + 其他人員（供部門主管自選） */
function splitUsersForDeptHeadChooser() {
  const me = state.user;
  const myDepts = new Set(
    [me?.department, ...(me?.departments || [])].filter(Boolean).map(String)
  );
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me?.id);
  const inDept = (u) => {
    const ud = [u.department, ...(u.departments || [])].filter(Boolean).map(String);
    return ud.some((d) => myDepts.has(d));
  };
  if (!myDepts.size) {
    return { deptMembers: [], others: all, myDeptLabel: '' };
  }
  const deptMembers = all.filter(inDept);
  const others = all.filter((u) => !inDept(u));
  return {
    deptMembers,
    others,
    myDeptLabel: [...myDepts].join('、'),
  };
}


// 掛載至 window 全域環境以供 Vue 橋接層 (L Proxy) 與其他模組存取
if (typeof window !== "undefined") {
  window.loadUsers = loadUsers;
  window.loadWorkflows = loadWorkflows;
  window.openBulkApproveModal = openBulkApproveModal;
  window.parseAsDate = parseAsDate;
  window.formatTaiwanDateTime = formatTaiwanDateTime;
  window.toDatetimeLocalValue = toDatetimeLocalValue;
  window.formatAnnouncementStatus = formatAnnouncementStatus;
  window.openAnnouncementModal = openAnnouncementModal;
  window.canDeleteRecordsPerm = canDeleteRecordsPerm;
  window.canDeleteLeavePerm = canDeleteLeavePerm;
  window.isVoidRequestRow = isVoidRequestRow;
  window.isLeaveRequestRow = isLeaveRequestRow;
  window.canDeleteRequestRow = canDeleteRequestRow;
  window.requestTable = requestTable;
  window.bindRequestRows = bindRequestRows;
  window.getSelectedRequestIds = getSelectedRequestIds;
  window.paginateItems = paginateItems;
  window.requestListPagerHtml = requestListPagerHtml;
  window.timeToMinutes = timeToMinutes;
  window.minutesToTime = minutesToTime;
  window.clampWorkTime = clampWorkTime;
  window.halfHourTimeOptions = halfHourTimeOptions;
  window.parseDateTimeParts = parseDateTimeParts;
  window.formatDateTimeDisplay = formatDateTimeDisplay;
  window.flowOpSymbol = flowOpSymbol;
  window.stepAssignLabel = stepAssignLabel;
  window.flowConditionText = flowConditionText;
  window.flowStepTags = flowStepTags;
  window.flowStepWho = flowStepWho;
  window.flowGraphLayers = flowGraphLayers;
  window.flowGraphNodeState = flowGraphNodeState;
  window.flowGraphHtml = flowGraphHtml;
  window.flowChartHtml = flowChartHtml;
  window.flowChartLinearHtml = flowChartLinearHtml;
  window.splitUsersForDeptHeadChooser = splitUsersForDeptHeadChooser;
}
