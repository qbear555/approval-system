/**
 * 線上簽核系統 — 一般使用者完整操作手冊（詳細版）
 * 依實際 UI（側欄、色系、選單、七大流程表單）繪製示意介面
 *
 * node docs/build-general-user-manual-pptx.js [輸出路徑]
 */
const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const out =
  process.argv[2] ||
  path.join(__dirname, '線上簽核系統_一般使用者完整操作手冊.pptx');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = '線上簽核系統';
pres.title = '線上簽核系統 — 一般使用者完整操作手冊';
pres.subject = '登入、七大申請流程、簽核、查詢、通知';
pres.company = 'Cats. / ARGO';

const C = {
  navy: '0F2744',
  navy2: '16355A',
  primary: '2563EB',
  primarySoft: 'DBEAFE',
  bg: 'F1F5F9',
  card: 'FFFFFF',
  text: '0F172A',
  muted: '64748B',
  white: 'FFFFFF',
  green: '059669',
  greenBg: 'D1FAE5',
  amber: 'D97706',
  amberBg: 'FEF3C7',
  red: 'DC2626',
  redBg: 'FEE2E2',
  border: 'E2E8F0',
  side: '0F2744',
  input: 'F8FAFC',
  yellowBg: 'FFFBEB',
  yellowBorder: 'FBBF24',
};

const FONT = 'Microsoft JhengHei';
const sh = () => ({
  type: 'outer',
  color: '000000',
  blur: 8,
  offset: 2,
  angle: 135,
  opacity: 0.12,
});

/** 七大流程（與系統 seed／正式站一致） */
const WORKFLOWS = [
  {
    name: '請假申請',
    desc: '申請人 → 代理人 → 人事單位 → 部門主管 → 副總經理（兩位皆須核准）→ 總經理',
    steps: ['代理人', '人事單位', '部門主管', '副總經理', '總經理'],
    fields: [
      ['代理人', '人員選擇', '必填'],
      ['假別', '下拉選單（特休／事假／病假…）', '必填'],
      ['起始日／時間', '日期+時間（30 分）', '必填'],
      ['結束日／時間', '日期+時間', '必填'],
      ['天數／小時', '數字（可自動試算）', '天數必填'],
      ['事由', '多行文字', '選填'],
    ],
    tips: [
      '送出後代理人需先簽；人事可能核定假別',
      '核准後若有「最終通知」，請依公司規定設定 Email 自動回覆後於系統確認',
      '特休／已休時數可於帳號或人事相關畫面查詢（視權限）',
    ],
  },
  {
    name: '請購申請',
    desc: '申請人 → 部門主管 → 副總經理 → 總經理',
    steps: ['部門主管', '副總經理', '總經理'],
    fields: [
      ['品名／項目', '文字', '必填'],
      ['數量', '數字', '必填'],
      ['預估金額', '數字', '必填'],
      ['建議廠商', '文字', '選填'],
      ['請購事由', '多行文字', '必填'],
      ['需用日期', '日期', '選填'],
    ],
    tips: ['金額較高時關卡仍依流程設定', '附件可上傳報價單、規格書'],
  },
  {
    name: '一般簽呈',
    desc: '申請人 → 部門主管（可略過）→ 會簽人員（可多選、皆須核准）→ 副總經理 → 總經理',
    steps: ['部門主管', '會簽人員', '副總經理', '總經理'],
    fields: [
      ['主旨說明', '多行文字', '必填（僅此流程需填主旨）'],
      ['類別', '下拉', '必填'],
      ['急件', '勾選', '選填'],
    ],
    tips: [
      '一般簽呈為少數需自行填「主旨」的流程',
      '會簽為「皆須核准」時，每位會簽人都要同意',
    ],
  },
  {
    name: '費用報支',
    desc: '申請人 → 部門主管 → 副總經理 → 總經理',
    steps: ['部門主管', '副總經理', '總經理'],
    fields: [
      ['費用類別', '下拉', '必填'],
      ['金額', '數字', '必填'],
      ['發生日期', '日期', '必填'],
      ['費用說明', '多行文字', '必填'],
    ],
    tips: ['請附上發票／收據掃描檔作為附件', '金額請與憑證一致'],
  },
  {
    name: '出差申請',
    desc: '申請人 → 人事單位 → 部門主管 → 副總經理 → 總經理',
    steps: ['人事單位', '部門主管', '副總經理', '總經理'],
    fields: [
      ['出差地點', '文字', '必填'],
      ['起始日／結束日', '日期', '必填'],
      ['出差事由', '多行文字', '必填'],
      ['預估費用', '數字', '選填'],
    ],
    tips: ['出差結束後相關報支可另開「費用報支」'],
  },
  {
    name: '延長工時申請',
    desc: '申請人 → 部門主管 → 副總經理 → 人事核算 → 總經理',
    steps: ['部門主管', '副總經理', '人事單位', '總經理'],
    fields: [
      ['事由', '多行文字', '必填'],
      ['延長工時開始／結束', '日期時間', '必填'],
      ['申請時數（小時）', '數字', '必填'],
      ['選擇項目', '誤餐費或補休（擇一）', '必填'],
      ['其他說明', '文字', '選填'],
    ],
    tips: [
      '誤餐費與補休僅可擇一',
      '補休累計上限與期限依公司規定（如 40 小時／一年內）',
    ],
  },
  {
    name: '電腦異常報修申請',
    desc: '申請人 → 管理部檢修 → 副總經理 → 總經理',
    steps: ['管理部檢修', '副總經理', '總經理'],
    fields: [
      ['設備異常說明', '多行文字', '必填'],
      ['電腦規格（申請人填寫）', '多行文字', '選填'],
    ],
    tips: ['請清楚描述故障現象、發生時間、是否影響業務', '管理部檢修後才會往上呈核'],
  },
];

