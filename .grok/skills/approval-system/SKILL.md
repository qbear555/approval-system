---
name: approval-system
description: >
  企業線上簽核系統（CatsHome／ARGO）的功能規範、優先順序與實作約定。
  用於開發、修改、部署、通知（Email／LINE／桌面彈窗）、流程、權限、報表、備份、一鍵安裝包。
  Triggers: 簽核、approval、待簽核、流程、請假、報支、LINE 通知、MailPlus、NAS 簽核、
  一鍵安裝包、備份、backup、desktop notification、彈窗、/approval-system。
  Use when working on C:\Users\TsuMing\Documents\approval-system, D:\一鍵安裝包,
  NAS 192.168.99.220:3847/3848, or D:\Line 專案 integration with 簽核.
---

# 線上簽核系統 — 功能 Skill

以繁體中文回覆使用者。實作前先讀本 skill 與 `references/enterprise-requirements.md`。

## 1. 產品定位（來自企業問卷 2026-07）

| 維度 | 結論 |
|------|------|
| 規模 | **小型企業（約 30 人內）** |
| 存取 | **僅公司內網**（NAS；外網需 VPN，不做公網開放為預設） |
| 手機 | **只收通知，回公司再簽**（通知優先於完整行動簽核 UI） |
| 近 3–6 月第一優先 | **通知可靠：LINE ＋ Email ＋ 瀏覽器桌面通知／彈窗** |

申請類型需涵蓋（皆常用）：

- 請假／出差／加班  
- 請購／費用報支  
- 一般簽呈／公文  
- IT／報修／權限申請  
- 其他表單（預留擴充）

## 2. 功能能力地圖（必須支援或持續強化）

### 2.1 簽核流程

- **固定層級**：申請人 → 主管 → 副總 → 總經理（可設定）  
- **條件分岔**：依金額、假別、欄位門檻多一關  
- **會簽**：同關多人皆需同意  
- **擇一簽**：同關任一人即可  
- **加簽／改派／代理**：動態調整簽核人  

實作時勿簡化掉「會簽／擇一／代理」語意；既有 `cosign`、關卡設定應延續。

#### 2.1.1 流程模組（流程 + 表單 + PDF 排版 + 最終核准通知）

- **模組**：`server/workflow-module.js`  
  DB：`workflows.pdf_layout_json`、`workflows.final_notify_json`
- **匯出／匯入**：`/api/workflows/export`、`/api/workflows/:id/export`、`/api/workflows/import`  
  格式 version **2**，`module: workflow+form+pdfLayout+finalNotify`  
  含：`formFields` + `steps` + `pdfLayout` + **`finalNotify`**（最終一步核准後是否通知選定人員）
- **finalNotify**：`enabled`、`userIds`／`users(username)`、`label`  
  最終核定通過 → **系統內通知**選定對象（表 `final_notify_receipts`），對方須點 **「確認收到通知」**（非 Email）  
  總覽／待簽核／badge 會顯示待確認筆數；信用額度建檔確認仍為獨立流程
- **不含**：系統設定、Email 帳密、使用者本體、歷史單據
- **PDF**：`server/pdf.js` 優先讀 `pdfLayout`
- **UI**：編輯流程可選 PDF 排版；可開關「最終核准完成通知」並勾選人員

### 2.2 通知（最高優先）

三通道並存，**不可互相取代**：

| 通道 | 用途 | 專案位置 |
|------|------|----------|
| Email | 正式、留底 | 簽核 `server/mail.js`；設定在執行期 `data/mail-config.json`（**一鍵包不含**） |
| LINE | 手機即時 | 獨立專案 `D:\Line 專案`；簽核以 HTTP + API Key 呼叫，**Token 不進一鍵包** |
| 桌面通知 + **中間彈窗** | 電腦開著簽核頁 | `public/js/app.js`：`notifyPendingApproval`（系統 Notification + modal + toast） |

原則：

- 手機：以 **LINE／Email** 為主（使用者「只收通知、回公司再簽」）  
- 桌面：登入中輪詢待簽核；**系統通知 + 中央彈窗**（方案 C）  
- 若其他 modal 已開啟，勿覆蓋填單；仍發系統通知 + toast  

### 2.3 權限

- 基本：一般員工／部門主管／高階主管  
- 專用：人資（假單報表）、財務／採購、IT／系統管理員  
- 需 **功能權限勾選**（非僅 admin/user 二值）；延續 `permissions` 模型  

