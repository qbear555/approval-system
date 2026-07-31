/** Debug mail: config, outbox, pending approver emails, container logs */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/approval.db');

console.log('=== mail-config.json ===');
const cfgPath = '/app/data/mail-config.json';
if (fs.existsSync(cfgPath)) {
  const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  console.log(JSON.stringify({
    enabled: c.enabled,
    host: c.host,
    port: c.port,
    secure: c.secure,
    user: c.user,
    hasPass: !!c.pass,
    passLen: c.pass ? String(c.pass).length : 0,
    from: c.from,
    fromName: c.fromName,
    baseUrl: c.baseUrl,
  }, null, 2));
} else console.log('MISSING config');

console.log('=== outbox (last 15) ===');
const outbox = '/app/data/mail-outbox';
if (fs.existsSync(outbox)) {
  const files = fs.readdirSync(outbox).filter(f=>f.endsWith('.json')).sort().slice(-15);
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(outbox+'/'+f,'utf8'));
      console.log(f, 'to=', j.to, 'subj=', (j.subject||'').slice(0,50), 'meta=', JSON.stringify(j.meta||{}));
    } catch(e) { console.log(f, e.message); }
  }
} else console.log('no outbox');

console.log('=== pending requests current approvers ===');
const pending = db.prepare(\`SELECT id, title, status, current_step, steps_snapshot_json FROM approval_requests WHERE status='pending' ORDER BY id DESC LIMIT 10\`).all();
for (const r of pending) {
  let steps=[];
  try { steps=JSON.parse(r.steps_snapshot_json||'[]'); } catch(e){}
  const step = steps.find(s => Number(s.order)===Number(r.current_step));
  console.log('R'+r.id, r.title?.slice(0,40), 'step', r.current_step, step?.name, 'ids', step?.approverIds);
  for (const id of (step?.approverIds||[])) {
    const u = db.prepare('SELECT id,username,name,email,active,email_notify FROM users WHERE id=?').get(id);
    console.log('  user', u);
  }
}

console.log('=== recent remind comments ===');
const acts = db.prepare(\`SELECT id, request_id, step_order, comment, created_at FROM approval_actions WHERE comment LIKE '%催辦%' OR action='comment' ORDER BY id DESC LIMIT 15\`).all();
for (const a of acts) console.log(JSON.stringify(a));
`;

const conn = new Client();
conn
  .on('ready', async () => {
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
        // also docker logs
        const cmd2 = `echo ${JSON.stringify(PASS)} | sudo -S -p '' /usr/local/bin/docker logs approval-system --tail 80 2>&1`;
        conn.exec(cmd2, (e2, s2) => {
          if (e2) {
            conn.end();
            return;
          }
          let o2 = '';
          s2.on('data', (d) => (o2 += d));
          s2.stderr.on('data', (d) => (o2 += d));
          s2.on('close', () => {
            console.log('=== docker logs ===');
            console.log(o2);
            conn.end();
          });
        });
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
