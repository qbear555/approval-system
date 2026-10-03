/**
 * 線上簽核系統 — 一般使用者操作簡報（實際操作畫面示意＋詳細步驟）
 * 示範帳號：闕淑燕（Vivian／業務部）— 正式環境成員
 * 正式網址：https://192.168.11.116:3847
 *
 * node docs/build-user-guide-pptx.js [輸出路徑]
 */
const pptxgen = require('pptxgenjs');
const path = require('path');

const out =
  process.argv[2] ||
  path.join(__dirname, '線上簽核系統_一般使用者操作手冊_闕淑燕示範.pptx');

const SITE = 'https://192.168.11.116:3847';
const DEMO = {
  name: '闕淑燕',
  username: 'Vivian',
  dept: '業務部',
  role: '一般使用者',
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = '張祖銘';
pres.title = '線上簽核系統 — 一般使用者操作手冊';
pres.subject = '登入、新增申請、查詢、簽核、帳號設定';
pres.company = '雅士博科技股份有限公司';

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
  border: 'E2E8F0',
  side: '0F2744',
  input: 'F8FAFC',
  warning: 'D97706',
};

const sh = () => ({
  type: 'outer',
  color: '000000',
  blur: 8,
  offset: 2,
  angle: 135,
  opacity: 0.12,
});

const FF = 'Microsoft JhengHei';

/** 頁尾：依需求不顯示示範者／製作者文字 */
function footer(_slide, _i, _total) {
  /* no-op */
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
    fontSize: 19,
    bold: true,
    color: C.white,
    fontFace: FF,
    margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.4,
      y: 0.48,
      w: 9.2,
      h: 0.3,
      fontSize: 11,
      color: '94A3B8',
      fontFace: FF,
      margin: 0,
    });
  }
}

function card(slide, x, y, w, h, opts = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: opts.fill || C.card },
    line: opts.line ? { color: opts.line, width: 1 } : { color: C.border, width: 1 },
    rectRadius: 0.08,
    shadow: opts.shadow === false ? undefined : sh(),
  });
}

function drawSidebar(slide, x, y, w, h, active) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: C.side },
    rectRadius: 0.06,
  });
  slide.addText('線上簽核', {
    x: x + 0.1,
    y: y + 0.1,
    w: w - 0.2,
    h: 0.28,
    fontSize: 11,
    bold: true,
    color: C.white,
    fontFace: FF,
    margin: 0,
  });
  slide.addText('雅士博科技', {
    x: x + 0.1,
    y: y + 0.36,
    w: w - 0.2,
    h: 0.22,
    fontSize: 9,
    color: '94A3B8',
    fontFace: FF,
    margin: 0,
  });
  const items = [
    '總覽',
    '待我簽核',
    '我的申請',
    '簽核紀錄',
    '新增申請',
    '帳號設定',
  ];
  items.forEach((name, i) => {
    const iy = y + 0.7 + i * 0.36;
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
      fontSize: 10,
      color: on ? C.white : 'CBD5E1',
      fontFace: FF,
      valign: 'middle',
      margin: 0,
    });
  });
  slide.addShape(pres.shapes.OVAL, {
    x: x + 0.12,
    y: y + h - 0.5,
    w: 0.28,
    h: 0.28,
    fill: { color: C.primary },
  });
  slide.addText(DEMO.name.slice(0, 1), {
    x: x + 0.12,
    y: y + h - 0.5,
    w: 0.28,
    h: 0.28,
    fontSize: 10,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  slide.addText(DEMO.name, {
    x: x + 0.45,
    y: y + h - 0.5,
    w: w - 0.55,
    h: 0.28,
    fontSize: 9,
    color: C.white,
    fontFace: FF,
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
      x: x + 0.1 + i * 0.16,
      y: y + 0.09,
      w: 0.11,
      h: 0.11,
      fill: { color: col },
    });
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x + 0.75,
    y: y + 0.05,
    w: w - 0.95,
    h: 0.2,
    fill: { color: C.white },
    rectRadius: 0.03,
  });
  slide.addText(url, {
    x: x + 0.8,
    y: y + 0.05,
    w: w - 1.05,
    h: 0.2,
    fontSize: 8,
    color: C.muted,
    fontFace: 'Consolas',
    valign: 'middle',
    margin: 0,
  });
}

function stepBadge(slide, x, y, num) {
  slide.addShape(pres.shapes.OVAL, {
    x,
    y,
    w: 0.34,
    h: 0.34,
    fill: { color: C.primary },
  });
  slide.addText(String(num), {
    x,
    y,
    w: 0.34,
    h: 0.34,
    fontSize: 12,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
}

function bulletList(slide, items, x, y, w, h, opts = {}) {
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
      fontSize: opts.fontSize || 12,
      color: opts.color || C.text,
      fontFace: FF,
      paraSpaceAfter: opts.space || 4,
      margin: 0,
    }
  );
}
// 總頁數（須與實際產生頁數一致，供頁尾使用）
const TOTAL = 27;
let n = 0;
const slidesMeta = [];

function newSlide(title, sub) {
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  if (title) header(s, title, sub);
  slidesMeta.push(title || `slide-${n}`);
  return s;
}

