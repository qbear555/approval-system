/** Inspect pending requests and final-step approver emails on NAS DB */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const path = '/app/data/approval.db';
const db = new DatabaseSync(path);
const pending = db.prepare(\`
  SELECT r.id, r.title, r.status, r.current_step, r.notify_email, r.steps_snapshot_json,
         u.name AS requester, u.email AS req_email
  FROM approval_requests r
  JOIN users u ON u.id = r.requester_id
  WHERE r.status = 'pending'
  ORDER BY r.id DESC LIMIT 15
\`).all();
for (const r of pending) {
  let steps = [];
  try { steps = JSON.parse(r.steps_snapshot_json || '[]'); } catch(e) {}
  const cur = steps.find(s => s.order === r.current_step || Number(s.order) === Number(r.current_step));
  const maxOrder = steps.length ? Math.max(...steps.map(s => Number(s.order)||0)) : 0;
  const isFinal = cur && Number(cur.order) === maxOrder;
  console.log('--- request', r.id, r.title, 'step', r.current_step, '/', maxOrder, 'final?', !!isFinal);
  console.log('  type current_step', typeof r.current_step, 'typeof order', cur ? typeof cur.order : 'n/a');
  console.log('  cur step', cur && cur.name, 'approverIds', cur && cur.approverIds);
  if (cur && cur.approverIds) {
    for (const aid of cur.approverIds) {
      const u = db.prepare('SELECT id,name,email,active FROM users WHERE id=?').get(aid);
      console.log('  approver', u);
    }
  }
  console.log('  steps orders', steps.map(s => ({o:s.order, t:typeof s.order, n:s.name, ids:s.approverIds})));
}
// recent mail outbox
const outbox = '/app/data/mail-outbox';
if (fs.existsSync(outbox)) {
  const files = fs.readdirSync(outbox).sort().slice(-20);
  console.log('outbox files', files.length);
  for (const f of files.slice(-10)) {
    try {
      const j = JSON.parse(fs.readFileSync(outbox+'/'+f,'utf8'));
      console.log('mail', f, j.meta||{}, 'to', j.to, 'subject', (j.subject||'').slice(0,60));
    } catch(e) { console.log('mail', f, e.message); }
  }
}
`;

const conn = new Client();
conn
  .on('ready', () => {
    const b64 = Buffer.from(remoteScript).toString('base64');
    const cmd = `echo ${JSON.stringify(PASS)} | sudo -S -p '' /usr/local/bin/docker exec approval-system node -e "eval(Buffer.from('${b64}','base64').toString())"`;
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        conn.end();
        process.exit(1);
      }
      let o = '';
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (c) => {
        console.log(o);
        conn.end();
        process.exit(c || 0);
      });
    });
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: HOST,
    username: USER,
    password: PASS,
    readyTimeout: 30000,
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
    },
  });
