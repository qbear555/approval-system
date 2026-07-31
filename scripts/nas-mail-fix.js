/** Patch ignoreTLS on NAS mail config and send a real test mail */
const { Client } = require('ssh2');
const PASS = process.env.NAS_PASS || '';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const USER = process.env.NAS_USER || 'tsuming';

const remoteScript = `
const fs = require('fs');
const path = '/app/data/mail-config.json';
const c = JSON.parse(fs.readFileSync(path, 'utf8'));
c.ignoreTLS = true;
c.requireTLS = false;
c.secure = false;
if (Number(c.port) === 25) c.ignoreTLS = true;
fs.writeFileSync(path, JSON.stringify(c, null, 2));
console.log('patched config', JSON.stringify({enabled:c.enabled,host:c.host,port:c.port,secure:c.secure,ignoreTLS:c.ignoreTLS,requireTLS:c.requireTLS,user:c.user,from:c.from,hasPass:!!c.pass}));

const mail = require('/app/server/mail');
mail.sendMail({
  to: 'tsuming@catshome.tw',
  subject: '【簽核系統】SMTP 修復後測試 ' + new Date().toISOString(),
  text: '若您收到此信，表示埠 25 ignoreTLS 設定已正常。',
  html: '<p>若您收到此信，表示埠 25 ignoreTLS 設定已正常。</p>',
  meta: { type: 'test-after-fix' },
}).then((r) => {
  console.log('SEND_RESULT', JSON.stringify(r, null, 2));
}).catch((e) => {
  console.error('SEND_ERR', e);
});
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
  .connect({
    host: HOST,
    username: USER,
    password: PASS,
    readyTimeout: 30000,
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
    },
  });
