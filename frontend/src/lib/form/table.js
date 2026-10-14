export function normalizeFormTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  let cells = obj.cells;
  if (!Array.isArray(cells) || !cells.length) return null;
  cells = cells.map((row) => (Array.isArray(row) ? row : []).map((c) => String(c ?? '')));
  const cols = Math.max(1, ...cells.map((r) => r.length), Number(obj.cols) || 0);
  cells = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  const hasContent = cells.some((r) => r.some((c) => String(c).trim()));
  if (!hasContent) return null;
  return {
    rows: cells.length,
    cols,
    header: obj.header !== false,
    cells,
  };
}

export function emptyFormTable(rows = 3, cols = 3) {
  const r = Math.min(20, Math.max(1, Number(rows) || 3));
  const c = Math.min(10, Math.max(1, Number(cols) || 3));
  return {
    rows: r,
    cols: c,
    header: true,
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  };
}

export function mutateFormTable(table, action) {
  const t = table ? { ...table, cells: table.cells.map((r) => r.slice()) } : emptyFormTable();
  const cells = t.cells;
  const cols = t.cols;
  if (action === 'add-row') {
    if (cells.length >= 20) return { table: t, error: '表格最多 20 列' };
    cells.push(Array.from({ length: cols }, () => ''));
  } else if (action === 'add-col') {
    if (cols >= 10) return { table: t, error: '表格最多 10 欄' };
    cells.forEach((r) => r.push(''));
  } else if (action === 'del-row') {
    if (cells.length <= 1) return { table: t, error: '至少保留 1 列' };
    cells.pop();
  } else if (action === 'del-col') {
    if (cols <= 1) return { table: t, error: '至少保留 1 欄' };
    cells.forEach((r) => r.pop());
  } else if (action === 'clear') {
    return { table: null };
  }
  return {
    table: {
      rows: cells.length,
      cols: cells[0]?.length || 0,
      header: true,
      cells,
    },
  };
}
