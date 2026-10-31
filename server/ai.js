/**
 * 線上簽核系統 — AI 智慧輔助模組
 * 支援本機 Ollama 與 OpenAI 相容 API 協定
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const systemSettings = require('./system-settings');
const { getRequestDetail } = require('./runtime');
const db = require('./db');

/**
 * 取得當前 AI 設定
 */
function getAiConfig() {
  let ai = {};
  try {
    if (systemSettings.getAiInternalConfig) {
      ai = systemSettings.getAiInternalConfig();
    } else if (systemSettings.getAdminSettings) {
      ai = systemSettings.getAdminSettings().ai || {};
    }
  } catch {
    ai = {};
  }
  return {
    enabled: ai.enabled !== false,
    baseUrl: String(ai.baseUrl || process.env.AI_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    model: String(ai.model || process.env.AI_MODEL || 'qwen2.5:7b').trim(),
    provider: String(ai.provider || 'ollama').trim(),
    apiKey: String(ai.apiKey || process.env.AI_API_KEY || '').trim(),
    temperature: typeof ai.temperature === 'number' ? ai.temperature : 0.2,
  };
}

/**
 * 測試連線與取得可用模型
 */
async function checkAiHealth() {
  const config = getAiConfig();
  const parsed = url.parse(config.baseUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    const isOllama = config.provider === 'ollama';
    const checkPath = isOllama ? '/api/tags' : '/v1/models';

    const req = transport.request(
      {
        hostname: parsed.hostname || '127.0.0.1',
        port: parsed.port || (isHttps ? 443 : 11434),
        path: checkPath,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        timeout: 4000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              let models = [];
              if (Array.isArray(json.models)) {
                models = json.models.map((m) => m.name || m.model || String(m));
              } else if (Array.isArray(json.data)) {
                models = json.data.map((m) => m.id || String(m));
              }
              resolve({
                ok: true,
                provider: config.provider,
                baseUrl: config.baseUrl,
                currentModel: config.model,
                models,
              });
            } catch (err) {
              resolve({ ok: false, error: `回傳格式解析失敗: ${err.message}` });
            }
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}: ${data.slice(0, 100)}` });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({ ok: false, error: `無法連線至 AI 服務 (${config.baseUrl}): ${err.message}` });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: `AI 服務連線逾時 (${config.baseUrl})` });
    });
    req.end();
  });
}

/**
 * 發送 Chat 完成請求
 */
async function sendChatRequest({ messages, temperature = 0.2, maxTokens = 1200 }) {
  const config = getAiConfig();
  const parsed = url.parse(config.baseUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const isOllama = config.provider === 'ollama';
  const reqPath = isOllama ? '/api/chat' : '/v1/chat/completions';

  // 格式化多模態訊息（支援 Ollama 與 OpenAI 相容 API）
  const formattedMessages = messages.map((m) => {
    const rawImages = Array.isArray(m.images) ? m.images : [];
    if (!rawImages.length) return m;

    if (isOllama) {
      return {
        role: m.role || 'user',
        content: m.content || '',
        images: rawImages.map((img) =>
          String(img).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
        ),
      };
    } else {
      const contentParts = [{ type: 'text', text: m.content || '' }];
      rawImages.forEach((img) => {
        const fullUrl = String(img).startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
        contentParts.push({ type: 'image_url', image_url: { url: fullUrl } });
      });
      return {
        role: m.role || 'user',
        content: contentParts,
      };
    }
  });

  const bodyData = isOllama
    ? JSON.stringify({
        model: config.model,
        messages: formattedMessages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      })
    : JSON.stringify({
        model: config.model,
        messages: formattedMessages,
        temperature,
        max_tokens: maxTokens,
      });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = transport.request(
      {
        hostname: parsed.hostname || '127.0.0.1',
        port: parsed.port || (isHttps ? 443 : 11434),
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyData),
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        timeout: 45000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const durationMs = Date.now() - startTime;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              let content = '';
              if (json.message?.content) {
                content = json.message.content;
              } else if (json.choices?.[0]?.message?.content) {
                content = json.choices[0].message.content;
              } else {
                content = JSON.stringify(json);
              }
              resolve({
                content: content.trim(),
                model: json.model || config.model,
                durationMs,
                evalCount: json.eval_count || 0,
              });
            } catch (err) {
              reject(new Error(`AI 回應解析失敗: ${err.message}`));
            }
          } else {
            reject(new Error(`AI 服務回傳 HTTP ${res.statusCode}: ${data.slice(0, 150)}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      let msg = err.message;
      if (err.code === 'ECONNREFUSED') {
        msg = `無法連線至 AI 服務 (${config.baseUrl})。若在 NAS 正式環境，請確認「系統設定」中的 AI 服務端點是否指向運行模型之主機（如本機 PC IP 或 NAS 本地 Ollama 容器）。`;
      }
      reject(new Error(`AI 服務請求失敗: ${msg}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI 運算逾時，請確認模型載入狀況或稍後重試。'));
    });

    req.write(bodyData);
    req.end();
  });
}

/**
 * 比對資料庫歷史單據，檢測重複發票報銷、同額重複請款與採購比價雷達
 */
function detectHistoricalRisks(detail) {
  const currentId = Number(detail.id);
  const formData = detail.form_data || {};
  const requesterId = Number(detail.requester_id);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  // 1. 抓取本次申請中的所有發票／統一發票號碼
  const currentInvoices = new Set();
  const rawJson = JSON.stringify(formData);
  const invRegex = /[A-Z]{2}-?[0-9]{8}/gi;
  let match;
  while ((match = invRegex.exec(rawJson)) !== null) {
    currentInvoices.add(match[0].replace('-', '').toUpperCase());
  }

  // 2. 抓取本次申請中的品項與單價
  const currentItems = [];
  for (const [k, v] of Object.entries(formData)) {
    if (Array.isArray(v)) {
      v.forEach((row) => {
        if (typeof row === 'object' && row !== null) {
          const name = row.name || row.item_name || row.item || row['品名'] || row['項目'];
          const price = parseFloat(row.price || row.unit_price || row['單價'] || row.amount || row['金額']);
          const qty = parseFloat(row.qty || row.quantity || row['數量'] || 1);
          if (name && !isNaN(price) && price > 0) {
            currentItems.push({ name: String(name).trim(), unitPrice: price, qty: qty || 1 });
          }
        }
      });
    } else if (k === 'item_name' || k === 'itemName') {
      const price = parseFloat(formData.amount || formData.unit_price || formData.price || 0);
      if (price > 0) {
        currentItems.push({ name: String(v).trim(), unitPrice: price, qty: parseFloat(formData.qty) || 1 });
      }
    }
  }

  const currentAmount = parseFloat(formData.amount || formData.total_amount || formData['總額'] || formData['金額'] || 0);

  // 3. 查詢歷史 90 天內之有效/核准案件
  let pastRequests = [];
  try {
    pastRequests = db
      .prepare(
        "SELECT id, title, form_data, requester_id, status, created_at FROM approval_requests WHERE id != ? AND status IN ('approved', 'in_progress', 'completed') AND created_at >= ? ORDER BY id DESC LIMIT 150"
      )
      .all(currentId, ninetyDaysAgo);
  } catch (e) {
    console.warn('[AI] detectHistoricalRisks DB query warning:', e.message);
  }

  const duplicateInvoices = [];
  const suspectedDuplicateRequests = [];
  const historicalItemPrices = {};

  pastRequests.forEach((past) => {
    let pData = {};
    try {
      pData = typeof past.form_data === 'string' ? JSON.parse(past.form_data) : past.form_data || {};
    } catch {}

    const pJson = JSON.stringify(pData);

    // 發票重複性比對
    if (currentInvoices.size > 0) {
      let pMatch;
      const pInvRegex = /[A-Z]{2}-?[0-9]{8}/gi;
      while ((pMatch = pInvRegex.exec(pJson)) !== null) {
        const inv = pMatch[0].replace('-', '').toUpperCase();
        if (currentInvoices.has(inv)) {
          duplicateInvoices.push({
            invoiceNo: inv,
            historicalRequestId: past.id,
            title: past.title,
            createdAt: past.created_at,
            status: past.status,
          });
        }
      }
    }

    // 同人同額度短天期申請比對（同申請人 90 天內金額相同且超過 500 元）
    if (Number(past.requester_id) === requesterId && currentAmount > 500) {
      const pastAmt = parseFloat(pData.amount || pData.total_amount || pData['總額'] || pData['金額'] || 0);
      if (pastAmt === currentAmount) {
        suspectedDuplicateRequests.push({
          historicalRequestId: past.id,
          title: past.title,
          amount: pastAmt,
          createdAt: past.created_at,
        });
      }
    }

    // 歷史品項價格統計
    for (const [k, v] of Object.entries(pData)) {
      if (Array.isArray(v)) {
        v.forEach((row) => {
          if (typeof row === 'object' && row !== null) {
            const name = String(row.name || row.item_name || row.item || row['品名'] || row['項目'] || '').trim().toLowerCase();
            const price = parseFloat(row.price || row.unit_price || row['單價'] || 0);
            if (name && price > 0) {
              if (!historicalItemPrices[name]) historicalItemPrices[name] = [];
              historicalItemPrices[name].push(price);
            }
          }
        });
      }
    }
  });

  // 比價雷達
  const priceRadar = [];
  currentItems.forEach((ci) => {
    const key = ci.name.toLowerCase();
    const history = historicalItemPrices[key];
    if (history && history.length > 0) {
      const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
      const min = Math.min(...history);
      const max = Math.max(...history);
      const diffPercent = Math.round(((ci.unitPrice - avg) / avg) * 100);
      priceRadar.push({
        itemName: ci.name,
        currentUnitPrice: ci.unitPrice,
        avgHistoricalPrice: avg,
        minPrice: min,
        maxPrice: max,
        diffPercent,
        count: history.length,
      });
    }
  });

  return {
    duplicateInvoices,
    suspectedDuplicateRequests,
    priceRadar,
  };
}

/**
 * 依申請單詳情組成專業審核摘要 Prompt
 */
function buildAuditPrompt(detail, historicalRisks = {}) {
  const fieldsMap = {};
  if (Array.isArray(detail.formFields)) {
    for (const f of detail.formFields) {
      if (f && f.id) fieldsMap[f.id] = f.label || f.name || f.id;
    }
  }

  // 整理表單欄位名值對
  const formDataList = [];
  const rawData = detail.form_data || {};
  for (const [key, val] of Object.entries(rawData)) {
    if (val === undefined || val === null || val === '') continue;
    // 忽略部分技術性內部欄位
    if (/^(users_pick_|cosign_|__)/.test(key) && val === 'skip') continue;
    const label = fieldsMap[key] || key;
    let displayVal = val;
    if (typeof val === 'object') {
      try {
        displayVal = JSON.stringify(val);
      } catch {
        displayVal = String(val);
      }
    }
    formDataList.push(`- **${label}**: ${displayVal}`);
  }

  // 整理簽核歷史
  const actionHistory = [];
  if (Array.isArray(detail.actions)) {
    for (const a of detail.actions) {
      const actor = a.actor_name || a.actor_username || '系統';
      const actionType = a.action_type || a.action || '簽核';
      const comment = a.comment ? `（備註/意見: ${a.comment}）` : '';
      const time = a.created_at || '';
      actionHistory.push(`- ${time} [${actionType}] 由 ${actor} 操作 ${comment}`);
    }
  }

  // 整理附件清單
  let attachments = [];
  try {
    attachments = db
      .prepare('SELECT id, original_name, size_bytes FROM request_attachments WHERE request_id = ?')
      .all(detail.id);
  } catch {
    attachments = detail.attachments || [];
  }

  const attList = attachments.map(
    (a) => `- 📎 ${a.original_name || a.filename || '附件'} (${Math.round((a.size_bytes || 0) / 1024)} KB)`
  );

  const dupInvoices = historicalRisks.duplicateInvoices || [];
  const dupReqs = historicalRisks.suspectedDuplicateRequests || [];
  const pRadar = historicalRisks.priceRadar || [];

  const promptText = `
你是一位具備 15 年以上大型企業行政稽核與主管簽核經驗的「企業智慧簽核專家」。
請針對下列申請單據的完整內容，結合系統歷史比對數據進行深度專業審核，並以「專業、客觀、俐落」的繁體中文 Markdown 格式提供主管審核摘要與風險檢核：

【單據基本資訊】
- 單號：#${detail.id}
- 流程種類：${detail.workflow_name || '一般申請'}
- 單據主旨：${detail.title || '（無主旨）'}
- 申請人：${detail.requester_name || '—'}（所屬部門：${detail.requester_dept || '未指定'}）
- 目前狀態：${detail.status}
- 申請時間：${detail.created_at || '—'}

【表單詳細填寫資料】
${formDataList.length ? formDataList.join('\n') : '（無額外表單欄位）'}

【附件清單】
${attList.length ? attList.join('\n') : '（無上傳附件）'}

【簽核紀錄與過往意見】
${actionHistory.length ? actionHistory.join('\n') : '（尚未有簽核動作）'}

【📊 歷史大數據比對與風險稽核雷達】
- 發票重複查核：${dupInvoices.length > 0 ? `⚠️ 警告！發現 ${dupInvoices.length} 筆相同發票號碼已被歷史單據使用：\n` + dupInvoices.map(d => `  * 發票號 ${d.invoiceNo} 曾出現在 #${d.historicalRequestId}「${d.title}」（狀態: ${d.status}）`).join('\n') : '✅ 通過（歷史資料庫中無相同發票號碼記錄）'}
- 同額同人重複比對：${dupReqs.length > 0 ? `⚠️ 留意！同申請人近 90 天內有 ${dupReqs.length} 筆相同金額之案件：\n` + dupReqs.map(s => `  * #${s.historicalRequestId}「${s.title}」`).join('\n') : '✅ 通過（無高度雷同重複請款）'}
- 歷史採購比價雷達：${pRadar.length > 0 ? '\n' + pRadar.map(p => `  * 【${p.itemName}】本次單價 NT$${p.currentUnitPrice} vs 歷史均價 NT$${p.avgHistoricalPrice}（差異: ${p.diffPercent > 0 ? '+' : ''}${p.diffPercent}%，歷史比對樣本 ${p.count} 筆）`).join('\n') : '（本次無符合歷史採購庫存明細之項目）'}

----------------------------
請嚴格依照以下四個維度進行分析輸出，勿回答無關內容：

### 📌【案件速覽】
用 2~3 點扼要點出核心事實：誰因何事由申請、金額或天數期程、預計達成之業務目的。

### 🔍【合規與防呆檢核】
- **資料齊全度**：重要欄位與必要憑證附件是否齊全？
- **合理性與邏輯**：金額、計算方式、申請時間區間是否合理或有無矛盾？
- **歷史雷達比對結果**：綜合發票重複性、比價雷達等數據給出稽核結論。
- **風險評估等級**：評定此案件風險程度（請以「🟢 低風險 / 正常合規」、「🟡 中風險 / 需留意細節」、「🔴 高風險 / 疑似異常」標註，並簡述關鍵原因）。

### 💡【簽核主管審查建議】
具體向簽核人提出核准、補件或確認方向建議（例如：若為低風險可放心核准；若缺憑證建議請同仁補充何種說明或單據）。

### 🏷️【指標摘要】
請在結尾獨立輸出這三行元數據供系統解析（冒號後嚴格填寫）：
RISK_LEVEL: [LOW / MEDIUM / HIGH 擇一]
RISK_SCORE: [0到100之整數，越高表示風險越大]
RISK_BADGES: [以逗號分隔2至4個簡要標籤，例如：發票唯一性核驗通過, 單價合理, 附件齊全]
`;

  return promptText;
}

/**
 * 對指定簽核單據進行 AI 審查分析（結合歷史大數據風險比對）
 */
async function analyzeRequest(requestId, user) {
  const detail = getRequestDetail(Number(requestId));
  if (!detail) {
    throw new Error('找不到指定的簽核單據');
  }

  // 1. 執行歷史大數據多維比對
  const historicalRisks = detectHistoricalRisks(detail);

  // 2. 組裝 Prompt
  const prompt = buildAuditPrompt(detail, historicalRisks);
  const messages = [
    {
      role: 'system',
      content:
        '你是企業簽核系統專用的智慧稽核與主管輔助分析 AI。請一律使用繁體中文（台灣習慣用語），保持專業、嚴謹、條理分明與條列式排版。',
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  const result = await sendChatRequest({ messages, temperature: 0.2, maxTokens: 1400 });
  const rawContent = result.content || '';

  // 3. 解析風險指標
  let riskLevel = 'low';
  let riskScore = 15;
  let riskBadges = ['單據填寫合規', '無重複報銷'];

  const levelMatch = /RISK_LEVEL:\s*(LOW|MEDIUM|HIGH)/i.exec(rawContent);
  if (levelMatch) {
    riskLevel = levelMatch[1].toLowerCase();
  }

  const scoreMatch = /RISK_SCORE:\s*(\d+)/i.exec(rawContent);
  if (scoreMatch) {
    riskScore = Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10)));
  }

  const badgesMatch = /RISK_BADGES:\s*([^\r\n]+)/i.exec(rawContent);
  if (badgesMatch) {
    const list = badgesMatch[1].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) riskBadges = list;
  }

  // 強制規則防護：若確有重複發票，直接拔高為 high
  if (historicalRisks.duplicateInvoices && historicalRisks.duplicateInvoices.length > 0) {
    riskLevel = 'high';
    riskScore = Math.max(riskScore, 85);
    if (!riskBadges.some((b) => b.includes('重複發票'))) {
      riskBadges.unshift('⚠️ 檢出重複發票');
    }
  } else if (historicalRisks.priceRadar && historicalRisks.priceRadar.some((p) => p.diffPercent > 30)) {
    if (riskLevel === 'low') riskLevel = 'medium';
    riskScore = Math.max(riskScore, 55);
    if (!riskBadges.some((b) => b.includes('偏高'))) {
      riskBadges.unshift('單價高於歷史均價');
    }
  }

  // 清除末尾的技術性指標標籤，保持呈現的美觀整潔
  const cleanAnalysis = rawContent.replace(/###\s*🏷️【指標摘要】[\s\S]*$/i, '').trim();

  return {
    requestId: detail.id,
    title: detail.title,
    riskLevel,
    riskScore,
    riskBadges,
    priceRadar: historicalRisks.priceRadar || [],
    duplicateInvoices: historicalRisks.duplicateInvoices || [],
    suspectedDuplicateRequests: historicalRisks.suspectedDuplicateRequests || [],
    analysis: cleanAnalysis,
    report: cleanAnalysis,
    model: result.model,
    durationMs: result.durationMs,
    durationSec: Number((result.durationMs / 1000).toFixed(1)),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 安全解析 AI 回傳之 JSON 字串（容錯去除 Markdown 程式碼標記）
 */
function parseJsonResponse(rawContent) {
  if (!rawContent) return null;
  let str = String(rawContent).trim();
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(str);
  } catch {
    const firstBrace = str.indexOf('{');
    const firstBracket = str.indexOf('[');
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = str.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = str.lastIndexOf(']');
    }
    if (start !== -1 && end > start) {
      const sub = str.slice(start, end + 1);
      try {
        return JSON.parse(sub);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * 智慧掃描紙本表單／PDF，產出結構化欄位定義與畫布排版
 */
async function scanFormLayout({ imageBase64, textItems = [], width = 595, height = 842, page = 1 }) {
  let textSummary = '';
  if (Array.isArray(textItems) && textItems.length > 0) {
    const lines = textItems
      .slice(0, 150)
      .map((t) => `"${t.text}" @ (${t.x}, ${t.y}) w:${t.w} h:${t.h}`)
      .join('\n');
    textSummary = `\n文件內文字項目與座標清單（畫布解析度 ${width}x${height}）：\n${lines}\n`;
  }

  const prompt = `你是企業電子簽核與表單排版專家。請分析這份表單影像及文字結構，將其轉換為標準簽核表單 Schema 與畫布排版座標。

${textSummary}
請遵守以下規則：
1. 辨識表單標題（如：請假申請單、出差旅費報支單、請購申請單等）。
2. 辨識表單類別（如：人事考勤、財務報銷、採購請款、總務行政、一般簽呈）。
3. 提取所有使用者填寫欄位（請為每個欄位指派合適的英文ID、中文名稱與型別：text / textarea / number / date / select / checkbox / signature）。
4. 自動估算各欄位在頁面中的相對座標（rx, ry, rw, rh，皆為 0.0 到 1.0 之間的數值比例，例如 rx: 0.15, ry: 0.20, rw: 0.25, rh: 0.04）。
5. 辨識是否有簽核欄位（如：申請人、單位主管、會簽單位、總經理簽章），並標記為 type: "signature"。

請嚴格僅輸出合法 JSON，格式如下：
{
  "workflowName": "表單名稱",
  "category": "分類名稱",
  "description": "流程說明",
  "fields": [
    {
      "id": "欄位ID",
      "name": "中文名稱",
      "type": "text|textarea|number|date|select|checkbox|signature",
      "rx": 0.15,
      "ry": 0.2,
      "rw": 0.25,
      "rh": 0.04,
      "required": true,
      "options": []
    }
  ]
}`;

  const userMsg = {
    role: 'user',
    content: prompt,
  };
  if (imageBase64) {
    userMsg.images = [imageBase64];
  }

  const messages = [
    {
      role: 'system',
      content:
        '你是一位極度嚴謹的企業表單設計專家。請一律使用繁體中文，且只輸出合法標準 JSON 物件，不要有任何多餘的解釋或問候。',
    },
    userMsg,
  ];

  const result = await sendChatRequest({ messages, temperature: 0.1, maxTokens: 1800 });
  const parsed = parseJsonResponse(result.content);

  if (!parsed || !Array.isArray(parsed.fields)) {
    throw new Error('AI 未能產生有效的表單排版結構，請重試或使用畫布設計器手動調整。');
  }

  const sanitizedFields = parsed.fields.map((f, idx) => {
    const rx = Math.max(0.01, Math.min(0.95, Number(f.rx) || 0.1 + (idx % 3) * 0.28));
    const ry = Math.max(0.01, Math.min(0.95, Number(f.ry) || 0.1 + Math.floor(idx / 3) * 0.06));
    const rw = Math.max(0.04, Math.min(0.9, Number(f.rw) || 0.25));
    const rh = Math.max(0.02, Math.min(0.5, Number(f.rh) || (f.type === 'textarea' ? 0.08 : 0.04)));
    return {
      id: f.id || `f_${idx + 1}`,
      name: f.name || f.label || `欄位 ${idx + 1}`,
      type: f.type || 'text',
      rx: Number(rx.toFixed(3)),
      ry: Number(ry.toFixed(3)),
      rw: Number(rw.toFixed(3)),
      rh: Number(rh.toFixed(3)),
      required: !!f.required,
      options: Array.isArray(f.options) ? f.options : [],
      page,
    };
  });

  const formFields = sanitizedFields
    .filter((f) => f.type !== 'signature')
    .map((f) => ({
      id: f.id,
      label: f.name,
      type: f.type,
      required: f.required,
      options: f.options,
    }));

  const canvasObjects = sanitizedFields.map((f, idx) => {
    if (f.type === 'signature') {
      return {
        id: `obj_sig_${idx + 1}`,
        kind: 'signature',
        badge: f.name,
        role: f.id,
        rx: f.rx,
        ry: f.ry,
        rw: f.rw,
        rh: f.rh,
      };
    }
    return {
      id: `obj_fld_${idx + 1}`,
      kind: 'field',
      fieldId: f.id,
      name: f.name,
      fieldType: f.type,
      required: f.required,
      rx: f.rx,
      ry: f.ry,
      rw: f.rw,
      rh: f.rh,
    };
  });

  return {
    success: true,
    workflowName: parsed.workflowName || '紙本掃描簽核表單',
    category: parsed.category || '一般簽呈',
    description: parsed.description || '由紙本表單經 AI 智慧辨識自動生成',
    fields: sanitizedFields,
    formFields,
    canvasObjects,
    durationMs: result.durationMs,
  };
}

/**
 * 智慧辨識電子發票／收據／支出憑證，提取品項與金額明細
 */
async function parseInvoiceOrReceipt({ imageBase64, textContent = '', columns = [] }) {
  let colHint = '';
  if (Array.isArray(columns) && columns.length > 0) {
    colHint = `\n目標表格欄位定義（請盡量對齊此結構）：\n${JSON.stringify(columns, null, 2)}\n`;
  }

  const prompt = `你是專業財務會計與發票憑證 OCR 辨識專家。請分析這張發票或收據憑證，準確提取各項金額、統編與消費品項明細。
${textContent ? `憑證文字內容：\n${textContent}\n` : ''}
${colHint}
請嚴格僅輸出合法 JSON，格式如下：
{
  "invoiceNo": "發票號碼（例如：AB-12345678）或憑證號碼",
  "date": "開立日期（YYYY-MM-DD，若年份為民國請轉為西元）",
  "sellerTaxId": "賣方統一編號（8位數字）或留空",
  "sellerName": "店家或公司名稱",
  "buyerTaxId": "買方統一編號（8位數字，若有）",
  "items": [
    {
      "item": "品名或消費項目",
      "spec": "規格或說明（無則留空）",
      "qty": 數量（數值，預設 1）,
      "price": 單價（數值）,
      "amount": 小計金額（數值）,
      "note": "備註"
    }
  ],
  "subtotal": 未稅銷售額（數值）,
  "tax": 營業稅額（數值）,
  "total": 總計金額（數值）
}`;

  const userMsg = {
    role: 'user',
    content: prompt,
  };
  if (imageBase64) {
    userMsg.images = [imageBase64];
  }

  const messages = [
    {
      role: 'system',
      content:
        '你是財務專用憑證辨識專家。請一律使用繁體中文，數值一律轉為純數字（不含千分逗號或貨幣符號），只輸出合法 JSON，不要有任何多餘文字。',
    },
    userMsg,
  ];

  const result = await sendChatRequest({ messages, temperature: 0.1, maxTokens: 1600 });
  const parsed = parseJsonResponse(result.content);

  if (!parsed) {
    throw new Error('AI 未能成功解析發票或憑證內容，請確認圖檔清晰度或手動輸入。');
  }

  const rawItems = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : [
        {
          item: parsed.sellerName ? `${parsed.sellerName} 消費款` : '費用項目',
          spec: parsed.invoiceNo || '',
          qty: 1,
          price: Number(parsed.total) || 0,
          amount: Number(parsed.total) || 0,
        },
      ];

  const mappedRows = rawItems.map((it) => {
    const row = {};
    const qty = Number(it.qty) || 1;
    const price = Number(it.price) || Number(it.amount) || 0;
    const amount = Number(it.amount) || qty * price;

    if (Array.isArray(columns) && columns.length > 0) {
      columns.forEach((col) => {
        const cid = col.id;
        const cl = String(col.label || '').toLowerCase();
        if (/item|品名|項目|名稱/i.test(cid) || /品名|項目|名稱/.test(cl)) {
          row[cid] = it.item || '';
        } else if (/spec|規格|型號|說明/i.test(cid) || /規格|說明/.test(cl)) {
          row[cid] = it.spec || '';
        } else if (/qty|數量|count/i.test(cid) || /數量/.test(cl)) {
          row[cid] = qty;
        } else if (/price|單價|unit/i.test(cid) || /單價/.test(cl)) {
          row[cid] = price;
        } else if (/amount|小計|總額|金額|total/i.test(cid) || /小計|金額/.test(cl)) {
          row[cid] = amount;
        } else if (/date|日期/i.test(cid) || /日期/.test(cl)) {
          row[cid] = parsed.date || '';
        } else if (/note|備註/i.test(cid) || /備註/.test(cl)) {
          row[cid] = it.note || (parsed.invoiceNo ? `發票: ${parsed.invoiceNo}` : '');
        } else {
          row[cid] = '';
        }
      });
    } else {
      row.item = it.item || '費用支出';
      row.spec = it.spec || '';
      row.qty = qty;
      row.price = price;
      row.amount = amount;
      row.note = it.note || (parsed.invoiceNo ? `發票: ${parsed.invoiceNo}` : '');
    }
    return row;
  });

  return {
    success: true,
    invoiceNo: parsed.invoiceNo || '',
    date: parsed.date || '',
    sellerTaxId: parsed.sellerTaxId || '',
    sellerName: parsed.sellerName || '',
    buyerTaxId: parsed.buyerTaxId || '',
    subtotal: Number(parsed.subtotal) || Number(parsed.total) || 0,
    tax: Number(parsed.tax) || 0,
    total: Number(parsed.total) || 0,
    items: rawItems,
    rows: mappedRows,
    durationMs: result.durationMs,
  };
}

/**
 * 申請事由與公文簽呈一鍵 AI 潤飾擴充
 */
async function polishApplicationText({ text, style = 'formal', workflowName = '', category = '' }) {
  if (!text || !String(text).trim()) {
    throw new Error('請先輸入欲潤飾的事由或草稿文字。');
  }

  let styleDesc = '正式企業公文簽呈格式（包含【主旨】、【說明】（背景原由、執行方案與預期效益、預算評估），並以「請核示」結尾）';
  if (style === 'bullet') {
    styleDesc = '條列式重點（清晰條列 1、2、3 點，語氣簡潔具體，突顯核心關鍵）';
  } else if (style === 'concise') {
    styleDesc = '精煉摘要（30 至 60 字以內的精準說明，去蕪存菁）';
  }

  const prompt = `你是企業高階幕僚與公文寫作專家。請將申請人提供的簡短事由草稿，潤飾改寫為更專業、得體且邏輯嚴謹的內容。

【申請表單】：${workflowName || '一般簽核申請'}
【表單分類】：${category || '一般簽呈'}
【潤飾風格】：${styleDesc}
【原始草稿】：
${text}

請注意：
1. 一律使用繁體中文（台灣商務習慣用語）。
2. 保留原意與核心數字，不得捏造不存在的事實。
3. 直接輸出潤飾後的公文內容，不要附加任何「好的、以下是為您潤飾的內容」等無關前言或問候語。`;

  const messages = [
    {
      role: 'system',
      content:
        '你是企業高階公文寫作專家。請直接回傳潤飾改寫後的文字內容，排版條理分明，不要包含任何開場白或結語。',
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  const result = await sendChatRequest({ messages, temperature: 0.3, maxTokens: 1000 });

  return {
    success: true,
    originalText: text,
    polishedText: result.content,
    style,
    durationMs: result.durationMs,
  };
}

/**
 * 主管簽核決策輔助與智慧評語建議（核准肯定、退件指引、加簽說明）
 */
async function suggestApprovalComment({ requestId, actionType = 'approve', draftText = '', targetRole = '', user }) {
  const detail = requestId ? getRequestDetail(Number(requestId)) : null;
  const isReject = actionType === 'reject' || actionType === 'return';
  const isCosign = actionType === 'cosign';

  const prompt = `
你是一位大型企業資深行政主管兼簽核合規顧問。
現在簽核主管即將對一筆簽核單據執行「${isReject ? '退回修正' : isCosign ? '加簽/會簽' : '核准通過'}」操作。

【單據資訊】
- 單號：${detail ? '#' + detail.id : '未知'}
- 流程：${detail ? detail.workflow_name : '簽核申請'}
- 主旨：${detail ? detail.title : '申請案'}
- 申請人：${detail ? detail.requester_name : '同仁'}（部門：${detail ? detail.requester_dept : '未知'}）
- 主管輸入之簡短構想/關鍵字草稿：「${draftText || '（無，請依單據情況提供標準專業意見）'}」
${targetRole ? `- 指定加簽/會簽對象角色：${targetRole}` : ''}

請為簽核主管產生高品質的簽核意見建議：
1. 若為「核准」：提供符合公司規範、權責清楚的核准評語。
2. 若為「退回」：以專業、客觀且具體明確的退件指引（指出需要補件、修正發票憑證或調整金額之處），讓同仁一目了然如何修改，避免溝通誤會。
3. 若為「加簽」：清楚說明會簽之目的（如請財務確認額度、請資訊評估相容性等）。

請嚴格依照以下 JSON 格式回傳（勿附加任何其他文字）：
\`\`\`json
{
  "quickPhrases": ["15字以內簡潔快捷意見1", "快捷意見2", "快捷意見3"],
  "recommendedComment": "最推薦、最完整專業的回覆內容（40~80字）",
  "alternatives": [
    { "title": "標準常規版", "content": "意見文字" },
    { "title": "補充提醒版", "content": "意見文字" }
  ]
}
\`\`\`
`;

  const messages = [
    { role: 'system', content: '你是企業簽核公文輔助 AI，一律使用繁體中文（台灣商務規範）。請只回傳合法的 JSON 字串。' },
    { role: 'user', content: prompt },
  ];

  const result = await sendChatRequest({ messages, temperature: 0.3, maxTokens: 800 });
  const parsed = parseJsonResponse(result.content);

  const defaultSuggestions = isReject
    ? {
        quickPhrases: ['請補齊相關憑證單據後再行送件。', '請修正明細金額並重新計算總額。', '請補充說明採購用途與比價單。'],
        recommendedComment: draftText
          ? `同仁您好，本件因「${draftText}」，請協助補充相關說明或佐證單據後重新送審，謝謝。`
          : '同仁您好，請確認相關憑證與明細填寫是否齊全，補正後重新送件，謝謝。',
        alternatives: [],
      }
    : isCosign
    ? {
        quickPhrases: ['請相關單位協助確認並提供專業意見。', '請財務部協助審核動支額度。'],
        recommendedComment: '請相關權責主管/部門協助會簽確認業務需求及合規性。',
        alternatives: [],
      }
    : {
        quickPhrases: ['符合規範，准予辦理。', '單據齊全，同意。', '經核對無誤，予以核准。'],
        recommendedComment: '經審核單據內容、憑證及報價均符合公司作業規範，准予辦理。',
        alternatives: [],
      };

  return {
    success: true,
    actionType,
    suggestions: parsed || defaultSuggestions,
    durationMs: result.durationMs,
  };
}

/**
 * 主管晨間待審決策日報與優先級矩陣
 */
async function generatePendingBriefing({ userId, userRole, requests = [] }) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return {
      success: true,
      totalCount: 0,
      totalAmount: 0,
      briefingMarkdown: '🎉 **目前無待您審核的案件！**\n\n所有指派給您的簽核單據均已處理完畢，請繼續保持高效率！',
    };
  }

  let totalAmt = 0;
  const summaryItems = requests.slice(0, 20).map((r) => {
    let amt = 0;
    try {
      const fd = typeof r.form_data === 'string' ? JSON.parse(r.form_data) : r.form_data || {};
      amt = parseFloat(fd.amount || fd.total_amount || fd['金額'] || fd['總額'] || 0);
    } catch {}
    totalAmt += amt;
    const waitDays = Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 86400000));
    return `- 單號 #${r.id} | 流程: ${r.workflow_name || '一般流程'} | 主旨: ${r.title} | 申請人: ${r.requester_name || '同仁'} (${r.requester_dept || '未指定'}) | 金額: NT$${amt.toLocaleString()} | 已等待: ${waitDays}天`;
  });

  const prompt = `
你是一位頂級企業幕僚長兼高階主管特助。
以下是當前指派給該主管審核的 ${requests.length} 筆待辦簽核案件清單（總金額約 NT$${totalAmt.toLocaleString()}）：

${summaryItems.join('\n')}

請為主管生成一份精煉、條理分明、具備高度決策價值的「🌅 主管晨間待審決策日報」：
請使用繁體中文 Markdown 呈現，結構必須包含以下三個區塊：

### 📊【待審概況速覽】
- 彙總待審總件數、累計請款總金額、平均等待天數。

### 🚦【智慧優先級審核建議】
依案件的「緊急程度（如即將出差/即期）」、「金額規模（大額風險高）」、「停留天數（防逾期卡關）」為主管建議分級：
- 🔴 **高優先處理（急件 / 大額 / 已停留逾期風險）**：標註單號、重點與建議處理順序。
- 🟡 **中優先處理（一般常規 / 需檢閱單據細節）**：標註單號與關注重點。
- 🟢 **低優先（例行常規 / 小額日常 / 可速批）**：標註單號。

### 💡【主管快速批閱指引】
給主管 1~2 點批閱策略建議（例如：可先利用 2 分鐘快速核准綠燈例行小額單，再集中精力確認大額單據）。
`;

  const messages = [
    { role: 'system', content: '你是專業的高階主管簽核決策幕僚 AI，使用繁體中文，文筆俐落精煉，結構清楚。' },
    { role: 'user', content: prompt },
  ];

  const result = await sendChatRequest({ messages, temperature: 0.2, maxTokens: 1200 });

  return {
    success: true,
    totalCount: requests.length,
    totalAmount: totalAmt,
    briefingMarkdown: result.content,
    durationMs: result.durationMs,
  };
}

