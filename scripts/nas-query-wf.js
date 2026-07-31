/** Dump leave workflow template steps */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/approval.db');
const wfs = db.prepare('SELECT id, name, active, steps_json FROM workflows ORDER BY id').all();
for (const w of wfs) {
  console.log('=== WF', w.id, w.name, 'active', w.active);
  try {
    const steps = JSON.parse(w.steps_json||'[]');
    for (const s of steps) {
      console.log(JSON.stringify({order:s.order,name:s.name,assignType:s.assignType,mode:s.mode,approverIds:s.approverIds,department:s.department,formFieldId:s.formFieldId}));
    }
  } catch(e) { console.log(e.message); }
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
