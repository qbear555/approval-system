const { resolveFormTheme, formatDisplayValue, STATUS_LABEL } = require('../meta');
const { createSimpleTableKit, appendFieldTable } = require('../kit');
const { toRocParts, flattenApproverData } = require('../comments');

/**
 * resolveFormTheme → createSimpleTableKit 主題（與既有專用表單同一套表格風格）
 */
function kitThemeFromRequest(request) {
  const t = resolveFormTheme(request);
  return {
    header: t.headerBg || t.primary || '#1e3a5f',
    headerSoft: t.sectionBg || '#e2e8f0',
    labelBg: t.labelBg || '#f1f5f9',
    sectionBg: t.sectionBg || '#e2e8f0',
    line: t.border || '#94a3b8',
    lineDark: t.primary || '#334155',
    softLine: t.accentSoft || t.border || '#cbd5e1',
    softInk: t.primary || '#334155',
    altBg: t.rowAlt || '#f8fafc',
    ink: t.text || '#0f172a',
    muted: t.muted || '#64748b',
  };
}

/**
 * 標準簽核 PDF 版型（新建流程的預設）
 * 與現有請假／請購／出差／簽呈等同一套：
 * 彩色抬頭＋標籤格線表格＋區塊標題＋簽核歷程＋附件
 * 依 formFields／form_data 動態排版，無需為新流程另寫專用函式。
 */
function drawStandardWorkflowForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, kitThemeFromRequest(request));
  const {
    C,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    ensureSpace,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = Array.isArray(request.formFields) ? request.formFields : [];
  const formName = String(request.workflow_name || request.form_name || '簽核申請');
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at);
  const LW = 78;

  drawHeader(
    formName,
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 基本資料
  sectionBar('基本資料');
  const applicant = `${request.requester_name || '—'}${
    request.requester_dept ? `（${request.requester_dept}）` : ''
  }`;
  drawRow(
    [
      { w: contentW * 0.5, label: '申請人', value: applicant, labelW: LW },
      {
        w: contentW * 0.5,
        label: '狀態',
        value: STATUS_LABEL[request.status] || request.status || '—',
        labelW: LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: formatDisplayValue(request.title) || '—',
        labelW: LW,
        multi: true,
      },
    ],
    Math.max(
      28,
      Math.min(
        72,
        measureTextH(formatDisplayValue(request.title) || '—', contentW - LW - 16) + 14
      )
    )
  );
  if (request.created_at || request.completed_at) {
    drawRow(
      [
        {
          w: contentW * 0.5,
          label: '建立時間',
          value: formatDisplayValue(request.created_at),
          labelW: LW,
        },
        {
          w: contentW * 0.5,
          label: '完成時間',
          value: request.completed_at
            ? formatDisplayValue(request.completed_at)
            : '—',
          labelW: LW,
        },
      ],
      28
    );
  }

  // 申請表單（動態欄位）
  const renderedIds = new Set();
  if (formFields.length) {
    sectionBar('申請表單');
    for (const f of formFields) {
      if (!f || !f.id) continue;
      renderedIds.add(f.id);
      let val = formData[f.id];
      if (f.type === 'checkbox') {
        val = val ? '是' : '否';
      } else if (f.type === 'user') {
        val =
          formData[`${f.id}__label`] ||
          formData[`${f.id}__name`] ||
          val ||
          '—';
      } else if (f.type === 'datetime') {
        val = val ? String(val).replace('T', ' ').slice(0, 16) : '—';
      }
      const display = formatDisplayValue(val);
      const isLong =
        f.type === 'textarea' ||
        (typeof display === 'string' &&
          (display.length > 40 || display.includes('\n')));
      const rowH = isLong
        ? Math.max(
            32,
            Math.min(
              160,
              measureTextH(display, contentW - LW - 16) + 16
            )
          )
        : 28;
      drawRow(
        [
          {
            w: contentW,
            label: f.label || f.id,
            value: display,
            labelW: LW,
            multi: isLong,
          },
        ],
        rowH
      );
      // 富文字／內嵌表格
      if (
        (typeof formData[f.id] === 'string' && /<table/i.test(formData[f.id])) ||
        formData[`${f.id}__table`]
      ) {
        appendFieldTable(kit, ctx, formData, f.id, '');
      }
    }
  }

  // 無 schema 時列出其他鍵（略過 meta）
  const extraRows = [];
  for (const [k, v] of Object.entries(formData)) {
    if (k.includes('__')) continue;
    if (/^dept_head_\d+$/.test(k) || /^users_pick_\d+$/.test(k)) continue;
    if (renderedIds.has(k)) continue;
    if (/^cosign_\d+$/.test(k)) {
      const label = formData[`${k}__label`];
      extraRows.push([
        '會簽人員',
        label || (v && v !== 'skip' ? String(v) : '略過（無會簽）'),
      ]);
      continue;
    }
    if (!formFields.length && typeof v !== 'object') {
      extraRows.push([k, formatDisplayValue(v)]);
    }
  }
  if (extraRows.length) {
    if (!formFields.length) sectionBar('申請表單');
    for (const [lab, val] of extraRows) {
      drawRow(
        [{ w: contentW, label: lab, value: val, labelW: LW, multi: true }],
        Math.max(28, Math.min(100, measureTextH(String(val), contentW - LW - 16) + 14))
      );
    }
  }

  // 簽核單位填寫
  const ad = flattenApproverData(request.approver_data);
  const adKeys = Object.keys(ad || {});
  if (adKeys.length) {
    const secTitle =
      ad.hr_leave_type != null || ad.remaining_special_leave_days != null
        ? '人事／簽核單位填寫'
        : ad.pc_acquired_date != null || ad.handle_result != null
          ? '管理部／簽核單位填寫'
          : '簽核單位填寫';
    sectionBar(secTitle);
    const adOrder = [
      'hr_leave_type',
      'remaining_special_leave_days',
      'hr_note',
    ];
    const ordered = [
      ...adOrder.filter((k) => adKeys.includes(k)),
      ...adKeys.filter(
        (k) =>
          !adOrder.includes(k) &&
          k !== 'remaining_special_leave_hours' &&
          !/特休.*小時|剩餘.*小時/.test(String(k))
      ),
    ];
    for (const k of ordered) {
      let val = ad[k];
      if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
        val = '—';
      }
      drawRow(
        [
          {
            w: contentW,
            label: adLabelPdf(k, ad),
            value: formatDisplayValue(val),
            labelW: LW,
            multi: true,
          },
        ],
        28
      );
    }
  }

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

module.exports = {
  kitThemeFromRequest,
  drawStandardWorkflowForm,
};
