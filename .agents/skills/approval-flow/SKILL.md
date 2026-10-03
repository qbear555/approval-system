---
name: approval-flow
description: 線上簽核系統工作流引擎、關卡條件分支、會簽/並簽與動態表單 Schema 開發指南。
---

# 線上簽核系統 — 工作流引擎與動態表單開發指南

## 架構概述
系統流程引擎負責單據關卡審批、條件跳關、會簽/串簽控制：
- 流程定義存在 `workflows` 表（含 `steps_json`、`form_fields_json`、`flow_json`）。
- 單據送出時會在 `approval_requests` 建立快照（`steps_snapshot_json`），鎖定簽核當下的關卡與簽核人，避免後續修改流程影響舊單。

## 關鍵檔案
- `server/flow-engine.js`：流程執行與推進核心。
- `server/flow-graph.js`：有向圖結構驗證、節點分支與拓撲解析。
- `server/routes/actions.js`：簽核動作（核准、駁回、加簽、轉簽、退回、系統自動跳關）。
- `public/js/flow-editor.js`：前端視覺化流程編輯器。

## 條件分支支援語法
- `action: require`：當條件不符合時跳過該關卡。
- `action: skip`：當條件符合時跳過該關卡。
- 支援運算子：`>`、`<`、`>=`、`<=`、`==`、`!=`、`contains`，可針對動態表單數值（如請購金額、請假天數）做智慧跳關。

## 常用測試指令
```bash
# 測試流程引擎條件式分支與回歸
node scripts/test-flow-engine.js
```
