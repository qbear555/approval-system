const { spawn } = require('child_process');
const http = require('http');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const J = (u) => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
(async () => {
  const port = 9231;
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + require('os').tmpdir() + '\\edge_inb_' + Date.now(), '--no-first-run', 'about:blank']);
  await new Promise(r => setTimeout(r, 1500));
  try {
    const list = await J(`http://127.0.0.1:${port}/json/list`);
    const ws = new WebSocket(list.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 1;
    const send = (method, params = {}) => new Promise(res => { const i = id++; const h = e => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(m.params.exceptionDetails).slice(0, 400)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('ERR', m.params.args.map(a => a.value || a.description).join(' ').slice(0, 300)); });
    await send('Runtime.enable'); await send('Page.enable');
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // API login to find pending items
    const login = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'Admin',password:'admin123'})}).then(r=>r.json()).then(d=>d.token)`);
    await send('Page.navigate', { url: 'http://192.168.99.220:3847/v2/' });
    await sleep(2000);
    await ev(`(()=>{const u=document.querySelector('input[type=text]'),p=document.querySelector('input[type=password]');u.value='Admin';u.dispatchEvent(new Event('input',{bubbles:true}));p.value='admin123';p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[type=submit],form button').click();})()`);
    await sleep(2500);
    const api = await ev(`fetch('/api/requests?filter=pending_me',{headers:{Authorization:'Bearer '+localStorage.getItem('approval_token')}}).then(r=>r.text()).then(t=>t.slice(0,300))`);
    console.log('API pending_me:', api);
    await ev(`[...document.querySelectorAll('a.nav-item')].find(a=>a.getAttribute('href').endsWith('/records')).click()`);
    await sleep(2000);
    console.log('inbox:', await ev(`({url:location.href,rows:document.querySelectorAll('tbody tr').length,btns:[...document.querySelectorAll('.page-body button,.page-body a')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,20),text:document.querySelector('.page-body').innerText.slice(0,300)})`));
    await ev(`(()=>{const r=document.querySelector('tbody tr.clickable');if(r)r.click();})()`);
    await sleep(2000);
    console.log('after row click:', await ev(`({url:location.href,title:document.querySelector('.page-header h2')?.textContent||document.getElementById('page-title')?.textContent,body:(document.getElementById('page-body')||document.querySelector('.page-body')).innerText.slice(0,200)})`));
    ws.close();
  } finally { edge.kill(); }
})().catch(console.error);

