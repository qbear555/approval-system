# 專案代理／維護約定

## GitHub 同步（必做）

**每當有任何與「線上簽核系統」相關的變動**（功能、修 bug、文件、部署腳本、一鍵安裝包規則等），完成後都必須**更新 GitHub**：

| 項目 | 內容 |
|------|------|
| 倉庫 | https://github.com/qbear555/approval-system |
| 分支 | `main` |
| 本地 | `C:\Users\TsuMing\Documents\approval-system` |

### 推送原則

1. **要提交**：`server/`、`public/`、`scripts/`、`docs/`、`deploy/`、`package.json`、Docker 相關、`AGENTS.md`、一鍵更新說明等原始碼與文件  
2. **不要提交**：
   - `data/mail-config.json`、密碼、Token、`.env`
   - `node_modules/`、`.cache/`、`dist/` 大型產物
   - 正式執行期資料（uploads 附件、mail-outbox 信件、db-wal 等）
3. 流程（**NAS 優先**）：  
   改完程式 → **先部署並驗證 NAS 正式站** → **確認 OK 後**才同步 `D:\一鍵安裝包` 三平台 → **commit + push 到 GitHub**  
4. 若本機 `gh` / git 憑證不可用，使用 **GitHub MCP**（`push_files` / API）完成推送  
5. 推送後在回覆使用者時附上倉庫網址與簡短變更說明  

### LINE 專案（Grok 命名）

| 項目 | 名稱 |
|------|------|
| 中文顯示 | **LINE 通知** |
| Grok skill／指令 | **`line-notify`**（`/line-notify`） |
| 路徑 | `D:\Line 專案` |
| npm | `approval-line-notify` |

- Skill：`~/.grok/skills/line-notify/SKILL.md`  
- 與簽核 skill 分工：`/approval-system`＝簽核主系統；`/line-notify`＝LINE 服務  
- **不要**把 LINE Channel Token 寫進簽核倉庫  

---

## 變更順序（強制：NAS 為主）

> **⚠️ 2026-08 起調整：所有指令以 NAS 正式站為主，變動後同步本機與一鍵包**

### 新標準流程

1. **直接在 NAS 正式站修改**（`192.168.99.220`）  
   - 正式站：https://192.168.99.220:3848  
   - 外部網域：https://catshome.tw:3848  
   - 一律 `NAS_SKIP_DB=1`，**不覆寫**正式 `data/`、mail、LINE 密鑰  
2. **NAS 確認 OK 後**，同步程式碼到本機：  
   ```bash
   # 方式一：一鍵腳本（NAS → 本機 → 一鍵包）
   從NAS同步到本機.bat

   # 方式二：只拉程式碼
   set NAS_PASS=***
   node scripts/pull-nas-code.js
   ```
3. **重啟本機服務**使變更生效（`從NAS同步到本機.bat` 會自動執行）  
4. **同步一鍵安裝包三平台**：`scripts/sync-oneclick-packages.ps1`  
5. 視需要推 GitHub  

### 舊流程（停用）

~~本機改完 → 部署 NAS~~ ← 已不適用，改以 NAS 為主。

**禁止**：只改一鍵包未上 NAS；或未經驗證就先大量改三平台。

---

## 一鍵安裝包三平台同步（NAS 完成後必做）

在 **NAS 驗證通過後**，任何功能修改、修 bug、安全設定、Docker／啟動方式變更，都必須同步到：

