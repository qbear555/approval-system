/**
 * 產生「線上簽核系統_安裝步驟簡報.pptx」
 * 用法：node docs/build-install-pptx.js [輸出路徑]
 */
const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const out =
  process.argv[2] ||
  path.join(__dirname, '線上簽核系統_安裝步驟簡報.pptx');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = '張祖銘';
pres.title = '線上簽核系統 — 完整安裝步驟';
pres.subject = 'NAS / Ubuntu / Windows 安裝與設定';
pres.company = '張祖銘';

const C = {
  bg: '0F2744',
  bg2: 'F1F5F9',
  card: 'FFFFFF',
  primary: '2563EB',
  accent: '0EA5E9',
  text: '0F172A',
  muted: '64748B',
  white: 'FFFFFF',
  green: '059669',
  border: 'E2E8F0',
};

function addFooter(slide, n, total) {
  slide.addText(`線上簽核系統 · 安裝步驟  ${n}/${total}`, {
    x: 0.5,
    y: 5.25,
    w: 7,
    h: 0.28,
    fontSize: 10,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  slide.addText('張祖銘 製作', {
    x: 7.2,
    y: 5.25,
    w: 2.3,
    h: 0.28,
    fontSize: 10,
    color: C.muted,
    align: 'right',
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
}

function titleBar(slide, title, subtitle) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.9,
    fill: { color: C.bg },
  });
  slide.addText(title, {
    x: 0.5,
    y: 0.18,
    w: 9,
    h: 0.4,
    fontSize: 22,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5,
      y: 0.55,
      w: 9,
      h: 0.28,
      fontSize: 12,
      color: '94A3B8',
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
  }
}

const total = 14;
let n = 0;

// 1 Cover
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  s.addText('線上簽核系統', {
    x: 0.8,
    y: 1.6,
    w: 8.4,
    h: 0.7,
    fontSize: 40,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText('完整安裝與設定步驟說明', {
    x: 0.8,
    y: 2.4,
    w: 8.4,
    h: 0.5,
    fontSize: 24,
    color: C.accent,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: 'NAS Docker  ·  Ubuntu  ·  Windows', options: { breakLine: true } },
      { text: 'Email ／ LINE ／ 備份 ／ 更新 ／ GitHub', options: { breakLine: true } },
      { text: '正式站範例：https://192.168.99.220:3848', options: { breakLine: true } },
      { text: '簡報製作：張祖銘', options: {} },
    ],
    {
      x: 0.8,
      y: 3.2,
      w: 8,
      h: 1.4,
      fontSize: 14,
      color: 'CBD5E1',
      fontFace: 'Microsoft JhengHei',
    }
  );
}

// 2 Agenda
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '目錄', '建議依序完成');
  const items = [
    '1. 系統架構與埠號',
    '2. 安裝前準備',
    '3. Windows 便攜版',
    '4. Ubuntu 安裝',
    '5. Synology NAS 正式部署',
    '6. 首次登入與系統設定',
    '7. LINE 通知串接',
    '8. 備份資料',
    '9. 更新與一鍵包／GitHub',
    '10. 常見問題',
  ];
  s.addText(
    items.map((t, i) => ({
      text: t,
      options: { bullet: false, breakLine: i < items.length - 1 },
    })),
    {
      x: 0.7,
      y: 1.2,
      w: 8.5,
      h: 3.8,
      fontSize: 16,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 8,
    }
  );
  addFooter(s, n, total);
}

// 3 Architecture
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '1. 系統架構與埠號', '三平台 ＋ 獨立 LINE 服務');
  const cards = [
    { t: '簽核主系統', d: 'Node / Express\nNAS 3847/3848\n本機 8080', x: 0.5 },
    { t: 'LINE NOTIFY', d: 'D:\\Line 專案\n埠 3850\nWebhook 需 HTTPS', x: 3.5 },
    { t: '資料 data/', d: 'DB／上傳／備份\nmail-config\n部署永不覆蓋', x: 6.5 },
  ];
  cards.forEach((c) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: c.x,
      y: 1.3,
      w: 2.8,
      h: 2.8,
      fill: { color: C.card },
      shadow: { type: 'outer', color: '000000', blur: 8, offset: 2, angle: 135, opacity: 0.1 },
      rectRadius: 0.1,
    });
    s.addText(c.t, {
      x: c.x + 0.15,
      y: 1.5,
      w: 2.5,
      h: 0.45,
      fontSize: 16,
      bold: true,
      color: C.primary,
      fontFace: 'Microsoft JhengHei',
      margin: 0,
    });
    s.addText(c.d, {
      x: c.x + 0.15,
      y: 2.1,
      w: 2.5,
      h: 1.7,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
    });
  });
  addFooter(s, n, total);
}

