/**
 * 系統設定（公司名稱、Logo、PDF 數位簽章憑證、備份加密）
 * 儲存於 data/system-settings.json；Logo 於 data/branding/；憑證於 data/certs/
 */
const tz = require('./tz');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BRAND_DIR = path.join(DATA_DIR, 'branding');
const CERT_DIR = path.join(DATA_DIR, 'certs');
const ANNOUNCE_DIR = path.join(DATA_DIR, 'announcements');
const SETTINGS_PATH = path.join(DATA_DIR, 'system-settings.json');
const DEFAULT_LOGO_URL = '/img/argo-logo.png';
const DEFAULT_COMPANY_NAME = '線上簽核系統';

const DEFAULTS = {
  companyName: DEFAULT_COMPANY_NAME,
  logoFile: null, // 相對 branding/ 檔名；null＝預設 argo-logo
  // PDF 數位簽章
  pdfSignEnabled: false,
  pdfSignFile: null, // 相對 certs/ 檔名
  pdfSignPass: '', // PKCS#12 密碼（僅伺服器端，不下傳完整到公開 API）
  pdfSignOnlyApproved: true,
  pdfSignReason: '線上簽核系統正式產出文件',
  pdfSignLocation: 'Taiwan',
  pdfSignContact: '',
  pdfSignSignerName: '',
  // 備份 ZIP AES-256 加密（密碼僅伺服器端）
  backupEncryptEnabled: false,
  backupEncryptPass: '',
  // 備份根目錄（空字串 = 預設 data/backups）
  backupDir: '',
  // 總覽公告（單則最小版）
  announcementEnabled: false,
  announcementTitle: '',
  announcementBody: '',
  announcementFile: null, // 相對 announcements/ 儲存檔名
  announcementOriginalName: null, // 下載顯示用原始檔名
  announcementStartAt: null, // ISO；null＝不限制開始
  announcementEndAt: null, // ISO；null＝不限制結束；超過則自動不顯示
  announcementUpdatedAt: null,
  // 內網與裝置綁定
  intranetOnly: true,
  loginCidrs: '192.168.99.0/24,172.16.0.0/12,127.0.0.1,::1',
  deviceBindEnabled: true,
  deviceBindMax: 3,
  updatedAt: null,
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BRAND_DIR)) fs.mkdirSync(BRAND_DIR, { recursive: true });
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  if (!fs.existsSync(ANNOUNCE_DIR)) {
    try {
      fs.mkdirSync(ANNOUNCE_DIR, { recursive: true, mode: 0o775 });
    } catch (e) {
      // 目錄可能已由 root 建立但本程序無寫入權：後續 write 會給出明確錯誤
      console.warn('[system-settings] mkdir announcements:', e.message);
    }
  }
  try {
    fs.accessSync(ANNOUNCE_DIR, fs.constants.W_OK);
  } catch {
    // 嘗試放寬權限（容器內若為同一使用者可成功）
    try {
      fs.chmodSync(ANNOUNCE_DIR, 0o775);
    } catch {
      /* ignore */
    }
  }
}

