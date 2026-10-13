/**
 * 以可編輯畫布物件（canvas_objects）重繪申請單 PDF
 */
const { getCompanyNameForPdf } = require('../font');
const { STATUS_LABEL, formatDisplayValue } = require('../meta');
const {
  toRocParts,
  pickFormValue,
  flattenApproverData,
  drawSignatureCell,
} = require('../comments');

function rocDate(raw) {
  const p = toRocParts(raw);
  if (p && p.y !== '') {
    const hm =
      p.hh !== '' ? ` ${p.hh}:${String(p.mm || '00').padStart(2, '0')}` : '';
    return `民國 ${p.y} 年 ${p.m} 月 ${p.d} 日${hm}`;
  }
  return raw ? formatDisplayValue(raw) : '';
}

function buildBindContext(request) {
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data || {}) || {};
  const ctx = {
    company_name: getCompanyNameForPdf(),
    __company_name: getCompanyNameForPdf(),
    requester_name: request.requester_name || '',
    __requester_name: request.requester_name || '',
    department: request.requester_dept || request.department || '',
    __requester_dept: request.requester_dept || request.department || '',
    request_id: request.id != null ? String(request.id) : '',
    __request_id: request.id != null ? String(request.id) : '',
    request_no: request.id != null ? `#${request.id}` : '',
    __request_no: request.id != null ? `#${request.id}` : '',
    status: STATUS_LABEL[request.status] || request.status || '',
    __status: STATUS_LABEL[request.status] || request.status || '',
    apply_date: rocDate(request.created_at),
    __apply_date: rocDate(request.created_at),
    title: request.title || '',
    __title: request.title || '',
    workflow_name: request.workflow_name || '',
    __workflow_name: request.workflow_name || '',
  };
  for (const [k, v] of Object.entries(formData)) {
    if (k.includes('__')) continue;
    if (v == null || typeof v === 'object') continue;
    ctx[k] = v;
  }
  for (const [k, v] of Object.entries(ad)) {
    if (v == null || typeof v === 'object') continue;
    if (ctx[k] == null || ctx[k] === '') ctx[k] = v;
  }
  const start = formData.start_date || formData.start_time;
  const end = formData.end_date || formData.end_time;
  if (start || end) {
    ctx.leave_period = `自 ${rocDate(start) || '—'} 起　至 ${rocDate(end) || '—'} 止`;
  }
  const days = formData.days;
  const hours = formData.hours;
  const totalParts = [];
  if (days != null && days !== '') totalParts.push(`${days} 天`);
  if (hours != null && hours !== '') totalParts.push(`${hours} 時`);
  if (totalParts.length) ctx.total_days = totalParts.join('　');

  function pick(keys, re) {
    return pickFormValue(formData, formFields, keys, re);
  }
  if (!ctx.agent) ctx.agent = pick(['agent'], /代理/) || '';
  if (!ctx.reason) ctx.reason = pick(['reason'], /事由/) || '';
  return ctx;
}

function resolveText(str, ctx) {
  if (str == null) return '';
  return String(str).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = ctx[k] != null ? ctx[k] : ctx['__' + k];
    if (v == null || v === '') return '';
    return String(v);
  });
}

function cellValue(cell, ctx, request) {
  if (cell.bind) {
    const special = ctx[cell.bind];
    if (special != null && special !== '') return String(special);
  }
  const fieldId = cell.field;
  if (fieldId) {
    const formData = request.form_data || {};
    const formFields = request.formFields || [];
    const v =
      formData[fieldId] != null && formData[fieldId] !== ''
        ? formData[fieldId]
        : pickFormValue(formData, formFields, [fieldId], null);
    if (v != null && v !== '' && typeof v !== 'object') return String(v);
  }
  const t = resolveText(cell.text || '', ctx);
  return t;
}