const NAV = ['總覽', '待我簽核', '我的申請', '簽核紀錄', '新增申請', '帳號設定'];

let slideCount = 0;
const slidesMeta = [];

function footer(slide, title) {
  slideCount++;
  slidesMeta.push(title);
  slide.addText(`一般使用者操作手冊  ·  ${slideCount}`, {
    x: 0.4,
    y: 5.28,
    w: 6.2,
    h: 0.24,
    fontSize: 10,
    color: C.muted,
    fontFace: FONT,
    margin: 0,
  });
  slide.addText('依實際介面整理 · 內網簽核系統', {
    x: 6.5,
    y: 5.28,
    w: 3.1,
    h: 0.24,
    fontSize: 10,
    color: C.muted,
    align: 'right',
    fontFace: FONT,
    margin: 0,
  });
}

function header(slide, title, sub) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: sub ? 0.88 : 0.72,
    fill: { color: C.navy },
  });
  slide.addText(title, {
    x: 0.4,
    y: 0.12,
    w: 9.2,
    h: 0.36,
    fontSize: 20,
    bold: true,
    color: C.white,
    fontFace: FONT,
    margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.4,
      y: 0.48,
      w: 9.2,
      h: 0.3,
      fontSize: 12,
      color: '94A3B8',
      fontFace: FONT,
      margin: 0,
    });
  }
}

function drawSidebar(slide, x, y, w, h, active) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: C.side },
    rectRadius: 0.08,
  });
  slide.addText('線上簽核系統', {
    x: x + 0.1,
    y: y + 0.1,
    w: w - 0.2,
    h: 0.32,
    fontSize: 11,
    bold: true,
    color: C.white,
    fontFace: FONT,
    margin: 0,
  });
  NAV.forEach((name, i) => {
    const iy = y + 0.5 + i * 0.36;
    const on = name === active;
    if (on) {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: x + 0.08,
        y: iy,
        w: w - 0.16,
        h: 0.3,
        fill: { color: C.primary },
        rectRadius: 0.04,
      });
    }
    slide.addText(name, {
      x: x + 0.16,
      y: iy,
      w: w - 0.3,
      h: 0.3,
      fontSize: 11,
      color: on ? C.white : 'CBD5E1',
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  slide.addShape(pres.shapes.OVAL, {
    x: x + 0.12,
    y: y + h - 0.48,
    w: 0.28,
    h: 0.28,
    fill: { color: C.primary },
  });
  slide.addText('員', {
    x: x + 0.12,
    y: y + h - 0.48,
    w: 0.28,
    h: 0.28,
    fontSize: 10,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  slide.addText('一般使用者', {
    x: x + 0.45,
    y: y + h - 0.48,
    w: w - 0.55,
    h: 0.28,
    fontSize: 10,
    color: C.white,
    fontFace: FONT,
    valign: 'middle',
    margin: 0,
  });
}

function browserChrome(slide, x, y, w, h, url) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: C.card },
    line: { color: C.border, width: 1 },
    rectRadius: 0.08,
    shadow: sh(),
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h: 0.3,
    fill: { color: 'E2E8F0' },
  });
  ['EF4444', 'F59E0B', '22C55E'].forEach((col, i) => {
    slide.addShape(pres.shapes.OVAL, {
      x: x + 0.12 + i * 0.16,
      y: y + 0.09,
      w: 0.11,
      h: 0.11,
      fill: { color: col },
    });
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x + 0.85,
    y: y + 0.06,
    w: w - 1.05,
    h: 0.18,
    fill: { color: C.white },
    rectRadius: 0.03,
  });
  slide.addText(url, {
    x: x + 0.9,
    y: y + 0.06,
    w: w - 1.15,
    h: 0.18,
    fontSize: 8,
    color: C.muted,
    fontFace: 'Consolas',
    valign: 'middle',
    margin: 0,
  });
}

function card(slide, x, y, w, h) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: C.card },
    line: { color: C.border, width: 1 },
    rectRadius: 0.08,
    shadow: sh(),
  });
}

function bulletList(slide, items, x, y, w, h, size = 13) {
  slide.addText(
    items.map((t, i) => ({
      text: t,
      options: { bullet: true, breakLine: i < items.length - 1 },
    })),
    {
      x,
      y,
      w,
      h,
      fontSize: size,
      color: C.text,
      fontFace: FONT,
      paraSpaceAfter: 4,
      valign: 'top',
    }
  );
}

// ========== 1 封面 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 4.6,
    w: 10,
    h: 1.025,
    fill: { color: C.navy2 },
  });
  s.addText('線上簽核系統', {
    x: 0.6,
    y: 1.4,
    w: 8.8,
    h: 0.55,
    fontSize: 18,
    color: '93C5FD',
    fontFace: FONT,
    margin: 0,
  });
  s.addText('一般使用者完整操作手冊', {
    x: 0.6,
    y: 2.0,
    w: 8.8,
    h: 0.7,
    fontSize: 32,
    bold: true,
    color: C.white,
    fontFace: FONT,
    margin: 0,
  });
  s.addText(
    '登入 · 七大申請流程 · 待簽核 · 查詢 · 通知 · 常見問題\n依實際介面步驟說明（含 UI 示意圖）',
    {
      x: 0.6,
      y: 2.85,
      w: 8.8,
      h: 0.7,
      fontSize: 14,
      color: 'CBD5E1',
      fontFace: FONT,
      margin: 0,
    }
  );
  s.addText('正式站：http://192.168.99.220:3847 ｜ https://192.168.99.220:3848\n本機測試：http://127.0.0.1:8080', {
    x: 0.6,
    y: 4.8,
    w: 8.8,
    h: 0.55,
    fontSize: 12,
    color: '94A3B8',
    fontFace: FONT,
    margin: 0,
  });
  slideCount++;
  slidesMeta.push('封面');
}

