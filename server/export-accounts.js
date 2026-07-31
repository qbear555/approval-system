/**
 * 匯出所有啟用中成員：姓名、帳號、密碼、部門 → 桌面 Excel
 * 注意：密碼以雜湊儲存，無法還原；匯出時會同步為表中所列預設密碼。
 */
const db = require('./db');
const { hashPassword } = require('./auth');
const XLSX = require('xlsx');
const path = require('path');
const os = require('os');
const fs = require('fs');

const KNOWN = {
  admin: 'admin123',
};

function defaultPassword(username) {
  if (KNOWN[username]) return KNOWN[username];
  return 'pass1234';
}

function getDesktopDir() {
  // Windows 實際桌面可能在 OneDrive / 其他磁碟
  const candidates = [
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop'),
    process.env.OneDrive && path.join(process.env.OneDrive, 'Desktop'),
    path.join(os.homedir(), 'Desktop'),
    'F:\\TsuMing\\Desktop',
    'C:\\Users\\TsuMing\\Desktop',
  ].filter(Boolean);
  for (const d of candidates) {
    if (d && fs.existsSync(d)) return d;
  }
  return path.join(os.homedir(), 'Desktop');
}

function getUserDepartments(userId) {
  return db
    .prepare(
      `SELECT department FROM user_departments WHERE user_id = ? ORDER BY department COLLATE NOCASE`
    )
    .all(userId)
    .map((r) => r.department);
}

const users = db
  .prepare(
    `SELECT id, username, name, department, role, active, email, created_at
     FROM users WHERE active = 1 ORDER BY id`
  )
  .all();

const upd = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const rows = users.map((u, i) => {
  const pwd = defaultPassword(u.username);
  upd.run(hashPassword(pwd), u.id);
  const depts = getUserDepartments(u.id);
  const deptDisplay =
    depts.length > 0
      ? depts.join('、')
      : u.department || '';
  return {
    序號: i + 1,
    姓名: u.name,
    帳號: u.username,
    密碼: pwd,
    部門: deptDisplay,
    主部門: u.department || '',
    Email: u.email || '',
    角色: u.role === 'admin' ? '系統管理員' : '一般使用者',
    建立時間: u.created_at || '',
    備註:
      u.username === 'admin'
        ? '系統預設管理員；密碼 admin123'
        : '已同步為預設密碼 pass1234（請登入後至帳號設定自行修改）',
  };
});

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [
  { wch: 6 },
  { wch: 12 },
  { wch: 14 },
  { wch: 12 },
  { wch: 28 },
  { wch: 12 },
  { wch: 24 },
  { wch: 12 },
  { wch: 20 },
  { wch: 44 },
];
XLSX.utils.book_append_sheet(wb, ws, '帳號密碼');

const now = new Date().toLocaleString('zh-TW', { hour12: false });
const note = XLSX.utils.aoa_to_sheet([
  ['線上簽核系統 — 帳號密碼清冊'],
  ['產生時間', now],
  ['成員人數', String(rows.length)],
  ['系統網址', 'http://127.0.0.1:8080/'],
  [''],
  ['欄位說明'],
  ['姓名', '顯示名稱'],
  ['帳號', '登入用帳號'],
  ['密碼', '目前可登入的密碼（已與系統同步）'],
  ['部門', '隸屬部門（可多個，以、分隔）'],
  [''],
  ['重要說明'],
  ['1. 系統密碼以雜湊儲存，無法還原曾自行變更的密碼。'],
  ['2. 本次匯出已將各帳號密碼同步為本表所列值，請依此表登入。'],
  ['3. 管理員 admin 密碼為 admin123；其餘預設為 pass1234。'],
  ['4. 請妥善保管此檔，勿外流。'],
  ['5. 登入後建議至「帳號設定」自行修改密碼。'],
  ['6. 系統管理員亦可於「成員名單」幫他人修改密碼。'],
]);
note['!cols'] = [{ wch: 14 }, { wch: 64 }];
XLSX.utils.book_append_sheet(wb, note, '說明');

const desktop = getDesktopDir();
const out =
  process.argv[2] || path.join(desktop, '線上簽核系統_帳號密碼.xlsx');
XLSX.writeFile(wb, out);
console.log('WROTE', out);
console.log('COUNT', rows.length);
console.log('DESKTOP', desktop);