// ========== 1 Cover ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.navy };
  slidesMeta.push('封面');
  s.addText('線上簽核系統', {
    x: 0.6, y: 1.05, w: 8.8, h: 0.55,
    fontSize: 34, bold: true, color: C.white, fontFace: FF, margin: 0,
  });
  s.addText('一般使用者操作手冊', {
    x: 0.6, y: 1.65, w: 8.8, h: 0.42,
    fontSize: 22, color: '7DD3FC', fontFace: FF, margin: 0,
  });
  s.addText('2026 最新版  ·  實際介面示意  ·  詳細步驟', {
    x: 0.6, y: 2.15, w: 8.8, h: 0.3,
    fontSize: 14, color: '94A3B8', fontFace: FF, margin: 0,
  });
  card(s, 0.6, 2.7, 8.6, 2.1, { fill: C.navy2, shadow: false, line: '1E3A5F' });
  s.addText(
    [
      { text: `示範使用者：${DEMO.name}（${DEMO.username}／${DEMO.dept}）`, options: { breakLine: true } },
      { text: '涵蓋：登入、總覽公告、新增申請、儲存草稿、查詢、簽核、帳號設定', options: { breakLine: true } },
      { text: `正式網址：${SITE}`, options: { breakLine: true } },
      { text: '建議瀏覽器：Chrome / Edge  ·  簡報製作：張祖銘  ·  更新：2026-08', options: {} },
    ],
    {
      x: 0.85, y: 2.95, w: 8.1, h: 1.7,
      fontSize: 14, color: 'E2E8F0', fontFace: FF, paraSpaceAfter: 6, margin: 0,
    }
  );
}