// ========== 2 目錄 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '目錄', '本手冊章節一覽');
  const cols = [
    [
      '一、開始使用',
      '二、登入系統',
      '三、主畫面與側欄',
      '四、總覽',
      '五、新增申請（通用）',
      '六、七大簽核流程詳解',
    ],
    [
      '七、我的申請',
      '八、待我簽核（簽核人）',
      '九、簽核紀錄與 PDF',
      '十、帳號設定與通知',
      '十一、狀態對照與 FAQ',
      '十二、練習路徑',
    ],
  ];
  cols.forEach((col, ci) => {
    card(s, 0.4 + ci * 4.7, 1.15, 4.4, 3.7);
    bulletList(s, col, 0.65 + ci * 4.7, 1.4, 4.0, 3.3, 15);
  });
  footer(s, '目錄');
}

// ========== 3 使用對象 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '一、開始使用 — 誰適用本手冊', '一般使用者（非系統管理員專用功能）');
  const boxes = [
    { t: '適用', d: '全體同仁：送出請假、請購、簽呈、報支、出差、加班、報修；以及輪到您時簽核他人單據。', c: C.greenBg },
    { t: '不在本手冊', d: '系統設定、簽核流程設計、成員權限、備份、PDF 公司憑證製作等（屬管理員）。', c: C.amberBg },
    { t: '網路環境', d: '僅公司內網。請連公司網路或 VPN 後再開網址，勿從外網直接連線。', c: C.primarySoft },
  ];
  boxes.forEach((b, i) => {
    const y = 1.2 + i * 1.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.45,
      y,
      w: 9.1,
      h: 1.0,
      fill: { color: b.c },
      rectRadius: 0.1,
    });
    s.addText(b.t, {
      x: 0.7,
      y: y + 0.15,
      w: 1.6,
      h: 0.7,
      fontSize: 16,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
    s.addText(b.d, {
      x: 2.4,
      y: y + 0.2,
      w: 6.9,
      h: 0.65,
      fontSize: 13,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '使用對象');
}

// ========== 4 開啟網址 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '一、開始使用 — 如何開啟系統', '建議使用 Chrome 或 Microsoft Edge');
  browserChrome(s, 0.5, 1.2, 9.0, 3.6, 'https://192.168.99.220:3848/');
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5,
    y: 1.5,
    w: 9.0,
    h: 3.3,
    fill: { color: C.bg },
  });
  const urls = [
    ['正式站 HTTPS', 'https://192.168.99.220:3848/', '建議'],
    ['正式站 HTTP', 'http://192.168.99.220:3847/', '備援'],
    ['本機測試', 'http://127.0.0.1:8080/', '開發／本機'],
  ];
  urls.forEach((u, i) => {
    const x = 0.85 + i * 2.9;
    card(s, x, 2.0, 2.7, 1.8);
    s.addText(u[0], {
      x: x + 0.15,
      y: 2.15,
      w: 2.4,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      margin: 0,
    });
    s.addText(u[1], {
      x: x + 0.15,
      y: 2.55,
      w: 2.4,
      h: 0.7,
      fontSize: 11,
      color: C.primary,
      fontFace: FONT,
      margin: 0,
    });
    s.addText(u[2], {
      x: x + 0.15,
      y: 3.35,
      w: 2.4,
      h: 0.3,
      fontSize: 12,
      color: C.muted,
      fontFace: FONT,
      margin: 0,
    });
  });
  s.addText('若 HTTPS 出現憑證警告：多為內網自簽憑證，請依公司 IT 指引繼續或匯入信任根憑證。', {
    x: 0.6,
    y: 4.55,
    w: 8.8,
    h: 0.4,
    fontSize: 12,
    color: C.muted,
    fontFace: FONT,
    margin: 0,
  });
  footer(s, '開啟網址');
}

