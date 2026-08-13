/**
 * 以 UTF-8 寫入 D:\一鍵安裝包 各平台詳細安裝說明
 */
const fs = require('fs');
const path = require('path');

const OutRoot = 'D:\\一鍵安裝包';
const SeedManifest = path.join(
  process.cwd(),
  'dist',
  'seed-data',
  'SEED-MANIFEST.json'
);
const stamp = new Date().toLocaleString('zh-TW', { hour12: false });

let manifest = {
  counts: { users: 0, workflows: 0, departments: 0, requests: 0, attachments: 0 },
  workflows: [],
  departments: [],
  users: [],
};
if (fs.existsSync(SeedManifest)) {
  manifest = JSON.parse(fs.readFileSync(SeedManifest, 'utf8'));
}

const c = manifest.counts || {};
const wfList = (manifest.workflows || []).map((w) => `- ${w.name}`).join('\n');
const deptList = (manifest.departments || []).map((d) => `- ${d.name}`).join('\n');
const usersList = (manifest.users || [])
  .map(
    (u) =>
      `- \`${u.username}\` / ${u.name}（${u.department || '—'}）[${u.role || 'user'}]`
  )
  .join('\n');

const commonData = `
## 本包內建資料摘要（建置時間：${stamp}）

| 項目 | 數量 |
|------|------|
| 成員（啟用） | ${c.users ?? 0} |
| 部門 | ${c.departments ?? 0} |
| 簽核流程 | ${c.workflows ?? 0} |
| 申請單 | ${c.requests ?? 0} |
| 附件索引 | ${c.attachments ?? 0} |

### 簽核流程
${wfList || '（無）'}

### 部門
${deptList || '（無）'}

### 成員
${usersList || '（無）'}

> 完整清單見同目錄 **成員帳號清單.csv** 與 **SEED-MANIFEST.json**

### 預設登入
- **管理員**：帳號 \`Admin\`，全新庫密碼見 \`data/.admin-bootstrap.txt\`（請立刻改密）
- **其他帳號**：由管理員建立；匯入未填密碼時為隨機密碼
`.trim();

const winMd = `# 線上簽核系統 — Windows 一鍵安裝說明

**建置時間：** ${stamp}  
**適用：** Windows 10 / 11 / Windows Server 2016 以上（x64）  
**預設埠：** \`3847\`  
**無需預先安裝 Node.js**

---

## 1. 安裝包內容

\`\`\`
Windows/
├── 00-請先讀我.txt
├── 安裝說明.md                 ← 本文件
├── 一鍵安裝.bat                ← 從解壓資料夾直接安裝
├── Install-ApprovalSystem.bat  ← 從 zip 一鍵解壓並安裝
├── ApprovalSystem-Portable.zip
├── ApprovalSystem-Portable/    ← 已解壓完整包（可拷貝到 USB）
│   ├── install.bat / start.bat / stop.bat
│   ├── runtime/node/           ← 內建 Node.js
│   ├── app/                    ← 程式
│   │   └── data/               ← ★ 完整種子資料
│   └── seed-data/              ← 種子備份
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

${commonData}

---

## 2. 安裝步驟（建議）

### 方式 A：一鍵從 ZIP 安裝

1. 將整個 \`Windows\` 資料夾拷貝到目標電腦（例如桌面）
2. 建議以系統管理員身分雙擊 **Install-ApprovalSystem.bat**
3. 等待解壓與複製完成
4. 瀏覽器開啟：**http://127.0.0.1:3847/**
5. 帳號 \`Admin\`，密碼見 \`data/.admin-bootstrap.txt\`（請立刻改密）

### 方式 B：使用已解壓資料夾

1. 開啟 \`ApprovalSystem-Portable\`
2. 雙擊 **install.bat** 或外層 **一鍵安裝.bat**
3. 同上開啟網址登入

### 方式 C：隨身碟離線執行（不安裝到本機）

1. 開啟 \`ApprovalSystem-Portable\`
2. 雙擊 **start.bat**
3. 開啟 http://127.0.0.1:3847/

---

## 3. 安裝位置與資料路徑

| 項目 | 路徑 |
|------|------|
| 程式安裝目錄 | \`%LOCALAPPDATA%\\ApprovalSystem\` |
| 資料庫 | \`%LOCALAPPDATA%\\ApprovalSystem\\app\\data\\approval.db\` |
| 附件 | \`...\\app\\data\\uploads\` |
| 備份 PDF | \`...\\app\\data\\backups\` |

- **全新安裝**：自動帶入種子資料（成員、流程、歷史單據、附件）
- **重複安裝／更新**：會**保留**既有 \`data\`，不覆蓋資料庫

---

## 4. 區網給其他電腦使用

1. 在伺服器電腦完成安裝並啟動  
2. Windows 防火牆允許 **TCP 3847**  
3. 其他電腦開啟：\`http://伺服器IP:3847/\`

---

## 5. 日常操作

| 動作 | 方式 |
|------|------|
| 啟動 | 開始功能表 → 線上簽核系統；或 \`start.bat\` |
| 背景啟動 | \`start-hidden.bat\` |
| 停止 | \`stop.bat\` |
| 解除安裝 | \`uninstall.bat\`（請先備份 data） |

---

## 6. 備份

定期複製：\`%LOCALAPPDATA%\\ApprovalSystem\\app\\data\`  
或使用系統內「備份」功能。

---

## 7. 常見問題

**Q：打不開網頁？**  
A：確認已執行 start／install；埠 3847 未被占用。

**Q：中文 PDF 亂碼？**  
A：確認 \`app\\fonts\\kaiu.ttf\` 存在。

**Q：想還原種子資料？**  
A：停止服務後，用 \`seed-data\\data\\\` 覆蓋 \`app\\data\\\`（請先備份）。

**Q：Email 通知？**  
A：管理員 → 帳號設定 → Email 設定 → 啟用 SMTP。
`;

