/**
 * 請假報表與單據多維度 Excel 報表匯出模組路由
 */
const labor = require('../labor');
const leaveReport = require('../leave-report');
const requestExport = require('../request-export');

module.exports = function registerReportRoutes(app, ctx) {
  const {
    db,
    authMiddleware,
    requirePerm,
    userHasPermission,
    canDeleteLeaveRequests,
    isRequestRelatedToUser,
    isLeaveApprovalRequest,
    isDraftOwner,
  } = ctx;

  /**
   * 人事：請假報表 Excel
   * POST body: { userIds: number[], dateFrom, dateTo }
   * 一律僅統計已核准請假單（不接受其他狀態）
   * 權限：admin 或 leave_report
   */
  app.post(
    '/api/reports/leave-export',
    authMiddleware,
    requirePerm('leave_report'),
    (req, res) => {
      try {
        const body = req.body || {};
        let userIds = Array.isArray(body.userIds)
          ? body.userIds.map(Number).filter(Boolean)
          : [];
        // 未指定則全部啟用中成員
        if (!userIds.length) {
          userIds = db
            .prepare(`SELECT id FROM users WHERE active = 1 ORDER BY id`)
            .all()
            .map((u) => u.id);
        }
        const dateFrom = body.dateFrom || body.from || body.start;
        const dateTo = body.dateTo || body.to || body.end;

        const { buffer, meta } = leaveReport.buildLeaveReportWorkbook({
          userIds,
          dateFrom,
          dateTo,
          statuses: ['approved'],
        });

        const fname = `請假報表_${meta.dateFrom}_${meta.dateTo}.xlsx`;
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="leave-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
        );
        res.send(buffer);
      } catch (e) {
        console.error('leave-export', e);
        res.status(400).json({ error: e.message || '匯出失敗' });
      }
    }
  );

  /**
   * 單據 Excel 匯出（費用報支／請購請款／簽核紀錄）
   * POST body: { dateFrom, dateTo, status, workflow, q, kind }
   * kind: all | expense | purchase | finance
   * 權限：登入即可；一般使用者僅本人相關；admin／records_all／leave_report／finance_confirm 可全公司
   */
  app.post('/api/reports/requests-export', authMiddleware, (req, res) => {
    try {
      const body = req.body || {};
      const uid = req.user.id;
      const seeAll =
        req.user.role === 'admin' ||
        (typeof userHasPermission === 'function' && (
          userHasPermission(uid, 'records_all') ||
          userHasPermission(uid, 'leave_report') ||
          userHasPermission(uid, 'finance_confirm')
        ));
      const seeAllLeave = typeof canDeleteLeaveRequests === 'function' ? canDeleteLeaveRequests(req.user) : false;

      const candidates = db
        .prepare(
          `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                  u.name AS requester_name, u.username AS requester_username,
                  u.department AS requester_dept
           FROM approval_requests r
           JOIN workflows w ON w.id = r.workflow_id
           JOIN users u ON u.id = r.requester_id
           WHERE r.deleted_at IS NULL OR r.deleted_at = ''
           ORDER BY r.updated_at DESC
           LIMIT 3000`
        )
        .all();

      let rows = seeAll
        ? candidates
        : candidates.filter(
            (r) =>
              (typeof isRequestRelatedToUser === 'function' && isRequestRelatedToUser(r, uid)) ||
              (seeAllLeave && typeof isLeaveApprovalRequest === 'function' && isLeaveApprovalRequest(r))
          );

      if (req.user.role !== 'admin') {
        rows = rows.filter((r) => String(r.status) !== 'draft' || (typeof isDraftOwner === 'function' && isDraftOwner(r, uid)));
      }

      const q = String(body.q || body.keyword || '')
        .trim()
        .toLowerCase();
      const workflowName = String(body.workflow || body.workflow_name || body.category || '').trim();
      const statusQ = String(body.status || '')
        .trim()
        .toLowerCase();
      const dateFrom = labor.toDateOnly(body.dateFrom || body.from || '');
      const dateTo = labor.toDateOnly(body.dateTo || body.to || '');

      if (workflowName) {
        rows = rows.filter((r) => String(r.workflow_name || '') === workflowName);
      }
      if (statusQ && statusQ !== 'all') {
        const statuses = statusQ.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
        if (statuses.length === 1) {
          rows = rows.filter((r) => String(r.status) === statuses[0]);
        } else if (statuses.length > 1) {
          rows = rows.filter((r) => statuses.includes(String(r.status)));
        }
      }
      if (q) {
        rows = rows.filter((r) => {
          const hay = [r.id, r.title, r.requester_name, r.workflow_name, r.status]
            .map((x) => String(x || '').toLowerCase())
            .join(' ');
          return hay.includes(q);
        });
      }
      if (dateFrom || dateTo) {
        rows = rows.filter((r) => {
          const raw = String(r.updated_at || r.created_at || r.completed_at || '').slice(0, 10);
          const d = labor.toDateOnly(raw);
          if (!d) return false;
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        });
      }

      const { buffer, meta } = requestExport.buildRequestsExportWorkbook({
        rows,
        kind: body.kind || 'all',
        dateFrom,
        dateTo,
        generatedBy: req.user.name || req.user.username || '',
      });

      const kindTag =
        meta.kind === 'expense'
          ? '費用報支'
          : meta.kind === 'purchase'
            ? '請購請款'
            : meta.kind === 'finance' || meta.kind === 'expense_purchase'
              ? '費用請購'
              : '單據';
      const rangeTag =
        meta.dateFrom || meta.dateTo
          ? `_${meta.dateFrom || '起'}_${meta.dateTo || '迄'}`
          : '';
      const fname = `${kindTag}報表${rangeTag}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="requests-export.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
      );
      res.send(buffer);
    } catch (e) {
      console.error('requests-export', e);
      res.status(400).json({ error: e.message || '匯出失敗' });
    }
  });
};
