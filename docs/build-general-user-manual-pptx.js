/**
 * 線上簽核系統 — 操作手冊簡報（2026-08 現況）
 * node docs/build-general-user-manual-pptx.js [輸出路徑]
 */
const pptxgen = require('pptxgenjs');
const path = require('path');

const out =
  process.argv[2] || path.join(__dirname, '線上簽核系統_操作手冊.pptx');

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = '線上簽核系統';
pres.title = '線上簽核系統 — 操作手冊';
pres.subject = '登入、申請、簽核、PDF、通知';

const C = {
  navy: '0F2744',
  ink: '0F172A',
  muted: '475569',
  white: 'FFFFFF',
  card: 'F8FAFC',
  line: 'E2E8F0',
  accent: '0F766E',
  accentSoft: 'CCFBF1',
  amber: 'B45309',
  amberBg: 'FEF3C7',
};

const FONT = 'Microsoft JhengHei';

function header(s, title) {
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.3, h: 0.72,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  s.addText(title, {
    x: 0.5, y: 0.16, w: 12.3, h: 0.44,
    fontFace: FONT, fontSize: 22, bold: true, color: C.white, margin: 0,
  });
}

function footer(s, n, total) {
  s.addText(`線上簽核系統  ·  ${n} / ${total}`, {
    x: 0.5, y: 7.15, w: 12.3, h: 0.22,
    fontFace: FONT, fontSize: 11, color: C.muted, margin: 0,
  });
}

const TOTAL = 12;

// 1 封面
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: C.navy },
  });
  s.addText('線上簽核系統', {
    x: 0.7, y: 2.1, w: 12, h: 0.9,
    fontFace: FONT, fontSize: 40, bold: true, color: C.white, margin: 0,
  });
  s.addText('操作手冊', {
    x: 0.7, y: 3.05, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, color: '99F6E4', margin: 0,
  });
  s.addText('登入 → 申請 → 簽核 → PDF　｜　約 30 人內網　｜　2026-08', {
    x: 0.7, y: 4.0, w: 12, h: 0.4,
    fontFace: FONT, fontSize: 16, color: 'CBD5E1', margin: 0,
  });
  s.addText('本機  http://127.0.0.1:3847', {
    x: 0.7, y: 5.9, w: 12, h: 0.35,
    fontFace: FONT, fontSize: 14, color: '94A3B8', margin: 0,
  });
}

// 2 網址與帳號
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '怎麼進去');
  const rows = [
    [
      { text: '項目', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
    ],
    ['本機（首頁）', 'http://127.0.0.1:3847'],
    ['區網 HTTP', 'http://伺服器IP:3847'],
    ['區網 HTTPS', 'https://伺服器IP:3848'],
    ['帳號', 'Admin（管理員建立其他人帳號，不能自行註冊）'],
    ['密碼', '全新庫看 data/.admin-bootstrap.txt，登入後立刻改'],
  ];
  s.addTable(rows, {
    x: 0.5, y: 1.05, w: 12.3, h: 4.6,
    colW: [2.6, 9.7],
    border: { pt: 0.5, color: C.line },
    fontFace: FONT, fontSize: 15, color: C.ink,
    valign: 'middle',
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.85, w: 12.3, h: 1.05,
    fill: { color: C.amberBg }, line: { color: 'F59E0B' },
  });
  s.addText('開發階段：電腦綁定已停用。LINE 通知目前只給內建 Admin。', {
    x: 0.7, y: 6.05, w: 11.9, h: 0.65,
    fontFace: FONT, fontSize: 15, color: C.amber, margin: 0,
  });
  footer(s, 2, TOTAL);
}

// 3 側欄
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '畫面怎麼走');
  const items = [
    ['總覽', '待辦、公告、統計'],
    ['新增申請', '選流程、填表、送出'],
    ['待我簽核', '核准／駁回／加簽／轉簽'],
    ['我的申請', '自己送出的單'],
    ['簽核紀錄', '相關單據；管理員可看已刪除並還原'],
    ['簽核流程', '管理員維護步驟與表單'],
    ['備份／報表', '依權限：備份 PDF、請假 Excel'],
  ];
  items.forEach((it, i) => {
    const y = 1.05 + i * 0.78;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 12.3, h: 0.7,
      fill: { color: i % 2 ? C.card : C.white }, line: { color: C.line },
    });
    s.addText(it[0], {
      x: 0.7, y: y + 0.14, w: 2.6, h: 0.42,
      fontFace: FONT, fontSize: 16, bold: true, color: C.accent, margin: 0,
    });
    s.addText(it[1], {
      x: 3.5, y: y + 0.14, w: 9.0, h: 0.42,
      fontFace: FONT, fontSize: 16, color: C.ink, margin: 0,
    });
  });
  footer(s, 3, TOTAL);
}

