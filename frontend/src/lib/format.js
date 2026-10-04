export function formatDateTime(value) {
  if (!value) return '—';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.length <= 19) return raw.replace('T', ' ');
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return raw;
  }
}

export function getWorkflowIcon(name = '', category = '') {
  const n = String(name || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  if (/請假|休假|特別休假|病假|事假|特休|假單/.test(n)) return '🏖️';
  if (/出差/.test(n)) return '🚄';
  if (/延長工時|加班/.test(n)) return '⏱️';
  if (/福委|補助|三節/.test(n)) return '🎁';
  if (/請購|採購/.test(n)) return '🛒';
  if (/費用|報支|報銷|請款/.test(n)) return '💰';
  if (/信用額度|授信/.test(n)) return '💳';
  if (/電腦|異常報修|報修|維修|it/i.test(n)) return '💻';
  if (/會議|例會/.test(n)) return '📅';
  if (/業務|銷售|業績/.test(n)) return '📊';
  if (/庫存|調撥|調庫/.test(n)) return '📦';
  if (/作廢/.test(n)) return '🚫';
  if (/一般簽呈|簽呈|公文/.test(n)) return '📝';
  if (c.includes('人事')) return '👥';
  if (c.includes('財務') || c.includes('採購')) return '💵';
  if (c.includes('資訊') || c.includes('總務')) return '🛠️';
  if (c.includes('業務')) return '📈';
  return '📋';
}

export function getCategoryClass(category = '') {
  const c = String(category || '');
  if (c.includes('人事')) return 'cat-hr';
  if (c.includes('財務') || c.includes('採購')) return 'cat-fin';
  if (c.includes('資訊') || c.includes('總務')) return 'cat-it';
  if (c.includes('業務')) return 'cat-sales';
  return 'cat-memo';
}
