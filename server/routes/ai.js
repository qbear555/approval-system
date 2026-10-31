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
   * 更新 AI 系統設定
   */
  app.post('/api/ai/settings', authMiddleware, adminOnly, async (req, res) => {
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
  });

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
};
