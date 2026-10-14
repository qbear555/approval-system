/**
 * 畫布／紙本設計器純函式。座標 rx/ry/rw/rh 為整頁 0–1。
 */


export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

const KIND_LABEL = {
  text: '文字',
  table: '表格',
  field: '欄位',
  signature: '簽章',
  note: '說明',
  rect: '色塊',
};

export function kindLabel(kind) {
  return KIND_LABEL[kind] || kind || '物件';
}

export function genId(prefix = 'obj') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function templateFileUrl(templateFile) {
  const f = String(templateFile || '');
  if (!f) return '';
  if (f.startsWith('/') || f.startsWith('http')) return f;
  return `/api/${f}`;
}

export function loadCanvasLayouts() {
  return import('virtual:canvas-layouts').then((mod) => mod.default || mod);
}

export function newCanvasObject(kind, after) {
  const id = genId(kind === 'table' ? 'tbl' : 'obj');
  const base = { id, kind, rx: 0.12, ry: 0.18, rw: 0.76, rh: 0.06, fontSize: 12, align: 'left' };
  if (kind === 'text') Object.assign(base, { text: '新文字', color: '#0f172a' });
  if (kind === 'note') Object.assign(base, { text: '說明文字', fill: '#fffbeb', stroke: '#f59e0b', rh: 0.04, fontSize: 9 });
  if (kind === 'field') Object.assign(base, { text: '', fieldId: id, fieldType: 'text', name: '新欄位' });
  if (kind === 'signature') Object.assign(base, { text: '簽章', stepOrder: 'requester', rh: 0.08 });
  if (kind === 'rect') Object.assign(base, { fill: '#e2e8f0', stroke: '#334155', rh: 0.08 });
  if (kind === 'table') {
    Object.assign(base, {
      rh: 0.08,
      rows: [
        { h: 30, cells: [{ w: 0.5, label: '欄位一', text: '', labelW: 0.3 }, { w: 0.5, label: '欄位二', text: '', labelW: 0.3 }] },
        { h: 30, cells: [{ w: 0.5, label: '欄位三', text: '', labelW: 0.3 }, { w: 0.5, label: '欄位四', text: '', labelW: 0.3 }] },
      ],
    });
  }
  if (after) base.ry = Math.min(0.88, (after.ry || 0) + (after.rh || 0.05) + 0.012);
  return base;
}

export function newPaperField(partial = {}) {
  return {
    id: genId('f'),
    name: '新欄位',
    type: 'text',
    page: 1,
    rx: 0.2,
    ry: 0.2,
    rw: 0.28,
    rh: 0.04,
    fontSize: 12,
    align: 'left',
    required: false,
    options: [],
    ...partial,
  };
}

export function clampBox(box) {
  const rw = Math.max(0.03, Math.min(1, Number(box.rw) || 0.1));
  const rh = Math.max(0.015, Math.min(1, Number(box.rh) || 0.04));
  const rx = Math.max(0, Math.min(1 - rw, Number(box.rx) || 0));
  const ry = Math.max(0, Math.min(1 - rh, Number(box.ry) || 0));
  return { rx, ry, rw, rh };
}

export function applyDrag(start, dx, dy) {
  return clampBox({
    rx: start.rx + dx,
    ry: start.ry + dy,
    rw: start.rw,
    rh: start.rh,
  });
}

export function applyResize(start, dir, dx, dy) {
  const MIN_W = 0.04;
  const MIN_H = 0.015;
  let { rx, ry, rw, rh } = start;
  if (dir.includes('e')) rw = Math.max(MIN_W, Math.min(1 - start.rx, start.rw + dx));
  else if (dir.includes('w')) {
    const maxR = start.rx + start.rw;
    rx = Math.min(maxR - MIN_W, Math.max(0, start.rx + dx));
    rw = maxR - rx;
  }
  if (dir.includes('s')) rh = Math.max(MIN_H, Math.min(1 - start.ry, start.rh + dy));
  else if (dir.includes('n')) {
    const maxB = start.ry + start.rh;
    ry = Math.min(maxB - MIN_H, Math.max(0, start.ry + dy));
    rh = maxB - ry;
  }
  return { rx, ry, rw, rh };
}

export function formFieldsFromObjects(objects = []) {
  const out = [];
  const seen = new Set();
  objects.forEach((obj) => {
    if (obj.kind === 'field' && obj.fieldId && !seen.has(obj.fieldId)) {
      seen.add(obj.fieldId);
      out.push({
        id: obj.fieldId,
        label: obj.name || obj.fieldId,
        type: obj.fieldType || 'text',
        required: !!obj.required,
      });
    }
    if (obj.kind === 'table') {
      (obj.rows || []).forEach((row) => {
        (row.cells || []).forEach((c) => {
          const fid = c.field || (c.bind && !String(c.bind).startsWith('__') ? c.bind : '');
          if (fid && !seen.has(fid)) {
            seen.add(fid);
            out.push({ id: fid, label: c.label || fid, type: 'text', required: false });
          }
        });
      });
    }
  });
  return out;
}

