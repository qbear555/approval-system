const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const { signToken } = require('../server/auth');

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
  console.log('[1/3] Testing backend API saving workflows...');
  const token = signToken({ id: 1, username: 'Admin', role: 'admin', name: '系統管理員' });
  const BASE = 'http://127.0.0.1:3847';

  // Test 1: Save standard new workflow with auto-complemented formFields
  const res1 = await fetch(`${BASE}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: '【自動測試】常規新流程',
      category: '一般簽呈',
      steps: [{ name: '部門主管', assignType: 'dept_head', mode: 'any' }],
      formFields: [],
      pdfLayout: { type: 'auto' }
    })
  });
  const data1 = await res1.json();
  if (!res1.ok || !data1.workflow) {
    throw new Error('API Test 1 Failed: ' + JSON.stringify(data1));
  }
  console.log('  ✅ API Test 1 Passed: Standard workflow created, ID:', data1.workflow.id);

  // Test 2: Save paper document workflow
  const res2 = await fetch(`${BASE}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: '【自動測試】紙本新流程',
      category: '財務採購',
      steps: [{ name: '部門主管', assignType: 'dept_head', mode: 'any' }],
      formFields: [{ id: 'amt', label: '報銷金額', type: 'number', required: true }],
      pdfLayout: {
        type: 'pdf_template',
        templateFile: 'templates/test.pdf',
        fields: [{ id: 'amt', name: '報銷金額', type: 'number', rx: 0.3, ry: 0.4, rw: 0.2, rh: 0.05 }]
      }
    })
  });
  const data2 = await res2.json();
  if (!res2.ok || !data2.workflow) {
    throw new Error('API Test 2 Failed: ' + JSON.stringify(data2));
  }
  console.log('  ✅ API Test 2 Passed: Paper workflow created, ID:', data2.workflow.id);

  // Cleanup API workflows
  await fetch(`${BASE}/api/workflows/${data1.workflow.id}?permanent=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`${BASE}/api/workflows/${data2.workflow.id}?permanent=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  console.log('  ✅ Cleaned up API test workflows.');

  console.log('[2/3] Starting Headless Browser UI Test (Standard Workflow)...');
  const port = 9227;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_wf_' + Date.now(),
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

    await send('Page.enable');
    await send('Runtime.enable');

    await send('Page.navigate', { url: `${BASE}/` });
    await new Promise(r => setTimeout(r, 1500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('approval_token', ${JSON.stringify(token)});
        localStorage.setItem('approval_force_classic', '1');
      `
    });

    await send('Page.navigate', { url: `${BASE}/` });
    await new Promise(r => setTimeout(r, 2000));

    // Test 1: Standard Workflow creation
    const testRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          if (typeof window.navigate === 'function') {
            window.navigate('workflows');
            await new Promise(r => setTimeout(r, 1500));
          }
          if (typeof openWorkflowEditor !== 'function') return { error: 'openWorkflowEditor not loaded' };
          
          await openWorkflowEditor({ name: '【自動UI測試】新增一般流程' });
          await new Promise(r => setTimeout(r, 600));

          const modal = document.querySelector('#modal');
          const form = document.querySelector('#wf-form');
          if (!modal || !form) return { error: 'modal or wf-form not found' };

          const submitBtn = form.querySelector('button[type="submit"]') || modal.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          await new Promise(r => setTimeout(r, 1500));

          const toastEl = document.querySelector('#toast');
          const toastText = toastEl ? toastEl.textContent : '';

          return {
            success: true,
            modalClosed: modal.classList.contains('hidden'),
            toastText
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log('  Standard Workflow UI Save result:', JSON.stringify(testRes.result.value, null, 2));
    const val = testRes.result.value;
    if (val.error) {
      throw new Error('Standard Workflow UI Test Failed: ' + val.error);
    }
    if (val.modalClosed || (val.toastText && val.toastText.includes('流程已儲存'))) {
      console.log('  ✅ SUCCESS: Standard workflow saved cleanly via browser UI!');
    } else {
      throw new Error('Standard workflow save was not successful: toast=' + val.toastText);
    }

    // Test 2: Paper Workflow creation with Designer interaction
    console.log('[3/3] Starting Headless Browser UI Test (Paper Workflow with Designer)...');
    const paperTestRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          if (typeof openWorkflowEditor !== 'function') return { error: 'openWorkflowEditor not loaded' };
          
          await openWorkflowEditor({
            name: '【自動UI測試】紙本表單流程',
            pdfLayout: { type: 'pdf_template', fields: [] },
            _autoOpenDesigner: true,
          });
          await new Promise(r => setTimeout(r, 800));

          const designerModal = document.querySelector('#pdf-designer-modal');
          if (!designerModal) return { error: 'designerModal not opened' };

          // 點擊新增文字方塊與簽章
          const addText = designerModal.querySelector('[data-add-type="text"]');
          const addSig = designerModal.querySelector('[data-add-type="signature"]');
          if (addText) addText.click();
          if (addSig) addSig.click();
          await new Promise(r => setTimeout(r, 300));

          // 點擊「儲存並套用」
          const saveDesignerBtn = designerModal.querySelector('#pdf-designer-save-btn');
          if (!saveDesignerBtn) return { error: 'saveDesignerBtn not found' };
          saveDesignerBtn.click();
          await new Promise(r => setTimeout(r, 600));

          // 此時已返回工作流程設定表單，點擊儲存流程
          const modal = document.querySelector('#modal');
          const form = document.querySelector('#wf-form');
          if (!modal || !form) return { error: 'wf-form not found after designer save' };

          const submitBtn = form.querySelector('button[type="submit"]') || modal.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          await new Promise(r => setTimeout(r, 1500));

          const toastEl = document.querySelector('#toast');
          const toastText = toastEl ? toastEl.textContent : '';

          return {
            success: true,
            modalClosed: modal.classList.contains('hidden'),
            toastText
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log('  Paper Workflow UI Save result:', JSON.stringify(paperTestRes.result.value, null, 2));
    const paperVal = paperTestRes.result.value;
    if (paperVal.error) {
      throw new Error('Paper Workflow UI Test Failed: ' + paperVal.error);
    }
    if (paperVal.modalClosed || (paperVal.toastText && paperVal.toastText.includes('流程已儲存'))) {
      console.log('  ✅ SUCCESS: Paper workflow with designer saved cleanly via browser UI!');
    } else {
      throw new Error('Paper workflow save was not successful: toast=' + paperVal.toastText);
    }

    // Cleanup created test workflows from DB
    const listRes = await fetch(`${BASE}/api/workflows`, { headers: { Authorization: `Bearer ${token}` } });
    const listData = await listRes.json();
    for (const name of ['【自動UI測試】新增一般流程', '【自動UI測試】紙本表單流程']) {
      const createdWf = (listData.workflows || []).find(w => w.name === name);
      if (createdWf) {
        await fetch(`${BASE}/api/workflows/${createdWf.id}?permanent=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        console.log(`  ✅ Cleaned up ${name}`);
      }
    }

    ws.close();
    edge.kill();
    console.log('\n🎉 ALL WORKFLOW SAVE TESTS (STANDARD + PAPER DESIGNER) PASSED COMPLETELY!');
  } catch (err) {
    console.error('Error during test:', err);
    edge.kill();
    process.exit(1);
  }
}

run();
