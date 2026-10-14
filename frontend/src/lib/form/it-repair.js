export const IT_REPAIR_CHECK_IDS = [
  'check_os',
  'check_memory',
  'check_disk',
  'check_3dmark',
  'check_email',
  'check_backup',
  'check_battery',
];

export function isItRepairNoncompliant(val) {
  const s = String(val == null ? '' : val);
  return s.includes('不符合') || /低於\s*70/.test(s);
}

export function itRepairNoteId(checkId) {
  return `${checkId}_note`;
}

export function isItRepairNoteField(fieldId) {
  const id = String(fieldId || '');
  if (!id.endsWith('_note')) return false;
  return IT_REPAIR_CHECK_IDS.includes(id.slice(0, -5));
}
