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

### 2026-10-14 畫布排版只留一份（第 26 步）

- 部署腳本改讀 `NAS_PORT`（這台 NAS 是 9922）。沒有 SFTP 時改走 SSH 串流上傳，仍不覆蓋 `data/`。

- 刪除 `frontend/src/lib/canvas-layouts-data.js`。
- 前端建置改讀 `server/pdf/canvas-layouts.js`。流程編輯器轉畫布與 PDF 產出用同一套內建排版。

### 2026-10-14 拿掉管理頁的 L（第 25 步）

- 備份、稽核、成員、部門、帳號設定、系統設定、請假報表改為直接呼叫 `apiRequest`、提示 store 和權限。
- `L` 已刪除。桌面通知與成員 Excel 匯出仍留在 `admin-runtime`，由頁面直接引入。

### 2026-10-14 移除只測經典外殼的腳本（第 24 步）

- 刪除 `debug-click.js`、`test-save-new-workflow.js`、`test-comprehensive-v2.js`。它們依賴 `window.navigate`、`openWorkflowEditor` 或 LegacyHost，現在的 Vue 畫面沒有這些入口。
- `L` 改成普通物件，不再用 Proxy 轉送。

### 2026-10-14 拿掉 L.state（第 23 步）

- 稽核列表的篩選改放在 `audit-list-query`，離開再回來仍保留。
- `admin-runtime` 不再保存 token、使用者或成員名單。`L.loadUsers` 已移除。

### 2026-10-14 登入者與成員名單改讀 store（第 22 步）

- 帳號設定的姓名、簽名、片語改寫入登入 store，側欄名稱會跟著更新。
- 請假報表與代理人名單改讀使用者 store。
- 成員頁與部門頁不再把名單抄進 `L.state`。稽核列表的查詢條件仍留在頁面暫存。

### 2026-10-14 拿掉「經典函式可能不存在」的判斷（第 21 步）

- 成員匯出、備份權限、系統設定日期、桌面通知改為直接呼叫現有 Vue 函式。
- 測試通知改走 `goPage('inbox')`。不再把權限定義與系統設定寫進暫存。
- 煙霧測試改為確認首頁是 Vue 入口，且沒有再載入 `app.js` 等經典腳本。

### 2026-10-14 拿掉 window 彈窗與導頁橋（第 20 步）

- 導頁、附件檢視、加簽／轉簽／退回改由 `app-services` 模組接通，不再掛 `window.__v2*` 或 `window.__openVue*`。
- 桌面通知點擊待簽核，直接進 `/inbox`。

### 2026-10-14 拿掉 window.appState（第 19 步）

- 管理頁暫存改放在 `admin-runtime` 模組裡，不再寫入 `window.appState` 或 `window.state`。
- 加簽／轉簽的人員名單改讀 Vue 的使用者 store。
- 登出時直接停止待簽輪詢，不再呼叫 `window.stopPendingWatcher`。

### 2026-10-14 管理頁離開 native 目錄（第 18 步）

- 備份、稽核、系統設定、成員、部門、帳號設定、請假報表從 `frontend/src/native` 移到 `views`。
- 空狀態元件改放 `components/common/EmptyState.vue`。路由網址不變。
- `native` 目錄已刪除。

### 2026-10-14 移除未接上的簡化草稿（第 17 步）

- 刪除沒有接上路由的簡化頁：成員、部門、備份、帳號設定、系統設定、佔位頁。
- 正式頁仍是現有的 Vue 路由（成員／部門／備份／設定在 `native/pages`，LINE 在 `LineSettingsView`）。
- 刪除仍去載入已移除經典腳本的 `test-auto-detect-form.js`、`test-paper-designer.js`。

### 2026-10-14 清掉舊打包檔與 vendor PDF.js（第 16 步）

- 刪除 `public/assets` 裡目前 `index.html` 用不到的舊 chunk。
- 刪除 `public/vendor/pdfjs`。畫面已改用打包的 `pdfjs-dist`。
- 移除前端已無人呼叫的 `load-script` 輔助。

### 2026-10-14 PDF.js 改由 Vite 打包（第 15 步）

- 紙本填寫、畫布底圖與附件預覽改為匯入 `pdfjs-dist`，不再在執行時插入 `/vendor/pdfjs/pdf.min.js`。
- Worker 跟著建置產物走。`public/vendor/pdfjs` 仍留著，給舊的掃描測試腳本使用。

### 2026-10-14 網站目錄不再放經典腳本（第 14 步）

