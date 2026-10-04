# 變更紀錄

產品修改紀錄只維護這一份。執行期指紋日誌在伺服器 `data/修改紀錄-自動.md`（不進 git）。

<!-- AUTO-DEPLOY-SUMMARY-START -->

## 最近自動部署（系統寫入）

| 項目 | 內容 |
|------|------|
| 時間 | 2026-09-17 20:57:42 |
| 版本 | `v1.1.0+0d90b6e` / `1.1.0+202609172057.0d90b6e` |
| 類型 | 程式變更部署 |
| 指紋 | `0d90b6e` |
| 變更檔 | 修改 10 · 新增 6 · 移除 0 |

執行期逐次指紋紀錄只寫在伺服器 `data/修改紀錄-自動.md`（不進 git）。產品說明以此檔為準。

<!-- AUTO-DEPLOY-SUMMARY-END -->

## [1.1.0] — 2026-08-13

本機首頁：http://127.0.0.1:3847。部署後 HTTP 3847／HTTPS 3848。

### 2026-10-04 雙欄審批檢視模式與視覺化進度時間軸（階段一）

- **雙欄審批模式（Master-Detail Review）**：在「待我簽核」列表新增「📋 表格清單 / 🖥️ 雙欄審批」檢視模式切換器。切換為雙欄審批時，左側提供緊湊待審公文清單（含即時關鍵字篩選、等待時間統計），右側即時載入完整公文詳情並提供原位簽核。簽核完成後自動推進至下一筆待審公文，大幅提升主管批核效率。支援鍵盤快速鍵（J 下一筆、K 上一筆）。
- **視覺化簽核歷程軌跡時間軸（Visual Stepper Timeline）**：在單據詳情頁新增完整時間軸饋送卡片，依時間序列清晰呈現發起、核准、駁回、退回、加簽、轉簽等歷程；標註簽署人、部門、代理簽核標籤、簽核意見引述框與數位簽名預覽；簽核中案件於時間軸末端動態顯示目前停留關卡與已等待時間。
- **雙軌架構相容**：經典版（`/`）與現代 Vue 3 版（`/v2/`）同步支援。

### 2026-10-04 主管簽核常用片語與單據 Excel 匯出

- **常用片語**：帳號設定可新增／排序／刪除簽核意見（最多 20 則），存於帳號 `comment_phrases_json`，詳情核准與批次簽核一鍵帶入。預設：同意、核可、准予備查、依規定辦理、請檢附單據正本、依規定核銷。
- **API**：`GET/PUT /api/me/comment-phrases`；`POST /api/reports/requests-export`（kind：`all`／`expense`／`purchase`／`finance`）。
- **單據 Excel**：簽核紀錄依目前查詢條件匯出；請假報表頁新增「單據／費用／請購」匯出。工作表含單據清單、費用報支、請購請款、依流程／狀態／部門彙總。
- **權限**：一般使用者僅本人相關單據；admin、`records_all`、`leave_report`、`finance_confirm` 可匯出全公司。部署不覆寫 `data/`。
- **雙軌**：經典 `/` 與 Vue `/v2/` 同步。

### 2026-10-04 Vue 總覽／列表改為真正的 Vue 頁（/v2/）

- **總覽、待我簽核、我的申請、簽核紀錄**改為 Vue 3 獨立頁（`DashboardView` / `RequestListView`），不再經 LegacyHost 包經典 `pages-*.js`。
- 統計卡片對齊後端 `/api/stats`：`pendingMe`、`minePending`、`mineDone`；「我的進行中／我已完成」點進去帶 `?status=pending|approved`。
- 列表欄位改用 `requester_name`、主旨、狀態「簽核中」；簽核紀錄仍為 `filter=related` 並可查詢。
- 其餘功能（詳情、新增申請、流程、設定…）仍走 LegacyHost；側欄點「總覽／列表」會回到 Vue 頁。
- 經典 `/` 不變。新版入口：`/v2/`。

### 2026-10-04 批次簽核核准（主管專用高效率操作）

