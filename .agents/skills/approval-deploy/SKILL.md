---
name: approval-deploy
description: 線上簽核系統部署與三平台同步指南。嚴格遵循 AGENTS.md 規範：NAS 優先部署、三平台安裝包同步（NAS/Ubuntu/Windows）與 GitHub main 推送原則。
---

# 線上簽核系統 — 部署維運與安裝包同步指南

## 核心部署原則（強制遵循 AGENTS.md）
1. **NAS 優先原則**：
   - 任何程式碼異動，必須先部署並驗證 NAS 正式站（`192.168.99.220:3848` / `https://catshome.tw:3848`）。
   - 一律設定 `NAS_SKIP_DB=1`，嚴禁覆蓋正式機的 `data/`、密鑰、憑證與郵件日誌。
2. **驗證通過後同步三平台安裝包**：
   - NAS: `D:\一鍵安裝包\NAS\ApprovalSystem-NAS-Install\`
   - Ubuntu: `D:\一鍵安裝包\Ubuntu\ApprovalSystem-Ubuntu-Install\`
   - Windows: `D:\一鍵安裝包\Windows\ApprovalSystem-Portable\app\`
   - 執行同步腳本：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-oneclick-packages.ps1`
3. **GitHub 同步**：
   - 倉庫：`https://github.com/qbear555/approval-system` (branch: `main`)
   - 提交範圍：`server/`、`public/`、`scripts/`、`docs/`、`deploy/`、`package.json`、Docker 相關。
   - 排除項目：`.env`、密鑰、正式 DB、`uploads/`、`node_modules/`。

## 常用部署與同動腳本
```bash
# 從 NAS 同步到本機
從NAS同步到本機.bat

# 一鍵更新三平台安裝包
一鍵更新-同步一鍵包.bat
```
