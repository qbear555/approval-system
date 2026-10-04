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

async function debugClicks() {
  const port = 9224;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_debug_' + Date.now(),
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
        console.log('[Browser Console]', msg.params.type, msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    // Login
    await send('Runtime.evaluate', {
      expression: `
        document.querySelector('input[name="username"]').value = 'Admin';
        document.querySelector('input[name="password"]').value = 'admin123';
        document.querySelector('#login-form button[type="submit"]').click();
      `
    });
    await new Promise(r => setTimeout(r, 2500));

    // Diagnostic on nav items
    const diag = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('[data-page="inbox"]');
        return {
          btnExists: !!btn,
          btnDisplay: window.getComputedStyle(btn).display,
          btnDisabled: btn?.disabled,
          hasOnclick: !!btn?.onclick,
          onclickStr: btn?.onclick?.toString(),
          windowNavigate: typeof window.navigate,
          statePage: window.appState?.page,
          user: window.appState?.user
        };
      })()`,
      returnByValue: true
    });
    console.log('Diagnostic result:', diag.result?.value);

    // Now try manual click
    console.log('Attempting btn.click()...');
    const testClick = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('[data-page="inbox"]');
        try {
          btn.click();
          return { clicked: true };
        } catch (e) {
          return { clicked: false, error: e.message, stack: e.stack };
        }
      })()`,
      returnByValue: true
    });
    console.log('Test click result:', testClick.result?.value);

    await new Promise(r => setTimeout(r, 1000));
    const titleAfter = await send('Runtime.evaluate', {
      expression: `({
        title: document.getElementById('page-title')?.textContent,
        statePage: window.appState?.page,
        bodyHtmlSnippet: document.getElementById('page-body')?.innerHTML?.slice(0, 100)
      })`,
      returnByValue: true
    });
    console.log('State after 1s:', titleAfter.result?.value);

    // What if we call navigate('inbox') directly?
    console.log('Attempting direct navigate call...');
    const directNav = await send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          if (typeof navigate === 'function') {
            await navigate('inbox');
            return { ok: true, via: 'navigate' };
          } else if (typeof window.navigate === 'function') {
            await window.navigate('inbox');
            return { ok: true, via: 'window.navigate' };
          } else {
            return { ok: false, error: 'neither navigate nor window.navigate is a function' };
          }
        } catch (e) {
          return { ok: false, error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Direct nav result:', directNav.result?.value);

    await new Promise(r => setTimeout(r, 1000));
    const titleAfterDirect = await send('Runtime.evaluate', {
      expression: `({
        title: document.getElementById('page-title')?.textContent,
        statePage: window.appState?.page,
        bodyHtmlSnippet: document.getElementById('page-body')?.innerHTML?.slice(0, 100)
      })`,
      returnByValue: true
    });
    console.log('State after direct nav:', titleAfterDirect.result?.value);

    ws.close();
  } finally {
    edge.kill();
  }
}

debugClicks().catch(console.error);