// 4 Prep
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '2. 安裝前準備', 'Checklist');
  s.addText(
    [
      { text: '一鍵包路徑：D:\\一鍵安裝包\\（NAS / Ubuntu / Windows）', options: { bullet: true, breakLine: true } },
      { text: '目標主機：內網可連；Docker／Node 依平台準備', options: { bullet: true, breakLine: true } },
      { text: 'Admin 帳密：首次登入後立刻修改預設密碼', options: { bullet: true, breakLine: true } },
      { text: '選用：SMTP、公司 Logo、LINE Developers Channel', options: { bullet: true, breakLine: true } },
      { text: '安全：安裝包不含 Email／LINE 密鑰與正式 DB', options: { bullet: true, breakLine: true } },
    ],
    {
      x: 0.6,
      y: 1.3,
      w: 8.8,
      h: 3.5,
      fontSize: 16,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 10,
    }
  );
  addFooter(s, n, total);
}

// 5 Windows
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '3. Windows 便攜版', 'D:\\一鍵安裝包\\Windows\\ApprovalSystem-Portable');
  const steps = [
    '複製 ApprovalSystem-Portable 到目標電腦',
    '執行 一鍵安裝.bat 或 start.bat',
    '開啟 http://127.0.0.1:8080/',
    'Admin 登入 → 修改密碼',
    '系統設定：品牌／Email／備份加密／LINE',
    '更新時用 update.bat，勿覆蓋 data/',
  ];
  steps.forEach((t, i) => {
    const y = 1.15 + i * 0.6;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55,
      y: y,
      w: 0.38,
      h: 0.38,
      fill: { color: C.primary },
    });
    s.addText(String(i + 1), {
      x: 0.55,
      y: y,
      w: 0.38,
      h: 0.38,
      fontSize: 14,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
      fontFace: 'Arial',
      margin: 0,
    });
    s.addText(t, {
      x: 1.15,
      y: y,
      w: 8.2,
      h: 0.4,
      fontSize: 15,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
      margin: 0,
    });
  });
  addFooter(s, n, total);
}

// 6 Ubuntu
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '4. Ubuntu 安裝', 'Docker 建議／原生 Node + systemd');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.2,
    w: 9,
    h: 3.6,
    fill: { color: C.card },
    rectRadius: 0.08,
  });
  s.addText(
    [
      { text: '上傳 ApprovalSystem-Ubuntu-Install 至 /opt/approval-system', options: { breakLine: true } },
      { text: 'chmod +x install.sh update.sh status.sh …', options: { breakLine: true } },
      { text: './install.sh --docker   # 或 sudo ./install.sh --native', options: { breakLine: true } },
      { text: 'ufw allow 3847/tcp  3848/tcp', options: { breakLine: true } },
      { text: '瀏覽器：http://<IP>:3847 或 https://…:3848', options: { breakLine: true } },
      { text: '更新：./update.sh（保留 data/）', options: { breakLine: false } },
    ],
    {
      x: 0.8,
      y: 1.45,
      w: 8.4,
      h: 3.2,
      fontSize: 15,
      color: C.text,
      fontFace: 'Consolas',
      paraSpaceAfter: 8,
    }
  );
  addFooter(s, n, total);
}

// 7 NAS install
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '5. Synology NAS 正式部署', '/volume1/docker/approval-system');
  s.addText(
    [
      { text: '上傳 NAS 安裝包內容至 /volume1/docker/approval-system', options: { bullet: true, breakLine: true } },
      { text: 'SSH 或 Container Manager：docker compose up -d --build', options: { bullet: true, breakLine: true } },
      { text: '容器名 approval-system；埠 3847 / 3848', options: { bullet: true, breakLine: true } },
      { text: '開啟 https://192.168.99.220:3848', options: { bullet: true, breakLine: true } },
      { text: 'data/ 掛載 volume — 重建容器不丟資料', options: { bullet: true, breakLine: true } },
    ],
    {
      x: 0.6,
      y: 1.3,
      w: 8.8,
      h: 3.5,
      fontSize: 16,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 10,
    }
  );
  addFooter(s, n, total);
}