- `canvas-layouts.js` 從 `public/js` 移到 `server/pdf/canvas-layouts.js`。後端轉畫布仍用同一套函式。
- `public/js` 目錄已空並移除。瀏覽器不會再拿到任何經典頁面腳本。
- 前端畫布預設資料仍打包在 Vue 裡，不靠這個公開路徑。

### 2026-10-14 清掉經典頁面腳本（第 13 步）

- 刪除 `public/js` 裡已不再載入的頁面腳本（`app.js`、`pages-*.js`、流程圖、紙本設計器、富文字、日曆、ui-helpers）。
- 保留 `public/js/canvas-layouts.js`，後端 PDF 轉畫布仍直接引用它。
- 煙霧測試與架構檢查改為確認這些經典腳本不存在，並確認 Vue 的 `index.html` 與 PDF.js 還在。

### 2026-10-14 移除經典載入器（第 12 步）

- 刪除已無人呼叫的 `core-scripts.js`、`classic-designers.js` 與 native bridge。
- 刪除未接上路由的經典包裝頁（總覽、列表、詳情、新增申請、流程清單）。
- 執行中的畫面不再有路徑去載入 `app.js` 或 `pages-*.js`。PDF 底圖仍使用 PDF.js。

### 2026-10-14 日曆與內建畫布排版（第 11 步）

- 請假天數改由前端 `tw-calendar` 模組計算國定假日與補班，不再載入 `tw-calendar.js`。
- 內建排版轉畫布改在建置時引入 `canvas-layouts.js`，開畫布時不再另外載入腳本。

### 2026-10-14 Vue 紙本填寫與富文字（第 10 步）

- 新增申請的紙本底圖填寫區改為 Vue：PDF／圖片底圖、欄位輸入、勾選、下拉、翻頁。不再載入 `pdf-form-designer.js`。
- 說明欄富文字改為 Vue 編輯器（粗體、斜體、底線、字級、顏色、表格、貼上淨化）。檢視不再載入 `rich-editor.js`。

### 2026-10-14 Vue 流程圖編輯器（第 9 步）

- 簽核流程的「流程圖」改為 Vue 編輯器：關卡、匯合、結束、拖曳、連線、條件、自動排版與驗證。
- 儲存仍寫入流程的 `flow` 圖，並同步簽核關卡。不再載入經典 `flow-editor.js`。
- 紙本填寫檢視與富文字欄位仍按需載入對應腳本。

### 2026-10-14 Vue 管理視窗（第 8 步）

- 成員新增／編輯／休假／權限／密碼／休假明細，以及部門新增、改名、加入成員，改為 Vue 視窗。
- 手寫簽名、公告預覽、主題套用、桌面待簽輪詢不再載入經典 `app.js`。
- 流程圖編輯器、紙本填寫檢視、富文字欄位仍按需載入對應腳本。

### 2026-10-14 拆除經典外殼（第 7 步）

- 未知網址不再啟動經典 `AppHost` 與整包 `pages-*.js`，改顯示「找不到頁面」。
- 進站不再預載簽核列表、新增申請、流程頁、備份、稽核、LINE 等經典頁面腳本。
- 成員／部門編輯視窗、簽名板、公告、主題仍在按下時載入 `app.js` 與對應腳本。流程圖、紙本填寫、富文字維持按需載入。

### 2026-10-14 Vue 畫布設計器（第 6 步）

- 流程編輯的紙本底圖設計器與可編輯畫布改為 Vue 全螢幕編輯器：拖曳、縮放、文字／表格／欄位／簽章、座標、上傳底圖、格線與 PDF 表單掃描。
- 儲存格式仍是 `pdf_template` 與 `canvas_objects`，與既有 PDF 產出相容。
- 申請人填寫紙本底圖的檢視、流程圖編輯器仍沿用經典腳本。

### 2026-10-14 Vue 管理頁（第 5 步）

- 備份資料、請假報表、稽核日誌、成員名單、部門、帳號設定、LINE 通知、系統設定改為獨立 Vue 路由，不再經 AppHost。
- 清單與表單走 Vue API。成員／部門編輯視窗、簽名板、公告預覽仍暫載經典腳本。
- LINE 通知頁改寫為 Vue（服務網址、API 金鑰、事件、健康檢查、測試推播、綁定列表），不接簡化草稿。

### 2026-10-13 Vue 簽核流程（第 4 步）

