/** Inspect mail config + final approver user on NAS */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/approval.db');

// users with ids in recent snapshots
const users = db.prepare('SELECT id, username, name, email, active, role FROM users WHERE active=1 ORDER BY id').all();
console.log('=== users ===');
for (const u of users) console.log(JSON.stringify(u));

// mail config
const cfgPath = '/app/data/mail-config.json';
console.log('=== mail config ===');
if (fs.existsSync(cfgPath)) {
  const c = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  console.log(JSON.stringify({...c, pass: c.pass ? '(set)' : ''}, null, 2));
} else console.log('no config');

// request 6 detail actions
console.log('=== request 6 actions ===');
const acts = db.prepare(\`SELECT id, step_order, step_name, actor_id, action, comment, created_at FROM approval_actions WHERE request_id=6 ORDER BY id\`).all();
for (const a of acts) console.log(JSON.stringify(a));

const r = db.prepare('SELECT id, status, current_step, steps_snapshot_json FROM approval_requests WHERE id=6').get();
console.log('=== request 6 ===', r && {id:r.id,status:r.status,current_step:r.current_step});
const steps = JSON.parse(r.steps_snapshot_json||'[]');
console.log(JSON.stringify(steps,null,2));
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
