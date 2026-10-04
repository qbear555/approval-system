const http = require('http');

async function main() {
  const base = 'http://192.168.99.220:3847';
  console.log('=== 1. 檢查基本頁面 ===');
  
  const r1 = await fetch(base + '/');
  console.log('GET / :', r1.status);
  const text1 = await r1.text();
  console.log('  / html 長度:', text1.length);

  const r2 = await fetch(base + '/v2/');
  console.log('GET /v2/ :', r2.status);
  const text2 = await r2.text();
  console.log('  /v2/ html 長度:', text2.length);

  console.log('=== 2. 檢查 v2 靜態資源 (JS/CSS) ===');
  const srcMatches = [...text2.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  const hrefMatches = [...text2.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  const assets = [...srcMatches, ...hrefMatches];
  for (const a of assets) {
    const aUrl = a.startsWith('http') ? a : (base + (a.startsWith('/') ? '' : '/v2/') + a);
    try {
      const res = await fetch(aUrl);
      console.log(`  資源 [${res.status}] ${aUrl} (${res.headers.get('content-length')} bytes, ${res.headers.get('content-type')})`);
    } catch (e) {
      console.error(`  資源加載失敗: ${aUrl}`, e.message);
    }
  }

  console.log('=== 3. 測試 API 登入與查詢 ===');
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' })
  });
  console.log('登入 admin / password123:', loginRes.status);
  const loginData = await loginRes.json();
  console.log('登入回應:', loginData);

  if (loginData.token) {
    const token = loginData.token;
    const reqRes = await fetch(base + '/api/requests', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('GET /api/requests:', reqRes.status);
    const reqData = await reqRes.json();
    console.log('表單清單筆數:', Array.isArray(reqData) ? reqData.length : reqData);

    const wfRes = await fetch(base + '/api/workflows', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('GET /api/workflows:', wfRes.status);
  }
}

main().catch(console.error);