// ========== 5 登入 UI ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '二、登入系統 — 畫面說明', '對應實際登入頁（auth-card）');
  // mock login card
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.8,
    y: 1.15,
    w: 4.4,
    h: 3.7,
    fill: { color: C.card },
    line: { color: C.border, width: 1 },
    rectRadius: 0.15,
    shadow: sh(),
  });
  s.addText('公司名稱 / Logo', {
    x: 3.0,
    y: 1.35,
    w: 4.0,
    h: 0.3,
    fontSize: 12,
    color: C.primary,
    align: 'center',
    fontFace: FONT,
    margin: 0,
  });
  s.addText('線上簽核系統', {
    x: 3.0,
    y: 1.7,
    w: 4.0,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: C.text,
    align: 'center',
    fontFace: FONT,
    margin: 0,
  });
  s.addText('請輸入帳號與密碼', {
    x: 3.0,
    y: 2.1,
    w: 4.0,
    h: 0.25,
    fontSize: 11,
    color: C.muted,
    align: 'center',
    fontFace: FONT,
    margin: 0,
  });
  [
    ['帳號', '請輸入使用者帳號'],
    ['密碼', '••••••••'],
  ].forEach((row, i) => {
    const y = 2.5 + i * 0.7;
    s.addText(row[0], {
      x: 3.15,
      y,
      w: 3.7,
      h: 0.22,
      fontSize: 11,
      color: C.muted,
      fontFace: FONT,
      margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 3.15,
      y: y + 0.22,
      w: 3.7,
      h: 0.38,
      fill: { color: C.input },
      line: { color: C.border, width: 1 },
      rectRadius: 0.06,
    });
    s.addText(row[1], {
      x: 3.3,
      y: y + 0.22,
      w: 3.4,
      h: 0.38,
      fontSize: 12,
      color: C.muted,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.15,
    y: 4.15,
    w: 3.7,
    h: 0.42,
    fill: { color: C.primary },
    rectRadius: 0.08,
  });
  s.addText('登 入', {
    x: 3.15,
    y: 4.15,
    w: 3.7,
    h: 0.42,
    fontSize: 14,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    fontFace: FONT,
    margin: 0,
  });
  footer(s, '登入畫面');
}

// ========== 6 登入步驟 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '二、登入系統 — 操作步驟', '帳號由人資／管理員核發');
  const steps = [
    { n: '1', t: '開啟瀏覽器', d: '連上公司內網後，輸入正式站網址' },
    { n: '2', t: '輸入帳號', d: '通常為英文帳號（username），注意大小寫' },
    { n: '3', t: '輸入密碼', d: '預設密碼請於首次登入後至「帳號設定」修改' },
    { n: '4', t: '按「登入」', d: '成功後進入「總覽」；失敗會顯示錯誤訊息' },
    { n: '5', t: '桌面通知（可選）', d: '若瀏覽器詢問通知權限，建議允許，以便待簽提醒' },
  ];
  steps.forEach((st, i) => {
    const y = 1.15 + i * 0.72;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55,
      y: y + 0.05,
      w: 0.45,
      h: 0.45,
      fill: { color: C.primary },
    });
    s.addText(st.n, {
      x: 0.55,
      y: y + 0.05,
      w: 0.45,
      h: 0.45,
      fontSize: 16,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    card(s, 1.2, y, 8.3, 0.6);
    s.addText(st.t, {
      x: 1.4,
      y: y + 0.05,
      w: 2.4,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
    s.addText(st.d, {
      x: 3.9,
      y: y + 0.05,
      w: 5.4,
      h: 0.5,
      fontSize: 13,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '登入步驟');
}

// ========== 7 主畫面佈局 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '三、主畫面與側欄 — 整體佈局', '登入後實際畫面結構');
  browserChrome(s, 0.35, 1.05, 9.3, 4.0, 'http://192.168.99.220:3847/#dashboard');
  drawSidebar(s, 0.5, 1.45, 1.7, 3.4, '總覽');
  // main area
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.3,
    y: 1.45,
    w: 7.15,
    h: 0.45,
    fill: { color: C.card },
  });
  s.addText('總覽', {
    x: 2.45,
    y: 1.5,
    w: 3,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.text,
    fontFace: FONT,
    margin: 0,
  });
  // stat cards
  ['待我簽核', '我的進行中', '我已完成'].forEach((lab, i) => {
    const x = 2.4 + i * 2.3;
    card(s, x, 2.05, 2.15, 0.85);
    s.addText(lab, {
      x: x + 0.12,
      y: 2.15,
      w: 1.9,
      h: 0.28,
      fontSize: 11,
      color: C.muted,
      fontFace: FONT,
      margin: 0,
    });
    s.addText(String(i + 1), {
      x: x + 0.12,
      y: 2.4,
      w: 1.9,
      h: 0.4,
      fontSize: 22,
      bold: true,
      color: C.primary,
      fontFace: FONT,
      margin: 0,
    });
  });
  card(s, 2.4, 3.05, 6.9, 1.55);
  s.addText('待辦簽核列表區（點列可進詳情）', {
    x: 2.55,
    y: 3.2,
    w: 6.5,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: C.navy,
    fontFace: FONT,
    margin: 0,
  });
  s.addText('單號 · 流程名稱 · 申請人 · 狀態 · 更新時間 …', {
    x: 2.55,
    y: 3.6,
    w: 6.5,
    h: 0.7,
    fontSize: 12,
    color: C.muted,
    fontFace: FONT,
    margin: 0,
  });
  footer(s, '主畫面佈局');
}

// ========== 8 側欄說明 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '三、主畫面與側欄 — 各選單用途', '左側深藍色選單（固定）');
  const rows = [
    ['總覽', '統計數字、公司公告、待辦預覽、快速開始'],
    ['待我簽核', '輪到您簽核的單據列表（最重要的工作清單）'],
    ['我的申請', '您本人送出的所有申請與進度'],
    ['簽核紀錄', '與您相關的簽核歷史（含已處理）'],
    ['新增申請', '選擇流程 → 填表 → 送出'],
    ['帳號設定', '姓名顯示、Email、密碼、通知偏好'],
  ];
  s.addTable(
    [
      [
        { text: '選單', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...rows.map((r) => [
        { text: r[0], options: { bold: true, color: C.navy, fontFace: FONT } },
        { text: r[1], options: { color: C.text, fontFace: FONT } },
      ]),
    ],
    {
      x: 0.45,
      y: 1.2,
      w: 9.1,
      colW: [2.0, 7.1],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 13,
      fontFace: FONT,
      valign: 'middle',
    }
  );
  s.addText('提示：側欄「待我簽核」旁可能出現紅色數字角標＝目前待辦件數。', {
    x: 0.5,
    y: 4.7,
    w: 9,
    h: 0.3,
    fontSize: 12,
    color: C.amber,
    fontFace: FONT,
    margin: 0,
  });
  footer(s, '側欄說明');
}

// ========== 9 總覽統計 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '四、總覽 — 統計卡與快速開始', '進入系統後的首頁');
  const cards = [
    { t: '待我簽核', d: '點卡進入待簽列表' },
    { t: '我的進行中', d: '尚未結案的申請' },
    { t: '我已完成', d: '已核准／已結案' },
    { t: '快速開始', d: '新增申請、待簽核等按鈕' },
  ];
  cards.forEach((c, i) => {
    const x = 0.45 + (i % 2) * 4.7;
    const y = 1.2 + Math.floor(i / 2) * 1.7;
    card(s, x, y, 4.4, 1.45);
    s.addText(c.t, {
      x: x + 0.25,
      y: y + 0.3,
      w: 3.9,
      h: 0.4,
      fontSize: 18,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.25,
      y: y + 0.8,
      w: 3.9,
      h: 0.4,
      fontSize: 14,
      color: C.muted,
      fontFace: FONT,
      margin: 0,
    });
  });
  footer(s, '總覽統計');
}

// ========== 10 公告 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '四、總覽 — 公司公告', '管理員於系統設定維護；有公布期間');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.25,
    w: 9.0,
    h: 2.0,
    fill: { color: C.yellowBg },
    line: { color: C.yellowBorder, width: 1.5 },
    rectRadius: 0.1,
  });
  s.addText('公告', {
    x: 0.75,
    y: 1.4,
    w: 2,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: 'B45309',
    fontFace: FONT,
    margin: 0,
  });
  s.addText('歡迎使用線上簽核系統', {
    x: 0.75,
    y: 1.9,
    w: 6.5,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: '92400E',
    fontFace: FONT,
    margin: 0,
  });
  s.addText('請留意待簽核與公司通知。點右側「查看」可讀全文與附件預覽。', {
    x: 0.75,
    y: 2.35,
    w: 6.5,
    h: 0.55,
    fontSize: 13,
    color: '78350F',
    fontFace: FONT,
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 7.6,
    y: 2.0,
    w: 1.5,
    h: 0.45,
    fill: { color: C.card },
    line: { color: C.yellowBorder, width: 1 },
    rectRadius: 0.06,
  });
  s.addText('查看', {
    x: 7.6,
    y: 2.0,
    w: 1.5,
    h: 0.45,
    fontSize: 14,
    color: '92400E',
    align: 'center',
    valign: 'middle',
    fontFace: FONT,
    margin: 0,
  });
  bulletList(
    s,
    [
      '公告僅在「公布期間內」顯示；過期自動下架',
      '總覽不顯示附件檔名；點「查看」後可「開啟檢視」（不提供下載）',
      '無公告時此區塊不會出現',
    ],
    0.55,
    3.5,
    9,
    1.4,
    13
  );
  footer(s, '總覽公告');
}

