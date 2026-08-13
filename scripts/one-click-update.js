/**
 * 一鍵更新（2026-08-01 功能包 + 之後程式）
 *
 * Usage:
 *   node scripts/one-click-update.js              # 互動選單
 *   node scripts/one-click-update.js --nas        # 部署 NAS（需 NAS_PASS）
 *   node scripts/one-click-update.js --packages   # 同步 D:\一鍵安裝包
 *   node scripts/one-click-update.js --local      # 本機啟動 3847
 *   node scripts/one-click-update.js --all        # NAS + 一鍵包 + 本機
 *   node scripts/one-click-update.js --list       # 列出本次功能
 *
 * Env:
 *   NAS_HOST (default 192.168.99.220)
 *   NAS_USER (default tsuming)
 *   NAS_PASS (required for --nas / --all)
 *   NAS_SKIP_DB=1 always for data safety
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const DOCKER = process.env.NAS_DOCKER || '/usr/local/bin/docker';
const SFTP_ROOT = process.env.NAS_SFTP_DIR || '/docker/approval-system';
const REMOTE = process.env.NAS_DIR || '/volume1/docker/approval-system';
const CONTAINER = process.env.NAS_CONTAINER || 'approval-system';

/** 本次更新必帶檔案（其餘 server/public 一併整包同步到一鍵包） */
const HOT_FILES = [
  'server/system-settings.js',
  'server/index.js',
  'server/pdf-sign.js',
  'public/js/app.js',
  'public/css/style.css',
  'public/index.html',
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'start-server.js',
  'local-server-control.bat',
  'local-server-control.ps1',
  'local-server-start.bat',
  'local-server-stop.bat',
  'create-desktop-shortcuts.js',
];

const FEATURES = [
  '總覽公告（系統設定維護、總覽顯示）',
  '公布期間（到期自動下架）',
  '附件僅檢視（不提供下載）',
  '重新整理保留目前頁面',
  '本機 Server 啟用／停用／控制台',
  'PDF 自簽憑證支援中文 CN／O',
];

function log(...a) {
  console.log(...a);
}

function fail(msg) {
  console.error('[ERR]', msg);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  return {
    nas: flags.has('--nas') || flags.has('--all'),
    packages: flags.has('--packages') || flags.has('--all'),
    local: flags.has('--local') || flags.has('--all'),
    all: flags.has('--all'),
    list: flags.has('--list'),
    interactive: !argv.some((a) => a.startsWith('--')),
  };
}

function listFeatures() {
  log('');
  log('=== 本次一鍵更新包含功能（2026-08-01）===');
  FEATURES.forEach((f, i) => log(`  ${i + 1}. ${f}`));
  log('');
  log('文件: docs/一鍵更新-2026-08-01-本次功能.md');
  log('倉庫: https://github.com/qbear555/approval-system');
  log('');
}

