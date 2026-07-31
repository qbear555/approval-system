# 線上簽核系統 — 一鍵安裝包總覽

| 項目 | 說明 |
|------|------|
| 建置／同步 | 2026-07-24（含 HTTPS：NAS/Ubuntu 3848、Windows 8443） |
| 存放位置 | `D:\一鍵安裝包\` |
| 預設管理員 | `admin` / `admin123`（**安裝後請立刻修改密碼**） |

> **維護約定：** 之後任何程式修改，請**同時更新**本目錄下 **NAS / Ubuntu / Windows** 三個平台安裝包（勿只改單一平台）。  
> 開發 repo 約定見：`C:\Users\TsuMing\Documents\approval-system\AGENTS.md`  
> 同步腳本：`...\approval-system\scripts\sync-oneclick-packages.ps1`  
> **一鍵更新（已安裝環境）：** 見 [一鍵更新說明.md](一鍵更新說明.md) — 只更新程式、保留 `data/` 與 Email  

---

## 一、請先選平台

| 資料夾 | 適用環境 | 預設埠 | 詳細說明 |
|--------|----------|--------|----------|
| **Windows\** | Windows 10 / 11 本機或伺服器 | HTTP **8080** / HTTPS **8443** | [Windows/安裝說明.md](Windows/安裝說明.md) |
| **Ubuntu\** | Ubuntu 22.04 / 24.04（Docker 或原生 Node） | HTTP **3847** / HTTPS **3848** | [Ubuntu/安裝說明.md](Ubuntu/安裝說明.md) |
| **NAS\** | Synology DSM 7（Container Manager）等 | HTTP **3847** / HTTPS **3848** | [NAS/安裝說明.md](NAS/安裝說明.md) |
| **_共用種子資料\** | 流程 JSON、成員清單、憑證備份 | — | 見該資料夾 README |

---

## 二、各平台最快 5 步

### Windows
1. 開啟 `Windows\ApprovalSystem-Portable`（或解壓 zip）
2. 雙擊 `一鍵安裝.bat`（或資料夾內 `install.bat`）
3. 瀏覽器開 `http://127.0.0.1:8080`（HTTPS：`https://127.0.0.1:8443`，若已產生憑證）
4. 登入 `admin` / `admin123`
5. 到「系統設定」改密碼、確認公司名稱／Logo／PDF 簽章

### Ubuntu
1. 上傳 `Ubuntu\ApprovalSystem-Ubuntu-Install` 到伺服器（如 `/opt/approval-system`）
2. `chmod +x install.sh && ./install.sh`
3. 選 **1 = Docker**（建議）
4. 瀏覽器開 `http://伺服器IP:3847` 或 `https://伺服器IP:3848`
5. 登入並修改密碼

### NAS（Synology）
1. 上傳 `NAS\ApprovalSystem-NAS-Install` 到 NAS（如 `/volume1/docker/approval-system`）
2. **Container Manager** → 專案 → 新增 → 選取該資料夾的 `docker-compose.yml`
3. 建立並啟動（首次 build 需連外網）
4. 瀏覽器開 `http://NAS的IP:3847` 或 `https://NAS的IP:3848`
5. 登入並修改密碼

---

## 三、內建內容

- 7 組申請流程（請假、請購、一般簽呈、費用報支、出差、延長工時、電腦異常報修）
- 種子資料庫／成員名單（見各包內說明）
- ARGO Logo、中文字型（PDF）
- 台灣國定假日自動更新
- 系統設定種子：公司名稱、Logo、**PDF 數位簽章**（範本憑證）
- 自簽憑證（可選）：`data/certs/company-sign.p12`，密碼見 `_共用種子資料/certs/README-憑證.txt`

### 不含項目（刻意不打包）

| 項目 | 說明 |
|------|------|
| **Email／SMTP 設定** | **不包含** `data/mail-config.json`、寄件帳密、outbox 信件 |
| 正式環境簽核歷史 | 種子庫為乾淨／示範用，不含正式單據 |

Email 請於**安裝並登入後**，到 **系統設定 → Email SMTP** 自行設定（MailPlus / iCloud 等）。

---

## 四、安裝後建議檢查清單

1. 使用 **系統管理員** 登入  
2. **帳號設定** → 修改 `admin` 密碼  
3. **系統設定** → 公司名稱、Logo  
4. **系統設定** → **Email SMTP**（安裝包無預設；需通知時再設）  
5. **系統設定** → PDF 數位簽章（確認已啟用或上傳正式憑證）  
6. **成員名單** → 匯入或新增員工  
7. **簽核流程** → 確認流程步驟與簽核人  
8. 試送一筆申請並下載 PDF  

---

## 五、相關檔案

| 檔案 | 說明 |
|------|------|
| `同步紀錄-2026-07-22.txt` | 最近同步內容 |
| `_共用種子資料/certs/` | 自簽憑證與說明 |
| 各平台 `安裝說明.md` | **完整步驟（請依平台閱讀）** |
