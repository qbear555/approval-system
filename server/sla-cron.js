'use strict';

/**
 * 簽核逾時 SLA 自動催辦排程模組
 * - 定時掃描所有 pending 簽核單
 * - 超過關卡設定之 SLA 時限（預設 24 小時）自動發送 Email 與 LINE 催辦通知
 * - 自動於單據歷程留存 system 催辦紀錄
 */

const db = require('./db');
const mail = require('./mail');
const lineNotify = require('./line-notify');

let timer = null;

/**
 * 執行一次 SLA 逾期掃描與自動催辦
 */
async function runSlaCheck(opts = {}) {
  const defaultTimeoutHours = Number(process.env.SLA_TIMEOUT_HOURS || opts.timeoutHours || 24);
  const minRemindIntervalHours = Number(process.env.SLA_INTERVAL_HOURS || 24);

  // 取得運行時相依
  const runtime = require('./runtime');
  const {
    getRequestDetail,
    notifyCurrentApprovers,
    findStepByOrder,
    logAudit,
  } = runtime;

  const rows = db.prepare(
    `SELECT id, title, requester_id, current_step, status, created_at, updated_at, last_remind_at
     FROM approval_requests
     WHERE status = 'pending' AND deleted_at IS NULL
     ORDER BY updated_at ASC`
  ).all();

  const now = Date.now();
  const reminded = [];
  const examined = [];

  for (const row of rows) {
    const detail = getRequestDetail(row.id);
    if (!detail || detail.status !== 'pending') continue;

    const steps = detail.steps || [];
    const step = findStepByOrder(steps, detail.current_step);
    const stepTimeout = Number(step?.timeoutHours) || defaultTimeoutHours;

    // 計算在當前關卡已停留小時數
    const stepEnteredTime = new Date(String(row.updated_at || row.created_at).replace(' ', 'T')).getTime();
    const hoursInStep = Number.isNaN(stepEnteredTime) ? 0 : (now - stepEnteredTime) / (3600 * 1000);

    // 檢查上次催辦時間
    let hoursSinceLastRemind = Infinity;
    if (row.last_remind_at) {
      const lastRemindTime = new Date(String(row.last_remind_at).replace(' ', 'T')).getTime();
      if (!Number.isNaN(lastRemindTime)) {
        hoursSinceLastRemind = (now - lastRemindTime) / (3600 * 1000);
      }
    }

    const isOverdue = hoursInStep >= stepTimeout;
    const canRemind = hoursSinceLastRemind >= minRemindIntervalHours;

    examined.push({
      id: row.id,
      title: row.title,
      current_step: detail.current_step,
      step_name: step?.name || '審核關卡',
      hoursInStep: Math.round(hoursInStep * 10) / 10,
      stepTimeout,
      isOverdue,
      canRemind,
    });

    if (isOverdue && canRemind) {
      try {
        // 1. 發送催辦通知 (Email + LINE)
        notifyCurrentApprovers(detail, 'remind', '系統 SLA 逾時自動催辦');

        // 2. 更新最後催辦時間
        db.prepare(
          `UPDATE approval_requests SET last_remind_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(row.id);

        // 3. 寫入歷程動作
        const comment = `【SLA 自動催辦】此單據停留於關卡「${step?.name || '審核關卡'}」已達 ${Math.floor(hoursInStep)} 小時（超過 ${stepTimeout} 小時標準），系統已自動發送催辦通知。`;
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, NULL, 'system', ?, '{}')`
        ).run(row.id, detail.current_step, step?.nodeId || null, step?.name || 'SLA 催辦', comment);

        reminded.push({
          id: row.id,
          title: row.title,
          step_name: step?.name || '審核關卡',
          hoursInStep: Math.round(hoursInStep * 10) / 10,
        });

        console.log(`[SLA] 單據 #${row.id}（${row.title}）逾時 ${Math.floor(hoursInStep)}h，已自動催辦`);
      } catch (err) {
        console.error(`[SLA] 催辦單據 #${row.id} 失敗：`, err.message);
      }
    }
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    totalPending: rows.length,
    remindedCount: reminded.length,
    reminded,
    examined,
  };
}

/**
 * 啟動 SLA 自動排程巡檢（預設每 30 分鐘執行一次）
 */
function startSlaScheduler(intervalMinutes = 30) {
  if (process.env.SLA_DISABLED === '1') {
    console.log('[SLA] 系統已設定 SLA_DISABLED=1，排程未啟動');
    return;
  }
  if (timer) clearInterval(timer);

  const ms = Math.max(Number(intervalMinutes) || 30, 5) * 60 * 1000;
  console.log(`[SLA] 逾時自動催辦排程已啟動，檢查間隔：${intervalMinutes} 分鐘`);

  // 伺服器啟動後 1 分鐘進行初次檢查
  setTimeout(() => {
    runSlaCheck().catch((err) => console.error('[SLA] 初次檢查失敗：', err.message));
  }, 60000);

  // 定期定時檢查
  timer = setInterval(() => {
    runSlaCheck().catch((err) => console.error('[SLA] 定期檢查失敗：', err.message));
  }, ms);
}

function stopSlaScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runSlaCheck,
  startSlaScheduler,
  stopSlaScheduler,
};