- `/workflows` 改為真正的 Vue 頁：清單、啟停用、永久刪除、匯出／匯入流程模組、全頁編輯器。
- 編輯器保留表單欄位、簽核步驟、分類、PDF 排版、最終核准通知、常用層級預設與路徑名稱自動同步。
- 流程圖與紙本／畫布設計器暫載經典腳本（畫布重寫屬第 6 步）。

### 2026-10-13 Vue 新增申請（第 3 步）

- `/new-request` 改為真正的 Vue 頁：分類目錄、搜尋、常用星號、動態表單用 `FormFields`。
- 保留代申請請假、Email 通知偏好、附件與已核准申請單、草稿儲存、`?draftId=` 續編、`?cloneFrom=` 複製、請假天數／特休試算、作廢對象、紙本套印填寫。
- 詳情頁「繼續編輯草稿／複製為新申請」與總覽常用表單捷徑接到同一頁。

### 2026-10-13 Vue 簽核詳情（第 2 步）

- `/detail/:id` 改為真正的 Vue 頁：表單檢視用 `FormDataViewer`、附件用 `AttachmentList`、特休用 `LaborBanner`、簽核關卡欄位用 `FormFields`。
- 保留核准／駁回／加簽／轉簽／退回、草稿送出、催辦、作廢、複製、刪除、PDF 預覽與下載、最終核准收執、財務建檔確認。
- 待我簽核雙欄審批改掛同一個 Vue 詳情面板，簽完自動推進下一筆。

### 2026-10-13 Vue 外殼統一（第 1 步）

- 詳情、新增申請、流程、備份、請假報表、稽核、成員、部門、帳號／LINE／系統設定全部改為 `AppLayout` 子路由，共用同一側欄。
- `AppHost` 只承載 `#page-body` 與經典腳本，不再複製第二套側欄／標題／modal。
- 經典 `bindAuthUI` 不再覆寫 Vue 側欄的 `router-link` 與登出按鈕。
- LINE 通知側欄頁補上最小經典渲染（完整 Vue 改寫仍屬第 5 步）。

### 2026-10-13 Vue 表單核心（第 0 步，尚未接上線頁）

- 抽出共用 API／Pinia（users、workflows）、權限 composable、表單 model。
- Vue 動態欄位：福利金明細、後續交辦、與會／會簽／自選簽核人、部門主管、日期時間 30 分、手續費內扣外加、金額中文大寫與 5% 稅、作廢對象、富文字（沿用既有 rich-editor）。
- 只讀檢視 `FormDataViewer`、附件清單（接既有附件彈窗）、特休 banner。
- 正式路由仍走原頁；此核心供後續詳情／新增申請改寫使用。

### 2026-10-13 內建 PDF 排版轉成可編輯畫布物件

- 請假／請購／報支／出差／報修／加班／簽呈／信用額度／福利金／會議記錄等內建版面，可一鍵轉成畫布上的文字、表格、欄位、簽章物件。
- 新版面類型 `canvas_objects`：可拖曳、改字、增刪列欄、綁定申請欄位；產出 PDF 依物件重畫。
- 流程編輯新增「轉成可編輯畫布」與「開啟畫布編輯」；匯出／匯入一併帶出物件 JSON。
- 一鍵安裝包 `docker-compose.yml` 不再帶入資料庫密碼預設值。

### 2026-10-04 雙欄審批右側按鈕無反應

- Vue `/v2/` 待我簽核雙欄模式內嵌經典詳情時，核准／駁回成功後原本呼叫經典 `navigate('detail')`，但 Vue 版面沒有 `#page-body`／`#toast`，點擊後丟錯、畫面不動。
- 改為簽核完成呼叫雙欄 `onRefresh`／`onActionCompleted`，自動推進下一筆待簽；經典 `/` 雙欄同樣留在原位刷新。
- 經典 `toast`／`openModal`／`navigate` 在 Vue 宿主改為空值安全，並橋接 `__v2Toast`、`__v2Navigate`。
- 右欄審批按鈕改在嵌入容器內綁定；雙欄詳情宿主加 `v-once`，避免 Vue 重繪清掉按鈕事件。

### 2026-10-04 Vue 登出卡在「載入中」

- `/v2/` 登出不再呼叫經典 `showAuth()`（LegacyHost 裡只有「載入中…」stub、沒有登入表單）。
- 改為清 token 後導向 `/v2/login` 真正的 Vue 登入頁；經典 `/` 登出行為不變。

### 2026-10-04 後端架構模組化拆分、代碼健康度與自動部署（階段三）

