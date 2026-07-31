/**
 * 說明欄位簡易 Word 式編輯器（不依賴外網 CDN）
 * 功能：粗體／斜體／底線、字級、文字顏色、插入表格
 * 貼上：盡量保留 Word／Excel 格式（樣式表 class → inline、表格、段落）
 */
(function (global) {
  const COLORS = [
    { name: '黑', value: '#111827' },
    { name: '深灰', value: '#374151' },
    { name: '紅', value: '#b91c1c' },
    { name: '橙', value: '#c2410c' },
    { name: '綠', value: '#15803d' },
    { name: '藍', value: '#1d4ed8' },
    { name: '紫', value: '#7e22ce' },
  ];
  const SIZES = [
    { label: '小', value: '2' },
    { label: '標準', value: '3' },
    { label: '稍大', value: '4' },
    { label: '大', value: '5' },
    { label: '特大', value: '6' },
  ];

  /** 允許的 HTML 標籤（防 XSS 白名單） */
  const ALLOWED_TAGS = new Set([
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'STRIKE',
    'DEL',
    'BR',
    'P',
    'DIV',
    'SPAN',
    'FONT',
    'TABLE',
    'THEAD',
    'TBODY',
    'TFOOT',
    'TR',
    'TH',
    'TD',
    'COLGROUP',
    'COL',
    'UL',
    'OL',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'SUB',
    'SUP',
    'BLOCKQUOTE',
    'HR',
    'CENTER',
    'PRE',
    'A',
  ]);

  /** 允許保留的 CSS 屬性（Word 貼上常見） */
  const ALLOWED_STYLE_PROPS = new Set([
    'color',
    'background',
    'background-color',
    'font-size',
    'font-weight',
    'font-style',
    'font-family',
    'text-decoration',
    'text-decoration-line',
    'text-align',
    'text-indent',
    'line-height',
    'letter-spacing',
    'vertical-align',
    'white-space',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-width',
    'border-style',
    'border-color',
    'border-collapse',
    'border-spacing',
    'width',
    'min-width',
    'max-width',
    'height',
    'min-height',
    'max-height',
    'list-style',
    'list-style-type',
    'list-style-position',
    'display',
    'table-layout',
  ]);

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function isSafeCssValue(val) {
    return !/expression|javascript|@import|behavior|url\s*\(\s*['"]?\s*data:/i.test(
      String(val || '')
    );
  }

  function sanitizeStyle(style) {
    if (!style) return '';
    const keep = [];
    String(style)
      .split(';')
      .forEach((part) => {
        const m = part.match(/^\s*([a-zA-Z\-]+)\s*:\s*(.+)\s*$/);
        if (!m) return;
        const prop = m[1].toLowerCase();
        let val = m[2].trim();
        // 略過 Word 專用 mso-* 屬性
        if (prop.startsWith('mso-')) return;
        if (!ALLOWED_STYLE_PROPS.has(prop)) return;
        if (!isSafeCssValue(val)) return;
        // 去掉 url() 背景（防 XSS），其餘顏色可保留
        if ((prop === 'background' || prop === 'background-color') && /url\s*\(/i.test(val)) {
          return;
        }
        keep.push(`${prop}: ${val}`);
      });
    return keep.join('; ');
  }

  /**
   * 解析 <style> 內簡易選擇器規則，供 Word class 轉 inline
   * 僅支援 .class / p.class / tag.class 這類常見 Mso 規則
   */
  function parseSimpleCssRules(cssText) {
    const rules = []; // { selectorClasses: string[], tag?: string, style: string }
    const cleaned = String(cssText || '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--|-->/g, '');
    // 粗略切開 { }
    const re = /([^{}@]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(cleaned))) {
      const selPart = m[1].trim();
      const body = sanitizeStyle(m[2]);
      if (!body) continue;
      // 多選擇器以逗號分隔，只取簡單的
      selPart.split(',').forEach((rawSel) => {
        const sel = rawSel.trim().replace(/\s+/g, ' ');
        if (!sel || sel.includes('[') || sel.includes(':') || sel.includes('>')) return;
        // e.g. p.MsoNormal / .MsoNormal / td.xxx
        const mm = sel.match(/^(?:([a-zA-Z0-9]+))?\.([a-zA-Z0-9_-]+)$/);
        if (!mm) return;
        rules.push({
          tag: mm[1] ? mm[1].toUpperCase() : null,
          className: mm[2],
          style: body,
        });
      });
    }
    return rules;
  }

  function mergeStyles(base, extra) {
    const map = new Map();
    const put = (s) => {
      String(s || '')
        .split(';')
        .forEach((part) => {
          const m = part.match(/^\s*([a-zA-Z\-]+)\s*:\s*(.+)\s*$/);
          if (!m) return;
          map.set(m[1].toLowerCase(), m[2].trim());
        });
    };
    put(base);
    put(extra); // extra 覆蓋
    return [...map.entries()].map(([k, v]) => `${k}: ${v}`).join('; ');
  }

  /** 將 style 標籤內的 class 規則套成 inline style，再移除 style 標籤 */
  function promoteClassStylesToInline(root) {
    const styleEls = root.querySelectorAll ? root.querySelectorAll('style') : [];
    const allRules = [];
    styleEls.forEach((el) => {
      allRules.push(...parseSimpleCssRules(el.textContent || ''));
      el.remove();
    });
    if (!allRules.length) return;

    const byClass = new Map();
    allRules.forEach((r) => {
      if (!byClass.has(r.className)) byClass.set(r.className, []);
      byClass.get(r.className).push(r);
    });

    const walk = (node) => {
      if (!node || node.nodeType !== 1) return;
      const classAttr = node.getAttribute && node.getAttribute('class');
      if (classAttr) {
        const classes = classAttr.split(/\s+/).filter(Boolean);
        let merged = node.getAttribute('style') || '';
        classes.forEach((cls) => {
          const rules = byClass.get(cls);
          if (!rules) return;
          rules.forEach((r) => {
            if (r.tag && r.tag !== node.tagName) return;
            merged = mergeStyles(r.style, merged);
          });
        });
        if (merged) node.setAttribute('style', merged);
      }
      [...node.children].forEach(walk);
    };
    // template content or element
    if (root.childNodes) {
      [...root.childNodes].forEach((n) => {
        if (n.nodeType === 1) walk(n);
      });
    }
  }

  /** 前處理 Word 剪貼簿 HTML */
  function preprocessClipboardHtml(html) {
    let s = String(html || '');
    // 去掉條件註解 <!--[if ...]> ... <![endif]-->
    s = s.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    // Office 命名空間標籤 <o:p> </o:p>
    s = s.replace(/<\/?o:[a-z0-9]+[^>]*>/gi, '');
    s = s.replace(/<\/?w:[a-z0-9]+[^>]*>/gi, '');
    s = s.replace(/<\/?v:[a-z0-9]+[^>]*>/gi, '');
    // XML 宣告
    s = s.replace(/<\?xml[\s\S]*?\?>/gi, '');
    // meta / link / xml
    s = s.replace(/<meta[\s\S]*?>/gi, '');
    s = s.replace(/<link[\s\S]*?>/gi, '');
    s = s.replace(/<xml[\s\S]*?<\/xml>/gi, '');
    // script
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    return s;
  }

  /** 淨化 HTML（瀏覽器環境） */
  function sanitizeHtml(html) {
    if (html == null || html === '') return '';
    let str = preprocessClipboardHtml(html);
    if (typeof document === 'undefined') {
      return str
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = str;

    // Word：先把 stylesheet class 轉 inline
    promoteClassStylesToInline(tpl.content);

    const walkSafe = (parent) => {
      let guard = 0;
      let child = parent.firstChild;
      while (child && guard++ < 20000) {
        const next = child.nextSibling;
        if (child.nodeType === 8) {
          child.remove();
          child = next;
          continue;
        }
        if (child.nodeType !== 1) {
          child = next;
          continue;
        }
        const tag = child.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
          const kids = [];
          while (child.firstChild) kids.push(child.firstChild);
          kids.forEach((k) => parent.insertBefore(k, child));
          child.remove();
          // 從第一個提升的子節點繼續
          child = kids.length ? kids[0] : next;
          continue;
        }

        [...child.attributes].forEach((attr) => {
          const n = attr.name.toLowerCase();
          if (n === 'style') {
            const s = sanitizeStyle(attr.value);
            if (s) child.setAttribute('style', s);
            else child.removeAttribute('style');
          } else if (n === 'color' || n === 'size' || n === 'face') {
            if (tag !== 'FONT') child.removeAttribute(attr.name);
          } else if (
            n === 'colspan' ||
            n === 'rowspan' ||
            n === 'border' ||
            n === 'width' ||
            n === 'height' ||
            n === 'cellpadding' ||
            n === 'cellspacing' ||
            n === 'align' ||
            n === 'valign'
          ) {
            /* keep */
          } else if (n === 'href' && tag === 'A') {
            const href = String(attr.value || '').trim();
            if (!/^(https?:|mailto:|#)/i.test(href)) child.removeAttribute('href');
            else {
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noopener noreferrer');
            }
          } else if ((n === 'target' || n === 'rel') && tag === 'A') {
            /* keep */
          } else {
            child.removeAttribute(attr.name);
          }
        });

        if (tag === 'TABLE') {
          const st = child.getAttribute('style') || '';
          if (!/border/i.test(st)) {
            child.setAttribute(
              'style',
              mergeStyles('border-collapse: collapse; width: 100%;', st)
            );
          }
          if (!child.getAttribute('border')) child.setAttribute('border', '1');
        }
        if (tag === 'TD' || tag === 'TH') {
          const st = child.getAttribute('style') || '';
          if (!/border/i.test(st)) {
            child.setAttribute(
              'style',
              mergeStyles('border: 1px solid #94a3b8; padding: 4px 8px;', st)
            );
          }
        }

        walkSafe(child);
        child = next;
      }
    };

    walkSafe(tpl.content);

    // 若貼上後只剩空，回空字串
    let out = tpl.innerHTML;
    // 去掉 Word 多餘空白段落（全是 &nbsp; / <br> 的可保留）
    out = out.replace(/^(<br\s*\/?>|\s|&nbsp;)+$/i, '');
    return out;
  }

  function isProbablyHtml(s) {
    return /<\/?[a-z][\s\S]*>/i.test(String(s || ''));
  }

  function plainToHtml(text) {
    const t = String(text ?? '');
    if (!t) return '';
    if (isProbablyHtml(t)) return sanitizeHtml(t);
    return t
      .split(/\r\n|\n|\r/)
      .map((line) => `<div>${escAttr(line) || '<br>'}</div>`)
      .join('');
  }

  function htmlToPlain(html) {
    if (typeof document === 'undefined') {
      return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<\/th>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }
    const d = document.createElement('div');
    d.innerHTML = sanitizeHtml(html);
    return (d.innerText || d.textContent || '').trim();
  }

  function exec(cmd, val) {
    try {
      document.execCommand(cmd, false, val);
    } catch (e) {
      /* ignore */
    }
  }

  /** 在游標處插入 HTML（相容 insertHTML 失敗） */
  function insertHtmlAtSelection(html) {
    const ok = document.execCommand('insertHTML', false, html);
    if (ok) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function buildToolbar(id) {
    const sizeOpts = SIZES.map(
      (s) => `<option value="${s.value}">${s.label}</option>`
    ).join('');
    const swatches = COLORS.map(
      (c) =>
        `<button type="button" class="re-swatch" data-re-swatch="${escAttr(c.value)}"
          style="background:${c.value}" title="${escAttr(c.name)}" aria-label="${escAttr(c.name)}"></button>`
    ).join('');
    return `
      <div class="re-toolbar" data-re-toolbar="${escAttr(id)}">
        <div class="re-toolbar-row">
          <div class="re-group" title="字型樣式">
            <span class="re-group-label">樣式</span>
            <div class="re-group-body">
              <button type="button" class="re-btn" data-re-cmd="bold" title="粗體"><b>B</b></button>
              <button type="button" class="re-btn" data-re-cmd="italic" title="斜體"><i>I</i></button>
              <button type="button" class="re-btn" data-re-cmd="underline" title="底線"><u>U</u></button>
            </div>
          </div>
          <div class="re-group" title="字級">
            <span class="re-group-label">字級</span>
            <div class="re-group-body">
              <select class="re-select" data-re-size="${escAttr(id)}" title="字級">${sizeOpts}</select>
            </div>
          </div>
          <div class="re-group" title="文字顏色">
            <span class="re-group-label">顏色</span>
            <div class="re-group-body re-swatches">
              ${swatches}
            </div>
          </div>
          <div class="re-group" title="插入">
            <span class="re-group-label">插入</span>
            <div class="re-group-body">
              <button type="button" class="re-btn re-btn-text" data-re-table="${escAttr(id)}" title="插入表格">表格</button>
              <button type="button" class="re-btn re-btn-text" data-re-cmd="insertUnorderedList" title="項目符號">清單</button>
              <button type="button" class="re-btn re-btn-text" data-re-cmd="removeFormat" title="清除格式">清除</button>
            </div>
          </div>
        </div>
        <div class="re-toolbar-hint">可從 Word／Excel 直接貼上（會保留粗體、顏色、字級、表格與段落）</div>
      </div>`;
  }

  function insertTableHtml(rows, cols) {
    const r = Math.min(20, Math.max(1, rows || 3));
    const c = Math.min(10, Math.max(1, cols || 3));
    let html = '<table border="1" style="border-collapse:collapse;width:100%"><tbody>';
    for (let i = 0; i < r; i++) {
      html += '<tr>';
      for (let j = 0; j < c; j++) {
        const tag = i === 0 ? 'th' : 'td';
        const style =
          'border:1px solid #94a3b8;padding:6px 8px;min-width:48px;' +
          (i === 0 ? 'background:#e2e8f0;' : '');
        html += `<${tag} style="${style}"><br></${tag}>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><div><br></div>';
    return html;
  }

  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * 將 textarea 升級為富文字編輯器
   * @param {HTMLTextAreaElement} textarea
   * @param {{ required?: boolean }} opts
   */
  function upgradeTextarea(textarea, opts = {}) {
    if (!textarea || textarea.dataset.richReady === '1') return null;
    const fieldId = textarea.dataset.ff || textarea.name || `re_${Date.now()}`;
    const initial = textarea.value || '';
    const required = opts.required || textarea.required;

    const wrap = document.createElement('div');
    wrap.className = 'rich-editor';
    wrap.dataset.richFor = fieldId;
    wrap.innerHTML = `
      ${buildToolbar(fieldId)}
      <div class="re-surface" data-re-surface="${escAttr(fieldId)}"
        contenteditable="true" role="textbox" aria-multiline="true"
        data-placeholder="${escAttr(textarea.placeholder || '在此輸入說明…')}"></div>
    `;

    textarea.classList.add('re-hidden-input');
    textarea.dataset.richReady = '1';
    textarea.required = false;
    if (required) textarea.dataset.richRequired = '1';
    textarea.parentNode.insertBefore(wrap, textarea);

    const surface = wrap.querySelector('[data-re-surface]');
    surface.innerHTML = plainToHtml(initial) || '';
    if (!surface.innerHTML.trim()) {
      surface.innerHTML = '<div><br></div>';
    }

    const sync = () => {
      const html = sanitizeHtml(surface.innerHTML);
      textarea.value = html;
      const plain = htmlToPlain(html);
      if (!plain.trim() && !/<table/i.test(html)) {
        textarea.value = '';
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };

    surface.addEventListener('input', sync);
    surface.addEventListener('blur', sync);

    /**
     * 貼上：優先使用 text/html（Word 剪貼簿），轉 inline 後插入
     * Excel 純文字 tab 表 → 表格
     */
    surface.addEventListener('paste', (e) => {
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;

      let html = '';
      try {
        html = cd.getData('text/html') || '';
      } catch {
        html = '';
      }
      let text = '';
      try {
        text = cd.getData('text/plain') || '';
      } catch {
        text = '';
      }

      // Word / 瀏覽器富文字
      if (html && /<\/?[a-z][\s\S]*>/i.test(html)) {
        e.preventDefault();
        // 只取 body 內容（若有）
        let fragment = html;
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (bodyMatch) fragment = bodyMatch[1];
        const clean = sanitizeHtml(fragment);
        if (clean && clean.trim()) {
          insertHtmlAtSelection(clean);
        } else if (text) {
          // HTML 淨化後空：退回純文字分行
          insertHtmlAtSelection(plainToHtml(text));
        }
        sync();
        updateEmpty();
        return;
      }

      // Excel 純文字 tab 表
      if (text && text.includes('\t') && text.includes('\n')) {
        e.preventDefault();
        const rows = text
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .filter((line) => line.length);
        if (rows.length) {
          const cells = rows.map((line) => line.split('\t'));
          const cols = Math.max(...cells.map((r) => r.length));
          let th =
            '<table border="1" style="border-collapse:collapse;width:100%"><tbody>';
          cells.forEach((row, ri) => {
            th += '<tr>';
            for (let ci = 0; ci < cols; ci++) {
              const tag = ri === 0 ? 'th' : 'td';
              const style =
                'border:1px solid #94a3b8;padding:6px 8px;' +
                (ri === 0 ? 'background:#e2e8f0;' : '');
              const cell = escAttr(row[ci] || '');
              th += `<${tag} style="${style}">${cell || '<br>'}</${tag}>`;
            }
            th += '</tr>';
          });
          th += '</tbody></table><div><br></div>';
          insertHtmlAtSelection(th);
          sync();
          updateEmpty();
        }
        return;
      }

      // 純文字：保留換行
      if (text && (text.includes('\n') || text.includes('\r'))) {
        e.preventDefault();
        insertHtmlAtSelection(plainToHtml(text));
        sync();
        updateEmpty();
        return;
      }

      setTimeout(() => {
        sync();
        updateEmpty();
      }, 0);
    });

    wrap.querySelectorAll('[data-re-cmd]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        surface.focus();
        exec(btn.dataset.reCmd);
        sync();
      });
    });

    const sizeSel = wrap.querySelector(`[data-re-size="${fieldId}"]`);
    if (sizeSel) {
      sizeSel.addEventListener('change', () => {
        surface.focus();
        exec('fontSize', sizeSel.value);
        sync();
      });
    }
    wrap.querySelectorAll('[data-re-swatch]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        surface.focus();
        exec('foreColor', btn.dataset.reSwatch);
        wrap.querySelectorAll('[data-re-swatch]').forEach((b) =>
          b.classList.toggle('is-active', b === btn)
        );
        sync();
      });
    });
    const tableBtn = wrap.querySelector(`[data-re-table="${fieldId}"]`);
    if (tableBtn) {
      tableBtn.addEventListener('mousedown', (e) => e.preventDefault());
      tableBtn.addEventListener('click', () => {
        const rc = prompt('插入表格：列數,欄數（例如 3,4）', '3,3');
        if (rc == null) return;
        const parts = String(rc)
          .split(/[,，xX*／/\s]+/)
          .map((s) => Number(String(s).trim()));
        const rows = parts[0] > 0 ? parts[0] : 3;
        const cols = parts[1] > 0 ? parts[1] : 3;
        surface.focus();
        insertHtmlAtSelection(insertTableHtml(rows, cols));
        sync();
      });
    }

    const updateEmpty = () => {
      const empty = !htmlToPlain(surface.innerHTML).trim();
      surface.classList.toggle('re-empty', empty);
    };
    surface.addEventListener('input', updateEmpty);
    updateEmpty();
    sync();

    return {
      surface,
      sync,
      getHtml: () => sanitizeHtml(surface.innerHTML),
      setHtml: (html) => {
        surface.innerHTML = plainToHtml(html) || '<div><br></div>';
        sync();
        updateEmpty();
      },
    };
  }

  function bindAll(root) {
    if (!root) return;
    root.querySelectorAll('textarea[data-rich="1"]').forEach((ta) => {
      upgradeTextarea(ta);
    });
  }

  function renderViewHtml(html) {
    const clean = sanitizeHtml(plainToHtml(html));
    if (!htmlToPlain(clean).trim() && !/<table/i.test(clean)) {
      return '<span class="muted">—</span>';
    }
    return `<div class="rich-view">${clean}</div>`;
  }

  global.RichEditor = {
    upgradeTextarea,
    bindAll,
    sanitizeHtml,
    plainToHtml,
    htmlToPlain,
    isProbablyHtml,
    renderViewHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
