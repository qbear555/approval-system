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

async function testUrl(targetUrl) {
  console.log(`\n========================================`);
  console.log(`Testing URL: ${targetUrl}`);
  console.log(`========================================`);

  const port = 9222;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_test_' + Date.now(),
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  // Wait for edge to start
  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = list[0];
    if (!page || !page.webSocketDebuggerUrl) {
      throw new Error('No page found: ' + JSON.stringify(list));
    }

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
        const type = msg.params.type;
        const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        console.log(`[Browser Console ${type.toUpperCase()}]: ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
        console.error(`🚨 [Browser Exception]: ${desc}`);
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');

    console.log('Navigating to ' + targetUrl + '...');
    await send('Page.navigate', { url: targetUrl });

    // Wait 3 seconds to let scripts run
    await new Promise(r => setTimeout(r, 3000));

    // Evaluate title and main content
    const evalRes = await send('Runtime.evaluate', {
      expression: `({
        title: document.title,
        authViewHidden: document.getElementById('auth-view')?.classList.contains('hidden'),
        mainViewHidden: document.getElementById('main-view')?.classList.contains('hidden'),
        pageTitle: document.getElementById('page-title')?.textContent,
        token: localStorage.getItem('approval_token'),
        navItemCount: document.querySelectorAll('.nav-item').length
      })`,
      returnByValue: true,
    });
    console.log('Page state evaluation:\n', evalRes.result?.value);

    ws.close();
  } finally {
    edge.kill();
  }
}

async function main() {
  await testUrl('http://192.168.99.220:3847/');
  await testUrl('http://192.168.99.220:3847/v2/');
}

main().catch(console.error);