// ========== 11 新增申請通用 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '五、新增申請 — 通用步驟', '側欄 → 新增申請');
  const steps = [
    '點左側「新增申請」',
    '在流程清單選擇要申請的類型（如請假、請購）',
    '依表單欄位填寫（紅＊為必填）',
    '需要時上傳附件（PDF／圖片／Office 等）',
    '檢查無誤後按「送出申請」',
    '至「我的申請」確認狀態與目前關卡',
  ];
  steps.forEach((t, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const x = 0.45 + col * 4.75;
    const y = 1.2 + row * 1.15;
    card(s, x, y, 4.5, 1.0);
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.15,
      y: y + 0.25,
      w: 0.45,
      h: 0.45,
      fill: { color: C.primary },
    });
    s.addText(String(i + 1), {
      x: x + 0.15,
      y: y + 0.25,
      w: 0.45,
      h: 0.45,
      fontSize: 16,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(t, {
      x: x + 0.75,
      y: y + 0.2,
      w: 3.5,
      h: 0.6,
      fontSize: 13,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '新增申請通用');
}

// ========== 12 填表規則 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '五、新增申請 — 填表與附件規則', '避免送出失敗的常見注意');
  const rules = [
    ['必填欄位', '標示＊或說明為必填者未填無法送出'],
    ['主旨', '僅「一般簽呈」需自行填主旨；其他流程通常自動產生'],
    ['日期時間', '請假／加班請選正確起迄；系統可能自動試算時數'],
    ['人員選擇', '代理人、會簽人等請由名單挑選，勿空白'],
    ['附件', '建議 PDF／JPG；檔名避免特殊符號；機密文件依公司規定'],
    ['送出後', '多數情況不可隨意刪改；需撤回請洽管理員或依系統功能'],
  ];
  s.addTable(
    [
      [
        { text: '項目', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...rules.map((r) => [
        { text: r[0], options: { bold: true, color: C.navy, fontFace: FONT } },
        { text: r[1], options: { color: C.text, fontFace: FONT } },
      ]),
    ],
    {
      x: 0.4,
      y: 1.15,
      w: 9.2,
      colW: [2.0, 7.2],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 13,
      fontFace: FONT,
      valign: 'middle',
    }
  );
  footer(s, '填表規則');
}

// ========== 流程總表 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '六、七大簽核流程 — 總覽表', '以下各節逐一詳解表單與關卡');
  s.addTable(
    [
      [
        { text: '#', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '流程名稱', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '簽核關卡（簡述）', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...WORKFLOWS.map((w, i) => [
        { text: String(i + 1), options: { color: C.text, fontFace: FONT } },
        { text: w.name, options: { bold: true, color: C.navy, fontFace: FONT } },
        { text: w.steps.join(' → '), options: { color: C.text, fontFace: FONT, fontSize: 11 } },
      ]),
    ],
    {
      x: 0.3,
      y: 1.15,
      w: 9.4,
      colW: [0.5, 2.2, 6.7],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 12,
      fontFace: FONT,
      valign: 'middle',
    }
  );
  footer(s, '七大流程總表');
}

// ========== 各流程 2 頁 ==========
WORKFLOWS.forEach((wf, wi) => {
  // 表單頁
  {
    const s = pres.addSlide();
    s.background = { color: C.bg };
    header(s, `六、${wf.name} — 表單欄位`, `流程 ${wi + 1}/7 · 新增申請時填寫`);
    // left mock form
    browserChrome(s, 0.3, 1.05, 4.5, 4.0, '#new-request');
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.3,
      y: 1.35,
      w: 4.5,
      h: 3.7,
      fill: { color: C.bg },
    });
    s.addText(wf.name, {
      x: 0.5,
      y: 1.5,
      w: 4.1,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      margin: 0,
    });
    wf.fields.slice(0, 5).forEach((f, i) => {
      const y = 1.95 + i * 0.5;
      s.addText(f[0] + (f[2].includes('必') ? ' *' : ''), {
        x: 0.5,
        y,
        w: 4.1,
        h: 0.2,
        fontSize: 10,
        color: C.muted,
        fontFace: FONT,
        margin: 0,
      });
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 0.5,
        y: y + 0.18,
        w: 4.1,
        h: 0.28,
        fill: { color: C.input },
        line: { color: C.border, width: 1 },
        rectRadius: 0.04,
      });
    });
    // right table
    s.addTable(
      [
        [
          { text: '欄位', options: { fill: { color: C.navy }, color: C.white, bold: true } },
          { text: '類型', options: { fill: { color: C.navy }, color: C.white, bold: true } },
          { text: '必填', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        ],
        ...wf.fields.map((f) => [
          { text: f[0], options: { fontFace: FONT, color: C.text } },
          { text: f[1], options: { fontFace: FONT, color: C.muted, fontSize: 11 } },
          { text: f[2], options: { fontFace: FONT, color: C.text, fontSize: 11 } },
        ]),
      ],
      {
        x: 5.0,
        y: 1.2,
        w: 4.7,
        colW: [1.5, 2.0, 1.2],
        border: [{ pt: 0.5, color: C.border }],
        fontSize: 11,
        fontFace: FONT,
        valign: 'middle',
      }
    );
    footer(s, `${wf.name}-表單`);
  }
  // 關卡頁
  {
    const s = pres.addSlide();
    s.background = { color: C.bg };
    header(s, `六、${wf.name} — 簽核關卡`, wf.desc);
    const n = wf.steps.length;
    wf.steps.forEach((name, i) => {
      const x = 0.4 + i * (9.2 / Math.max(n, 1));
      const w = 9.0 / n - 0.15;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x,
        y: 1.5,
        w,
        h: 1.3,
        fill: { color: C.card },
        line: { color: C.primary, width: 1.5 },
        rectRadius: 0.1,
        shadow: sh(),
      });
      s.addShape(pres.shapes.OVAL, {
        x: x + w / 2 - 0.22,
        y: 1.65,
        w: 0.44,
        h: 0.44,
        fill: { color: C.primary },
      });
      s.addText(String(i + 1), {
        x: x + w / 2 - 0.22,
        y: 1.65,
        w: 0.44,
        h: 0.44,
        fontSize: 14,
        bold: true,
        color: C.white,
        align: 'center',
        valign: 'middle',
        margin: 0,
      });
      s.addText(name, {
        x: x + 0.05,
        y: 2.25,
        w: w - 0.1,
        h: 0.4,
        fontSize: 12,
        bold: true,
        color: C.navy,
        align: 'center',
        fontFace: FONT,
        margin: 0,
      });
      if (i < n - 1) {
        s.addText('→', {
          x: x + w - 0.05,
          y: 1.9,
          w: 0.3,
          h: 0.4,
          fontSize: 18,
          color: C.primary,
          margin: 0,
        });
      }
    });
    s.addText('申請人送出', {
      x: 0.4,
      y: 1.15,
      w: 3,
      h: 0.3,
      fontSize: 12,
      color: C.muted,
      fontFace: FONT,
      margin: 0,
    });
    card(s, 0.4, 3.1, 9.2, 1.7);
    s.addText('使用提醒', {
      x: 0.6,
      y: 3.25,
      w: 8.8,
      h: 0.3,
      fontSize: 13,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      margin: 0,
    });
    bulletList(s, wf.tips, 0.6, 3.6, 8.8, 1.1, 12);
    footer(s, `${wf.name}-關卡`);
  }
});

