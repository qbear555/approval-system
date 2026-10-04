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

async function run() {
  console.log('[1/4] Launching headless browser to test unified Vue 3 at root / ...');
  const port = 9334;
  const proc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  let wsUrl = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json`);
      const pageTarget = list && list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!wsUrl) {
    proc.kill();
    throw new Error('Edge CDP not available');
  }

  const ws = new globalThis.WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let idCounter = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      const handler = (evt) => {
        const data = JSON.parse(evt.data.toString());
        if (data.id === id) {
          ws.removeEventListener('message', handler);
          if (data.error) reject(new Error(JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result ? res.result.value : null;
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[2/4] Navigating to http://127.0.0.1:3847/ ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    const curUrl = await evaluate('location.href');
    const isLogin = await evaluate('!!document.querySelector(".auth-card")');
    console.log('Current URL:', curUrl, '| Is Vue Login Card Present:', isLogin);

    if (!curUrl.includes('/login')) {
      throw new Error(`Expected redirect to /login, got ${curUrl}`);
    }

    console.log('[3/4] Testing Vue login as admin ...');
    await evaluate(`
      (() => {
        const u = document.querySelector('input[type="text"]');
        const p = document.querySelector('input[type="password"]');
        const b = document.querySelector('button[type="submit"]');
        u.value = 'admin';
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.value = 'admin123';
        p.dispatchEvent(new Event('input', { bubbles: true }));
        b.click();
      })()
    `);

    await new Promise(r => setTimeout(r, 2500));
    const afterLoginUrl = await evaluate('location.href');
    const hasSidebar = await evaluate('!!document.querySelector(".sidebar")');
    console.log('After Login URL:', afterLoginUrl, '| Has Sidebar:', hasSidebar);

    if (!afterLoginUrl.includes('/dashboard')) {
      throw new Error(`Expected /dashboard after login, got ${afterLoginUrl}`);
    }

    console.log('[4/4] Testing navigation to /workflows ...');
    await evaluate(`window.location.assign('/workflows')`);
    await new Promise(r => setTimeout(r, 2500));
    const wfUrl = await evaluate('location.href');
    const pageTitle = await evaluate('document.querySelector(".page-header h2")?.textContent');
    console.log('Workflow Page URL:', wfUrl, '| Page Title:', pageTitle);

    console.log('🎉 Unified Vue 3 at root verified successfully!');
  } finally {
    ws.close();
    proc.kill();
  }
}

run().catch(e => {
  console.error('Test Failed:', e);
  process.exit(1);
});