export function formFieldsFromPaper(fields = []) {
  return fields
    .filter((f) => f.type !== 'signature' && !f.isStamp)
    .map((f) => ({
      id: f.id,
      label: f.name || f.id,
      type: f.type || 'text',
      required: !!f.required,
      options: f.options || [],
    }));
}

export function buildCanvasLayout(src, objects) {
  return {
    type: 'canvas_objects',
    label: src.label || '可編輯畫布版面',
    sourceType: src.sourceType || '',
    page: src.page || { size: 'A4', widthPt: PAGE_W, heightPt: PAGE_H, marginPt: 40 },
    objects,
  };
}

export function buildPaperLayout(layout, fields, templateFile) {
  return {
    type: 'pdf_template',
    label: '紙本底圖套印版面',
    templateFile: templateFile || '',
    templateMeta: layout.templateMeta || {},
    fields,
    formMode: 'paper',
  };
}

/** 由底圖水平格線推估填寫欄（與經典掃描同一規則）。 */
export function detectGridBoxes(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return [];
  const scale = Math.min(1, 600 / w);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.drawImage(canvas, 0, 0, sw, sh);
  const data = octx.getImageData(0, 0, sw, sh).data;
  const isDark = (x, y) => {
    const idx = (y * sw + x) * 4;
    return data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114 < 145;
  };
  const hLines = [];
  for (let y = 15; y < sh - 15; y += 3) {
    let run = 0;
    let startX = 0;
    for (let x = 0; x < sw; x++) {
      if (isDark(x, y)) {
        if (run === 0) startX = x;
        run++;
      } else {
        if (run > sw * 0.18) hLines.push({ y, x1: startX, x2: startX + run });
        run = 0;
      }
    }
    if (run > sw * 0.18) hLines.push({ y, x1: startX, x2: startX + run });
  }
  const uniqueY = [];
  for (const hl of hLines) {
    if (!uniqueY.some((y) => Math.abs(y - hl.y) < 12)) uniqueY.push(hl.y);
  }
  uniqueY.sort((a, b) => a - b);
  const boxes = [];
  for (let i = 0; i < uniqueY.length - 1; i++) {
    const y1 = uniqueY[i];
    const y2 = uniqueY[i + 1];
    const boxH = y2 - y1;
    if (boxH >= 16 && boxH <= 140) {
      boxes.push({
        name: `填寫欄位 ${boxes.length + 1}`,
        type: boxH > 55 ? 'textarea' : 'text',
        rx: 0.32,
        ry: Math.round(((y1 + 2) / sh) * 1000) / 1000,
        rw: 0.58,
        rh: Math.round((Math.max(0.03, (boxH - 4) / sh)) * 1000) / 1000,
      });
    }
  }
  return boxes;
}

export async function detectPdfWidgets(page, viewport, pageNumber) {
  if (!page || !viewport || typeof page.getAnnotations !== 'function') return [];
  const annotations = await page.getAnnotations();
  const widgets = (annotations || []).filter((a) => a.subtype === 'Widget' || a.fieldType);
  const detected = [];
  for (const a of widgets) {
    const rect = a.rect;
    if (!rect || rect.length !== 4) continue;
    const pt1 = viewport.convertToViewportPoint(rect[0], rect[3]);
    const pt2 = viewport.convertToViewportPoint(rect[2], rect[1]);
    const bx = Math.min(pt1[0], pt2[0]);
    const by = Math.min(pt1[1], pt2[1]);
    const bw = Math.abs(pt2[0] - pt1[0]);
    const bh = Math.abs(pt2[1] - pt1[1]);
    let aType = 'text';
    if (a.fieldType === 'Sig') aType = 'signature';
    else if (a.fieldType === 'Btn') aType = 'checkbox';
    else if (a.fieldType === 'Ch') aType = 'select';
    detected.push(
      newPaperField({
        id: genId(aType === 'signature' ? 'stamp' : 'f'),
        name: a.alternativeText || a.fieldName || `欄位 ${detected.length + 1}`,
        type: aType,
        isStamp: aType === 'signature',
        page: pageNumber,
        rx: Math.max(0, Math.round((bx / viewport.width) * 1000) / 1000),
        ry: Math.max(0, Math.round((by / viewport.height) * 1000) / 1000),
        rw: Math.max(0.04, Math.round((bw / viewport.width) * 1000) / 1000),
        rh: Math.max(0.02, Math.round((bh / viewport.height) * 1000) / 1000),
      })
    );
  }
  return detected;
}