function loadRaw() {
  ensureDirs();
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return {
      companyName:
        raw.companyName != null && String(raw.companyName).trim()
          ? String(raw.companyName).trim().slice(0, 80)
          : DEFAULT_COMPANY_NAME,
      logoFile: raw.logoFile ? String(raw.logoFile).replace(/[\\/]/g, '') : null,
      pdfSignEnabled: !!raw.pdfSignEnabled,
      pdfSignFile: raw.pdfSignFile
        ? String(raw.pdfSignFile).replace(/[\\/]/g, '')
        : null,
      pdfSignPass: raw.pdfSignPass != null ? String(raw.pdfSignPass) : '',
      pdfSignOnlyApproved:
        raw.pdfSignOnlyApproved === undefined ? true : !!raw.pdfSignOnlyApproved,
      pdfSignReason:
        raw.pdfSignReason != null
          ? String(raw.pdfSignReason).slice(0, 200)
          : DEFAULTS.pdfSignReason,
      pdfSignLocation:
        raw.pdfSignLocation != null
          ? String(raw.pdfSignLocation).slice(0, 80)
          : DEFAULTS.pdfSignLocation,
      pdfSignContact:
        raw.pdfSignContact != null
          ? String(raw.pdfSignContact).slice(0, 120)
          : '',
      pdfSignSignerName:
        raw.pdfSignSignerName != null
          ? String(raw.pdfSignSignerName).slice(0, 80)
          : '',
      backupEncryptEnabled: !!raw.backupEncryptEnabled,
      backupEncryptPass:
        raw.backupEncryptPass != null ? String(raw.backupEncryptPass) : '',
      backupDir: raw.backupDir ? String(raw.backupDir).trim().slice(0, 500) : '',
      announcementEnabled: !!raw.announcementEnabled,
      announcementTitle:
        raw.announcementTitle != null
          ? String(raw.announcementTitle).slice(0, 120)
          : '',
      announcementBody:
        raw.announcementBody != null
          ? String(raw.announcementBody).slice(0, 8000)
          : '',
      announcementFile: raw.announcementFile
        ? String(raw.announcementFile).replace(/[\\/]/g, '')
        : null,
      announcementOriginalName: raw.announcementOriginalName
        ? String(raw.announcementOriginalName).replace(/[\\/]/g, '').slice(0, 200)
        : null,
      announcementStartAt: normalizeAnnounceIso(raw.announcementStartAt),
      announcementEndAt: normalizeAnnounceIso(raw.announcementEndAt),
      announcementUpdatedAt: raw.announcementUpdatedAt || null,
      intranetOnly: raw.intranetOnly === undefined ? true : !!raw.intranetOnly,
      loginCidrs:
        raw.loginCidrs != null && String(raw.loginCidrs).trim()
          ? String(raw.loginCidrs).trim().slice(0, 500)
          : DEFAULTS.loginCidrs,
      deviceBindEnabled:
        raw.deviceBindEnabled === undefined ? true : !!raw.deviceBindEnabled,
      deviceBindMax: Math.min(10, Math.max(1, Number(raw.deviceBindMax) || 3)),
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 解析／正規化公布時間為 ISO 字串；空值回 null */
function normalizeAnnounceIso(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return tz.nowIso(d);
}

function saveRaw(settings) {
  ensureDirs();
  const cur = { ...loadRaw(), ...settings };
  const payload = {
    companyName: cur.companyName || DEFAULT_COMPANY_NAME,
    logoFile: cur.logoFile || null,
    pdfSignEnabled: !!cur.pdfSignEnabled,
    pdfSignFile: cur.pdfSignFile || null,
    pdfSignPass: cur.pdfSignPass != null ? String(cur.pdfSignPass) : '',
    pdfSignOnlyApproved:
      cur.pdfSignOnlyApproved === undefined ? true : !!cur.pdfSignOnlyApproved,
    pdfSignReason: cur.pdfSignReason || DEFAULTS.pdfSignReason,
    pdfSignLocation: cur.pdfSignLocation || DEFAULTS.pdfSignLocation,
    pdfSignContact: cur.pdfSignContact || '',
    pdfSignSignerName: cur.pdfSignSignerName || '',
    backupEncryptEnabled: !!cur.backupEncryptEnabled,
    backupEncryptPass:
      cur.backupEncryptPass != null ? String(cur.backupEncryptPass) : '',
    backupDir: cur.backupDir ? String(cur.backupDir).trim().slice(0, 500) : '',
    announcementEnabled: !!cur.announcementEnabled,
    announcementTitle: cur.announcementTitle != null ? String(cur.announcementTitle).slice(0, 120) : '',
    announcementBody: cur.announcementBody != null ? String(cur.announcementBody).slice(0, 8000) : '',
    announcementFile: cur.announcementFile
      ? String(cur.announcementFile).replace(/[\\/]/g, '')
      : null,
    announcementOriginalName: cur.announcementOriginalName
      ? String(cur.announcementOriginalName).replace(/[\\/]/g, '').slice(0, 200)
      : null,
    announcementStartAt: normalizeAnnounceIso(cur.announcementStartAt),
    announcementEndAt: normalizeAnnounceIso(cur.announcementEndAt),
    announcementUpdatedAt: cur.announcementUpdatedAt || null,
    intranetOnly: cur.intranetOnly === undefined ? true : !!cur.intranetOnly,
    loginCidrs:
      cur.loginCidrs != null && String(cur.loginCidrs).trim()
        ? String(cur.loginCidrs).trim().slice(0, 500)
        : DEFAULTS.loginCidrs,
    deviceBindEnabled:
      cur.deviceBindEnabled === undefined ? true : !!cur.deviceBindEnabled,
    deviceBindMax: Math.min(10, Math.max(1, Number(cur.deviceBindMax) || 3)),
    updatedAt: tz.nowIso(),
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function announcementHasFile(s) {
  const settings = s || loadRaw();
  return !!(
    settings.announcementFile &&
    fs.existsSync(path.join(ANNOUNCE_DIR, settings.announcementFile))
  );
}

/**
 * 是否在公布期間內
 * - 未設開始／結束：不限制該端
 * - 現在 < 開始：尚未公布
 * - 現在 > 結束：已過期自動下架
 */
function getAnnouncementSchedule(s, now = new Date()) {
  const startAt = normalizeAnnounceIso(s.announcementStartAt);
  const endAt = normalizeAnnounceIso(s.announcementEndAt);
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  let withinPeriod = true;
  let scheduleStatus = 'open'; // open | scheduled | expired
  if (start && now < start) {
    withinPeriod = false;
    scheduleStatus = 'scheduled';
  } else if (end && now > end) {
    withinPeriod = false;
    scheduleStatus = 'expired';
  }
  return { startAt, endAt, withinPeriod, scheduleStatus };
}

/** 登入使用者可見的公告（未啟用／逾時則 active=false，總覽不顯示） */
function getAnnouncementPublic() {
  const s = loadRaw();
  const hasFile = announcementHasFile(s);
  const title = (s.announcementTitle || '').trim();
  const body = (s.announcementBody || '').trim();
  const enabled = !!s.announcementEnabled;
  const hasContent = !!(title || body || hasFile);
  const schedule = getAnnouncementSchedule(s);
  const active = enabled && hasContent && schedule.withinPeriod;
  return {
    enabled,
    active,
    title: active || enabled ? title : title, // admin 仍看得到內容
    body: active || enabled ? body : body,
    hasFile,
    originalName: hasFile ? s.announcementOriginalName || s.announcementFile : null,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    withinPeriod: schedule.withinPeriod,
    scheduleStatus: schedule.scheduleStatus,
    updatedAt: s.announcementUpdatedAt || null,
  };
}

function updateAnnouncement(patch = {}) {
  const cur = loadRaw();
  if (patch.enabled !== undefined) {
    cur.announcementEnabled = !!patch.enabled;
  }
  if (patch.title !== undefined) {
    cur.announcementTitle = String(patch.title || '').trim().slice(0, 120);
  }
  if (patch.body !== undefined) {
    cur.announcementBody = String(patch.body || '').slice(0, 8000);
  }
  // startAt / endAt：明確傳入（含 null／空字串）可更新；未傳則保留
  if (Object.prototype.hasOwnProperty.call(patch, 'startAt')) {
    cur.announcementStartAt = normalizeAnnounceIso(patch.startAt);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'endAt')) {
    cur.announcementEndAt = normalizeAnnounceIso(patch.endAt);
  }
  const start = cur.announcementStartAt ? new Date(cur.announcementStartAt) : null;
  const end = cur.announcementEndAt ? new Date(cur.announcementEndAt) : null;
  if (start && end && start.getTime() > end.getTime()) {
    throw new Error('公布開始時間不可晚於結束時間');
  }
  cur.announcementUpdatedAt = tz.nowIso();
  saveRaw(cur);
  return getAnnouncementPublic();
}

/**
 * 儲存公告附件
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file
 */
function saveAnnouncementFile(file) {
  ensureDirs();
  if (!file || !file.buffer) throw new Error('未選擇檔案');
  if (file.buffer.length > 15 * 1024 * 1024) {
    throw new Error('附件請小於 15MB');
  }
  const original = String(file.originalname || 'attachment').replace(/[\\/]/g, '');
  let ext = path.extname(original).toLowerCase();
  const allowedExt = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.txt',
    '.csv',
    '.zip',
    '.7z',
  ]);
  if (!allowedExt.has(ext)) {
    throw new Error(
      '不支援的附件格式（允許 PDF／Office／圖片／TXT／CSV／ZIP）'
    );
  }
  if (ext === '.jpeg') ext = '.jpg';

  const cur = loadRaw();
  if (cur.announcementFile) {
    const old = path.join(ANNOUNCE_DIR, cur.announcementFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }

  const stored = `announce-${Date.now()}${ext}`;
  const dest = path.join(ANNOUNCE_DIR, stored);
  try {
    fs.writeFileSync(dest, file.buffer);
  } catch (e) {
    const code = e && e.code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        '無法寫入公告附件目錄（權限不足）。請確認 data/announcements 可寫入，或聯絡管理員修正 NAS 目錄權限。'
      );
    }
    if (code === 'ENOENT') {
      try {
        fs.mkdirSync(ANNOUNCE_DIR, { recursive: true, mode: 0o775 });
        fs.writeFileSync(dest, file.buffer);
      } catch (e2) {
        throw new Error('無法建立公告附件目錄：' + (e2.message || e2));
      }
    } else {
      throw new Error('附件儲存失敗：' + (e.message || e));
    }
  }
  // 正規化顯示檔名（multer 在部分環境會以 latin1 解中文檔名）
  let displayName = original.slice(0, 200) || stored;
  try {
    if (/[^\x00-\x7F]/.test(displayName) === false && /[\x80-\xff]/.test(displayName)) {
      displayName = Buffer.from(displayName, 'latin1').toString('utf8').slice(0, 200);
    }
  } catch {
    /* keep original */
  }
  cur.announcementFile = stored;
  cur.announcementOriginalName = displayName;
  cur.announcementUpdatedAt = tz.nowIso();
  saveRaw(cur);
  return getAnnouncementPublic();
}

