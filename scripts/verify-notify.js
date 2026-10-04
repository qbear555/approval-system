/**
 * 通知通道狀態＋可選實寄測試（只寄給內建 Admin 自己，不群發）。
 *
 *   node scripts/verify-notify.js           # 只檢查狀態
 *   node scripts/verify-notify.js --send    # 寄測試信／LINE 測試給 Admin
 *
 * 不含密鑰輸出。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const mail = require('../server/mail');
const lineNotify = require('../server/line-notify');
const db = require('../server/db');
const { getAppBaseUrl } = require('../server/runtime');

function maskEmail(e) {
  const s = String(e || '');
  const i = s.indexOf('@');
  if (i < 2) return s ? '***' : '';
  return `${s[0]}***${s.slice(i)}`;
}

function adminRow() {
  return (
    db
      .prepare(
        `SELECT id, username, name, email FROM users
         WHERE lower(username) = 'admin' AND active = 1 LIMIT 1`
      )
      .get() || null
  );
}

async function main() {
  const send = process.argv.includes('--send');
  const mailPub = mail.publicConfig();
  const linePub = lineNotify.publicConfig();
  const admin = adminRow();
  const report = {
    baseUrl: getAppBaseUrl(),
    mail: {
      enabled: mailPub.enabled,
      ready: mailPub.ready,
      host: mailPub.host || '',
      from: mailPub.from || '',
      hasPass: mailPub.hasPass,
    },
    line: {
      enabled: linePub.enabled,
      ready: linePub.ready,
      serviceUrl: linePub.serviceUrl || '',
      hasApiKey: linePub.hasApiKey,
      events: linePub.events,
    },
    admin: admin
      ? { username: admin.username, email: maskEmail(admin.email) }
      : null,
    send,
  };

  if (!send) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const results = { ...report, tests: {} };

  if (!admin) {
    results.tests.mail = { ok: false, error: '找不到 Admin' };
    results.tests.line = { ok: false, error: '找不到 Admin' };
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = 1;
    return;
  }

  if (mail.isEnabled() && admin.email) {
    try {
      const r = await mail.sendMail({
        to: admin.email,
        subject: '【簽核系統】通知通道測試信',
        text: `您好 ${admin.name || 'Admin'}，\n\n這是通知通道驗證測試信。若收到表示 Email 可用。\n`,
        html: `<p>您好 <strong>${admin.name || 'Admin'}</strong>，</p><p>這是通知通道驗證測試信。若收到表示 Email 可用。</p>`,
        meta: { type: 'test', verify: true },
      });
      results.tests.mail = {
        ok: !!(r && r.ok),
        mode: r?.mode || null,
        error: r?.error || null,
        to: maskEmail(admin.email),
      };
    } catch (e) {
      results.tests.mail = { ok: false, error: e.message };
    }
  } else {
    results.tests.mail = {
      ok: false,
      skipped: true,
      reason: !mail.isEnabled() ? 'mail_disabled' : 'admin_no_email',
    };
  }

  if (lineNotify.isReady()) {
    try {
      const r = await lineNotify.testPush({
        username: admin.username,
        text: '【簽核系統】通知通道測試：若看到此則，表示 LINE 推播可用。',
      });
      results.tests.line = {
        ok: !!(r && r.ok),
        error: r?.error || null,
        username: admin.username,
      };
    } catch (e) {
      results.tests.line = { ok: false, error: e.message };
    }
  } else {
    results.tests.line = { ok: false, skipped: true, reason: 'line_not_ready' };
  }

  results.tests.desktop = {
    ok: true,
    note: '桌面通知／中央彈窗在瀏覽器登入後輪詢；請 Ctrl+F5 後待簽核增加時確認',
  };

  console.log(JSON.stringify(results, null, 2));
  const mailFail = results.tests.mail && !results.tests.mail.ok && !results.tests.mail.skipped;
  const lineFail = results.tests.line && !results.tests.line.ok && !results.tests.line.skipped;
  if (mailFail || lineFail) process.exitCode = 1;
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
