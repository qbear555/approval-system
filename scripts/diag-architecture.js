const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db'));

function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          })
        );
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runAudit() {
  const results = {
    database: { status: 'PENDING', tables: {}, checks: [] },
    backend: { status: 'PENDING', routes: [], checks: [] },
    frontend: { status: 'PENDING', classic: [], v2: [], checks: [] },
    storage: { status: 'PENDING', checks: [] },
    nas: { status: 'PENDING', checks: [] },
  };

  console.log('====================================================');
  console.log('   線上簽核系統 全架構完整性深入診斷 (Architecture Audit)');
  console.log('====================================================\n');

  // 1. 資料庫完整性檢查 (Database Integrity)
  console.log('[1/5] 檢查資料庫架構與資料完整性 (MySQL on NAS)...');
  try {
    const rawTables = db
      .prepare('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()')
      .all();
    const tableNames = rawTables.map((t) => t.TABLE_NAME || t.table_name);
    console.log(`  ✓ 已連線至資料庫，共發現 ${tableNames.length} 張資料表`);

    const expectedTables = [
      'users',
      'workflows',
      'approval_requests',
      'approval_actions',
      'departments',
      'backup_files',
      'user_departments',
      'request_attachments',
      'final_notify_receipts',
      'user_delegations',
      'system_audit_logs',
      'request_node_states',
      'user_devices',
    ];

    const missingTables = expectedTables.filter((t) => !tableNames.includes(t));
    if (missingTables.length > 0) {
      results.database.checks.push({
        name: '資料表完整性',
        status: 'FAIL',
        message: `缺少預期資料表: ${missingTables.join(', ')}`,
      });
    } else {
      results.database.checks.push({
        name: '資料表完整性',
        status: 'PASS',
        message: '13 張核心資料表全數齊全',
      });
    }

    for (const name of expectedTables) {
      if (tableNames.includes(name)) {
        const count = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get().c;
        results.database.tables[name] = Number(count);
        console.log(`    - ${name.padEnd(23)}: ${count} 筆紀錄`);
      }
    }

    // 孤立紀錄檢查 (Orphaned Record Checks)
    const orphanedActions = db
      .prepare(
        `SELECT COUNT(*) as c FROM approval_actions a
         LEFT JOIN approval_requests r ON a.request_id = r.id
         WHERE r.id IS NULL`
      )
      .get().c;

    const orphanedAttachments = db
      .prepare(
        `SELECT COUNT(*) as c FROM request_attachments att
         LEFT JOIN approval_requests r ON att.request_id = r.id
         WHERE r.id IS NULL`
      )
      .get().c;

    const orphanedReceipts = db
      .prepare(
        `SELECT COUNT(*) as c FROM final_notify_receipts fnr
         LEFT JOIN approval_requests r ON fnr.request_id = r.id
         WHERE r.id IS NULL`
      )
      .get().c;

    console.log(`    - 孤立關聯簽核行為 (Orphaned Actions): ${orphanedActions} 筆`);
    console.log(`    - 孤立關聯單據附件 (Orphaned Attachments): ${orphanedAttachments} 筆`);
    console.log(`    - 孤立關聯通知回條 (Orphaned Receipts): ${orphanedReceipts} 筆`);

    if (orphanedActions === 0 && orphanedAttachments === 0 && orphanedReceipts === 0) {
      results.database.checks.push({
        name: '外鍵/外聯一致性 (Referential Integrity)',
        status: 'PASS',
        message: '無任何孤立殘留記錄',
      });
    } else {
      results.database.checks.push({
        name: '外鍵/外聯一致性 (Referential Integrity)',
        status: 'WARN',
        message: `發現孤立記錄 (Actions: ${orphanedActions}, Attachments: ${orphanedAttachments}, Receipts: ${orphanedReceipts})`,
      });
    }

    // 單據狀態分佈
    const reqStatus = db
      .prepare('SELECT status, COUNT(*) as c FROM approval_requests GROUP BY status')
      .all();
    console.log(
      '    - 單據狀態分佈:',
      reqStatus.map((s) => `${s.status}: ${s.c}`).join(' | ')
    );

    // 稽核日誌可用性驗證
    const recentAudit = db
      .prepare('SELECT id, action_type, created_at FROM system_audit_logs ORDER BY id DESC LIMIT 1')
      .get();
    if (recentAudit) {
      results.database.checks.push({
        name: '系統稽核日誌運作 (Audit Logging)',
        status: 'PASS',
        message: `最近日誌 #${recentAudit.id} (${recentAudit.action_type} at ${recentAudit.created_at})`,
      });
    } else {
      results.database.checks.push({
        name: '系統稽核日誌運作 (Audit Logging)',
        status: 'WARN',
        message: '尚無稽核日誌記錄',
      });
    }

    results.database.status = 'PASS';
  } catch (err) {
    console.error('  ❌ 資料庫檢查失敗:', err.message);
    results.database.status = 'FAIL';
    results.database.error = err.message;
  }

  // 2. 後端伺服器模組與架構 (Backend Services & Routes)
  console.log('\n[2/5] 檢查後端模組拆分與架構 (Server Architecture)...');
  const requiredModules = [
    { file: 'server/runtime.js', name: 'Runtime 核心門面' },
    { file: 'server/runtime/flow.js', name: '流程運算引擎' },
    { file: 'server/runtime/notify.js', name: '郵件/通知派送模組' },
    { file: 'server/runtime/perms.js', name: '權限與角色驗證' },
    { file: 'server/runtime/devices.js', name: '裝置憑證管理' },
    { file: 'server/pdf/write.js', name: 'PDF 套版生成引擎' },
    { file: 'server/pdf/forms/leave.js', name: '請假單 PDF 表單' },
    { file: 'server/pdf/forms/purchase.js', name: '請購單 PDF 表單' },
    { file: 'server/pdf/forms/credit.js', name: '信用額度 PDF 表單' },
    { file: 'server/routes/auth.js', name: 'Auth 路由模組' },
    { file: 'server/routes/requests.js', name: 'Requests 路由模組' },
    { file: 'server/routes/actions.js', name: 'Actions 路由模組' },
    { file: 'server/routes/actions-extra.js', name: '退回/重送擴充路由' },
    { file: 'server/routes/workflows.js', name: 'Workflows 路由模組' },
    { file: 'server/routes/departments.js', name: 'Departments 路由模組' },
    { file: 'server/routes/users.js', name: 'Users 路由模組' },
    { file: 'server/routes/backups.js', name: 'Backups 路由模組' },
    { file: 'server/routes/system.js', name: 'System 路由模組' },
    { file: 'server/routes/audit.js', name: 'Audit 路由模組' },
    { file: 'server/comment-phrases.js', name: '簽核片語模組' },
    { file: 'server/request-export.js', name: 'Excel 匯出引擎' },
  ];

  let missingModuleCount = 0;
  for (const m of requiredModules) {
    const full = path.join(ROOT, m.file);
    if (!fs.existsSync(full)) {
      console.log(`  ❌ 缺失核心檔案: ${m.file} (${m.name})`);
      missingModuleCount++;
    }
  }
  if (missingModuleCount === 0) {
    console.log(`  ✓ ${requiredModules.length} 個後端模組與路由拆分結構完備無缺`);
    results.backend.checks.push({
      name: '後端模組化結構 (Server Modularity)',
      status: 'PASS',
      message: `${requiredModules.length}/${requiredModules.length} 模組檔案完備`,
    });
    results.backend.status = 'PASS';
  } else {
    results.backend.status = 'FAIL';
  }

  // 3. 正式環境 NAS API 與服務探活 (Live API Probes on NAS: 192.168.99.220:3847)
  console.log('\n[3/5] 實測 NAS 正式環境 API 端點回應 (192.168.99.220:3847)...');
  const apiProbes = [
    { path: '/api/health', expectCode: 200, name: '健康探針 (/api/health)' },
    { path: '/api/system/settings', expectCode: 200, name: '公開系統設定 (/api/system/settings)' },
    { path: '/api/system/branding', expectCode: 200, name: '品牌資訊 (/api/system/branding)' },
    { path: '/api/system/logo', expectCode: 200, name: '系統 Logo 讀取 (/api/system/logo)' },
    { path: '/api/departments', expectCode: 200, name: '部門選單公開 API (/api/departments)' },
    { path: '/api/tw-calendar', expectCode: 200, name: '台灣假勤行事曆 (/api/tw-calendar)' },
    { path: '/line/webhook', expectCode: 200, name: 'LINE 機器人 Webhook 探活 (/line/webhook)' },
    { path: '/api/auth/me', expectCode: 401, name: '未驗證存取鑑權防護 (/api/auth/me -> 401)' },
    { path: '/api/stats', expectCode: 401, name: '未驗證統計資訊鑑權防護 (/api/stats -> 401)' },
  ];

  for (const probe of apiProbes) {
    try {
      const res = await fetchHttp(`http://192.168.99.220:3847${probe.path}`);
      if (res.statusCode === probe.expectCode) {
        console.log(`    ✓ [HTTP ${res.statusCode}] ${probe.name}`);
        results.nas.checks.push({ name: probe.name, status: 'PASS', code: res.statusCode });
      } else {
        console.log(
          `    ⚠️ [HTTP ${res.statusCode} (預期 ${probe.expectCode})] ${probe.name}`
        );
        results.nas.checks.push({
          name: probe.name,
          status: 'WARN',
          code: res.statusCode,
          expected: probe.expectCode,
        });
      }
    } catch (e) {
      console.log(`    ❌ 無法連線至 ${probe.name}: ${e.message}`);
      results.nas.checks.push({ name: probe.name, status: 'FAIL', error: e.message });
    }
  }

  // 4. 前端雙軌架構驗證 (Classic & Vue 3 Dual-Track)
  console.log('\n[4/5] 檢查前端雙軌產物與相容架構 (Classic & Vue 3)...');
  // 經典版
  const classicScripts = [
    'vendor/pdfjs/pdf.min.js',
    'js/tw-calendar.js',
    'js/rich-editor.js',
    'js/ui-helpers.js',
    'js/pdf-form-designer.js',
    'js/flow-editor.js',
    'js/app.js',
    'js/pages-dashboard.js',
    'js/pages-request-fields.js',
    'js/pages-request-table.js',
    'js/pages-request-view.js',
    'js/pages-request-list.js',
    'js/pages-request-new.js',
    'js/pages-request-detail.js',
    'js/pages-workflows.js',
    'js/pages-backups.js',
    'js/pages-leave-report.js',
    'js/pages-users.js',
    'js/pages-departments.js',
    'js/pages-audit.js',
    'js/pages-settings.js',
    'js/pages-line.js',
    'js/pages-system.js',
  ];

  let missingScriptCount = 0;
  for (const s of classicScripts) {
    if (!fs.existsSync(path.join(ROOT, 'public', s))) {
      missingScriptCount++;
      console.log(`  ❌ 經典版缺少腳本: public/${s}`);
    }
  }
  if (missingScriptCount === 0) {
    console.log(`  ✓ 經典版 (${classicScripts.length}/${classicScripts.length}) 所有靜態 JS 檔案存在`);
    results.frontend.checks.push({
      name: '經典前端靜態檔完整性',
      status: 'PASS',
      message: `${classicScripts.length} 支前端模組齊全`,
    });
  }

  // Vue 3 版
  const v2Index = path.join(ROOT, 'public', 'v2', 'index.html');
  const v2AssetsDir = path.join(ROOT, 'public', 'v2', 'assets');
  if (fs.existsSync(v2Index) && fs.existsSync(v2AssetsDir)) {
    const assets = fs.readdirSync(v2AssetsDir);
    console.log(`  ✓ Vue 3 (v2) 建置產物齊全 (index.html 及 ${assets.length} 個打包 chunk)`);
    results.frontend.checks.push({
      name: 'Vue 3 打包產物完整性',
      status: 'PASS',
      message: `已編譯完成，含 ${assets.length} 個 asset chunks`,
    });
  } else {
    console.log('  ❌ Vue 3 打包產物遺失');
    results.frontend.checks.push({
      name: 'Vue 3 打包產物完整性',
      status: 'FAIL',
      message: 'public/v2 尚未建置',
    });
  }

  // 5. 備份與資料儲存架構 (Storage & Backup Verification)
  console.log('\n[5/5] 檢查備份排程與實體存放架構 (Backup Architecture)...');
  const backupScriptPath = path.join(ROOT, 'scripts', 'nas-auto-backup.sh');
  if (fs.existsSync(backupScriptPath)) {
    const scriptContent = fs.readFileSync(backupScriptPath, 'utf8');
    const hasUsbMountCheck = scriptContent.includes('/volumeUSB2/usbshare');
    const hasSha256 = scriptContent.includes('sha256sum');
    const hasRetention = scriptContent.includes('KEEP_DAYS=180');
    const hasInterval = scriptContent.includes('INTERVAL_DAYS=30');

    console.log('  ✓ 備份腳本 scripts/nas-auto-backup.sh 存在');
    console.log(`    - USB2 外接碟掛載防護 (/volumeUSB2/usbshare): ${hasUsbMountCheck ? '✓ 已包含' : '❌ 缺失'}`);
    console.log(`    - 30 天頻率節流防護 (INTERVAL_DAYS=30): ${hasInterval ? '✓ 已包含' : '❌ 缺失'}`);
    console.log(`    - 180 天舊檔自動輪替清除 (KEEP_DAYS=180): ${hasRetention ? '✓ 已包含' : '❌ 缺失'}`);
    console.log(`    - SHA256 校驗碼生成: ${hasSha256 ? '✓ 已包含' : '❌ 缺失'}`);

    results.storage.checks.push({
      name: '外接 USB 30 天自動備份機制',
      status: hasUsbMountCheck && hasInterval && hasRetention && hasSha256 ? 'PASS' : 'WARN',
      message: '具備掛載檢查、30天節流、180天保留與SHA256驗證',
    });
  } else {
    results.storage.checks.push({
      name: '外接 USB 30 天自動備份機制',
      status: 'FAIL',
      message: '找不到 scripts/nas-auto-backup.sh',
    });
  }

  // 儲存目錄權限與存在性
  const dataUploads = path.join(ROOT, 'data', 'uploads');
  const dataBackups = path.join(ROOT, 'data', 'backups');
  console.log(`  ✓ 本地資料目錄狀態: uploads: ${fs.existsSync(dataUploads)}, backups: ${fs.existsSync(dataBackups)}`);

  console.log('\n====================================================');
  console.log('               架構診斷完成 (Audit Complete)');
  console.log('====================================================\n');

  return results;
}

runAudit()
  .then((res) => {
    fs.writeFileSync(
      path.join(ROOT, 'docs', 'architecture-audit-result.json'),
      JSON.stringify(res, null, 2),
      'utf8'
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
