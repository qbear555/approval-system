/**
 * 申請單檢視權限（列表／詳情／附件／PDF 共用）
 */
module.exports = function makeRequestHelpers(ctx) {
  const { db, isCreditLimitRequestRow, isFinanceUser, loadStepsForRequest } = ctx;

  /** 單據是否與登入使用者有關 */
  function isRequestRelatedToUser(row, userId) {
    const uid = Number(userId);
    if (!row || !uid) return false;
    if (Number(row.requester_id) === uid) return true;
    const acted = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND actor_id = ? LIMIT 1`
      )
      .get(row.id, uid);
    if (acted) return true;
    if (isCreditLimitRequestRow(row)) {
      const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
      if (isFinanceUser(user)) return true;
    }
    const fn = db
      .prepare(
        `SELECT id FROM final_notify_receipts WHERE request_id = ? AND user_id = ? LIMIT 1`
      )
      .get(row.id, uid);
    if (fn) return true;
    const steps =
      Array.isArray(row.steps) && row.steps.length ? row.steps : loadStepsForRequest(row);
    for (const s of steps) {
      if ((s.approverIds || []).map(Number).includes(uid)) return true;
    }
    return false;
  }

  return { isRequestRelatedToUser };
};