/**
 * Phase 3: 自然語言簽核戰情智慧問答 (Text-to-SQL + 數據洞察)
 */
async function askApprovalAnalytics({ question, user }) {
  if (!question || !String(question).trim()) {
    throw new Error('請提供查詢問題內容');
  }

  const schemaContext = `
資料庫類型：相容 MySQL 與 SQLite 標準 SQL 語法。
主要資料表結構說明：
1. approval_requests (簽核申請單)
   - id (單號, 整數主鍵)
   - workflow_id (對應 workflows.id)
   - title (主旨)
   - form_data (JSON 字串，包含 amount 等欄位)
   - requester_id (對應 users.id)
   - status ('pending' 簽核中, 'approved' 已核准, 'rejected' 已駁回, 'returned' 退回)
   - current_step (當前步驟序號)
   - created_at (送件時間，格式 'YYYY-MM-DD HH:MM:SS')
   - completed_at (完成時間)

2. workflows (簽核流程定義)
   - id (流程編號)
   - name (流程名稱，例如：請假申請、費用報支、請購申請)
   - category (分類，例如：人事、總務、財務)
   - is_active (1 啟用, 0 停用)

3. users (員工與主管帳號)
   - id (使用者編號)
   - username (帳號)
   - name (姓名)
   - role ('admin', 'general', 'manager')
   - department_id (對應 departments.id)

4. departments (組織部門)
   - id (部門編號)
   - name (部門名稱，例如：管理部、財務部、業務部、技術部)

5. approval_actions (簽核動作紀錄)
   - id (流水號)
   - request_id (對應 approval_requests.id)
   - actor_id (操作人 users.id)
   - action_type ('approve', 'reject', 'return', 'cosign')
   - comment (意見說明)
   - created_at (動作時間)
`;

  const sqlPrompt = `
你是一位精通 SQL 數據庫分析的企業商業智慧（BI）專家。
請依據使用者的自然語言提問，產出一條高效、語法嚴謹且相容 MySQL/SQLite 的唯讀 SELECT SQL 查詢語句。

【資料庫結構】
${schemaContext}

【使用者問題】
「${question}」

【嚴格規則】
1. 只允許輸出單一條以 SELECT 開頭的查詢語句，絕不可包含任何 INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, REPLACE 或分號多重語句。
2. 查詢結果最多限制 50 筆（使用 LIMIT 50）。
3. 欄位命名請使用有意義的繁體中文別名（例如：SELECT d.name AS 部門, COUNT(*) AS 件數）。
4. 請嚴格將產出的 SQL 放在 \`\`\`sql 程式碼區塊中，勿輸出多餘解釋。
`;

  const sqlMessages = [
    { role: 'system', content: '你是專業 SQL 資料分析專家。只輸出合法純淨的 SELECT 查詢語句。' },
    { role: 'user', content: sqlPrompt },
  ];

  const sqlRes = await sendChatRequest({ messages: sqlMessages, temperature: 0.1, maxTokens: 400 });
  let generatedSql = '';
  const sqlMatch = /```(?:sql)?\s*([\s\S]*?)\s*```/i.exec(sqlRes.content || '');
  if (sqlMatch) {
    generatedSql = sqlMatch[1].trim();
  } else {
    generatedSql = (sqlRes.content || '').trim();
  }

  // 安全防護驗證：只允許純 SELECT
  const sanitized = generatedSql.replace(/\s+/g, ' ').trim();
  if (!/^SELECT\s+/i.test(sanitized)) {
    throw new Error('產生的查詢不符合唯讀安全規範（必須為 SELECT）');
  }
  if (/;\s*\S+/i.test(sanitized) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC|CREATE)\b/i.test(sanitized)) {
    throw new Error('偵測到潛在不安全的 SQL 指令，已予以攔截');
  }

  // 執行查詢
  let queryRows = [];
  try {
    queryRows = db.prepare(sanitized).all();
  } catch (dbErr) {
    console.warn('[AI Text-to-SQL] 查詢失敗，嘗試執行備援查詢:', dbErr.message);
    const fallbackSql =
      'SELECT r.id AS 單號, r.title AS 主旨, w.name AS 流程, u.name AS 申請人, r.status AS 狀態, r.created_at AS 申請時間 FROM approval_requests r LEFT JOIN workflows w ON r.workflow_id = w.id LEFT JOIN users u ON r.requester_id = u.id ORDER BY r.id DESC LIMIT 15';
    queryRows = db.prepare(fallbackSql).all();
    generatedSql = fallbackSql;
  }

  const columns = queryRows.length > 0 ? Object.keys(queryRows[0]) : [];

  // 將查詢結果回傳給 AI 撰寫「數據洞察摘要」
  const previewData = queryRows.slice(0, 15);
  const insightPrompt = `
使用者問題：「${question}」
執行的 SQL：\`${generatedSql}\`
查詢回傳共 ${queryRows.length} 筆數據，前 15 筆結果如下：
\`\`\`json
${JSON.stringify(previewData, null, 2)}
\`\`\`

請針對上述查詢結果，以企業高階幕僚口吻，為主管產出 2~4 點條理清晰的「📊 戰情數據洞察解讀」：
- 簡要提煉核心數據結論（例如：哪個部門最多、總計金額、佔比、異常狀況等）
- 請使用繁體中文，格式俐落清晰。
`;

  const insightMessages = [
    { role: 'system', content: '你是企業簽核戰情分析專家，擅長從數據中提煉商業洞察。' },
    { role: 'user', content: insightPrompt },
  ];

  const insightRes = await sendChatRequest({ messages: insightMessages, temperature: 0.2, maxTokens: 600 });

  return {
    success: true,
    question,
    sql: generatedSql,
    columns,
    rows: queryRows,
    totalCount: queryRows.length,
    summary: insightRes.content,
    insightText: insightRes.content,
    durationMs: sqlRes.durationMs + insightRes.durationMs,
  };
}

