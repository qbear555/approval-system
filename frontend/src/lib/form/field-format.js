import { formatDateTimeDisplay } from './datetime';
import {
  formatForeignAmount,
  formatYuanWanStyle,
  isCreditLikeField,
  isForeignCurrency,
  isMoneyFormField,
} from './money';
import { findUser, userLabel } from './people';
import { shouldUseRich } from './rich';
import { normalizeFormTable } from './table';

export function isHalfStepNumber(field) {
  const id = String(field?.id || '');
  const label = String(field?.label || '');
  return (
    field?.type === 'number' &&
    (id === 'hours' ||
      id === 'days' ||
      id === 'actual_hours' ||
      id === 'comp_leave_balance' ||
      id === 'remaining_special_leave_days' ||
      id === 'remaining_special_leave_hours' ||
      /小時|天數|時數/.test(label))
  );
}

export function isAmountFxField(field) {
  const id = String(field?.id || '');
  const label = String(field?.label || '');
  return (
    field?.type === 'number' &&
    (id === 'amount' || id === 'budget' || /預估金額|金額|費用/.test(label))
  );
}

export function snapHalfUnit(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 2) / 2);
}

export function formatFormValue(field, value, formData, users = []) {
  if (field?.type === 'checkbox') return value ? '是' : '否';
  if (field?.type === 'datetime') return formatDateTimeDisplay(value);
  if (field?.id === 'void_target_id' && formData?.[`${field.id}__label`]) {
    return formData[`${field.id}__label`];
  }
  if (field?.type === 'user') {
    if (formData?.[`${field.id}__label`]) return formData[`${field.id}__label`];
    if (formData?.[`${field.id}__name`]) return formData[`${field.id}__name`];
    const u = findUser(users, value);
    if (u) return userLabel(u);
  }
  if (value == null || value === '') return '—';
  if (isMoneyFormField(field)) {
    const rawNum = Number(String(value).replace(/[,，\s元萬]/g, ''));
    if (!Number.isFinite(rawNum)) return String(value);
    const cur = formData?.currency || formData?.幣別 || '';
    if (isForeignCurrency(cur) && !isCreditLikeField(field)) {
      const fx = formatForeignAmount(value);
      return fx === '—' ? '—' : `${fx} ${String(cur).trim()}`.trim();
    }
    const wanText = formatYuanWanStyle(value);
    if (wanText === '—') return '—';
    if (cur && !isCreditLikeField(field)) {
      return `${wanText.replace(/\s*元$/, '')} ${cur}`.trim();
    }
    return wanText;
  }
  return String(value);
}

export function isRichDisplayField(field) {
  return (
    field?.type === 'textarea' ||
    field?.id === 'subject' ||
    /主旨|說明|事由|內容|備註|異常|規格/.test(String(field?.label || ''))
  );
}

export function fieldColSpan(field) {
  if (
    field?.type === 'textarea' ||
    field?.type === 'table' ||
    field?.type === 'grid' ||
    field?.id === 'welfare_items' ||
    field?.id === 'followup_items' ||
    field?.id === 'attendee_ids' ||
    field?.id === 'void_target_id'
  ) {
    return 'full';
  }
  if (field?.type === 'datetime') {
    const id = String(field.id || '');
    if (id === 'ot_start' || id === 'ot_end' || id === 'actual_start' || id === 'actual_end') {
      return '1';
    }
    return '2';
  }
  return '1';
}

export function shouldHideField(field) {
  const id = String(field?.id || '');
  return id === 'attendees' || id === 'handling_fee_mode';
}

/** 請假／人事：排除特休「換算小時」欄位 */
export function stripSpecialLeaveHoursFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => {
    if (!f) return false;
    const id = String(f.id || '');
    const label = String(f.label || '');
    if (id === 'remaining_special_leave_hours') return false;
    if (/剩餘.*特休.*小時|特休.*小時/.test(label) && /剩餘|換算/.test(label)) return false;
    return true;
  });
}

export { shouldUseRich, normalizeFormTable };
