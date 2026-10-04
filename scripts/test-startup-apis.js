async function testAPIs() {
  const base = 'http://192.168.99.220:3847';
  const endpoints = [
    '/api/health',
    '/api/system/settings',
    '/api/departments',
    '/api/tw-calendar',
    '/api/auth/me',
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(base + ep);
      const text = await res.text();
      console.log(`[${res.status}] ${ep}: ${text.slice(0, 100)}`);
    } catch (e) {
      console.error(`ERROR ${ep}:`, e.message);
    }
  }
}

testAPIs().catch(console.error);
