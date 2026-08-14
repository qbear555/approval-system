# 變更紀錄

產品修改紀錄只維護這一份。執行期指紋日誌在伺服器 `data/修改紀錄-自動.md`（不進 git）。

<!-- AUTO-DEPLOY-SUMMARY-START -->

## 最近自動部署（系統寫入）

| 項目 | 內容 |
|------|------|
| 時間 | 2026-08-13 23:10:00 |
| 版本 | `v1.1.0+b88d3ea` / `1.1.0+202608132309.b88d3ea` |
| 類型 | 程式變更部署 |
| 指紋 | `b88d3ea` |
| 變更檔 | 修改 4 · 新增 0 · 移除 0 |

執行期逐次指紋紀錄只寫在伺服器 `data/修改紀錄-自動.md`（不進 git）。產品說明以此檔為準。

<!-- AUTO-DEPLOY-SUMMARY-END -->

## [1.1.0] — 2026-08-13

本機首頁：http://127.0.0.1:3847。部署後 HTTP 3847／HTTPS 3848。

### 2026-08-14 稽核日誌 IP

- 簽核容器改 `network_mode: host`，不再把來源記成 Docker 閘道 `172.19.0.1`。
- OnlyOffice 改連 `127.0.0.1:8088`，回呼主機 LAN `:3847`。舊日誌無法回填真實 IP。

### 2026-08-14 附件 PDF 預覽加大

- 上傳附件預覽改為約 1240px 寬、高度約 86vh（不再卡在 860×560）。

### 2026-08-14 OnlyOffice 線上編輯

- HTTPS 同源代理不再把簽核 CSP 套到 Document Server 頁面（缺 `unsafe-eval`／wasm 會開出空白編輯器）。
- HTTP 也改走同源代理（不再直連 `:8088`）。
- `/api/onlyoffice/file`、`/callback` 略過內網 IP 檢查（容器用 token 抓檔）。
- 編輯器錯誤改顯示可讀原因。
- 父頁 HTML `Cache-Control: no-store`；若仍是舊 CSP 會自動重載一次（sdk-all 在父頁／Worker 裡 `new Function`）。
- 編輯器改走 `/__oo/…` 並禁止 Document Server 一年快取；舊分頁會一直用帶舊 CSP 的 iframe HTML。

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