// 8 NAS update
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '5b. 從 Windows 更新 NAS', '保留 data — NAS_SKIP_DB=1');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.2,
    w: 9,
    h: 2.2,
    fill: { color: 'FEF3C7' },
    rectRadius: 0.08,
  });
  s.addText('強制規則：更新程式時不得覆寫 approval.db、backups、uploads、mail-config、certs', {
    x: 0.7,
    y: 1.4,
    w: 8.6,
    h: 0.7,
    fontSize: 15,
    bold: true,
    color: '92400E',
    fontFace: 'Microsoft JhengHei',
  });
  s.addText(
    [
      { text: 'D:\\一鍵安裝包\\NAS\\一鍵更新-從這台電腦部署到NAS.bat', options: { breakLine: true } },
      { text: '或：node scripts/deploy-code-nas.js（需 NAS_PASS、NAS_SKIP_DB=1）', options: { breakLine: true } },
      { text: '變更流程：改碼 → 驗證 NAS → 再同步一鍵包 → GitHub', options: {} },
    ],
    {
      x: 0.6,
      y: 3.6,
      w: 8.8,
      h: 1.3,
      fontSize: 14,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 6,
    }
  );
  addFooter(s, n, total);
}

// 9 First login
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '6. 首次登入與系統設定', '僅內建 Admin 可見系統設定');
  const rows = [
    ['登入', 'Admin／admin · 立即修改預設密碼'],
    ['公司品牌', '名稱、Logo（登入頁／側欄／PDF）'],
    ['備份加密', 'AES-256；無密碼則無法備份'],
    ['LINE 通知', '服務網址、API 金鑰、事件、誰可設定'],
    ['Email SMTP', '主機／埠／帳密／寄件者（執行期設定）'],
    ['側欄 LINE', '有權限者可進獨立「LINE 通知」頁'],
  ];
  s.addTable(
    [
      [
        { text: '項目', options: { fill: { color: C.bg }, color: C.white, bold: true } },
        { text: '動作', options: { fill: { color: C.bg }, color: C.white, bold: true } },
      ],
      ...rows.map((r) => r.map((c) => ({ text: c, options: { color: C.text } }))),
    ],
    {
      x: 0.5,
      y: 1.2,
      w: 9,
      colW: [2.2, 6.8],
      border: [{ pt: 0.5, color: C.border }],
      fontFace: 'Microsoft JhengHei',
      fontSize: 13,
      valign: 'middle',
    }
  );
  addFooter(s, n, total);
}

// 10 LINE
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '7. LINE 通知（LINE NOTIFY）', '獨立專案 D:\\Line 專案 · 埠 3850');
  const steps = [
    'LINE Developers 建立 Messaging API Channel',
    '填入 .env：Token、Secret、INTERNAL_API_KEY',
    'NAS：/volume1/docker/line-notify 啟動容器',
    '簽核設定服務網址 http://NAS:3850 與相同 API 金鑰',
    '成員傳「綁定 簽核帳號」；Webhook 需公網 HTTPS',
  ];
  steps.forEach((t, i) => {
    const y = 1.2 + i * 0.7;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y: y,
      w: 9,
      h: 0.58,
      fill: { color: i % 2 ? 'EFF6FF' : C.card },
      rectRadius: 0.06,
    });
    s.addText(`${i + 1}.  ${t}`, {
      x: 0.7,
      y: y,
      w: 8.6,
      h: 0.58,
      fontSize: 14,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      valign: 'middle',
      margin: 0,
    });
  });
  addFooter(s, n, total);
}

// 11 Backup
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '8. 備份資料', '營運資料 · 部署永不覆蓋');
  s.addText(
    [
      { text: '側欄「備份資料」（權限 backups）', options: { bullet: true, breakLine: true } },
      { text: '程式 server/backup.js；目錄 data/backups/', options: { bullet: true, breakLine: true } },
      { text: 'PDF 或 ZIP；啟用 AES-256 則一律加密 ZIP', options: { bullet: true, breakLine: true } },
      { text: '系統設定 → 備份加密：先設密碼再備份', options: { bullet: true, breakLine: true } },
      { text: '與 DB／uploads 同屬 data/，更新程式不可刪', options: { bullet: true, breakLine: true } },
    ],
    {
      x: 0.6,
      y: 1.3,
      w: 8.8,
      h: 3.5,
      fontSize: 16,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 10,
    }
  );
  addFooter(s, n, total);
}

