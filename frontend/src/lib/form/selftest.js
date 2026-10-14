import { formatYuanWanStyle, isMoneyFormField, numberToChineseCurrency, applyTax } from './money.js';
import { emptyFormTable, mutateFormTable, normalizeFormTable } from './table.js';
import { parseWelfareItems, summarizeWelfare, welfareAutoOpeningSummary } from './welfare.js';
import { parseIdList } from './people.js';
import { combineDateTime, calcOvertimeHours } from './datetime.js';
import { applyLeaveMinUnit, isSpecialLeaveType } from './leave.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(formatYuanWanStyle(12406) === '12,406 元', 'wan style < 10萬');
assert(formatYuanWanStyle(250000) === '25萬元', 'wan style 整萬');
assert(formatYuanWanStyle(1001000) === '100萬1000元', 'wan style 混合');
assert(isMoneyFormField({ id: 'amount', label: '金額' }), 'amount is money');
assert(!isMoneyFormField({ id: 'reason', label: '費用說明' }), '說明不是金額');
assert(numberToChineseCurrency(123).includes('壹佰貳拾參'), '中文大寫');
assert(applyTax(105, 'sub') === '100', '未稅反推');

const t = normalizeFormTable({ cells: [['a', 'b'], ['c', 'd']], header: true });
assert(t && t.rows === 2 && t.cols === 2, 'normalize table');
assert(!normalizeFormTable({ cells: [['', ''], ['', '']] }), '空白表視為無');
const added = mutateFormTable(emptyFormTable(2, 2), 'add-row');
assert(added.table.rows === 3, 'add row');

const items = parseWelfareItems('[{"date":"2026-01-01","summary":"提撥","deposit":"100","withdraw":""}]');
assert(items.length === 1, 'parse welfare');
const sum = summarizeWelfare(items, 50);
assert(sum.closing === 150, 'welfare closing');
assert(welfareAutoOpeningSummary('3', 115) === '115年2月份結轉', 'opening summary');

assert(parseIdList('1, 2，3').join(',') === '1,2,3', 'id list');
assert(combineDateTime('2026-10-13', '09:00') === '2026-10-13T09:00', 'datetime');
assert(isSpecialLeaveType('特別休假'), 'special leave');
assert(applyLeaveMinUnit('特別休假', 1, 7.5).hours === 0, 'special leave no hours');
assert(applyLeaveMinUnit('病假', 0, 7.5).hours === 7.5, 'sick hours');
assert(calcOvertimeHours('2026-10-13T18:00', '2026-10-13T21:00') === 3, 'ot hours');

console.log('form kernel selftest ok');