const ubMd = `# 線上簽核系統 — Ubuntu 一鍵安裝說明

**建置時間：** ${stamp}  
**適用：** Ubuntu 22.04 / 24.04 LTS（x86_64 或 aarch64）  
**預設埠：** \`3847\`  
**建議方式：** Docker Compose

---

## 1. 安裝包內容

\`\`\`
Ubuntu/
├── 00-請先讀我.txt
├── 安裝說明.md
├── ApprovalSystem-Ubuntu-Install.zip
├── ApprovalSystem-Ubuntu-Install/
│   ├── install.sh          ← ★ 一鍵安裝
│   ├── uninstall.sh / status.sh / backup-data.sh
│   ├── Dockerfile / docker-compose.yml
│   ├── server/ public/ fonts/
│   └── data/               ← ★ 完整種子資料
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

${commonData}

---

## 2. 安裝前準備

1. 伺服器可連網（首次安裝 Docker 或 Node 需下載）  
2. 建議可用空間 ≥ 2 GB  
3. 上傳安裝包：

\`\`\`bash
scp ApprovalSystem-Ubuntu-Install.zip user@ubuntu-ip:~/
\`\`\`

---

## 3. 一鍵安裝步驟

\`\`\`bash
cd ~
unzip ApprovalSystem-Ubuntu-Install.zip
cd ApprovalSystem-Ubuntu-Install
chmod +x install.sh uninstall.sh status.sh backup-data.sh

# 互動安裝（建議選 Docker）
./install.sh

# 或非互動
./install.sh --docker -y

# 原生 Node + systemd（需 sudo）
# sudo ./install.sh --native -y
\`\`\`

完成後開啟：**http://伺服器IP:3847/**  
登入：帳號 \`Admin\`，密碼見 \`data/.admin-bootstrap.txt\`（請立刻改密）

---

## 4. 驗證

\`\`\`bash
./status.sh
docker compose ps
curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:3847/
\`\`\`

---

## 5. 日常維運

| 動作 | Docker |
|------|--------|
| 狀態 | \`./status.sh\` 或 \`docker compose ps\` |
| 日誌 | \`docker compose logs -f\` |
| 重啟 | \`docker compose restart\` |
| 停止 | \`docker compose down\` |
| 備份 data | \`./backup-data.sh\` |
| 更新程式 | 覆蓋程式後 \`docker compose up -d --build\`（**勿刪 data/**） |

資料目錄：安裝目錄下的 \`data/\`（掛載到容器 \`/app/data\`）

---

## 6. 防火牆

\`\`\`bash
sudo ufw allow 3847/tcp
sudo ufw reload
\`\`\`

---

## 7. 遷移其他主機資料

1. \`docker compose down\`  
2. 備份現有 \`data/\`  
3. 覆寫 \`data/approval.db\`、\`uploads\`、\`backups\`  
4. \`docker compose up -d\`

---

## 8. 常見問題

**Q：Permission denied** → \`chmod +x install.sh\`  
**Q：bash\\r 錯誤** → \`sed -i 's/\\r$//' install.sh\`  
**Q：埠占用** → \`./install.sh --docker --port 3848\`  
**Q：Email** → 系統內「帳號設定 → Email 設定」
`;