// 4 申請
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '新增申請');
  const steps = [
    ['1', '選流程', '請假、請購、報支、出差、加班、報修、簽呈、信用額度'],
    ['2', '填欄位', '必填會標示。僅一般簽呈要自己填主旨，其餘自動產生'],
    ['3', '附件', '可上傳；已核准下載時會連 PDF 打包'],
    ['4', '送出', '下一關簽核人會收到 Email；Admin 另可收 LINE'],
  ];
  steps.forEach((it, i) => {
    const x = 0.5 + (i % 2) * 6.4;
    const y = 1.1 + Math.floor(i / 2) * 2.7;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 6.1, h: 2.45,
      fill: { color: C.card }, line: { color: C.line },
    });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.25, y: y + 0.28, w: 0.5, h: 0.5,
      fill: { color: C.accent },
    });
    s.addText(it[0], {
      x: x + 0.25, y: y + 0.34, w: 0.5, h: 0.38,
      fontFace: FONT, fontSize: 16, bold: true, color: C.white, align: 'center', margin: 0,
    });
    s.addText(it[1], {
      x: x + 0.9, y: y + 0.3, w: 4.9, h: 0.45,
      fontFace: FONT, fontSize: 20, bold: true, color: C.ink, margin: 0,
    });
    s.addText(it[2], {
      x: x + 0.3, y: y + 1.05, w: 5.5, h: 1.15,
      fontFace: FONT, fontSize: 15, color: C.muted, margin: 0,
    });
  });
  footer(s, 4, TOTAL);
}

// 5 請假
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '請假申請（最常用）');
  s.addText('流程：申請人 → 代理人 → 人事 → 部門主管 → 副總（兩位都要簽）→ 總經理', {
    x: 0.5, y: 1.0, w: 12.3, h: 0.4,
    fontFace: FONT, fontSize: 15, color: C.ink, margin: 0,
  });
  s.addTable(
    [
      [
        { text: '欄位', options: { fill: { color: C.navy }, color: C.white, bold: true } },
        { text: '說明', options: { fill: { color: C.navy }, color: C.white, bold: true } },
      ],
      ['代理人', '人員選擇，必填'],
      ['假別', '特休／事假／病假等，必填'],
      ['起迄', '日期＋時間（30 分）'],
      ['天數／小時', '可自動試算'],
      ['事由', '選填'],
    ],
    {
      x: 0.5, y: 1.55, w: 12.3, h: 4.0,
      colW: [3.2, 9.1],
      border: { pt: 0.5, color: C.line },
      fontFace: FONT, fontSize: 15, color: C.ink, valign: 'middle',
    }
  );
  s.addText('核准後若有最終通知，請依公司規定設定 Email 自動回覆，再到系統點「確認收到」。', {
    x: 0.5, y: 5.75, w: 12.3, h: 0.55,
    fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
  });
  footer(s, 5, TOTAL);
}

// 6 其他表單
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '其他表單');
  const cards = [
    ['請購', '品名、數量、金額、需用日 → 主管 → 副總 → 總經理'],
    ['費用報支', '用途與金額，流程與請購類似'],
    ['出差', '地點、期間、交通'],
    ['加班／延長工時', '時段與時數'],
    ['電腦報修', '設備與異常說明'],
    ['一般簽呈', '唯一需要自填主旨'],
    ['信用額度', '客戶與額度；財務建檔後申請人確認'],
  ];
  cards.forEach((it, i) => {
    const y = 1.0 + i * 0.78;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 0.14, h: 0.68, fill: { color: C.accent },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.64, y, w: 12.16, h: 0.68,
      fill: { color: C.card }, line: { color: C.line },
    });
    s.addText(it[0], {
      x: 0.9, y: y + 0.14, w: 2.8, h: 0.4,
      fontFace: FONT, fontSize: 16, bold: true, color: C.ink, margin: 0,
    });
    s.addText(it[1], {
      x: 3.8, y: y + 0.14, w: 8.7, h: 0.4,
      fontFace: FONT, fontSize: 15, color: C.muted, margin: 0,
    });
  });
  footer(s, 6, TOTAL);
}

// 7 簽核
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '待我簽核');
  const acts = [
    ['核准', '可填意見；會簽要全部同意才過關'],
    ['駁回', '退回申請人，流程結束'],
    ['加簽', '臨時多請一位同仁會簽'],
    ['轉簽', '把本關交給另一位主管'],
    ['催辦', 'Email 提醒目前簽核人'],
    ['桌面彈窗', '登入中有新待簽會跳出中央提示'],
  ];
  acts.forEach((it, i) => {
    const x = 0.5 + (i % 3) * 4.2;
    const y = 1.15 + Math.floor(i / 3) * 2.7;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 4.0, h: 2.45,
      fill: { color: C.card }, line: { color: C.line },
    });
    s.addText(it[0], {
      x: x + 0.25, y: y + 0.35, w: 3.5, h: 0.5,
      fontFace: FONT, fontSize: 20, bold: true, color: C.accent, margin: 0,
    });
    s.addText(it[1], {
      x: x + 0.25, y: y + 1.05, w: 3.5, h: 1.05,
      fontFace: FONT, fontSize: 15, color: C.ink, margin: 0,
    });
  });
  footer(s, 7, TOTAL);
}

