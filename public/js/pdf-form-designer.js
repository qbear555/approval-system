/**
 * 紙本 PDF 模版畫布表單設計器與電子紙填報檢視模組 (PDF Form Canvas Designer & Viewer)
 * 零前端建置依賴，純原生 DOM + Canvas + Mozilla PDF.js
 */

(function (window) {
  'use strict';

  // 確保 PDF.js Worker 正常載入
  function initPdfJs() {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    }
  }

  // 輔助函式：產生唯一 ID
  function genFieldId(prefix) {
    return (prefix || 'f') + '_' + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 載入 PDF 或圖片並繪製至 Canvas
   * @param {string} fileUrl - PDF 或圖片之 URL
   * @param {HTMLCanvasElement} canvas - 目標 Canvas
   * @param {number} [pageNumber=1] - 頁碼
   * @returns {Promise<{ width: number, height: number, pageCount: number }>}
   */
  async function loadTemplateToCanvas(fileUrl, canvas, pageNumber = 1) {
    initPdfJs();
    const ctx = canvas.getContext('2d');
    const token = localStorage.getItem('approval_token') || '';
    let authedUrl = fileUrl;
    if (token && !authedUrl.includes('token=')) {
      authedUrl += (authedUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    }
    const isPdf = /\.pdf(\?.*)?$/i.test(fileUrl);

    if (isPdf && window.pdfjsLib) {
      const loadingTask = window.pdfjsLib.getDocument({
        url: authedUrl,
        httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const targetPage = Math.min(Math.max(1, pageNumber), numPages);
      const page = await pdf.getPage(targetPage);

      // 使用標準 1.5 縮放以保證高解析度清晰度
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;
      return {
        width: viewport.width,
        height: viewport.height,
        pageCount: numPages,
        pageNumber: targetPage,
      };
    } else {
      // 圖片格式底圖 (PNG, JPG)
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          canvas.width = img.width || 800;
          canvas.height = img.height || 1130;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({
            width: canvas.width,
            height: canvas.height,
            pageCount: 1,
            pageNumber: 1,
          });
        };
        img.onerror = (err) => reject(new Error('底圖載入失敗'));
        img.src = authedUrl;
      });
    }
  }

  /**
   * 在容器內渲染 PDF 模版與表單填寫/檢視圖層
   * @param {Object} options
   * @param {HTMLElement} options.container - 放置 Canvas 與圖層的 DOM
   * @param {string} options.templateFile - 模版路徑（如 templates/xxx.pdf）
   * @param {Array} options.fields - 欄位設定陣列 [{ id, name, type, rx, ry, rw, rh, ... }]
   * @param {Object} options.formData - 表單填寫值
   * @param {string} [options.mode='view'] - 'view' | 'fill'
   * @param {Function} [options.onFieldChange] - 填寫變更回呼 (fieldId, value) => {}
   * @param {Array} [options.actions] - 簽核紀錄（用於審核印章渲染）
   */
  async function renderPdfFormViewer({
    container,
    templateFile,
    fields = [],
    formData = {},
    mode = 'view',
    onFieldChange = null,
    actions = [],
    requester = null,
  }) {
    if (!container) return;
    container.innerHTML = `
      <div class="pdf-viewer-wrap" style="position:relative;margin:0 auto;display:inline-block;box-shadow:0 4px 15px rgba(0,0,0,0.1);border-radius:4px;overflow:hidden;background:#fff;">
        <canvas class="pdf-viewer-canvas" style="display:block;max-width:100%;height:auto;"></canvas>
        <div class="pdf-viewer-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:${mode === 'fill' ? 'auto' : 'none'};"></div>
      </div>
    `;

    const canvas = container.querySelector('.pdf-viewer-canvas');
    const overlay = container.querySelector('.pdf-viewer-overlay');
    const fileUrl = templateFile.startsWith('/') || templateFile.startsWith('http')
      ? templateFile
      : `/api/${templateFile}`;

    try {
      await loadTemplateToCanvas(fileUrl, canvas, 1);
    } catch (err) {
      container.innerHTML = `<div class="error-msg" style="padding:20px;text-align:center;">底圖模版載入失敗：${err.message}</div>`;
      return;
    }

    // 渲染各欄位方框
    fields.forEach((f) => {
      const fieldBox = document.createElement('div');
      fieldBox.className = `pdf-view-field-box pdf-type-${f.type || 'text'}`;
      fieldBox.style.position = 'absolute';
      fieldBox.style.left = `${(f.rx * 100).toFixed(3)}%`;
      fieldBox.style.top = `${(f.ry * 100).toFixed(3)}%`;
      fieldBox.style.width = `${(f.rw * 100).toFixed(3)}%`;
      fieldBox.style.height = `${(f.rh * 100).toFixed(3)}%`;
      fieldBox.style.boxSizing = 'border-box';
      fieldBox.style.display = 'flex';
      fieldBox.style.alignItems = 'center';

      const val = formData[f.id] !== undefined ? formData[f.id] : (formData[f.name] || '');

      // 1. 簽章欄位
      if (f.type === 'signature' || f.isStamp) {
        fieldBox.style.justifyContent = 'center';
        let signedUser = null;
        let signDate = '';
        if (f.role === 'requester') {
          signedUser = requester;
        } else {
          const stepOrder = f.stepOrder != null ? Number(f.stepOrder) : null;
          const approveAction = (actions || []).find(
            (a) => a.action === 'approve' && (stepOrder == null || a.step_order === stepOrder)
          );
          if (approveAction) {
            signedUser = {
              name: approveAction.actor_name || approveAction.actor_username || '審核人',
              signature_image: approveAction.signature_image || '',
            };
            signDate = approveAction.created_at ? approveAction.created_at.slice(0, 10) : '';
          }
        }

        if (signedUser) {
          if (signedUser.signature_image) {
            fieldBox.innerHTML = `<img src="${signedUser.signature_image}" style="max-width:100%;max-height:100%;object-fit:contain;" alt="簽章" />`;
          } else {
            fieldBox.innerHTML = `
              <div style="border:1.5px solid #dc2626;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:0.85rem;font-weight:700;text-align:center;line-height:1.2;background:rgba(254,242,242,0.6);">
                <div>${signedUser.name || '已核准'}</div>
                ${signDate ? `<div style="font-size:0.7rem;font-weight:normal;margin-top:1px;">${signDate}</div>` : ''}
              </div>
            `;
          }
        } else {
          // 未簽核狀態
          if (mode === 'fill' || mode === 'view') {
            fieldBox.innerHTML = `
              <div style="border:1px dashed #94a3b8;color:#94a3b8;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;border-radius:3px;background:rgba(248,250,252,0.4);">
                ${f.name || '簽核蓋章處'}
              </div>
            `;
          }
        }
        overlay.appendChild(fieldBox);
        return;
      }

      // 2. 填寫模式 (Fill Mode)
      if (mode === 'fill') {
        let inputEl;
        if (f.type === 'textarea') {
          inputEl = document.createElement('textarea');
          inputEl.style.resize = 'none';
          inputEl.style.height = '100%';
        } else if (f.type === 'checkbox') {
          inputEl = document.createElement('input');
          inputEl.type = 'checkbox';
          inputEl.checked = val === true || val === 'true' || val === 1 || val === '1';
          inputEl.style.cursor = 'pointer';
          inputEl.style.margin = 'auto';
        } else if (f.type === 'select') {
          inputEl = document.createElement('select');
          const opts = Array.isArray(f.options) ? f.options : [];
          inputEl.innerHTML = `<option value="">請選擇…</option>` + opts.map(o => `<option value="${o}">${o}</option>`).join('');
          inputEl.value = val;
        } else {
          inputEl = document.createElement('input');
          inputEl.type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
          inputEl.value = val;
        }

        if (f.type !== 'checkbox') {
          inputEl.style.width = '100%';
          inputEl.style.background = 'rgba(255, 255, 255, 0.85)';
          inputEl.style.border = '1px solid #93c5fd';
          inputEl.style.borderRadius = '3px';
          inputEl.style.padding = '2px 4px';
          inputEl.style.fontSize = `${f.fontSize || 12}px`;
          inputEl.style.textAlign = f.align || 'left';
          inputEl.placeholder = f.name || '';
          if (f.required) inputEl.required = true;
        }

        inputEl.oninput = () => {
          const currentVal = f.type === 'checkbox' ? inputEl.checked : inputEl.value;
          if (typeof onFieldChange === 'function') {
            onFieldChange(f.id, currentVal);
          }
        };

        fieldBox.appendChild(inputEl);
      } else {
        // 3. 檢視模式 (View Mode)
        fieldBox.style.fontSize = `${f.fontSize || 12}px`;
        fieldBox.style.justifyContent = f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start';
        fieldBox.style.color = '#0f172a';
        fieldBox.style.fontWeight = '500';
        fieldBox.style.padding = '0 2px';
        fieldBox.style.whiteSpace = f.type === 'textarea' ? 'pre-wrap' : 'nowrap';
        fieldBox.style.overflow = 'hidden';
        fieldBox.style.textOverflow = 'ellipsis';

        if (f.type === 'checkbox') {
          fieldBox.innerHTML = val ? '<span style="color:#059669;font-weight:bold;font-size:1.1em;">✓</span>' : '';
        } else {
          fieldBox.textContent = val !== undefined && val !== null ? String(val) : '';
        }
      }

      overlay.appendChild(fieldBox);
    });
  }

  /**
   * 開啟全功能「紙本 PDF 模版畫布設計器」彈窗
   * @param {Object} options
   * @param {Object} options.workflow - 流程資料
   * @param {Object} [options.initialPdfLayout] - 既有 pdfLayout 設定
   * @param {Function} options.onSave - 儲存回呼 ({ pdfLayout, formFields }) => {}
   */
  function openPdfFormDesignerModal({ workflow, initialPdfLayout, onSave }) {
    const layout = JSON.parse(JSON.stringify(initialPdfLayout || { type: 'pdf_template', fields: [] }));
    let templateFile = layout.templateFile || '';
    let fields = Array.isArray(layout.fields) ? layout.fields : [];
    let selectedFieldId = null;
    let isDrawing = false;
    let drawStartX = 0;
    let drawStartY = 0;
    let curPage = 1;
    let totalPages = 1;

    // 建立獨立的畫布設計器全螢幕浮層
    const modalEl = document.createElement('div');
    modalEl.id = 'pdf-designer-modal';
    modalEl.style.position = 'fixed';
    modalEl.style.top = '0';
    modalEl.style.left = '0';
    modalEl.style.width = '100vw';
    modalEl.style.height = '100vh';
    modalEl.style.backgroundColor = '#0f172a';
    modalEl.style.zIndex = '9999';
    modalEl.style.display = 'flex';
    modalEl.style.flexDirection = 'column';
    modalEl.style.color = '#f8fafc';
    modalEl.style.fontFamily = 'var(--font, sans-serif)';

    modalEl.innerHTML = `
      <!-- 頂部工具列 -->
      <div style="height:54px;background:#1e293b;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between;padding:0 16px;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:12px;">
          <strong style="font-size:1.05rem;color:#38bdf8;">紙本表單畫布設計器</strong>
          <span style="color:#94a3b8;font-size:0.85rem;">${workflow?.name ? `流程：${workflow.name}` : ''}</span>
          <label class="btn sm" style="background:#0284c7;color:#fff;cursor:pointer;margin:0;padding:5px 12px;border-radius:6px;font-size:0.82rem;">
            📁 上傳紙本底圖 (PDF/圖片)
            <input type="file" id="pdf-designer-upload-input" accept=".pdf,.png,.jpg,.jpeg" style="display:none;" />
          </label>
          <span id="pdf-designer-filename" style="font-size:0.82rem;color:#cbd5e1;">${layout.templateMeta?.originalName || templateFile || '尚未上傳底圖'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="display:flex;align-items:center;gap:4px;background:#0f172a;padding:3px 8px;border-radius:6px;font-size:0.85rem;">
            <button type="button" class="btn sm ghost" id="pdf-prev-page" style="color:#fff;padding:2px 8px;">◀</button>
            <span id="pdf-page-indicator">第 1 / 1 頁</span>
            <button type="button" class="btn sm ghost" id="pdf-next-page" style="color:#fff;padding:2px 8px;">▶</button>
          </div>
          <button type="button" class="btn sm" id="pdf-designer-save-btn" style="background:#059669;color:#fff;font-weight:600;padding:6px 16px;">✓ 儲存並套用</button>
          <button type="button" class="btn sm" id="pdf-designer-close-btn" style="background:#475569;color:#fff;">關閉</button>
        </div>
      </div>

      <!-- 主工作區：左側畫布 + 右側屬性面板 -->
      <div style="flex:1;display:flex;overflow:hidden;position:relative;">
        <!-- 畫布滾動區 -->
        <div id="pdf-designer-canvas-scroll" style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:30px;background:#090d16;">
          <div id="pdf-designer-wrapper" style="position:relative;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.5);display:none;">
            <canvas id="pdf-designer-canvas" style="display:block;"></canvas>
            <div id="pdf-designer-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;"></div>
          </div>
          <div id="pdf-designer-empty-hint" style="margin-top:100px;text-align:center;color:#64748b;">
            <div style="font-size:3rem;margin-bottom:10px;">📄</div>
            <div style="font-size:1.1rem;font-weight:600;color:#94a3b8;">尚未載入底圖範本</div>
            <div style="font-size:0.85rem;margin-top:6px;">請點擊左上方「上傳紙本底圖」選取原紙本 PDF 或掃描圖檔</div>
          </div>
        </div>

        <!-- 右側欄位與屬性設定面板 -->
        <div style="width:320px;background:#1e293b;border-left:1px solid #334155;display:flex;flex-direction:column;flex-shrink:0;">
          <!-- 快速新增按鈕列 -->
          <div style="padding:12px;border-bottom:1px solid #334155;">
            <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:8px;font-weight:600;">＋ 點擊在畫布中央新增欄位</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <button type="button" class="btn sm" data-add-type="text" style="background:#334155;color:#f8fafc;font-size:0.8rem;">＋ 文字方塊</button>
              <button type="button" class="btn sm" data-add-type="number" style="background:#334155;color:#f8fafc;font-size:0.8rem;">＋ 金額/數值</button>
              <button type="button" class="btn sm" data-add-type="date" style="background:#334155;color:#f8fafc;font-size:0.8rem;">＋ 日期欄位</button>
              <button type="button" class="btn sm" data-add-type="textarea" style="background:#334155;color:#f8fafc;font-size:0.8rem;">＋ 多行說明</button>
              <button type="button" class="btn sm" data-add-type="checkbox" style="background:#334155;color:#f8fafc;font-size:0.8rem;">＋ 核取方塊</button>
              <button type="button" class="btn sm" data-add-type="signature" style="background:#b45309;color:#fff;font-size:0.8rem;">＋ 審核簽章格</button>
            </div>
            <div style="font-size:0.75rem;color:#64748b;margin-top:6px;">💡 或直接在底圖上用滑鼠按住拖曳拉出方框</div>
          </div>

          <!-- 選定欄位屬性編輯 -->
          <div id="pdf-designer-prop-panel" style="flex:1;overflow-y:auto;padding:14px;">
            <div id="pdf-prop-empty" style="color:#64748b;text-align:center;margin-top:40px;font-size:0.85rem;">
              點擊畫布上的欄位方框<br/>以編輯該欄位屬性
            </div>
            <div id="pdf-prop-form" style="display:none;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <strong style="color:#38bdf8;font-size:0.95rem;">欄位屬性設定</strong>
                <button type="button" id="pdf-del-field-btn" class="btn sm" style="background:#dc2626;color:#fff;padding:2px 8px;font-size:0.75rem;">刪除此欄位</button>
              </div>

              <div style="display:flex;flex-direction:column;gap:10px;font-size:0.85rem;">
                <div>
                  <label style="display:block;color:#94a3b8;margin-bottom:4px;">欄位名稱（標籤） *</label>
                  <input type="text" id="prop-name" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#fff;" />
                </div>
                <div>
                  <label style="display:block;color:#94a3b8;margin-bottom:4px;">欄位代碼 (Key ID) *</label>
                  <input type="text" id="prop-id" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#fff;" />
                </div>
                <div>
                  <label style="display:block;color:#94a3b8;margin-bottom:4px;">欄位類型</label>
                  <select id="prop-type" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#fff;">
                    <option value="text">單行文字 (Text)</option>
                    <option value="number">數值/金額 (Number)</option>
                    <option value="date">日期 (Date)</option>
                    <option value="textarea">多行文字 (Textarea)</option>
                    <option value="select">下拉選單 (Select)</option>
                    <option value="checkbox">核取方塊 (Checkbox)</option>
                    <option value="signature">簽章 / 電子印章 (Signature)</option>
                  </select>
                </div>

                <!-- 簽章專用設定 -->
                <div id="prop-signature-box" style="display:none;background:#0f172a;padding:8px;border-radius:6px;border:1px solid #334155;">
                  <label style="display:block;color:#f59e0b;margin-bottom:4px;font-weight:600;">簽章綁定對象</label>
                  <select id="prop-step-order" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#fff;">
                    <option value="requester">申請人簽章</option>
                    ${(workflow?.steps || []).map((s, i) => `<option value="${s.order != null ? s.order : i + 1}">關卡 ${s.order != null ? s.order : i + 1}：${s.name || '審核人'}</option>`).join('')}
                  </select>
                </div>

                <!-- 文字排版設定 -->
                <div id="prop-text-style-box" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  <div>
                    <label style="display:block;color:#94a3b8;margin-bottom:4px;">字級 (px)</label>
                    <input type="number" id="prop-fontsize" min="8" max="48" value="12" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#fff;" />
                  </div>
                  <div>
                    <label style="display:block;color:#94a3b8;margin-bottom:4px;">對齊</label>
                    <select id="prop-align" style="width:100%;padding:6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#fff;">
                      <option value="left">靠左</option>
                      <option value="center">置中</option>
                      <option value="right">靠右</option>
                    </select>
                  </div>
                </div>

                <div style="margin-top:4px;">
                  <label style="display:inline-flex;align-items:center;gap:6px;color:#cbd5e1;cursor:pointer;">
                    <input type="checkbox" id="prop-required" />
                    必填欄位
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    // DOM 快取
    const uploadInput = modalEl.querySelector('#pdf-designer-upload-input');
    const filenameEl = modalEl.querySelector('#pdf-designer-filename');
    const wrapper = modalEl.querySelector('#pdf-designer-wrapper');
    const canvas = modalEl.querySelector('#pdf-designer-canvas');
    const overlay = modalEl.querySelector('#pdf-designer-overlay');
    const emptyHint = modalEl.querySelector('#pdf-designer-empty-hint');
    const pageIndicator = modalEl.querySelector('#pdf-page-indicator');
    const prevPageBtn = modalEl.querySelector('#pdf-prev-page');
    const nextPageBtn = modalEl.querySelector('#pdf-next-page');
    const closeBtn = modalEl.querySelector('#pdf-designer-close-btn');
    const saveBtn = modalEl.querySelector('#pdf-designer-save-btn');
    const propEmpty = modalEl.querySelector('#pdf-prop-empty');
    const propForm = modalEl.querySelector('#pdf-prop-form');

    // 關閉設計器
    closeBtn.onclick = () => modalEl.remove();

    // 重新渲染畫布上的所有欄位方框
    function renderOverlayBoxes() {
      overlay.innerHTML = '';
      fields.forEach((f) => {
        const box = document.createElement('div');
        box.className = 'designer-field-box';
        box.dataset.id = f.id;
        box.style.position = 'absolute';
        box.style.left = `${(f.rx * 100).toFixed(3)}%`;
        box.style.top = `${(f.ry * 100).toFixed(3)}%`;
        box.style.width = `${(f.rw * 100).toFixed(3)}%`;
        box.style.height = `${(f.rh * 100).toFixed(3)}%`;
        box.style.border = f.id === selectedFieldId ? '2px solid #38bdf8' : '1.5px solid #2563eb';
        box.style.backgroundColor = f.type === 'signature' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.2)';
        box.style.borderRadius = '3px';
        box.style.boxSizing = 'border-box';
        box.style.cursor = 'move';
        box.style.userSelect = 'none';

        // 欄位標籤提示
        box.innerHTML = `
          <div style="position:absolute;top:-18px;left:0;background:${f.type === 'signature' ? '#b45309' : '#0284c7'};color:#fff;font-size:10px;padding:1px 5px;border-radius:3px 3px 0 0;white-space:nowrap;pointer-events:none;line-height:1.2;">
            ${f.name || f.id}
          </div>
          <div class="resize-handle" style="position:absolute;bottom:-3px;right:-3px;width:10px;height:10px;background:#38bdf8;border-radius:2px;cursor:nwse-resize;"></div>
        `;

        // 點選與移動處理
        box.onmousedown = (e) => {
          if (e.target.classList.contains('resize-handle')) return; // 由縮放手柄處理
          e.stopPropagation();
          selectField(f.id);

          const startClientX = e.clientX;
          const startClientY = e.clientY;
          const rect = overlay.getBoundingClientRect();
          const startRx = f.rx;
          const startRy = f.ry;

          function onMouseMove(moveEv) {
            const dx = (moveEv.clientX - startClientX) / rect.width;
            const dy = (moveEv.clientY - startClientY) / rect.height;
            f.rx = Math.max(0, Math.min(1 - f.rw, startRx + dx));
            f.ry = Math.max(0, Math.min(1 - f.rh, startRy + dy));
            box.style.left = `${(f.rx * 100).toFixed(3)}%`;
            box.style.top = `${(f.ry * 100).toFixed(3)}%`;
          }

          function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          }

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        };

        // 右下角縮放把手處理
        const handle = box.querySelector('.resize-handle');
        handle.onmousedown = (e) => {
          e.stopPropagation();
          selectField(f.id);

          const startClientX = e.clientX;
          const startClientY = e.clientY;
          const rect = overlay.getBoundingClientRect();
          const startRw = f.rw;
          const startRh = f.rh;

          function onResizeMove(moveEv) {
            const dx = (moveEv.clientX - startClientX) / rect.width;
            const dy = (moveEv.clientY - startClientY) / rect.height;
            f.rw = Math.max(0.02, Math.min(1 - f.rx, startRw + dx));
            f.rh = Math.max(0.015, Math.min(1 - f.ry, startRh + dy));
            box.style.width = `${(f.rw * 100).toFixed(3)}%`;
            box.style.height = `${(f.rh * 100).toFixed(3)}%`;
          }

          function onResizeUp() {
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
          }

          document.addEventListener('mousemove', onResizeMove);
          document.addEventListener('mouseup', onResizeUp);
        };

        overlay.appendChild(box);
      });
    }

    // 選取欄位並在右側屬性面板顯示
    function selectField(id) {
      selectedFieldId = id;
      renderOverlayBoxes();
      const f = fields.find((x) => x.id === id);
      if (!f) {
        propEmpty.style.display = 'block';
        propForm.style.display = 'none';
        return;
      }
      propEmpty.style.display = 'none';
      propForm.style.display = 'block';

      modalEl.querySelector('#prop-name').value = f.name || '';
      modalEl.querySelector('#prop-id').value = f.id || '';
      modalEl.querySelector('#prop-type').value = f.type || 'text';
      modalEl.querySelector('#prop-fontsize').value = f.fontSize || 12;
      modalEl.querySelector('#prop-align').value = f.align || 'left';
      modalEl.querySelector('#prop-required').checked = !!f.required;

      const sigBox = modalEl.querySelector('#prop-signature-box');
      if (f.type === 'signature') {
        sigBox.style.display = 'block';
        modalEl.querySelector('#prop-step-order').value = f.role === 'requester' ? 'requester' : String(f.stepOrder || 1);
      } else {
        sigBox.style.display = 'none';
      }
    }

    // 綁定屬性面板表單變更
    modalEl.querySelector('#prop-name').oninput = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) { f.name = e.target.value; renderOverlayBoxes(); }
    };
    modalEl.querySelector('#prop-id').oninput = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) { f.id = e.target.value; }
    };
    modalEl.querySelector('#prop-type').onchange = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) {
        f.type = e.target.value;
        f.isStamp = f.type === 'signature';
        selectField(f.id);
      }
    };
    modalEl.querySelector('#prop-step-order').onchange = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) {
        if (e.target.value === 'requester') {
          f.role = 'requester';
          delete f.stepOrder;
        } else {
          f.role = 'approver';
          f.stepOrder = Number(e.target.value);
        }
      }
    };
    modalEl.querySelector('#prop-fontsize').oninput = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) { f.fontSize = Number(e.target.value) || 12; }
    };
    modalEl.querySelector('#prop-align').onchange = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) { f.align = e.target.value; }
    };
    modalEl.querySelector('#prop-required').onchange = (e) => {
      const f = fields.find((x) => x.id === selectedFieldId);
      if (f) { f.required = e.target.checked; }
    };

    // 刪除欄位按鈕
    modalEl.querySelector('#pdf-del-field-btn').onclick = () => {
      fields = fields.filter((x) => x.id !== selectedFieldId);
      selectField(null);
    };

    // 快速新增欄位按鈕列
    modalEl.querySelectorAll('[data-add-type]').forEach((btn) => {
      btn.onclick = () => {
        const type = btn.dataset.addType;
        const newField = {
          id: genFieldId(type === 'signature' ? 'stamp' : 'f'),
          name: type === 'signature' ? '審核人簽章' : type === 'number' ? '金額' : type === 'date' ? '日期' : '新欄位',
          type,
          page: curPage,
          rx: 0.35,
          ry: 0.4,
          rw: type === 'signature' ? 0.18 : 0.25,
          rh: type === 'signature' ? 0.08 : 0.04,
          fontSize: 12,
          align: 'left',
          required: false,
          isStamp: type === 'signature',
          role: type === 'signature' ? 'approver' : undefined,
          stepOrder: type === 'signature' ? 1 : undefined,
        };
        fields.push(newField);
        selectField(newField.id);
      };
    });

    // 滑鼠在空白處框選拖曳出新欄位
    overlay.onmousedown = (e) => {
      if (e.target !== overlay) return;
      isDrawing = true;
      const rect = overlay.getBoundingClientRect();
      drawStartX = (e.clientX - rect.left) / rect.width;
      drawStartY = (e.clientY - rect.top) / rect.height;

      const drawBox = document.createElement('div');
      drawBox.id = 'designer-temp-drawing-box';
      drawBox.style.position = 'absolute';
      drawBox.style.border = '2px dashed #38bdf8';
      drawBox.style.background = 'rgba(56, 189, 248, 0.25)';
      drawBox.style.pointerEvents = 'none';
      overlay.appendChild(drawBox);

      function onDrawMove(moveEv) {
        if (!isDrawing) return;
        const curX = Math.max(0, Math.min(1, (moveEv.clientX - rect.left) / rect.width));
        const curY = Math.max(0, Math.min(1, (moveEv.clientY - rect.top) / rect.height));
        const rx = Math.min(drawStartX, curX);
        const ry = Math.min(drawStartY, curY);
        const rw = Math.abs(curX - drawStartX);
        const rh = Math.abs(curY - drawStartY);

        drawBox.style.left = `${(rx * 100).toFixed(3)}%`;
        drawBox.style.top = `${(ry * 100).toFixed(3)}%`;
        drawBox.style.width = `${(rw * 100).toFixed(3)}%`;
        drawBox.style.height = `${(rh * 100).toFixed(3)}%`;
      }

      function onDrawUp(upEv) {
        if (!isDrawing) return;
        isDrawing = false;
        drawBox.remove();
        document.removeEventListener('mousemove', onDrawMove);
        document.removeEventListener('mouseup', onDrawUp);

        const curX = Math.max(0, Math.min(1, (upEv.clientX - rect.left) / rect.width));
        const curY = Math.max(0, Math.min(1, (upEv.clientY - rect.top) / rect.height));
        const rx = Math.min(drawStartX, curX);
        const ry = Math.min(drawStartY, curY);
        const rw = Math.abs(curX - drawStartX);
        const rh = Math.abs(curY - drawStartY);

        if (rw > 0.02 && rh > 0.015) {
          const newField = {
            id: genFieldId('f'),
            name: `欄位 ${fields.length + 1}`,
            type: 'text',
            page: curPage,
            rx,
            ry,
            rw,
            rh,
            fontSize: 12,
            align: 'left',
            required: false,
          };
          fields.push(newField);
          selectField(newField.id);
        } else {
          selectField(null);
        }
      }

      document.addEventListener('mousemove', onDrawMove);
      document.addEventListener('mouseup', onDrawUp);
    };

    // 載入底圖顯示
    async function loadTemplate() {
      if (!templateFile) {
        wrapper.style.display = 'none';
        emptyHint.style.display = 'block';
        return;
      }
      emptyHint.style.display = 'none';
      wrapper.style.display = 'block';

      const fileUrl = templateFile.startsWith('/') || templateFile.startsWith('http')
        ? templateFile
        : `/api/${templateFile}`;

      try {
        const info = await loadTemplateToCanvas(fileUrl, canvas, curPage);
        totalPages = info.pageCount || 1;
        curPage = info.pageNumber || 1;
        pageIndicator.textContent = `第 ${curPage} / ${totalPages} 頁`;
        renderOverlayBoxes();
      } catch (e) {
        alert('載入底圖失敗：' + e.message);
      }
    }

    // 換頁按鈕
    prevPageBtn.onclick = () => {
      if (curPage > 1) { curPage--; loadTemplate(); }
    };
    nextPageBtn.onclick = () => {
      if (curPage < totalPages) { curPage++; loadTemplate(); }
    };

    // 上傳檔案處理
    uploadInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);

      filenameEl.textContent = '正在上傳底圖…';
      try {
        const token = localStorage.getItem('approval_token') || '';
        const res = await fetch('/api/workflows/upload-template', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || '上傳失敗');

        templateFile = data.templateFile;
        filenameEl.textContent = `${data.originalName} (${(data.size / 1024).toFixed(1)} KB)`;
        layout.templateMeta = {
          originalName: data.originalName,
          size: data.size,
          mimeType: data.mimeType,
        };
        curPage = 1;
        await loadTemplate();
      } catch (err) {
        alert('上傳底圖失敗：' + err.message);
        filenameEl.textContent = '上傳失敗';
      }
    };

    // 儲存並套用
    saveBtn.onclick = () => {
      if (!templateFile) {
        alert('請先上傳底圖檔案！');
        return;
      }

      // 生成對應的 formFields 清單以供流程引擎驗證與資料庫儲存
      const convertedFormFields = fields
        .filter((f) => f.type !== 'signature' && !f.isStamp)
        .map((f) => ({
          id: f.id,
          label: f.name || f.id,
          type: f.type || 'text',
          required: !!f.required,
          options: f.options || [],
        }));

      const outPdfLayout = {
        type: 'pdf_template',
        label: '紙本底圖套印版面',
        templateFile,
        templateMeta: layout.templateMeta || {},
        fields,
        formMode: 'paper',
      };

      if (typeof onSave === 'function') {
        onSave({
          pdfLayout: outPdfLayout,
          formFields: convertedFormFields,
        });
      }

      modalEl.remove();
    };

    // 若原本已有底圖，立即載入
    if (templateFile) {
      loadTemplate();
    }
  }

  // 掛載到全域 window 物件
  window.PdfFormDesigner = {
    loadTemplateToCanvas,
    renderPdfFormViewer,
    openPdfFormDesignerModal,
  };
})(window);