// 12 Update github
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '9. 更新、一鍵包與 GitHub', 'NAS 優先');
  const flow = [
    { t: '① 改碼', d: 'Documents\\\napproval-system' },
    { t: '② 上 NAS', d: '驗證正式站\nSKIP_DB=1' },
    { t: '③ 一鍵包', d: '三平台同步\nNAS/Ubuntu/Win' },
    { t: '④ GitHub', d: 'main 分支\nqbear555/…' },
  ];
  flow.forEach((f, i) => {
    const x = 0.45 + i * 2.4;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.5,
      w: 2.15,
      h: 2.4,
      fill: { color: C.card },
      rectRadius: 0.1,
      shadow: { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.1 },
    });
    s.addText(f.t, {
      x: x + 0.1,
      y: 1.7,
      w: 1.95,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: C.primary,
      fontFace: 'Microsoft JhengHei',
      align: 'center',
      margin: 0,
    });
    s.addText(f.d, {
      x: x + 0.1,
      y: 2.4,
      w: 1.95,
      h: 1.2,
      fontSize: 13,
      color: C.text,
      fontFace: 'Microsoft JhengHei',
      align: 'center',
    });
  });
  s.addText('倉庫：https://github.com/qbear555/approval-system', {
    x: 0.5,
    y: 4.2,
    w: 9,
    h: 0.4,
    fontSize: 13,
    color: C.muted,
    fontFace: 'Microsoft JhengHei',
  });
  addFooter(s, n, total);
}

// 13 FAQ
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg2 };
  titleBar(s, '10. 常見問題', '快速排除');
  const faq = [
    ['容器一直重啟', 'docker logs；檢查 auth.js／labor.js 是否完整'],
    ['登入 500', '還原 labor.parseLeaveUsedManual 等完整 labor.js'],
    ['statCardHtml not defined', '補 public/js/ui-helpers.js 後 Ctrl+F5'],
    ['本機連不上', '確認 8080 行程；勿用 NAS 的 3848 開本機'],
    ['更新後資料沒了', '錯誤覆蓋 data/ → 應 NAS_SKIP_DB=1'],
  ];
  s.addTable(
    [
      [
        { text: '現象', options: { fill: { color: C.bg }, color: C.white, bold: true } },
        { text: '處理', options: { fill: { color: C.bg }, color: C.white, bold: true } },
      ],
      ...faq.map((r) => r.map((c) => ({ text: c, options: { color: C.text } }))),
    ],
    {
      x: 0.4,
      y: 1.2,
      w: 9.2,
      colW: [3.2, 6],
      border: [{ pt: 0.5, color: C.border }],
      fontFace: 'Microsoft JhengHei',
      fontSize: 12,
      valign: 'middle',
    }
  );
  addFooter(s, n, total);
}

// 14 End
{
  n++;
  const s = pres.addSlide();
  s.background = { color: C.bg };
  s.addText('安裝完成後', {
    x: 0.8,
    y: 1.5,
    w: 8.4,
    h: 0.6,
    fontSize: 28,
    bold: true,
    color: C.white,
    fontFace: 'Microsoft JhengHei',
    margin: 0,
  });
  s.addText(
    [
      { text: '請核對：登入、流程、Email／LINE、備份路徑', options: { breakLine: true } },
      { text: '詳細文字說明見同套件《完整安裝說明.md》', options: { breakLine: true } },
      { text: '正式站：https://192.168.99.220:3848', options: { breakLine: true } },
      { text: '簡報製作：張祖銘', options: {} },
    ],
    {
      x: 0.8,
      y: 2.4,
      w: 8.4,
      h: 2,
      fontSize: 16,
      color: 'CBD5E1',
      fontFace: 'Microsoft JhengHei',
      paraSpaceAfter: 8,
    }
  );
}

pres
  .writeFile({ fileName: out })
  .then(() => {
    console.log('WROTE', out);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
