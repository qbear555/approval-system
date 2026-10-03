---
name: approval-db
description: 線上簽核系統 MySQL / MariaDB 資料庫適配層與方言維護指南。包含 db-adapter 模組、Worker 同步包裝、SQL 轉譯、交易與 NAS 連線配置。
---

# 線上簽核系統 — 資料庫 (MySQL / MariaDB) 開發與維護指南

## 架構概述
本專案現已全面改用 **MariaDB / MySQL**（已移除 SQLite 適配層）。
為了兼顧上層歷史代碼中大量使用的同步 API（`db.prepare().get() / .all() / .run()`），專案設計了基於 `worker_threads` + `SharedArrayBuffer` / `Atomics` 的同步轉非同步適配層。

## 關鍵檔案結構
- `server/db.js`：資料庫連線進入點，引用 `server/db-adapter`。
- `server/db-adapter/index.js`：工廠函式 `createDatabase()`，初始化連線並執行 `applySchema()`。
- `server/db-adapter/mysql.js`：主執行緒適配層，包裝為 `prepare()` 語法，自動載入 `.env`。
- `server/db-adapter/mysql-worker.js`：Worker 執行緒，負責透過 `mysql2/promise` 連線資料庫並執行查詢。
- `server/db-adapter/dialect.js`：SQL 方言轉譯（SQLite 函數轉換為 MySQL 函數、保留字反引號處理、LIKE ESCAPE 轉譯）。
- `server/db-adapter/schema.js`：資料表結構定義與遷移腳本（DDL）。

## 常用指令與驗證
```bash
# 測試資料庫方言轉譯
node scripts/test-db-adapter.js

# 煙霧測試
node scripts/smoke.js
```

## 注意事項
1. **時區處理**：伺服器與資料庫皆設定為 `Asia/Taipei`（UTC+8）。
2. **連線設定**：優先讀取 `.env` 內的 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。
3. **LIKE 跳脫**：若使用 `LIKE ? ESCAPE '\\'`，需注意 `dialect.js` 需自動轉譯為 MySQL 相容的 4 個反斜線。