- **待我簽核多選**：在「待我簽核」列表新增全選與勾選框，即時統計已選筆數並提供「批次核准」按鈕。
- **批次簽核視窗**：集中顯示選取單據清單、常用簽核意見標籤（「同意」、「核可」、「准予備查」、「依規定辦理」）。
- **後端安全防護**：新增 `POST /api/requests/bulk-approve`，重構簽核核心邏輯。若表單關卡具備專屬必填欄位（如人事特休核算、資訊查檢表、授信額度），系統將安全跳過並明確提示主管單獨開啟表單，兼顧效率與資料完整性。
- **雙軌架構相容**：經典版（`/`）與現代 Vue 3 版（`/v2/`）同步支援。

### 2026-10-04 複製單據為新申請（同仁日常重複申請加速）

- **簽核詳情「複製為新申請」**：在簽核單據詳情頁上方新增「📑 複製為新申請」按鈕，已送出的單據皆可一鍵複製。
- **表單自動帶入與提示**：點擊後自動跳轉至新申請表單，自動選定對應簽核流程、自動填入先前欄位資料並於主旨前置 `[複製]`；上方醒目提示來源單號，舊單附件自動留空以便同仁上傳本次最新單據憑證。
- **新單建立保證**：提交或存檔時自動以新單據儲存，避免覆蓋原單。
- **雙軌架構相容**：經典版（`/`）與現代 Vue 3 版（`/v2/`）同步支援。

### 2026-10-03 側欄失效（pages-*.js 未進容器）

- 正式容器缺拆檔後的 `public/js/pages-*.js`，請求被 SPA 回成 HTML，側欄點了函式不存在。已把完整前端腳本送進容器。

### 2026-10-03 總覽 isFinanceStaffUser 未定義

- `isFinanceStaffUser` 改放到 `app.js`，避免總覽比備份頁先載入而報錯。

### 2026-10-03 總覽卡片依狀態開啟列表

- 點「我的進行中」只列出簽核中；點「我已完成」只列出已核准。側欄「我的申請」仍顯示全部。

### 2026-10-02 移除 SQLite 適配層

- 刪除 `server/db-adapter/sqlite.js`；執行期只連 MariaDB／MySQL。

### 2026-10-02 本機與正式站改共用 MariaDB

- 本機 `.env` 連 NAS `approval` 庫；SQLite 檔封存至 `data/sqlite-archive-*`。
- 本機 SQLite 多出的單據／流程／附件已合併進 MariaDB（不清空正式資料）。
- `db-adapter` 僅在 SQLite 模式才載入 `node:sqlite`。

### 2026-09-17 設定包匯入上限

- 系統設定包上傳由 100MB 提高到 1GB，改寫入 `data/tmp` 再解析；超過時顯示中文錯誤而非 `File too large`。

### 2026-09-17 OnlyOffice 線上檢視

- 編輯器腳本一律走目前頁面同源 `/__oo`；CSP 補上目前主機。
- Document Server 下載附件改 `inline`；callback 查 `approval_requests`（不再誤查 `requests`）。

### 2026-09-17 總覽 MySQL 日期函數

- 翻譯 `date('now','start of month')`、`julianday()`，總覽本月件數／平均天數在 MariaDB 不再語法錯誤。

### 2026-09-17 SQLite／MySQL 雙後端

- `server/db-adapter`：同一套 SQL（`datetime('now','localtime')`、`INSERT OR IGNORE`、`ON CONFLICT`）包一層，預設 SQLite。
- 切 MySQL：`DB_CLIENT=mysql` + `MYSQL_HOST`／`MYSQL_USER`／`MYSQL_PASSWORD`／`MYSQL_DATABASE`（或 `DATABASE_URL=mysql://...`）。
- 呼叫端 `db.prepare().get/.all/.run` 不變。Windows 便攜版與 NAS 預設仍是檔案庫。
- 可選 `docker compose --profile mysql up -d` 起 MySQL 8。
- `scripts/migrate-sqlite-to-mysql.js`：預覽列數，`--force` 才清空目標 MySQL 並匯入（保留 ID）。

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