const nasMd = `# 線上簽核系統 — Synology NAS 一鍵安裝說明

**建置時間：** ${stamp}  
**適用：** DSM 7.x + **Container Manager**（Docker）  
**預設埠：** \`3847\`  
**範例：** \`http://192.168.99.220:3847/\`（請改成您的 NAS IP）

---

## 1. 安裝包內容

\`\`\`
NAS/
├── 00-請先讀我.txt
├── 安裝說明.md
├── ApprovalSystem-NAS-Install.zip
├── ApprovalSystem-NAS-Install/
│   ├── Dockerfile / docker-compose.yml
│   ├── server/ public/ fonts/
│   ├── data/                 ← ★ 完整種子資料
│   ├── deploy.sh             ← SSH 一鍵啟動
│   └── docs/SYNOLOGY.md
├── 成員帳號清單.csv
└── SEED-MANIFEST.json
\`\`\`

${commonData}

---

## 2. 前置條件

1. **套件中心** → 安裝 **Container Manager**  
2. 建議 NAS 使用固定 IP  
3. File Station 建立：\`/docker/approval-system/\`  
   （實際路徑多為 \`/volume1/docker/approval-system/\`）

---

## 3. 安裝步驟（圖形介面，建議）

### 步驟 1：上傳檔案

1. 解壓 \`ApprovalSystem-NAS-Install.zip\`  
2. 將資料夾**內所有內容**上傳到：

   \`\\\\NASIP\\docker\\approval-system\\\`

   完成後應有：

\`\`\`
/docker/approval-system/
  Dockerfile
  docker-compose.yml
  package.json
  server/
  public/
  fonts/
  data/          ← approval.db、uploads、backups
\`\`\`

> 若 NAS **已有**線上系統且要保留現況：先備份既有 \`data/\`，再決定是否覆蓋。  
> 全新安裝請整包上傳（含本包 \`data/\`）。

### 步驟 2：Container Manager 建立專案

1. 開啟 **Container Manager**  
2. **專案** → **新增**  
3. 專案名稱：\`approval-system\`  
4. 路徑：\`/docker/approval-system\`  
5. 使用既有 \`docker-compose.yml\`  
6. 建立並啟動  

首次 build 需連外網，約 5–15 分鐘。

### 步驟 3：開啟系統

**http://NAS的IP:3847/**  
登入：帳號 \`Admin\`，密碼見 \`data/.admin-bootstrap.txt\`（請立刻改密）

---

## 4. SSH 進階安裝

\`\`\`bash
cd /volume1/docker/approval-system
sudo chmod +x deploy.sh
sudo ./deploy.sh
# 或
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs -f
\`\`\`

---

## 5. 資料與更新

| 項目 | 說明 |
|------|------|
| 持久化 | \`./data\` → 容器 \`/app/data\` |
| 更新程式 | 上傳新程式後 \`docker compose up -d --build\` |
| 勿刪 | \`data/approval.db\`、\`uploads\`、\`backups\` |
| 備份 | 複製整個 \`data/\` |

---

## 6. 防火牆

- DSM 防火牆允許 **TCP 3847**  
- 可用反向代理轉 80/443 → \`127.0.0.1:3847\`

---

## 7. 常見問題

**Q：容器重啟？** → \`docker compose logs\` 查原因  
**Q：PDF 中文亂碼？** → 確認 \`fonts/kaiu.ttf\` 並重建映像  
**Q：Email 未寄？** → 啟用 SMTP；簽核人填真實 Email  
**Q：埠衝突？** → 改 compose 為 \`"3848:3847"\`
`;

