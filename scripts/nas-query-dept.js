/** Inspect latest requests with dept_head steps */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/approval.db');
const rows = db.prepare(\`
  SELECT r.id, r.title, r.status, r.current_step, r.form_data, r.steps_snapshot_json,
         r.created_at, u.name AS requester
  FROM approval_requests r
  JOIN users u ON u.id = r.requester_id
  ORDER BY r.id DESC LIMIT 8
\`).all();
for (const r of rows) {
  let steps = [];
  let fd = {};
  try { steps = JSON.parse(r.steps_snapshot_json || '[]'); } catch(e) {}
  try { fd = JSON.parse(r.form_data || '{}'); } catch(e) {}
  console.log('--- #', r.id, r.title, 'status', r.status, 'step', r.current_step, 'by', r.requester, r.created_at);
  console.log('  form_data keys', Object.keys(fd).filter(k => k.includes('dept') || k.includes('agent') || !k.includes('__')).slice(0,20));
  console.log('  dept fields', Object.fromEntries(Object.entries(fd).filter(([k]) => /^dept_head/.test(k))));
  console.log('  steps', steps.map(s => ({o:s.order,n:s.name,t:s.assignType,ids:s.approverIds,note:s.resolveNote})));
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
      stream.on('close', () => {
        console.log(o);
        conn.end();
      });
    });
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