function resolveOneClickRoot() {
  const hint = process.env.ONECLICK_ROOT;
  if (hint && fs.existsSync(path.join(hint, 'NAS', 'ApprovalSystem-NAS-Install', 'package.json'))) {
    return hint;
  }
  const d = 'D:\\一鍵安裝包';
  if (fs.existsSync(path.join(d, 'NAS', 'ApprovalSystem-NAS-Install', 'package.json'))) {
    return d;
  }
  // scan D:\
  try {
    for (const name of fs.readdirSync('D:\\')) {
      const p = path.join('D:\\', name);
      if (
        fs.existsSync(path.join(p, 'NAS', 'ApprovalSystem-NAS-Install', 'package.json'))
      ) {
        return p;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function syncPackages() {
  const root = resolveOneClickRoot();
  if (!root) {
    log('[跳過] 找不到 D:\\一鍵安裝包');
    return false;
  }
  const targets = [
    path.join(root, 'NAS', 'ApprovalSystem-NAS-Install'),
    path.join(root, 'Ubuntu', 'ApprovalSystem-Ubuntu-Install'),
    path.join(root, 'Windows', 'ApprovalSystem-Portable', 'app'),
  ];
  const dirs = ['server', 'public', 'fonts', 'docs', 'seed-workflows'];
  const files = [
    'package.json',
    'package-lock.json',
    'Dockerfile',
    'docker-compose.yml',
    'docker-entrypoint.sh',
    '.dockerignore',
    'start-server.js',
    'CHANGELOG.md',
    'README.md',
  ];
  log('OneClick root:', root);
  for (const dstRoot of targets) {
    if (!fs.existsSync(dstRoot)) {
      log('[跳過]', dstRoot);
      continue;
    }
    log('===', dstRoot, '===');
    for (const d of dirs) {
      const src = path.join(ROOT, d);
      const dst = path.join(dstRoot, d);
      if (!fs.existsSync(src)) continue;
      fs.rmSync(dst, { recursive: true, force: true });
      copyTree(src, dst);
      log('  dir', d);
    }
    for (const f of files) {
      const src = path.join(ROOT, f);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(dstRoot, f));
      log('  file', f);
    }
  }
  // Windows 便攜版：同步本機控制腳本到 app 上一層也可放 app 內
  const winApp = path.join(root, 'Windows', 'ApprovalSystem-Portable', 'app');
  if (fs.existsSync(winApp)) {
    for (const f of [
      'local-server-control.bat',
      'local-server-control.ps1',
      'local-server-start.bat',
      'local-server-stop.bat',
      'create-desktop-shortcuts.js',
    ]) {
      const src = path.join(ROOT, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(winApp, f));
        log('  win', f);
      }
    }
  }
  // 同步紀錄
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const logPath = path.join(root, `同步紀錄-${stamp}-一鍵更新.txt`);
    fs.writeFileSync(
      logPath,
      [
        `時間: ${new Date().toISOString()}`,
        `來源: ${ROOT}`,
        '內容: one-click-update 同步 server/public/docs 等',
        '功能: ' + FEATURES.join('；'),
        '未覆寫 data/',
        '',
      ].join('\n'),
      'utf8'
    );
    log('log', logPath);
  } catch (e) {
    log('[警告] 寫同步紀錄失敗', e.message);
  }
  log('[OK] 一鍵安裝包已同步');
  return true;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(String(ans || '').trim());
    });
  });
}

async function ensureNasPass() {
  if (process.env.NAS_PASS) return process.env.NAS_PASS;
  const p = await ask('NAS SSH 密碼: ');
  if (!p) fail('未輸入 NAS 密碼');
  process.env.NAS_PASS = p;
  return p;
}

async function deployNas() {
  const PASS = await ensureNasPass();
  const HOST = process.env.NAS_HOST || '192.168.99.220';
  const USER = process.env.NAS_USER || 'tsuming';
  let Client;
  try {
    Client = require('ssh2').Client;
  } catch {
    fail('需要 ssh2：請在專案目錄執行 npm install');
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => resolve(c))
        .on('error', reject)
        .connect({
          host: HOST,
          port: 22,
          username: USER,
          password: PASS,
          readyTimeout: 30000,
          algorithms: {
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss'],
          },
        });
    });
  }

  function exec(conn, cmd) {
    const full = `echo ${JSON.stringify(PASS)} | sudo -S -p '' sh -lc ${JSON.stringify(
      `export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; ${cmd}`
    )}`;
    return new Promise((resolve, reject) => {
      conn.exec(full, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        stream
          .on('close', (code) => resolve({ code, stdout }))
          .on('data', (d) => {
            stdout += d.toString();
            process.stdout.write(d);
          });
        stream.stderr.on('data', (d) => process.stderr.write(d));
      });
    });
  }

  function sftp(conn) {
    return new Promise((resolve, reject) => {
      conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
    });
  }

  function put(s, local, remote) {
    return new Promise((resolve, reject) => {
      s.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
    });
  }

  async function ensureRemoteDir(s, dir) {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += '/' + p;
      await new Promise((resolve) => s.mkdir(cur, () => resolve()));
    }
  }

  log(`NAS ${USER}@${HOST} 部署中（NAS_SKIP_DB=1，不覆寫 data）…`);
  const conn = await connect();
  log('SSH OK');
  const s = await sftp(conn);

  // 熱更新檔 + 整包 server/public
  const walk = (relDir) => {
    const out = [];
    const full = path.join(ROOT, relDir);
    if (!fs.existsSync(full)) return out;
    const rec = (abs, rel) => {
      for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
        if (ent.name === 'node_modules') continue;
        const r = `${rel}/${ent.name}`.replace(/\\/g, '/');
        const a = path.join(abs, ent.name);
        if (ent.isDirectory()) rec(a, r);
        else out.push(r);
      }
    };
    rec(full, relDir.replace(/\\/g, '/'));
    return out;
  };

  const fileSet = new Set([...HOT_FILES, ...walk('server'), ...walk('public')]);

  for (const rel of fileSet) {
    const local = path.join(ROOT, rel);
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) continue;
    const remote = `${SFTP_ROOT}/${rel.replace(/\\/g, '/')}`;
    await ensureRemoteDir(s, path.posix.dirname(remote));
    await put(s, local, remote);
    log('put', rel);
  }

  // announcements 目錄權限（避免上傳附件 EACCES）
  await exec(
    conn,
    `mkdir -p ${REMOTE}/data/announcements; chmod 777 ${REMOTE}/data/announcements; chown 1000:1000 ${REMOTE}/data/announcements 2>/dev/null || true`
  );

  // 複製進容器並重啟（保留 data volume）
  await exec(
    conn,
    `${DOCKER} cp ${REMOTE}/server/. ${CONTAINER}:/app/server/ && ` +
      `${DOCKER} cp ${REMOTE}/public/. ${CONTAINER}:/app/public/ && ` +
      `${DOCKER} restart ${CONTAINER}`
  );
  log('waiting restart…');
  await new Promise((r) => setTimeout(r, 8000));
  await exec(conn, `curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3847/`);
  await exec(
    conn,
    `${DOCKER} exec ${CONTAINER} sh -c "grep -c getAnnouncementSchedule /app/server/system-settings.js; grep -c 僅供檢視 /app/public/js/app.js || true"`
  );
  conn.end();
  log('[OK] NAS 部署完成');
  log(`    http://${HOST}:3847/`);
  log(`    https://${HOST}:3848/`);
  return true;
}

