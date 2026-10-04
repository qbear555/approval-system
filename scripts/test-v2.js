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

async function testV2() {
  console.log('Testing Vue 3 /v2/...');
  const port = 9225;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_v2_' + Date.now(),
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
        console.log('[v2 Console]', msg.params.type, msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[v2 Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/v2/' });
    await new Promise(r => setTimeout(r, 3000));

    // Check what is rendered on /v2/
    const initial = await send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        title: document.title,
        bodyHtml: document.body.innerHTML.slice(0, 300),
        hasApp: !!document.getElementById('app')
      })`,
      returnByValue: true
    });
    console.log('Initial /v2/ state:', initial.result?.value);

    // Try login on /v2/
    console.log('Trying login on /v2/...');
    const loginResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const usernameInput = document.querySelector('input[type="text"], input[name="username"], #username');
        const passwordInput = document.querySelector('input[type="password"], input[name="password"], #password');
        const submitBtn = document.querySelector('button[type="submit"], .btn-primary, form button');
        return {
          hasUser: !!usernameInput,
          hasPass: !!passwordInput,
          hasBtn: !!submitBtn,
          formHtml: document.querySelector('form')?.outerHTML?.slice(0, 200)
        };
      })()`,
      returnByValue: true
    });
    console.log('Login form elements on /v2/:', loginResult.result?.value);

    if (loginResult.result?.value?.hasUser) {
      await send('Runtime.evaluate', {
        expression: `
          const u = document.querySelector('input[type="text"], input[name="username"], #username');
          const p = document.querySelector('input[type="password"], input[name="password"], #password');
          u.value = 'Admin';
          u.dispatchEvent(new Event('input', { bubbles: true }));
          p.value = 'admin123';
          p.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.querySelector('button[type="submit"], .btn-primary, form button');
          btn.click();
        `
      });
      await new Promise(r => setTimeout(r, 3000));

      const afterLogin = await send('Runtime.evaluate', {
        expression: `({
          url: window.location.href,
          sidebarLinks: Array.from(document.querySelectorAll('a, button')).map(el => ({
            tag: el.tagName,
            text: el.innerText.trim(),
            href: el.getAttribute('href'),
            class: el.className
          })).filter(x => x.text)
        })`,
        returnByValue: true
      });
      console.log('After login URL:', afterLogin.result?.value?.url);
      console.log('Clickable elements found:', afterLogin.result?.value?.sidebarLinks?.length);
      console.log('Elements sample:', afterLogin.result?.value?.sidebarLinks?.slice(0, 15));

      // Test clicking each link/nav item
      const links = afterLogin.result?.value?.sidebarLinks || [];
      for (const item of links.slice(0, 10)) {
        if (!item.text || item.text === '登出') continue;
        console.log(`Testing click on "${item.text}"...`);
        const clickRes = await send('Runtime.evaluate', {
          expression: `(() => {
            const el = Array.from(document.querySelectorAll('a, button')).find(e => e.innerText.trim().includes(${JSON.stringify(item.text)}));
            if (!el) return { found: false };
            el.click();
            return { found: true };
          })()`,
          returnByValue: true
        });
        await new Promise(r => setTimeout(r, 1000));
        const currentUrl = await send('Runtime.evaluate', {
          expression: 'window.location.href',
          returnByValue: true
        });
        console.log(`  -> URL after click: ${currentUrl.result?.value}`);
      }
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

testV2().catch(console.error);
