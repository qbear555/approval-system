/**
 * 線上簽核系統 — 一般使用者操作簡報（闕淑燕示範）
 * 圖文並茂：含 UI 示意框、步驟編號、流程
 * node docs/build-user-guide-pptx.js [輸出路徑]
 */
const pptxgen = require('pptxgenjs');
const path = require('path');

const out =
  process.argv[2] ||
  path.join(__dirname, '線上簽核系統_一般使用者操作手冊_闕淑燕示範.pptx');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = '張祖銘';
pres.title = '線上簽核系統 — 使用者操作手冊（闕淑燕示範）';
pres.subject = '登入、建立申請、查詢、簽核';
pres.company = '張祖銘';

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
};

const sh = () => ({
  type: 'outer',
  color: '000000',
  blur: 8,
  offset: 2,
  angle: 135,
  opacity: 0.12,
});

function footer(slide, i, total) {
  slide.addText(`闕淑燕示範操作  ·  ${i}/${total}`, {
    x: 0.45,
    y: 5.28,
    w: 6.5,
    h: 0.25,
    fontSize: 10,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  slide.addText('張祖銘 製作', {
    x: 7,
    y: 5.28,
    w: 2.5,
    h: 0.25,
    fontSize: 10,
    color: C.muted,
    align: 'right',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
}

function header(slide, title, sub) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.85,
    fill: { color: C.navy },
  });
  slide.addText(title, {
    x: 0.45,
    y: 0.14,
    w: 9.1,
    h: 0.38,
    fontSize: 20,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.45,
      y: 0.5,
      w: 9.1,
      h: 0.28,
      fontSize: 11,
      color: '94A3B8',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  }
}

/** 左側選單示意 */
function drawSidebar(slide, x, y, w, h, active) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: C.side },
    rectRadius: 0.08,
  });
  slide.addText('ARGO  線上簽核', {
    x: x + 0.1,
    y: y + 0.12,
    w: w - 0.2,
    h: 0.35,
    fontSize: 10,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
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
    const iy = y + 0.55 + i * 0.38;
    const on = name === active;
    if (on) {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: x + 0.08,
        y: iy,
        w: w - 0.16,
        h: 0.32,
        fill: { color: C.primary },
        rectRadius: 0.04,
      });
    }
    slide.addText(name, {
      x: x + 0.15,
      y: iy,
      w: w - 0.3,
      h: 0.32,
      fontSize: 10,
      color: on ? C.white : 'CBD5E1',
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
      margin: 0,
    });
  });
  slide.addShape(pres.shapes.OVAL, {
    x: x + 0.12,
    y: y + h - 0.55,
    w: 0.32,
    h: 0.32,
    fill: { color: C.primary },
  });
  slide.addText('闕', {
    x: x + 0.12,
    y: y + h - 0.55,
    w: 0.32,
    h: 0.32,
    fontSize: 11,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  slide.addText('闕淑燕', {
    x: x + 0.5,
    y: y + h - 0.55,
    w: w - 0.65,
    h: 0.32,
    fontSize: 10,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
}

/** 瀏覽器外框 */
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
    h: 0.32,
    fill: { color: 'E2E8F0' },
  });
  // traffic lights
  ['EF4444', 'F59E0B', '22C55E'].forEach((col, i) => {
    slide.addShape(pres.shapes.OVAL, {
      x: x + 0.12 + i * 0.18,
      y: y + 0.1,
      w: 0.12,
      h: 0.12,
      fill: { color: col },
    });
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x + 0.9,
    y: y + 0.06,
    w: w - 1.15,
    h: 0.2,
    fill: { color: C.white },
    rectRadius: 0.04,
  });
  slide.addText(url, {
    x: x + 0.95,
    y: y + 0.06,
    w: w - 1.25,
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
    w: 0.36,
    h: 0.36,
    fill: { color: C.primary },
  });
  slide.addText(String(num), {
    x,
    y,
    w: 0.36,
    h: 0.36,
    fontSize: 13,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
}

const TOTAL = 23;
let n = 0;

// ========== 1 Cover ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addText('線上簽核系統', {
    x: 0.7,
    y: 1.3,
    w: 8.5,
    h: 0.6,
    fontSize: 36,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('一般使用者操作手冊（圖文版）', {
    x: 0.7,
    y: 2.0,
    w: 8.5,
    h: 0.45,
    fontSize: 22,
    color: '7DD3FC',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.7,
    y: 2.8,
    w: 5.5,
    h: 1.7,
    fill: { color: C.navy2 },
    rectRadius: 0.1,
  });
  s.addText(
    [
      { text: '示範使用者：闕淑燕', options: { breakLine: true } },
      { text: '涵蓋：登入 → 總覽 → 新增申請 → 查詢 → 簽核', options: { breakLine: true } },
      { text: '正式網址範例：https://192.168.99.220:3848', options: { breakLine: true } },
      { text: '簡報製作：張祖銘', options: {} },
    ],
    {
      x: 0.95,
      y: 2.95,
      w: 5.1,
      h: 1.4,
      fontSize: 14,
      color: 'E2E8F0',
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 6,
    }
  );
}

// ========== 2 Demo persona ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '示範帳號：闕淑燕', '本簡報所有畫面皆以她的身分操作說明');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.2,
    w: 4.2,
    h: 3.6,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.1,
  });
  s.addShape(pres.shapes.OVAL, {
    x: 1.85,
    y: 1.5,
    w: 1.4,
    h: 1.4,
    fill: { color: C.primary },
  });
  s.addText('闕', {
    x: 1.85,
    y: 1.5,
    w: 1.4,
    h: 1.4,
    fontSize: 40,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  s.addText('闕淑燕', {
    x: 0.7,
    y: 3.1,
    w: 3.8,
    h: 0.4,
    fontSize: 22,
    bold: true,
    color: C.text,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('一般使用者  ·  示範帳號', {
    x: 0.7,
    y: 3.55,
    w: 3.8,
    h: 0.35,
    fontSize: 13,
    color: C.muted,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('角色：申請人／簽核人（依實際權限）', {
    x: 0.7,
    y: 4.1,
    w: 3.8,
    h: 0.35,
    fontSize: 12,
    color: C.muted,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.0,
    y: 1.2,
    w: 4.5,
    h: 3.6,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.1,
  });
  s.addText('本手冊將示範', {
    x: 5.25,
    y: 1.45,
    w: 4,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.primary,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const list = [
    '開啟系統並登入',
    '認識總覽與左側選單',
    '新增一筆請假申請並送出',
    '在「我的申請」查詢進度',
    '在「簽核紀錄」篩選查詢',
    '處理「待我簽核」並核准',
    '帳號設定與通知提醒',
  ];
  s.addText(
    list.map((t, i) => ({
      text: t,
      options: { bullet: true, breakLine: i < list.length - 1 },
    })),
    {
      x: 5.25,
      y: 1.95,
      w: 4,
      h: 2.6,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 6,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 3 Open URL ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 1：開啟系統網址', '闕淑燕於公司電腦開啟瀏覽器');
  stepBadge(s, 0.5, 1.15, 1);
  s.addText('在網址列輸入正式系統網址（範例）', {
    x: 1.0,
    y: 1.15,
    w: 8,
    h: 0.36,
    fontSize: 15,
    color: C.text,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  browserChrome(s, 1.2, 1.8, 7.6, 2.8, 'https://192.168.99.220:3848/');
  s.addText('線上簽核系統', {
    x: 3.5,
    y: 2.6,
    w: 3.5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: C.navy,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('請登入以繼續', {
    x: 3.5,
    y: 3.15,
    w: 3.5,
    h: 0.35,
    fontSize: 13,
    color: C.muted,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.8,
    y: 3.7,
    w: 2.8,
    h: 0.4,
    fill: { color: C.primary },
    rectRadius: 0.06,
  });
  s.addText('進入登入', {
    x: 3.8,
    y: 3.7,
    w: 2.8,
    h: 0.4,
    fontSize: 13,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  s.addText('本機測試：http://127.0.0.1:8080/   ｜   建議使用 Chrome / Edge', {
    x: 0.5,
    y: 4.8,
    w: 9,
    h: 0.3,
    fontSize: 12,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 4 Login form ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 2：登入畫面 — 闕淑燕輸入帳密', '帳號／密碼由人資或系統管理員提供');
  // left steps
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 1.15,
    w: 4.0,
    h: 3.7,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.1,
  });
  const loginSteps = [
    { n: '①', t: '帳號', d: '輸入闕淑燕的系統帳號\n（例：Shuyan 或人資提供之帳號）' },
    { n: '②', t: '密碼', d: '輸入密碼（首次登入後建議立即修改）' },
    { n: '③', t: '按「登入」', d: '成功後進入「總覽」首頁' },
  ];
  loginSteps.forEach((it, i) => {
    const y = 1.35 + i * 1.1;
    s.addText(it.n + ' ' + it.t, {
      x: 0.6,
      y,
      w: 3.6,
      h: 0.35,
      fontSize: 15,
      bold: true,
      color: C.primary,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(it.d, {
      x: 0.6,
      y: y + 0.35,
      w: 3.6,
      h: 0.6,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });

  // login card mock
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 4.8,
    y: 1.15,
    w: 4.7,
    h: 3.7,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.12,
  });
  s.addText('登入', {
    x: 5.1,
    y: 1.4,
    w: 4.1,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: C.navy,
    align: 'center',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('帳號', {
    x: 5.3,
    y: 2.0,
    w: 3.7,
    h: 0.25,
    fontSize: 11,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.3,
    y: 2.28,
    w: 3.7,
    h: 0.4,
    fill: { color: C.input },
    line: { color: C.primary, width: 1.5 },
    rectRadius: 0.06,
  });
  s.addText('Shuyan（範例）', {
    x: 5.45,
    y: 2.28,
    w: 3.4,
    h: 0.4,
    fontSize: 13,
    color: C.text,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  s.addText('密碼', {
    x: 5.3,
    y: 2.85,
    w: 3.7,
    h: 0.25,
    fontSize: 11,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.3,
    y: 3.12,
    w: 3.7,
    h: 0.4,
    fill: { color: C.input },
    line: { color: C.border, width: 1 },
    rectRadius: 0.06,
  });
  s.addText('••••••••', {
    x: 5.45,
    y: 3.12,
    w: 3.4,
    h: 0.4,
    fontSize: 14,
    color: C.text,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.3,
    y: 3.8,
    w: 3.7,
    h: 0.48,
    fill: { color: C.primary },
    rectRadius: 0.08,
  });
  s.addText('登 入', {
    x: 5.3,
    y: 3.8,
    w: 3.7,
    h: 0.48,
    fontSize: 15,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 5 Dashboard ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 3：登入成功 → 總覽', '闕淑燕看到待辦數字與快捷入口');
  drawSidebar(s, 0.35, 1.1, 1.9, 3.9, '總覽');
  // main area
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.45,
    y: 1.1,
    w: 7.2,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('總覽', {
    x: 2.7,
    y: 1.25,
    w: 3,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('你好，闕淑燕', {
    x: 6.5,
    y: 1.25,
    w: 2.9,
    h: 0.35,
    fontSize: 12,
    color: C.muted,
    align: 'right',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const stats = [
    { l: '待我簽核', v: '2', c: C.amber },
    { l: '我的申請中', v: '1', c: C.primary },
    { l: '本月已核准', v: '5', c: C.green },
  ];
  stats.forEach((st, i) => {
    const x = 2.7 + i * 2.25;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.8,
      w: 2.1,
      h: 1.35,
      fill: { color: C.bg },
      rectRadius: 0.08,
    });
    s.addText(st.v, {
      x,
      y: 1.95,
      w: 2.1,
      h: 0.65,
      fontSize: 32,
      bold: true,
      color: st.c,
      align: 'center',
      fontFace: 'Arial',
      margin: 0,
    });
    s.addText(st.l, {
      x,
      y: 2.65,
      w: 2.1,
      h: 0.35,
      fontSize: 12,
      color: C.text,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  s.addText(
    [
      { text: '操作提示', options: { bold: true, breakLine: true } },
      { text: '· 點「待我簽核」卡片 → 進入待辦列表', options: { breakLine: true } },
      { text: '· 點「新增申請」→ 填寫表單', options: { breakLine: true } },
      { text: '· 有新待簽時可能出現桌面通知或中央彈窗', options: {} },
    ],
    {
      x: 2.7,
      y: 3.4,
      w: 6.7,
      h: 1.4,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 4,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 6 Menu map ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 4：認識左側選單', '闕淑燕常用功能位置');
  const menus = [
    { t: '總覽', d: '首頁統計與快捷', icon: '🏠' },
    { t: '待我簽核', d: '別人送來等她簽的單', icon: '📋' },
    { t: '我的申請', d: '她自己送出的單', icon: '📝' },
    { t: '簽核紀錄', d: '相關歷史紀錄查詢', icon: '🔎' },
    { t: '新增申請', d: '建立請假／報支等', icon: '➕' },
    { t: '帳號設定', d: '改密碼、個人資料', icon: '⚙️' },
  ];
  menus.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 3.15;
    const y = 1.2 + row * 1.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 3.0,
      h: 1.65,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.1,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.15,
      y: y + 0.25,
      w: 0.55,
      h: 0.55,
      fill: { color: C.primarySoft },
      rectRadius: 0.08,
    });
    s.addText(m.icon, {
      x: x + 0.15,
      y: y + 0.25,
      w: 0.55,
      h: 0.55,
      fontSize: 18,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(m.t, {
      x: x + 0.85,
      y: y + 0.3,
      w: 2.0,
      h: 0.4,
      fontSize: 15,
      bold: true,
      color: C.navy,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(m.d, {
      x: x + 0.2,
      y: y + 1.0,
      w: 2.6,
      h: 0.45,
      fontSize: 12,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 7 New request start ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 5：新增申請 — 選擇表單', '闕淑燕要申請「請假」');
  drawSidebar(s, 0.35, 1.1, 1.75, 3.9, '新增申請');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.3,
    y: 1.1,
    w: 7.3,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('請選擇要申請的表單類型', {
    x: 2.55,
    y: 1.3,
    w: 6.8,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const forms = [
    { t: '請假申請', on: true },
    { t: '出差申請', on: false },
    { t: '費用報支', on: false },
    { t: '一般簽呈', on: false },
    { t: '請購申請', on: false },
    { t: '電腦異常報修', on: false },
  ];
  forms.forEach((f, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 2.55 + col * 2.3;
    const y = 1.9 + row * 1.25;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 2.15,
      h: 1.05,
      fill: { color: f.on ? C.primarySoft : C.bg },
      line: { color: f.on ? C.primary : C.border, width: f.on ? 2 : 1 },
      rectRadius: 0.08,
    });
    s.addText(f.t, {
      x,
      y: y + 0.25,
      w: 2.15,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: f.on ? C.primary : C.text,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    if (f.on) {
      s.addText('← 闕淑燕點這', {
        x,
        y: y + 0.6,
        w: 2.15,
        h: 0.3,
        fontSize: 11,
        color: C.primary,
        align: 'center',
        fontFace: 'Microsoft JhengHei',
        margin: 0,
      });
    }
  });
  footer(s, n, TOTAL);
}

// ========== 8 Fill form ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 6：填寫請假申請表', '依欄位如實填寫，紅色＊為必填');
  // form mock
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 1.1,
    w: 5.8,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.1,
  });
  s.addText('請假申請', {
    x: 0.65,
    y: 1.25,
    w: 5.3,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const fields = [
    ['假別', '特休假'],
    ['開始日期', '2026-07-28 09:00'],
    ['結束日期', '2026-07-28 18:00'],
    ['事由', '家庭事務'],
  ];
  fields.forEach((f, i) => {
    const y = 1.75 + i * 0.7;
    s.addText(f[0] + ' *', {
      x: 0.7,
      y,
      w: 5.2,
      h: 0.22,
      fontSize: 11,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.7,
      y: y + 0.22,
      w: 5.2,
      h: 0.38,
      fill: { color: C.input },
      line: { color: C.border, width: 1 },
      rectRadius: 0.05,
    });
    s.addText(f[1], {
      x: 0.85,
      y: y + 0.22,
      w: 4.9,
      h: 0.38,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
      margin: 0,
    });
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.5,
    y: 1.1,
    w: 3.1,
    h: 3.9,
    fill: { color: C.amberBg },
    rectRadius: 0.1,
  });
  s.addText('闕淑燕注意', {
    x: 6.7,
    y: 1.35,
    w: 2.7,
    h: 0.35,
    fontSize: 15,
    bold: true,
    color: C.amber,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '確認假別與日期正確', options: { bullet: true, breakLine: true } },
      { text: '事由請簡要清楚', options: { bullet: true, breakLine: true } },
      { text: '可上傳附件（若有）', options: { bullet: true, breakLine: true } },
      { text: '送出前再核對一次', options: { bullet: true, breakLine: true } },
      { text: '送出後進入簽核流程', options: { bullet: true, breakLine: false } },
    ],
    {
      x: 6.7,
      y: 1.9,
      w: 2.7,
      h: 2.8,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 8,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 9 Submit ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 7：送出申請', '闕淑燕按下「送出」後進入簽核流程');
  // flow
  const nodes = ['闕淑燕\n填寫', '送出', '主管\n簽核', '完成'];
  nodes.forEach((t, i) => {
    const x = 0.7 + i * 2.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.6,
      w: 1.9,
      h: 1.2,
      fill: { color: i === 0 || i === 1 ? C.primary : C.card },
      line: { color: i > 1 ? C.border : C.primary, width: 1 },
      rectRadius: 0.1,
      shadow: sh(),
    });
    s.addText(t, {
      x,
      y: 1.75,
      w: 1.9,
      h: 0.9,
      fontSize: 14,
      bold: true,
      color: i === 0 || i === 1 ? C.white : C.text,
      align: 'center',
      valign: 'middle',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    if (i < 3) {
      s.addShape(pres.shapes.RIGHT_ARROW, {
        x: x + 1.95,
        y: 2.0,
        w: 0.35,
        h: 0.35,
        fill: { color: C.primary },
      });
    }
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 3.2,
    w: 9,
    h: 1.6,
    fill: { color: C.greenBg },
    rectRadius: 0.1,
  });
  s.addText('✓ 送出成功', {
    x: 0.8,
    y: 3.4,
    w: 8.4,
    h: 0.4,
    fontSize: 18,
    bold: true,
    color: C.green,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    '系統會通知下一關簽核人（Email／LINE／桌面通知，依公司設定）。\n闕淑燕可到「我的申請」查看進度與目前關卡。',
    {
      x: 0.8,
      y: 3.9,
      w: 8.4,
      h: 0.7,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 10 My applications ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 8：我的申請 — 查詢自己的單', '闕淑燕查看剛送出的請假單');
  drawSidebar(s, 0.3, 1.1, 1.7, 3.9, '我的申請');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.2,
    y: 1.1,
    w: 7.4,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('我的申請', {
    x: 2.4,
    y: 1.25,
    w: 3,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  // filter bar
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.4,
    y: 1.65,
    w: 7.0,
    h: 0.45,
    fill: { color: C.bg },
    rectRadius: 0.05,
  });
  s.addText('狀態：全部 ▼    關鍵字：_________    [查詢]  [清除]', {
    x: 2.55,
    y: 1.65,
    w: 6.7,
    h: 0.45,
    fontSize: 11,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  // table header
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.4,
    y: 2.3,
    w: 7.0,
    h: 0.35,
    fill: { color: C.navy },
  });
  s.addText('單號          表單        狀態        更新時間', {
    x: 2.55,
    y: 2.3,
    w: 6.7,
    h: 0.35,
    fontSize: 11,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.4,
    y: 2.65,
    w: 7.0,
    h: 0.55,
    fill: { color: C.primarySoft },
  });
  s.addText('A-202607-012   請假申請   簽核中   2026-07-26 10:15  ← 點列開啟詳情', {
    x: 2.55,
    y: 2.65,
    w: 6.7,
    h: 0.55,
    fontSize: 11,
    color: C.text,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  s.addText('A-202606-088   請假申請   已核准   2026-06-20 16:40', {
    x: 2.55,
    y: 3.25,
    w: 6.7,
    h: 0.4,
    fontSize: 11,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.4,
    y: 3.9,
    w: 7.0,
    h: 0.85,
    fill: { color: C.greenBg },
    rectRadius: 0.06,
  });
  s.addText(
    '操作：點任一列 → 看流程進度、關卡簽核人、意見與附件。\n狀態說明：簽核中＝進行中；已核准／已駁回／已取消＝結束。',
    {
      x: 2.55,
      y: 4.0,
      w: 6.7,
      h: 0.7,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 11 Records query ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 9：簽核紀錄 — 進階查詢', '依日期、表單、狀態篩選相關單據');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 1.15,
    w: 9.2,
    h: 1.5,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('查詢條件（示意）', {
    x: 0.6,
    y: 1.3,
    w: 8.8,
    h: 0.3,
    fontSize: 13,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const filters = [
    ['日期起', '2026-07-01'],
    ['日期迄', '2026-07-31'],
    ['表單', '請假申請'],
    ['狀態', '全部'],
  ];
  filters.forEach((f, i) => {
    const x = 0.6 + i * 2.25;
    s.addText(f[0], {
      x,
      y: 1.7,
      w: 2.1,
      h: 0.22,
      fontSize: 10,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.95,
      w: 2.1,
      h: 0.38,
      fill: { color: C.input },
      line: { color: C.border, width: 1 },
      rectRadius: 0.04,
    });
    s.addText(f[1], {
      x: x + 0.1,
      y: 1.95,
      w: 1.9,
      h: 0.38,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
      margin: 0,
    });
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 2.9,
    w: 9.2,
    h: 1.95,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('闕淑燕的操作步驟', {
    x: 0.6,
    y: 3.1,
    w: 8.8,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: C.primary,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '左側點「簽核紀錄」', options: { bullet: true, breakLine: true } },
      { text: '設定日期區間、表單類型、狀態後按「查詢」', options: { bullet: true, breakLine: true } },
      { text: '列表顯示與她相關的申請／簽核紀錄', options: { bullet: true, breakLine: true } },
      { text: '點列進入詳情；可按「清除條件」重設篩選', options: { bullet: true, breakLine: false } },
    ],
    {
      x: 0.7,
      y: 3.5,
      w: 8.6,
      h: 1.2,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 4,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 12 Pending for me ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 10：待我簽核 — 處理別人的單', '若闕淑燕是主管／簽核人');
  drawSidebar(s, 0.3, 1.1, 1.7, 3.9, '待我簽核');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.2,
    y: 1.1,
    w: 7.4,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.08,
  });
  s.addText('待我簽核  (2)', {
    x: 2.4,
    y: 1.25,
    w: 4,
    h: 0.35,
    fontSize: 15,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  const pending = [
    { no: 'A-202607-015', form: '請假申請', who: '王小明', when: '07-26 09:20' },
    { no: 'A-202607-016', form: '費用報支', who: '李美玲', when: '07-26 09:45' },
  ];
  pending.forEach((p, i) => {
    const y = 1.8 + i * 1.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 2.45,
      y,
      w: 6.9,
      h: 0.95,
      fill: { color: C.bg },
      rectRadius: 0.08,
    });
    s.addText(`${p.no}  ·  ${p.form}`, {
      x: 2.65,
      y: y + 0.12,
      w: 4.5,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(`申請人：${p.who}    送達：${p.when}`, {
      x: 2.65,
      y: y + 0.48,
      w: 4.5,
      h: 0.3,
      fontSize: 11,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 7.5,
      y: y + 0.28,
      w: 1.5,
      h: 0.4,
      fill: { color: C.primary },
      rectRadius: 0.05,
    });
    s.addText('開啟處理', {
      x: 7.5,
      y: y + 0.28,
      w: 1.5,
      h: 0.4,
      fontSize: 11,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 13 Detail approve ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 11：詳情頁 — 核准或駁回', '闕淑燕審閱內容後簽核');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 1.1,
    w: 5.9,
    h: 3.9,
    fill: { color: C.card },
    shadow: sh(),
    rectRadius: 0.1,
  });
  s.addText('請假申請  A-202607-015', {
    x: 0.65,
    y: 1.25,
    w: 5.4,
    h: 0.35,
    fontSize: 15,
    bold: true,
    color: C.navy,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '申請人：王小明', options: { breakLine: true } },
      { text: '假別：特休假　日期：2026-07-30', options: { breakLine: true } },
      { text: '事由：家庭事務', options: { breakLine: true } },
      { text: '目前關卡：部門主管（闕淑燕）', options: { breakLine: true } },
    ],
    {
      x: 0.65,
      y: 1.75,
      w: 5.4,
      h: 1.5,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 6,
    }
  );
  s.addText('簽核意見（選填）', {
    x: 0.65,
    y: 3.35,
    w: 5.4,
    h: 0.25,
    fontSize: 11,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.65,
    y: 3.65,
    w: 5.4,
    h: 0.55,
    fill: { color: C.input },
    line: { color: C.border, width: 1 },
    rectRadius: 0.05,
  });
  s.addText('同意，請人資備查。', {
    x: 0.8,
    y: 3.65,
    w: 5.1,
    h: 0.55,
    fontSize: 12,
    color: C.text,
    fontFace: 'Microsoft JhengHei',
    valign: 'middle',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.65,
    y: 4.4,
    w: 2.4,
    h: 0.42,
    fill: { color: C.green },
    rectRadius: 0.06,
  });
  s.addText('核准', {
    x: 0.65,
    y: 4.4,
    w: 2.4,
    h: 0.42,
    fontSize: 14,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.25,
    y: 4.4,
    w: 2.4,
    h: 0.42,
    fill: { color: C.red },
    rectRadius: 0.06,
  });
  s.addText('駁回', {
    x: 3.25,
    y: 4.4,
    w: 2.4,
    h: 0.42,
    fontSize: 14,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.55,
    y: 1.1,
    w: 3.05,
    h: 3.9,
    fill: { color: C.navy },
    rectRadius: 0.1,
  });
  s.addText('簽核檢查清單', {
    x: 6.75,
    y: 1.4,
    w: 2.65,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '閱讀申請內容', options: { bullet: true, breakLine: true } },
      { text: '確認附件（若有）', options: { bullet: true, breakLine: true } },
      { text: '撰寫意見（選填）', options: { bullet: true, breakLine: true } },
      { text: '核准 或 駁回', options: { bullet: true, breakLine: true } },
      { text: '駁回時建議填原因', options: { bullet: true, breakLine: false } },
    ],
    {
      x: 6.75,
      y: 2.0,
      w: 2.65,
      h: 2.6,
      fontSize: 13,
      color: 'E2E8F0',
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 8,
    }
  );
  footer(s, n, TOTAL);
}

// ========== 14 Timeline detail ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 12：查看簽核歷程', '闕淑燕在詳情頁下方時間軸');
  const tl = [
    { t: '已送出', d: '闕淑燕 · 07-26 10:15', ok: true },
    { t: '主管簽核中', d: '等待 闕淑燕', ok: false },
    { t: '人資／後續', d: '尚未到達', ok: false },
  ];
  tl.forEach((item, i) => {
    const y = 1.4 + i * 1.1;
    s.addShape(pres.shapes.OVAL, {
      x: 1.2,
      y: y + 0.15,
      w: 0.4,
      h: 0.4,
      fill: { color: item.ok ? C.green : C.primary },
    });
    if (i < tl.length - 1) {
      s.addShape(pres.shapes.RECTANGLE, {
        x: 1.36,
        y: y + 0.55,
        w: 0.08,
        h: 0.7,
        fill: { color: C.border },
      });
    }
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 1.9,
      y,
      w: 6.8,
      h: 0.85,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.08,
    });
    s.addText(item.t, {
      x: 2.15,
      y: y + 0.1,
      w: 6.3,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(item.d, {
      x: 2.15,
      y: y + 0.45,
      w: 6.3,
      h: 0.3,
      fontSize: 12,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 15 Account ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 13：帳號設定', '闕淑燕修改密碼與個人資料');
  const acc = [
    { t: '顯示名稱', d: '確認為「闕淑燕」' },
    { t: 'Email', d: '用於收信通知（若公司啟用）' },
    { t: '修改密碼', d: '輸入舊密碼與新密碼後儲存' },
    { t: 'Email 通知開關', d: '依公司政策開啟／關閉' },
  ];
  acc.forEach((a, i) => {
    const y = 1.2 + i * 0.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 9,
      h: 0.78,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.08,
    });
    stepBadge(s, 0.7, y + 0.2, i + 1);
    s.addText(a.t, {
      x: 1.3,
      y: y + 0.12,
      w: 7.8,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(a.d, {
      x: 1.3,
      y: y + 0.42,
      w: 7.8,
      h: 0.28,
      fontSize: 12,
      color: C.muted,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 16 Notifications ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '步驟 14：通知如何收到', 'Email ／ LINE ／ 桌面彈窗');
  const ch = [
    { t: 'Email', d: '待簽、核准、駁回等郵件\n請確認信箱與垃圾郵件匣', c: '1D4ED8' },
    { t: 'LINE', d: '綁定後手機即時推播\n對官方帳號傳：綁定 帳號', c: '059669' },
    { t: '桌面', d: '瀏覽器開著簽核系統時\n系統通知 + 中央彈窗', c: 'D97706' },
  ];
  ch.forEach((c, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.4,
      w: 3.0,
      h: 3.2,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.1,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y: 1.4,
      w: 3.0,
      h: 0.12,
      fill: { color: c.c },
    });
    s.addText(c.t, {
      x: x + 0.2,
      y: 1.8,
      w: 2.6,
      h: 0.5,
      fontSize: 20,
      bold: true,
      color: c.c,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.25,
      y: 2.6,
      w: 2.5,
      h: 1.6,
      fontSize: 13,
      color: C.text,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
    });
  });
  footer(s, n, TOTAL);
}

// ========== 17 Tips ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '闕淑燕日常使用小提醒', '提高效率與正確性');
  const tips = [
    ['每天上班', '先看「待我簽核」與總覽數字，避免漏簽'],
    ['送出前', '再確認表單、日期、金額、附件'],
    ['查進度', '用「我的申請」點進詳情看時間軸'],
    ['查歷史', '「簽核紀錄」用日期與狀態篩選'],
    ['密碼', '勿分享帳密；定期修改'],
    ['通知', '公司啟用 LINE 時請完成「綁定」'],
  ];
  tips.forEach((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.45 + col * 4.8;
    const y = 1.2 + row * 1.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 4.55,
      h: 1.05,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.08,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.12,
      h: 1.05,
      fill: { color: C.primary },
    });
    s.addText(t[0], {
      x: x + 0.3,
      y: y + 0.15,
      w: 4.0,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: C.primary,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(t[1], {
      x: x + 0.3,
      y: y + 0.5,
      w: 4.0,
      h: 0.4,
      fontSize: 12,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 18 FAQ ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '常見問題（使用者）', '闕淑燕可能遇到的狀況');
  const faq = [
    ['忘記密碼？', '請洽系統管理員重設，勿使用他人帳號'],
    ['看不到選單？', '該功能可能無權限（如備份、流程管理）'],
    ['送出後想改？', '視流程是否允許撤回；否則請駁回後重送'],
    ['收不到信？', '查垃圾郵件；確認帳號設定中的 Email'],
    ['LINE 沒訊息？', '是否已「綁定 帳號」；公司是否啟用 LINE'],
    ['頁面空白？', 'Ctrl+F5 重新整理；改用 Chrome／Edge'],
    ['沒有「主旨」欄？', '僅「一般簽呈」需填主旨；請假／請購等由系統自動產生'],
    ['PDF 中文亂碼？', '請確認伺服器 fonts 有 Deng.ttf；本機需重新整理後再下載'],
  ];
  s.addTable(
    [
      [
        { text: '問題', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '建議', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...faq.map((r) =>
        r.map((c) => ({ text: c, options: { color: C.text, fontFace: 'Microsoft JhengHei' } }))
      ),
    ],
    {
      x: 0.4,
      y: 1.15,
      w: 9.2,
      colW: [2.8, 6.4],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 12,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
    }
  );
  footer(s, n, TOTAL);
}

// ========== 19 Quick path ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '一頁速查：闕淑燕的一天', '從登入到簽完');
  const day = [
    { t: '登入', d: '開啟網址 → 帳密' },
    { t: '總覽', d: '看待簽數字' },
    { t: '待簽', d: '處理別人單' },
    { t: '申請', d: '請假／報支' },
    { t: '查詢', d: '我的申請' },
    { t: '完成', d: '登出或繼續' },
  ];
  day.forEach((d, i) => {
    const x = 0.4 + (i % 6) * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 2.0,
      w: 1.45,
      h: 1.8,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.08,
    });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.45,
      y: 2.2,
      w: 0.55,
      h: 0.55,
      fill: { color: C.primary },
    });
    s.addText(String(i + 1), {
      x: x + 0.45,
      y: 2.2,
      w: 0.55,
      h: 0.55,
      fontSize: 16,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(d.t, {
      x: x + 0.05,
      y: 2.9,
      w: 1.35,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: C.navy,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(d.d, {
      x: x + 0.05,
      y: 3.3,
      w: 1.35,
      h: 0.4,
      fontSize: 11,
      color: C.muted,
      align: 'center',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 20 主旨規則 ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '新增申請：主旨欄位規則', '2026-07 更新');
  const cards = [
    {
      t: '一般簽呈',
      d: '畫面顯示「主旨 *」\n必須自行填寫',
      c: C.greenBg,
      tc: C.green,
    },
    {
      t: '請假／請購／報支…',
      d: '不顯示主旨欄\n送出時系統依表單\n自動產生（列表仍可見）',
      c: C.primarySoft,
      tc: C.primary,
    },
    {
      t: '為何這樣？',
      d: '減少重複輸入\n表單已有事由／品名\n等關鍵資訊',
      c: C.amberBg,
      tc: C.amber,
    },
  ];
  cards.forEach((c, i) => {
    const x = 0.45 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.4,
      w: 2.95,
      h: 3.2,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.1,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.2,
      y: 1.65,
      w: 2.55,
      h: 0.55,
      fill: { color: c.c },
      rectRadius: 0.06,
    });
    s.addText(c.t, {
      x: x + 0.2,
      y: 1.65,
      w: 2.55,
      h: 0.55,
      fontSize: 14,
      bold: true,
      color: c.tc,
      align: 'center',
      valign: 'middle',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.3,
      y: 2.5,
      w: 2.35,
      h: 1.8,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 21 請假通知 ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '請假核准後：設定 Email 自動回覆', '最終核准系統內通知（若管理員有設定）');
  const steps = [
    { n: '1', t: '假單最終核准', d: '總經理（或最後一關）核定通過' },
    { n: '2', t: '系統內通知', d: '指定人員在總覽／待簽看到待確認' },
    { n: '3', t: '設定自動回覆', d: '為請假同仁設定 Email 自動回覆' },
    { n: '4', t: '確認收到', d: '點「已設定自動回覆／確認收到」' },
  ];
  steps.forEach((st, i) => {
    const y = 1.25 + i * 0.9;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55,
      y: y,
      w: 0.55,
      h: 0.55,
      fill: { color: C.primary },
    });
    s.addText(st.n, {
      x: 0.55,
      y: y,
      w: 0.55,
      h: 0.55,
      fontSize: 16,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 1.3,
      y: y - 0.05,
      w: 8.1,
      h: 0.7,
      fill: { color: C.card },
      shadow: sh(),
      rectRadius: 0.08,
    });
    s.addText(st.t, {
      x: 1.5,
      y: y,
      w: 3.2,
      h: 0.55,
      fontSize: 15,
      bold: true,
      color: C.navy,
      valign: 'middle',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(st.d, {
      x: 4.8,
      y: y,
      w: 4.4,
      h: 0.55,
      fontSize: 13,
      color: C.muted,
      valign: 'middle',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  });
  footer(s, n, TOTAL);
}

// ========== 22 管理員提示 ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  header(s, '管理員／IT 相關（摘要）', '詳細見系統設定與流程管理');
  const rows = [
    ['簽核流程', '自訂欄位可「上移／下移」調整申請單順序；可選 PDF 版面'],
    ['流程模組匯出', '含表單＋步驟＋PDF 排版＋最終通知；不含系統設定'],
    ['PDF 數位簽章', '系統設定可「製作數位簽章」自簽 .p12，或上傳公司憑證'],
    ['本機字型', 'fonts/Deng.ttf 避免 PDF 中文亂碼'],
  ];
  s.addTable(
    [
      [
        { text: '項目', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ...rows.map((r) =>
        r.map((c) => ({ text: c, options: { color: C.text, fontFace: 'Microsoft JhengHei' } }))
      ),
    ],
    {
      x: 0.4,
      y: 1.25,
      w: 9.2,
      colW: [2.4, 6.8],
      border: [{ pt: 0.5, color: C.border }],
      fontSize: 13,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
    }
  );
  s.addText('正式站：https://192.168.99.220:3848　·　本機開發埠：8080', {
    x: 0.45,
    y: 4.6,
    w: 9.1,
    h: 0.35,
    fontSize: 12,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  footer(s, n, TOTAL);
}

// ========== 23 End ==========
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addText('操作練習建議', {
    x: 0.7,
    y: 1.5,
    w: 8.5,
    h: 0.55,
    fontSize: 28,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '請以「闕淑燕」示範帳號實際走一遍：', options: { breakLine: true } },
      { text: '登入 → 新增請假 → 我的申請查詢 → 待簽（若有）→ 核准', options: { breakLine: true } },
      { text: '', options: { breakLine: true } },
      { text: '正式站：https://192.168.99.220:3848', options: { breakLine: true } },
      { text: '詳細安裝說明請見同套件《完整安裝說明.md》', options: { breakLine: true } },
      { text: '簡報製作：張祖銘', options: {} },
    ],
    {
      x: 0.7,
      y: 2.3,
      w: 8.5,
      h: 2.5,
      fontSize: 15,
      color: 'CBD5E1',
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 6,
    }
  );
}

pres
  .writeFile({ fileName: out })
  .then(() => console.log('WROTE', out, 'slides≈', TOTAL))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
