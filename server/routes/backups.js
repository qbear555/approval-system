/**
 * 簽核 PDF 備份與請假申請單批次查詢下載模組路由
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pdfSign = require('../pdf-sign');
const { writeApprovalPdf, buildApprovalPdfFileName, contentDispositionAttachment } = require('../pdf');
const {
  runBackupJob,
  listBackups,
  getBackupMeta,
  getBackupById,
  resolveBackupAbsPath,
  isZipBackup,
  backupOneRequest,
  deleteBackup,
  deleteBackups,
  listLeaveRequestIds,
  safeZipEntryName,
} = require('../backup');

module.exports = function registerBackupRoutes(app, ctx) {
  const {
    db,
    authMiddleware,
    adminOnly,
    requirePerm,
    getRequestDetail,
    requireLeaveFormsDownload,
  } = ctx;

  /** 管理員：備份元資料 */
  app.get('/api/backups/meta', authMiddleware, requirePerm('backups'), (req, res) => {
    res.json({ meta: getBackupMeta() });
  });

  /** 人事：請假申請單批次下載用 meta */
  app.get(
    '/api/backups/leave-forms-meta',
    authMiddleware,
    requireLeaveFormsDownload,
    (req, res) => {
      const departments = db
        .prepare(
          `SELECT name FROM departments WHERE active = 1 ORDER BY sort_order, name`
        )
        .all()
        .map((r) => r.name);
      res.json({ departments, note: '僅限請假申請單 PDF' });
    }
  );

  /** 人事：條件查詢請假申請單 */
  app.post(
    '/api/backups/leave-forms-query',
    authMiddleware,
    requireLeaveFormsDownload,
    (req, res) => {
      try {
        const body = req.body || {};
        const date_from = body.date_from || body.dateFrom || body.from || '';
        const date_to = body.date_to || body.dateTo || body.to || '';
        if (!date_from || !date_to) {
          return res.status(400).json({ error: '請指定請假期間起迄日期' });
        }
        if (String(date_from).slice(0, 10) > String(date_to).slice(0, 10)) {
          return res.status(400).json({ error: '起始日期不可晚於結束日期' });
        }
        const items = listLeaveRequestIds({
          status: body.status || 'approved',
          department: body.department || '',
          date_from: String(date_from).slice(0, 10),
          date_to: String(date_to).slice(0, 10),
          keyword: String(body.keyword || '').trim(),
          leave_type: String(body.leave_type || body.leaveType || '').trim(),
          limit: 500,
        });
        res.json({
          items,
          total: items.length,
          filters: {
            date_from: String(date_from).slice(0, 10),
            date_to: String(date_to).slice(0, 10),
            status: body.status || 'approved',
            department: body.department || '',
            keyword: String(body.keyword || '').trim(),
            leave_type: String(body.leave_type || body.leaveType || '').trim(),
          },
        });
      } catch (e) {
        console.error('[leave-forms-query]', e);
        res.status(400).json({ error: e.message || '查詢失敗' });
      }
    }
  );

  /** 人事：批次下載請假申請單 PDF（勾選 ids 或條件全選） */
  app.post(
    '/api/backups/leave-forms-download',
    authMiddleware,
    requireLeaveFormsDownload,
    async (req, res) => {
      try {
        const body = req.body || {};
        const rawIds = Array.isArray(body.ids)
          ? body.ids.map(Number).filter(Boolean)
          : [];
        const date_from = body.date_from || body.dateFrom || body.from || '';
        const date_to = body.date_to || body.dateTo || body.to || '';
        let list;
        if (rawIds.length) {
          if (rawIds.length > 500) {
            return res.status(400).json({ error: '單次最多下載 500 筆' });
          }
          list = listLeaveRequestIds({ ids: rawIds, limit: 500 });
          if (!list.length) {
            return res
              .status(404)
              .json({ error: '選取的單據不是請假申請或已不存在' });
          }
        } else {
          if (!date_from || !date_to) {
            return res
              .status(400)
              .json({ error: '請先查詢並勾選請假單，或指定期間後全選下載' });
          }
          list = listLeaveRequestIds({
            status: body.status || 'approved',
            department: body.department || '',
            date_from: String(date_from).slice(0, 10),
            date_to: String(date_to).slice(0, 10),
            keyword: String(body.keyword || '').trim(),
            leave_type: String(body.leave_type || body.leaveType || '').trim(),
            limit: 500,
          });
          if (!list.length) {
            return res.status(404).json({ error: '此條件下沒有請假申請單' });
          }
        }

        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts =
          `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
          `_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
        const zipName = `請假申請單_${ts}_${list.length}筆.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          contentDispositionAttachment(zipName, `leave-forms_${ts}.zip`)
        );

        const archive = archiver('zip', { zlib: { level: 8 } });
        archive.on('error', (err) => {
          console.error('[leave-forms-download] zip error', err);
          if (!res.headersSent) res.status(500).json({ error: '壓縮失敗' });
          else res.end();
        });
        archive.pipe(res);

        const usedNames = new Set();
        let ok = 0;
        let fail = 0;
        const errors = [];
        for (const item of list) {
          try {
            const detail = typeof getRequestDetail === 'function' ? getRequestDetail(item.id) : null;
            if (!detail) {
              fail += 1;
              errors.push({ id: item.id, error: '找不到詳情' });
              continue;
            }
            const pdfBuf = await pdfSign.buildApprovalPdfBuffer(
              detail,
              writeApprovalPdf
            );
            const entry = safeZipEntryName(
              buildApprovalPdfFileName(detail),
              `請假_${item.id}.pdf`
            );
            const deptSeg = String(detail.requester_dept || '未設定部門')
              .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
              .slice(0, 40);
            let finalPath = `${deptSeg}/${entry}`;
            let n = 1;
            while (usedNames.has(finalPath.toLowerCase())) {
              const ext = path.extname(entry);
              const stem = ext ? entry.slice(0, -ext.length) : entry;
              finalPath = `${deptSeg}/${stem}_${n}${ext}`;
              n += 1;
            }
            usedNames.add(finalPath.toLowerCase());
            archive.append(pdfBuf, { name: finalPath });
            ok += 1;
          } catch (e) {
            fail += 1;
            errors.push({ id: item.id, error: e.message || String(e) });
          }
        }
        const summaryLines = [
          `請假申請單批次下載`,
          rawIds.length ? `方式：勾選下載` : `方式：條件全選`,
          `成功：${ok}　失敗：${fail}　下載筆數：${list.length}`,
          ``,
          `單號\t申請人\t部門\t假別\t請假起\t請假迄\t狀態`,
          ...list.map(
            (r) =>
              `#${r.id}\t${r.requester_name || ''}\t${r.requester_dept || ''}\t${r.leave_type || ''}\t${r.leave_start || ''}\t${r.leave_end || ''}\t${r.status || ''}`
          ),
        ];
        if (errors.length) {
          summaryLines.push('', '失敗明細：');
          for (const er of errors.slice(0, 50)) {
            summaryLines.push(`#${er.id}\t${er.error || ''}`);
          }
        }
        archive.append(Buffer.from(summaryLines.join('\r\n'), 'utf8'), {
          name: '請假清單.txt',
        });
        await archive.finalize();
      } catch (e) {
        console.error('[leave-forms-download]', e);
        if (!res.headersSent) {
          res.status(500).json({ error: e.message || '下載失敗' });
        }
      }
    }
  );

  /** 備份列表查詢 */
  app.get('/api/backups', authMiddleware, requirePerm('backups'), (req, res) => {
    const items = listBackups({
      department: req.query.department || '',
      workflow_name: req.query.workflow_name || '',
      year: req.query.year || '',
      month: req.query.month || '',
      keyword: req.query.keyword || '',
      status: req.query.status || '',
      limit: req.query.limit || 200,
    });
    res.json({ backups: items });
  });

  /** 觸發排程或條件備份 */
  app.post('/api/backups/run', authMiddleware, requirePerm('backups'), async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runBackupJob(
        {
          status: body.status || 'approved',
          department: body.department || '',
          workflow_name: body.workflow_name || '',
          date_from: body.date_from || '',
          date_to: body.date_to || '',
          force: !!body.force,
        },
        (id) => typeof getRequestDetail === 'function' ? getRequestDetail(id) : null,
        req.user.id
      );
      res.json({ ok: true, result });
    } catch (e) {
      console.error('backup run error', e);
      res.status(500).json({ error: e.message || '備份失敗' });
    }
  });

  /** 單筆單據備份 */
  app.post('/api/backups/request/:id', authMiddleware, requirePerm('backups'), async (req, res) => {
    try {
      const detail = typeof getRequestDetail === 'function' ? getRequestDetail(Number(req.params.id)) : null;
      if (!detail) return res.status(404).json({ error: '找不到簽核單' });
      const item = await backupOneRequest(detail, req.user.id);
      res.json({ ok: true, backup: item });
    } catch (e) {
      console.error('backup one error', e);
      res.status(500).json({ error: e.message || '備份失敗' });
    }
  });

  /** 下載備份檔案 */
  app.get('/api/backups/:id/download', authMiddleware, requirePerm('backups'), (req, res) => {
    const row = getBackupById(req.params.id);
    if (!row) return res.status(404).json({ error: '找不到備份' });
    const abs = resolveBackupAbsPath(row);
    if (!abs) return res.status(404).json({ error: '備份檔案不存在，請重新執行備份' });
    const zip = isZipBackup(row);
    res.setHeader('Content-Type', zip ? 'application/zip' : 'application/pdf');
    const nameHint = String(row.file_name || '');
    const ascii = zip
      ? nameHint.includes('含附件')
        ? `backup-${row.request_id}-with-attachments.zip`
        : `backup-${row.request_id}.zip`
      : `backup-${row.request_id}.pdf`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name || ascii)}`
    );
    fs.createReadStream(abs).pipe(res);
  });

  /** 系統管理員刪除單筆備份（含 PDF 檔） */
  app.delete('/api/backups/:id', authMiddleware, adminOnly, (req, res) => {
    const result = deleteBackup(req.params.id);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true, ...result });
  });

  /** 系統管理員批次刪除備份 */
  app.post('/api/backups/bulk-delete', authMiddleware, adminOnly, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆備份' });
    const { deleted, failed } = deleteBackups(ids);
    res.json({
      ok: true,
      deleted: deleted.length,
      failed: failed.length,
      deletedItems: deleted,
      failures: failed,
      message: `已刪除 ${deleted.length} 筆備份${failed.length ? `，${failed.length} 筆失敗` : ''}`,
    });
  });
};