// ========== 我的申請 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '七、我的申請 — 查進度', '側欄 → 我的申請');
  browserChrome(s, 0.4, 1.1, 9.2, 3.7, '#mine');
  drawSidebar(s, 0.55, 1.5, 1.55, 3.1, '我的申請');
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.2,
    y: 1.5,
    w: 7.2,
    h: 3.1,
    fill: { color: C.bg },
  });
  s.addText('我的申請', {
    x: 2.4,
    y: 1.6,
    w: 4,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.text,
    fontFace: FONT,
    margin: 0,
  });
  // table header
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.4,
    y: 2.1,
    w: 6.8,
    h: 0.35,
    fill: { color: C.navy },
  });
  s.addText('單號    流程      狀態      目前關卡      更新', {
    x: 2.5,
    y: 2.1,
    w: 6.6,
    h: 0.35,
    fontSize: 11,
    color: C.white,
    fontFace: FONT,
    valign: 'middle',
    margin: 0,
  });
  const demoRows = [
    ['#128', '請假申請', '簽核中', '部門主管', '07-30'],
    ['#125', '請購申請', '已核准', '—', '07-28'],
    ['#120', '一般簽呈', '退回', '申請人', '07-25'],
  ];
  demoRows.forEach((r, i) => {
    const y = 2.5 + i * 0.45;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 2.4,
      y,
      w: 6.8,
      h: 0.42,
      fill: { color: i % 2 ? 'F8FAFC' : C.card },
    });
    s.addText(r.join('     '), {
      x: 2.5,
      y,
      w: 6.6,
      h: 0.42,
      fontSize: 11,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '我的申請');
}

