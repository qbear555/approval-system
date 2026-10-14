import { htmlToPlain, isProbablyHtml } from './html';

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'P', 'DIV', 'SPAN', 'FONT',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'SUB', 'SUP', 'BLOCKQUOTE', 'HR', 'A',
]);

const ALLOWED_STYLE = new Set([
  'color', 'background', 'background-color', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-align', 'vertical-align', 'border', 'border-collapse',
  'border-color', 'border-width', 'width', 'height', 'padding', 'margin', 'white-space',
]);

function safeCss(style) {
  const keep = [];
  String(style || '').split(';').forEach((part) => {
    const m = part.match(/^\s*([a-zA-Z\-]+)\s*:\s*(.+)\s*$/);
    if (!m) return;
    const prop = m[1].toLowerCase();
    const val = m[2].trim();
    if (prop.startsWith('mso-') || !ALLOWED_STYLE.has(prop)) return;
    if (/expression|javascript|@import|behavior|url\s*\(/i.test(val)) return;
    keep.push(`${prop}: ${val}`);
  });
  return keep.join('; ');
}

function preprocess(html) {
  return String(html || '')
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?o:[a-z0-9]+[^>]*>/gi, '')
    .replace(/<\/?w:[a-z0-9]+[^>]*>/gi, '')
    .replace(/<\/?v:[a-z0-9]+[^>]*>/gi, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<link[\s\S]*?>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

export function sanitizeRichHtml(html) {
  if (html == null || html === '') return '';
  if (typeof document === 'undefined') {
    return preprocess(html).replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = preprocess(html);
  const walk = (parent) => {
    let child = parent.firstChild;
    let guard = 0;
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
        child = kids.length ? kids[0] : next;
        continue;
      }
      [...child.attributes].forEach((attr) => {
        const n = attr.name.toLowerCase();
        if (n === 'style') {
          const s = safeCss(attr.value);
          if (s) child.setAttribute('style', s);
          else child.removeAttribute('style');
        } else if (n === 'color' || n === 'size' || n === 'face') {
          if (tag !== 'FONT') child.removeAttribute(attr.name);
        } else if (['colspan', 'rowspan', 'border', 'width', 'height', 'align', 'valign'].includes(n)) {
          /* keep */
        } else if (n === 'href' && tag === 'A') {
          const href = String(attr.value || '').trim();
          if (!/^(https?:|mailto:|#)/i.test(href)) child.removeAttribute('href');
        } else {
          child.removeAttribute(attr.name);
        }
      });
      if (tag === 'TABLE' && !child.getAttribute('border')) child.setAttribute('border', '1');
      walk(child);
      child = next;
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function plainToRichHtml(text) {
  const t = String(text ?? '');
  if (!t) return '';
  if (isProbablyHtml(t)) return sanitizeRichHtml(t);
  return t
    .split(/\r\n|\n|\r/)
    .map((line) => `<div>${line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>'}</div>`)
    .join('');
}

export function richToPlain(html) {
  return htmlToPlain(sanitizeRichHtml(html));
}

export function renderRichView(html) {
  const clean = sanitizeRichHtml(plainToRichHtml(html));
  if (!richToPlain(clean).trim() && !/<table/i.test(clean)) return '<span class="muted">—</span>';
  return `<div class="rich-view">${clean}</div>`;
}

export function shouldUseRich(field, { enableRich = true } = {}) {
  if (!enableRich) return false;
  const label = String(field?.label || '');
  const id = String(field?.id || '');
  if (/作廢/.test(label)) return false;
  if (id === 'check_noncompliant_note' || /_note$/.test(id)) return false;
  return /說明|事由|用途|內容|備註|主旨|廠商/.test(label) || id === 'subject' || id === 'reason' || id === 'purpose' || id === 'desc';
}

