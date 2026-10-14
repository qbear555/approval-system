export function welfareCurrentRocYear(formData) {
  const s = String(formData?.period_roc_year || '').trim();
  if (/^\d{2,4}$/.test(s) && Number(s) > 0) return String(Number(s));
  return String(new Date().getFullYear() - 1911);
}

export function welfareAutoOpeningSummary(month, year) {
  const m = Number(String(month || '').replace(/[^\d]/g, ''));
  const y = Number(year) || Number(welfareCurrentRocYear());
  if (!m) return '';
  const prevM = m <= 1 ? 12 : m - 1;
  const prevY = m <= 1 ? y - 1 : y;
  return `${prevY}年${prevM}月份結轉`;
}

export function parseWelfareItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.rows)) return v.rows;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function welfareAmtNum(v) {
  const n = Number(String(v ?? '').replace(/[,，\s元萬]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function formatWelfareAmt(v, blankZero = true) {
  const n = welfareAmtNum(v);
  if (blankZero && n === 0) return '';
  return Math.round(n).toLocaleString('zh-TW');
}

export function summarizeWelfare(items, opening = 0) {
  let bal = welfareAmtNum(opening);
  let sumIn = 0;
  let sumOut = 0;
  const rows = (items || []).map((it) => {
    const dep = welfareAmtNum(it.deposit);
    const wd = welfareAmtNum(it.withdraw);
    bal += dep - wd;
    sumIn += dep;
    sumOut += wd;
    return { ...it, balance: bal };
  });
  return {
    rows,
    sumIn,
    sumOut,
    closing: welfareAmtNum(opening) + sumIn - sumOut,
  };
}

export function emptyWelfareRows(n = 3) {
  return Array.from({ length: n }, () => ({ date: '', summary: '', deposit: '', withdraw: '' }));
}

export function compactWelfareItems(items) {
  return (items || []).filter((it) => it.date || it.summary || it.deposit || it.withdraw);
}

export function isAutoOpeningSummary(v) {
  return !String(v || '').trim() || /^\d{2,4}年\d{1,2}月份結轉$/.test(String(v).trim());
}
