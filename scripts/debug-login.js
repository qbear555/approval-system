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

async function debugLogin() {
  const port = 9227;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_login_' + Date.now(),
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
        console.log('[Console]', msg.params.type, msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    // Check DOM on load
    const initDom = await send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        hasAuthView: !document.getElementById('auth-view')?.classList.contains('hidden'),
        hasMainView: !document.getElementById('main-view')?.classList.contains('hidden'),
        hasLoginForm: !!document.getElementById('login-form'),
        usernameVal: document.querySelector('input[name="username"]')?.value,
        token: localStorage.getItem('approval_token')
      })`,
      returnByValue: true
    });
    console.log('DOM on load:', initDom.result?.value);

    // Call login via API directly inside browser to see what happens
    const directLogin = await send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'Admin', password: 'admin123' })
          });
          const data = await res.json();
          if (data.token) {
            localStorage.setItem('approval_token', data.token);
            setAuth(data.token, data.user);
            showMain();
            return { ok: true, user: data.user.username };
          }
          return { ok: false, data };
        } catch (e) {
          return { ok: false, error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Direct login result:', directLogin.result?.value);

    await new Promise(r => setTimeout(r, 1000));
    const postLoginDom = await send('Runtime.evaluate', {
      expression: `({
        authHidden: document.getElementById('auth-view')?.classList.contains('hidden'),
        mainHidden: document.getElementById('main-view')?.classList.contains('hidden'),
        pageTitle: document.getElementById('page-title')?.textContent,
        statePage: window.appState?.page,
        navCount: document.querySelectorAll('.nav-item').length
      })`,
      returnByValue: true
    });
    console.log('DOM after showMain:', postLoginDom.result?.value);

    // Now test clicking on 'inbox'
    console.log('Clicking inbox...');
    const clickInbox = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('[data-page="inbox"]');
        if (!btn) return { found: false };
        btn.click();
        return { found: true };
      })()`,
      returnByValue: true
    });
    console.log('Click inbox returned:', clickInbox.result?.value);

    await new Promise(r => setTimeout(r, 1500));
    const postInbox = await send('Runtime.evaluate', {
      expression: `({
        pageTitle: document.getElementById('page-title')?.textContent,
        statePage: window.appState?.page,
        bodyLen: document.getElementById('page-body')?.innerHTML?.length
      })`,
      returnByValue: true
    });
    console.log('DOM after inbox click:', postInbox.result?.value);

    ws.close();
  } finally {
    edge.kill();
  }
}

debugLogin().catch(console.error);
