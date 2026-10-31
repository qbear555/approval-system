/**
 * 線上簽核系統 — AI 智慧輔助模組
 * 支援本機 Ollama 與 OpenAI 相容 API 協定
 */
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
 * 依申請單詳情組成專業審核摘要 Prompt
 */
function buildAuditPrompt(detail) {
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

  const promptText = `
你是一位具備 15 年以上大型企業行政稽核與主管簽核經驗的「企業智慧簽核專家」。
請針對下列申請單據的完整內容進行深度專業審核，並以「專業、客觀、俐落」的繁體中文 Markdown 格式提供主管審核摘要與風險檢核：

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

----------------------------
請嚴格依照以下三個維度進行分析輸出，勿回答無關內容：

### 📌【案件速覽】
用 2~3 點扼要點出核心事實：誰因何事由申請、金額或天數期程、預計達成之業務目的。

### 🔍【合規與防呆檢核】
- **資料齊全度**：重要欄位與必要憑證附件是否齊全？
- **合理性與邏輯**：金額、計算方式、申請時間區間是否合理或有無矛盾？
- **風險評估等級**：評定此案件風險程度（請以「🟢 低風險 / 正常合規」、「🟡 中風險 / 需留意細節」、「🔴 高風險 / 疑似異常」標註，並簡述關鍵原因）。

### 💡【簽核主管審查建議】
具體向簽核人提出核准、補件或確認方向建議（例如：若為低風險可放心核准；若缺憑證建議請同仁補充何種說明或單據）。
`;

  return promptText;
}

/**
 * 對指定簽核單據進行 AI 審查分析
 */
async function analyzeRequest(requestId, user) {
  const detail = getRequestDetail(Number(requestId));
  if (!detail) {
    throw new Error('找不到指定的簽核單據');
  }

  const prompt = buildAuditPrompt(detail);
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

  const result = await sendChatRequest({ messages, temperature: 0.2, maxTokens: 1200 });

  return {
    requestId: detail.id,
    title: detail.title,
    analysis: result.content,
    report: result.content,
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

module.exports = {
  getAiConfig,
  checkAiHealth,
  sendChatRequest,
  analyzeRequest,
  scanFormLayout,
  parseInvoiceOrReceipt,
  polishApplicationText,
};