// 8 PDF
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, 'PDF 與備份');
  s.addText([
    { text: '詳情頁可預覽正式版面；已核准可下載。', options: { breakLine: true } },
    { text: '中文用專案字型 Deng.ttf；已核准右上角有紅色「核准」章。', options: { breakLine: true } },
    { text: '可選公司 .p12 或系統設定製作自簽憑證做數位簽章。', options: { breakLine: true } },
    { text: '側欄「備份資料」依部門／表單／年月存放在 data/backups/。', options: { breakLine: true } },
    { text: '有附件或啟用加密時存 ZIP。部署更新不會覆蓋此目錄。', options: {} },
  ], {
    x: 0.6, y: 1.2, w: 12.1, h: 4.6,
    fontFace: FONT, fontSize: 18, color: C.ink, paraSpaceAfter: 12, margin: 0,
  });
  footer(s, 8, TOTAL);
}

// 9 通知
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '通知');
  const n = [
    ['Email', '正式留底。設定在執行期，一鍵包不含帳密。'],
    ['LINE', '手機即時。現在只給內建 Admin。傳「綁定 Admin」。Webhook 用 https://catshome.tw:3848/line/webhook'],
    ['桌面', '電腦開著簽核頁：系統通知＋畫面正中彈窗。'],
  ];
  n.forEach((it, i) => {
    const y = 1.15 + i * 1.75;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 12.3, h: 1.58,
      fill: { color: C.card }, line: { color: C.line },
    });
    s.addText(it[0], {
      x: 0.8, y: y + 0.25, w: 2.2, h: 1.05,
      fontFace: FONT, fontSize: 22, bold: true, color: C.accent, valign: 'middle', margin: 0,
    });
    s.addText(it[1], {
      x: 3.2, y: y + 0.3, w: 9.3, h: 1.0,
      fontFace: FONT, fontSize: 16, color: C.ink, valign: 'middle', margin: 0,
    });
  });
  footer(s, 9, TOTAL);
}

// 10 刪除還原
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '刪除與還原');
  s.addText([
    { text: '刪除是軟刪：列表隱藏，單據、附件、備份、稽核都還在。', options: { breakLine: true } },
    { text: '一般人不能刪已核准單。', options: { breakLine: true } },
    { text: '管理員到「簽核紀錄 → 查看已刪除單據」可還原。', options: { breakLine: true } },
    { text: '已刪單據詳情會標示，並有「還原申請」。', options: {} },
  ], {
    x: 0.6, y: 1.4, w: 12.1, h: 4.4,
    fontFace: FONT, fontSize: 20, color: C.ink, paraSpaceAfter: 16, margin: 0,
  });
  footer(s, 10, TOTAL);
}

// 11 管理員
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  header(s, '管理員要記得');
  const admin = [
    ['成員', '自己建帳號，不要開放註冊'],
    ['流程', '可匯出／匯入整包模組（含 PDF 排版與最終通知）'],
    ['系統設定', '公司名、Logo、公告、備份加密、PDF 簽章'],
    ['更新', 'NAS_SKIP_DB=1，不要覆蓋 data/'],
    ['一鍵包', 'D:\\一鍵安裝包 的 NAS／Ubuntu／Windows，不含密鑰'],
  ];
  admin.forEach((it, i) => {
    const y = 1.05 + i * 1.1;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 12.3, h: 0.98,
      fill: { color: C.card }, line: { color: C.line },
    });
    s.addText(it[0], {
      x: 0.75, y: y + 0.25, w: 2.4, h: 0.48,
      fontFace: FONT, fontSize: 18, bold: true, color: C.accent, margin: 0,
    });
    s.addText(it[1], {
      x: 3.3, y: y + 0.25, w: 9.2, h: 0.48,
      fontFace: FONT, fontSize: 16, color: C.ink, margin: 0,
    });
  });
  footer(s, 11, TOTAL);
}

// 12 結束
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: C.navy },
  });
  s.addText('有問題先看這三個', {
    x: 0.7, y: 1.8, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 26, bold: true, color: C.white, margin: 0,
  });
  s.addText([
    { text: 'README.md — 專案總說明', options: { breakLine: true } },
    { text: 'CHANGELOG.md — 唯一修改紀錄', options: { breakLine: true } },
    { text: 'docs/SYNOLOGY.md、UBUNTU.md、一鍵更新說明.md', options: {} },
  ], {
    x: 0.7, y: 2.7, w: 12, h: 2.2,
    fontFace: FONT, fontSize: 20, color: 'CCFBF1', margin: 0,
  });
  s.addText('https://github.com/qbear555/approval-system', {
    x: 0.7, y: 5.6, w: 12, h: 0.4,
    fontFace: FONT, fontSize: 16, color: '94A3B8', margin: 0,
  });
}

pres.writeFile({ fileName: out }).then(() => {
  console.log('wrote', out);
});