const rootReadme = `線上簽核系統 — 一鍵安裝包總覽
================================
建置時間：${stamp}
存放位置：D:\\一鍵安裝包\\

【目錄】
  Windows\\   → Windows 10/11 一鍵安裝（埠 3847）
  Ubuntu\\    → Ubuntu Docker／原生一鍵安裝（埠 3847）
  NAS\\       → Synology Container Manager（埠 3847）
  _共用種子資料\\ → 獨立種子備份（資料庫＋流程 JSON＋成員清單）

【每個平台資料夾都有】
  00-請先讀我.txt
  安裝說明.md          ← 詳細步驟（請先閱讀）
  成員帳號清單.csv
  SEED-MANIFEST.json
  對應平台的 zip 與解壓目錄

【內建資料（來自 NAS 同步）】
  成員：${c.users}
  流程：${c.workflows}
  申請單：${c.requests}
  部門：${c.departments}
  附件：${c.attachments}

【全新庫登入】
  帳號 Admin，密碼見 data/.admin-bootstrap.txt（請立刻改密）

【建議】
  1. 依目標環境只拷貝對應子資料夾
  2. 安裝前閱讀該資料夾「安裝說明.md」
  3. 上線後立即修改管理員密碼並設定 Email
`;

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.replace(/\r\n/g, '\n'), 'utf8');
  console.log('wrote', p);
}

write(path.join(OutRoot, '00-請先讀我.txt'), rootReadme);
write(path.join(OutRoot, 'README.md'), rootReadme);

write(path.join(OutRoot, 'Windows', '安裝說明.md'), winMd);
write(
  path.join(OutRoot, 'Windows', '00-請先讀我.txt'),
  `線上簽核系統 — Windows 安裝包
================================
1. 雙擊 Install-ApprovalSystem.bat 或 一鍵安裝.bat
2. 開啟 http://127.0.0.1:3847/
3. 登入 Admin（密碼見 data/.admin-bootstrap.txt）
4. 詳細步驟見 安裝說明.md
建置：${stamp}
`
);

write(path.join(OutRoot, 'Ubuntu', '安裝說明.md'), ubMd);
write(
  path.join(OutRoot, 'Ubuntu', '00-請先讀我.txt'),
  `線上簽核系統 — Ubuntu 安裝包
================================
1. unzip ApprovalSystem-Ubuntu-Install.zip
2. cd ApprovalSystem-Ubuntu-Install
3. chmod +x install.sh && ./install.sh
4. 開啟 http://伺服器IP:3847/
5. 登入 Admin（密碼見 data/.admin-bootstrap.txt）
詳細：安裝說明.md
建置：${stamp}
`
);

write(path.join(OutRoot, 'NAS', '安裝說明.md'), nasMd);
write(
  path.join(OutRoot, 'NAS', '00-請先讀我.txt'),
  `線上簽核系統 — Synology NAS 安裝包
================================
1. 解壓 ApprovalSystem-NAS-Install.zip
2. 上傳全部內容到 /docker/approval-system/
3. Container Manager → 專案 → 用 docker-compose 啟動
4. 開啟 http://NAS_IP:3847/
5. 登入 Admin（密碼見 data/.admin-bootstrap.txt）
詳細：安裝說明.md
建置：${stamp}
`
);

// also into package folders
const copies = [
  [
    path.join(OutRoot, 'Windows', '安裝說明.md'),
    path.join(OutRoot, 'Windows', 'ApprovalSystem-Portable', '安裝說明.md'),
  ],
  [
    path.join(OutRoot, 'Ubuntu', '安裝說明.md'),
    path.join(OutRoot, 'Ubuntu', 'ApprovalSystem-Ubuntu-Install', '安裝說明.md'),
  ],
  [
    path.join(OutRoot, 'NAS', '安裝說明.md'),
    path.join(OutRoot, 'NAS', 'ApprovalSystem-NAS-Install', '安裝說明.md'),
  ],
  [
    path.join(OutRoot, 'NAS', '00-請先讀我.txt'),
    path.join(OutRoot, 'NAS', 'ApprovalSystem-NAS-Install', '00-請先讀我.txt'),
  ],
];
for (const [a, b] of copies) {
  if (fs.existsSync(path.dirname(b))) {
    fs.copyFileSync(a, b);
    console.log('copy', b);
  }
}

console.log('GUIDES OK');
