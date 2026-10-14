import { applyDrag, formFieldsFromObjects, newCanvasObject, buildCanvasLayout } from './canvas-designer.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const moved = applyDrag({ rx: 0.1, ry: 0.2, rw: 0.3, rh: 0.1 }, 0.05, -0.05);
assert(Math.abs(moved.rx - 0.15) < 0.001 && Math.abs(moved.ry - 0.15) < 0.001, 'drag');

const field = newCanvasObject('field');
field.fieldId = 'amount';
field.name = '金額';
const table = newCanvasObject('table');
table.rows[0].cells[0].field = 'reason';
table.rows[0].cells[0].label = '事由';
const fields = formFieldsFromObjects([field, table]);
assert(fields.some((f) => f.id === 'amount' && f.label === '金額'), 'field extract');
assert(fields.some((f) => f.id === 'reason'), 'table field extract');

const layout = buildCanvasLayout({ sourceType: 'leave', label: '請假' }, [field]);
assert(layout.type === 'canvas_objects' && layout.objects.length === 1, 'layout');

console.log('canvas-designer selftest ok');
