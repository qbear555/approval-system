# 線上簽核系統 — 一鍵安裝包

| 項目 | 說明 |
|------|------|
| 同步 | 由開發專案 `scripts/sync-oneclick-packages.ps1` 更新 |
| 預設管理員 | `Admin`；全新庫密碼見 `data/.admin-bootstrap.txt` |
| 埠 | HTTP **3847**／NAS 與 Ubuntu HTTPS **3848** |

之後改程式請同時更新 **NAS／Ubuntu／Windows** 三平台。更新已安裝環境見 [一鍵更新說明.md](一鍵更新說明.md)，保留 `data/`。

## 平台

| 資料夾 | 環境 | 說明 |
|--------|------|------|
| Windows | Win10／11 | [Windows/安裝說明.md](Windows/安裝說明.md) |
| Ubuntu | 22.04／24.04 | [Ubuntu/安裝說明.md](Ubuntu/安裝說明.md) |
| NAS | DSM 7 Container Manager | [NAS/安裝說明.md](NAS/安裝說明.md) |

## 最快步驟

**Windows：** 開 Portable → `install.bat` → http://127.0.0.1:3847 → `Admin`

**Ubuntu：** 上傳 Install 資料夾 → `./install.sh` → `:3847` 或 `:3848`

**NAS：** 上傳到 `/volume1/docker/approval-system` → Container Manager 啟動 → `:3847`／`:3848`

## 不含

正式 Email／LINE 密鑰、正式備份、正式附件。安裝後再到系統設定填。

操作手冊：`docs/線上簽核系統_操作手冊.pptx`  
修改紀錄：倉庫 `CHANGELOG.md`