/**
 * Phase 3: 企業簽核規章與政策問答知識庫 (Policy Q&A RAG)
 */
async function askPolicyKnowledgeBase({ question, user }) {
  if (!question || !String(question).trim()) {
    throw new Error('請輸入欲查詢的規章或政策問題');
  }

  const policiesPath = path.join(__dirname, '..', 'data', 'company-policies.json');
  let policiesData = { categories: [] };
  if (fs.existsSync(policiesPath)) {
    try {
      policiesData = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
    } catch (e) {
      console.warn('[AI] 讀取 company-policies.json 失敗:', e.message);
    }
  }

  const policyContext = (policiesData.categories || [])
    .map((c) => `【${c.name}】\n` + (c.rules || []).map((r, idx) => `  ${idx + 1}. ${r}`).join('\n'))
    .join('\n\n');

  const prompt = `
你是一位嫻熟企業人資考勤、財務核銷與採購審批規章的「企業規章政策專家」。
請根據下列公司現行核定之各項管理規章，專業、親切且條理分明地回答員工或主管的政策疑問。

【公司最新管理規章條文庫】
${policyContext}

【提問內容】
「${question}」

【回答指引】
1. 嚴格依據規章條文作答，直接點出規定要點（例如：天數、金額上限、審批階層、需檢附憑證）。
2. 若規章中有明確規範，請引用所屬規章名稱（例如：依《國內外出差與交通費報銷規章》規定…）。
3. 若問題涉及例外狀況或未明確記載之細節，請委婉提示可向管理部或財務單位專案洽詢。
4. 一律使用繁體中文（台灣商務習慣用語），條理分明。
`;

  const messages = [
    { role: 'system', content: '你是企業內部規章政策諮詢 AI，回答嚴謹、親切、條理清晰。' },
    { role: 'user', content: prompt },
  ];

  const result = await sendChatRequest({ messages, temperature: 0.2, maxTokens: 900 });

  return {
    success: true,
    question,
    answer: result.content,
    durationMs: result.durationMs,
  };
}

