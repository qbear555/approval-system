const { spawn } = require('child_process');
const http = require('http');

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

async function testAllClassic() {
  const port = 9226;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_classic_' + Date.now(),
    '--no-first-run',
    'about:blank',
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson('http://127.0.0.1:' + port + '/json/list');
    const page = list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === id) {
            ws.removeEventListener('message', handler);
            resolve(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[Classic Console]', msg.params.type, msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Classic Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    // Wait for login form
    await send('Runtime.evaluate', {
      expression: `
        document.querySelector('input[name="username"]').value = 'Admin';
        document.querySelector('input[name="password"]').value = 'admin123';
        document.querySelector('#login-form button[type="submit"]').click();
      `
    });
    await new Promise(r => setTimeout(r, 2500));

    const pages = [
      'dashboard',
      'inbox',
      'mine',
      'records',
      'new-request',
      'workflows',
      'backups',
      'leave-report',
      'users',
      'departments',
      'settings',
      'system-settings',
    ];

    for (const p of pages) {
      console.log(`Testing Classic click [${p}]...`);
      const res = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.querySelector('[data-page="${p}"]');
          if (!btn) return { found: false };
          btn.click();
          return { found: true };
        })()`,
        returnByValue: true
      });
      await new Promise(r => setTimeout(r, 1000));
      const status = await send('Runtime.evaluate', {
        expression: `({
          pageTitle: document.getElementById('page-title')?.textContent,
          statePage: window.appState?.page,
          activeNav: document.querySelector('.nav-item.active')?.dataset?.page,
          hasError: document.querySelector('.error-msg')?.textContent || null
        })`,
        returnByValue: true
      });
      console.log(`  -> Result for ${p}:`, status.result?.value);
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

testAllClassic().catch(console.error);
