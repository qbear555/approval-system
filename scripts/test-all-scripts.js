const fs = require('fs');

async function testScripts() {
  const base = 'http://192.168.99.220:3847';
  const html = await (await fetch(base + '/')).text();
  const scriptTags = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  console.log(`Checking ${scriptTags.length} scripts from Classic /:`);
  let hasError = false;
  for (const s of scriptTags) {
    const sUrl = s.startsWith('http') ? s : (base + s);
    try {
      const res = await fetch(sUrl);
      if (!res.ok) {
        console.error(`❌ [${res.status}] ${sUrl}`);
        hasError = true;
      } else {
        console.log(`✓ [${res.status}] ${sUrl} (${res.headers.get('content-length')} bytes)`);
      }
    } catch (e) {
      console.error(`❌ ERROR: ${sUrl}`, e.message);
      hasError = true;
    }
  }

  // Also check v2 scripts
  const v2Html = await (await fetch(base + '/v2/')).text();
  const v2ScriptTags = [...v2Html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  console.log(`\nChecking ${v2ScriptTags.length} scripts from Vue 3 /v2/:`);
  for (const s of v2ScriptTags) {
    const sUrl = s.startsWith('http') ? s : (base + s);
    try {
      const res = await fetch(sUrl);
      if (!res.ok) {
        console.error(`❌ [${res.status}] ${sUrl}`);
        hasError = true;
      } else {
        console.log(`✓ [${res.status}] ${sUrl} (${res.headers.get('content-length')} bytes)`);
      }
    } catch (e) {
      console.error(`❌ ERROR: ${sUrl}`, e.message);
      hasError = true;
    }
  }

  if (!hasError) {
    console.log('\nAll static script tags load with 200 OK!');
  }
}

testScripts().catch(console.error);
