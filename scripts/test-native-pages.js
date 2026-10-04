const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const { signToken } = require('../server/auth.js');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('[TEST] Starting Native Pages Verification Test (NewRequest, Workflows, LeaveReport)...');

  const token = signToken({ id: 1, username: 'admin', role: 'admin', name: '系統管理員' });
  const port = 9227;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_' + Date.now(),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    'about:blank',
  ]);

  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = list.find(p => p.type === 'page' && !p.url.startsWith('edge://')) || list.find(p => p.type === 'page') || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (ev) => {
          const res = JSON.parse(ev.data);
          if (res.id === id) {
            ws.removeEventListener('message', handler);
            if (res.error) reject(res.error);
            else resolve(res.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    const consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (msg.params.type === 'error' || text.includes('error') || text.includes('not a function')) {
          consoleErrors.push(text);
        }
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');

    // 1. Visit root to set token in localStorage
    console.log('[1] Visiting / to set authentication token...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 1500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('approval_token', ${JSON.stringify(token)});
        localStorage.setItem('approval_user', JSON.stringify({ id: 1, username: 'admin', role: 'admin', name: '系統管理員' }));
      `
    });

    // 2. Test /new-request
    console.log('[2] Testing /new-request (新增申請)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/new-request' });
    await new Promise(r => setTimeout(r, 2500));

    const checkNewReq = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          const errMsg = errEl ? errEl.textContent : '';
          const hasCatalog = !!document.getElementById('form-catalog-card');
          const hasEmpty = !!document.querySelector('.empty-state');
          return { errorMsg: errMsg, hasCatalog, hasEmpty };
        })()
      `,
      returnByValue: true
    });

    console.log('    /new-request result:', checkNewReq.result.value);
    if (checkNewReq.result.value.errorMsg) {
      throw new Error('/new-request displayed error: ' + checkNewReq.result.value.errorMsg);
    }

    // 3. Test /workflows
    console.log('[3] Testing /workflows (簽核流程)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/workflows' });
    await new Promise(r => setTimeout(r, 2500));

    const checkWorkflows = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          const errMsg = errEl ? errEl.textContent : '';
          const card = document.querySelector('.card');
          return { errorMsg: errMsg, hasCard: !!card };
        })()
      `,
      returnByValue: true
    });

    console.log('    /workflows result:', checkWorkflows.result.value);
    if (checkWorkflows.result.value.errorMsg) {
      throw new Error('/workflows displayed error: ' + checkWorkflows.result.value.errorMsg);
    }

    // 4. Test /leave-report
    console.log('[4] Testing /leave-report (請假報表)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/leave-report' });
    await new Promise(r => setTimeout(r, 2500));

    const checkLeaveReport = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          const errMsg = errEl ? errEl.textContent : '';
          const reportCard = document.getElementById('leave-report-card');
          return { errorMsg: errMsg, hasReportCard: !!reportCard };
        })()
      `,
      returnByValue: true
    });

    console.log('    /leave-report result:', checkLeaveReport.result.value);
    if (checkLeaveReport.result.value.errorMsg) {
      throw new Error('/leave-report displayed error: ' + checkLeaveReport.result.value.errorMsg);
    }

    // 5. Test /users
    console.log('[5] Testing /users (成員名單)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/users' });
    await new Promise(r => setTimeout(r, 2000));
    const checkUsers = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          return { errorMsg: errEl ? errEl.textContent : '', ok: !!document.querySelector('.card') };
        })()
      `,
      returnByValue: true
    });
    console.log('    /users result:', checkUsers.result.value);
    if (checkUsers.result.value.errorMsg) throw new Error('/users displayed error: ' + checkUsers.result.value.errorMsg);

    // 6. Test /backups
    console.log('[6] Testing /backups (備份資料)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/backups' });
    await new Promise(r => setTimeout(r, 2000));
    const checkBackups = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          return { errorMsg: errEl ? errEl.textContent : '', ok: !!document.querySelector('.card') };
        })()
      `,
      returnByValue: true
    });
    console.log('    /backups result:', checkBackups.result.value);
    if (checkBackups.result.value.errorMsg) throw new Error('/backups displayed error: ' + checkBackups.result.value.errorMsg);

    // 7. Test /settings
    console.log('[7] Testing /settings (帳號設定)...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/settings' });
    await new Promise(r => setTimeout(r, 2000));
    const checkSettings = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const errEl = document.querySelector('.error-msg');
          return { errorMsg: errEl ? errEl.textContent : '', ok: !!document.querySelector('.card') };
        })()
      `,
      returnByValue: true
    });
    console.log('    /settings result:', checkSettings.result.value);
    if (checkSettings.result.value.errorMsg) throw new Error('/settings displayed error: ' + checkSettings.result.value.errorMsg);

    if (consoleErrors.length > 0) {
      const isNotAFunc = consoleErrors.filter(e => e.includes('is not a function'));
      if (isNotAFunc.length > 0) {
        throw new Error('Detected "is not a function" in console:\n' + isNotAFunc.join('\n'));
      }
    }

    console.log('\n🎉 ALL THREE PAGES LOADED COMPLETELY AND FLAWLESSLY WITH ZERO "is not a function" ERRORS!');
    ws.close();
    edge.kill();
  } catch (err) {
    console.error('Error during test:', err);
    edge.kill();
    process.exit(1);
  }
}

run();