function drawCanvasObjectsForm(ctx, request, layout) {
  const { doc, useFont, pageH } = ctx;
  const pageW = doc.page.width;
  const objects = Array.isArray(layout && layout.objects) ? layout.objects : [];
  const bindCtx = buildBindContext(request);
  const actions = request.actions || [];

  function fillRect(x, y, w, h, color) {
    if (!color) return;
    doc.rect(x, y, w, h).fill(color);
  }
  function strokeRect(x, y, w, h, color, width) {
    doc
      .rect(x, y, w, h)
      .strokeColor(color || '#334155')
      .lineWidth(width != null ? width : 0.7)
      .stroke();
  }
  function textBox(str, x, y, w, h, opts) {
    useFont();
    const size = opts.size || 11;
    const align = opts.align || 'left';
    const color = opts.color || '#0f172a';
    const pad = opts.pad != null ? opts.pad : 4;
    const ty = y + Math.max(2, (h - size * 0.9) / 2);
    doc.fillColor(color).fontSize(size).text(String(str ?? ''), x + pad, opts.multi ? y + 5 : ty, {
      width: Math.max(8, w - pad * 2),
      align,
      lineBreak: !!opts.multi,
      height: opts.multi ? Math.max(8, h - 8) : undefined,
    });
  }

  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const x = Number(obj.rx || 0) * pageW;
    const y = Number(obj.ry || 0) * pageH;
    const w = Number(obj.rw || 0) * pageW;
    const h = Number(obj.rh || 0) * pageH;
    if (w <= 0 || h <= 0) continue;

    if (y + h > pageH - 12) {
      doc.addPage();
    }

    const kind = obj.kind || 'text';
    if (kind === 'rect') {
      if (obj.fill) fillRect(x, y, w, h, obj.fill);
      strokeRect(x, y, w, h, obj.stroke || '#334155', obj.strokeWidth || 0.8);
      continue;
    }

    if (kind === 'text' || kind === 'note') {
      if (obj.fill) fillRect(x, y, w, h, obj.fill);
      if (obj.stroke) strokeRect(x, y, w, h, obj.stroke, 0.6);
      const raw = obj.bind && bindCtx[obj.bind] != null && bindCtx[obj.bind] !== ''
        ? String(bindCtx[obj.bind])
        : resolveText(obj.text || '', bindCtx);
      textBox(raw || obj.text || '', x, y, w, h, {
        size: obj.fontSize || (kind === 'note' ? 9 : 12),
        align: obj.align || 'left',
        color: obj.color || '#0f172a',
        multi: kind === 'note' || h > 22,
      });
      continue;
    }

    if (kind === 'field') {
      fillRect(x, y, w, h, '#ffffff');
      strokeRect(x, y, w, h, '#94a3b8', 0.5);
      const fid = obj.fieldId || obj.bind;
      const val = fid ? cellValue({ bind: fid, field: fid, text: obj.text }, bindCtx, request) : resolveText(obj.text || '', bindCtx);
      textBox(val || '—', x, y, w, h, {
        size: obj.fontSize || 11,
        align: obj.align || 'left',
        color: '#0f172a',
        multi: obj.fieldType === 'textarea',
      });
      continue;
    }

    if (kind === 'signature') {
      fillRect(x, y, w, h, '#fffbeb');
      strokeRect(x, y, w, h, '#d97706', 0.7);
      const stepOrder = obj.stepOrder;
      let sigAction = null;
      if (stepOrder === 'requester') {
        sigAction = actions.find((a) => a.action === 'submit' && a.signature_image) || null;
      } else if (stepOrder != null) {
        const ord = Number(stepOrder);
        sigAction =
          actions.find(
            (a) =>
              a.signature_image &&
              (Number(a.step_order) === ord || Number(a.step) === ord)
          ) || null;
      }
      if (sigAction && sigAction.signature_image) {
        drawSignatureCell(doc, sigAction.signature_image, { x, y, w, h }, () => {});
      } else {
        textBox(obj.name || '簽章', x, y, w, h, {
          size: 9,
          align: 'center',
          color: '#92400e',
        });
      }
      continue;
    }

    if (kind === 'table') {
      const rows = Array.isArray(obj.rows) ? obj.rows : [];
      const sumH = rows.reduce((a, r) => a + (Number(r.h) || 28), 0) || 1;
      let yy = y;
      rows.forEach((row) => {
        const rh = ((Number(row.h) || 28) / sumH) * h;
        const cells = Array.isArray(row.cells) ? row.cells : [];
        const sumW = cells.reduce((a, c) => a + (Number(c.w) || 1), 0) || 1;
        let xx = x;
        cells.forEach((c) => {
          const cw = ((Number(c.w) || 1) / sumW) * w;
          const bg = c.bg || '#ffffff';
          fillRect(xx, yy, cw, rh, bg);
          const hasLabel = c.label != null && c.label !== '';
          const labelW = hasLabel ? Math.max(28, cw * (Number(c.labelW) || 0.28)) : 0;
          if (hasLabel) {
            fillRect(xx, yy, labelW, rh, c.labelBg || '#f1f5f9');
            textBox(c.label, xx, yy, labelW, rh, {
              size: 9.5,
              align: 'center',
              color: '#334155',
              pad: 2,
            });
          }
          const val = cellValue(c, bindCtx, request);
          const display = val || (c.bind || c.field ? '—' : '');
          if (c.kind === 'signature') {
            const stepOrder = c.stepOrder;
            let sigAction = null;
            if (stepOrder === 'requester') {
              sigAction = actions.find((a) => a.signature_image && a.action === 'submit') || null;
            } else if (stepOrder != null) {
              const ord = Number(stepOrder);
              sigAction =
                actions.find(
                  (a) =>
                    a.signature_image &&
                    (Number(a.step_order) === ord || Number(a.step) === ord)
                ) || null;
            }
            if (sigAction && sigAction.signature_image) {
              drawSignatureCell(
                doc,
                sigAction.signature_image,
                { x: xx + labelW, y: yy, w: cw - labelW, h: rh },
                () => {}
              );
            }
          } else {
            textBox(display, xx + labelW, yy, cw - labelW, rh, {
              size: c.fontSize || 11,
              align: c.align || 'left',
              color: c.color || '#0f172a',
              multi: rh > 36 || String(display).length > 18,
            });
          }
          xx += cw;
        });
        yy += rh;
      });
      strokeRect(x, y, w, h, '#334155', 0.75);
      // inner lines
      let yy2 = y;
      rows.forEach((row, ri) => {
        const rh = ((Number(row.h) || 28) / sumH) * h;
        if (ri > 0) {
          doc
            .moveTo(x, yy2)
            .lineTo(x + w, yy2)
            .strokeColor('#64748b')
            .lineWidth(0.45)
            .stroke();
        }
        const cells = Array.isArray(row.cells) ? row.cells : [];
        const sumW = cells.reduce((a, c) => a + (Number(c.w) || 1), 0) || 1;
        let xx = x;
        cells.forEach((c, ci) => {
          const cw = ((Number(c.w) || 1) / sumW) * w;
          if (ci > 0) {
            doc
              .moveTo(xx, yy2)
              .lineTo(xx, yy2 + rh)
              .strokeColor('#64748b')
              .lineWidth(0.45)
              .stroke();
          }
          if (c.label) {
            const labelW = Math.max(28, cw * (Number(c.labelW) || 0.28));
            doc
              .moveTo(xx + labelW, yy2)
              .lineTo(xx + labelW, yy2 + rh)
              .strokeColor('#94a3b8')
              .lineWidth(0.4)
              .stroke();
          }
          xx += cw;
        });
        yy2 += rh;
      });
    }
  }
}

module.exports = {
  drawCanvasObjectsForm,
  buildBindContext,
  resolveText,
};
