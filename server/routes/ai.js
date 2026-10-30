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
      const { enabled, provider, baseUrl, model, apiKey, clearApiKey } = req.body || {};
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
};
