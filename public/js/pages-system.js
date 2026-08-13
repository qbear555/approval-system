/**
 * 系統設定完整包／品牌／公告
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
/** 側欄「LINE 通知」完整設定頁 */
async function renderLineSettings(body) {
  if (!canConfigureLine()) {
    body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
    return;
  }
  let cfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'builtin_admin',
    events: {},
  };
  try {
    const data = await api('/api/line/config');
    if (!data.canConfigure) {
      body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
      return;
    }
    cfg = { ...cfg, ...data };
    state.lineCanConfigure = true;
    state.lineConfigAccess = cfg.configAccess;
    state.lineReady = !!cfg.ready;
    state.lineEnabled = !!cfg.enabled;
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${esc(e.message || '無法載入 LINE 設定')}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="system-settings-page">
      <div class="card">
        <h3>💬 LINE 通知設定</h3>
        ${lineSettingsFormHtml(cfg, { formId: 'line-form', showAccess: true })}
      </div>
      <div class="card">
        <h3>使用說明</h3>
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#334155">
          <li>確認 LINE 服務在 NAS 執行：<code>http://192.168.99.220:3850/health</code></li>
          <li>API 金鑰須與 <code>D:\\Line 專案</code>（或 NAS line-notify）的 <code>INTERNAL_API_KEY</code> 相同</li>
          <li>Webhook 需公網 HTTPS 才能綁定（Messaging API）</li>
          <li>成員私訊官方帳號：<code>綁定 帳號</code> 後才收得到推播</li>
        </ol>
      </div>
    </div>`;

  bindLineSettingsForm({
    formId: 'line-form',
    onSaved: () => navigate('line-settings'),
  });
}

/** 系統設定（僅內建 Admin 帳號） */
async function renderSystemSettings(body) {
  if (!isBuiltinAdmin()) {
    body.innerHTML = `<div class="error-msg">僅系統內建 Admin 帳號可進入系統設定（其他最高權限使用者亦無法存取）</div>`;
    return;
  }

  let brand = state.systemSettings || {};
  let pdfSign = {
    enabled: false,
    hasCert: false,
    hasPass: false,
    onlyApproved: true,
    ready: false,
    reason: '線上簽核系統正式產出文件',
    location: 'Taiwan',
    contactInfo: '',
    signerName: '',
    libsReady: true,
  };
  let backupEncrypt = {
    enabled: false,
    hasPass: false,
    ready: false,
  };
  let backupDir = '';
  let announcement = {
    enabled: false,
    active: false,
    title: '',
    body: '',
    hasFile: false,
    originalName: null,
    startAt: null,
    endAt: null,
    withinPeriod: true,
    scheduleStatus: 'open',
    updatedAt: null,
  };
  let accessCfgAdmin = {
    intranetOnly: true,
    loginCidrs: '192.168.99.0/24,172.16.0.0/12,127.0.0.1,::1',
    deviceBindEnabled: true,
    deviceBindMax: 3,
  };
  try {
    const adminCfg = await api('/api/system/settings/admin');
    brand = adminCfg;
    state.systemSettings = adminCfg;
    pdfSign = { ...pdfSign, ...(adminCfg.pdfSign || {}) };
    backupEncrypt = { ...backupEncrypt, ...(adminCfg.backupEncrypt || {}) };
    backupDir = adminCfg.backupDir || '';
    announcement = { ...announcement, ...(adminCfg.announcement || {}) };
    accessCfgAdmin = { ...accessCfgAdmin, ...(adminCfg.access || {}) };
  } catch {
    try {
      brand = await api('/api/system/settings');
      state.systemSettings = brand;
    } catch {
      /* keep cache */
    }
  }

  let mailCfg = {};
  try {
    mailCfg = await api('/api/mail/config');
  } catch {
    mailCfg = { enabled: false, ready: false };
  }

  let lineCfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'any_admin',
    events: {},
    canConfigure: true,
  };
  try {
    const lc = await api('/api/line/config');
    lineCfg = { ...lineCfg, ...lc };
    state.lineCanConfigure = !!lc.canConfigure;
    state.lineConfigAccess = lc.configAccess || state.lineConfigAccess;
    state.lineReady = !!lc.ready;
    state.lineEnabled = !!lc.enabled;
  } catch {
    /* keep defaults */
  }

  const logoUrl = brand.logoUrl || '/img/argo-logo.png';
  const signStatusText = pdfSign.ready
    ? '已就緒（下載／備份 PDF 將加蓋公司數位簽章）'
    : !pdfSign.libsReady
      ? `套件未就緒${pdfSign.libsError ? '：' + pdfSign.libsError : ''}`
      : !pdfSign.hasCert
        ? '尚未上傳憑證'
        : !pdfSign.enabled
          ? '已上傳憑證，尚未啟用'
          : '尚未就緒';
  const backupEncryptStatusText = backupEncrypt.ready
    ? '已就緒（備份將以 AES-256 加密 ZIP 儲存）'
    : backupEncrypt.enabled && !backupEncrypt.hasPass
      ? '已啟用但尚未設定密碼（無法執行備份）'
      : !backupEncrypt.enabled
        ? '未啟用（備份為一般 PDF／ZIP）'
        : '尚未就緒';
  const verLabel = brand.versionLabel || (brand.version ? `v${brand.version}` : '—');
  const verFull =
    brand.versionLabelFull ||
    (brand.fullVersion ? `v${brand.fullVersion}` : verLabel);
  const verBanner = brand.versionBanner || `線上簽核系統 ${verLabel}`;
  const builtAt = brand.versionBuiltAt
    ? String(brand.versionBuiltAt).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : '—';

  let deployLogHtml = `<p class="muted" style="margin:0">載入自動部署紀錄中…</p>`;
  try {
    const logData = await api('/api/system/deploy-log?limit=15');
    const entries = logData.entries || [];
    if (!entries.length) {
      deployLogHtml = `<p class="muted" style="margin:0">尚無部署紀錄（下次有程式變更並重啟後會自動寫入）。</p>`;
    } else {
      deployLogHtml = `
        <p class="muted" style="margin:0 0 10px;font-size:0.85rem;line-height:1.45">
          伺服器每次啟動會比對程式指紋；有變更時寫入
          <code>data/修改紀錄-自動.md</code> 與 <code>data/deploy-history.json</code>。
          純重啟（檔案未改）不重複記一筆。
        </p>
        <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:10px">
          <table class="data" style="margin:0;font-size:0.85rem;width:100%;table-layout:fixed">
            <thead>
              <tr>
                <th style="width:150px;white-space:nowrap">時間</th>
                <th style="width:160px;white-space:nowrap">版本</th>
                <th style="width:110px;white-space:nowrap">類型</th>
                <th style="min-width:180px">變更檔</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map((e) => {
                  const ch = e.changes || {};
                  const cnt = `改${ch.modifiedCount || 0}/新${ch.addedCount || 0}/刪${ch.removedCount || 0}`;
                  const files = [
                    ...(ch.modified || []).slice(0, 3),
                    ...(ch.added || []).slice(0, 2),
                  ]
                    .map((f) => f.replace(/^server\//, 's/').replace(/^public\//, 'p/'))
                    .join(', ');
                  const tip = [
                    ...(ch.modified || []).map((f) => `改 ${f}`),
                    ...(ch.added || []).map((f) => `新 ${f}`),
                    ...(ch.removed || []).map((f) => `刪 ${f}`),
                  ]
                    .slice(0, 20)
                    .join('\n');
                  return `<tr title="${esc(tip)}">
                    <td style="white-space:nowrap">${esc(e.atLocal || e.at || '')}</td>
                    <td><code>${esc(e.label || '')}</code></td>
                    <td>${esc(e.typeLabel || e.type || '')}</td>
                    <td>${esc(cnt)}${files ? `<div class="muted" style="font-size:0.78rem">${esc(files)}</div>` : ''}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch {
    deployLogHtml = `<p class="muted" style="margin:0">無法載入部署紀錄（需內建 Admin）。</p>`;
  }

  body.innerHTML = `
    <div class="system-settings-page">
    <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <h3 style="margin-top:0">系統版本（自動）</h3>
      <p style="margin:0;font-size:1.35rem;font-weight:700;color:#1d4ed8;letter-spacing:0.04em">${esc(verLabel)}</p>
      <p class="muted" style="margin:8px 0 0;line-height:1.55;font-size:0.9rem">
        完整版號：<strong style="color:#1e3a5f">${esc(verFull)}</strong><br/>
        建置指紋：<code>${esc(brand.versionBuild || '—')}</code>
        　·　原始檔時間：${esc(builtAt)}<br/>
        ${esc(verBanner)}<br/>
        <span style="color:#0369a1">主版號來自 package.json；掃描 server／public 產生指紋，
        <strong>修改並重新部署／重啟後會自動變更</strong>，並寫入部署修改紀錄。</span>
      </p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">自動部署修改紀錄</h3>
      ${deployLogHtml}
    </div>

    <div class="card">
      <h3 style="margin-top:0">公司品牌</h3>
      <p class="muted" style="margin-top:0">設定後將顯示於登入頁、側欄與 PDF 抬頭。僅系統管理員可修改。</p>
      <form id="brand-form" class="form-grid">
        <div class="field">
          <label>公司名稱 *</label>
          <input name="companyName" required maxlength="80"
            value="${esc(brand.companyName || '線上簽核系統')}"
            placeholder="顯示於系統標題與 PDF" />
        </div>
        <div class="field">
          <label>公司 Logo</label>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:12px 16px">
              <img id="brand-logo-preview" src="${esc(logoUrl)}" alt="Logo 預覽"
                style="display:block;max-width:220px;max-height:64px;width:auto;height:auto;object-fit:contain" />
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center">
                上傳 Logo
                <input type="file" id="brand-logo-file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" />
              </label>
              <button type="button" class="btn sm outline" id="btn-logo-reset"
                ${brand.hasCustomLogo ? '' : 'disabled'}>還原預設 Logo</button>
              <span class="muted" style="font-size:0.78rem">PNG／JPG／GIF／WEBP，建議 2MB 以內；依比例縮放</span>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存公司名稱</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">內網與電腦綁定</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        限制只能從公司網段登入；並把帳號綁在常用電腦。本機 <code>127.0.0.1</code> 永遠允許，以免管理端鎖死。
      </p>
      ${
        accessCfgAdmin.deviceBindPaused
          ? `<p class="muted" style="margin:0 0 12px;padding:8px 10px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;color:#9a3412">
              <strong>電腦綁定：開發階段已停用</strong>（程式註記 <code>DEVICE_BIND_FEATURE_ENABLED=false</code>）。
              登入不檢查、不新增綁定。上線時改回 true 即可恢復。
            </p>`
          : ''
      }
      <form id="access-form" class="form-grid">
        <div class="field check-row-box" style="grid-column:1/-1">
          <label class="check-row">
            <input type="checkbox" name="intranetOnly" ${accessCfgAdmin.intranetOnly !== false ? 'checked' : ''} />
            <span><strong>僅限內網存取</strong></span>
          </label>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>允許網段（CIDR，逗號分隔）</label>
          <input name="loginCidrs" value="${esc(accessCfgAdmin.loginCidrs || '192.168.99.0/24,172.16.0.0/12,127.0.0.1,::1')}" />
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="deviceBindEnabled" ${accessCfgAdmin.deviceBindEnabled ? 'checked' : ''} ${accessCfgAdmin.deviceBindPaused ? 'disabled' : ''} />
            <span><strong>綁定登入電腦</strong>${accessCfgAdmin.deviceBindPaused ? '（開發中停用）' : ''}</span>
          </label>
        </div>
        <div class="field">
          <label>每帳號最多幾台</label>
          <input name="deviceBindMax" type="number" min="1" max="10" value="${esc(String(accessCfgAdmin.deviceBindMax || 3))}" ${accessCfgAdmin.deviceBindPaused ? 'disabled' : ''} />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">儲存存取限制</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">總覽公告</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        於<strong>總覽</strong>顯示一則公司公告卡。可上傳附件；同仁點「查看」可讀全文並開啟／下載附件。
        可設定<strong>公布期間</strong>，超過結束時間自動下架（總覽不再顯示）。
        部署不覆蓋 <code>data/</code> 內公告內容與附件。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：
        <strong style="color:${
          announcement.active
            ? '#15803d'
            : announcement.enabled
              ? '#b45309'
              : 'inherit'
        }">
          ${esc(formatAnnouncementStatus(announcement))}
        </strong>
        ${
          announcement.updatedAt
            ? ` · 更新 ${esc(String(announcement.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ''))}`
            : ''
        }
      </p>
      <form id="announcement-form" class="form-grid two">
        <div class="field check-row-box" style="grid-column:1/-1">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="announcement-enabled"
              ${announcement.enabled ? 'checked' : ''} />
            <span><strong>啟用公告</strong>（須同時在公布期間內才會顯示於總覽）</span>
          </label>
        </div>
        <div class="field">
          <label>公布開始時間</label>
          <input type="datetime-local" name="startAt"
            value="${esc(toDatetimeLocalValue(announcement.startAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝立即（不限制開始）</span>
        </div>
        <div class="field">
          <label>公布結束時間</label>
          <input type="datetime-local" name="endAt"
            value="${esc(toDatetimeLocalValue(announcement.endAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝不自動下架；有填則到期後總覽不顯示</span>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告標題</label>
          <input name="title" maxlength="120"
            value="${esc(announcement.title || '')}"
            placeholder="例如：系統維護通知" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告內容</label>
          <textarea name="body" rows="6" maxlength="8000"
            placeholder="支援多行文字…">${esc(announcement.body || '')}</textarea>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>附件（選填，總覽不顯示檔名，僅「查看」時可下載）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳附件
              <input type="file" id="announcement-file" class="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.7z" />
            </label>
            <button type="button" class="btn sm outline" id="btn-announcement-file-clear"
              ${announcement.hasFile ? '' : 'disabled'}>移除附件</button>
            <button type="button" class="btn sm outline" id="btn-announcement-preview">預覽查看</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            ${
              announcement.hasFile
                ? `目前附件：${esc(announcement.originalName || '')}`
                : '尚未上傳。允許 PDF／Office／圖片／TXT／CSV／ZIP，最大 15MB。'
            }
          </span>
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">儲存公告</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>PDF 數位簽章（公司憑證）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        使用公司 <strong>PKCS#12（.p12／.pfx）</strong> 憑證對下載／備份的 PDF 做數位簽章，
        可用 Acrobat 等軟體驗證並偵測竄改。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${pdfSign.ready ? '#15803d' : '#b45309'}">${esc(signStatusText)}</strong>
        ${pdfSign.certFileName ? ` · 憑證檔：${esc(pdfSign.certFileName)}` : ''}
        ${!pdfSign.libsReady && pdfSign.libsError ? `<br/><span style="color:#b45309">套件：${esc(pdfSign.libsError)}</span>` : ''}
      </p>

      <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#1e40af">製作數位簽章（自簽憑證）</h4>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          無正式公司憑證時，可在此<strong>產生自簽 .p12</strong>並立即用於 PDF 簽章（僅供內部）。
          標示 <strong style="color:#b45309">*</strong> 為必填。
          <br/>CN／O 可填中文公司名稱；密碼請妥善保管。
        </p>
        <form id="pdf-sign-create-form" class="form-grid two">
          <div class="field">
            <label>通用名稱 CN *</label>
            <input name="commonName" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="例如：CatsHome Inc. 或公司全名" />
          </div>
          <div class="field">
            <label>組織／公司名稱 O *</label>
            <input name="organization" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="與營業登記或對外名稱一致" />
          </div>
          <div class="field">
            <label>單位／部門 OU（選填）</label>
            <input name="organizationalUnit" maxlength="64" placeholder="例如：資訊部" />
          </div>
          <div class="field">
            <label>國家代碼 C *</label>
            <input name="country" required maxlength="2" value="TW" placeholder="TW"
              style="text-transform:uppercase" />
          </div>
          <div class="field">
            <label>縣市／省 ST（選填）</label>
            <input name="province" maxlength="64" placeholder="例如：Taipei" />
          </div>
          <div class="field">
            <label>地區 L（選填）</label>
            <input name="locality" maxlength="64" placeholder="例如：Taipei City" />
          </div>
          <div class="field">
            <label>聯絡 Email（選填）</label>
            <input name="email" type="email" maxlength="80" placeholder="admin@example.com" />
          </div>
          <div class="field">
            <label>有效年數 *</label>
            <input name="validYears" type="number" required min="1" max="30" value="5" />
          </div>
          <div class="field">
            <label>憑證密碼 *</label>
            <input name="passphrase" type="password" required minlength="4" autocomplete="new-password"
              placeholder="至少 4 字元（請妥善保管）" />
          </div>
          <div class="field">
            <label>確認憑證密碼 *</label>
            <input name="passphraseConfirm" type="password" required minlength="4" autocomplete="new-password"
              placeholder="再輸入一次" />
          </div>
          <div class="field">
            <label>簽署者顯示名稱（選填）</label>
            <input name="signerName" maxlength="80"
              value="${esc(pdfSign.signerName || brand.companyName || '')}"
              placeholder="預設＝通用名稱 CN" />
          </div>
          <div class="field">
            <label>簽署原因（選填）</label>
            <input name="reason" maxlength="200"
              value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="enableAfterCreate" checked />
              <span>製作完成後<strong>自動啟用</strong> PDF 數位簽章</span>
            </label>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="onlyApproved" ${
                pdfSign.onlyApproved !== false ? 'checked' : ''
              } />
              <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
            </label>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary" id="btn-pdf-sign-create">製作並儲存憑證</button>
          </div>
        </form>
        <p class="muted" style="font-size:0.78rem;margin:10px 0 0;line-height:1.45">
          注意：若已有憑證，製作新憑證會<strong>覆蓋</strong>現有 .p12。自簽憑證在 Acrobat 可能顯示「簽發者不被信任」，內部防竄改仍有效。
        </p>
      </div>

      <form id="pdf-sign-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignEnabled" id="pdf-sign-enabled"
              ${pdfSign.enabled ? 'checked' : ''} />
            <span><strong>啟用 PDF 數位簽章</strong></span>
          </label>
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignOnlyApproved" id="pdf-sign-only-approved"
              ${pdfSign.onlyApproved !== false ? 'checked' : ''} />
            <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
          </label>
        </div>
        <div class="field">
          <label>或上傳既有公司憑證（.p12 / .pfx）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳憑證
              <input type="file" id="pdf-sign-cert-file" accept=".p12,.pfx,application/x-pkcs12" class="hidden" />
            </label>
            <button type="button" class="btn sm outline" id="btn-pdf-sign-cert-clear"
              ${pdfSign.hasCert ? '' : 'disabled'}>移除憑證</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            若已由 IT 核發正式 PKCS#12，可直接上傳；私鑰勿外流。
          </span>
        </div>
        <div class="field">
          <label>憑證密碼</label>
          <input name="pdfSignPass" type="password" value="" autocomplete="new-password"
            placeholder="${pdfSign.hasPass ? '已設定（留空則不變更）' : 'PKCS#12 密碼（可為空）'}" />
        </div>
        <div class="field">
          <label>簽署者顯示名稱</label>
          <input name="pdfSignSignerName" maxlength="80"
            value="${esc(pdfSign.signerName || brand.companyName || '')}"
            placeholder="預設＝公司名稱" />
        </div>
        <div class="field">
          <label>簽署原因</label>
          <input name="pdfSignReason" maxlength="200"
            value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
        </div>
        <div class="field">
          <label>地點</label>
          <input name="pdfSignLocation" maxlength="80"
            value="${esc(pdfSign.location || 'Taiwan')}" />
        </div>
        <div class="field">
          <label>聯絡資訊（選填）</label>
          <input name="pdfSignContact" maxlength="120"
            value="${esc(pdfSign.contactInfo || '')}"
            placeholder="例如公司 Email" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存簽章設定</button>
          <button type="button" class="btn outline" id="btn-pdf-sign-test">下載測試簽章 PDF</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        驗章方式：以 Adobe Acrobat 開啟 PDF → 簽名面板應顯示簽章資訊。
      </p>
    </div>

    <div class="card">
      <h3>備份加密（AES-256）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        啟用後，<strong>備份資料</strong>一律以 <strong>AES-256 加密 ZIP</strong> 儲存（含僅 PDF、無附件的單據）。
        解壓時請使用支援 AES-256 的工具（如 7-Zip、WinZip、Bandizip）。
        Windows 檔案總管可能無法直接開啟 AES ZIP。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${backupEncrypt.ready ? '#15803d' : backupEncrypt.enabled ? '#b45309' : 'inherit'}">${esc(backupEncryptStatusText)}</strong>
      </p>
      <form id="backup-encrypt-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="backupEncryptEnabled" id="backup-encrypt-enabled"
              ${backupEncrypt.enabled ? 'checked' : ''} />
            <span><strong>啟用備份 ZIP 加密</strong></span>
          </label>
        </div>
        <div class="field">
          <label>備份密碼</label>
          <input name="backupEncryptPass" type="password" value="" autocomplete="new-password"
            placeholder="${backupEncrypt.hasPass ? '已設定（留空則不變更）' : '設定加密密碼（請妥善保存）'}" />
        </div>
        <div class="field">
          <label>確認密碼</label>
          <input name="backupEncryptPassConfirm" type="password" value="" autocomplete="new-password"
            placeholder="再次輸入新密碼（僅在變更時）" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存備份加密設定</button>
          <button type="button" class="btn outline" id="btn-backup-encrypt-clear-pass"
            ${backupEncrypt.hasPass ? '' : 'disabled'}>清除密碼</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        密碼僅存於伺服器端，介面不會顯示。若遺失密碼，已加密的舊備份將無法解壓。<br/>
        變更密碼後，請勾選「強制覆寫」重新備份，既有檔案不會自動重加密。
      </p>
    </div>

    <div class="card">
      <h3>備份儲存目錄</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        設定備份檔案的儲存根目錄。留空則使用預設路徑（<code>data/backups</code>）。
        Docker 環境請填寫容器內絕對路徑（如 <code>/mnt/nas-share/backups</code>）。
      </p>
      <form id="backup-dir-form" class="form-grid">
        <div class="field">
          <label for="backup-dir-input">備份目錄路徑</label>
          <input id="backup-dir-input" name="backupDir" type="text"
            value="${esc(backupDir)}"
            placeholder="留空使用預設：data/backups" style="font-family:monospace" />
          <span class="field-hint" style="color:#6b7280;font-size:0.82rem">
            目前：<code>${esc(backupDir || '（預設）data/backups')}</code>
          </span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" id="btn-backup-dir-save">儲存備份目錄</button>
          <button type="button" class="btn outline" id="btn-backup-dir-reset">恢復預設</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        ⚠️ 變更目錄後，<strong>已備份的歷史紀錄仍指向舊路徑</strong>，新備份才會寫入新目錄。<br/>
        確認目錄存在且伺服器程序有寫入權限。不可使用 <code>..</code> 路徑穿越。
      </p>
    </div>

    <div class="card">
      <h3>💬 LINE 通知設定</h3>
      ${lineSettingsFormHtml(lineCfg, { formId: 'sys-line-form', showAccess: true })}
      <p class="muted" style="margin:12px 0 0;font-size:0.85rem">
        亦可從側欄「LINE 通知」進入同一套設定。
      </p>
    </div>

    <div class="card">
      <h3>Email 設定（SMTP）</h3>
      <p class="muted" style="margin-top:0">設定 SMTP 後，申請人可收到進度通知，並可對簽核人寄送催辦信。</p>
      <form id="mail-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="mail-enabled" ${mailCfg.enabled ? 'checked' : ''} />
            <span><strong>啟用 Email 提醒</strong>
              <span class="muted" style="margin-left:8px;font-size:0.85rem">${
                mailCfg.ready ? 'SMTP 已就緒' : '尚未完成 SMTP 設定'
              }</span>
            </span>
          </label>
        </div>
        <div class="field"><label>SMTP 主機</label>
          <input name="host" value="${esc(mailCfg.host || '')}" placeholder="例如 smtp.gmail.com 或 mail.公司網域" /></div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>連接埠</label>
            <input name="port" type="number" id="mail-port" value="${esc(String(mailCfg.port || 587))}" /></div>
          <div class="check-row-stack">
            <label class="check-row">
              <input type="checkbox" name="secure" id="mail-secure" ${mailCfg.secure ? 'checked' : ''} />
              <span>SSL（埠 465）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="ignoreTLS" id="mail-ignore-tls" ${
                mailCfg.ignoreTLS || Number(mailCfg.port) === 25 ? 'checked' : ''
              } />
              <span>略過 TLS（埠 25 明文請勾選）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="requireTLS" id="mail-require-tls" ${
                mailCfg.requireTLS || Number(mailCfg.port) === 587 ? 'checked' : ''
              } />
              <span>要求 STARTTLS（埠 587）</span>
            </label>
          </div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin:0 0 8px;line-height:1.45">
          常見設定：<strong>587</strong>＋STARTTLS（不勾 SSL）；<strong>465</strong>＋SSL；
          內網 <strong>25</strong>＋略過 TLS。
        </p>
        <div class="field"><label>SMTP 帳號</label>
          <input name="user" value="${esc(mailCfg.user || '')}" placeholder="完整信箱" autocomplete="off" /></div>
        <div class="field"><label>SMTP 密碼</label>
          <input name="pass" type="password" value="" placeholder="${mailCfg.hasPass ? '已設定（留空則不變更）' : '尚未設定'}" autocomplete="new-password" /></div>
        <div class="field"><label>寄件者 Email</label>
          <input name="from" type="email" value="${esc(mailCfg.from || '')}" placeholder="顯示的寄件信箱" /></div>
        <div class="field"><label>寄件者名稱</label>
          <input name="fromName" value="${esc(mailCfg.fromName || brand.companyName || '線上簽核系統')}" /></div>
        <div class="field"><label>系統網址（信內連結）</label>
          <input name="baseUrl" value="${esc(mailCfg.baseUrl || 'http://127.0.0.1:3847')}" placeholder="http://公司IP:端口" /></div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存 Email 設定</button>
          <button type="button" class="btn outline" id="btn-mail-test">寄送測試信</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>系統設定完整包</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        一次匯出／匯入：部門、成員、簽核流程與申請表、Email 設定。
      </p>
      <div class="check-group-box" style="margin-bottom:12px;background:#f8fafc">
        <strong class="check-group-title">匯出</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-history" />
          <span>包含歷史申請單、簽核歷程與附件</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-mail-pass" />
          <span>包含 SMTP 密碼（明文寫入 JSON，預設不匯出）</span>
        </label>
        <button type="button" class="btn primary" id="btn-pkg-export" style="margin-top:4px">下載設定完整包（JSON）</button>
      </div>
      <div class="check-group-box" style="background:#fff">
        <strong class="check-group-title">匯入</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-mail" checked />
          <span>套用 Email／SMTP 設定</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-history" />
          <span>匯入歷史申請</span>
        </label>
        <button type="button" class="btn outline" id="btn-pkg-import" style="margin-top:4px">選擇 JSON 並匯入…</button>
        <input type="file" id="pkg-import-file" accept=".json,application/json" class="hidden" />
        <div id="pkg-import-result" class="muted" style="margin-top:10px;font-size:0.9rem;white-space:pre-wrap"></div>
      </div>
    </div>
    </div>`;

  // 公司名稱
  $('#access-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          intranetOnly: fd.get('intranetOnly') === 'on',
          loginCidrs: fd.get('loginCidrs'),
          ...(accessCfgAdmin.deviceBindPaused
            ? {}
            : {
                deviceBindEnabled: fd.get('deviceBindEnabled') === 'on',
                deviceBindMax: Number(fd.get('deviceBindMax') || 3),
              }),
        },
      });
      toast('存取限制已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#brand-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/system/settings', {
        method: 'PUT',
        body: { companyName: fd.get('companyName') },
      });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('公司名稱已儲存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Logo 上傳
  $('#brand-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const data = await api('/api/system/logo', { method: 'POST', body: fd });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      const prev = $('#brand-logo-preview');
      if (prev && state.systemSettings.logoUrl) {
        prev.src = state.systemSettings.logoUrl;
      }
      toast('Logo 已更新', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-logo-reset')?.addEventListener('click', async () => {
    if (!confirm('確定還原為預設 Logo？')) return;
    try {
      const data = await api('/api/system/logo', { method: 'DELETE' });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('已還原預設 Logo', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 總覽公告
  $('#announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const startRaw = String(fd.get('startAt') || '').trim();
    const endRaw = String(fd.get('endAt') || '').trim();
    if (startRaw && endRaw && new Date(startRaw) > new Date(endRaw)) {
      toast('公布開始時間不可晚於結束時間', 'error');
      return;
    }
    try {
      const data = await api('/api/system/announcement', {
        method: 'PUT',
        body: {
          enabled: !!e.target.querySelector('#announcement-enabled')?.checked,
          title: String(fd.get('title') || '').trim(),
          body: String(fd.get('body') || ''),
          // 空字串＝清除該端限制
          startAt: startRaw || null,
          endAt: endRaw || null,
        },
      });
      state.systemSettings = data.settings || state.systemSettings;
      toast('公告已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#announcement-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/system/announcement/file', { method: 'POST', body: fd });
      toast('附件已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-announcement-file-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公告附件？')) return;
    try {
      await api('/api/system/announcement/file', { method: 'DELETE' });
      toast('已移除附件', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '移除失敗', 'error');
    }
  });

  $('#btn-announcement-preview')?.addEventListener('click', () => {
    const a = {
      ...announcement,
      active: true,
      _forcePreview: true,
      title: String($('#announcement-form [name="title"]')?.value || announcement.title || ''),
      body: String($('#announcement-form [name="body"]')?.value || announcement.body || ''),
    };
    if (!a.title && !a.body && !a.hasFile) {
      toast('請先填寫公告或上傳附件', 'error');
      return;
    }
    openAnnouncementModal(a);
  });

  // PDF 數位簽章 — 製作自簽憑證
  $('#pdf-sign-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const passphrase = String(fd.get('passphrase') || '');
    const passphraseConfirm = String(fd.get('passphraseConfirm') || '');
    if (!String(fd.get('commonName') || '').trim()) {
      toast('請填寫通用名稱（CN）', 'error');
      return;
    }
    if (!String(fd.get('organization') || '').trim()) {
      toast('請填寫組織／公司名稱（O）', 'error');
      return;
    }
    if (!String(fd.get('country') || '').trim()) {
      toast('請填寫國家代碼（C）', 'error');
      return;
    }
    if (passphrase.length < 4) {
      toast('憑證密碼至少 4 個字元', 'error');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      toast('兩次輸入的憑證密碼不一致', 'error');
      return;
    }
    if (
      pdfSign.hasCert &&
      !confirm('已有公司憑證，確定以新製作的憑證覆蓋？')
    ) {
      return;
    }
    const btn = $('#btn-pdf-sign-create');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '製作中…';
    }
    try {
      const data = await api('/api/system/pdf-sign/create', {
        method: 'POST',
        body: {
          commonName: String(fd.get('commonName') || '').trim(),
          organization: String(fd.get('organization') || '').trim(),
          organizationalUnit: String(fd.get('organizationalUnit') || '').trim(),
          country: String(fd.get('country') || 'TW').trim(),
          province: String(fd.get('province') || '').trim(),
          locality: String(fd.get('locality') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          validYears: Number(fd.get('validYears') || 5),
          passphrase,
          passphraseConfirm,
          signerName: String(fd.get('signerName') || '').trim(),
          reason: String(fd.get('reason') || '').trim(),
          enableAfterCreate: !!e.target.querySelector('[name="enableAfterCreate"]')
            ?.checked,
          onlyApproved: !!e.target.querySelector('[name="onlyApproved"]')?.checked,
        },
      });
      const until = data.meta?.notAfter
        ? String(data.meta.notAfter).slice(0, 10)
        : '';
      toast(
        until
          ? `已製作憑證（有效至 ${until}），可下載測試 PDF 驗證`
          : '已製作並儲存自簽憑證',
        'success'
      );
      navigate('system-settings');
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '製作失敗';
      toast(msg.length > 120 ? msg.slice(0, 120) + '…' : msg, 'error');
      console.error('[pdf-sign create]', err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '製作並儲存憑證';
      }
    }
  });

  // PDF 數位簽章 — 儲存設定
  $('#pdf-sign-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          pdfSignEnabled: !!e.target.querySelector('#pdf-sign-enabled')?.checked,
          pdfSignOnlyApproved: !!e.target.querySelector('#pdf-sign-only-approved')
            ?.checked,
          pdfSignReason: fd.get('pdfSignReason') || '',
          pdfSignLocation: fd.get('pdfSignLocation') || '',
          pdfSignContact: fd.get('pdfSignContact') || '',
          pdfSignSignerName: fd.get('pdfSignSignerName') || '',
          pdfSignPass: fd.get('pdfSignPass') || '',
        },
      });
      toast('PDF 簽章設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#pdf-sign-cert-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('cert', file);
    const pass = document.querySelector('#pdf-sign-form [name="pdfSignPass"]')?.value;
    if (pass) fd.append('passphrase', pass);
    try {
      await api('/api/system/pdf-sign/cert', { method: 'POST', body: fd });
      toast('憑證已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '憑證上傳失敗', 'error');
    }
  });

  $('#btn-pdf-sign-cert-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公司簽章憑證？')) return;
    try {
      await api('/api/system/pdf-sign/cert', { method: 'DELETE' });
      toast('已移除憑證', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-pdf-sign-test')?.addEventListener('click', async () => {
    try {
      const blob = await api('/api/system/pdf-sign/test', {
        method: 'POST',
        body: {},
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '簽章測試.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下載測試 PDF，請用 Acrobat 檢查簽章', 'success');
    } catch (err) {
      toast(err.message || '測試失敗', 'error');
    }
  });

  // 備份加密
  $('#backup-encrypt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const enabled = !!e.target.querySelector('#backup-encrypt-enabled')?.checked;
    const pass = String(fd.get('backupEncryptPass') || '');
    const confirm = String(fd.get('backupEncryptPassConfirm') || '');
    if (pass || confirm) {
      if (pass !== confirm) {
        toast('兩次輸入的備份密碼不一致', 'error');
        return;
      }
      if (pass.length < 4) {
        toast('備份密碼至少 4 個字元', 'error');
        return;
      }
    }
    if (enabled && !backupEncrypt.hasPass && !pass) {
      toast('啟用加密時請設定備份密碼', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptEnabled: enabled,
          backupEncryptPass: pass || '',
        },
      });
      toast('備份加密設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-encrypt-clear-pass')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定清除備份密碼？\n若仍啟用加密，將無法執行新備份；已加密的舊檔仍需原密碼才能解壓。'
      )
    ) {
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptPassClear: true,
          backupEncryptEnabled: false,
        },
      });
      toast('已清除備份密碼並關閉加密', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // 備份目錄
  $('#backup-dir-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dir = String(fd.get('backupDir') || '').trim();
    if (dir && dir.includes('..')) {
      toast('備份目錄不可包含「..」路徑穿越', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: dir },
      });
      toast('備份目錄已儲存' + (dir ? `：${dir}` : '（已恢復預設）'), 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-dir-reset')?.addEventListener('click', async () => {
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: '' },
      });
      toast('備份目錄已恢復為預設（data/backups）', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // LINE（系統設定內嵌）
  bindLineSettingsForm({
    formId: 'sys-line-form',
    onSaved: () => navigate('system-settings'),
  });

  // Mail
  const mailForm = $('#mail-form');
  if (mailForm) {
    mailForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/mail/config', {
          method: 'PUT',
          body: {
            enabled: !!e.target.querySelector('#mail-enabled')?.checked,
            host: fd.get('host') || '',
            port: Number(fd.get('port')) || 587,
            secure: !!e.target.querySelector('#mail-secure')?.checked,
            ignoreTLS: !!e.target.querySelector('#mail-ignore-tls')?.checked,
            requireTLS: !!e.target.querySelector('#mail-require-tls')?.checked,
            user: fd.get('user') || '',
            pass: fd.get('pass') || '',
            from: fd.get('from') || '',
            fromName: fd.get('fromName') || brand.companyName || '線上簽核系統',
            baseUrl: fd.get('baseUrl') || 'http://127.0.0.1:3847',
          },
        });
        toast('Email 設定已儲存', 'success');
        navigate('system-settings');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#mail-port')?.addEventListener('change', () => {
      const p = Number($('#mail-port')?.value) || 587;
      const sec = $('#mail-secure');
      const ign = $('#mail-ignore-tls');
      const req = $('#mail-require-tls');
      if (p === 465 && sec) sec.checked = true;
      if (p === 25) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = true;
        if (req) req.checked = false;
      }
      if (p === 587) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = false;
        if (req) req.checked = true;
      }
    });
    $('#btn-mail-test')?.addEventListener('click', async () => {
      try {
        const data = await api('/api/mail/test', { method: 'POST', body: {} });
        const mode =
          data.result?.mode === 'outbox' ? '（僅寫入 outbox，未真正寄出）' : '';
        toast(`測試信已寄出${mode}`, 'success');
      } catch (err) {
        toast(err.message || '測試信寄送失敗', 'error');
      }
    });
  }

  // Package
  $('#btn-pkg-export')?.addEventListener('click', async () => {
    const history = $('#pkg-export-history')?.checked ? '1' : '0';
    const mailSecrets = $('#pkg-export-mail-pass')?.checked ? '1' : '0';
    if (mailSecrets === '1') {
      const ok = confirm(
        '將把 SMTP 密碼以明文寫入 JSON 設定包。\n檔案請勿放入一鍵安裝包或 Git。\n確定仍要匯出密碼？'
      );
      if (!ok) return;
    }
    try {
      const confirmMail = mailSecrets === '1' ? '1' : '0';
      const blob = await api(
        `/api/system/package/export?includeHistory=${history}&includeMailSecrets=${mailSecrets}&confirmMailSecrets=${confirmMail}`,
        { expectBlob: true }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `簽核系統_${history === '1' ? '完整含歷史' : '設定'}包_${twToday()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('設定完整包已下載', 'success');
    } catch (err) {
      toast(err.message || '匯出失敗', 'error');
    }
  });
  $('#btn-pkg-import')?.addEventListener('click', () => {
    $('#pkg-import-file')?.click();
  });
  $('#pkg-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const importMail = $('#pkg-import-mail')?.checked;
    const importHistory = $('#pkg-import-history')?.checked;
    if (
      !confirm(
        `確定匯入「${file.name}」？\n將合併更新部門、成員、流程` +
          (importMail ? '、Email' : '') +
          (importHistory ? '，並匯入歷史' : '')
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.append('package', file);
    fd.append('importMail', importMail ? '1' : '0');
    fd.append('importHistory', importHistory ? '1' : '0');
    const resultEl = $('#pkg-import-result');
    if (resultEl) resultEl.textContent = '匯入中…';
    try {
      const data = await api('/api/system/package/import', { method: 'POST', body: fd });
      toast(data.message || '匯入完成', 'success');
      if (resultEl) resultEl.textContent = JSON.stringify(data.result || data, null, 2);
      try {
        await loadUsers(true);
        await loadWorkflows(true);
        await loadSystemSettings();
      } catch {
        /* ignore */
      }
    } catch (err) {
      toast(err.message || '匯入失敗', 'error');
      if (resultEl) resultEl.textContent = err.message || '匯入失敗';
    }
  });
}

if (typeof boot === 'function') {
  boot();
}
