const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
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
  console.log('[TEST] Starting Approved Request Picker (附加已核准申請單) Test...');

  const user = { id: 1, username: 'admin', role: 'admin', name: '系統管理員' };
  const token = signToken(user);
  const port = 9229;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_appr_' + Date.now(),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    'about:blank',
  ]);

  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = list.find(p => p.type === 'page' && !p.url.startsWith('edge://')) || list[0];
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
        if (msg.params.type === 'error' || text.includes('error') || text.includes('not a function') || text.includes('not defined')) {
          consoleErrors.push(text);
          console.error('[BROWSER CONSOLE ERROR]:', text);
        }
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[1] Setting token & visiting /new-request?workflowId=4 ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 1500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('approval_token', ${JSON.stringify(token)});
        localStorage.setItem('approval_user', JSON.stringify(${JSON.stringify(user)}));
      `
    });

    await send('Page.navigate', { url: 'http://127.0.0.1:3847/new-request?workflowId=4' });
    await new Promise(r => setTimeout(r, 2500));

    console.log('[2] Clicking "附加已核准申請單" button (#btn-pick-approved-req)...');
    const clickRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.querySelector('#btn-pick-approved-req');
          if (!btn) return { ok: false, error: '找不到 #btn-pick-approved-req 按鈕' };
          btn.click();
          return { ok: true };
        })()
      `,
      returnByValue: true,
    });
    console.log('Button click result:', clickRes.result.value);
    if (!clickRes.result.value.ok) throw new Error(clickRes.result.value.error);

    await new Promise(r => setTimeout(r, 2000));

    console.log('[3] Checking picker modal contents...');
    const modalCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const modal = document.querySelector('.modal');
          const list = document.querySelector('#appr-pick-list');
          const rows = list ? Array.from(list.querySelectorAll('.appr-pick-row')).map(r => {
            return {
              id: r.dataset.apprId,
              text: r.innerText.replace(/\\s+/g, ' ').trim()
            };
          }) : [];
          const errorMsg = list ? (list.querySelector('.error-msg')?.innerText || '') : '';
          return {
            hasModal: Boolean(modal),
            rowsCount: rows.length,
            sampleRows: rows.slice(0, 3),
            errorMsg
          };
        })()
      `,
      returnByValue: true,
    });

    console.log('Picker modal check result:', modalCheck.result.value);
    const result = modalCheck.result.value;

    if (!result.hasModal) {
      throw new Error('Picker modal did not open!');
    }
    if (result.errorMsg) {
      throw new Error('Picker modal showed error: ' + result.errorMsg);
    }
    if (result.rowsCount === 0) {
      throw new Error('Picker modal has NO rows (沒東西)!');
    }

    console.log(`🎉 SUCCESS: Modal loaded with ${result.rowsCount} approved requests! Sample:`, result.sampleRows[0]);
    ws.close();
    edge.kill();
    process.exit(0);
  } catch (err) {
    console.error('Test Failed:', err);
    edge.kill();
    process.exit(1);
  }
}

run();
