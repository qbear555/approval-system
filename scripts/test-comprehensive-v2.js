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

async function testComprehensive() {
  console.log('==============================================');
  console.log('全功能雙向切換全面測試 (Vue 3 ↔ LegacyHost ↔ Classic)');
  console.log('==============================================');

  const port = 9229;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + require('os').tmpdir() + '\\edge_comp_' + Date.now(),
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
        const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        if (msg.params.type === 'error') {
          console.error(`  [Browser Error]: ${text}`);
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error(`  🚨 [Browser Exception]: ${JSON.stringify(msg.params.exceptionDetails)}`);
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');

    console.log('1. 開啟 /v2/ 並登入...');
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/v2/' });
    await new Promise(r => setTimeout(r, 2000));

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

    const checkItems = [
      { name: '總覽', page: 'dashboard', expectType: 'vue' },
      { name: '待我簽核', page: 'inbox', expectType: 'vue' },
      { name: '我的申請', page: 'mine', expectType: 'vue' },
      { name: '簽核紀錄', page: 'records', expectType: 'vue' },
      { name: '新增申請', page: 'new-request', expectType: 'legacy' },
      { name: '簽核流程', page: 'workflows', expectType: 'legacy' },
      { name: '備份資料', page: 'backups', expectType: 'legacy' },
      { name: '請假報表', page: 'leave-report', expectType: 'legacy' },
      { name: '稽核日誌', page: 'audit-logs', expectType: 'legacy' },
      { name: '成員名單', page: 'users', expectType: 'legacy' },
      { name: '部門', page: 'departments', expectType: 'legacy' },
      { name: '帳號設定', page: 'settings', expectType: 'legacy' },
      { name: '系統設定', page: 'system-settings', expectType: 'legacy' },
      // 切換回 Vue 頁面驗證往返順暢
      { name: '待我簽核 (往返)', page: 'inbox', expectType: 'vue' },
      { name: '總覽 (往返)', page: 'dashboard', expectType: 'vue' },
    ];

    console.log('2. 逐一測試各功能項目點擊與畫面渲染...');
    for (const item of checkItems) {
      process.stdout.write(`  👉 點擊 [${item.name}] (${item.page})... `);
      await send('Runtime.evaluate', {
        expression: `(() => {
          const el = Array.from(document.querySelectorAll('.nav-item')).find(x =>
            (x.dataset && x.dataset.page === '${item.page}') ||
            (x.getAttribute('href') && x.getAttribute('href').endsWith('/${item.page}')) ||
            x.innerText.includes('${item.name.split(' ')[0]}')
          );
          if (el) { el.click(); return true; }
          return false;
        })()`
      });
      await new Promise(r => setTimeout(r, 1200));

      const res = await send('Runtime.evaluate', {
        expression: `({
          url: window.location.href,
          title: document.querySelector('.page-header h2')?.textContent || document.getElementById('page-title')?.textContent,
          hasError: !!document.querySelector('.error-msg'),
          errorText: document.querySelector('.error-msg')?.textContent,
          bodyLen: (document.querySelector('.page-body')?.innerHTML || document.getElementById('page-body')?.innerHTML || '').length
        })`,
        returnByValue: true
      });
      const v = res.result?.value;
      if (v?.hasError) {
        console.log(`❌ 失敗: ${v.errorText}`);
      } else {
        console.log(`✅ 成功! 標題: "${v?.title}", 內容長度: ${v?.bodyLen}, URL: ${v?.url}`);
      }
    }

    console.log('3. 測試登出按鈕...');
    await send('Runtime.evaluate', {
      expression: `document.getElementById('btn-logout').click()`
    });
    await new Promise(r => setTimeout(r, 1500));
    const logoutRes = await send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        hasLoginForm: !!document.querySelector('form')
      })`,
      returnByValue: true
    });
    console.log('  登出結果:', logoutRes.result?.value);
    if (logoutRes.result?.value?.url?.includes('/login')) {
      console.log('  ✅ 成功登出並重導向至登入頁面！');
    }

    ws.close();
  } finally {
    edge.kill();
  }
}

testComprehensive().catch(console.error);
