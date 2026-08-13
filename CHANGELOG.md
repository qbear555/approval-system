# 變更紀錄（Changelog）

## [1.1.0] — 2026-08-13

### P0 安全

- **JWT**：不再使用倉庫內公開預設密鑰。優先讀 `JWT_SECRET`（夠長且非已知弱值）；否則沿用或自動產生 `data/.jwt-secret`（不進 git、部署不覆蓋）。
- **註冊**：關閉 `POST /api/auth/register` 公開自建帳號；請由管理員在成員名單建立。
- **登入限速**：同一 IP＋帳號 15 分鐘內失敗 5 次鎖定 15 分鐘；同一 IP 失敗 20 次亦鎖定。
- Docker 映像／compose 拿掉 `please-change-this-on-nas` 等弱預設。

---

## [1.1.0] — 2026-08-01

### 一鍵更新程式

- 根目錄 **`一鍵更新.bat`**／`scripts/one-click-update.js`
- 可選：部署 NAS、同步 `D:\一鍵安裝包`、啟動本機 8080
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
