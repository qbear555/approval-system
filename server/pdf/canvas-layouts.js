/**
 * 內建 PDF 排版 → 可編輯畫布物件
 * 這是唯一來源。前端 Vite 建置時讀這個檔，不再另存一份。
 * Node / 瀏覽器共用（UMD）
 *
 * 物件座標 rx/ry/rw/rh 為整頁 0–1（A4 595.28 × 841.89 pt）
 * bind：執行期填值；field：對應申請表單欄位 id
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanvasLayouts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 40;
  const CW = PAGE_W - M * 2;
  const TYPE = 'canvas_objects';

  const THEMES = {
    leave: { fill: '#ecfdf5', stroke: '#047857', ink: '#065f46' },
    purchase: { fill: '#f1f5f9', stroke: '#334155', ink: '#1e293b' },
    expense: { fill: '#fff7ed', stroke: '#c2410c', ink: '#9a3412' },
    travel: { fill: '#eff6ff', stroke: '#1d4ed8', ink: '#1e3a8a' },
    it_repair: { fill: '#eef2ff', stroke: '#4338ca', ink: '#312e81' },
    overtime: { fill: '#fdf2f8', stroke: '#be185d', ink: '#9d174d' },
    general: { fill: '#e2e8f0', stroke: '#1e3a5f', ink: '#1e3a5f' },
    credit_limit: { fill: '#f8fafc', stroke: '#0f766e', ink: '#115e59' },
    welfare: { fill: '#fefce8', stroke: '#a16207', ink: '#854d0e' },
    dept_meeting: { fill: '#f0f9ff', stroke: '#0369a1', ink: '#0c4a6e' },
  };

  function box(x, y, w, h) {
    return {
      rx: +(x / PAGE_W).toFixed(5),
      ry: +(y / PAGE_H).toFixed(5),
      rw: +(w / PAGE_W).toFixed(5),
      rh: +(h / PAGE_H).toFixed(5),
    };
  }

  function oid(prefix, n) {
    return (prefix || 'obj') + '_' + n;
  }

  function cell(opts) {
    const c = Object.assign({ text: '' }, opts || {});
    if (c.w == null) c.w = 1;
    return c;
  }

  function headerObjs(seq, y, title, theme) {
    const t = theme || THEMES.general;
    return [
      {
        id: oid('rect', seq()),
        kind: 'rect',
        ...box(M, y, CW, 66),
        fill: t.fill,
        stroke: t.stroke,
        strokeWidth: 1,
      },
      {
        id: oid('t', seq()),
        kind: 'text',
        ...box(M, y + 10, CW, 18),
        text: '{{company_name}}',
        bind: '__company_name',
        fontSize: 12,
        align: 'center',
        color: t.ink,
      },
      {
        id: oid('t', seq()),
        kind: 'text',
        ...box(M, y + 32, CW, 26),
        text: title,
        fontSize: 18,
        align: 'center',
        color: t.ink,
        bold: true,
      },
    ];
  }

  function metaTable(seq, y) {
    return {
      id: oid('tbl', seq()),
      kind: 'table',
      ...box(M, y, CW, 22),
      rows: [
        {
          h: 22,
          cells: [
            cell({
              w: 0.55,
              label: '申請日',
              text: '{{apply_date}}',
              bind: '__apply_date',
              labelW: 0.28,
            }),
            cell({
              w: 0.45,
              label: '單號',
              text: '{{request_no}}　{{status}}',
              bind: '__request_no',
              labelW: 0.28,
              align: 'right',
            }),
          ],
        },
      ],
    };
  }

  function tableAt(seq, y, rows, extra) {
    const rowHs = rows.map((r) => Number(r.h) || 30);
    const totalH = rowHs.reduce((a, b) => a + b, 0);
    return Object.assign(
      {
        id: oid('tbl', seq()),
        kind: 'table',
        ...box(M, y, CW, totalH),
        rows: rows.map((r, i) => ({
          h: rowHs[i],
          cells: (r.cells || []).map((c) => cell(c)),
        })),
      },
      extra || {}
    );
  }

  function noteAt(seq, y, h, text, extra) {
    return Object.assign(
      {
        id: oid('note', seq()),
        kind: 'note',
        ...box(M, y, CW, h),
        text,
        fontSize: 9,
        color: extra && extra.color ? extra.color : '#92400e',
        fill: extra && extra.fill ? extra.fill : '#fffbeb',
        stroke: extra && extra.stroke ? extra.stroke : '#f59e0b',
      },
      extra || {}
    );
  }

  function signTable(seq, y, labels) {
    const labs = labels && labels.length ? labels : ['申請人', '單位主管', '副總經理', '總經理'];
    const w = 1 / labs.length;
    return tableAt(seq, y, [
      {
        h: 22,
        cells: labs.map((lab) =>
          cell({ w, text: lab, align: 'center', bg: '#f1f5f9', fontSize: 10 })
        ),
      },
      {
        h: 56,
        cells: labs.map((lab, i) =>
          cell({
            w,
            text: '',
            kind: i === 0 ? 'signature' : 'signature',
            stepOrder: i === 0 ? 'requester' : i,
            align: 'center',
          })
        ),
      },
    ]);
  }

  function wrapLayout(sourceType, label, objects, formFields) {
    return {
      type: TYPE,
      sourceType,
      label: label || '可編輯畫布版面',
      page: { size: 'A4', widthPt: PAGE_W, heightPt: PAGE_H, marginPt: M },
      objects,
      formFields: formFields || [],
    };
  }

  function ff(id, label, type, extra) {
    return Object.assign(
      { id, label, type: type || 'text', required: false },
      extra || {}
    );
  }

  function makeLeave() {
    let n = 0;
    const seq = () => ++n;
    const t = THEMES.leave;
    const objects = [];
    let y = M;
    objects.push(...headerObjs(seq, y, '請　假　單', t));
    y += 74;
    objects.push(metaTable(seq, y));
    y += 28;
    objects.push(
      tableAt(seq, y, [
        {
          h: 32,
          cells: [
            cell({
              w: 0.3,
              label: '申請人',
              text: '{{requester_name}}',
              bind: '__requester_name',
              labelW: 0.38,
            }),
            cell({
              w: 0.3,
              label: '單位',
              text: '{{department}}',
              bind: '__requester_dept',
              labelW: 0.32,
            }),
            cell({
              w: 0.4,
              label: '職務代理人',
              text: '',
              bind: 'agent',
              field: 'agent',
              labelW: 0.38,
            }),
          ],
        },
        {
          h: 36,
          cells: [
            cell({
              w: 0.38,
              label: '假別',
              text: '',
              bind: 'leave_type',
              field: 'leave_type',
              labelW: 0.28,
            }),
            cell({
              w: 0.62,
              label: '事由',
              text: '',
              bind: 'reason',
              field: 'reason',
              labelW: 0.18,
            }),
          ],
        },
        {
          h: 48,
          cells: [
            cell({
              w: 0.78,
              label: '請假期間',
              text: '',
              bind: 'leave_period',
              field: 'start_date',
              labelW: 0.18,
            }),
            cell({
              w: 0.22,
              label: '合計',
              text: '',
              bind: 'total_days',
              field: 'days',
              labelW: 0.42,
              align: 'center',
            }),
          ],
        },
        {
          h: 40,
          cells: [
            cell({
              w: 1,
              label: '交接事項',
              text: '',
              bind: 'handover',
              field: 'handover',
              labelW: 0.14,
            }),
          ],
        },
      ])
    );
    y += 32 + 36 + 48 + 40 + 8;
    objects.push(
      noteAt(
        seq,
        y,
        26,
        '※ 業務部、管理部、工程部同仁，如有請休假，都必須設定 email 自動回覆。'
      )
    );
    y += 34;
    objects.push(
      tableAt(seq, y, [
        {
          h: 24,
          cells: [
            cell({
              w: 1,
              text: '差假統計（人事核定）',
              align: 'center',
              bg: '#047857',
              color: '#ffffff',
              fontSize: 11,
            }),
          ],
        },
        {
          h: 32,
          cells: [
            cell({
              w: 0.34,
              label: '核定假別',
              text: '',
              bind: 'hr_leave_type',
              labelW: 0.4,
            }),
            cell({
              w: 0.33,
              label: '本次天數',
              text: '',
              bind: 'days',
              field: 'days',
              labelW: 0.4,
            }),
            cell({
              w: 0.33,
              label: '剩餘日數',
              text: '',
              bind: 'remaining_special_leave_days',
              labelW: 0.42,
            }),
          ],
        },
      ])
    );
    y += 64;
    objects.push({
      id: oid('t', seq()),
      kind: 'text',
      ...box(M, y, CW, 20),
      text: '1. 申請事假、年休假、公假須事前提出申請。　2. 申請病假請檢附掛號費影本，公假請檢附相關證明文件。',
      fontSize: 9,
      color: '#64748b',
    });
    y += 24;
    objects.push({
      id: oid('t', seq()),
      kind: 'text',
      ...box(M, y, CW, 22),
      text: '流程：申請人 → 職務代理人 → 單位主管 → 人事單位 → 副總經理 → 總經理 → 人事留存',
      fontSize: 9,
      align: 'center',
      color: '#065f46',
      fill: '#ecfdf5',
    });
    y += 30;
    objects.push(signTable(seq, y, ['申請人', '職務代理人', '單位主管', '人事', '總經理']));
    return wrapLayout('leave', '請假單（可編輯畫布）', objects, [
      ff('agent', '職務代理人', 'user'),
      ff('leave_type', '假別', 'select', {
        options: ['特別休假', '事假', '病假', '公假', '婚假', '喪假', '生理假'],
        required: true,
      }),
      ff('reason', '事由', 'textarea', { required: true }),
      ff('start_date', '開始時間', 'datetime', { required: true }),
      ff('end_date', '結束時間', 'datetime', { required: true }),
      ff('days', '天數', 'number'),
      ff('hours', '時數', 'number'),
      ff('handover', '交接事項', 'textarea'),
    ]);
  }

  function makeKeyedForm(sourceType, title, theme, rows, fields) {
    let n = 0;
    const seq = () => ++n;
    const objects = [];
    let y = M;
    objects.push(...headerObjs(seq, y, title, theme));
    y += 74;
    objects.push(metaTable(seq, y));
    y += 28;
    objects.push(
      tableAt(seq, y, [
        {
          h: 30,
          cells: [
            cell({
              w: 0.5,
              label: '申請人',
              text: '{{requester_name}}',
              bind: '__requester_name',
              labelW: 0.28,
            }),
            cell({
              w: 0.5,
              label: '單位',
              text: '{{department}}',
              bind: '__requester_dept',
              labelW: 0.24,
            }),
          ],
        },
        ...rows,
      ])
    );
    const tableH = 30 + rows.reduce((a, r) => a + (r.h || 30), 0);
    y += tableH + 16;
    objects.push(signTable(seq, y, ['申請人', '單位主管', '副總經理', '總經理']));
    return wrapLayout(sourceType, title.replace(/\s/g, '') + '（可編輯畫布）', objects, fields);
  }

  function makePurchase() {
    return makeKeyedForm(
      'purchase',
      '請  購  申  請  單',
      THEMES.purchase,
      [
        {
          h: 32,
          cells: [
            cell({ w: 0.7, label: '品名／項目', bind: 'item_name', field: 'item_name', labelW: 0.22 }),
            cell({ w: 0.3, label: '數量', bind: 'qty', field: 'qty', labelW: 0.36, align: 'center' }),
          ],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.28, label: '幣別', bind: 'currency', field: 'currency', labelW: 0.4, align: 'center' }),
            cell({ w: 0.36, label: '預估金額', bind: 'amount', field: 'amount', labelW: 0.36, align: 'center' }),
            cell({ w: 0.36, label: '需用日期', bind: 'need_date', field: 'need_date', labelW: 0.36 }),
          ],
        },
        {
          h: 30,
          cells: [cell({ w: 1, label: '合計金額', bind: 'amount', field: 'amount', labelW: 0.14 })],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '支付方式', bind: 'payment_method', field: 'payment_method', labelW: 0.14 })],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '廠商／客戶', bind: 'vendor', field: 'vendor', labelW: 0.14 })],
        },
        {
          h: 48,
          cells: [cell({ w: 1, label: '事由／用途', bind: 'reason', field: 'reason', labelW: 0.14 })],
        },
      ],
      [
        ff('item_name', '品名／項目', 'text', { required: true }),
        ff('qty', '數量', 'number'),
        ff('currency', '幣別', 'select', { options: ['NTD', 'USD', 'JPY', 'EUR'] }),
        ff('amount', '預估金額', 'number', { required: true }),
        ff('need_date', '需用日期', 'date'),
        ff('payment_method', '支付方式', 'select', { options: ['現金', '期票', '其他'] }),
        ff('vendor', '廠商／客戶', 'text'),
        ff('reason', '事由／用途', 'textarea'),
      ]
    );
  }

  function makeExpense() {
    return makeKeyedForm(
      'expense',
      '費  用  報  支  單',
      THEMES.expense,
      [
        {
          h: 30,
          cells: [cell({ w: 1, label: '主旨', text: '{{title}}', bind: '__title', labelW: 0.12 })],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '費用類別', bind: 'expense_type', field: 'expense_type', labelW: 0.28 }),
            cell({ w: 0.5, label: '發生日期', bind: 'expense_date', field: 'expense_date', labelW: 0.28 }),
          ],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.32, label: '幣別', bind: 'currency', field: 'currency', labelW: 0.36, align: 'center' }),
            cell({ w: 0.68, label: '金額', bind: 'amount', field: 'amount', labelW: 0.18, align: 'center' }),
          ],
        },
        {
          h: 52,
          cells: [cell({ w: 1, label: '費用說明', bind: 'desc', field: 'desc', labelW: 0.14 })],
        },
      ],
      [
        ff('expense_type', '費用類別', 'text', { required: true }),
        ff('expense_date', '發生日期', 'date'),
        ff('currency', '幣別', 'select', { options: ['NTD', 'USD'] }),
        ff('amount', '金額', 'number', { required: true }),
        ff('desc', '費用說明', 'textarea'),
      ]
    );
  }

  function makeTravel() {
    return makeKeyedForm(
      'travel',
      '出  差  申  請  單',
      THEMES.travel,
      [
        {
          h: 30,
          cells: [cell({ w: 1, label: '主旨', text: '{{title}}', bind: '__title', labelW: 0.12 })],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '出差地點', bind: 'destination', field: 'destination', labelW: 0.14 })],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.34, label: '起始日', bind: 'start_date', field: 'start_date', labelW: 0.36 }),
            cell({ w: 0.34, label: '結束日', bind: 'end_date', field: 'end_date', labelW: 0.36 }),
            cell({ w: 0.32, label: '天數', bind: 'days', field: 'days', labelW: 0.36, align: 'center' }),
          ],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '預估費用', bind: 'budget', field: 'budget', labelW: 0.28 }),
            cell({ w: 0.5, label: '申請預支', bind: 'advance', field: 'advance', labelW: 0.28 }),
          ],
        },
        {
          h: 48,
          cells: [cell({ w: 1, label: '出差事由', bind: 'purpose', field: 'purpose', labelW: 0.14 })],
        },
      ],
      [
        ff('destination', '出差地點', 'text', { required: true }),
        ff('start_date', '起始日', 'date', { required: true }),
        ff('end_date', '結束日', 'date', { required: true }),
        ff('days', '天數', 'number'),
        ff('budget', '預估費用', 'number'),
        ff('advance', '申請預支', 'select', { options: ['否', '是'] }),
        ff('purpose', '出差事由', 'textarea'),
      ]
    );
  }

  function makeItRepair() {
    return makeKeyedForm(
      'it_repair',
      '電 腦 異 常 報 修 申 請 單',
      THEMES.it_repair,
      [
        {
          h: 56,
          cells: [cell({ w: 1, label: '設備異常說明', bind: 'issue_desc', field: 'issue_desc', labelW: 0.18 })],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '資產編號', bind: 'asset_no', field: 'asset_no', labelW: 0.28 }),
            cell({ w: 0.5, label: '設備名稱', bind: 'device_name', field: 'device_name', labelW: 0.28 }),
          ],
        },
        {
          h: 40,
          cells: [cell({ w: 1, label: '電腦規格', bind: 'spec', field: 'spec', labelW: 0.14 })],
        },
      ],
      [
        ff('issue_desc', '設備異常說明', 'textarea', { required: true }),
        ff('asset_no', '資產編號', 'text'),
        ff('device_name', '設備名稱', 'text'),
        ff('spec', '電腦規格', 'textarea'),
      ]
    );
  }

  function makeOvertime() {
    return makeKeyedForm(
      'overtime',
      '延 長 工 時 申 請 表',
      THEMES.overtime,
      [
        {
          h: 40,
          cells: [cell({ w: 1, label: '事由', bind: 'reason', field: 'reason', labelW: 0.12 })],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '開始時間', bind: 'start_time', field: 'start_time', labelW: 0.28 }),
            cell({ w: 0.5, label: '結束時間', bind: 'end_time', field: 'end_time', labelW: 0.28 }),
          ],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '合計時數', bind: 'hours', field: 'hours', labelW: 0.14 })],
        },
      ],
      [
        ff('reason', '事由', 'textarea', { required: true }),
        ff('start_time', '開始時間', 'datetime', { required: true }),
        ff('end_time', '結束時間', 'datetime', { required: true }),
        ff('hours', '合計時數', 'number'),
      ]
    );
  }

  function makeGeneral() {
    return makeKeyedForm(
      'general',
      '簽　　呈',
      THEMES.general,
      [
        {
          h: 32,
          cells: [
            cell({ w: 0.7, label: '主旨', text: '{{title}}', bind: '__title', labelW: 0.16 }),
            cell({ w: 0.3, label: '類別', bind: 'category', field: 'category', labelW: 0.36 }),
          ],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '速別', bind: 'urgent', field: 'urgent', labelW: 0.12 })],
        },
        {
          h: 88,
          cells: [cell({ w: 1, label: '說明', bind: 'subject', field: 'subject', labelW: 0.12 })],
        },
      ],
      [
        ff('category', '類別', 'text'),
        ff('urgent', '速別', 'select', { options: ['普通', '急件'] }),
        ff('subject', '說明', 'textarea', { required: true }),
      ]
    );
  }

  function makeCredit() {
    return makeKeyedForm(
      'credit_limit',
      '信 用 額 度 申 請 表',
      THEMES.credit_limit,
      [
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '客戶名稱', bind: 'customer_name', field: 'customer_name', labelW: 0.28 }),
            cell({ w: 0.5, label: '統一編號', bind: 'tax_id', field: 'tax_id', labelW: 0.28 }),
          ],
        },
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '組別', bind: 'group_name', field: 'group_name', labelW: 0.28 }),
            cell({ w: 0.5, label: '申請額度', bind: 'requested_credit_limit', field: 'requested_credit_limit', labelW: 0.28 }),
          ],
        },
        {
          h: 48,
          cells: [cell({ w: 1, label: '申請說明', bind: 'reason', field: 'reason', labelW: 0.14 })],
        },
      ],
      [
        ff('customer_name', '客戶名稱', 'text', { required: true }),
        ff('tax_id', '統一編號', 'text'),
        ff('group_name', '組別', 'text'),
        ff('requested_credit_limit', '申請額度', 'number', { required: true }),
        ff('reason', '申請說明', 'textarea'),
      ]
    );
  }

  function makeWelfare() {
    return makeKeyedForm(
      'welfare',
      '職 工 福 利 金 明 細 月 報 表',
      THEMES.welfare,
      [
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '所屬月份', bind: 'month', field: 'month', labelW: 0.28 }),
            cell({ w: 0.5, label: '金額', bind: 'amount', field: 'amount', labelW: 0.28 }),
          ],
        },
        {
          h: 56,
          cells: [cell({ w: 1, label: '明細說明', bind: 'desc', field: 'desc', labelW: 0.14 })],
        },
      ],
      [
        ff('month', '所屬月份', 'text', { required: true }),
        ff('amount', '金額', 'number'),
        ff('desc', '明細說明', 'textarea'),
      ]
    );
  }

  function makeDeptMeeting() {
    return makeKeyedForm(
      'dept_meeting',
      '會 議 記 錄',
      THEMES.dept_meeting,
      [
        {
          h: 32,
          cells: [
            cell({ w: 0.5, label: '會議日期', bind: 'meeting_date', field: 'meeting_date', labelW: 0.28 }),
            cell({ w: 0.5, label: '地點', bind: 'place', field: 'place', labelW: 0.24 }),
          ],
        },
        {
          h: 32,
          cells: [cell({ w: 1, label: '出席人員', bind: 'attendees', field: 'attendees', labelW: 0.14 })],
        },
        {
          h: 72,
          cells: [cell({ w: 1, label: '會議內容', bind: 'minutes', field: 'minutes', labelW: 0.14 })],
        },
      ],
      [
        ff('meeting_date', '會議日期', 'date', { required: true }),
        ff('place', '地點', 'text'),
        ff('attendees', '出席人員', 'textarea'),
        ff('minutes', '會議內容', 'textarea', { required: true }),
      ]
    );
  }

  const BUILDERS = {
    leave: makeLeave,
    purchase: makePurchase,
    expense: makeExpense,
    travel: makeTravel,
    it_repair: makeItRepair,
    overtime: makeOvertime,
    general: makeGeneral,
    credit_limit: makeCredit,
    welfare: makeWelfare,
    dept_meeting: makeDeptMeeting,
  };

  function builtinToCanvasLayout(type) {
    const key = String(type || 'general').trim();
    const fn = BUILDERS[key] || BUILDERS.general;
    return fn();
  }

  function listBuiltinCanvasSources() {
    return Object.keys(BUILDERS).map((type) => ({
      type,
      label: (BUILDERS[type]() || {}).label || type,
    }));
  }

  function extractFormFields(layout) {
    if (layout && Array.isArray(layout.formFields) && layout.formFields.length) {
      return layout.formFields;
    }
    const seen = new Set();
    const out = [];
    for (const obj of (layout && layout.objects) || []) {
      if (obj.kind === 'field' && obj.fieldId && !seen.has(obj.fieldId)) {
        seen.add(obj.fieldId);
        out.push(ff(obj.fieldId, obj.name || obj.fieldId, obj.fieldType || 'text'));
      }
      if (obj.kind === 'table') {
        for (const row of obj.rows || []) {
          for (const c of row.cells || []) {
            if (c.field && !seen.has(c.field)) {
              seen.add(c.field);
              out.push(ff(c.field, c.label || c.field, 'text'));
            }
          }
        }
      }
    }
    return out;
  }

  return {
    TYPE,
    PAGE_W,
    PAGE_H,
    MARGIN: M,
    THEMES,
    builtinToCanvasLayout,
    listBuiltinCanvasSources,
    extractFormFields,
    BUILDERS: Object.keys(BUILDERS),
  };
});
