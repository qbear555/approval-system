function renderFormDataBlock(formFields, formData, steps, templateSteps) {
  const fields = formFields || [];
  const data = formData || {};
  const leaveTypeVal = String(data.leave_type || data.假別 || '');
  const personalDisp = /事假/.test(leaveTypeVal)
    ? computePersonalLeaveDisplay(data)
    : isSickLeaveTypeClient(leaveTypeVal)
      ? computeSickLeaveDisplay(data)
      : null;
  /** 表單鍵 users_pick_N／dept_head_N／cosign_N 的 N＝流程模板序 */
  const stepForFormKey = (n, assignType) => {
    const num = Number(n);
    const tpl = Array.isArray(templateSteps) ? templateSteps : [];
    const fromWfSame = tpl.find(
      (s) => Number(s.order) === num && s.assignType === assignType
    );
    if (fromWfSame) return fromWfSame;
    const fromWfOrder = tpl.find((s) => Number(s.order) === num);
    if (fromWfOrder) return fromWfOrder;
    const list = Array.isArray(steps) ? steps : [];
    const byTpl = list.find(
      (s) =>
        Number(s.templateOrder) === num &&
        (!assignType || s.assignType === assignType)
    );
    if (byTpl) return byTpl;
    const byOrderType = list.find(
      (s) => Number(s.order) === num && s.assignType === assignType
    );
    if (byOrderType) return byOrderType;
    const same = list.filter((s) => s.assignType === assignType);
    if (same.length === 1) return same[0];
    return list.find((s) => Number(s.order) === num) || null;
  };
  const labelForFormKey = (n, assignType, fallback) => {
    const step = stepForFormKey(n, assignType);
    const name = String(step?.name || '').trim();
    if (!name) return fallback;
    const tpl = Array.isArray(templateSteps) ? templateSteps : [];
    const dup =
      tpl.filter((s) => String(s.name || '').trim() === name).length > 1;
    return dup ? `${name}（第${Number(n)}關）` : name;
  };
  // 部門主管自選欄位（dept_head_N）
  const deptHeadRows = Object.keys(data)
    .filter((k) => /^dept_head_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      const label = labelForFormKey(
        k.replace('dept_head_', ''),
        'dept_head',
        '部門主管'
      );
      let display = '略過';
      if (v && v !== 'skip' && Number(v)) {
        const u = (state.users || []).find((x) => x.id === Number(v));
        display = u
          ? u.department
            ? `${u.name}（${u.department}）`
            : u.name
          : data[`${k}__label`] || data[`${k}__name`] || `#${v}`;
      }
      return `<dt>${esc(label)}</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  // 申請人自選簽核人（users_pick_N）：標籤用步驟名稱（信用額度＝業務人員，勿寫死副總）
  const usersPickRows = Object.keys(data)
    .filter((k) => /^users_pick_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      const label = labelForFormKey(
        k.replace('users_pick_', ''),
        'users_pick',
        '自選簽核人'
      );
      let display = data[`${k}__label`] || '—';
      if (v === 'skip' || v === '' || v == null || v === '0') {
        display = '略過';
      } else if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (String(v) === 'all') {
        display = '全部';
      } else if (v) {
        const ids = String(v)
          .split(/[,，\s]+/)
          .map(Number)
          .filter((n) => n > 0);
        if (ids.length) {
          display = ids
            .map((id) => {
              const u = (state.users || []).find((x) => x.id === id);
              return u
                ? u.department
                  ? `${u.name}（${u.department}）`
                  : u.name
                : `#${id}`;
            })
            .join('、');
        }
      }
      return `<dt style="white-space:nowrap">${esc(label)}</dt><dd style="white-space:nowrap">${esc(display)}</dd>`;
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
        const ids = String(v)
          .split(/[,，\s]+/)
          .map(Number)
          .filter((n) => n > 0);
        if (ids.length) {
          display = ids
            .map((id) => {
              const u = (state.users || []).find((x) => x.id === id);
              return u
                ? u.department
                  ? `${u.name}（${u.department}）`
                  : u.name
                : `#${id}`;
            })
            .join('、');
        }
      }
      const label = labelForFormKey(
        k.replace('cosign_', ''),
        'cosign_pick',
        '會簽人員'
      );
      return `<dt>${esc(label)}</dt><dd>${esc(display)}</dd>`;
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
        ${keys
          .map((k) => {
            if (k === 'attendee_ids') return '';
            if (k === 'attendees') {
              return `<dt>出席人員</dt><dd>${esc(String(data[k] || '—'))}</dd>`;
            }
            if (personalDisp && k === 'hours') return '';
            if (personalDisp && k === 'days') {
              return `<dt>${esc(k)}</dt><dd>${esc(personalDisp.text)}</dd>`;
            }
            const shown = isMoneyFormField(null, k)
              ? formatYuanWanStyle(data[k])
              : renderPlainValueHtml(data[k]);
            return `<dt>${esc(k)}</dt><dd>${
              isMoneyFormField(null, k) ? esc(shown) : shown
            }</dd>`;
          })
          .join('')}
        ${deptHeadRows}
        ${cosignRows}
        ${usersPickRows}
      </dl>`;
  }
  return `
    <h3 style="margin-top:20px">表單資料</h3>
    <dl class="kv">
      ${fields
        .map((f) => {
          if (personalDisp && f.id === 'days') {
            return `<dt>${esc(f.label)}</dt><dd>${esc(personalDisp.text)}</dd>`;
          }
          if (personalDisp && f.id === 'hours') return '';
          if (f.id === 'period_roc_year') return '';
          if (f.id === 'period_month') {
            const y = welfareCurrentRocYear(data);
            const m = String(data[f.id] || '').replace(/[^\d]/g, '');
            const text = m ? `民國 ${y} 年 ${Number(m)} 月` : '—';
            return `<dt>所屬月份</dt><dd>${esc(text)}</dd>`;
          }
          if (f.id === 'submit_month') {
            const m = String(data[f.id] || '').replace(/[^\d]/g, '');
            const text = m ? `${Number(m)}月` : '—';
            return `<dt>${esc(f.label)}</dt><dd>${esc(text)}</dd>`;
          }
          if (f.id === 'stats_start') {
            const fmt = (d) => {
              const s = String(d || '').trim();
              const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (!m) return s || '—';
              const y = Number(m[1]);
              const roc = y > 1911 ? y - 1911 : y;
              return `民國 ${roc} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
            };
            const a = fmt(data.stats_start);
            const b = fmt(data.stats_end);
            const text =
              a !== '—' && b !== '—' ? `${a} ～ ${b}` : a !== '—' ? a : '—';
            return `<dt>統計時間</dt><dd>${esc(text)}</dd>`;
          }
          if (f.id === 'stats_end') return '';
          if (f.id === 'attendee_ids') return '';
          if (f.id === 'attendees') {
            return `<dt>出席人員</dt><dd>${esc(String(data.attendees || '—'))}</dd>`;
          }
          if (f.id === 'followup_items') {
            const rows = parseFollowupItemsClient(data[f.id]);
            if (!rows.length) {
              return `<dt>${esc(f.label)}</dt><dd>—</dd>`;
            }
            const body = `<table class="form-view-table followup-ledger"><thead><tr><th>後續交辦事項</th><th>承辦人</th><th>完成期限</th></tr></thead><tbody>${rows
              .map(
                (it) =>
                  `<tr><td>${esc(it.item || '')}</td><td>${esc(it.owner || '')}</td><td>${esc(it.due || '')}</td></tr>`
              )
              .join('')}</tbody></table>`;
            return `<dt>${esc(f.label)}</dt><dd>${body}</dd>`;
          }
          const body = isMoneyFormField(f)
            ? esc(formatFormValue(f, data[f.id], data))
            : renderFormValueHtml(f, data[f.id], data);
          return `<dt>${esc(f.label)}</dt><dd>${body}</dd>`;
        })
        .join('')}
      ${deptHeadRows}
      ${cosignRows}
      ${usersPickRows}
    </dl>`;
}

function isOfficeFileName(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isPreviewableAttachmentName(name, mime) {
  const n = String(name || '');
  const m = String(mime || '').toLowerCase();
  return (
    m.includes('pdf') ||
    /\.pdf$/i.test(n) ||
    m.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(n)
  );
}

async function renderPdfWithPdfJs(blob, containerEl) {
  if (!containerEl) return;
  if (!window.pdfjsLib) {
    containerEl.innerHTML =
      '<div class="error-msg" style="margin:16px;text-align:center">PDF.js 函式庫尚未載入，請按上方「在新分頁開啟」或「下載」。</div>';
    return;
  }
  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      '/vendor/pdfjs/pdf.worker.min.js';
  }
  containerEl.innerHTML =
    '<div class="muted" style="padding:28px;text-align:center">正在透過 PDF.js 解析並繪製高畫質頁面…</div>';
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    containerEl.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'pdfjs-pages-scroll';
    wrap.style.cssText =
      'overflow-y:auto;max-height:min(82vh,900px);display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px;background:#374151;border-radius:8px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.2);';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.min(
        containerEl.clientWidth ? containerEl.clientWidth - 48 : 880,
        1100
      );
      const scale = Math.max(1.2, targetWidth / unscaledViewport.width);
      const viewport = page.getViewport({ scale });

      const pageBox = document.createElement('div');
      pageBox.style.cssText =
        'position:relative;display:flex;flex-direction:column;align-items:center;';

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.cssText =
        'max-width:100%;height:auto;box-shadow:0 6px 16px rgba(0,0,0,0.35);border-radius:4px;background:#fff;';

      const pageLabel = document.createElement('div');
      pageLabel.textContent = `第 ${i} / ${pdf.numPages} 頁`;
      pageLabel.style.cssText =
        'color:#f3f4f6;font-size:0.8rem;margin-top:6px;font-weight:500;';

      pageBox.appendChild(canvas);
      pageBox.appendChild(pageLabel);
      wrap.appendChild(pageBox);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
    containerEl.appendChild(wrap);
  } catch (err) {
    console.error('PDF.js render failed', err);
    containerEl.innerHTML = `<div class="error-msg" style="margin:16px;text-align:center">PDF.js 繪製失敗：${esc(
      err.message || '未知錯誤'
    )}。請使用上方「在新分頁開啟」或「下載」。</div>`;
  }
}

async function openRequestPdfPreview(reqId, title) {
  const id = Number(reqId);
  if (!id) return;
  try {
    const meta = await api(`/api/requests/${id}/pdf?preview=1`, {
      expectBlob: true,
      returnMeta: true,
    });
    const name = title || meta.filename || `申請單#${id}.pdf`;
    let previewBlob = meta.blob;
    if (!previewBlob.type || !previewBlob.type.includes('pdf')) {
      previewBlob = new Blob([await meta.blob.arrayBuffer()], {
        type: 'application/pdf',
      });
    }
    const url = URL.createObjectURL(previewBlob);
    const token =
      (typeof state !== 'undefined' && state?.token) ||
      localStorage.getItem('approval_token') ||
      '';
    const directUrl = `/api/requests/${id}/pdf?preview=1${
      token ? `&token=${encodeURIComponent(token)}` : ''
    }`;

    const isMobileDevice =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent || ''
      ) || window.innerWidth < 768;

    const modalHtml = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px">
        <div>
          <h3 style="margin:0 0 4px">已核准申請單預覽</h3>
          <p class="muted" style="margin:0;font-size:0.9rem;word-break:break-all">${esc(name)}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn outline sm" id="btn-req-pdf-newtab">在新分頁開啟</button>
          <button type="button" class="btn outline sm" id="btn-req-pdf-toggle">切換畫布檢視</button>
          <button type="button" class="btn outline sm" id="btn-req-pdf-download">下載</button>
          <button type="button" class="btn outline sm" data-close-modal>關閉</button>
        </div>
      </div>
      <div id="att-preview-box" style="position:relative;width:100%;min-height:360px">
        <iframe class="att-preview-iframe" title="${esc(
          name
        )}" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>
      </div>
    `;

    openModal(modalHtml);
    const panel = $('#modal-panel');
    if (panel) {
      panel.classList.add('wide', 'wide-announcement', 'wide-att-preview');
    }

    $('#btn-req-pdf-newtab')?.addEventListener('click', () => {
      window.open(directUrl || url, '_blank', 'noopener');
    });

    $('#btn-req-pdf-download')?.addEventListener('click', async () => {
      try {
        const { blob, filename } = await api(`/api/requests/${id}/pdf`, {
          returnMeta: true,
        });
        const dl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dl;
        a.download = filename || name;
        a.click();
        URL.revokeObjectURL(dl);
      } catch (e) {
        toast(e.message || '下載失敗', 'error');
      }
    });

    let isCanvasMode = false;
    const box = $('#att-preview-box');
    const toggleBtn = $('#btn-req-pdf-toggle');

    const switchToCanvas = async () => {
      if (!box) return;
      isCanvasMode = true;
      if (toggleBtn) toggleBtn.textContent = '切換原生檢視';
      await renderPdfWithPdfJs(previewBlob, box);
    };

    const switchToIframe = () => {
      if (!box) return;
      isCanvasMode = false;
      if (toggleBtn) toggleBtn.textContent = '切換畫布檢視';
      box.innerHTML = `<iframe class="att-preview-iframe" title="${esc(
        name
      )}" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>`;
    };

    toggleBtn?.addEventListener('click', () => {
      if (isCanvasMode) switchToIframe();
      else switchToCanvas();
    });

    if (isMobileDevice && window.pdfjsLib) {
      switchToCanvas();
    }

    setTimeout(() => URL.revokeObjectURL(url), 300_000);
  } catch (e) {
    toast(e.message || '預覽失敗', 'error');
  }
}

