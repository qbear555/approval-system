/**
 * 本機抽樣 PDF（不碰 data/）
 *   node scripts/gen-pdf-samples.js [outdir]
 */
const fs = require('fs');
const path = require('path');
const { writeApprovalPdf } = require('../server/pdf');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tmp-pdf-samples'));
fs.mkdirSync(outDir, { recursive: true });

const base = {
  requester_name: '王小明',
  requester_dept: '管理部',
  status: 'approved',
  created_at: '2026-08-13 09:30:00',
  steps: [],
  actions: [
    {
      action: 'approve',
      actor_name: '陳主管',
      comment: '同意',
      created_at: '2026-08-13 11:00:00',
      step_name: '部門主管',
    },
  ],
  formFields: [],
};

const samples = [
  {
    file: 'leave.pdf',
    request: {
      ...base,
      id: 101,
      workflow_name: '請假申請',
      title: '特休一天',
      form_data: {
        leave_type: '特別休假（特休）',
        start_date: '2026-08-20',
        end_date: '2026-08-20',
        days: 1,
        reason: '家庭事務',
      },
    },
  },
  {
    file: 'purchase.pdf',
    request: {
      ...base,
      id: 102,
      workflow_name: '請購申請',
      title: '請購辦公椅',
      form_data: {
        item_name: '人體工學椅',
        qty: 2,
        currency: 'NTD',
        amount: 12800,
        reason: '舊椅損壞需更換',
        need_date: '2026-09-01',
      },
    },
  },
  {
    file: 'credit.pdf',
    request: {
      ...base,
      id: 103,
      workflow_name: '信用額度申請表',
      title: '信用額度申請',
      form_data: {
        customer_name: '測試客戶',
        requested_credit_limit: 50,
        reason_for_increase: '訂單增加需提高額度',
        group_name: '業務一組',
      },
    },
  },
];

(async () => {
  for (const s of samples) {
    const dest = path.join(outDir, s.file);
    const ws = fs.createWriteStream(dest);
    await writeApprovalPdf(s.request, ws);
    const st = fs.statSync(dest);
    if (st.size < 1000) throw new Error(s.file + ' too small: ' + st.size);
    console.log('wrote', dest, st.size);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
