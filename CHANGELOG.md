# 變更紀錄（Changelog）

## [1.1.0] — 2026-08-13

### 架構

- 後端 helper 抽到 `server/runtime.js`，並再依領域拆 `runtime/devices.js`、`perms.js`、`flow.js`、`notify.js`。
- 後端路由拆成 `auth`／`users`／`departments`／`system`／`workflows`／`requests`，並改為明確解構 `ctx`（不再使用 `with`）。
- 前端再拆 `pages-dashboard.js`、`pages-requests.js`、`pages-workflows.js`、`pages-backups.js`、`pages-users.js`、`pages-audit.js`、`pages-departments.js`、`pages-settings.js`。
- 倉庫內可重複跑 `node scripts/smoke.js`（health、branding、登入頁腳本、401）。
- 移除未掛載、易改錯檔的 `src/` 影子專案。
- 登入頁／側欄顯示環境徽章（NAS／本機）與版本。
- 文件、種子產生器與安裝說明對齊：本機埠 **3847**；全新庫密碼見 `data/.admin-bootstrap.txt`（不再寫入 `admin123`／`pass1234`）。

### P2 安全／權限

- **預設密碼**：全新庫不再使用 `admin123`；初始密碼寫入 `data/.admin-bootstrap.txt`。啟動 log 不再印出密碼。仍使用 `admin123`／`pass1234` 的帳號登入後必須先改密。
- **財務身分**：只認 `finance_confirm` 權限，不再寫死部門或姓名。啟動時會為舊的財務部／既有人員補上該權限。
- **單據刪除**：改軟刪（`deleted_at`）。列表不再顯示；附件、備份、簽核歷程與稽核保留。已核准仍不可由申請人刪除。
- **內網／電腦綁定**：預設僅允許 `192.168.99.0/24`（外加本機與 Docker 網段）。每帳號預設最多綁 3 台電腦，可在系統設定調整；帳號設定可自行解除。

### P1 安全

- **公開 API**：部門、台灣日曆、系統版本、完整系統設定改需登入。登入頁改讀 `/api/system/branding`（僅公司名／Logo／版本）。
- **探活**：新增 `/health`、`/api/health`（檢查 SQLite）；Docker healthcheck 不再打 `/api/departments`。
- **設定包**：預設不含 SMTP 密碼；勾選匯出密碼須再確認（`confirmMailSecrets=1`）。
- **CORS**：預設關閉（同源即可）；僅當設定 `CORS_ORIGIN` 才開放指定來源。
- **來源 IP**：預設不採信 `X-Forwarded-For`；僅 `TRUST_PROXY=1` 時交給 Express。
- **登入態**：JWT 改 HttpOnly Cookie（`approval_token`），前端不再寫入 localStorage。
- **字型**：登入頁不再載入 Google Fonts，改用本機微軟正黑體／系統字型。

### P0 安全

- **JWT**：不再使用倉庫內公開預設密鑰。優先讀 `JWT_SECRET`（夠長且非已知弱值）；否則沿用或自動產生 `data/.jwt-secret`（不進 git、部署不覆蓋）。
- **註冊**：關閉 `POST /api/auth/register` 公開自建帳號；請由管理員在成員名單建立。
- **登入限速**：同一 IP＋帳號 15 分鐘內失敗 5 次鎖定 15 分鐘；同一 IP 失敗 20 次亦鎖定。
- Docker 映像／compose 拿掉 `please-change-this-on-nas` 等弱預設。

---

## [1.1.0] — 2026-08-01

### 一鍵更新程式

- 根目錄 **`一鍵更新.bat`**／`scripts/one-click-update.js`
- 可選：部署 NAS、同步 `D:\一鍵安裝包`、啟動本機 3847
- 說明：`docs/一鍵更新-2026-08-01-本次功能.md`
- 捷徑：`一鍵更新-部署NAS.bat`、`一鍵更新-同步一鍵包.bat`

### 總覽公告

- 系統設定可維護一則總覽公告（標題／內文／附件）
- **公布期間**：開始／結束時間；超過結束時間自動下架，總覽不顯示
- 附件僅「查看」時**檢視**（不提供下載）
- 總覽卡不顯示附件檔名；「公告」標籤放大

### 路由與本機

- 重新整理保留目前頁面／單據（URL hash + session）
- 本機 Server 啟用／停用／控制台腳本與桌面捷徑

### PDF 數位簽章

- 自簽憑證支援中文 CN／O（修正 node-forge MAC 驗證失敗）

---

## [1.1.0] — 2026-07-31（續）

### PDF 數位簽章 — 製作憑證

- 系統設定新增 **「製作數位簽章」**：表單必填 CN／O／國家／年數／密碼，產生自簽 .p12
- API：`POST /api/system/pdf-sign/create`
- 文件：`docs/PDF數位簽章-製作說明.md`
- 本機需 `node-forge` 與 `@signpdf/*`；`fonts/Deng.ttf` 避免 PDF 中文亂碼

### 申請主旨

- **僅「一般簽呈」**顯示並要求填寫主旨；其他表單自動產生主旨

### 簽核流程

- 自訂表單欄位可 **上移／下移** 調整順序

### 使用說明簡報

- 更新 `docs/build-user-guide-pptx.js`（23 頁）：主旨規則、請假自動回覆通知、管理員摘要

---

## [1.1.0] — 2026-07-31

### 簽核流程模組（流程 + 表單 + PDF 排版 + 最終核准通知）

- 新增 `server/workflow-module.js`：流程匯出／匯入一體格式 version **2**
- DB：`workflows.pdf_layout_json`、`workflows.final_notify_json`、表 `final_notify_receipts`
- **PDF 排版**：編輯流程可選版面類型；PDF 產生優先讀模組設定
- **最終核准系統內通知**（非 Email 抄送）：
  - 最後一步核准後通知選定人員
  - 可限定「哪些申請人」的單據才觸發
  - 收件人需於系統點「確認收到」
  - 請假流程預設說明為「**設定 Email 自動回覆**」
- 匯出／匯入 API 與 CLI 含 `finalNotify`；**不影響**系統設定／SMTP／使用者／歷史單據
- 文件：`docs/流程模組-最終核准通知.md`
- Skill：`.grok/skills/approval-system/SKILL.md` 補充模組約定

### 修正

- 總經理最後關核准 500：`db.transaction is not a function`（node:sqlite）
- 最終通知寫入失敗時不回滾已核准狀態
- Docker Compose 恢復 3847 HTTP／3848 HTTPS；OnlyOffice 僅 8088；entrypoint 自簽憑證

### 部署

- NAS：`192.168.99.220:3847`／`:3848`，更新時 `NAS_SKIP_DB=1`
- 一鍵包：`D:\一鍵安裝包` 與 `D:\一鍵安裝包_26073101` 之 NAS／Ubuntu／Windows 已同步

---

更早變更請見 Git 歷程與 `docs/` 說明文件。