### 2.4 文件與合規

- PDF 歸檔與下載  
- PDF 數位簽章  
- **完整稽核軌跡**（誰、何時、何動作）  
- 重要單據：**限制刪除**／保留軌跡；規劃保存年限  
- Excel 報表匯出（請假等）  

### 2.4.1 備份資料（產品功能）

| 項目 | 說明 |
|------|------|
| UI | 側欄 **備份資料**（權限 `backups`） |
| 程式 | `server/backup.js` |
| 實體 | 執行期 `data/backups/`（**Git 不提交、部署不覆蓋**） |
| 表 | `backup_files` |
| 格式 | PDF；有附件或 **AES-256 加密開啟** → ZIP |
| 加密 | 系統設定 → 備份加密；無密碼不可備份 |

### 2.5 整合優先序

1. **LINE 通知**（`D:\Line 專案`）  
2. **郵件**（MailPlus / iCloud SMTP 等，執行期設定）  
3. 中長期：**ERP／出勤／會計**  
4. 目前 **不做 AD／LDAP 為必做**（未列為優先）  
5. 部署預設 **內網**；不預設公網暴露 3847/3848  

## 3. 實作與部署約定（強制）

### 3.1 程式位置

- 主開發：`C:\Users\TsuMing\Documents\approval-system`  
- 一鍵包：`D:\一鍵安裝包` → **NAS / Ubuntu / Windows 三平台同步**  
- LINE：`D:\Line 專案`（獨立，勿把 Channel Token 打進簽核包）  
- 正式 NAS：`192.168.99.220`，HTTP `:3847`，HTTPS `:3848`  

### 3.2 每次變更後（**NAS 優先**）

1. 改本機源碼  
2. **先部署並驗證 NAS**（NAS_SKIP_DB=1，不覆寫 data）  
3. 使用者確認 OK  
4. **再**同步三平台一鍵包  
5. 更新 GitHub  

### 3.3 一鍵更新與資料保留（備份必守）

- **一律保留** `data/`：`approval.db`、`backups/`、`uploads/`、`mail-config.json`、`certs/`、`mail-outbox/`、`system-settings.json`  
- NAS：`NAS_SKIP_DB=1`；禁止用安裝包種子 DB 覆寫正式庫  
- 一鍵包：**禁止**正式 Email／LINE 密鑰、正式備份檔、正式附件  
- 見 `docs/一鍵更新說明.md` / `D:\一鍵安裝包\一鍵更新說明.md`  

### 3.4 安全

- 不在聊天或 Git 留下真實密碼；Email／LINE 密鑰僅執行期環境  
- 預設弱密碼 admin 應提示修改  
- 內網為主；外網需 HTTPS／VPN 再討論  

### 3.5 本機執行（常見缺檔）

- 埠：**8080**（`start-server.js`），非 NAS 的 3847/3848  
- 必備 server：`pdf-sign.js`、`system-settings.js`、`version.js`、`deploy-log.js`、`tw-calendar.js`（可從 NAS 或完整包拉回）  
- 必備前端：`public/js/ui-helpers.js`（`statCardHtml` / `emptyState` / `bindDataGo`）  
- 缺 `ui-helpers.js` → 總覽／我的申請／簽核紀錄 not defined  

## 4. 開發決策捷徑

| 情境 | 做法 |
|------|------|
| 加通知 | 同步考慮 Email + LINE 呼叫點 + 桌面/彈窗（待簽） |
| 加流程關卡 | 支援固定層、條件、會簽、擇一、代理之一或組合 |
| 加權限 | 優先「功能 permission」而非寫死 role |
| 加手機大功能 | 低於「通知可靠」；使用者回公司再簽 |
| 打包 | 無 SMTP／LINE secret；種子資料乾淨；**不含** `data/backups` 正式檔 |
| 改備份 | 不破壞 `data/backups` 路徑與加密行為；部署仍 `NAS_SKIP_DB=1` |

## 5. 回覆使用者時

- 使用**繁體中文**  
- 涉及部署時標明 NAS 網址與是否影響 `data/`  
- 完成功能變更時主動：同步一鍵包（若適用）＋ **推 GitHub**  

## 6. 參考

- 詳細問卷紀錄：`references/enterprise-requirements.md`  
- LINE 串接：`D:\Line 專案\docs\與簽核系統串接.md`  
- 專案總約定：倉庫根目錄 `AGENTS.md`  