// ========== 狀態說明 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '七、我的申請 — 狀態意義', '列表上常見狀態');
  const st = [
    ['簽核中／進行中', '已送出，尚有關卡未完成', C.primarySoft],
    ['已核准', '全部關卡通過，流程結束', C.greenBg],
    ['已退回／退回', '某關退回，可能需修改重送（依系統）', C.amberBg],
    ['已駁回／否決', '被否決結束，通常不可再簽', C.redBg],
    ['草稿', '若有暫存功能，尚未正式送出', 'E2E8F0'],
  ];
  st.forEach((row, i) => {
    const y = 1.2 + i * 0.7;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 9.0,
      h: 0.6,
      fill: { color: row[2] },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: 0.75,
      y,
      w: 2.8,
      h: 0.6,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
    s.addText(row[1], {
      x: 3.6,
      y,
      w: 5.6,
      h: 0.6,
      fontSize: 13,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '狀態意義');
}

// ========== 待我簽核 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '八、待我簽核 — 處理他人單據', '當您是關卡簽核人時');
  bulletList(
    s,
    [
      '側欄點「待我簽核」（或總覽統計卡／角標）',
      '列表顯示：單號、流程、申請人、送達時間等',
      '點任一列進入「簽核詳情」',
      '閱讀表單內容、附件、歷程',
      '選擇：核准／退回／駁回（依畫面按鈕）',
      '必要時填寫意見後送出',
      '完成後該件自待辦消失，可至「簽核紀錄」查詢',
    ],
    0.6,
    1.25,
    9,
    3.6,
    15
  );
  footer(s, '待我簽核');
}

// ========== 詳情核准 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '八、簽核詳情 — 核准操作', '詳情頁下方操作區（示意）');
  browserChrome(s, 0.4, 1.1, 9.2, 3.8, '#detail/128');
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.4,
    y: 1.4,
    w: 9.2,
    h: 3.5,
    fill: { color: C.bg },
  });
  card(s, 0.6, 1.55, 8.8, 1.5);
  s.addText('請假申請  #128', {
    x: 0.85,
    y: 1.7,
    w: 5,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.navy,
    fontFace: FONT,
    margin: 0,
  });
  s.addText('申請人：王小明　｜　狀態：待您簽核　｜　關卡：部門主管', {
    x: 0.85,
    y: 2.15,
    w: 8,
    h: 0.3,
    fontSize: 12,
    color: C.muted,
    fontFace: FONT,
    margin: 0,
  });
  s.addText('假別：事假　｜　期間：2026-08-05 09:00～17:30　｜　事由：個人事務', {
    x: 0.85,
    y: 2.5,
    w: 8,
    h: 0.3,
    fontSize: 12,
    color: C.text,
    fontFace: FONT,
    margin: 0,
  });
  // buttons
  const btns = [
    { t: '核准', c: C.green },
    { t: '退回', c: C.amber },
    { t: '駁回', c: C.red },
  ];
  btns.forEach((b, i) => {
    const x = 0.85 + i * 2.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 3.4,
      w: 1.9,
      h: 0.5,
      fill: { color: b.c },
      rectRadius: 0.08,
    });
    s.addText(b.t, {
      x,
      y: 3.4,
      w: 1.9,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      fontFace: FONT,
      margin: 0,
    });
  });
  s.addText('意見（選填）輸入框…', {
    x: 0.85,
    y: 4.1,
    w: 8,
    h: 0.35,
    fontSize: 12,
    color: C.muted,
    fontFace: FONT,
    margin: 0,
  });
  footer(s, '簽核詳情操作');
}