function formatApprovedRequestLabel(r) {
  if (!r) return '';
  const when = String(r.completed_at || '').replace('T', ' ').slice(0, 16);
  const wf = r.workflow_name ? `${r.workflow_name} · ` : '';
  const who = r.requester_name ? `（${r.requester_name}）` : '';
  return `#${r.id}　${wf}${r.title || ''}${who}${when ? `　${when}` : ''}`;
}

/**
 * 挑選已核准申請單作為附件
 * @param {{ excludeIds?: number[], alreadySelected?: number[], onConfirm: (rows: object[]) => void }} opts
 */
async function openApprovedRequestPicker(opts = {}) {
  const exclude = new Set((opts.excludeIds || []).map(Number).filter((n) => n > 0));
  const already = new Set((opts.alreadySelected || []).map(Number).filter((n) => n > 0));
  openModal(`
    <h3 style="margin-top:0">附加已核准申請單</h3>
    <p class="muted" style="margin:-4px 0 10px;font-size:0.9rem">
      選擇已簽核完成的申請單，送出後會以 PDF 作為本單附件；可先預覽再加入。
    </p>
    <div class="field" style="margin-bottom:8px">
      <input id="appr-pick-q" type="search" placeholder="搜尋單號、主旨、流程、申請人…" autocomplete="off" />
    </div>
    <div id="appr-pick-list" class="appr-pick-list"><div class="muted" style="padding:16px">載入中…</div></div>
    <div class="modal-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn primary" id="appr-pick-ok">加入附件</button>
      <button type="button" class="btn outline" data-close-modal>取消</button>
      <span class="muted" id="appr-pick-count" style="font-size:0.85rem"></span>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');
  const listEl = $('#appr-pick-list');
  const countEl = $('#appr-pick-count');
  let rows = [];
  let timer = null;

  const selectedIds = () =>
    [...(listEl?.querySelectorAll('input[data-appr-pick]:checked') || [])]
      .map((el) => Number(el.value))
      .filter((n) => n > 0);

  const syncCount = () => {
    if (countEl) {
      const n = selectedIds().length;
      countEl.textContent = n ? `已選 ${n} 張` : '';
    }
  };

  const renderRows = (items) => {
    const vis = (items || []).filter((r) => !exclude.has(Number(r.id)));
    if (!vis.length) {
      listEl.innerHTML = `<div class="muted" style="padding:16px">沒有符合的已核准申請單</div>`;
      syncCount();
      return;
    }
    listEl.innerHTML = vis
      .map((r) => {
        const checked = already.has(Number(r.id)) ? 'checked' : '';
        const disabled = already.has(Number(r.id)) ? 'disabled' : '';
        return `
        <div class="appr-pick-row" data-appr-id="${r.id}">
          <label class="appr-pick-check">
            <input type="checkbox" data-appr-pick value="${r.id}" ${checked} ${disabled} />
            <span>
              <strong>#${r.id}</strong>
              ${r.workflow_name ? `<span class="tag" style="margin-left:6px">${esc(r.workflow_name)}</span>` : ''}
              <div style="margin-top:2px">${esc(r.title || '')}</div>
              <div class="muted" style="font-size:0.8rem">
                ${esc(r.requester_name || '')}
                ${r.completed_at ? ` · ${esc(String(r.completed_at).replace('T', ' ').slice(0, 16))}` : ''}
                ${already.has(Number(r.id)) ? ' · 已加入' : ''}
              </div>
            </span>
          </label>
          <button type="button" class="btn outline sm" data-appr-preview="${r.id}" data-appr-title="${esc(
            formatApprovedRequestLabel(r)
          )}">預覽</button>
        </div>
        <div class="appr-pick-iframe-wrap hidden" id="appr-prev-${r.id}"></div>`;
      })
      .join('');
    listEl.querySelectorAll('[data-appr-pick]').forEach((el) => {
      el.addEventListener('change', syncCount);
    });
    listEl.querySelectorAll('[data-appr-preview]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rid = Number(btn.dataset.apprPreview);
        const box = $(`#appr-prev-${rid}`);
        if (!box) return;
        if (!box.classList.contains('hidden') && box.querySelector('iframe')) {
          box.classList.add('hidden');
          box.innerHTML = '';
          btn.textContent = '預覽';
          return;
        }
        btn.disabled = true;
        btn.textContent = '載入中…';
        try {
          const meta = await api(`/api/requests/${rid}/pdf?preview=1`, {
            expectBlob: true,
            returnMeta: true,
          });
          const url = URL.createObjectURL(meta.blob);
          listEl.querySelectorAll('.appr-pick-iframe-wrap').forEach((w) => {
            if (w !== box) {
              w.classList.add('hidden');
              w.innerHTML = '';
            }
          });
          listEl.querySelectorAll('[data-appr-preview]').forEach((b) => {
            if (b !== btn) b.textContent = '預覽';
          });
          box.innerHTML = `<iframe class="appr-pick-iframe" title="${esc(
            btn.dataset.apprTitle || `申請單#${rid}`
          )}" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>`;
          box.classList.remove('hidden');
          btn.textContent = '收合預覽';
          setTimeout(() => URL.revokeObjectURL(url), 180_000);
        } catch (e) {
          toast(e.message || '預覽失敗', 'error');
          btn.textContent = '預覽';
        } finally {
          btn.disabled = false;
        }
      });
    });
    syncCount();
  };

  const load = async () => {
    const q = String($('#appr-pick-q')?.value || '').trim();
    if (listEl) listEl.innerHTML = `<div class="muted" style="padding:16px">載入中…</div>`;
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      qs.set('limit', '80');
      if (exclude.size === 1) qs.set('exclude_id', String([...exclude][0]));
      const data = await api(`/api/requests/approved-for-attach?${qs.toString()}`);
      rows = data.requests || [];
      renderRows(rows);
    } catch (e) {
      if (listEl) {
        listEl.innerHTML = `<div class="error-msg" style="padding:16px">${esc(e.message || '載入失敗')}</div>`;
      }
    }
  };

  $('#appr-pick-q')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 280);
  });
  $('#appr-pick-ok')?.addEventListener('click', () => {
    const ids = selectedIds().filter((id) => !already.has(id));
    const picked = ids
      .map((id) => rows.find((r) => Number(r.id) === id))
      .filter(Boolean);
    closeModal();
    if (typeof opts.onConfirm === 'function') opts.onConfirm(picked);
  });
  await load();
}

