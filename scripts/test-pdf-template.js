const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { renderPdfTemplate } = require('../server/pdf-template-engine');

async function run() {
  console.log('Testing PDF Template Engine...');

  // 1. Create a blank A4 PDF as mock paper form template
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const templatePath = path.join(__dirname, 'mock_template.pdf');
  fs.writeFileSync(templatePath, await doc.save());

  // 2. Define fields on canvas (relative ratio coordinates)
  const fields = [
    {
      id: 'applicant_name',
      name: '申請人姓名',
      type: 'text',
      page: 1,
      rx: 0.1,
      ry: 0.1,
      rw: 0.3,
      rh: 0.04,
      fontSize: 12,
      align: 'left',
    },
    {
      id: 'amount',
      name: '請購金額',
      type: 'number',
      page: 1,
      rx: 0.5,
      ry: 0.1,
      rw: 0.3,
      rh: 0.04,
      fontSize: 12,
      align: 'right',
    },
    {
      id: 'reason',
      name: '申請原因',
      type: 'textarea',
      page: 1,
      rx: 0.1,
      ry: 0.2,
      rw: 0.7,
      rh: 0.1,
      fontSize: 11,
      align: 'left',
    },
    {
      id: 'stamp_mgr',
      name: '主管核准章',
      type: 'signature',
      isStamp: true,
      role: 'approver',
      stepOrder: 1,
      page: 1,
      rx: 0.6,
      ry: 0.8,
      rw: 0.2,
      rh: 0.08,
    },
  ];

  const formData = {
    applicant_name: '張祖銘 (Steven)',
    amount: '88,000 元',
    reason: '採購新型伺服器設備以提升高並發處理效能，包含硬碟擴充模組。',
  };

  const actions = [
    {
      action: 'approve',
      step_order: 1,
      actor_name: '陳總經理',
      created_at: '2026-09-18 20:00:00',
    },
  ];

  const pdfBuf = await renderPdfTemplate({
    templateAbsPath: templatePath,
    fields,
    formData,
    actions,
    requester: { name: '張祖銘' },
    request: { id: 999, created_at: '2026-09-18 19:00:00' },
  });

  fs.unlinkSync(templatePath);
  console.log('Success! Output PDF size:', pdfBuf.length, 'bytes');
  if (pdfBuf.length < 5000) {
    throw new Error('PDF output is unexpectedly small');
  }
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
