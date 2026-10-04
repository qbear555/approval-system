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
        res.on('end', () =>
          resolve({ status: res.statusCode, raw, headers: res.headers })
        );
      })
      .on('error', reject);
  });
}

function mustExist(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('缺少檔案 ' + rel);
}

const required = [
  'server/db-adapter/index.js',
  'server/db-adapter/dialect.js',
  'server/db-adapter/schema.js',
  'server/db-adapter/mysql.js',
  'server/db-adapter/mysql-worker.js',
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
  'server/routes/attachments.js',
  'server/routes/actions.js',
  'server/routes/actions-extra.js',
  'server/routes/actions-ack.js',
  'server/routes/pdf-download.js',
  'server/routes/backups.js',
  'server/routes/audit.js',
  'server/routes/request-helpers.js',
  'server/pdf/write.js',
  'server/pdf/filename.js',
  'server/pdf/stamp.js',
  'server/pdf/forms/leave.js',
  'server/pdf/forms/purchase.js',
  'server/pdf/forms/credit.js',
  'server/pdf/forms/standard.js',
  'public/js/pages-users.js',
  'public/js/pages-audit.js',
  'public/js/pages-departments.js',
  'public/js/pages-settings.js',
  'public/js/pages-line.js',
  'public/js/pages-system.js',
  'public/js/pages-request-fields.js',
  'public/js/pages-request-table.js',
  'public/js/pages-request-view.js',
  'public/js/pages-request-list.js',
  'public/js/pages-request-new.js',
  'public/js/pages-request-detail.js',
];
for (const rel of required) mustExist(rel);
if (fs.existsSync(path.join(ROOT, 'public/js/pages-admin.js'))) {
  throw new Error('pages-admin.js 應已拆走');
}
if (fs.existsSync(path.join(ROOT, 'public/js/pages-requests.js'))) {
  throw new Error('pages-requests.js 應已拆走');
}
if (fs.existsSync(path.join(ROOT, 'public/js/pages-request-form.js'))) {
  throw new Error('pages-request-form.js 應已拆走');
}
{
  const reqSrc = fs.readFileSync(path.join(ROOT, 'server/routes/requests.js'), 'utf8');
  if (!reqSrc.includes('/api/requests/:id/restore')) {
    throw new Error('缺少軟刪還原路由');
  }
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
      'tw-calendar.js',
      'rich-editor.js',
      'ui-helpers.js',
      'app.js',
      'flow-editor.js',
    ]) {
      if (!home.raw.includes(name)) throw new Error('index.html 未載入 ' + name);
    }
    const csp = String(home.headers['content-security-policy'] || '');
    if (!csp.includes("default-src 'self'")) throw new Error('缺少 CSP');
    if (!/frame-src[^;]*blob:/.test(csp)) throw new Error('CSP frame-src 未放行 blob（PDF 預覽會被擋）');
    if (!/object-src[^;]*blob:/.test(csp)) throw new Error('CSP object-src 未放行 blob（Chrome PDF 檢視器會被擋）');
    if (String(home.headers['x-content-type-options'] || '') !== 'nosniff') {
      throw new Error('缺少 X-Content-Type-Options: nosniff');
    }
    const notifySt = await req('/api/system/notify-status');
    if (notifySt.status !== 401) throw new Error('notify-status should 401, got ' + notifySt.status);
    const base = runtime.getAppBaseUrl();
    if (!/^https?:\/\//.test(String(base || ''))) throw new Error('getAppBaseUrl 無效: ' + base);
    runtime.resolveFinalNotifyJson({ enabled: false });
    const fake = runtime.publicUser({
      id: 1,
      username: 'admin',
      name: '系統管理員',
      role: 'admin',
      active: 1,
      email: '',
    });
    if (!fake || !fake.username) throw new Error('publicUser 失敗');
    runtime.getGrantorUserIdsForDelegate(1);
    const brand = await req('/api/system/branding');
    if (brand.status !== 200) throw new Error('branding ' + brand.status);
    const deptPub = await req('/api/departments');
    if (deptPub.status !== 200) throw new Error('departments should 200, got ' + deptPub.status);
    const dept = await req('/api/departments/stats');
    if (dept.status !== 401) throw new Error('departments/stats should 401, got ' + dept.status);
    const me = await req('/api/auth/me');
    if (me.status !== 401) throw new Error('/api/auth/me should 401, got ' + me.status);
    const hook = await req('/line/webhook');
    if (hook.status !== 200 || !hook.raw.includes('approval-line-webhook-proxy')) {
      throw new Error('/line/webhook 探活失敗 ' + hook.status);
    }
    const { spawnSync } = require('child_process');
    const vn = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-notify.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (vn.status !== 0) throw new Error('verify-notify 失敗: ' + (vn.stderr || vn.stdout || '').slice(0, 300));
    if (!String(vn.stdout || '').includes('"mail"')) throw new Error('verify-notify 輸出異常');
    const fontMod = require(path.join(ROOT, 'server/pdf/font'));
    const fontPath = fontMod.getChineseFontPath();
    if (!fontPath) throw new Error('找不到可用中文字型');
    if (fontMod.isRejectedCjkFont(fontPath)) {
      throw new Error('誤選 Ext-B 字型: ' + fontPath);
    }
    const deng = path.join(ROOT, 'fonts', 'Deng.ttf');
    if (fs.existsSync(deng) && path.normalize(fontPath) !== path.normalize(deng)) {
      throw new Error('應優先使用 fonts/Deng.ttf，實際: ' + fontPath);
    }
    const pdf = require(path.join(ROOT, 'server/pdf'));
    if (typeof pdf.writeApprovalPdf !== 'function') throw new Error('pdf.writeApprovalPdf 缺失');
    const { PassThrough } = require('stream');
    const sink = new PassThrough();
    sink.resume();
    await pdf.writeApprovalPdf(
      {
        id: 1,
        workflow_name: '一般簽呈',
        title: '煙霧',
        status: 'pending',
        form_data: {},
        formFields: [],
        steps: [],
        actions: [],
      },
      sink
    );
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
