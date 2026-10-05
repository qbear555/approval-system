const db = require('./db');

const CATEGORIES = ['auth', 'approval', 'user_management', 'workflow', 'system', 'general'];

function normalizeClientIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  // [::1]:port / 127.0.0.1:port
  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.replace(/:\d+$/, '');
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') ip = '127.0.0.1';
  return ip;
}

function clientIp(req) {
  if (!req) return '';
  const xf = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const raw = xf || req.socket?.remoteAddress || req.ip || '';
  return normalizeClientIp(raw);
}

function htmlToPlainText(raw) {
  let s = String(raw ?? '');
  if (!s) return '';
  if (!/<[a-z][\s\S]*>/i.test(s) && !/&(?:nbsp|lt|gt|amp|quot|#39);/i.test(s)) {
    return s.replace(/\s+/g, ' ').trim();
  }
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*\/\s*(td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 寫入系統稽核日誌 (寫入標準 system_audit_logs 表)
 */
function write(opts = {}, req = null) {
  try {
    const rawCat = opts.category || 'system';
    const category = CATEGORIES.includes(rawCat) ? rawCat : 'general';
    const actionType = String(opts.action_type || opts.action || 'system').slice(0, 50);
    const user = opts.user || req?.user || null;
    const userId = opts.userId != null ? Number(opts.userId) : (user?.id ? Number(user.id) : null);
    const userName = opts.userName != null ? String(opts.userName) : (user?.name || (userId ? '' : '系統/訪客'));
    const userUsername = opts.userUsername != null ? String(opts.userUsername) : (user?.username || '');
    const ip = normalizeClientIp(opts.ip != null ? opts.ip : clientIp(req));
    const targetId = opts.target_id != null ? Number(opts.target_id) : (opts.targetId != null ? Number(opts.targetId) : null);
    const detailJson = typeof opts.detail === 'object' ? JSON.stringify(opts.detail) : (typeof opts.detail_json === 'string' ? opts.detail_json : '{}');
    const description = htmlToPlainText(opts.description || '').slice(0, 2000);

    db.prepare(
      `INSERT INTO system_audit_logs (user_id, user_name, user_username, action_type, category, description, ip_address, target_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, userName, userUsername, actionType, category, description, String(ip || '').slice(0, 80), targetId, detailJson);
  } catch (e) {
    console.warn('[audit-log] write failed:', e.message);
  }
}

/**
 * 查詢系統稽核日誌列表
 */
function list(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const offset = (page - 1) * limit;
  const q = String(query.q || '').trim();
  const category = String(query.category || '').trim();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();

  const where = [];
  const params = [];
  if (category && CATEGORIES.includes(category)) {
    where.push('category = ?');
    params.push(category);
  }
  if (q) {
    where.push(
      `(COALESCE(user_name,'') LIKE ? OR COALESCE(user_username,'') LIKE ? OR COALESCE(ip_address,'') LIKE ? OR COALESCE(description,'') LIKE ? OR COALESCE(action_type,'') LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (dateFrom) {
    where.push(`created_at >= ?`);
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push(`created_at <= ?`);
    params.push(`${dateTo} 23:59:59`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalCount = db
    .prepare(`SELECT COUNT(*) AS n FROM system_audit_logs ${whereSql}`)
    .get(...params)?.n || 0;
  const logs = db
    .prepare(
      `SELECT id, category, action_type, user_id, user_name, user_username, ip_address, target_id, description, detail_json, created_at
       FROM system_audit_logs ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return {
    logs: logs.map((l) => ({
      ...l,
      ip_address: normalizeClientIp(l.ip_address) || l.ip_address || '',
      description: htmlToPlainText(l.description || ''),
    })),
    totalCount,
    totalPages,
    page,
    limit,
  };
}

/**
 * 匯出 CSV 報告 (UTF-8 BOM)
 */
function toCsv(query = {}) {
  const data = list({ ...query, page: 1, limit: 5000 });
  const labels = {
    auth: '帳號身份與登入',
    approval: '流程與簽核動作',
    user_management: '成員與權限變更',
    workflow: '簽核流程範本',
    system: '系統維運與設定',
    general: '一般紀錄',
  };
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['時間', '分類', '動作類型', '執行人員', '帳號', 'IP', '目標 ID', '說明'].map(esc).join(','),
    ...data.logs.map((l) =>
      [
        l.created_at,
        labels[l.category] || l.category || '一般',
        l.action_type || '',
        l.user_name || '系統/訪客',
        l.user_username || '',
        l.ip_address || '',
        l.target_id != null ? String(l.target_id) : '',
        l.description || '',
      ]
        .map(esc)
        .join(',')
    ),
  ];
  return '\uFEFF' + rows.join('\r\n');
}

module.exports = {
  write,
  logAudit: write,
  list,
  toCsv,
  CATEGORIES,
  clientIp,
  normalizeClientIp,
  htmlToPlainText,
};
