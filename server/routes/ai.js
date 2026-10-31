/**
 * 線上簽核系統 — AI 智慧輔助 API 路由
 */
const express = require('express');
const ai = require('../ai');
const systemSettings = require('../system-settings');
const { getRequestDetail } = require('../runtime');

module.exports = function registerAiRoutes(app, { authMiddleware, adminOnly }) {
  /**
   * 檢查本機／遠端 AI 服務連線狀態與可用模型清單
   */
  app.get('/api/ai/status', authMiddleware, async (req, res) => {
    try {
      const status = await ai.checkAiHealth();
      res.json(status);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * 取得 AI 系統設定
   */
  app.get('/api/ai/settings', authMiddleware, adminOnly, (req, res) => {
    try {
      const config = ai.getAiConfig();
      res.json({
        enabled: config.enabled,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
        hasApiKey: !!(config.apiKey && config.apiKey.length > 0),
        settings: {
          aiEnabled: config.enabled,
          aiProvider: config.provider,
          aiBaseUrl: config.baseUrl,
          aiModel: config.model,
          hasApiKey: !!(config.apiKey && config.apiKey.length > 0),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * 更新 AI 系統設定 (支援 POST 與 PUT)
   */
  const handleSaveAiSettings = async (req, res) => {
    try {
      const body = req.body || {};
      const enabled = body.aiEnabled !== undefined ? body.aiEnabled : body.enabled;
      const provider = body.aiProvider !== undefined ? body.aiProvider : body.provider;
      const baseUrl = body.aiBaseUrl !== undefined ? body.aiBaseUrl : body.baseUrl;
      const model = body.aiModel !== undefined ? body.aiModel : body.model;
      const apiKey = body.aiApiKey !== undefined ? body.aiApiKey : body.apiKey;
      const clearApiKey = body.clearApiKey || body.aiApiKeyClear;

      const patch = {};
      if (enabled !== undefined) patch.aiEnabled = !!enabled;
      if (provider !== undefined) patch.aiProvider = String(provider).trim();
      if (baseUrl !== undefined) patch.aiBaseUrl = String(baseUrl).trim();
      if (model !== undefined) patch.aiModel = String(model).trim();
      if (clearApiKey) {
        patch.aiApiKeyClear = true;
      } else if (apiKey !== undefined && String(apiKey).trim() !== '') {
        patch.aiApiKey = String(apiKey).trim();
      }

      systemSettings.updateSettings(patch);
      const health = await ai.checkAiHealth();
      res.json({ success: true, message: 'AI 設定已更新', health });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  app.post('/api/ai/settings', authMiddleware, adminOnly, handleSaveAiSettings);
  app.put('/api/ai/settings', authMiddleware, adminOnly, handleSaveAiSettings);

  /**
   * 對單據進行 AI 智慧審核與重點摘要
   */
  app.post('/api/ai/analyze-request/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: '無效的單據編號' });

      const detail = getRequestDetail(id);
      if (!detail) {
        return res.status(404).json({ error: '找不到指定的簽核單據' });
      }

      // 權限檢查：申請人、簽核人或管理員才可進行分析
      const uid = Number(req.user.id);
      const isOwner = Number(detail.requester_id) === uid || Number(detail.submitted_by) === uid;
      const isAdmin = req.user.role === 'admin';
      const isActor = Array.isArray(detail.actions) && detail.actions.some((a) => Number(a.actor_id) === uid);
      const isCurrentApprover =
        Array.isArray(detail.steps) &&
        detail.steps.some(
          (s) =>
            s.order === detail.current_step &&
            ((s.assignee_id && Number(s.assignee_id) === uid) ||
              (s.role_name && req.user.role === s.role_name))
        );

      if (!isOwner && !isAdmin && !isActor && !isCurrentApprover) {
        return res.status(403).json({ error: '無權檢視或分析此單據' });
      }

      const result = await ai.analyzeRequest(id, req.user);
      res.json(result);
    } catch (err) {
      console.error('[AI] analyze-request failed:', err);
      res.status(500).json({ error: err.message || 'AI 審核分析失敗' });
    }
  });

  /**
   * 智慧掃描紙本表單／PDF，生成推薦欄位定義與畫布排版
   */
  app.post('/api/ai/scan-form', authMiddleware, async (req, res) => {
    try {
      const { imageBase64, textItems, width, height, page } = req.body || {};
      if (!imageBase64 && (!Array.isArray(textItems) || !textItems.length)) {
        return res.status(400).json({ error: '請提供表單底圖或文字結構資料以供 AI 分析' });
      }

      const result = await ai.scanFormLayout({
        imageBase64,
        textItems,
        width: Number(width) || 595,
        height: Number(height) || 842,
        page: Number(page) || 1,
      });
      res.json(result);
    } catch (err) {
      console.error('[AI] scan-form failed:', err);
      res.status(500).json({ error: err.message || 'AI 掃描表單排版失敗' });
    }
  });

  /**
   * 智慧辨識電子發票／收據／支出憑證，提取品項與金額明細
   */
  app.post('/api/ai/parse-invoice', authMiddleware, async (req, res) => {
    try {
      const { imageBase64, textContent, columns } = req.body || {};
      if (!imageBase64 && !textContent) {
        return res.status(400).json({ error: '請提供發票/收據圖檔或文字內容' });
      }

      const result = await ai.parseInvoiceOrReceipt({
        imageBase64,
        textContent,
        columns: Array.isArray(columns) ? columns : [],
      });
      res.json(result);
    } catch (err) {
      console.error('[AI] parse-invoice failed:', err);
      res.status(500).json({ error: err.message || 'AI 發票收據辨識失敗' });
    }
  });

  /**
   * 申請事由與公文簽呈一鍵 AI 潤飾擴充
   */
  app.post('/api/ai/polish-text', authMiddleware, async (req, res) => {
    try {
      const { text, style, workflowName, category } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: '請提供欲潤飾之事由草稿內容' });
      }

      const result = await ai.polishApplicationText({
        text: String(text).trim(),
        style: style || 'formal',
        workflowName: workflowName || '',
        category: category || '',
      });
      res.json(result);
    } catch (err) {
      console.error('[AI] polish-text failed:', err);
      res.status(500).json({ error: err.message || 'AI 潤飾公文失敗' });
    }
  });
  /**
   * 主管簽核決策輔助與智慧評語建議（核准/退件/加簽）
   */
  app.post('/api/ai/suggest-comment', authMiddleware, async (req, res) => {
    try {
      const { requestId, actionType, draftText, targetRole } = req.body || {};
      const result = await ai.suggestApprovalComment({
        requestId: Number(requestId) || null,
        actionType: actionType || 'approve',
        draftText: String(draftText || '').trim(),
        targetRole: String(targetRole || '').trim(),
        user: req.user,
      });
      res.json(result);
    } catch (err) {
      console.error('[AI] suggest-comment failed:', err);
      res.status(500).json({ error: err.message || 'AI 智慧評語生成失敗' });
    }
  });

  /**
   * 主管晨間待審決策日報與優先級矩陣
   */
  app.post('/api/ai/pending-briefing', authMiddleware, async (req, res) => {
    try {
      let requests = req.body && Array.isArray(req.body.requests) ? req.body.requests : [];
      if (!requests.length) {
        const db = require('../db');
        const sql = "SELECT r.id, r.title, r.form_data, r.status, r.created_at, w.name as workflow_name, u.name as requester_name FROM approval_requests r LEFT JOIN workflows w ON r.workflow_id = w.id LEFT JOIN users u ON r.requester_id = u.id WHERE r.status = 'pending' ORDER BY r.id DESC LIMIT 30";
        const rows = db.prepare(sql).all();
        requests = rows || [];
      }
      const result = await ai.generatePendingBriefing({
        userId: req.user.id,
        userRole: req.user.role,
        requests,
      });
      res.json(result);
    } catch (err) {
      console.error('[AI] pending-briefing failed:', err);
      res.status(500).json({ error: err.message || 'AI 待審決策日報生成失敗' });
    }
  });

  /**
   * Phase 3: 自然語言簽核戰情智慧問答 (Text-to-SQL & 數據洞察)
   */
  app.post('/api/ai/analytics-query', authMiddleware, async (req, res) => {
    try {
      const { question } = req.body || {};
      const result = await ai.askApprovalAnalytics({ question, user: req.user });
      res.json(result);
    } catch (err) {
      console.error('[AI] analytics-query failed:', err);
      res.status(500).json({ error: err.message || 'AI 戰情分析失敗' });
    }
  });

  /**
   * Phase 3: 企業簽核規章與政策問答知識庫 (Policy Q&A RAG)
   */
  app.post('/api/ai/policy-qa', authMiddleware, async (req, res) => {
    try {
      const { question } = req.body || {};
      const result = await ai.askPolicyKnowledgeBase({ question, user: req.user });
      res.json(result);
    } catch (err) {
      console.error('[AI] policy-qa failed:', err);
      res.status(500).json({ error: err.message || 'AI 規章問答失敗' });
    }
  });

  /**
   * 取得公司政策規章庫
   */
  app.get('/api/ai/policies', authMiddleware, (req, res) => {
    const path = require('path');
    const p = path.join(__dirname, '..', '..', 'data', 'company-policies.json');
    if (fs.existsSync(p)) {
      try {
        return res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
      } catch {}
    }
    res.json({ categories: [] });
  });

  /**
   * 更新公司政策規章庫（管理員專屬）
   */
  app.post('/api/ai/policies', authMiddleware, adminOnly, (req, res) => {
    const path = require('path');
    const p = path.join(__dirname, '..', '..', 'data', 'company-policies.json');
    try {
      const data = req.body || {};
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
      res.json({ success: true, message: '規章庫已更新' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Phase 3: 拆單舞弊與合規異常自動預警雷達 (Anti-Split & Compliance Radar)
   */
  app.get('/api/ai/compliance-anomalies', authMiddleware, async (req, res) => {
    try {
      const days = Number(req.query.days) || 30;
      const result = await ai.scanComplianceAnomalies({ days });
      res.json(result);
    } catch (err) {
      console.error('[AI] compliance-anomalies failed:', err);
      res.status(500).json({ error: err.message || 'AI 合規異常診斷失敗' });
    }
  });
};
