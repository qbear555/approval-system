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
  console.log('[TEST] Starting Inbox Split Review (雙欄審批) Test...');

  const user = { id: 74, username: 'Ping', role: 'user', name: '吳蕙萍' };
  const token = signToken(user);
  const port = 9228;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_split_' + Date.now(),
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

    console.log('[1] Setting token & inbox view mode to split...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 1500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('approval_token', ${JSON.stringify(token)});
        localStorage.setItem('approval_user', JSON.stringify(${JSON.stringify(user)}));
        localStorage.setItem('approval_inbox_view', 'split');
      `
    });

    console.log('[2] Navigating directly to /inbox...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/inbox' });
    await new Promise(r => setTimeout(r, 3000));

    const checkState = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const splitContainer = document.querySelector('.split-review-container');
          const splitHost = document.querySelector('#split-detail-host');
          const errorEls = Array.from(document.querySelectorAll('.error-msg')).map(e => e.innerText);
          const hasCards = Boolean(document.querySelector('.split-card'));
          const flowChartDefined = typeof window.flowChartHtml === 'function';
          const innerHtmlSnippet = splitHost ? splitHost.innerHTML.slice(0, 300) : '';
          const bodyHtml = document.body.innerHTML.slice(0, 500);
          const currentUrl = location.href;
          const currentTitle = document.title;
          return {
            currentUrl,
            currentTitle,
            hasSplitContainer: Boolean(splitContainer),
            hasSplitHost: Boolean(splitHost),
            errorEls,
            hasCards,
            flowChartDefined,
            innerHtmlSnippet,
            bodyHtml
          };
        })()
      `,
      returnByValue: true,
    });

    console.log('Split Inbox Evaluation Result:', checkState.result.value);

    // If there is an active item, verify detail pane rendered cleanly without flowChartHtml error
    const value = checkState.result.value;
    if (value.errorEls.length > 0) {
      for (const err of value.errorEls) {
        if (err.includes('flowChartHtml is not defined')) {
          throw new Error('FAILED: flowChartHtml is not defined detected in DOM!');
        }
      }
    }

    if (!value.flowChartDefined) {
      throw new Error('FAILED: window.flowChartHtml is not defined on window!');
    }

    const fatalErrors = consoleErrors.filter(e => e.includes('flowChartHtml') || e.includes('is not defined'));
    if (fatalErrors.length > 0) {
      throw new Error(`FAILED: Console errors encountered: ${fatalErrors.join(' | ')}`);
    }

    console.log('🎉 SUCCESS: Inbox split view loaded with window.flowChartHtml defined and zero flowChartHtml errors!');
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