function clearAnnouncementFile() {
  const cur = loadRaw();
  if (cur.announcementFile) {
    const old = path.join(ANNOUNCE_DIR, cur.announcementFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  cur.announcementFile = null;
  cur.announcementOriginalName = null;
  cur.announcementUpdatedAt = tz.nowIso();
  saveRaw(cur);
  return getAnnouncementPublic();
}

function getAnnouncementFilePath() {
  const s = loadRaw();
  if (!s.announcementFile) return null;
  const full = path.join(ANNOUNCE_DIR, s.announcementFile);
  return fs.existsSync(full)
    ? {
        fullPath: full,
        originalName: s.announcementOriginalName || s.announcementFile,
        storedName: s.announcementFile,
      }
    : null;
}

function logoPublicUrl(settings) {
  const s = settings || loadRaw();
  if (s.logoFile) {
    const full = path.join(BRAND_DIR, s.logoFile);
    if (fs.existsSync(full)) {
      // 帶版本參數避免快取
      const v = s.updatedAt ? encodeURIComponent(s.updatedAt) : Date.now();
      return `/api/system/logo?v=${v}`;
    }
  }
  return DEFAULT_LOGO_URL;
}

/** 登入頁可用：公司名／Logo／版本，不含組織或簽章狀態 */
function inferRuntimeEnv() {
  const forced = String(process.env.APP_ENV || '').trim();
  if (/^nas$/i.test(forced)) return 'NAS';
  if (/^local|dev|development$/i.test(forced)) return '本機';
  return '';
}

function getBrandingSettings() {
  const s = loadRaw();
  const ver = require('./version').getVersionInfo();
  return {
    env: inferRuntimeEnv(),
    companyName: s.companyName,
    logoUrl: logoPublicUrl(s),
    hasCustomLogo: !!(s.logoFile && fs.existsSync(path.join(BRAND_DIR, s.logoFile))),
    version: ver.version,
    fullVersion: ver.fullVersion,
    versionLabel: ver.label,
    versionLabelFull: ver.labelFull,
    versionBanner: ver.banner,
    versionBuild: ver.build,
    versionBuiltAt: ver.builtAt,
    versionAuto: !!ver.auto,
    updatedAt: s.updatedAt,
  };
}

function getPublicSettings() {
  const s = loadRaw();
  return {
    ...getBrandingSettings(),
    pdfSignEnabled: !!s.pdfSignEnabled,
  };
}

/** 管理員用：含簽章／備份加密狀態（不含完整密碼） */
function getAdminSettings() {
  const s = loadRaw();
  const hasCert = !!(
    s.pdfSignFile && fs.existsSync(path.join(CERT_DIR, s.pdfSignFile))
  );
  const backupHasPass = !!(
    s.backupEncryptPass != null && String(s.backupEncryptPass).length > 0
  );
  return {
    ...getPublicSettings(),
    pdfSign: {
      enabled: !!s.pdfSignEnabled,
      hasCert,
      hasPass: !!(s.pdfSignPass != null && String(s.pdfSignPass).length > 0),
      onlyApproved: s.pdfSignOnlyApproved !== false,
      reason: s.pdfSignReason || DEFAULTS.pdfSignReason,
      location: s.pdfSignLocation || DEFAULTS.pdfSignLocation,
      contactInfo: s.pdfSignContact || '',
      signerName: s.pdfSignSignerName || '',
      certFileName: hasCert ? s.pdfSignFile : null,
    },
    backupEncrypt: {
      enabled: !!s.backupEncryptEnabled,
      hasPass: backupHasPass,
      ready: !!s.backupEncryptEnabled && backupHasPass,
    },
    backupDir: s.backupDir || '',
    announcement: getAnnouncementPublic(),
    access: getAccessControl(s),
  };
}

function getAccessControl(raw) {
  const s = raw || loadRaw();
  return {
    intranetOnly: s.intranetOnly !== false,
    loginCidrs: s.loginCidrs || DEFAULTS.loginCidrs,
    deviceBindEnabled: s.deviceBindEnabled !== false,
    deviceBindMax: Math.min(10, Math.max(1, Number(s.deviceBindMax) || 3)),
  };
}

function updateSettings(patch = {}) {
  const cur = loadRaw();
  if (patch.companyName !== undefined) {
    const name = String(patch.companyName || '').trim().slice(0, 80);
    cur.companyName = name || DEFAULT_COMPANY_NAME;
  }
  if (patch.pdfSignEnabled !== undefined) {
    cur.pdfSignEnabled = !!patch.pdfSignEnabled;
  }
  if (patch.pdfSignOnlyApproved !== undefined) {
    cur.pdfSignOnlyApproved = !!patch.pdfSignOnlyApproved;
  }
  if (patch.pdfSignReason !== undefined) {
    cur.pdfSignReason = String(patch.pdfSignReason || '').slice(0, 200);
  }
  if (patch.pdfSignLocation !== undefined) {
    cur.pdfSignLocation = String(patch.pdfSignLocation || '').slice(0, 80);
  }
  if (patch.pdfSignContact !== undefined) {
    cur.pdfSignContact = String(patch.pdfSignContact || '').slice(0, 120);
  }
  if (patch.pdfSignSignerName !== undefined) {
    cur.pdfSignSignerName = String(patch.pdfSignSignerName || '').slice(0, 80);
  }
  // 密碼：空字串表示不變更；明確傳 pdfSignPassClear 才清空
  if (patch.pdfSignPassClear) {
    cur.pdfSignPass = '';
  } else if (
    patch.pdfSignPass !== undefined &&
    patch.pdfSignPass !== null &&
    String(patch.pdfSignPass) !== ''
  ) {
    cur.pdfSignPass = String(patch.pdfSignPass);
  }
  if (patch.backupEncryptEnabled !== undefined) {
    cur.backupEncryptEnabled = !!patch.backupEncryptEnabled;
  }
  // 備份密碼：空字串表示不變更；backupEncryptPassClear 才清空
  if (patch.backupEncryptPassClear) {
    cur.backupEncryptPass = '';
  } else if (
    patch.backupEncryptPass !== undefined &&
    patch.backupEncryptPass !== null &&
    String(patch.backupEncryptPass) !== ''
  ) {
    cur.backupEncryptPass = String(patch.backupEncryptPass).slice(0, 200);
  }
  // 備份目錄：明確傳入才更新（含空字串表示恢復預設）
  if (Object.prototype.hasOwnProperty.call(patch, 'backupDir')) {
    const dir = String(patch.backupDir || '').trim();
    // 安全性：禁止路徑包含 .. 向上穿越
    if (dir && dir.includes('..')) {
      throw new Error('備份目錄不可包含「..」路徑穿越');
    }
    cur.backupDir = dir.slice(0, 500);
  }
  if (patch.intranetOnly !== undefined) {
    cur.intranetOnly = !!patch.intranetOnly;
  }
  if (patch.loginCidrs !== undefined) {
    cur.loginCidrs = String(patch.loginCidrs || '').trim().slice(0, 500) || DEFAULTS.loginCidrs;
  }
  if (patch.deviceBindEnabled !== undefined) {
    cur.deviceBindEnabled = !!patch.deviceBindEnabled;
  }
  if (patch.deviceBindMax !== undefined) {
    cur.deviceBindMax = Math.min(10, Math.max(1, Number(patch.deviceBindMax) || 3));
  }
  return saveRaw(cur);
}

/** 備份加密設定（含密碼，僅伺服器端備份流程使用） */
function getBackupEncryptConfig() {
  const s = loadRaw();
  const passphrase =
    s.backupEncryptPass != null ? String(s.backupEncryptPass) : '';
  const enabled = !!s.backupEncryptEnabled;
  return {
    enabled,
    hasPass: passphrase.length > 0,
    ready: enabled && passphrase.length > 0,
    passphrase,
  };
}

function getPdfSignConfig() {
  const s = loadRaw();
  const hasCert = !!(
    s.pdfSignFile && fs.existsSync(path.join(CERT_DIR, s.pdfSignFile))
  );
  return {
    enabled: !!s.pdfSignEnabled,
    hasCert,
    hasPass: !!(s.pdfSignPass != null && String(s.pdfSignPass).length > 0),
    passphrase: s.pdfSignPass != null ? String(s.pdfSignPass) : '',
    onlyApproved: s.pdfSignOnlyApproved !== false,
    reason: s.pdfSignReason || DEFAULTS.pdfSignReason,
    location: s.pdfSignLocation || DEFAULTS.pdfSignLocation,
    contactInfo: s.pdfSignContact || '',
    signerName: s.pdfSignSignerName || '',
  };
}

function getPdfSignCertPath() {
  const s = loadRaw();
  if (!s.pdfSignFile) return null;
  const full = path.join(CERT_DIR, s.pdfSignFile);
  return fs.existsSync(full) ? full : null;
}

/**
 * 儲存 PKCS#12 憑證
 * @param {{ buffer: Buffer, originalname: string }} file
 */
function savePdfSignCert(file) {
  ensureDirs();
  if (!file || !file.buffer) throw new Error('未選擇憑證檔');
  const o = path.extname(file.originalname || '').toLowerCase();
  if (!['.p12', '.pfx'].includes(o)) {
    throw new Error('僅支援 .p12 或 .pfx 憑證檔');
  }
  if (file.buffer.length > 5 * 1024 * 1024) {
    throw new Error('憑證檔請小於 5MB');
  }
  const cur = loadRaw();
  if (cur.pdfSignFile) {
    const old = path.join(CERT_DIR, cur.pdfSignFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  const name = `company-sign${o}`;
  fs.writeFileSync(path.join(CERT_DIR, name), file.buffer);
  cur.pdfSignFile = name;
  saveRaw(cur);
  return getAdminSettings();
}

function clearPdfSignCert() {
  const cur = loadRaw();
  if (cur.pdfSignFile) {
    const old = path.join(CERT_DIR, cur.pdfSignFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  cur.pdfSignFile = null;
  cur.pdfSignPass = '';
  saveRaw(cur);
  return getAdminSettings();
}

/**
 * 在本機製作自簽 PKCS#12 公司數位簽章憑證（.p12）
 * 供內部 PDF 簽章使用（瀏覽器／Acrobat 可能提示「簽發者不被信任」屬正常）
 *
 * @param {object} body
 * @returns {object} getAdminSettings()
 */
function createSelfSignedPdfSignCert(body = {}) {
  ensureDirs();
  let forge;
  try {
    forge = require('node-forge');
  } catch (e) {
    throw new Error(
      '未安裝 node-forge，無法製作憑證。請在專案目錄執行：npm install node-forge'
    );
  }

  const commonName = String(body.commonName || body.cn || '').trim();
  const organization = String(body.organization || body.org || '').trim();
  const organizationalUnit = String(body.organizationalUnit || body.ou || '').trim();
  const country = String(body.country || body.c || 'TW')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const province = String(body.province || body.st || '').trim();
  const locality = String(body.locality || body.l || '').trim();
  const email = String(body.email || '').trim();
  const passphrase = String(body.passphrase != null ? body.passphrase : body.password || '');
  let validYears = Number(body.validYears);
  if (!Number.isFinite(validYears) || validYears < 1) validYears = 5;
  if (validYears > 30) validYears = 30;

  if (!commonName) throw new Error('請填寫「通用名稱（CN）」');
  if (!organization) throw new Error('請填寫「組織／公司名稱（O）」');
  if (!country || country.length !== 2) throw new Error('請填寫兩碼國家代碼（如 TW）');
  if (!passphrase || passphrase.length < 4) {
    throw new Error('請設定憑證密碼（至少 4 個字元）');
  }
  if (body.passphraseConfirm !== undefined || body.passwordConfirm !== undefined) {
    const conf = String(body.passphraseConfirm ?? body.passwordConfirm ?? '');
    if (conf !== passphrase) {
      throw new Error('兩次輸入的憑證密碼不一致');
    }
  }

  // RSA 金鑰 + 自簽憑證
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Date.now()) + String(Math.floor(Math.random() * 10000));
  const now = new Date();
  cert.validity.notBefore = now;
  const exp = new Date(now.getTime());
  exp.setFullYear(exp.getFullYear() + validYears);
  cert.validity.notAfter = exp;

  const attrs = [
    { name: 'commonName', value: commonName.slice(0, 64) },
    { name: 'countryName', value: country },
    { name: 'organizationName', value: organization.slice(0, 64) },
  ];
  if (organizationalUnit) {
    attrs.push({ name: 'organizationalUnitName', value: organizationalUnit.slice(0, 64) });
  }
  if (province) {
    attrs.push({ name: 'stateOrProvinceName', value: province.slice(0, 64) });
  }
  if (locality) {
    attrs.push({ name: 'localityName', value: locality.slice(0, 64) });
  }
  if (email) {
    attrs.push({ name: 'emailAddress', value: email.slice(0, 80) });
  }
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      clientAuth: true,
      emailProtection: true,
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // 注意：node-forge 對含中文等非 ASCII 主體（CN/O）的 PKCS#12，
  // 若 useMac:true 會產生「MAC could not be verified / Invalid password」假失敗。
  // 關閉 MAC 後仍以密碼加密私鑰，@signpdf 可正常簽署；friendlyName 固定 ASCII。
  let buffer;
  try {
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
      keys.privateKey,
      [cert],
      passphrase,
      {
        algorithm: '3des',
        generateLocalKeyId: true,
        friendlyName: 'company-sign',
        useMac: false,
      }
    );
    const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
    buffer = Buffer.from(p12Der, 'binary');
  } catch (e) {
    throw new Error(
      '憑證封裝失敗：' +
        (e && e.message ? e.message : String(e)) +
        '。請確認 CN／O 欄位，或改用較短名稱後重試。'
    );
  }

  // 寫入前自我驗證：確保密碼可開啟（避免「下載 PDF 簽章失敗」）
  try {
    const asn1Check = forge.asn1.fromDer(
      forge.util.createBuffer(buffer.toString('binary'))
    );
    forge.pkcs12.pkcs12FromAsn1(asn1Check, passphrase);
  } catch (e) {
    throw new Error(
      '憑證產生後驗證失敗：' +
        (e && e.message ? e.message : String(e)) +
        '。請更換密碼後重試；若仍失敗請聯絡管理員。'
    );
  }

  // 寫入憑證檔
  const cur = loadRaw();
  if (cur.pdfSignFile) {
    const old = path.join(CERT_DIR, cur.pdfSignFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  const name = 'company-sign.p12';
  fs.writeFileSync(path.join(CERT_DIR, name), buffer);
  cur.pdfSignFile = name;
  cur.pdfSignPass = passphrase;

  const signerName = String(body.signerName || commonName || '').trim().slice(0, 80);
  if (signerName) cur.pdfSignSignerName = signerName;
  if (body.reason != null && String(body.reason).trim()) {
    cur.pdfSignReason = String(body.reason).trim().slice(0, 200);
  }
  if (body.location != null && String(body.location).trim()) {
    cur.pdfSignLocation = String(body.location).trim().slice(0, 80);
  } else if (locality || province) {
    cur.pdfSignLocation = [locality, province, country].filter(Boolean).join(', ').slice(0, 80);
  }
  if (email) cur.pdfSignContact = email.slice(0, 120);
  if (body.enableAfterCreate !== false && body.enableAfterCreate !== '0') {
    cur.pdfSignEnabled = true;
  }
  if (body.onlyApproved !== undefined) {
    cur.pdfSignOnlyApproved = !!body.onlyApproved;
  }
  saveRaw(cur);

  return {
    settings: getAdminSettings(),
    meta: {
      commonName,
      organization,
      country,
      validYears,
      notBefore: tz.nowIso(cert.validity.notBefore),
      notAfter: tz.nowIso(cert.validity.notAfter),
      fileName: name,
      selfSigned: true,
    },
  };
}

function getLogoFilePath() {
  const s = loadRaw();
  if (!s.logoFile) return null;
  const full = path.join(BRAND_DIR, s.logoFile);
  return fs.existsSync(full) ? full : null;
}

/**
 * 儲存上傳的 Logo
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file
 */
function saveLogoFile(file) {
  ensureDirs();
  if (!file || !file.buffer) throw new Error('未選擇圖檔');
  const mime = String(file.mimetype || '').toLowerCase();
  const allowed = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  let ext = allowed[mime];
  if (!ext) {
    const o = path.extname(file.originalname || '').toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(o)) {
      ext = o === '.jpeg' ? '.jpg' : o;
    }
  }
  if (!ext) throw new Error('僅支援 PNG／JPG／GIF／WEBP 圖檔');
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new Error('Logo 檔案請小於 2MB');
  }

  const cur = loadRaw();
  // 刪除舊檔
  if (cur.logoFile) {
    const old = path.join(BRAND_DIR, cur.logoFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }

  const name = `logo${ext}`;
  const dest = path.join(BRAND_DIR, name);
  fs.writeFileSync(dest, file.buffer);
  cur.logoFile = name;
  saveRaw(cur);
  return getPublicSettings();
}

function clearLogo() {
  const cur = loadRaw();
  if (cur.logoFile) {
    const old = path.join(BRAND_DIR, cur.logoFile);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  cur.logoFile = null;
  saveRaw(cur);
  return getPublicSettings();
}

function getCompanyName() {
  return loadRaw().companyName || DEFAULT_COMPANY_NAME;
}

/** 取得備份根目錄絕對路徑（考慮自訂 backupDir 設定） */
function getBackupDir() {
  const s = loadRaw();
  const dir = s.backupDir ? String(s.backupDir).trim() : '';
  if (dir) {
    // 自訂目錄：支援絕對路徑，或相對於 DATA_DIR 的路徑
    return path.isAbsolute(dir) ? dir : path.join(DATA_DIR, dir);
  }
  return path.join(DATA_DIR, 'backups');
}

module.exports = {
  getBrandingSettings,
  getPublicSettings,
  getAdminSettings,
  updateSettings,
  getLogoFilePath,
  saveLogoFile,
  clearLogo,
  getCompanyName,
  getPdfSignConfig,
  getAnnouncementPublic,
  updateAnnouncement,
  saveAnnouncementFile,
  clearAnnouncementFile,
  getAnnouncementFilePath,
  getPdfSignCertPath,
  savePdfSignCert,
  clearPdfSignCert,
  createSelfSignedPdfSignCert,
  getBackupEncryptConfig,
  getBackupDir,
  getAccessControl,
  DEFAULT_LOGO_URL,
  DEFAULT_COMPANY_NAME,
  BRAND_DIR,
  CERT_DIR,
};
