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

async function testClassicLoginAndClicks() {
  console.log(`\n========================================`);
  console.log(`Testing Classic Login & Clicking Features:`);
  console.log(`========================================`);

  const port = 9222;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_test_' + Date.now(),
    '--no-first-run',
    'about:blank',
  ]);

  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
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
        const type = msg.params.type;
        const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        console.log(`  [Console ${type}]: ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
        console.error(`🚨 [Console Exception]: ${desc}`);
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');

    console.log('1. 開啟首頁...');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    console.log('2. 輸入帳號密碼登入 (Admin / admin123)...');
    await send('Runtime.evaluate', {
      expression: `
        document.querySelector('input[name="username"]').value = 'Admin';
        document.querySelector('input[name="password"]').value = 'admin123';
        document.querySelector('#login-form button[type="submit"]').click();
      `,
    });

    await new Promise(r => setTimeout(r, 3000));

    console.log('3. 檢查登入後狀態...');
    const afterLogin = await send('Runtime.evaluate', {
      expression: `({
        authHidden: document.getElementById('auth-view')?.classList.contains('hidden'),
        mainHidden: document.getElementById('main-view')?.classList.contains('hidden'),
        pageTitle: document.getElementById('page-title')?.textContent,
        userName: document.getElementById('user-name')?.textContent,
        token: localStorage.getItem('approval_token')?.slice(0, 15)
      })`,
      returnByValue: true,
    });
    console.log('登入後狀態:', afterLogin.result?.value);

    console.log('4. 依序點擊各功能選單 (nav-item)...');
    const navPages = [
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

    for (const pageName of navPages) {
      console.log(`  👉 點擊 [${pageName}]...`);
      await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.querySelector('[data-page="${pageName}"]');
          if (btn) btn.click();
          else console.error('找不到按鈕: ${pageName}');
        })()`,
      });
      await new Promise(r => setTimeout(r, 1000));

      const pageState = await send('Runtime.evaluate', {
        expression: `({
          pageTitle: document.getElementById('page-title').textContent,
          activeNav: document.querySelector('.nav-item.active')?.dataset.page,
          bodyContentLength: document.getElementById('page-body').innerHTML.length,
          hasError: document.querySelector('.error-msg') ? document.querySelector('.error-msg').textContent : false
        })`,
        returnByValue: true,
      });
      console.log(`     成果: 標題="${pageState.result?.value?.pageTitle}", active=${pageState.result?.value?.activeNav}, 錯誤=${pageState.result?.value?.hasError || '無'}`);
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

testClassicLoginAndClicks().catch(console.error);
