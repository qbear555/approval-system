# 線上簽核系統

適合約 30 人規模的內部線上簽核工具，支援：

- 使用者註冊 / 登入
- 自訂簽核流程（多步驟、指定簽核人、任一/全員核准）
- **流程綁定自訂表單**（文字、多行、數字、日期、下拉、核取方塊；可設必填）
- **流程模組匯出／匯入**：表單 + 步驟 + PDF 排版 + 最終核准系統內通知（見 [docs/流程模組-最終核准通知.md](docs/流程模組-最終核准通知.md)）
- 申請送出、核准、駁回、取消
- 完整簽核歷程與表單資料留存
- 簽核完成後下載 PDF（含表單欄位；可依流程指定版面）
- 最終核准系統內通知（可限定申請人；請假可標示「設定 Email 自動回覆」）
- **PDF 數位簽章**：可上傳公司 .p12，或於系統設定**製作自簽憑證**（見 [docs/PDF數位簽章-製作說明.md](docs/PDF數位簽章-製作說明.md)）
- 新增申請：**僅一般簽呈需填主旨**；其餘表單主旨自動產生

## 技術棧

- Node.js 22+（使用內建 `node:sqlite`，無需編譯原生模組）
- Express + JWT 認證
- SQLite 資料庫（`data/approval.db`）
- PDFKit（產生 PDF，自動使用 Windows 中文字型）

## 快速開始（開發）

```powershell
cd C:\Users\username\Documents\approval-system
npm.cmd install
npm.cmd start
```

username請改為自己電腦的user名稱

瀏覽器開啟：http://localhost:3847

## Ubuntu 遷移／部署（建議）

完整步驟：**[docs/UBUNTU.md](docs/UBUNTU.md)**

```bash
# 方式 A：Docker（Ubuntu）
cd /opt/approval-system
# 先放入 data/（從 Windows 或 NAS 複製）
chmod +x scripts/ubuntu-docker-up.sh
./scripts/ubuntu-docker-up.sh

# 方式 B：原生 Node + systemd
sudo ./scripts/ubuntu-install.sh
```

Windows 打包資料庫與附件：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\export-data-bundle.ps1
```

## Synology NAS 部署（Docker）

已提供 `Dockerfile` + `docker-compose.yml`，可用 DSM **Container Manager** 一鍵建置。

完整步驟請見：**[docs/SYNOLOGY.md](docs/SYNOLOGY.md)**

```bash
# 在 NAS 上（SSH）
cd /volume1/docker/approval-system
docker compose up -d --build
# 瀏覽 http://NAS的IP:3847
```

HTTPS 使用 Let's Encrypt 正式憑證時，**DSM 續期不會自動同步到容器**，
請依 **[docs/HTTPS憑證-自動續期.md](docs/HTTPS憑證-自動續期.md)** 設定排程（腳本：`fix-cert.sh`）。

## 一鍵部署包（給其他電腦安裝）

在本機專案目錄執行：

```powershell
npm.cmd run build:installer
```

完成後會產生：

| 檔案 | 說明 |
|------|------|
| `dist/ApprovalSystem-Portable/` | 完整可攜式資料夾（含 Node.js runtime） |
| `dist/ApprovalSystem-Portable.zip` | 壓縮包，方便拷貝給其他電腦 |
| `dist/Install-ApprovalSystem.bat` | 一鍵解壓並安裝 |
| `dist/INSTALL-README.txt` | 安裝說明 |

**目標電腦操作：**

1. 複製 `Install-ApprovalSystem.bat` + `ApprovalSystem-Portable.zip` 到目標電腦  
   （或只解壓 zip 後雙擊其中的 `install.bat`）
2. 雙擊 **Install-ApprovalSystem.bat**
3. 桌面捷徑「線上簽核系統」→ 自動啟動並開啟瀏覽器
4. 預設帳號 `admin` / `admin123`

- 安裝位置：`%LOCALAPPDATA%\ApprovalSystem`
- 資料庫：`%LOCALAPPDATA%\ApprovalSystem\app\data\approval.db`（請定期備份）
- 目標電腦**不必**事先安裝 Node.js（已內建可攜式 runtime）

### 預設管理員

| 項目 | 值 |
|------|-----|
| 帳號 | `admin` |
| 密碼 | `admin123` |

**請登入後立即到「帳號設定」修改密碼。**

## 使用流程建議

1. 由管理員在 **成員名單** 建立帳號（不開放自行註冊）
2. 管理員或任何使用者到 **簽核流程** 建立模板（例如：請假、請購）
3. 在流程中設定步驟順序與簽核人
4. 到 **新增申請** 選擇流程、填寫主旨與內容後送出
5. 簽核人在 **待我簽核** 進行核准或駁回
6. 狀態變為「已核准」後，可在詳情頁 **下載 PDF**

## 環境變數（選用）

| 變數 | 說明 | 預設 |
|------|------|------|
| `PORT` | 服務埠號 | `3847` |
| `JWT_SECRET` | JWT 簽章密鑰 | 未設或為弱預設時自動寫入 `data/.jwt-secret` |

PowerShell 範例：

```powershell
$env:PORT=4000
# 選用；未設定時會寫入 data/.jwt-secret 並沿用
$env:JWT_SECRET = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
npm.cmd start
```

## 目錄結構

```
approval-system/
├── server/
│   ├── index.js      # API 與靜態檔服務
│   ├── db.js         # SQLite schema
│   ├── auth.js       # 密碼 / JWT
│   ├── pdf.js        # PDF 產生
│   └── seed.js       # 手動初始化管理員
├── public/           # 前端 UI
├── data/             # 資料庫（自動產生）
├── package.json
└── README.md
```

## 注意事項

- 資料庫為本機 SQLite，請定期備份 `data/approval.db`
- 使用者上限約 50 人（管理員建立時檢查），設計目標約 30 人
- 若 PDF 中文顯示異常，請確認系統有安裝「微軟正黑體 / 微軟雅黑」等字型
- 正式環境建議自行設定夠長的 `JWT_SECRET`；未設定時請確認 `data/.jwt-secret` 已產生且不要提交到 git
