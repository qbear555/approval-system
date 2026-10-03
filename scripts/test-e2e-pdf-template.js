const fs = require('fs');
const path = require('path');
const { signToken } = require('../server/auth');

async function testE2E() {
  const BASE_URL = 'http://127.0.0.1:3847';
  console.log('[E2E] Starting E2E test on', BASE_URL);

  // 1. 產生 admin token
  const token = signToken({ id: 1, username: 'Admin', role: 'admin', name: '系統管理員' });
  console.log('[1] Generated admin JWT token.');

  // 2. 上傳測試底圖 (產生一個包含方框與文字的 PDF 底圖)
  console.log('[2] Uploading template file...');
  const { PDFDocument, rgb } = require('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  page.drawText('OFFICIAL EXPENSE REIMBURSEMENT FORM', { x: 50, y: 800, size: 16 });
  page.drawRectangle({ x: 45, y: 720, width: 505, height: 60, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  page.drawText('Applicant Name:', { x: 50, y: 760, size: 12 });
  page.drawText('Department:', { x: 300, y: 760, size: 12 });
  page.drawText('Amount (NTD):', { x: 50, y: 735, size: 12 });
  page.drawRectangle({ x: 45, y: 640, width: 505, height: 70, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  page.drawText('Manager Approval Stamp:', { x: 50, y: 685, size: 12 });
  const samplePdfBytes = await pdfDoc.save();

  const tmpPdfPath = path.join(__dirname, 'temp_sample_form.pdf');
  fs.writeFileSync(tmpPdfPath, samplePdfBytes);

  const blob = new Blob([samplePdfBytes], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('file', blob, 'official_form.pdf');

  const uploadRes = await fetch(`${BASE_URL}/api/workflows/upload-template`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.templateFile) {
    throw new Error('Upload template failed: ' + JSON.stringify(uploadData));
  }
  console.log('[2] Upload success. Template file:', uploadData.templateFile);

  // 3. 建立自訂紙本流程
  console.log('[3] Creating custom workflow with pdf_template layout...');
  const wfPayload = {
    name: '【紙本匯入】公務費用核銷單',
    category: '財務採購',
    description: '申請人 → 部門主管',
    steps: [
      {
        name: '部門主管',
        assignType: 'users',
        approverIds: [1],
        mode: 'any',
      }
    ],
    formFields: [
      { id: 'app_name', label: '申請人姓名', type: 'text', required: true },
      { id: 'dept_name', label: '申請部門', type: 'text', required: true },
      { id: 'amount', label: '核銷金額', type: 'number', required: true },
    ],
    pdfLayout: {
      type: 'pdf_template',
      templateFile: uploadData.templateFile,
      templateMeta: {
        originalName: 'official_form.pdf',
        size: samplePdfBytes.length,
        mimeType: 'application/pdf',
      },
      fields: [
        { id: 'app_name', name: '申請人姓名', type: 'text', rx: 0.28, ry: 0.088, rw: 0.2, rh: 0.03, fontSize: 12 },
        { id: 'dept_name', name: '申請部門', type: 'text', rx: 0.68, ry: 0.088, rw: 0.2, rh: 0.03, fontSize: 12 },
        { id: 'amount', name: '核銷金額', type: 'number', rx: 0.28, ry: 0.118, rw: 0.2, rh: 0.03, fontSize: 12 },
        { id: 'mgr_stamp', name: '主管簽章', type: 'signature', rx: 0.5, ry: 0.16, rw: 0.2, rh: 0.06, isStamp: true, stepOrder: 1 },
      ],
      formMode: 'paper',
    },
    active: 1,
  };

  const wfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(wfPayload),
  });
  const wfData = await wfRes.json();
  if (!wfRes.ok || !wfData.workflow?.id) {
    throw new Error('Create workflow failed: ' + JSON.stringify(wfData));
  }
  const wfId = wfData.workflow.id;
  console.log('[3] Workflow created. ID:', wfId);

  // 4. 送出申請單
  console.log('[4] Submitting request for paper workflow...');
  const reqFormData = new FormData();
  reqFormData.append('workflow_id', String(wfId));
  reqFormData.append('title', '公務費用核銷 - 採購事務用品');
  reqFormData.append('form_data', JSON.stringify({
    app_name: '王小明',
    dept_name: '研發資訊部',
    amount: '12500',
  }));

  const submitRes = await fetch(`${BASE_URL}/api/requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: reqFormData,
  });
  const submitData = await submitRes.json();
  if (!submitRes.ok || !submitData.request?.id) {
    throw new Error('Submit request failed: ' + JSON.stringify(submitData));
  }
  const reqId = submitData.request.id;
  console.log('[4] Request submitted. ID:', reqId);

  // 5. 簽核核准
  console.log('[5] Approving request...');
  const approveRes = await fetch(`${BASE_URL}/api/requests/${reqId}/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'approve',
      comment: '核銷項目相符，准予核銷',
    }),
  });
  const approveData = await approveRes.json();
  if (!approveRes.ok) {
    throw new Error('Approve request failed: ' + JSON.stringify(approveData));
  }
  console.log('[5] Request approved successfully.');

  // 6. 下載套印 PDF 並驗證
  console.log('[6] Downloading overlay PDF...');
  const pdfRes = await fetch(`${BASE_URL}/api/requests/${reqId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!pdfRes.ok) {
    const errText = await pdfRes.text();
    throw new Error(`Download PDF failed (${pdfRes.status}): ${errText}`);
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  console.log('[6] PDF downloaded. Byte size:', pdfBuffer.length);
  if (!pdfBuffer.slice(0, 4).toString().startsWith('%PDF')) {
    throw new Error('Downloaded file is not a valid PDF!');
  }
  const outPath = path.join(__dirname, 'test_output_overlay_result.pdf');
  fs.writeFileSync(outPath, pdfBuffer);
  console.log('[6] PDF verified and saved to:', outPath);

  if (fs.existsSync(tmpPdfPath)) fs.unlinkSync(tmpPdfPath);

  console.log('\n========================================');
  console.log('ALL E2E TESTS PASSED SUCCESSFULLY!');
  console.log('========================================\n');
}

testE2E().catch((err) => {
  console.error('[E2E ERROR]:', err);
  process.exit(1);
});
