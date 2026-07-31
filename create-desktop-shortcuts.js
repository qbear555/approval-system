/**
 * 建立桌面捷徑：本機控制台 / 啟用 / 停用
 * node create-desktop-shortcuts.js
 *
 * 使用 PowerShell -EncodedCommand（UTF-16LE）完整支援中文檔名
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = __dirname;
const desks = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'OneDrive', 'Desktop'),
  'F:\\TsuMing\\Desktop',
  process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'),
].filter((d) => d && fs.existsSync(d));

// 中文檔名用 Unicode 字碼組出，避免腳本本身編碼問題
const zh = {
  console: '線上簽核-本機控制台.lnk',
  start: '線上簽核-本機啟用.lnk',
  stop: '線上簽核-本機停用.lnk',
};

const items = [
  {
    names: [zh.console, 'Approval-Local-Console.lnk'],
    target: path.join(root, 'local-server-control.bat'),
    desc: 'Approval Local Console',
  },
  {
    names: [zh.start, 'Approval-Local-Start.lnk'],
    target: path.join(root, 'local-server-start.bat'),
    desc: 'Start local Approval System',
  },
  {
    names: [zh.stop, 'Approval-Local-Stop.lnk'],
    target: path.join(root, 'local-server-stop.bat'),
    desc: 'Stop local Approval System',
  },
];

function psEncode(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function makeShortcut(lnk, target, work, desc) {
  const esc = (s) => String(s).replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$sh = New-Object -ComObject WScript.Shell',
    `$sc = $sh.CreateShortcut('${esc(lnk)}')`,
    `$sc.TargetPath = '${esc(target)}'`,
    `$sc.WorkingDirectory = '${esc(work)}'`,
    `$sc.Description = '${esc(desc)}'`,
    '$sc.Save()',
  ].join('; ');
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncode(script)],
    { stdio: 'pipe', windowsHide: true }
  );
}

const uniqueDesks = [...new Set(desks)];
let ok = 0;
let fail = 0;

for (const desk of uniqueDesks) {
  for (const it of items) {
    if (!fs.existsSync(it.target)) {
      console.warn('missing target', it.target);
      fail++;
      continue;
    }
    for (const name of it.names) {
      const lnk = path.join(desk, name);
      try {
        makeShortcut(lnk, it.target, root, it.desc);
        console.log('OK', name, '->', desk);
        ok++;
      } catch (e) {
        console.error('FAIL', lnk, e.message);
        fail++;
      }
    }
  }
}

console.log(`Done. ok=${ok} fail=${fail}`);
console.log('Desktops:', uniqueDesks.join(' | '));
console.log('URL: http://127.0.0.1:8080/');
