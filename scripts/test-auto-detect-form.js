const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
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
  console.log('[TEST] Starting Smart Form Auto-Detection Test...');

  // Ensure sample template exists in data/templates
  const templatesDir = path.join(__dirname, '..', 'data', 'templates');
  if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
  const sampleSrc = path.join(__dirname, '..', 'data', 'sample-form-unicode.pdf');
  const sampleDest = path.join(templatesDir, 'sample-form-unicode.pdf');
  if (fs.existsSync(sampleSrc)) {
    fs.copyFileSync(sampleSrc, sampleDest);
  }

  const token = signToken({ id: 1, username: 'admin', role: 'admin', name: '系統管理員' });
  console.log('[1] Created test auth token.');

  const port = 9226;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_' + Date.now(),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    'about:blank',
  ]);

  await new Promise(r => setTimeout(r, 1500));

  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = list.find(p => p.type === 'page' && !p.url.startsWith('edge://')) || list.find(p => p.type === 'page') || list[0];
    console.log('[1.5] Selected page URL:', page.url);
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

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        console.log('[BROWSER CONSOLE]', text);
      }
    });

    console.log('[2] Navigating to http://127.0.0.1:3847/');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    console.log('[3] Running auto-detection in browser context...');
    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          window.alert = (msg) => console.log('--> ALERT:', msg);
          window.confirm = (msg) => { console.log('--> CONFIRM:', msg); return true; };
          localStorage.setItem('approval_token', ${JSON.stringify(token)});

          // Load PDF.js if not present
          if (!window.pdfjsLib) {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = '/vendor/pdfjs/pdf.min.js';
              s.onload = resolve;
              s.onerror = (e) => reject(new Error('Failed to load ' + s.src));
              document.head.appendChild(s);
            });
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
          }

          // Load PdfFormDesigner if not present
          if (!window.PdfFormDesigner) {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = '/js/pdf-form-designer.js';
              s.onload = resolve;
              s.onerror = (e) => reject(new Error('Failed to load ' + s.src));
              document.head.appendChild(s);
            });
          }

          if (!window.PdfFormDesigner) return { error: 'window.PdfFormDesigner not loaded' };

          let savedResult = null;
          const testWorkflow = {
            id: 888,
            name: '紙本表單掃描測試流程',
            steps: [{ order: 1, name: '審核主管' }, { order: 2, name: '財務複核' }]
          };

          // 打開畫布設計器並載入 sample-form-unicode.pdf
          const modal = window.PdfFormDesigner.openPdfFormDesignerModal({
            workflow: testWorkflow,
            initialPdfLayout: {
              type: 'pdf_template',
              templateFile: 'templates/sample-form-unicode.pdf',
              fields: []
            },
            onSave: (res) => { savedResult = res; }
          });

          if (!modal) return { error: 'modal not created' };

          // 等候底圖載入完成
          if (modal._loadTemplatePromise) {
            try {
              await modal._loadTemplatePromise;
            } catch (err) {
              return { error: 'Template load failed: ' + err.message };
            }
          }

          let waitAttempts = 0;
          while (modal.dataset.templateLoaded !== 'true' && waitAttempts < 40) {
            await new Promise(r => setTimeout(r, 200));
            waitAttempts++;
          }
          if (modal.dataset.templateLoaded !== 'true') {
            return { error: 'PDF canvas failed to render within timeout, status: ' + modal.dataset.templateLoaded };
          }

          // 觸發「智慧掃描自動建欄位」按鈕
          const autoDetectBtn = modal.querySelector('#pdf-auto-detect-btn');
          if (!autoDetectBtn) return { error: '#pdf-auto-detect-btn not found' };

          autoDetectBtn.click();

          // 等候掃描分析及方框生成
          let scanWait = 0;
          const overlay = modal.querySelector('#pdf-designer-overlay');
          let boxes = [];
          while (scanWait < 40) {
            await new Promise(r => setTimeout(r, 250));
            boxes = overlay.querySelectorAll('.designer-field-box');
            if (boxes.length > 0 && !autoDetectBtn.disabled) break;
            scanWait++;
          }

          if (boxes.length === 0) {
            return { error: 'No field boxes were generated by auto-detect' };
          }

          const detectedBoxesInfo = Array.from(boxes).map(b => ({
            id: b.dataset.id,
            badge: b.querySelector('.badge-text')?.textContent || '',
            left: b.style.left,
            top: b.style.top,
            width: b.style.width,
            height: b.style.height
          }));

          const canvas = modal.querySelector('#pdf-designer-canvas');

          // 點擊儲存並套用
          const saveBtn = modal.querySelector('#pdf-designer-save-btn');
          saveBtn.click();

          return {
            success: true,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            detectedCount: boxes.length,
            detectedBoxesInfo,
            savedResult
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log('[4] Auto-detection evaluation result:');
    if (evalRes.exceptionDetails) {
      console.error('❌ Exception in browser:', evalRes.exceptionDetails.text, evalRes.exceptionDetails.exception);
      process.exit(1);
    }
    const val = evalRes.result?.value;
    console.log(JSON.stringify(val, null, 2));

    if (!val || val.error) {
      console.error('❌ FAIL:', val?.error || 'Unknown error');
      process.exit(1);
    }

    console.log(`\n✅ PASS: Successfully auto-detected and created ${val.detectedCount} fields!`);
    val.detectedBoxesInfo.forEach((b, i) => {
      console.log(`   [${i + 1}] Field: "${b.badge}" -> pos: (${b.left}, ${b.top}), size: ${b.width} x ${b.height}`);
    });

    if (val.savedResult?.pdfLayout?.fields?.length > 0 && val.savedResult?.formFields?.length > 0) {
      console.log(`✅ PASS: Saved layout includes ${val.savedResult.pdfLayout.fields.length} layout fields and ${val.savedResult.formFields.length} data form fields!`);
    }

    console.log('\n🎉 SMART FORM AUTO-DETECTION TEST PASSED FULLY!');
    ws.close();
    edge.kill();
  } catch (err) {
    console.error('Error during auto-detect test:', err);
    edge.kill();
    process.exit(1);
  }
}

run();