/**
 * Phase 3: 拆單舞弊與合規異常自動預警雷達 (Anti-Split & Compliance Radar)
 */
async function scanComplianceAnomalies({ days = 30 }) {
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  // 1. 抓取期間內所有單據
  const requests = db
    .prepare(
      `SELECT r.id, r.workflow_id, r.title, r.form_data, r.requester_id, r.status, r.current_step, r.created_at,
              w.name AS workflow_name, u.name AS requester_name, u.department AS dept_name
       FROM approval_requests r
       LEFT JOIN workflows w ON r.workflow_id = w.id
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE r.created_at >= ?
       ORDER BY r.id DESC`
    )
    .all(sinceDate);

  const suspectedSplitOrders = []; // 拆單嫌疑
  const duplicateInvoices = []; // 重複發票
  const slaBottlenecks = []; // 卡關逾期 (> 5 天)
  const offHoursSubmissions = []; // 非正常時間送件 (23:00~06:00)

  // 建立發票號碼索引
  const invoiceMap = new Map();

  // 按申請人與流程分組（偵測拆單）
  const userWorkflowMap = new Map();

  requests.forEach((r) => {
    let pData = {};
    try {
      pData = typeof r.form_data === 'string' ? JSON.parse(r.form_data) : r.form_data || {};
    } catch {}

    const amt = parseFloat(pData.amount || pData.total_amount || pData['金額'] || pData['總額'] || 0);
    const dateObj = new Date(r.created_at);
    const hour = dateObj.getHours();

    // 檢查非工作時間送件
    if (hour >= 23 || hour < 6) {
      offHoursSubmissions.push({
        id: r.id,
        title: r.title,
        requester: r.requester_name,
        dept: r.dept_name,
        time: r.created_at,
        amount: amt,
      });
    }

    // 檢查卡關逾期 (pending 且 > 5 天)
    if (r.status === 'pending') {
      const waitDays = Math.round((Date.now() - dateObj.getTime()) / 86400000);
      if (waitDays >= 5) {
        slaBottlenecks.push({
          id: r.id,
          title: r.title,
          workflow: r.workflow_name,
          requester: r.requester_name,
          waitDays,
          currentStep: r.current_step,
        });
      }
    }

    // 檢查發票重複
    const rawJson = JSON.stringify(pData);
    const invRegex = /[A-Z]{2}-?[0-9]{8}/gi;
    let match;
    while ((match = invRegex.exec(rawJson)) !== null) {
      const inv = match[0].replace('-', '').toUpperCase();
      if (!invoiceMap.has(inv)) invoiceMap.set(inv, []);
      invoiceMap.get(inv).push({ id: r.id, title: r.title, requester: r.requester_name, createdAt: r.created_at });
    }

    // 依申請人分組拆單檢測
    if (amt > 5000) {
      const groupKey = `${r.requester_id}_${r.workflow_id}`;
      if (!userWorkflowMap.has(groupKey)) userWorkflowMap.set(groupKey, []);
      userWorkflowMap.get(groupKey).push({ ...r, amount: amt, timestamp: dateObj.getTime() });
    }
  });

  // 整理重複發票
  for (const [inv, list] of invoiceMap.entries()) {
    if (list.length > 1) {
      duplicateInvoices.push({
        invoiceNo: inv,
        count: list.length,
        requests: list,
      });
    }
  }

  // 整理拆單嫌疑：7 天內相同申請人相同流程 2 筆以上，合計超過 5 萬元
  for (const [key, list] of userWorkflowMap.entries()) {
    if (list.length >= 2) {
      list.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < list.length - 1; i++) {
        const cluster = [list[i]];
        let sumAmt = list[i].amount;
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].timestamp - list[i].timestamp <= 7 * 86400000) {
            cluster.push(list[j]);
            sumAmt += list[j].amount;
          }
        }
        if (cluster.length >= 2 && sumAmt >= 50000) {
          suspectedSplitOrders.push({
            requester: cluster[0].requester_name,
            dept: cluster[0].dept_name,
            workflow: cluster[0].workflow_name,
            count: cluster.length,
            totalAmount: sumAmt,
            requests: cluster.map((c) => ({ id: c.id, title: c.title, amount: c.amount, createdAt: c.created_at })),
          });
          break;
        }
      }
    }
  }

  // 請 AI 生成一份高階稽核總結報告
  const anomalySummaryText = `
檢測週期：近 ${days} 天
- 拆單舞弊嫌疑：${suspectedSplitOrders.length} 組
- 重複發票報銷：${duplicateInvoices.length} 筆
- 嚴重逾期卡關 (超過5天)：${slaBottlenecks.length} 筆
- 非上班時間送件：${offHoursSubmissions.length} 筆
`;

  const reportPrompt = `
你是一位大型跨國企業資深內部稽核長（Chief Audit Executive）。
系統剛完成對近 ${days} 天簽核案件的「合規與異常風控掃描」，統計摘要如下：
${anomalySummaryText}

具體異常樣本：
- 拆單嫌疑樣本：${JSON.stringify(suspectedSplitOrders.slice(0, 3))}
- 重複發票樣本：${JSON.stringify(duplicateInvoices.slice(0, 3))}
- 嚴重卡關樣本：${JSON.stringify(slaBottlenecks.slice(0, 5))}

請為企業管理階層產出一份簡潔、具體、有行動指引的「🚨 企業簽核合規與風險稽核報告」：
1. 總體風險評級（🟢 健康良好 / 🟡 需常規複核 / 🔴 高風險預警）。
2. 針對拆單、重複報銷與卡關提供關鍵發現與管理建議。
3. 一律使用繁體中文 Markdown 格式。
`;

  const reportMessages = [
    { role: 'system', content: '你是專業企業內部稽核長，文筆客觀、威嚴、具備行動指引。' },
    { role: 'user', content: reportPrompt },
  ];

  const reportRes = await sendChatRequest({ messages: reportMessages, temperature: 0.2, maxTokens: 900 });

  return {
    success: true,
    scanDays: days,
    scannedCount: requests.length,
    counts: {
      splitOrders: suspectedSplitOrders.length,
      duplicateInvoices: duplicateInvoices.length,
      stalledRequests: slaBottlenecks.length,
      offHours: offHoursSubmissions.length,
    },
    suspectedSplitOrders,
    duplicateInvoices,
    stalledRequests: slaBottlenecks,
    offHoursRequests: offHoursSubmissions,
    executiveReport: reportRes.content,
    anomalies: {
      suspectedSplitOrders,
      duplicateInvoices,
      slaBottlenecks,
      offHoursSubmissions,
    },
    summaryReport: reportRes.content,
    durationMs: reportRes.durationMs,
  };
}

module.exports = {
  getAiConfig,
  checkAiHealth,
  sendChatRequest,
  analyzeRequest,
  scanFormLayout,
  parseInvoiceOrReceipt,
  polishApplicationText,
  suggestApprovalComment,
  generatePendingBriefing,
  askApprovalAnalytics,
  askPolicyKnowledgeBase,
  scanComplianceAnomalies,
};