// ========== 2 TOC ==========
{
  const s = newSlide('目錄', '請依序練習；有「待我簽核」權責時再做簽核章節');
  const toc = [
    ['一、登入系統', '開啟網址、帳密、登入安全提示'],
    ['二、總覽與公告', '狀態色卡、公司公告、待辦'],
    ['三、新增申請', '選流程、填表、儲存草稿、送出'],
    ['四、查詢進度', '我的申請、草稿、簽核紀錄'],
    ['五、待我簽核', '核准、駁回、退回上一位'],
    ['六、帳號設定', '密碼、Email 通知、個人資料'],
    ['七、常見問題', '登入鎖定、草稿、找不到按鈕'],
  ];
  toc.forEach((row, i) => {
    const y = 1.15 + i * 0.52;
    stepBadge(s, 0.45, y + 0.05, i + 1);
    card(s, 1.0, y, 8.5, 0.46, { shadow: false });
    s.addText(row[0], {
      x: 1.2, y: y + 0.05, w: 2.8, h: 0.36,
      fontSize: 14, bold: true, color: C.navy, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(row[1], {
      x: 4.1, y: y + 0.05, w: 5.2, h: 0.36,
      fontSize: 13, color: C.muted, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 3 Demo user ==========
{
  const s = newSlide('示範帳號', '本手冊畫面與步驟皆以正式環境實際成員說明');
  card(s, 0.4, 1.15, 4.4, 3.7);
  s.addShape(pres.shapes.OVAL, {
    x: 1.85, y: 1.5, w: 1.5, h: 1.5, fill: { color: C.primary },
  });
  s.addText(DEMO.name.slice(0, 1), {
    x: 1.85, y: 1.5, w: 1.5, h: 1.5,
    fontSize: 42, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0,
  });
  s.addText(DEMO.name, {
    x: 0.6, y: 3.2, w: 4, h: 0.4,
    fontSize: 22, bold: true, color: C.navy, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText(`${DEMO.username}  ·  ${DEMO.dept}  ·  ${DEMO.role}`, {
    x: 0.6, y: 3.65, w: 4, h: 0.35,
    fontSize: 13, color: C.muted, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText('密碼：由人事／管理員提供（勿使用他人帳號）', {
    x: 0.6, y: 4.15, w: 4, h: 0.4,
    fontSize: 12, color: C.amber, align: 'center', fontFace: FF, margin: 0,
  });

  card(s, 5.1, 1.15, 4.4, 3.7);
  s.addText('請先確認', {
    x: 5.35, y: 1.35, w: 4, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  bulletList(
    s,
    [
      '公司內網可連線（VPN 若需要）',
      `網址：${SITE}`,
      '建議使用 Chrome 或 Edge',
      '帳號由管理員在「成員名單」建立',
      '系統已關閉公開自行註冊',
      '登入錯誤多次會暫時鎖定',
    ],
    5.35, 1.85, 3.9, 2.7,
    { fontSize: 13, space: 8 }
  );
  footer(s, n, TOTAL);
}

// ========== 4 Open URL ==========
{
  const s = newSlide('步驟 1：開啟系統網址', `${DEMO.name}於公司電腦開啟瀏覽器`);
  browserChrome(s, 0.8, 1.2, 8.4, 3.6, SITE);
  s.addText('線上簽核', {
    x: 3.5, y: 2.0, w: 3.5, h: 0.4,
    fontSize: 22, bold: true, color: C.navy, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText('雅士博科技股份有限公司', {
    x: 3.0, y: 2.45, w: 4.5, h: 0.3,
    fontSize: 13, color: C.muted, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText('請登入帳號與密碼', {
    x: 3.0, y: 3.0, w: 4.5, h: 0.3,
    fontSize: 14, color: C.text, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText('① 開啟瀏覽器　② 輸入正式網址或點書籤　③ 出現登入畫面', {
    x: 0.8, y: 4.95, w: 8.4, h: 0.28,
    fontSize: 12, color: C.muted, align: 'center', fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 5 Login ==========
{
  const s = newSlide('步驟 2：登入', '帳號不分大小寫；密碼請依人事提供');
  card(s, 0.5, 1.15, 4.5, 3.6);
  s.addText('線上簽核', {
    x: 0.75, y: 1.35, w: 4, h: 0.35,
    fontSize: 18, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  s.addText('帳號', { x: 0.75, y: 1.9, w: 4, h: 0.25, fontSize: 12, color: C.muted, fontFace: FF, margin: 0 });
  card(s, 0.75, 2.15, 4.0, 0.4, { fill: C.input, shadow: false });
  s.addText(DEMO.username, {
    x: 0.9, y: 2.15, w: 3.7, h: 0.4,
    fontSize: 14, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
  });
  s.addText('密碼', { x: 0.75, y: 2.7, w: 4, h: 0.25, fontSize: 12, color: C.muted, fontFace: FF, margin: 0 });
  card(s, 0.75, 2.95, 4.0, 0.4, { fill: C.input, shadow: false });
  s.addText('••••••••', {
    x: 0.9, y: 2.95, w: 3.7, h: 0.4,
    fontSize: 14, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.75, y: 3.6, w: 4.0, h: 0.45,
    fill: { color: C.primary }, rectRadius: 0.06,
  });
  s.addText('登入', {
    x: 0.75, y: 3.6, w: 4.0, h: 0.45,
    fontSize: 15, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: FF, margin: 0,
  });
  s.addText('v1.1.0', {
    x: 0.75, y: 4.25, w: 4.0, h: 0.25,
    fontSize: 11, color: C.muted, align: 'center', fontFace: FF, margin: 0,
  });

  card(s, 5.3, 1.15, 4.2, 3.6, { fill: C.amberBg, line: 'FCD34D' });
  s.addText('操作與安全提示', {
    x: 5.55, y: 1.35, w: 3.8, h: 0.35,
    fontSize: 15, bold: true, color: C.amber, fontFace: FF, margin: 0,
  });
  bulletList(
    s,
    [
      '帳號可大小寫混用（如 vivian／Vivian）',
      '密碼錯誤連續 5 次會鎖定約 15 分鐘',
      '鎖定期間請稍候再試，或洽管理員',
      '無法自行註冊，請管理員新增帳號',
      '登入後左下角顯示版本號',
      '建議登入後允許「桌面通知」',
    ],
    5.55, 1.85, 3.7, 2.6,
    { fontSize: 13, space: 7 }
  );
  footer(s, n, TOTAL);
}

// ========== 6 Dashboard ==========
{
  const s = newSlide('步驟 3：總覽（首頁）', '登入後預設進入；可看待辦色卡與公司公告');
  drawSidebar(s, 0.3, 1.05, 1.7, 4.0, '總覽');
  card(s, 2.2, 1.05, 7.4, 4.0, { shadow: false });
  s.addText('總覽', {
    x: 2.4, y: 1.15, w: 3, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  // announcement yellow
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.4, y: 1.55, w: 7.0, h: 0.85,
    fill: { color: 'FFFBEB' },
    line: { color: 'FBBF24', width: 1 },
    rectRadius: 0.06,
  });
  s.addText('公告', {
    x: 2.55, y: 1.6, w: 1.5, h: 0.28,
    fontSize: 13, bold: true, color: 'B45309', fontFace: FF, margin: 0,
  });
  s.addText('1. 線上簽核系統正式上線！　[查看]', {
    x: 2.55, y: 1.9, w: 6.6, h: 0.35,
    fontSize: 12, color: '92400E', fontFace: FF, margin: 0,
  });
  // stat cards colors
  const stats = [
    { t: '待我簽核', v: '2', c: 'FEF3C7', tc: 'C2410C' },
    { t: '我的進行中', v: '1', c: 'EFF6FF', tc: '1E40AF' },
    { t: '我已完成', v: '5', c: 'F5F3FF', tc: '5B21B6' },
    { t: '啟用中流程', v: '8', c: 'EEF2FF', tc: '3730A3' },
  ];
  stats.forEach((st, i) => {
    const x = 2.4 + i * 1.8;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 2.55, w: 1.7, h: 1.0,
      fill: { color: st.c }, rectRadius: 0.06,
    });
    s.addText(st.t, {
      x, y: 2.62, w: 1.7, h: 0.28,
      fontSize: 11, bold: true, color: st.tc, align: 'center', fontFace: FF, margin: 0,
    });
    s.addText(st.v, {
      x, y: 2.95, w: 1.7, h: 0.45,
      fontSize: 22, bold: true, color: st.tc, align: 'center', fontFace: FF, margin: 0,
    });
  });
  s.addText('待辦簽核（精簡列表）· 點列可開啟詳情', {
    x: 2.4, y: 3.7, w: 7, h: 0.28,
    fontSize: 12, color: C.muted, fontFace: FF, margin: 0,
  });
  s.addText('請假申請  ·  陳子安  ·  簽核中  ·  待您處理', {
    x: 2.4, y: 4.05, w: 7, h: 0.35,
    fontSize: 13, color: C.text, fontFace: FF, margin: 0,
  });
  s.addText('① 看公告（點「查看」讀全文）　② 看色卡數字　③ 從待辦或左側選單進入功能', {
    x: 2.2, y: 4.7, w: 7.4, h: 0.28,
    fontSize: 11, color: C.muted, fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 7 Announcement ==========
{
  const s = newSlide('步驟 3 補充：公司公告', '同一區塊可顯示最多兩則；點列項「查看」');
  card(s, 0.5, 1.2, 9.0, 1.6, { fill: 'FFFBEB', line: 'FBBF24' });
  s.addText('公告', {
    x: 0.7, y: 1.35, w: 8.5, h: 0.35,
    fontSize: 18, bold: true, color: 'B45309', fontFace: FF, margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.7, y: 1.8, w: 8.5, h: 0.7,
    fill: { color: 'FEF3C7' }, line: { color: 'FBBF24', width: 1 }, rectRadius: 0.06,
  });
  s.addText('線上簽核系統正式上線！　　　　　　　　　　　　　　[查看]', {
    x: 0.9, y: 1.9, w: 8.1, h: 0.5,
    fontSize: 14, color: '92400E', fontFace: FF, valign: 'middle', margin: 0,
  });

  card(s, 0.5, 3.05, 9.0, 1.85);
  s.addText('操作說明', {
    x: 0.7, y: 3.2, w: 8.5, h: 0.3,
    fontSize: 14, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  bulletList(
    s,
    [
      '有兩則公告時會顯示 1、2 編號徽章；只有一則時不顯示數字',
      '滑鼠移上公告列會有上浮／亮色動態效果',
      '點「查看」開啟全文；長文未分段會依視窗寬度自動換行',
      '若有附件可於詳情中「開啟檢視」（僅供閱讀）',
      '時間顯示為台灣時區（例如更新：2026-08-04 12:30:00）',
    ],
    0.7, 3.55, 8.5, 1.2,
    { fontSize: 13, space: 4 }
  );
  footer(s, n, TOTAL);
}

// ========== 8 Menu ==========
{
  const s = newSlide('步驟 4：左側選單', '一般使用者常見項目');
  const menus = [
    ['總覽', '狀態色卡、公告、待辦摘要'],
    ['待我簽核', '輪到您簽的單據（有角標）'],
    ['我的申請', '自己送出的申請與草稿'],
    ['簽核紀錄', '與您相關的歷史單據'],
    ['新增申請', '選流程、填表、存草稿／送出'],
    ['帳號設定', '改密碼、Email 通知偏好'],
  ];
  menus.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.45 + col * 4.7;
    const y = 1.2 + row * 1.15;
    card(s, x, y, 4.45, 1.0);
    stepBadge(s, x + 0.2, y + 0.3, i + 1);
    s.addText(m[0], {
      x: x + 0.7, y: y + 0.2, w: 3.5, h: 0.35,
      fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
    });
    s.addText(m[1], {
      x: x + 0.7, y: y + 0.55, w: 3.5, h: 0.3,
      fontSize: 12, color: C.muted, fontFace: FF, margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 9 New request choose ==========
{
  const s = newSlide('步驟 5：新增申請 — 選擇流程', '左側點「新增申請」');
  drawSidebar(s, 0.3, 1.05, 1.7, 4.0, '新增申請');
  card(s, 2.2, 1.05, 7.4, 4.0, { shadow: false });
  s.addText('新增申請', {
    x: 2.4, y: 1.2, w: 4, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  s.addText('簽核流程 *', {
    x: 2.4, y: 1.7, w: 4, h: 0.28,
    fontSize: 12, color: C.muted, fontFace: FF, margin: 0,
  });
  card(s, 2.4, 2.0, 5.5, 0.45, { fill: C.input, shadow: false });
  s.addText('請假申請 ▼', {
    x: 2.55, y: 2.0, w: 5.2, h: 0.45,
    fontSize: 14, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
  });
  s.addText('簽核層級預覽：申請人 → 代理人 → 人事 → 副總 → 總經理', {
    x: 2.4, y: 2.6, w: 6.8, h: 0.35,
    fontSize: 12, color: C.primary, fontFace: FF, margin: 0,
  });
  bulletList(
    s,
    [
      '下拉選擇流程後，下方會出現對應表單',
      '不同流程欄位不同（請假／延長工時／請購…）',
      '一般簽呈才需手填「主旨」；其他多由系統產生',
    ],
    2.4, 3.15, 6.8, 1.4,
    { fontSize: 13, space: 6 }
  );
  footer(s, n, TOTAL);
}

// ========== 10 Leave form ==========
{
  const s = newSlide('步驟 6：填寫請假申請', '欄位依流程；注意假別最小單位');
  card(s, 0.4, 1.1, 5.6, 3.85);
  s.addText('流程表單 · 請假申請', {
    x: 0.6, y: 1.25, w: 5.2, h: 0.3,
    fontSize: 14, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  const leaveRows = [
    ['代理人 *', '請選擇同事…'],
    ['假別 *', '事假 ▼'],
    ['起始日／時間 *', '2026-08-10  09:00'],
    ['結束日／時間 *', '2026-08-10  17:30'],
    ['天數 *', '1'],
    ['事由', '處理個人事務'],
  ];
  leaveRows.forEach((r, i) => {
    const y = 1.65 + i * 0.42;
    s.addText(r[0], {
      x: 0.6, y, w: 1.8, h: 0.35,
      fontSize: 11, color: C.muted, fontFace: FF, valign: 'middle', margin: 0,
    });
    card(s, 2.4, y, 3.3, 0.35, { fill: C.input, shadow: false });
    s.addText(r[1], {
      x: 2.5, y, w: 3.1, h: 0.35,
      fontSize: 12, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });

  card(s, 6.2, 1.1, 3.4, 3.85, { fill: C.primarySoft, line: '93C5FD' });
  s.addText('注意事項', {
    x: 6.4, y: 1.3, w: 3, h: 0.35,
    fontSize: 14, bold: true, color: C.primary, fontFace: FF, margin: 0,
  });
  bulletList(
    s,
    [
      '出勤時間：09:00～17:30（每 30 分）',
      '特休以「日」計算，最小 0.5 日',
      '部分假別以「小時」為準',
      '可上傳證明附件（多檔）',
      '可勾選 Email 通知事件',
      '可先「儲存草稿」再送出',
    ],
    6.4, 1.8, 3.0, 2.8,
    { fontSize: 12, space: 6 }
  );
  footer(s, n, TOTAL);
}

// ========== 11 Overtime ==========
{
  const s = newSlide('步驟 7：延長工時申請', '開始／結束全日 00:00～24:00，時數自動換算');
  card(s, 0.4, 1.15, 9.2, 3.7);
  s.addText('流程表單 · 延長工時申請', {
    x: 0.6, y: 1.3, w: 8.5, h: 0.3,
    fontSize: 14, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  const otFields = [
    ['事由 *', '專案趕工'],
    ['延長工時開始 *', '2026-08-10  18:00'],
    ['延長工時結束 *', '2026-08-10  21:00'],
    ['申請時數（小時）*', '3　（自動）'],
    ['選擇項目 *', '補休 ▼'],
  ];
  otFields.forEach((r, i) => {
    const y = 1.75 + i * 0.48;
    s.addText(r[0], {
      x: 0.7, y, w: 2.6, h: 0.4,
      fontSize: 13, color: C.muted, fontFace: FF, valign: 'middle', margin: 0,
    });
    card(s, 3.4, y, 5.8, 0.4, { fill: C.input, shadow: false });
    s.addText(r[1], {
      x: 3.55, y, w: 5.5, h: 0.4,
      fontSize: 13, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  s.addText('時間可選 00:00～24:00（全日，每 30 分）；結束須晚於開始', {
    x: 0.7, y: 4.3, w: 8.5, h: 0.3,
    fontSize: 12, color: C.amber, fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 12 Draft ==========
{
  const s = newSlide('步驟 8：儲存草稿／送出申請', '可先存草稿，稍後繼續編輯再送出');
  card(s, 0.5, 1.2, 9.0, 1.3);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.2, y: 1.55, w: 2.8, h: 0.55,
    fill: { color: C.white },
    line: { color: C.border, width: 1.5 },
    rectRadius: 0.06,
  });
  s.addText('儲存草稿', {
    x: 1.2, y: 1.55, w: 2.8, h: 0.55,
    fontSize: 16, bold: true, color: C.navy, align: 'center', valign: 'middle', fontFace: FF, margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 4.5, y: 1.55, w: 2.8, h: 0.55,
    fill: { color: C.primary }, rectRadius: 0.06,
  });
  s.addText('送出申請', {
    x: 4.5, y: 1.55, w: 2.8, h: 0.55,
    fontSize: 16, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: FF, margin: 0,
  });
  s.addText('草稿 #42 已儲存', {
    x: 7.5, y: 1.6, w: 1.8, h: 0.45,
    fontSize: 12, color: C.green, fontFace: FF, valign: 'middle', margin: 0,
  });

  const comps = [
    ['儲存草稿', '可不必填齊所有必填；不通知簽核人；狀態為「草稿」'],
    ['繼續編輯', '「我的申請」篩選草稿，或詳情頁「繼續編輯草稿」'],
    ['送出申請', '完整檢查必填後進入簽核流程；可從草稿直接送出'],
  ];
  comps.forEach((c, i) => {
    const y = 2.75 + i * 0.7;
    card(s, 0.5, y, 9.0, 0.6, { shadow: false });
    s.addText(c[0], {
      x: 0.7, y: y + 0.1, w: 2.2, h: 0.4,
      fontSize: 14, bold: true, color: C.primary, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(c[1], {
      x: 3.0, y: y + 0.1, w: 6.3, h: 0.4,
      fontSize: 13, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 13 Submit done ==========
{
  const s = newSlide('步驟 9：送出成功', '進入簽核詳情，可看進度與 PDF');
  card(s, 1.5, 1.5, 7.0, 2.8, { fill: C.greenBg, line: '6EE7B7' });
  s.addText('✓ 申請已送出', {
    x: 1.7, y: 1.9, w: 6.6, h: 0.5,
    fontSize: 24, bold: true, color: C.green, align: 'center', fontFace: FF, margin: 0,
  });
  s.addText('單號會出現在「我的申請」\n狀態為「簽核中」，等待各關核准', {
    x: 1.7, y: 2.6, w: 6.6, h: 1.0,
    fontSize: 15, color: C.text, align: 'center', fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 14 My applications ==========
{
  const s = newSlide('步驟 10：我的申請', '查看自己的申請、草稿與進度');
  drawSidebar(s, 0.3, 1.05, 1.7, 4.0, '我的申請');
  card(s, 2.2, 1.05, 7.4, 4.0, { shadow: false });
  s.addText('我的申請', {
    x: 2.4, y: 1.2, w: 4, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  s.addText('狀態篩選：全部／簽核中／已核准／草稿…', {
    x: 2.4, y: 1.6, w: 6.8, h: 0.3,
    fontSize: 12, color: C.muted, fontFace: FF, margin: 0,
  });
  const rows = [
    ['#80', '草稿 · 請假…', '草稿', '可繼續編輯'],
    ['#79', '請假申請 · 事假', '簽核中', '看進度'],
    ['#75', '延長工時 3h', '已核准', '可下載 PDF'],
  ];
  rows.forEach((r, i) => {
    const y = 2.1 + i * 0.7;
    card(s, 2.4, y, 7.0, 0.6, { shadow: false });
    s.addText(r[0], { x: 2.55, y: y + 0.1, w: 0.8, h: 0.4, fontSize: 13, bold: true, color: C.primary, fontFace: FF, valign: 'middle', margin: 0 });
    s.addText(r[1], { x: 3.4, y: y + 0.1, w: 3.2, h: 0.4, fontSize: 13, color: C.text, fontFace: FF, valign: 'middle', margin: 0 });
    s.addText(r[2], { x: 6.7, y: y + 0.1, w: 1.3, h: 0.4, fontSize: 12, color: C.amber, fontFace: FF, valign: 'middle', margin: 0 });
    s.addText(r[3], { x: 8.0, y: y + 0.1, w: 1.2, h: 0.4, fontSize: 11, color: C.muted, fontFace: FF, valign: 'middle', margin: 0 });
  });
  footer(s, n, TOTAL);
}

// ========== 15 Records ==========
{
  const s = newSlide('步驟 11：簽核紀錄', '查詢與您相關的歷史單據');
  bulletList(
    s,
    [
      '左側點「簽核紀錄」',
      '可用狀態、關鍵字、日期條件查詢',
      '點列開啟詳情：表單、歷程、PDF、附件',
      '一般使用者僅見與自己相關的單據',
    ],
    0.7, 1.4, 8.5, 2.5,
    { fontSize: 16, space: 12 }
  );
  card(s, 0.7, 3.6, 8.6, 1.1, { fill: C.primarySoft, line: '93C5FD' });
  s.addText('提示：草稿只在「我的申請」；送出後才會進入簽核歷程與相關查詢。', {
    x: 0.95, y: 3.85, w: 8.2, h: 0.6,
    fontSize: 14, color: C.navy, fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 16 Pending list ==========
{
  const s = newSlide('步驟 12：待我簽核', '有待辦時左側選單會顯示數量角標');
  drawSidebar(s, 0.3, 1.05, 1.7, 4.0, '待我簽核');
  card(s, 2.2, 1.05, 7.4, 4.0, { shadow: false });
  s.addText('待我簽核', {
    x: 2.4, y: 1.2, w: 4, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 4.6, y: 1.2, w: 0.7, h: 0.35,
    fill: { color: C.red }, rectRadius: 0.1,
  });
  s.addText('2 件', {
    x: 4.6, y: 1.2, w: 0.7, h: 0.35,
    fontSize: 12, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: FF, margin: 0,
  });
  const pend = [
    ['#53', '請假申請', '陳子安', '待您：副總經理'],
    ['#52', '延長工時', '林麗淑', '待您：總經理'],
  ];
  pend.forEach((r, i) => {
    const y = 1.85 + i * 0.85;
    card(s, 2.4, y, 7.0, 0.7);
    s.addText(`${r[0]}  ${r[1]}  ·  ${r[2]}`, {
      x: 2.6, y: y + 0.08, w: 6.5, h: 0.3,
      fontSize: 14, bold: true, color: C.text, fontFace: FF, margin: 0,
    });
    s.addText(r[3], {
      x: 2.6, y: y + 0.38, w: 6.5, h: 0.25,
      fontSize: 12, color: C.amber, fontFace: FF, margin: 0,
    });
  });
  s.addText('① 點「待我簽核」　② 點要處理的單　③ 閱讀內容與 PDF　④ 填意見後按按鈕', {
    x: 2.4, y: 3.7, w: 7, h: 0.9,
    fontSize: 13, color: C.muted, fontFace: FF, margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 17 Approve ==========
{
  const s = newSlide('步驟 13：簽核處理', '核准／駁回／退回上一位');
  card(s, 0.5, 1.15, 9.0, 1.5);
  s.addText('簽核處理 — 副總經理', {
    x: 0.7, y: 1.3, w: 8.5, h: 0.35,
    fontSize: 16, bold: true, color: C.navy, fontFace: FF, margin: 0,
  });
  s.addText('簽核意見（選填；駁回／退回建議填寫）', {
    x: 0.7, y: 1.7, w: 8.5, h: 0.28,
    fontSize: 12, color: C.muted, fontFace: FF, margin: 0,
  });
  card(s, 0.7, 2.0, 8.5, 0.4, { fill: C.input, shadow: false });

  const btns = [
    { t: '核准', c: C.green },
    { t: '駁回', c: C.red },
    { t: '↩ 退回上一位', c: C.amber },
  ];
  btns.forEach((b, i) => {
    const x = 0.7 + i * 3.0;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 2.9, w: 2.7, h: 0.55,
      fill: { color: b.c }, rectRadius: 0.06,
    });
    s.addText(b.t, {
      x, y: 2.9, w: 2.7, h: 0.55,
      fontSize: 15, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: FF, margin: 0,
    });
  });

  card(s, 0.5, 3.7, 9.0, 1.15, { fill: C.amberBg, line: 'FCD34D' });
  bulletList(
    s,
    [
      '僅「目前關卡簽署人」看得到這些按鈕',
      '信用額度等流程：簽核時可能需填額度欄位（如副總建議額度為必填）',
      '部分步驟可上傳補充附件（最終關通常不可）',
    ],
    0.7, 3.9, 8.5, 0.85,
    { fontSize: 13, space: 4 }
  );
  footer(s, n, TOTAL);
}

// ========== 18 Return ==========
{
  const s = newSlide('步驟 14：退回上一位', '有上一關時才顯示');
  bulletList(
    s,
    [
      '退回後，上一關簽署人需重新簽核',
      '請填寫退回原因，方便對方了解',
      '若您是第一關，不會出現退回按鈕',
      '若不是您的關卡，也看不到簽核按鈕',
      '畫面異常時請先 Ctrl+F5 強制重新整理',
    ],
    0.7, 1.4, 8.5, 3.0,
    { fontSize: 16, space: 10 }
  );
  footer(s, n, TOTAL);
}

// ========== 19 PDF ==========
{
  const s = newSlide('步驟 15：PDF 預覽與下載', '詳情頁可預覽正式 PDF、下載檔案');
  bulletList(
    s,
    [
      '詳情頁有 PDF 預覽區，可捲動檢視',
      '按「下載 PDF」取得簽核單',
      '已核准且有附件時，可能提供 PDF＋附件 ZIP',
      '草稿通常僅申請人可預覽',
      '建議使用 Chrome／Edge 瀏覽',
    ],
    0.7, 1.4, 8.5, 3.0,
    { fontSize: 16, space: 10 }
  );
  footer(s, n, TOTAL);
}

// ========== 20 Account ==========
{
  const s = newSlide('步驟 16：帳號設定', '改密碼、Email 通知、個人顯示');
  const items = [
    ['可自行修改', '登入密碼、Email 通知開關與事件（核准／駁回／下一步等）'],
    ['不可自行修改', '姓名、Email 信箱（一般使用者鎖定；請洽管理員）'],
    ['桌面通知', '瀏覽器允許後，有新待簽可跳出提示'],
    ['版本顯示', '登入頁與左下角僅顯示版本號（如 v1.1.0）'],
  ];
  items.forEach((it, i) => {
    const y = 1.2 + i * 0.9;
    card(s, 0.5, y, 9.0, 0.8);
    s.addText(it[0], {
      x: 0.7, y: y + 0.15, w: 2.5, h: 0.5,
      fontSize: 15, bold: true, color: C.primary, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(it[1], {
      x: 3.3, y: y + 0.15, w: 6.0, h: 0.5,
      fontSize: 14, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 21 Credit note ==========
{
  const s = newSlide('補充：信用額度申請（業務相關）', '若您的流程含信用額度，簽核關需填寫額度');
  bulletList(
    s,
    [
      '申請人填寫客戶與基本資料後送出',
      '業務關：申請信用額度、增加原由（必填）',
      '副總關：建議額度（必填）、要求條件（選填）',
      '總經關：核定額度（必填）',
      '通過後財務建檔；申請人可能需確認建檔結果',
      '詳情「核決單位填寫」以中文標籤顯示',
    ],
    0.7, 1.35, 8.5, 3.2,
    { fontSize: 15, space: 8 }
  );
  footer(s, n, TOTAL);
}

// ========== 22 FAQ ==========
{
  const s = newSlide('附錄：常見問題', '一般使用者最常遇到的情況');
  const faq = [
    ['登不進去', '確認網址、帳密、內網；錯誤 5 次會鎖 15 分；請管理員重設'],
    ['無法自行註冊', '正常；請管理員在「成員名單」新增帳號'],
    ['找不到草稿', '到「我的申請」→ 狀態選「草稿」'],
    ['沒有退回按鈕', '① 不是您的關 ② 您是第一關 ③ Ctrl+F5 重整'],
    ['姓名／Email 改不了', '正常；請聯絡管理員於成員名單修改'],
    ['沒收到 Email', '確認帳號有信箱、通知有勾選、SMTP 已啟用'],
    ['公告長文不好讀', '點「查看」會依視窗自動換行並保留分段'],
  ];
  faq.forEach((f, i) => {
    const y = 1.12 + i * 0.52;
    s.addText(f[0], {
      x: 0.45, y, w: 2.6, h: 0.45,
      fontSize: 13, bold: true, color: C.primary, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(f[1], {
      x: 3.15, y, w: 6.4, h: 0.45,
      fontSize: 12, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 23 Checklist ==========
{
  const s = newSlide('練習檢核表', `請以 ${DEMO.name}（或您的帳號）實際操作一遍`);
  const checks = [
    '□ 能開啟正式網址並成功登入',
    '□ 總覽可見公告、狀態色卡（無「成員數」）',
    '□ 能新增請假並「儲存草稿」後再送出',
    '□ 能在「我的申請」找到草稿與簽核中單據',
    '□ 若有待簽：能核准或練習退回上一位',
    '□ 能預覽／下載 PDF',
    '□ 能修改自己的密碼與 Email 通知',
    '□ 了解姓名／Email 需找管理員修改',
  ];
  checks.forEach((t, i) => {
    const y = 1.2 + i * 0.42;
    s.addText(t, {
      x: 0.7, y, w: 8.6, h: 0.38,
      fontSize: 15, color: C.text, fontFace: FF, margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 24 Flow summary ==========
{
  const s = newSlide('常用流程一覽', '依單位使用，實際以系統啟用中的流程為準');
  const flows = [
    ['請假申請', '代理人 → 人事 → 副總 → 總經'],
    ['延長工時', '主管 → 副總 → 人事 → 副總 → 總經'],
    ['請購／報支', '主管 → 副總 → 總經'],
    ['出差申請', '人事 → 主管 → 副總 → 總經'],
    ['電腦報修', '管理部檢修 → 副總 → 總經'],
    ['信用額度', '業務 → 副總核示 → 總經核定 → 財務建檔'],
  ];
  flows.forEach((f, i) => {
    const y = 1.2 + i * 0.58;
    card(s, 0.5, y, 9.0, 0.5, { shadow: false });
    s.addText(f[0], {
      x: 0.7, y: y + 0.05, w: 2.4, h: 0.4,
      fontSize: 14, bold: true, color: C.navy, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(f[1], {
      x: 3.2, y: y + 0.05, w: 6.1, h: 0.4,
      fontSize: 13, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 25 Tips ==========
{
  const s = newSlide('使用小技巧', '讓操作更順暢');
  const tips = [
    ['Ctrl + F5', '強制重新整理，避免看到舊版畫面或按鈕'],
    ['儲存草稿', '填一半先存，不怕中斷；正式送出前再檢查'],
    ['狀態色卡', '總覽「待我簽核」為琥珀橙，較醒目'],
    ['公告查看', '長文自動換行；有附件可於詳情開啟'],
    ['通知偏好', '帳號設定可只勾「核准／駁回」減少郵件'],
    ['單號查詢', '記得單號，方便在我的申請／紀錄中搜尋'],
  ];
  tips.forEach((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 4.8;
    const y = 1.2 + row * 1.2;
    card(s, x, y, 4.55, 1.05);
    s.addText(t[0], {
      x: x + 0.2, y: y + 0.15, w: 4.15, h: 0.35,
      fontSize: 15, bold: true, color: C.primary, fontFace: FF, margin: 0,
    });
    s.addText(t[1], {
      x: x + 0.2, y: y + 0.52, w: 4.15, h: 0.4,
      fontSize: 12, color: C.text, fontFace: FF, margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 26 Contact ==========
{
  const s = newSlide('需要協助時', '請依問題類型聯絡');
  const contacts = [
    ['帳號／密碼／權限', '系統管理員（如張祖銘／內建 Admin）'],
    ['假別、特休天數', '人事單位'],
    ['流程關卡設計', '流程管理者／管理員'],
    ['Email 收不到', '先查帳號設定通知；再洽管理員查 SMTP'],
    ['系統異常／無法開頁', '管理部／資訊窗口，並附截圖與時間'],
  ];
  contacts.forEach((c, i) => {
    const y = 1.25 + i * 0.7;
    card(s, 0.5, y, 9.0, 0.6, { shadow: false });
    s.addText(c[0], {
      x: 0.7, y: y + 0.1, w: 3.2, h: 0.4,
      fontSize: 14, bold: true, color: C.navy, fontFace: FF, valign: 'middle', margin: 0,
    });
    s.addText(c[1], {
      x: 4.0, y: y + 0.1, w: 5.3, h: 0.4,
      fontSize: 14, color: C.text, fontFace: FF, valign: 'middle', margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 27 End ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.navy };
  slidesMeta.push('結語');
  s.addText('開始實作吧', {
    x: 0.6, y: 1.3, w: 8.8, h: 0.55,
    fontSize: 30, bold: true, color: C.white, fontFace: FF, margin: 0,
  });
  s.addText(
    [
      { text: `示範帳號：${DEMO.name}（${DEMO.username}／${DEMO.dept}）`, options: { breakLine: true } },
      { text: `正式網址：${SITE}`, options: { breakLine: true } },
      { text: '建議路徑：登入 → 總覽／公告 → 新增申請（草稿）→ 我的申請 → 待我簽核 → 帳號設定', options: { breakLine: true } },
      { text: '', options: { breakLine: true } },
      { text: '本簡報依 2026-08 正式環境功能更新；若介面有異動，以線上系統為準。', options: { breakLine: true } },
      { text: '簡報製作：張祖銘', options: {} },
    ],
    {
      x: 0.6, y: 2.1, w: 8.8, h: 2.6,
      fontSize: 15, color: 'E2E8F0', fontFace: FF, paraSpaceAfter: 6, margin: 0,
    }
  );
}

// 校正頁尾總頁數
if (n !== TOTAL) {
  console.warn(`[build] 實際頁數 ${n} 與 TOTAL=${TOTAL} 不一致，請調整 TOTAL`);
}

pres
  .writeFile({ fileName: out })
  .then(() => {
    console.log('已產生：', out);
    console.log('頁數：', n, '／', slidesMeta.join(' → '));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

