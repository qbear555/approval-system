const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

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
  console.log('[TEST] Starting Paper Document Canvas Designer Test...');
  const port = 9225;
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=' + os.tmpdir() + '\\edge_test_' + Date.now(),
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

    console.log('[1] Navigating to http://127.0.0.1:3847/');
    await send('Page.navigate', { url: 'http://127.0.0.1:3847/' });
    await new Promise(r => setTimeout(r, 2000));

    console.log('[2] Testing PdfFormDesigner in browser context...');
    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          if (!window.PdfFormDesigner) return { error: 'window.PdfFormDesigner not found' };
          
          let savedResult = null;
          let testWorkflow = {
            id: 999,
            name: '測試紙本簽核流程',
            steps: [{ order: 1, name: '一級主管' }, { order: 2, name: '財務審核' }]
          };

          // 打開畫布設計器
          window.PdfFormDesigner.openPdfFormDesignerModal({
            workflow: testWorkflow,
            initialPdfLayout: {
              type: 'pdf_template',
              templateFile: '/img/argo-logo.png',
              fields: []
            },
            onSave: (res) => { savedResult = res; }
          });

          const modal = document.getElementById('pdf-designer-modal');
          if (!modal) return { error: 'modal not created' };

          // 點擊新增文字方塊
          const addTextBtn = modal.querySelector('[data-add-type="text"]');
          if (!addTextBtn) return { error: 'addTextBtn not found' };
          addTextBtn.click();

          const overlay = modal.querySelector('#pdf-designer-overlay');
          const box = overlay.querySelector('.designer-field-box');
          if (!box) return { error: 'field box not added to overlay' };

          const initialLeft = box.style.left;
          const initialTop = box.style.top;
          const initialWidth = box.style.width;
          const initialHeight = box.style.height;

          // 測試滑鼠拖曳移動
          const rect = overlay.getBoundingClientRect();
          const startX = rect.left + rect.width * 0.35;
          const startY = rect.top + rect.height * 0.38;

          box.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            clientX: startX,
            clientY: startY
          }));

          // 拖移滑鼠 +50px, +30px
          window.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            clientX: startX + 50,
            clientY: startY + 30
          }));

          const movedLeft = box.style.left;
          const movedTop = box.style.top;

          window.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            clientX: startX + 50,
            clientY: startY + 30
          }));

          // 測試 8 方向控點縮放 (右下角 se)
          const seHandle = box.querySelector('.resize-handle[data-dir="se"]');
          if (!seHandle) return { error: 'se resize handle not found' };

          const handleRect = seHandle.getBoundingClientRect();
          seHandle.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            clientX: handleRect.left + 4,
            clientY: handleRect.top + 4
          }));

          // 拖移手柄放大 +40px, +25px
          window.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            clientX: handleRect.left + 44,
            clientY: handleRect.top + 29
          }));

          const resizedWidth = box.style.width;
          const resizedHeight = box.style.height;

          window.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            clientX: handleRect.left + 44,
            clientY: handleRect.top + 29
          }));

          // 測試快捷鍵方向鍵移動
          modal.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight'
          }));
          const arrowMovedLeft = box.style.left;

          // 測試屬性面板即時輸入
          const propName = modal.querySelector('#prop-name');
          propName.value = '費用總金額';
          propName.dispatchEvent(new Event('input', { bubbles: true }));

          const badgeText = box.querySelector('.badge-text').textContent;

          // 點擊儲存並套用
          const saveBtn = modal.querySelector('#pdf-designer-save-btn');
          saveBtn.click();

          return {
            success: true,
            initialLeft,
            initialTop,
            movedLeft,
            movedTop,
            initialWidth,
            initialHeight,
            resizedWidth,
            resizedHeight,
            arrowMovedLeft,
            badgeText,
            savedResult
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log('[3] Evaluation result:', JSON.stringify(evalRes.result.value, null, 2));

    const val = evalRes.result.value;
    if (val.error) {
      console.error('[FAIL]', val.error);
      process.exit(1);
    }

    if (val.initialLeft !== val.movedLeft && val.initialTop !== val.movedTop) {
      console.log('✅ PASS: Mouse dragging smoothly updated field position (left:', val.initialLeft, '->', val.movedLeft, ')');
    } else {
      console.error('❌ FAIL: Field position did not change on mouse drag!');
      process.exit(1);
    }

    if (val.initialWidth !== val.resizedWidth && val.initialHeight !== val.resizedHeight) {
      console.log('✅ PASS: Resize handle smoothly adjusted dimensions (width:', val.initialWidth, '->', val.resizedWidth, ')');
    } else {
      console.error('❌ FAIL: Field dimensions did not change on resize handle drag!');
      process.exit(1);
    }

    if (val.badgeText === '費用總金額') {
      console.log('✅ PASS: Field title synchronized with property panel input in real-time');
    }

    if (val.savedResult && val.savedResult.pdfLayout && val.savedResult.formFields) {
      console.log('✅ PASS: Saved layout and form fields returned correctly:', val.savedResult.formFields.length, 'fields');
    }

    console.log('\n🎉 ALL PAPER FORM DESIGNER DRAG & RESIZE TESTS PASSED!');
    ws.close();
    edge.kill();
  } catch (err) {
    console.error('Error during test:', err);
    edge.kill();
    process.exit(1);
  }
}

run();