async function openAttachmentPreview(attId, fileName) {
  try {
    const meta = await api(`/api/attachments/${attId}?inline=1`, {
      expectBlob: true,
      returnMeta: true,
    });
    const name = String(meta.filename || fileName || `附件#${attId}`);
    const ct = String(meta.contentType || meta.blob?.type || '').toLowerCase();
    const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
    const isImg =
      ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);

    // 強制校正 PDF Blob MIME 類型，避免 Chromium/Firefox 將其當作 octet-stream 阻擋渲染
    let previewBlob = meta.blob;
    if (isPdf && (!previewBlob.type || !previewBlob.type.includes('pdf'))) {
      previewBlob = new Blob([await meta.blob.arrayBuffer()], {
        type: 'application/pdf',
      });
    }
    const url = URL.createObjectURL(previewBlob);

    // 取得帶 Token 之直連連結（新分頁開啟可供原生瀏覽器 PDF 閱讀器直接解析）
    const token =
      (typeof state !== 'undefined' && state?.token) ||
      localStorage.getItem('approval_token') ||
      '';
    const directUrl = `/api/attachments/${attId}?inline=1${
      token ? `&token=${encodeURIComponent(token)}` : ''
    }`;

    const isMobileDevice =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent || ''
      ) || window.innerWidth < 768;

    const modalHtml = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px">
        <div>
          <h3 style="margin:0 0 4px">附件檢視</h3>
          <p class="muted" style="margin:0;font-size:0.9rem;word-break:break-all">${esc(name)}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${
            isPdf
              ? `<button type="button" class="btn outline sm" id="btn-att-newtab" title="在新分頁以完整瀏覽器模式開啟">在新分頁開啟</button>
                 <button type="button" class="btn outline sm" id="btn-att-toggle-mode" title="在瀏覽器原生檢視與 PDF.js 高畫質畫布檢視間切換">切換畫布檢視</button>`
              : ''
          }
          <button type="button" class="btn outline sm" id="btn-att-download">下載</button>
          <button type="button" class="btn outline sm" data-close-modal>關閉</button>
        </div>
      </div>
      <div id="att-preview-box" style="position:relative;width:100%;min-height:360px">
        ${
          isPdf
            ? `<iframe class="att-preview-iframe" title="${esc(
                name
              )}" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>`
            : isImg
            ? `<img class="att-preview-img" alt="${esc(name)}" src="${url}" />`
            : `<p class="muted" style="padding:20px;text-align:center">此格式無法內嵌預覽，請改用右上角「下載」。</p>`
        }
      </div>
    `;

    openModal(modalHtml);
    const panel = $('#modal-panel');
    if (panel) {
      panel.classList.add('wide', 'wide-announcement', 'wide-att-preview');
    }

    // 綁定「在新分頁開啟」
    $('#btn-att-newtab')?.addEventListener('click', () => {
      window.open(directUrl || url, '_blank', 'noopener');
    });

    // 綁定「下載」
    $('#btn-att-download')?.addEventListener('click', async () => {
      try {
        const dlBlob = await api(`/api/attachments/${attId}`, {
          expectBlob: true,
        });
        const dl = URL.createObjectURL(dlBlob);
        const a = document.createElement('a');
        a.href = dl;
        a.download = name;
        a.click();
        URL.revokeObjectURL(dl);
      } catch (e) {
        toast(e.message || '下載失敗', 'error');
      }
    });

    // PDF 模式切換邏輯 (原生 iframe ↔ PDF.js Canvas)
    if (isPdf) {
      let isCanvasMode = false;
      const box = $('#att-preview-box');
      const toggleBtn = $('#btn-att-toggle-mode');

      const switchToCanvas = async () => {
        if (!box) return;
        isCanvasMode = true;
        if (toggleBtn) toggleBtn.textContent = '切換原生檢視';
        await renderPdfWithPdfJs(previewBlob, box);
      };

      const switchToIframe = () => {
        if (!box) return;
        isCanvasMode = false;
        if (toggleBtn) toggleBtn.textContent = '切換畫布檢視';
        box.innerHTML = `<iframe class="att-preview-iframe" title="${esc(
          name
        )}" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>`;
      };

      toggleBtn?.addEventListener('click', () => {
        if (isCanvasMode) {
          switchToIframe();
        } else {
          switchToCanvas();
        }
      });

      // 行動裝置自動啟用 PDF.js Canvas 檢視，確保 100% 可直接在手機平版瀏覽
      if (isMobileDevice && window.pdfjsLib) {
        switchToCanvas();
      }
    }

    setTimeout(() => URL.revokeObjectURL(url), 300_000);
  } catch (e) {
    toast(e.message || '附件開啟失敗', 'error');
  }
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
          const isPdf = /\.pdf$/i.test(String(a.original_name || '')) ||
            /pdf/i.test(String(a.mime_type || ''));
          const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(a.original_name || '')) ||
            /^image\//i.test(String(a.mime_type || ''));
          return `
        <li style="margin:6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
          <button type="button" class="linkish" data-dl-att="${a.id}" data-dl-name="${esc(a.original_name || '')}" data-att-view="${isPdf || isImg ? '1' : '0'}">${esc(a.original_name)}</button>
          ${
            a.source_request_id
              ? `<span class="tag" style="background:#ecfdf5;color:#047857">已核准申請單 #${esc(
                  String(a.source_request_id)
                )}</span>`
              : ''
          }
          ${
            isPdf || isImg
              ? `<button type="button" class="btn outline sm" data-view-att="${a.id}" data-dl-name="${esc(a.original_name || '')}">線上檢視</button>`
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

let onlyOfficeScriptPromise = null;
let onlyOfficeEditorInstance = null;
/** @type {(() => void)|null} */
let onlyOfficeResizeHandler = null;

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
  if (onlyOfficeResizeHandler) {
    try {
      window.removeEventListener('resize', onlyOfficeResizeHandler);
    } catch {
      /* ignore */
    }
    onlyOfficeResizeHandler = null;
  }
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

async function openOnlyOfficeEditor(attachmentId, requestId) {
  try {
    const data = await api(`/api/onlyoffice/editor/${attachmentId}`);
    if (!data?.config || !data.docsApiScript) {
      throw new Error(data?.error || '無法取得編輯器設定');
    }
    // HTTPS 頁面不可載入 http:// 腳本（混合內容）；改走同源 /web-apps
    let scriptUrl = data.docsApiScript;
    if (
      typeof location !== 'undefined' &&
      location.protocol === 'https:' &&
      /^http:\/\//i.test(scriptUrl)
    ) {
      scriptUrl = `${location.origin}/web-apps/apps/api/documents/api.js`;
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
      panel.className = 'modal-panel modal-panel-oo';
    }

    const host = document.getElementById('onlyoffice-placeholder');
    const shell = document.querySelector('.oo-editor-shell');
    const bar = document.querySelector('.oo-editor-bar');

    function measureEditorHeight() {
      const panelH =
        panel?.clientHeight ||
        Math.floor(window.innerHeight * 0.96);
      const barH = bar?.offsetHeight || 52;
      // 近全螢幕：扣除工具列，至少 560px
      return Math.max(560, panelH - barH);
    }

    const editorH = measureEditorHeight();
    if (host) {
      host.style.height = `${editorH}px`;
      host.style.minHeight = `${editorH}px`;
      host.style.width = '100%';
    }
    if (shell) {
      shell.style.height = '100%';
    }

    const cfg = {
      ...data.config,
      width: '100%',
      height: `${editorH}px`,
      type: 'desktop',
      events: {
        onDocumentStateChange: () => {},
        onError: (e) => {
          console.error('OnlyOffice error', e);
          toast(e?.data || 'OnlyOffice 編輯器錯誤', 'error');
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
          compactToolbar: false,
          zoom: 100,
          autosave: true,
        },
      };
    }

    onlyOfficeEditorInstance = new window.DocsAPI.DocEditor(
      'onlyoffice-placeholder',
      cfg
    );

    if (onlyOfficeResizeHandler) {
      window.removeEventListener('resize', onlyOfficeResizeHandler);
    }
    onlyOfficeResizeHandler = () => {
      const h = measureEditorHeight();
      if (host) {
        host.style.height = `${h}px`;
        host.style.minHeight = `${h}px`;
      }
      try {
        if (
          onlyOfficeEditorInstance &&
          typeof onlyOfficeEditorInstance.resizeEditor === 'function'
        ) {
          onlyOfficeEditorInstance.resizeEditor();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onlyOfficeResizeHandler);

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
    leave_month_days: '本月累計日數',
    leave_month_hours: '本月累計時數',
    leave_year_days: '本年累計日數',
    leave_year_hours: '本年累計時數',
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
    leave_month_days: '本月累計日數',
    leave_month_hours: '本月累計時數',
    leave_year_days: '本年累計日數',
    leave_year_hours: '本年累計時數',
    pc_acquired_date: '原電腦取得日期',
    check_os: '作業系統（Windows10）',
    check_memory: '記憶體（4G 以上）',
    check_disk: '硬碟（SSD 500G 以上）',
    check_3dmark: '3DMARK 分數（500 分以上）',
    check_email: '電子郵件定期清理',
    check_backup: '重要資料定期備份',
    check_battery: '電池容量（70% 以下）',
    check_os_note: '作業系統不符合說明',
    check_memory_note: '記憶體不符合說明',
    check_disk_note: '硬碟不符合說明',
    check_3dmark_note: '3DMARK 分數不符合說明',
    check_email_note: '電子郵件不符合說明',
    check_backup_note: '重要資料不符合說明',
    check_battery_note: '電池容量不符合說明',
    handle_result: '電腦處理情形',
    handle_note: '處理說明／其他',
    actual_start: '實際工時開始',
    actual_end: '實際工時結束',
    actual_hours: '實際總計（小時）',
    comp_leave_balance: '目前累計可用時數（補休）',
    // 信用額度：簽核單位填寫（中文說明；金額單位：元）
    requested_credit_limit: '申請信用額度（元）',
    sales_requested_limit: '業務員申請額度（元）',
    reason_for_increase: '增加額度原由',
    sales_conditions: '業務員要求條件',
    finance_suggested_limit: '財務建議額度（元）',
    finance_conditions: '財務要求條件',
    vp_suggested_limit: '副總經理建議額度（元）',
    vp_conditions: '副總經理要求條件',
    gm_approved_limit: '總經理核定額度（元）',
    gm_conditions: '總經理要求條件',
    finance_established_limit: '財務部建立額度（元）',
    finance_note: '財務部建檔備註',
    finance_confirm_note: '財務部建檔備註',
    sales_revenue: '銷貨收入（元）',
    sales_cost: '銷貨成本（元）',
    sales_gross_profit: '銷貨毛利（元）',
    sales_gross_diff_note: '毛利差異說明',
    sales_remark: '備註說明',
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
  const isCredit =
    flat.requested_credit_limit != null ||
    flat.vp_suggested_limit != null ||
    flat.gm_approved_limit != null ||
    flat.reason_for_increase != null ||
    flat.sales_conditions != null ||
    flat.vp_conditions != null ||
    flat.gm_conditions != null;
  const isSalesStat =
    flat.sales_revenue != null ||
    flat.sales_cost != null ||
    flat.sales_gross_profit != null;
  const sectionTitle = isIt
    ? '管理部／簽核單位填寫'
    : isCredit
      ? '核決單位填寫（信用額度）'
      : isSalesStat
        ? '財務單位填寫'
        : flat.hr_leave_type != null ||
            flat.remaining_special_leave_days != null ||
            flat.leave_month_days != null ||
            flat.leave_year_days != null
          ? '人事／簽核單位填寫'
          : '簽核單位填寫';
  // 顯示順序：信用額度核決 → 假別／特休 → 本月／本年累計 → 其餘（不再顯示特休小時）
  const creditOrder = [
    'sales_revenue',
    'sales_cost',
    'sales_gross_profit',
    'sales_gross_diff_note',
    'sales_remark',
    'requested_credit_limit',
    'sales_requested_limit',
    'reason_for_increase',
    'sales_conditions',
    'finance_suggested_limit',
    'finance_conditions',
    'vp_suggested_limit',
    'vp_conditions',
    'gm_approved_limit',
    'gm_conditions',
    'finance_established_limit',
    'finance_note',
    'finance_confirm_note',
  ];
  const order = [
    ...creditOrder,
    'hr_leave_type',
    'remaining_special_leave_days',
    'leave_month_days',
    'leave_month_hours',
    'leave_year_days',
    'leave_year_hours',
    'hr_note',
  ];
  const orderedKeys = [
    ...order.filter((k) => keys.includes(k)),
    ...keys.filter(
      (k) =>
        !order.includes(k) &&
        k !== 'remaining_special_leave_hours' &&
        !/特休.*小時|剩餘.*小時/.test(String(k))
    ),
  ];
  /** 本月／本年累計：合併為「X 日 Y 時」一列顯示 */
  const fmtDayHour = (d, h) => {
    const hasD = d != null && d !== '';
    const hasH = h != null && h !== '';
    if (!hasD && !hasH) return null;
    const parts = [];
    if (hasD) parts.push(`${d} 日`);
    if (hasH) parts.push(`${h} 時`);
    return parts.join(' ');
  };
  const monthCum = fmtDayHour(flat.leave_month_days, flat.leave_month_hours);
  const yearCum = fmtDayHour(flat.leave_year_days, flat.leave_year_hours);
  const skipCumKeys = new Set([
    'leave_month_days',
    'leave_month_hours',
    'leave_year_days',
    'leave_year_hours',
  ]);
  const displayRows = [];
  for (const k of orderedKeys) {
    if (skipCumKeys.has(k)) continue;
    let val = flat[k];
    if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
      val = '—';
    }
    if (
      val != null &&
      val !== '' &&
      val !== '—' &&
      (/limit|額度/.test(k) ||
        /^(sales_revenue|sales_cost|sales_gross_profit)$/.test(k)) &&
      !/條件|原由|備註|note|condition|reason/i.test(k)
    ) {
      // 例：1230478 → 123萬478元
      val = formatYuanWanStyle(val);
    }
    displayRows.push({ label: labelForApproverField(k, flat), val });
    if (k === 'remaining_special_leave_days') {
      if (monthCum) displayRows.push({ label: '本月累計', val: monthCum });
      if (yearCum) displayRows.push({ label: '本年累計', val: yearCum });
    }
  }
  // 若無剩餘特休日數列但仍有累計，補在假別後或開頭
  if (
    (monthCum || yearCum) &&
    !displayRows.some((r) => r.label === '本月累計' || r.label === '本年累計')
  ) {
    const insertAt = Math.max(
      0,
      displayRows.findIndex((r) => /假別/.test(r.label)) + 1
    );
    const extra = [];
    if (monthCum) extra.push({ label: '本月累計', val: monthCum });
    if (yearCum) extra.push({ label: '本年累計', val: yearCum });
    displayRows.splice(insertAt, 0, ...extra);
  }
  return `
    <h3 style="margin-top:20px">${sectionTitle}</h3>
    <dl class="kv">
      ${displayRows
        .map((row) => {
          return `<dt>${esc(row.label)}</dt><dd>${esc(row.val)}</dd>`;
        })
        .join('')}
    </dl>`;
}

/** 依表單名稱與分類回傳代表圖示 */
function getWorkflowIcon(name = '', category = '') {
  const n = String(name || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  if (/請假|休假|特別休假|病假|事假|特休|假單/.test(n)) return '🏖️';
  if (/出差/.test(n)) return '🚄';
  if (/延長工時|加班/.test(n)) return '⏱️';
  if (/福委|補助|三節/.test(n)) return '🎁';
  if (/請購|採購/.test(n)) return '🛒';
  if (/費用|報支|報銷|請款/.test(n)) return '💰';
  if (/信用額度|授信/.test(n)) return '💳';
  if (/電腦|異常報修|報修|維修|it/i.test(n)) return '💻';
  if (/會議|例會/.test(n)) return '📅';
  if (/業務|銷售|業績/.test(n)) return '📊';
  if (/庫存|調撥|調庫/.test(n)) return '📦';
  if (/作廢/.test(n)) return '🚫';
  if (/一般簽呈|簽呈|公文/.test(n)) return '📝';
  if (c.includes('人事')) return '👥';
  if (c.includes('財務') || c.includes('採購')) return '💵';
  if (c.includes('資訊') || c.includes('總務')) return '🛠️';
  if (c.includes('業務')) return '📈';
  return '📋';
}

/** 依分類回傳 CSS 類別（配色用） */
function getCategoryClass(category = '') {
  const c = String(category || '');
  if (c.includes('人事')) return 'cat-hr';
  if (c.includes('財務') || c.includes('採購')) return 'cat-fin';
  if (c.includes('資訊') || c.includes('總務')) return 'cat-it';
  if (c.includes('業務')) return 'cat-sales';
  return 'cat-memo';
}

if (typeof window !== 'undefined') {
  window.openAttachmentPreview = openAttachmentPreview;
  window.renderPdfWithPdfJs = renderPdfWithPdfJs;
  window.isPreviewableAttachmentName = isPreviewableAttachmentName;

  if (!window.__globalAttClickDelegationBound) {
    window.__globalAttClickDelegationBound = true;
    document.addEventListener('click', (e) => {
      const viewBtn = e.target && e.target.closest && e.target.closest('[data-view-att]');
      if (viewBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = viewBtn.dataset.viewAtt;
        const name = viewBtn.dataset.dlName || '';
        openAttachmentPreview(id, name);
        return;
      }
      const dlBtn = e.target && e.target.closest && e.target.closest('[data-dl-att]');
      if (
        dlBtn &&
        (dlBtn.dataset.attView === '1' ||
          (typeof isPreviewableAttachmentName === 'function' &&
            isPreviewableAttachmentName(dlBtn.dataset.dlName || '')))
      ) {
        e.preventDefault();
        e.stopPropagation();
        const id = dlBtn.dataset.dlAtt;
        const name = dlBtn.dataset.dlName || '';
        openAttachmentPreview(id, name);
      }
    });
  }
}

