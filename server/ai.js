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
  let settings = {};
  try {
    settings = systemSettings.getAdminSettings ? systemSettings.getAdminSettings() : {};
  } catch {
    settings = {};
  }
  const ai = settings.ai || {};
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

  const bodyData = isOllama
    ? JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      })
    : JSON.stringify({
        model: config.model,
        messages,
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
      reject(new Error(`AI 服務請求失敗: ${err.message}`));
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

module.exports = {
  getAiConfig,
  checkAiHealth,
  sendChatRequest,
  analyzeRequest,
};
