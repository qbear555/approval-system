const { Client } = require('ssh2');

const PASS = process.env.NAS_PASS || 'Ww837*5630';
const HOST = process.env.NAS_HOST || '192.168.99.220';
const PORT = Number(process.env.NAS_PORT || 9922);
const USER = process.env.NAS_USER || 'tsuming';

function execRemote(conn, cmd, sudo = false) {
  return new Promise((resolve, reject) => {
    const full = sudo
      ? `echo ${JSON.stringify(PASS)} | sudo -S -p '' env PATH=/usr/local/bin:/usr/bin:/bin sh -c ${JSON.stringify(cmd)}`
      : `sh -c ${JSON.stringify(cmd)}`;
    conn.exec(full, (err, stream) => {
      if (err) return reject(err);
      let o = '';
      stream.on('data', (d) => (o += d));
      stream.stderr.on('data', (d) => (o += d));
      stream.on('close', (c) => resolve({ c, o }));
    });
  });
}

async function checkInfra() {
  console.log('Connecting to NAS via SSH...');
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 10000 });
  });

  console.log('\n--- 1. Docker 容器狀態 ---');
  const ps = await execRemote(conn, 'docker ps --filter name=approval', true);
  console.log(ps.o.trim());

  console.log('\n--- 2. 磁碟空間 (df -h) ---');
  const df = await execRemote(conn, 'df -h | grep -E "volume|Filesystem"', false);
  console.log(df.o.trim());

  console.log('\n--- 3. 記憶體使用 (free -m) ---');
  const mem = await execRemote(conn, 'free -m', false);
  console.log(mem.o.trim());

  console.log('\n--- 4. USB 備份目錄內容 (/volumeUSB2/usbshare/approval-backups) ---');
  const lsBackup = await execRemote(conn, 'ls -la /volumeUSB2/usbshare/approval-backups/ 2>&1', true);
  console.log(lsBackup.o.trim());

  console.log('\n--- 5. 最近一份備份詳情 ---');
  const latestBackup = await execRemote(conn, 'ls -la /volumeUSB2/usbshare/approval-backups/*/ 2>&1', true);
  console.log(latestBackup.o.trim());

  console.log('\n--- 6. Synology Task Scheduler 排程設定 ---');
  const cron = await execRemote(conn, 'sqlite3 /usr/syno/etc/esynoscheduler/esynoscheduler.db "SELECT task_name, enable, crontab, command FROM task WHERE task_name LIKE \'%Approval%\'" 2>/dev/null || cat /etc/crontab', true);
  console.log(cron.o.trim());

  conn.end();
}

checkInfra().catch(console.error);
