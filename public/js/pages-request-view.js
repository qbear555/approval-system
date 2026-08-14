/**
 * 申請詳情顯示／附件／OnlyOffice
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
function renderFormTableHtml(table) {
  const t = normalizeFormTable(table);
  if (!t) return '';
  let html = '<table class="form-view-table"><tbody>';
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell) => {
      const tag = t.header && ri === 0 ? 'th' : 'td';
      html += `<${tag}>${esc(cell) || '&nbsp;'}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

/**
 * 表單欄位顯示：富文字 HTML／分行格式；相容舊版 __table
 */
function renderFormValueHtml(field, value, formData) {
  const raw = value == null || value === '' ? '' : String(value);
  const isRichField =
    field?.type === 'textarea' ||
    field?.id === 'subject' ||
    /主旨|說明|事由|內容|備註|異常|規格/.test(String(field?.label || ''));

  // 富文字 HTML
  if (
    isRichField &&
    typeof RichEditor !== 'undefined' &&
    (RichEditor.isProbablyHtml(raw) || formData?.[`${field?.id}__table`])
  ) {
    let html = raw;
    const legacy = formData?.[`${field?.id}__table`];
    if (legacy && !/<table/i.test(html)) {
      const t = normalizeFormTable(legacy);
      if (t) {
        const rows = t.cells
          .map(
            (row, ri) =>
              `<tr>${row
                .map((c) => {
                  const tag = t.header && ri === 0 ? 'th' : 'td';
                  return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
                })
                .join('')}</tr>`
          )
          .join('');
        html =
          (html
            ? RichEditor.isProbablyHtml(html)
              ? html
              : RichEditor.plainToHtml(html)
            : '') +
          `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      }
    }
    return RichEditor.renderViewHtml(html || raw);
  }

  const text = formatFormValue(field, value, formData);
  const escaped = esc(text);
  const multiline =
    isRichField ||
    String(text).includes('\n') ||
    String(text).includes('\r');
  const tableHtml = renderFormTableHtml(formData?.[`${field?.id}__table`]);
  let body = '';
  if (multiline && text !== '—') {
    body = `<div class="form-value-pre">${escaped}</div>`;
  } else if (text !== '—' || !tableHtml) {
    body = escaped;
  }
  if (tableHtml) body += tableHtml;
  return body || '—';
}

function renderPlainValueHtml(val) {
  const text = val == null || val === '' ? '—' : String(val);
  const escaped = esc(text);
  if (text !== '—' && (text.includes('\n') || text.includes('\r'))) {
    return `<div class="form-value-pre">${escaped}</div>`;
  }
  return escaped;
}

/** 依 id 取「姓名（部門）」顯示字串；查無此人回傳 fallback */
function userLabelById(id, fallback) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  if (!u) return fallback;
  return u.department ? `${u.name}（${u.department}）` : u.name;
}

/** 「1,2,3」→「姓名（部門）、…」；沒有有效 id 時回傳空字串 */
function userLabelsFromIds(val) {
  return String(val)
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0)
    .map((id) => userLabelById(id, `#${id}`))
    .join('、');
}

function renderFormDataBlock(formFields, formData) {
  const fields = formFields || [];
  const data = formData || {};
  // 部門主管自選欄位（dept_head_N）
  const deptHeadRows = Object.keys(data)
    .filter((k) => /^dept_head_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let label = '部門主管';
      let display = '略過';
      if (v && v !== 'skip' && Number(v)) {
        display = userLabelById(
          v,
          data[`${k}__label`] || data[`${k}__name`] || `#${v}`
        );
      }
      return `<dt>${esc(label)}</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  // 申請人自選簽核人（users_pick_N，如副總；可多位勾選）
  const usersPickRows = Object.keys(data)
    .filter((k) => /^users_pick_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = data[`${k}__label`] || '—';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (String(v) === 'all') {
        display = '全部';
      } else if (v) {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt style="white-space:nowrap">副總經理簽核</dt><dd style="white-space:nowrap">${esc(display)}</dd>`;
    })
    .join('');
  // 會簽人員 cosign_N（可多位 1,2,3）
  const cosignRows = Object.keys(data)
    .filter((k) => /^cosign_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = '略過（無會簽）';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (v && v !== 'skip') {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt>會簽人員</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  if (!fields.length) {
    const keys = Object.keys(data).filter(
      (k) =>
        !k.includes('__') &&
        !/^dept_head_\d+$/.test(k) &&
        !/^users_pick_\d+$/.test(k) &&
        !/^cosign_\d+$/.test(k)
    );
    if (!keys.length && !deptHeadRows && !usersPickRows && !cosignRows) return '';
    return `
      <h3 style="margin-top:20px">表單資料</h3>
      <dl class="kv">
        ${keys.map((k) => `<dt>${esc(k)}</dt><dd>${renderPlainValueHtml(data[k])}</dd>`).join('')}
        ${deptHeadRows}
        ${cosignRows}
        ${usersPickRows}
      </dl>`;
  }
  return `
    <h3 style="margin-top:20px">表單資料</h3>
    <dl class="kv">
      ${fields
        .map(
          (f) =>
            `<dt>${esc(f.label)}</dt><dd>${renderFormValueHtml(f, data[f.id], data)}</dd>`
        )
        .join('')}
      ${deptHeadRows}
      ${cosignRows}
      ${usersPickRows}
    </dl>`;
}

function isOfficeFileName(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isPreviewableAttachmentName(name) {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(String(name || ''));
}

function renderAttachmentsBlock(attachments, opts = {}) {
  const list = attachments || [];
  if (!list.length) return '';
  const ooOn = !!opts.onlyOfficeEnabled;
  // 簽核中／草稿可編輯；已核准等完成狀態僅檢視
  const reqStatus = String(opts.requestStatus || '');
  const ooCanEdit = reqStatus === 'pending' || reqStatus === 'draft';
  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  return `
    <h3 style="margin-top:20px">附件</h3>
    ${
      ooOn
        ? `<p class="muted" style="font-size:0.82rem;margin:0 0 8px">${
            ooCanEdit
              ? 'Word／Excel 可「線上編輯」後自動回存（需 OnlyOffice）。'
              : '簽核已完成，附件僅供「線上檢視」，無法再修改。'
          }</p>`
        : ''
    }
    <ul style="margin:0;padding-left:18px">
      ${list
        .map((a) => {
          const office = ooOn && isOfficeFileName(a.original_name);
          const previewable = isPreviewableAttachmentName(a.original_name);
          return `
        <li style="margin:6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
          <button type="button" class="linkish" data-dl-att="${a.id}" data-dl-name="${esc(a.original_name || '')}">${esc(a.original_name)}</button>
          ${
            previewable
              ? `<button type="button" class="btn outline sm" data-preview-att="${a.id}" data-preview-name="${esc(a.original_name || '')}">預覽</button>`
              : ''
          }
          ${
            office
              ? `<button type="button" class="btn outline sm" data-oo-edit="${a.id}">${
                  ooCanEdit ? '線上編輯' : '線上檢視'
                }</button>`
              : ''
          }
          <span class="muted" style="font-size:0.82rem">
            ${a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ''}
            ${a.uploader_name ? ` · ${esc(a.uploader_name)}` : ''}
            ${
              a.step_order != null && a.step_order !== ''
                ? ` · 步驟 ${esc(String(a.step_order))}`
                : ' · 申請時'
            }
          </span>
        </li>`;
        })
        .join('')}
    </ul>`;
}

async function openAttachmentPreviewModal(attId, attName) {
  openModal(`
    <h3 style="margin-top:0">📎 ${esc(attName || '附件預覽')}</h3>
    <div id="att-preview-box" class="muted" style="font-size:0.9rem">載入中…</div>
    <div class="modal-actions" style="margin-top:16px">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide', 'modal-panel-att');
  const box = $('#att-preview-box');
  try {
    const meta = await api(`/api/attachments/${attId}?inline=1`, {
      expectBlob: true,
      returnMeta: true,
    });
    const url = URL.createObjectURL(meta.blob);
    const ct = String(meta.contentType || meta.blob.type || '').toLowerCase();
    const name = String(meta.filename || attName || '');
    const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
    if (box) {
      if (isPdf) {
        box.innerHTML = `<iframe class="att-preview-frame" src="${url}#view=FitH" title="附件預覽"></iframe>`;
      } else {
        box.innerHTML = `<img class="att-preview-img" src="${url}" alt="附件預覽" />`;
      }
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    if (box) box.innerHTML = '';
    toast(err.message || '附件預覽失敗', 'error');
  }
}

let onlyOfficeScriptPromise = null;
let onlyOfficeEditorInstance = null;

function loadOnlyOfficeScript(src) {
  if (window.DocsAPI) return Promise.resolve();
  if (onlyOfficeScriptPromise) return onlyOfficeScriptPromise;
  onlyOfficeScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      onlyOfficeScriptPromise = null;
      reject(
        new Error(
          '無法載入 OnlyOffice 腳本，請確認 Document Server 已啟動且 ONLYOFFICE_DOCS_URL 正確'
        )
      );
    };
    document.head.appendChild(s);
  });
  return onlyOfficeScriptPromise;
}

function closeOnlyOfficeEditor(reloadDetailId) {
  try {
    if (onlyOfficeEditorInstance && typeof onlyOfficeEditorInstance.destroyEditor === 'function') {
      onlyOfficeEditorInstance.destroyEditor();
    }
  } catch {
    /* ignore */
  }
  onlyOfficeEditorInstance = null;
  closeModal();
  if (reloadDetailId) {
    navigate('detail', { id: Number(reloadDetailId) });
  }
}

function onlyOfficeEvalAllowed() {
  try {
    return new Function('return 1')() === 1;
  } catch {
    return false;
  }
}

async function openOnlyOfficeEditor(attachmentId, requestId) {
  try {
    if (!onlyOfficeEvalAllowed()) {
      try {
        if (!sessionStorage.getItem('oo-csp-reload')) {
          sessionStorage.setItem('oo-csp-reload', '1');
          toast('瀏覽器安全政策已更新，正在重新載入頁面…', 'info');
          setTimeout(() => location.reload(), 200);
          return;
        }
      } catch {
        /* sessionStorage 不可用 */
      }
      throw new Error('瀏覽器阻擋了線上編輯（CSP）。請按 Ctrl+F5 強制重新整理後再試');
    }
    const data = await api(`/api/onlyoffice/editor/${attachmentId}`);
    if (!data?.config || !data.docsApiScript) {
      throw new Error(data?.error || '無法取得編輯器設定');
    }
    // HTTPS 不可載入 http://:8088（混合內容）；走同源 /__oo 以免命中舊 CSP 快取
    let scriptUrl = data.docsApiScript;
    if (
      typeof location !== 'undefined' &&
      location.protocol === 'https:' &&
      /^http:\/\//i.test(scriptUrl)
    ) {
      scriptUrl = `${location.origin}/__oo/web-apps/apps/api/documents/api.js`;
    } else if (
      scriptUrl &&
      scriptUrl.includes('/web-apps/') &&
      !scriptUrl.includes('/__oo/')
    ) {
      scriptUrl = scriptUrl.replace('/web-apps/', '/__oo/web-apps/');
    }
    await loadOnlyOfficeScript(scriptUrl);
    if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
      throw new Error('OnlyOffice DocsAPI 未就緒');
    }

    openModal(`
      <div class="oo-editor-shell">
        <div class="oo-editor-bar">
          <div>
            <strong>${esc(data.fileName || '線上編輯')}</strong>
            <span class="muted" style="margin-left:8px;font-size:0.85rem">
              ${data.canEdit ? '可編輯 · 儲存後自動回寫附件' : '唯讀檢視'}
              · 請於編輯器內儲存後再關閉
            </span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn outline sm" id="btn-oo-close">關閉</button>
          </div>
        </div>
        <div id="onlyoffice-placeholder" class="oo-editor-host"></div>
      </div>
    `);
    const modal = $('#modal');
    const panel = $('#modal-panel');
    if (modal) modal.classList.add('modal-oo-open');
    if (panel) {
      panel.classList.add('modal-panel-oo');
      panel.classList.remove('wide', 'modal-panel-wide');
    }

    // 高度由 CSS 的 flex 撐滿（.oo-editor-host { flex:1 }），
    // 這裡量實際可用高度傳給 DocsAPI —— 它需要明確的 px 值。
    // 原本用 window.innerHeight 沒扣掉標題列，會超出視窗高度。
    const host = document.getElementById('onlyoffice-placeholder');
    const barH = document.querySelector('.oo-editor-bar')?.offsetHeight || 52;
    const editorH = Math.max(480, (host?.clientHeight || window.innerHeight - barH));
    if (host) host.style.width = '100%';

    const cfg = {
      ...data.config,
      width: '100%',
      height: `${editorH}px`,
      type: 'desktop',
      events: {
        onDocumentStateChange: () => {},
        onError: (e) => {
          console.error('OnlyOffice error', e);
          const code = e?.data?.errorCode ?? e?.data;
          const map = {
            '-1': '編輯器未知錯誤',
            '-2': '連線逾時',
            '-3': '文件轉換逾時',
            '-4': '無法下載附件（請確認 OnlyOffice 能連回簽核系統）',
            '-5': '文件識別錯誤，請關閉後重開',
            '-6': '文件轉換失敗',
            '-7': '檔案有密碼保護，無法線上開啟',
            '-8': 'Document Server 資料庫錯誤',
            '-9': '安全權杖錯誤（JWT 密鑰不一致）',
          };
          const msg =
            map[String(code)] ||
            e?.data?.errorDescription ||
            (typeof e?.data === 'string' ? e.data : '') ||
            'OnlyOffice 編輯器錯誤';
          toast(msg, 'error');
        },
        onWarning: (e) => console.warn('OnlyOffice warning', e),
      },
    };
    if (cfg.editorConfig) {
      cfg.editorConfig = {
        ...cfg.editorConfig,
        customization: {
          ...(cfg.editorConfig.customization || {}),
          compactHeader: true,
          zoom: 100,
        },
      };
    }

    onlyOfficeEditorInstance = new window.DocsAPI.DocEditor(
      'onlyoffice-placeholder',
      cfg
    );

    $('#btn-oo-close')?.addEventListener('click', () => {
      closeOnlyOfficeEditor(requestId);
    });
  } catch (e) {
    toast(e.message || '無法開啟線上編輯', 'error');
  }
}

/**
 * 人事核定假別 → 顯示用標籤（副總／總經理詳情、簽核歷程共用）
 * 例：祭儀假 → 剩餘祭儀假日數（目前）；特休 → 剩餘特休日數（核准後）
 */
function hrLeaveFieldLabels(hrLeaveType) {
  const t = String(hrLeaveType || '').trim();
  const shortName = shortLeaveTypeLabel(t);
  const isSpecial = isSpecialLeaveTypeClient(t);
  return {
    hr_leave_type: '假別（人事核定）',
    remaining_special_leave_days: t
      ? isSpecial
        ? `剩餘${shortName}日數（核准後）`
        : `剩餘${shortName}日數（目前）`
      : '剩餘日數',
    hr_note: '人事備註',
  };
}

/** 請假／人事：排除特休「換算小時」欄位 */
function stripSpecialLeaveHoursFields(fields) {
  if (!Array.isArray(fields)) return fields || [];
  return fields.filter((f) => {
    if (!f) return false;
    const id = String(f.id || '');
    const label = String(f.label || '');
    if (id === 'remaining_special_leave_hours') return false;
    if (/剩餘.*特休.*小時|特休.*小時/.test(label) && /剩餘|換算/.test(label)) {
      return false;
    }
    if (id === 'remaining_special_leave_hours') return false;
    return true;
  });
}

function labelForApproverField(key, flatOrFd) {
  const hrLabels = hrLeaveFieldLabels(
    flatOrFd?.hr_leave_type || flatOrFd?.假別 || ''
  );
  if (hrLabels[key]) return hrLabels[key];
  const staticLabels = {
    pc_acquired_date: '原電腦取得日期',
    check_os: '作業系統（Windows10）',
    check_memory: '記憶體（4G 以上）',
    check_disk: '硬碟（SSD 500G 以上）',
    check_3dmark: '3DMARK 分數（500 分以上）',
    check_email: '電子郵件定期清理',
    check_backup: '重要資料定期備份',
    check_battery: '電池容量（70% 以下）',
    handle_result: '電腦處理情形',
    handle_note: '處理說明／其他',
    actual_start: '實際工時開始',
    actual_end: '實際工時結束',
    actual_hours: '實際總計（小時）',
    comp_leave_balance: '目前累計可用時數（補休）',
  };
  return staticLabels[key] || key;
}

function renderApproverDataBlock(approverData) {
  const data = approverData || {};
  const flat = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  const keys = Object.keys(flat);
  if (!keys.length) return '';
  const isIt =
    flat.pc_acquired_date != null ||
    flat.check_os != null ||
    flat.handle_result != null;
  const sectionTitle = isIt
    ? '管理部／簽核單位填寫'
    : flat.hr_leave_type != null || flat.remaining_special_leave_days != null
      ? '人事／簽核單位填寫'
      : '簽核單位填寫';
  // 顯示順序：假別 → 剩餘日 → 備註 → 其他（不再顯示特休小時）
  const order = ['hr_leave_type', 'remaining_special_leave_days', 'hr_note'];
  const orderedKeys = [
    ...order.filter((k) => keys.includes(k)),
    ...keys.filter(
      (k) =>
        !order.includes(k) &&
        k !== 'remaining_special_leave_hours' &&
        !/特休.*小時|剩餘.*小時/.test(String(k))
    ),
  ];
  return `
    <h3 style="margin-top:20px">${sectionTitle}</h3>
    <dl class="kv">
      ${orderedKeys
        .map((k) => {
          let val = flat[k];
          if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
            val = '—';
          }
          return `<dt>${esc(labelForApproverField(k, flat))}</dt><dd>${esc(
            val
          )}</dd>`;
        })
        .join('')}
    </dl>`;
}

function userLabelById(id) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  return u ? u.name : `#${id}`;
}

function describeStepForList(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `${s.name}（表單指定）`;
  if (s.assignType === 'dept_head') return `${s.name}（自選／可略過）`;
  if (s.assignType === 'cosign_pick') return `${s.name}（會簽選填）`;
  if (s.assignType === 'users_pick') return `${s.name}（申請人自選）`;
  if (s.assignType === 'department') return `${s.name}（${s.department || '單位'}）`;
  if (s.assignType === 'users' || (s.approverIds && s.approverIds.length)) {
    const names = (s.approverIds || []).map(userLabelById).join('、');
    return names ? `${s.name}（${names}）` : s.name;
  }
  return s.name;
}