function stopLocal8080() {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "Get-NetTCPConnection -LocalPort 3847 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }",
      ],
      { stdio: 'ignore', windowsHide: true }
    );
  } catch {
    /* ignore */
  }
}

function startLocal() {
  log('啟動本機 Server（3847）…');
  stopLocal8080();
  const node =
    process.env.NODE ||
    (fs.existsSync('C:\\Program Files\\nodejs\\node.exe')
      ? 'C:\\Program Files\\nodejs\\node.exe'
      : 'node');
  const child = spawn(node, [path.join(ROOT, 'start-server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: '3847', HTTPS_ENABLED: '0' },
    windowsHide: true,
  });
  child.unref();
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      tries++;
      const req = http.get('http://127.0.0.1:3847/', (res) => {
        res.resume();
        log('[OK] 本機已啟動 http://127.0.0.1:3847/  status=', res.statusCode);
        try {
          spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:3847/'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          }).unref();
        } catch {
          /* ignore */
        }
        resolve(true);
      });
      req.on('error', () => {
        if (tries >= 20) {
          log('[警告] 已送出啟動，但尚未偵測到 3847，請手動開啟 local-server-control.bat');
          resolve(false);
        } else setTimeout(tick, 400);
      });
    };
    setTimeout(tick, 800);
  });
}

async function interactiveMenu() {
  listFeatures();
  log('請選擇：');
  log('  1) 部署到 NAS（保留 data）');
  log('  2) 同步到 D:\\一鍵安裝包');
  log('  3) 啟動本機開發 Server（3847）');
  log('  4) 全部執行（1 → 2 → 3）');
  log('  0) 取消');
  const ans = await ask('輸入選項 [1/2/3/4/0]: ');
  if (ans === '1') return { nas: true };
  if (ans === '2') return { packages: true };
  if (ans === '3') return { local: true };
  if (ans === '4') return { nas: true, packages: true, local: true, all: true };
  log('已取消');
  process.exit(0);
}

async function main() {
  let opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    listFeatures();
    return;
  }
  if (opts.interactive) {
    opts = { ...opts, ...(await interactiveMenu()) };
  } else {
    listFeatures();
  }

  log('ROOT =', ROOT);
  if (opts.nas) await deployNas();
  if (opts.packages) syncPackages();
  if (opts.local) await startLocal();

  log('');
  log('======== 一鍵更新結束 ========');
  if (opts.nas) log('NAS: 請 Ctrl+F5 確認總覽公告／系統設定');
  if (opts.packages) log('一鍵包: D:\\一鍵安裝包 已更新');
  if (opts.local) log('本機: http://127.0.0.1:3847/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
