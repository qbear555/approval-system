# 線上簽核系統

適合約 30 人的公司內網簽核。

**首頁（本機）：** http://127.0.0.1:3847

| 用途 | 網址 |
|------|------|
| 本機 | http://127.0.0.1:3847 |
| 區網 HTTP | http://伺服器IP:3847 |
| 區網 HTTPS | https://伺服器IP:3848 |

更新程式時一律保留 `data/`（`NAS_SKIP_DB=1`），不含正式 Email／LINE 密鑰。

## 功能

- 管理員建立帳號，**不開放自行註冊**
- 自訂流程：固定層、條件、會簽、擇一、加簽／轉簽／代理
- 表單：請假、請購、報支、出差、加班、報修、一般簽呈、信用額度
- 流程模組匯出／匯入（表單＋步驟＋PDF 排版＋最終核准通知）
- 核准後下載 PDF（中文 `fonts/Deng.ttf`，可數位簽章）
- 通知：Email、LINE（目前僅內建 Admin）、桌面通知＋中央彈窗
- 軟刪單據、管理員可還原；完整稽核
- 備份資料（`data/backups/`）、請假 Excel 報表

## 登入

| 項目 | 說明 |
|------|------|
| 帳號 | `Admin`（大小寫不拘） |
| 密碼 | 全新庫見 `data/.admin-bootstrap.txt`，登入後立刻改密並刪檔 |
| 開發中 | 電腦綁定已停用；LINE 僅 Admin |

## 本機開發

```powershell
cd C:\Users\TsuMing\Documents\approval-system
npm.cmd install
npm.cmd start
```

瀏覽器開 http://127.0.0.1:3847

必備：`public/js/ui-helpers.js`、`fonts/Deng.ttf`。煙霧測試：`node scripts/smoke.js`。

## 部署

| 環境 | 說明 |
|------|------|
| Synology NAS | [docs/SYNOLOGY.md](docs/SYNOLOGY.md)，Docker HTTP 3847／HTTPS 3848 |
| Ubuntu | [docs/UBUNTU.md](docs/UBUNTU.md) |
| Windows 一鍵包 | `D:\一鍵安裝包\Windows` |
| 更新 | [docs/一鍵更新說明.md](docs/一鍵更新說明.md)；開發機 `一鍵更新.bat` |

Let's Encrypt 憑證同步見 [docs/HTTPS憑證-自動續期.md](docs/HTTPS憑證-自動續期.md)。

同步三平台安裝包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-oneclick-packages.ps1
```

## 技術

Node.js 22+、Express、JWT Cookie、SQLite（`node:sqlite`）、PDFKit。

```
approval-system/
├── server/           # API、runtime、routes、pdf/
├── public/           # 前端 SPA
├── fonts/            # Deng.ttf（部署必帶）
├── docs/             # 安裝與操作說明
├── seed-workflows/   # 可匯入流程
├── data/             # 執行期（不進 git、部署不覆蓋）
├── CHANGELOG.md      # 唯一產品修改紀錄
└── README.md
```

## 使用流程

1. 管理員在成員名單建立帳號  
2. 建立或匯入簽核流程  
3. 新增申請並送出  
4. 簽核人在待我簽核核准或駁回  
5. 已核准後下載 PDF  

操作手冊簡報：`docs/線上簽核系統_操作手冊.pptx`

## 注意

- 定期備份 `data/approval.db` 與整個 `data/`
- 設計約 30 人、上限約 50 人
- PDF 中文請用專案 `fonts/Deng.ttf`，勿用 `simsunb.ttf`
- JWT 未設環境變數時寫入 `data/.jwt-secret`（勿提交）
