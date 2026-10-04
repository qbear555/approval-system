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

async function debugLegacyHost() {
  const port = 9228;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_lh_' + Date.now(),
    '--no-first-run',
    'about:blank',
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson('http://127.0.0.1:' + port + '/json/list');
    const page = list.find(p => p.type === 'page') || list[0];
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
        console.log('[v2 Console]', msg.params.type, msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[v2 Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/v2/' });
    await new Promise(r => setTimeout(r, 2000));

    // Login on /v2/
    await send('Runtime.evaluate', {
      expression: `
        const u = document.querySelector('input[type="text"], input[name="username"], #username');
        const p = document.querySelector('input[type="password"], input[name="password"], #password');
        u.value = 'Admin';
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.value = 'admin123';
        p.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('button[type="submit"], .btn-primary, form button').click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Now click '新增申請'
    console.log('Clicking 新增申請 link in Sidebar...');
    await send('Runtime.evaluate', {
      expression: `
        const link = Array.from(document.querySelectorAll('a')).find(a => a.innerText.trim().includes('新增申請'));
        if (link) link.click();
      `
    });
    await new Promise(r => setTimeout(r, 3000));

    // Inspect what's rendered in LegacyHost
    const state = await send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        pageTitle: document.getElementById('page-title')?.textContent,
        bodyHtmlSnippet: document.getElementById('page-body')?.innerHTML?.slice(0, 300),
        navItems: Array.from(document.querySelectorAll('.nav-item')).map(n => ({
          text: n.innerText.trim(),
          tagName: n.tagName,
          datasetPage: n.dataset?.page,
          hasOnclick: !!n.onclick,
          classes: n.className
        })),
        hasLegacyRoot: !!document.getElementById('legacy-root'),
        hasLoginForm: !!document.getElementById('login-form')
      })`,
      returnByValue: true
    });
    console.log('State in LegacyHost:', JSON.stringify(state.result?.value, null, 2));

    ws.close();
  } finally {
    edge.kill();
  }
}

debugLegacyHost().catch(console.error);
