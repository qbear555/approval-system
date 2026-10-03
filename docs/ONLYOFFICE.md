# OnlyOffice 線上編輯 Word／Excel

簽核附件（`.docx`／`.xlsx` 等）可在瀏覽器開啟編輯，儲存後**自動回寫**同一附件。

## 功能摘要

| 項目 | 說明 |
|------|------|
| 支援 | Word（doc/docx）、Excel（xls/xlsx）等 OnlyOffice 支援格式 |
| 可編輯 | 簽核中「目前步驟簽核人」、管理員；申請人於非最終關亦可編輯 |
| 唯讀 | 其他有權限查看單據者可開啟唯讀 |
| 回存 | Document Server callback → 覆寫 `data/uploads` 原檔並更新大小 |

## 啟用步驟（Docker）

1. 編輯 `.env`（參考 `env.example`）：

```env
ONLYOFFICE_ENABLED=1
ONLYOFFICE_PORT=8088
# 瀏覽器要開得了的位址（改成實際 IP）
ONLYOFFICE_DOCS_URL=http://192.168.11.116:8088
ONLYOFFICE_INTERNAL_URL=http://onlyoffice
ONLYOFFICE_APP_URL=http://approval-system:3847
ONLYOFFICE_JWT_SECRET=與JWT_SECRET相同或另設長密鑰
ONLYOFFICE_JWT_ENABLED=1
```

2. 啟動（含 OnlyOffice profile）：

```bash
cd /path/to/ApprovalSystem-Ubuntu-Install
docker compose --profile onlyoffice up -d
```

3. 首次會拉取 `onlyoffice/documentserver`（體積大、啟動約 1–2 分鐘）。

4. 確認：

- 瀏覽器開啟 `http://主機:8088` 應看到 OnlyOffice 歡迎頁  
- 簽核系統詳情 → 附件旁出現「線上編輯」

## 網路重點

Document Server **必須連得上**簽核系統（下載檔案、callback）：

- Compose 內建議：`ONLYOFFICE_APP_URL=http://approval-system:3847`
- 瀏覽器載入編輯器：`ONLYOFFICE_DOCS_URL=http://公司IP:8088`（勿填只有容器內才通的位址給使用者）

## 未啟用時

`ONLYOFFICE_ENABLED=0`（預設）時不顯示線上編輯，行為與過去相同（僅下載／再上傳）。

## 疑難排解

| 現象 | 檢查 |
|------|------|
| 無「線上編輯」按鈕 | `ONLYOFFICE_ENABLED=1` 且容器有重啟簽核系統 |
| 腳本載入失敗 | `ONLYOFFICE_DOCS_URL` 是否為瀏覽器可開的 URL |
| 開啟空白／無法儲存 | `ONLYOFFICE_APP_URL` 是否為 **OnlyOffice 容器**可連線的簽核位址；JWT 密鑰是否一致 |
| JWT 錯誤 | `ONLYOFFICE_JWT_SECRET` 與 onlyoffice 服務 `JWT_SECRET` 必須相同 |

## API

- `GET /api/onlyoffice/status` — 是否啟用  
- `GET /api/onlyoffice/editor/:attachmentId` — 編輯器設定（需登入）  
- `GET /api/onlyoffice/file/:token` — DS 下載檔  
- `POST /api/onlyoffice/callback` — DS 回存  