| 平台 | 路徑 |
|------|------|
| **NAS** | `D:\一鍵安裝包\NAS\ApprovalSystem-NAS-Install\` |
| **Ubuntu** | `D:\一鍵安裝包\Ubuntu\ApprovalSystem-Ubuntu-Install\` |
| **Windows** | `D:\一鍵安裝包\Windows\ApprovalSystem-Portable\app\`（啟動腳本在上一層 `...\Portable\`） |

### 同步原則

1. **程式碼來源**：以**已在 NAS 驗證**的本 repo（`C:\Users\TsuMing\Documents\approval-system`）為準。
2. **必同步目錄／檔案**（若該平台有對應項）：
   - `server/`
   - `public/`
   - `package.json`、`package-lock.json`
   - `Dockerfile`、`docker-compose.yml`、`docker-entrypoint.sh`（Docker 平台）
   - 相關文件（`docs/`、各平台 `安裝說明.md`）
3. **不要覆蓋**：各平台的執行期 `data/`（資料庫、**backups 備份檔**、uploads、**正式環境** mail-config、certs 金鑰等）。  
   - 產品「備份資料」產出在 `data/backups/`，屬營運資料，**同步／部署一律保留**。  
4. **NAS 部署**：更新程式時預設 `NAS_SKIP_DB=1`，保留正式資料與備份。
5. **HTTPS**：
   - NAS / Ubuntu Docker：HTTP `3847` + HTTPS `3848`
   - Windows 便攜版／本機：HTTP `3847`（2026-08 起由 8080 改為 3847，與 NAS 一致）
6. **時區**：一律 `Asia/Taipei`。`TZ` 必須在**行程啟動前**設定才對 SQLite 生效
   （`datetime('now','localtime')` 於啟動時綁定時區，程式內改 `process.env.TZ` 無效）。
   Docker 由 `docker-compose.yml` / `Dockerfile` 設定；Windows 由各啟動 `.bat` 設定。
7. 同步後建議寫一筆 `D:\一鍵安裝包\同步紀錄-YYYY-MM-DD.txt`。

### 一鍵安裝包不含 Email 設定（必守）

- **禁止**把下列檔案打進 `D:\一鍵安裝包` 任一平台：
  - `data/mail-config.json`（SMTP 主機／帳密／寄件者）
  - `data/mail-outbox/` 內任何實際信件 JSON（僅可保留空目錄或 `.gitkeep`）
- Email **只在安裝後**由管理員於 UI「系統設定 → Email」自行設定。
- 建置種子／同步時：若來源有 `mail-config.json`，**刪除或不複製**。
- 系統設定包匯出若給安裝包用：`includeMailSecrets=0`，且不應預置 mailConfig。

### 輔助腳本

- 同步到三平台：`scripts/sync-oneclick-packages.ps1`
- 部署到 NAS：`scripts/deploy-nas-package.js`（`NAS_SKIP_DB=1`）
- 一鍵更新 NAS：`scripts/one-click-update-nas.bat` 或 `D:\一鍵安裝包\NAS\一鍵更新-從這台電腦部署到NAS.bat`
- 各平台更新腳本（在一鍵包內）：
  - NAS：`ApprovalSystem-NAS-Install/update.sh`
  - Ubuntu：`ApprovalSystem-Ubuntu-Install/update.sh`
  - Windows：`ApprovalSystem-Portable/update.bat`

## Skill

- 企業簽核功能規範 skill：.grok/skills/approval-system/SKILL.md
- 問卷紀錄：.grok/skills/approval-system/references/enterprise-requirements.md
- 全域 skill：`~/.grok/skills/approval-system/`
- 觸發：簽核功能開發、通知、流程、部署、`/approval-system`

---

## 執行任務規範：顯示進度條與即時反饋

在執行任何任務、長耗時作業、批次處理、資料同步、移轉或背景指令時，必須遵循以下進度顯示規範：

1. **圖形進度條與百分比 (Visual Progress Bar)**
   - 終端腳本或程式輸出中，必須包含圖形進度條與完成比例，例如：
     ```text
     進度：[████████████████░░░░] 80% (160/200 MB)
     ```
   - 對話回覆中若有多步驟流程，應以進度指示條呈現階段，例如：
     ```text
     進度：[████████░░░░░░░░░░] 40% (2/5 階段完成)
     - [x] 1. 連線正式環境
     - [x] 2. 打包備份資料
     - [ ] 3. 傳輸下載資料
     - [ ] 4. 驗證與鏡像比對
     - [ ] 5. 服務重啟與煙霧測試
     ```

2. **步驟標籤與即時反饋 (Step Labels & Immediate Feedback)**
   - 清楚標註總步驟數與當前步驟 `[Step X/Y]`。
   - 啟動非同步或背景作業時，主動告知當前進度與正在等待的環節，避免使用者處於無資訊等待狀態。

3. **完成總結 (Completion Summary)**
   - 任務結束時提供包含 `100% [████████████████████]` 的明確摘要清單，列出已完成項目、處理筆數及花費時間。

