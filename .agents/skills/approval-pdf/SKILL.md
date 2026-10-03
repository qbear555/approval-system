---
name: approval-pdf
description: 線上簽核系統 PDF 模板引擎、電子印鑑章與憑證簽署開發指南。包含 pdf-lib、pdf-template-engine、中文字型解析與端對端套印驗證。
---

# 線上簽核系統 — PDF 模板引擎與簽章開發指南

## 架構概述
專案支援兩種 PDF 產出方式：
1. **傳統 PDFKit 流式排版**（`server/pdf/write.js`）：自動計算表格格線、文字折行與簽核歷程章。
2. **新型 PDF-Lib 模板套印**（`server/pdf-template-engine.js`）：以既有紙本或特定格式 PDF 為底圖，在指定坐標疊加表單填寫內容與電子簽章。

## 關鍵技術依賴
- `pdf-lib` + `@pdf-lib/fontkit`：用於向量 PDF 操作與嵌入 TrueType/OpenType 中文字型。
- `pdfjs-dist`：前端或伺服器端 PDF 解析與頁面尺寸識別。
- `@signpdf/*` + `node-forge`：P12/PFX 數位憑證簽署。

## 字型優先順序
1. `fonts/Deng.ttf`（微軟等線體）
2. `fonts/kaiu.ttf`（標楷體）或系統中文字型
3. 嚴禁選用 Ext-B 擴充字型，避免產生亂碼或缺字。

## 常用測試指令
```bash
# 測試模板套印引擎單元功能
node scripts/test-pdf-template.js

# 端對端流程測試（上傳模板 -> 建立流程 -> 送單 -> 簽核 -> 匯出套印 PDF）
node scripts/test-e2e-pdf-template.js
```
