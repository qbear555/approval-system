# 變更紀錄

產品修改紀錄只維護這一份。執行期指紋日誌在伺服器 `data/修改紀錄-自動.md`（不進 git）。

<!-- AUTO-DEPLOY-SUMMARY-START -->

## 最近自動部署（系統寫入）

部署後啟動時由系統更新此區塊。

<!-- AUTO-DEPLOY-SUMMARY-END -->

## [1.1.0] — 2026-08-13

本機首頁：http://127.0.0.1:3847。部署後 HTTP 3847／HTTPS 3848。

### 現況摘要

- 小型企業內網簽核（約 30 人）。帳號由管理員建立，不開放自行註冊。
- 全新庫帳號 `Admin`，密碼只寫入 `data/.admin-bootstrap.txt`。
- 單據軟刪；管理員可在簽核紀錄還原。
- PDF 優先 `fonts/Deng.ttf`；已核准單有紅色核准章；Chrome 預覽已放行 CSP。
- 電腦綁定開發階段停用（`DEVICE_BIND_FEATURE_ENABLED=false`）。
- LINE 通知僅內建 Admin（`LINE_NOTIFY_BUILTIN_ADMIN_ONLY=true`）。Webhook：`https://catshome.tw:3848/line/webhook`。
- 更新一律 `NAS_SKIP_DB=1`，不覆寫正式 `data/`。

### 2026-08 架構與安全

- 後端拆 `runtime/`、`routes/`；前端拆各 pages；PDF 拆 `pdf/write`、`stamp`、`filename`、`forms/*`。
- JWT 不用倉庫弱密鑰；註冊關閉；登入限速；公開 API 僅 branding。
- Cookie HttpOnly；CSP／nosniff／X-Frame／Referrer。
- 財務只認 `finance_confirm`；內網預設 `192.168.99.0/24`。

### 通知與備份

- Email＋LINE＋桌面通知／中央彈窗並存。
- 備份在 `data/backups/`；加密需先設密碼。
- 請假 Excel 報表（權限 `leave_report`）。

### 先前版本（濃縮）

- 2026-08-01：一鍵更新、總覽公告、本機控制台、PDF 自簽中文 CN。
- 2026-07：流程模組匯出／匯入、最終核准通知、LINE 串接、NAS Docker 3847／3848。