// ========== 核准注意 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '八、簽核動作差異', '請依權責謹慎操作');
  const acts = [
    { t: '核准', d: '同意本關。單據流向下關或結案為已核准。', c: C.greenBg },
    { t: '退回', d: '退回申請人或前關（依系統設定），可請對方修正後再送。', c: C.amberBg },
    { t: '駁回／否決', d: '不同意並結束流程，通常無法再繼續簽核。', c: C.redBg },
  ];
  acts.forEach((a, i) => {
    const y = 1.3 + i * 1.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 9.0,
      h: 1.0,
      fill: { color: a.c },
      rectRadius: 0.1,
    });
    s.addText(a.t, {
      x: 0.8,
      y: y + 0.2,
      w: 2.2,
      h: 0.6,
      fontSize: 18,
      bold: true,
      color: C.navy,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
    s.addText(a.d, {
      x: 3.2,
      y: y + 0.2,
      w: 6.0,
      h: 0.6,
      fontSize: 14,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '簽核動作');
}

// ========== 簽核紀錄 PDF ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '九、簽核紀錄與下載 PDF', '留存與列印');
  bulletList(
    s,
    [
      '側欄「簽核紀錄」：查看與您相關的歷史單據',
      '開啟詳情後，可使用「下載 PDF」取得正式文件',
      '已核准單據的 PDF 可能含公司數位簽章（由系統自動加蓋）',
      '自簽憑證在 Acrobat 可能顯示「簽發者不被信任」，內部防竄改仍有效',
      '勿將含個資的 PDF 外流至非授權管道',
    ],
    0.6,
    1.3,
    9,
    3.5,
    15
  );
  footer(s, '簽核紀錄PDF');
}

// ========== 帳號設定 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '十、帳號設定', '側欄 → 帳號設定');
  const items = [
    ['顯示名稱', '影響簽核紀錄上顯示的姓名'],
    ['Email', '接收進度通知、催辦信（請填公司信箱）'],
    ['Email 通知開關', '可選擇是否接收郵件'],
    ['修改密碼', '建議定期更換；勿與他人共用'],
    ['桌面通知偏好', '瀏覽器通知、標題閃爍等（本機偏好）'],
  ];
  s.addTable(
    [
      [
        { text: '項目', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...items.map((r) => [
        { text: r[0], options: { bold: true, color: C.navy, fontFace: FONT } },
        { text: r[1], options: { color: C.text, fontFace: FONT } },
      ]),
    ],
    {
      x: 0.45,
      y: 1.2,
      w: 9.1,
      colW: [2.4, 6.7],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 13,
      fontFace: FONT,
      valign: 'middle',
    }
  );
  footer(s, '帳號設定');
}

// ========== 通知 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '十、通知管道', '三種提醒方式');
  const ch = [
    { t: '系統內', d: '待我簽核角標、總覽待辦、最終核准通知待確認' },
    { t: 'Email', d: '進度、催辦（需正確信箱且管理員已設 SMTP）' },
    { t: '瀏覽器桌面通知', d: '登入中輪詢到新待簽時彈出（需允許權限）' },
  ];
  ch.forEach((c, i) => {
    const x = 0.45 + i * 3.15;
    card(s, x, 1.4, 3.0, 2.8);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.9,
      y: 1.7,
      w: 1.2,
      h: 1.2,
      fill: { color: C.primarySoft },
      rectRadius: 0.15,
    });
    s.addText(String(i + 1), {
      x: x + 0.9,
      y: 1.7,
      w: 1.2,
      h: 1.2,
      fontSize: 28,
      bold: true,
      color: C.primary,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(c.t, {
      x: x + 0.15,
      y: 3.1,
      w: 2.7,
      h: 0.35,
      fontSize: 15,
      bold: true,
      color: C.navy,
      align: 'center',
      fontFace: FONT,
      margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.15,
      y: 3.5,
      w: 2.7,
      h: 0.55,
      fontSize: 11,
      color: C.muted,
      align: 'center',
      fontFace: FONT,
      margin: 0,
    });
  });
  footer(s, '通知管道');
}

// ========== FAQ ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '十一、常見問題 FAQ', '一般使用者');
  const faq = [
    ['登不進去？', '確認內網、網址埠號、帳密；仍失敗洽 IT／管理員。'],
    ['找不到流程？', '流程可能停用或無權限；洽管理員確認是否已啟用。'],
    ['送出後想改？', '多數需退回後重送，或請管理員協助；勿重複亂送。'],
    ['一直沒人簽？', '至「我的申請」看卡在哪一關；可請對方登入或用催辦（若有）。'],
    ['PDF 打不開？', '用 Acrobat／Edge；中文亂碼請回報 IT（字型／伺服器）。'],
    ['手機可以簽嗎？', '目前以通知為主，完整簽核建議回公司電腦操作。'],
  ];
  s.addTable(
    [
      [
        { text: '問題', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '建議處理', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...faq.map((r) => [
        { text: r[0], options: { bold: true, color: C.navy, fontFace: FONT } },
        { text: r[1], options: { color: C.text, fontFace: FONT } },
      ]),
    ],
    {
      x: 0.35,
      y: 1.15,
      w: 9.3,
      colW: [2.4, 6.9],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 12,
      fontFace: FONT,
      valign: 'middle',
    }
  );
  footer(s, 'FAQ');
}

// ========== 練習 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '十二、建議練習路徑', '第一次使用請依序操作一次');
  const pathSteps = [
    '登入正式站',
    '瀏覽總覽與公告',
    '新增「請假」或「一般簽呈」測試單（或依公司規定）',
    '到「我的申請」確認狀態',
    '若有待簽：進入詳情練習「核准」（測試環境）',
    '開啟 PDF 預覽下載',
    '到帳號設定確認 Email',
  ];
  pathSteps.forEach((t, i) => {
    const y = 1.15 + i * 0.5;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55,
      y: y + 0.05,
      w: 0.35,
      h: 0.35,
      fill: { color: C.primary },
    });
    s.addText(String(i + 1), {
      x: 0.55,
      y: y + 0.05,
      w: 0.35,
      h: 0.35,
      fontSize: 12,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(t, {
      x: 1.1,
      y: y,
      w: 8.3,
      h: 0.45,
      fontSize: 14,
      color: C.text,
      fontFace: FONT,
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, '練習路徑');
}

// ========== 結束 ==========
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addText('感謝使用', {
    x: 0.6,
    y: 1.6,
    w: 8.8,
    h: 0.6,
    fontSize: 32,
    bold: true,
    color: C.white,
    fontFace: FONT,
    margin: 0,
  });
  s.addText(
    [
      { text: '線上簽核系統 — 一般使用者完整操作手冊', options: { breakLine: true } },
      { text: '正式站 https://192.168.99.220:3848', options: { breakLine: true } },
      { text: '本機 http://127.0.0.1:8080', options: { breakLine: true } },
      { text: '', options: { breakLine: true } },
      { text: '功能與介面以系統實際版本為準；流程關卡可由管理員調整。', options: { breakLine: true } },
      { text: `本手冊共 ${slideCount + 1} 頁（含本頁）`, options: {} },
    ],
    {
      x: 0.6,
      y: 2.4,
      w: 8.8,
      h: 2.2,
      fontSize: 14,
      color: 'CBD5E1',
      fontFace: FONT,
      paraSpaceAfter: 6,
    }
  );
  slideCount++;
  slidesMeta.push('結束');
}

// Fix footers that used early slideCount - regenerate isn't needed; footer increments.

pres
  .writeFile({ fileName: out })
  .then(() => {
    console.log('WROTE', out);
    console.log('slides', slideCount);
    // also write a simple index txt
    const idx = path.join(
      path.dirname(out),
      '線上簽核系統_一般使用者完整操作手冊_目錄.txt'
    );
    fs.writeFileSync(
      idx,
      ['線上簽核系統 — 一般使用者完整操作手冊', `頁數: ${slideCount}`, '', ...slidesMeta.map((t, i) => `${i + 1}. ${t}`)].join(
        '\n'
      ),
      'utf8'
    );
    console.log('INDEX', idx);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
