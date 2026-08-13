/**
 * 可重複跑的煙霧測試（不碰 data 內容）。
 *   node scripts/smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3957);

function req(p) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port: PORT, path: p, timeout: 8000 }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      })
      .on('error', reject);
  });
}

function mustExist(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('缺少檔案 ' + rel);
}

const required = [
  'server/runtime.js',
  'server/runtime/devices.js',
  'server/runtime/perms.js',
  'server/runtime/flow.js',
  'server/runtime/notify.js',
  'server/routes/auth.js',
  'server/routes/users.js',
  'server/routes/departments.js',
  'server/routes/system.js',
  'server/routes/workflows.js',
  'server/routes/requests.js',
  'public/js/pages-users.js',
  'public/js/pages-audit.js',
  'public/js/pages-departments.js',
  'public/js/pages-settings.js',
];
for (const rel of required) mustExist(rel);
if (fs.existsSync(path.join(ROOT, 'public/js/pages-admin.js'))) {
  throw new Error('pages-admin.js 應已拆走');
}

const runtime = require(path.join(ROOT, 'server/runtime'));
for (const name of [
  'getClientIp',
  'logAudit',
  'parsePermissions',
  'requirePerm',
  'parseSteps',
  'parseStepCondition',
  'notifyCurrentApprovers',
  'getRequestDetail',
]) {
  if (typeof runtime[name] !== 'function' && runtime[name] == null) {
    throw new Error('runtime 缺少 ' + name);
  }
}

const child = spawn(process.execPath, ['start-server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HTTPS_ENABLED: '0', TZ: 'Asia/Taipei' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));

(async () => {
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const h = await req('/health');
        if (h.status === 200 && h.raw.includes('"ok":true')) break;
      } catch {
        /* wait */
      }
      if (i === 49) throw new Error('server not up');
      await new Promise((r) => setTimeout(r, 250));
    }
    const home = await req('/');
    for (const name of [
      'pages-users.js',
      'pages-audit.js',
      'pages-departments.js',
      'pages-settings.js',
      'pages-dashboard.js',
      'pages-requests.js',
      'pages-workflows.js',
      'pages-backups.js',
    ]) {
      if (!home.raw.includes(name)) throw new Error('index.html 未載入 ' + name);
    }
    if (home.raw.includes('pages-admin.js')) throw new Error('index.html 仍載入 pages-admin.js');
    const brand = await req('/api/system/branding');
    if (brand.status !== 200) throw new Error('branding ' + brand.status);
    const dept = await req('/api/departments');
    if (dept.status !== 401) throw new Error('departments should 401, got ' + dept.status);
    const me = await req('/api/auth/me');
    if (me.status !== 401) throw new Error('/api/auth/me should 401, got ' + me.status);
    console.log('煙霧測試通過');
  } catch (e) {
    console.error('失敗:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(process.exitCode || 0), 400);
  }
})();
