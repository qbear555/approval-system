/** 未滿 10 萬：12,406 元；≥10 萬：100萬1000元 */
export function formatYuanWanStyle(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n)) return String(val);
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  const sign = neg ? '-' : '';
  if (abs < 100000) return `${sign}${abs.toLocaleString('zh-TW')} 元`;
  const wan = Math.floor(abs / 10000);
  const rest = abs % 10000;
  if (rest === 0) return `${sign}${wan}萬元`;
  return `${sign}${wan}萬${rest}元`;
}

export function isForeignCurrency(cur) {
  const s = String(cur || '').trim().toUpperCase();
  if (!s) return false;
  return !/^(NTD|TWD|NT\$|NTD\$|新台幣|新臺幣|台幣|臺幣)$/.test(s);
}

export function formatForeignAmount(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n)) return String(val);
  const rounded = Math.round(n * 10000) / 10000;
  return rounded.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function isMoneyFormField(field, key) {
  const id = String(field?.id || key || '');
  const label = String(field?.label || '');
  const blob = `${id} ${label}`;
  if (/說明|事由|備註|內容|原由|條件|note|desc|reason|purpose|comment/i.test(blob)) {
    return false;
  }
  if (/數量|qty|quantity|天數|小時|days|hours/i.test(blob)) return false;
  if (
    /credit_limit|accounts_receivable|notes_receivable|credit_balance|requested_credit|_limit$|handling_fee|^amount$|^budget$|sales_revenue|sales_cost|sales_gross_profit/.test(
      id
    )
  ) {
    return true;
  }
  if (/金額|總價|額度|帳款|票據|餘額|手續費|（元）|\(元\)/.test(label)) {
    return true;
  }
  return false;
}

export function isCreditLikeField(field) {
  return /信用|授信|額度|帳款|票據|餘額/.test(
    String(field?.label || '') + String(field?.id || '')
  );
}

export function numberToChineseCurrency(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return '';
  const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '萬', '億', '兆'];

  let integerPart = Math.floor(n);
  if (integerPart === 0) return '零元整';
  if (integerPart > 999999999999) return `新臺幣 ${integerPart.toLocaleString()} 元整`;

  let str = '';
  let bigIdx = 0;
  while (integerPart > 0) {
    const chunk = integerPart % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let zero = false;
      const cStr = String(chunk).padStart(4, '0');
      for (let i = 0; i < 4; i++) {
        const d = Number(cStr[i]);
        const u = 3 - i;
        if (d > 0) {
          if (zero) chunkStr += '零';
          chunkStr += digits[d] + units[u];
          zero = false;
        } else if (chunkStr) {
          zero = true;
        }
      }
      str = chunkStr + bigUnits[bigIdx] + str;
    }
    integerPart = Math.floor(integerPart / 10000);
    bigIdx++;
  }
  return `新臺幣 ${str}元整`;
}

export function applyTax(amount, action) {
  const n = Number(String(amount ?? '').replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  if (action === 'add') return String(Math.round(n * 1.05 * 10000) / 10000);
  if (action === 'sub') return String(Math.round((n / 1.05) * 10000) / 10000);
  return String(n);
}

export function parseAmountNumber(val) {
  const n = Number(String(val ?? '').replace(/[,，\s元萬]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