- **後端架構模組化拆分（Backend Modularization）**：
  - 將超過 8,700 行的單體 `server/index.js` 安全重構，拆解為高內聚、職責分離的領域路由模組，代碼精簡逾 80,000 bytes（~2,300 行）：
    - `server/routes/departments.js`：部門清單、組織成員關聯、統計與台灣國定假日/補班公開與管理端點。
    - `server/routes/mail-settings.js`：SMTP 伺服器設定、即時郵件連線測試、LINE Webhook Proxy 轉送與 `/api/system/notify-status` 狀態檢測。
    - `server/routes/system-admin.js`：系統設定、公司品牌 Logo、系統公告發布/附件、PDF 數位簽章憑證管理與自簽憑證製作、安全登入政策、系統設定完整包（匯入/匯出/預覽）與稽核日誌查詢/CSV 匯出。
    - `server/routes/workflows.js`：簽核流程定義 CRUD、流程範本一體包匯入/匯出、紙本 PDF 底圖模版上傳與存取。
    - `server/routes/reports.js`：請假報表 Excel 匯出、單據多維度 Excel 報表匯出（費用報支、請購請款、財務款項）。
    - `server/routes/backups.js`：PDF/ZIP 簽核單據備份查詢、條件批次下載、備份排程與實體歷史封存。
  - 修復 `server/audit-log.js` 跨資料庫（MySQL / SQLite）兼容性，修正自動建表在 MariaDB/MySQL 上的解析異常。
  - 確保所有 API 端點路徑、認證中介軟體（`authMiddleware`、`adminOnly`、`builtinAdminOnly`、`requirePerm`）與回傳格式 100% 向後相容。
- **全自動煙霧測試驗證（Smoke Test Verification）**：
  - 更新 `scripts/smoke.js` 與 `scripts/verify-notify.js`，煙霧測試涵蓋 CSP 安全防護標頭、字型引擎、PDF 生成、郵件與 LINE 通知通道、多級權限驗證，全數通過。
- **前端健康度與雙軌部署（Dual-track Production Deployment）**：
  - 前端 Vue 3 SPA（`frontend/`）重新構建產物同步至 `public/v2/`。
  - 透過 SFTP/SSH 安全無損部署至 Synology NAS Docker 生產環境（`192.168.99.220:3847`），確保 `/volume1/docker/approval-system/data` 生產資料庫完整安全。

### 2026-10-04 退回指定關卡、表單自動計算與智慧請假核算（階段二）

- **退回指定關卡機制（Return to Prior Step / Applicant）**：
  - 當前簽核主管點擊「↩ 退回」時，提供彈窗讓主管選擇退回目標：可選擇「退回給申請人修改」，或退回給「前置任一已核准之簽核關卡（如步驟 1、步驟 2）」重簽。
  - 第一關簽核主管即可直接退回申請人修改補件，無須再以「駁回」作廢單據。
  - 單據退回申請人後狀態轉為「退回修改（returned）」，申請人進入單據詳情可直接點擊「✏️ 修改並重新送審」，修改表單欄位與附件後再次送審，流程回推第一關重簽，完整保留退回歷史歷程。
  - 狀態清單與篩選器新增「退回修改」，時間軸末端動態顯示「⚠️ 待修改重新送審」節點。
- **表單自動運算與稅額助手（Form Calculations & Tax Assistant）**：
  - **5% 營業稅試算器**：金額欄位下方提供「➕5% 稅 (含稅)」與「➖5% 稅 (未稅)」快算工具，一鍵試算含稅總額或反推未稅淨額。
  - **中文大寫金額即時回饋**：輸入數值即時換算新臺幣繁體中文大寫（如「新臺幣 壹萬貳仟元整」），防止金額誤填與溢領。
  - **品項單價自動推算**：當表單具備數量與金額時，即時推算單位成本單價。
  - **手續費內扣／外加動態試算**：填寫手續費與選擇「內扣」或「外加」時，即時顯示實際受款撥款金額或公司支出總額摘要徽章。
- **智慧請假時數分析明細卡（Smart Leave Breakdown Card）**：
  - 填寫請假起迄時間時，即時顯示視覺化「請假時數智慧核算卡」，自動排除台灣國定假日、例假日，並扣除每日 12:30～13:30 午休 1 小時。
  - 單據詳情頁同步嵌入該請假時數分析明細卡，審核主管一眼即可確認扣除假日與午休細節。
- **雙軌架構相容**：經典版（`/`）與現代 Vue 3 版（`/v2/`）同步支援。

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
