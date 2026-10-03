/**
 * 流程圖畫布編輯器（Phase 3）
 *
 * 純 DOM + inline SVG，不引入任何函式庫——本專案沒有前端建置流程，
 * app.js 是傳統 <script>，硬要引入流程圖套件得先導入打包工具，
 * 成本遠高於自己畫這幾百行。
 *
 * 依賴 app.js 提供的全域：esc / $ / state / toast / openModal / closeModal
 * / stepAssignLabel / flowOpSymbol
 */

const FE_NODE_W = 150;
const FE_HINT = '拖曳節點可移動；拖曳空白處平移畫布；Ctrl + 滾輪縮放';
const FE_NODE_H = 56;

function feUid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 8);
}

/** 由現有流程（v1 steps 或 v2 flow）建立可編輯的圖 */
function feGraphFrom(workflow) {
  if (workflow && workflow.flow && Array.isArray(workflow.flow.nodes) && workflow.flow.nodes.length) {
    return JSON.parse(JSON.stringify(workflow.flow));
  }
  const steps = (workflow && workflow.steps) || [];
  const idOf = (s, i) => 'n' + (s.order != null ? s.order : i + 1);
  const nodes = [
    { id: 'start', type: 'start', ui: { x: 40, y: 300 } },
    ...steps.map((s, i) => ({
      id: idOf(s, i),
      type: 'approval',
      name: s.name || '關卡 ' + (i + 1),
      assignType: s.assignType || 'users',
      formFieldId: s.formFieldId || 'agent',
      department: s.department || '',
      approverIds: s.approverIds || [],
      mode: s.mode === 'all' ? 'all' : 'any',
      approverFields: s.approverFields || [],
      rejectTo: 'requester',
      ui: { x: 230 + i * 200, y: 300 },
    })),
    { id: 'end', type: 'end', ui: { x: 230 + steps.length * 200, y: 300 } },
  ];
  const seq = ['start'].concat(steps.map(idOf), ['end']);
  const edges = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push({ from: seq[i], to: seq[i + 1] });

  // v1 條件式關卡 → 邊條件 + 互斥旁路
  const neg = { '>=': '<', '>': '<=', '<=': '>', '<': '>=', '==': '!=', '!=': '==', contains: 'not_contains' };
  steps.forEach((s, i) => {
    const c = s.condition;
    if (!c || !c.enabled || !c.fieldId || !c.operator) return;
    const nodeId = idOf(s, i);
    const at = seq.indexOf(nodeId);
    const prevId = seq[at - 1];
    const nextId = seq[at + 1];
    const e = edges.find((x) => x.from === prevId && x.to === nodeId);
    if (!e) return;
    const enter = c.action === 'skip'
      ? { fieldId: c.fieldId, operator: neg[c.operator] || c.operator, value: c.value }
      : { fieldId: c.fieldId, operator: c.operator, value: c.value };
    const bypass = c.action === 'skip'
      ? { fieldId: c.fieldId, operator: c.operator, value: c.value }
      : { fieldId: c.fieldId, operator: neg[c.operator] || c.operator, value: c.value };
    e.condition = enter;
    edges.push({ from: prevId, to: nextId, condition: bypass });
  });
  return { version: 2, nodes: nodes, edges: edges };
}

/** 前端驗證（與後端 flow-graph.validateGraph 規則一致，先擋在使用者端） */
function feValidate(g) {
  const errs = [];
  const starts = g.nodes.filter((n) => n.type === 'start');
  const ends = g.nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) errs.push('必須且只能有一個開始節點（目前 ' + starts.length + ' 個）');
  if (!ends.length) errs.push('必須至少有一個結束節點');
  if (!g.nodes.some((n) => n.type === 'approval')) errs.push('流程至少要有一個簽核關卡');

  const out = new Map(g.nodes.map((n) => [n.id, []]));
  const inn = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    if (out.has(e.from)) out.get(e.from).push(e);
    if (inn.has(e.to)) inn.get(e.to).push(e);
  }
  // 需要事先指定人員的類型，與後端 validateStepTemplate 保持一致：
  //   users      指定人員 → 就是簽核人名單
  //   users_pick 申請人自選 → approverIds 是「可選名單」，空的話申請人
  //              無人可選，送單與存檔都會被後端擋下
  // 其餘（dept_head／department／form_user／cosign_pick）於送單當下才決定人選。
  const needApprovers = ['users', 'users_pick'];
  for (const n of g.nodes) {
    const label = n.name || n.id;
    if (n.type !== 'start' && !inn.get(n.id).length) errs.push('「' + label + '」沒有任何連入路徑');
    if (n.type !== 'end' && !out.get(n.id).length) errs.push('「' + label + '」沒有任何連出路徑');
    if (n.type === 'join' && inn.get(n.id).length < 2) errs.push('匯合節點至少需要兩條連入路徑');
    if (n.type === 'approval' && needApprovers.includes(n.assignType) && !(n.approverIds || []).length) {
      errs.push(
        n.assignType === 'users_pick'
          ? '「' + label + '」是申請人自選，但可選名單是空的，請至少勾選一位候選簽核人'
          : '「' + label + '」尚未指定簽核人'
      );
    }
    if (n.type === 'approval' && n.assignType === 'department' && !String(n.department || '').trim()) {
      errs.push('「' + label + '」請指定簽核單位／部門');
    }
  }
  if (starts.length === 1) {
    const seen = new Set();
    const stack = [starts[0].id];
    while (stack.length) {
      const c = stack.pop();
      if (seen.has(c)) continue;
      seen.add(c);
      for (const e of out.get(c) || []) stack.push(e.to);
    }
    for (const n of g.nodes) if (!seen.has(n.id)) errs.push('「' + (n.name || n.id) + '」從開始節點無法到達');
  }
  const color = new Map(g.nodes.map((n) => [n.id, 0]));
  let cyc = false;
  const visit = (id) => {
    if (cyc) return;
    color.set(id, 1);
    for (const e of out.get(id) || []) {
      if (color.get(e.to) === 1) { cyc = true; errs.push('流程有循環，簽核會無法結束'); return; }
      if (color.get(e.to) === 0) visit(e.to);
    }
    color.set(id, 2);
  };
  for (const n of g.nodes) if (color.get(n.id) === 0) visit(n.id);
  return errs;
}

/** 依最長路徑分層自動排版 */
function feAutoLayout(g) {
  const inn = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) if (inn.has(e.to)) inn.get(e.to).push(e);
  const depth = new Map();
  const dep = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = inn.get(id) || [];
    const d = ins.length ? Math.max.apply(null, ins.map((e) => dep(e.from, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of g.nodes) dep(n.id, new Set());
  const byLayer = new Map();
  for (const n of g.nodes) {
    const d = depth.get(n.id) || 0;
    if (!byLayer.has(d)) byLayer.set(d, []);
    byLayer.get(d).push(n);
  }
  byLayer.forEach((list, d) => {
    list.forEach((n, i) => {
      n.ui = { x: 40 + d * 210, y: 70 + i * 115 };
    });
  });
}

/**
 * 開啟畫布編輯器
 * @param {Object|null} workflow 既有流程
 * @param {Function} onSave 收到編輯後的 graph
 */
function openFlowEditor(workflow, onSave) {
  const g = feGraphFrom(workflow);
  let selected = null;
  let linkFrom = null;
  let drag = null;
  let pan = null;

  openModal(
    '<div class="fe-wrap">' +
      '<h3 style="margin:0 0 10px">流程圖編輯器' +
      (workflow && workflow.name ? ' — ' + esc(workflow.name) : '') +
      '</h3>' +
      '<div class="fe-toolbar">' +
        '<button type="button" class="btn sm" id="fe-add-approval">＋ 簽核關卡</button>' +
        '<button type="button" class="btn sm" id="fe-add-join">＋ 匯合節點</button>' +
        '<button type="button" class="btn sm" id="fe-add-end">＋ 結束節點</button>' +
        '<span class="sep"></span>' +
        '<button type="button" class="btn sm outline" id="fe-link">🔗 連線模式</button>' +
        '<button type="button" class="btn sm outline danger" id="fe-del">🗑 刪除選取</button>' +
        '<span class="sep"></span>' +
        '<button type="button" class="btn sm outline" id="fe-tidy">⇄ 自動排版</button>' +
        '<span class="fe-hint" id="fe-hint">拖曳節點可移動；拖曳空白處平移畫布；Ctrl + 滾輪縮放</span>' +
      '</div>' +
      '<div class="fe-canvas-wrap" id="fe-canvas-wrap">' +
        '<div class="fe-canvas-sizer" id="fe-canvas-sizer">' +
          '<div class="fe-canvas" id="fe-canvas">' +
            '<svg class="fe-edges" id="fe-edges"></svg>' +
          '</div>' +
        '</div>' +
        '<div class="fe-zoom">' +
          '<button type="button" id="fe-zoom-out" title="縮小（Ctrl + 滾輪）">−</button>' +
          '<span class="fe-zoom-val" id="fe-zoom-val" title="點一下回到 100%">100%</span>' +
          '<button type="button" id="fe-zoom-in" title="放大（Ctrl + 滾輪）">＋</button>' +
          '<button type="button" id="fe-zoom-fit" title="縮放至剛好顯示全部節點">⤢</button>' +
        '</div>' +
      '</div>' +
      '<div class="fe-side" id="fe-side"></div>' +
      '<div id="fe-check"></div>' +
      '<div class="modal-actions" style="margin-top:10px">' +
        '<button type="button" class="btn" id="fe-cancel">取消</button>' +
        '<button type="button" class="btn primary" id="fe-save">儲存流程圖</button>' +
      '</div>' +
    '</div>'
  );

  // openModal 會把 className 重設為 'modal-panel'，這裡再補上編輯器專用的
  // 近全螢幕樣式，畫布才有足夠的操作空間
  const panel = document.getElementById('modal-panel');
  if (panel) panel.classList.add('fe-modal');

  const canvas = document.getElementById('fe-canvas');
  const wrap = document.getElementById('fe-canvas-wrap');
  const sizer = document.getElementById('fe-canvas-sizer');
  const svg = document.getElementById('fe-edges');
  const nodeById = (id) => g.nodes.find((n) => n.id === id);

  /* ── 縮放與平移 ─────────────────────────────────────────
     fe-canvas 用 transform: scale() 縮放，fe-canvas-sizer 同步撐出
     縮放後的尺寸，捲軸才會反映真正的內容大小。
     所有滑鼠座標換算都要除以 zoom，否則拖曳節點會跟著倍率飄掉。
     ──────────────────────────────────────────────────── */
  const CANVAS_W = 2400;
  const CANVAS_H = 1500;
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 2.5;
  let zoom = 1;

  function applyZoom() {
    canvas.style.transform = 'scale(' + zoom + ')';
    sizer.style.width = Math.round(CANVAS_W * zoom) + 'px';
    sizer.style.height = Math.round(CANVAS_H * zoom) + 'px';
    const el = document.getElementById('fe-zoom-val');
    if (el) el.textContent = Math.round(zoom * 100) + '%';
  }

  /** 以 wrap 內某個定點為錨點縮放，讓該點在畫面上位置不變 */
  function setZoom(next, anchorClientX, anchorClientY) {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (z === zoom) return;
    const r = wrap.getBoundingClientRect();
    const ax = anchorClientX == null ? r.width / 2 : anchorClientX - r.left;
    const ay = anchorClientY == null ? r.height / 2 : anchorClientY - r.top;
    // 錨點在畫布座標系的位置（縮放前後必須相同）
    const cx = (wrap.scrollLeft + ax) / zoom;
    const cy = (wrap.scrollTop + ay) / zoom;
    zoom = z;
    applyZoom();
    wrap.scrollLeft = cx * zoom - ax;
    wrap.scrollTop = cy * zoom - ay;
  }

  /** 縮放並置中，讓所有節點剛好進得了畫面 */
  function zoomToFit() {
    if (!g.nodes.length) return;
    const xs = g.nodes.map((n) => (n.ui && n.ui.x) || 0);
    const ys = g.nodes.map((n) => (n.ui && n.ui.y) || 0);
    const minX = Math.min.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxX = Math.max.apply(null, xs) + FE_NODE_W;
    const maxY = Math.max.apply(null, ys) + FE_NODE_H;
    const pad = 40;
    const r = wrap.getBoundingClientRect();
    const z = Math.min(
      (r.width - pad * 2) / Math.max(1, maxX - minX),
      (r.height - pad * 2) / Math.max(1, maxY - minY)
    );
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    applyZoom();
    wrap.scrollLeft = minX * zoom - pad;
    wrap.scrollTop = minY * zoom - pad;
  }


  function nodeLabel(n) {
    if (!n) return '';
    if (n.type === 'start') return '申請人';
    if (n.type === 'end') return '完成';
    if (n.type === 'join') return '匯合（' + (n.mode === 'any' ? '任一' : '全部') + '）';
    return n.name || n.id;
  }

  function nodeSub(n) {
    if (n.type !== 'approval') return '';
    const ids = n.approverIds || [];
    if (ids.length) {
      const names = ids.map((id) => {
        const u = (state.users || []).find((x) => x.id === Number(id));
        return u ? u.name : '#' + id;
      });
      const s = names.length > 2 ? names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 人' : names.join('、');
      return s + (n.mode === 'all' && ids.length > 1 ? '（需全簽）' : '');
    }
    return typeof stepAssignLabel === 'function' ? stepAssignLabel(n) : '';
  }

  function nodeWidth(n) {
    if (n.type === 'approval') return FE_NODE_W;
    if (n.type === 'join') return 120;
    return 110;
  }

  function centerOf(n) {
    const w = nodeWidth(n);
    return { x: (n.ui && n.ui.x ? n.ui.x : 0) + w / 2, y: (n.ui && n.ui.y ? n.ui.y : 0) + FE_NODE_H / 2 };
  }

  /**
   * 計算連線的起訖錨點與貝茲控制點。
   *
   * 錨點必須和曲線的進出方向一致，否則會「貼不緊」：
   * 若用中心到中心的直線去求外框交點，斜向連線會落在節點的上／下緣，
   * 但曲線是水平進出的，箭頭就會停在離線條很遠的邊上。
   *
   * 作法：比較水平與垂直距離，取主要方向決定接在左右邊或上下緣，
   * 控制點也朝同一方向拉出，曲線就會垂直於該邊進出。
   */
  function edgeAnchors(a, b) {
    const ca = centerOf(a);
    const cb = centerOf(b);
    const wa = nodeWidth(a) / 2;
    const wb = nodeWidth(b) / 2;
    const h = FE_NODE_H / 2;
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = dx >= 0 ? 1 : -1;
      const p1 = { x: ca.x + s * wa, y: ca.y };
      const p2 = { x: cb.x - s * wb, y: cb.y };
      const k = Math.max(40, Math.abs(p2.x - p1.x) * 0.45);
      return { p1: p1, p2: p2, c1: { x: p1.x + s * k, y: p1.y }, c2: { x: p2.x - s * k, y: p2.y } };
    }
    const s = dy >= 0 ? 1 : -1;
    const p1 = { x: ca.x, y: ca.y + s * h };
    const p2 = { x: cb.x, y: cb.y - s * h };
    const k = Math.max(40, Math.abs(p2.y - p1.y) * 0.45);
    return { p1: p1, p2: p2, c1: { x: p1.x, y: p1.y + s * k }, c2: { x: p2.x, y: p2.y - s * k } };
  }

  function renderEdges() {
    let html =
      '<defs>' +
      // 三種顏色各一個 marker：SVG marker 無法繼承線條顏色，
      // 少了選取色的 marker，選中的線會變藍但箭頭仍是灰的
      '<marker id="fe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker>' +
      '<marker id="fe-arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d97706"/></marker>' +
      '<marker id="fe-arrow-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2563eb"/></marker>' +
      '</defs>';
    g.edges.forEach((e, i) => {
      const a = nodeById(e.from);
      const b = nodeById(e.to);
      if (!a || !b) return;
      // 錨點與控制點一起算，確保曲線垂直於節點邊界進出、箭頭貼緊外框
      const an = edgeAnchors(a, b);
      const p1 = an.p1;
      const p2 = an.p2;
      const c1 = an.c1;
      const c2 = an.c2;
      const d = 'M ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) +
        ' C ' + c1.x.toFixed(1) + ' ' + c1.y.toFixed(1) +
        ', ' + c2.x.toFixed(1) + ' ' + c2.y.toFixed(1) +
        ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
      const isSel = selected && selected.kind === 'edge' && selected.index === i;
      const color = isSel ? '#2563eb' : e.condition ? '#d97706' : '#94a3b8';
      const marker = isSel ? 'fe-arrow-s' : e.condition ? 'fe-arrow-c' : 'fe-arrow';
      html += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (isSel ? 3 : 2) + '" ' +
        (e.condition ? 'stroke-dasharray="6 4" ' : '') +
        'marker-end="url(#' + marker + ')" data-edge="' + i + '"></path>';

      // 線段中央再放一個方向指標：長線條或彎折時，只靠終點箭頭不容易一眼看出流向
      const mid = {
        x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
        y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
      };
      // 三次貝茲在 t=0.5 的切線方向
      const tan = {
        x: 0.75 * (c1.x - p1.x) + 1.5 * (c2.x - c1.x) + 0.75 * (p2.x - c2.x),
        y: 0.75 * (c1.y - p1.y) + 1.5 * (c2.y - c1.y) + 0.75 * (p2.y - c2.y),
      };
      const ang = (Math.atan2(tan.y, tan.x) * 180) / Math.PI;
      html += '<path d="M -5 -4.5 L 5 0 L -5 4.5 Z" fill="' + color + '" style="pointer-events:none" ' +
        'transform="translate(' + mid.x.toFixed(1) + ',' + mid.y.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')"></path>';

      if (e.condition) {
        const t = e.condition.fieldId + ' ' + flowOpSymbol(e.condition.operator) + ' ' + e.condition.value;
        html += '<text x="' + mid.x.toFixed(1) + '" y="' + (mid.y - 12).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#92400e" style="pointer-events:none">' + esc(t) + '</text>';
      }
    });
    svg.innerHTML = html;
    // 連線的選取統一由 canvas 的 pointerdown 處理（見該處註解），
    // 這裡不再掛 click，避免兩套選取邏輯不一致
  }

  function userCheckboxes(n) {
    const users = (state.users || []).filter((u) => u.active !== 0);
    return '<div class="fe-approvers">' + users.map((u) =>
      '<label><input type="checkbox" data-approver="' + u.id + '" ' +
      ((n.approverIds || []).indexOf(u.id) >= 0 ? 'checked' : '') + '/> ' + esc(u.name) +
      (u.department ? '<span class="muted">（' + esc(u.department) + '）</span>' : '') + '</label>'
    ).join('') + '</div>';
  }

  function renderSide() {
    const box = document.getElementById('fe-side');
    if (!selected) {
      box.innerHTML = '<span class="muted">點選節點或連線以編輯屬性。建立分支：先點來源節點 → 按「連線模式」→ 點目標節點。</span>';
      return;
    }

    if (selected.kind === 'edge') {
      const e = g.edges[selected.index];
      if (!e) { selected = null; return renderSide(); }
      const c = e.condition || {};
      box.innerHTML =
        '<h4>連線：' + esc(nodeLabel(nodeById(e.from))) + ' → ' + esc(nodeLabel(nodeById(e.to))) + '</h4>' +
        '<div class="fe-row"><label style="min-width:auto"><input type="checkbox" id="fe-e-cond" ' +
          (e.condition ? 'checked' : '') + '/> 設定條件</label>' +
          '<span class="muted" style="font-size:.75rem">條件成立才走這條路徑</span></div>' +
        '<div class="fe-row" id="fe-e-row" ' + (e.condition ? '' : 'style="display:none"') + '>' +
          '<label>欄位</label><input type="text" id="fe-e-field" value="' + esc(c.fieldId || 'amount') + '" placeholder="amount" style="width:120px"/>' +
          '<select id="fe-e-op">' + ['>=', '>', '<=', '<', '==', '!=', 'contains', 'not_contains'].map((o) =>
            '<option value="' + o + '" ' + (c.operator === o ? 'selected' : '') + '>' + flowOpSymbol(o) + '</option>').join('') + '</select>' +
          '<input type="text" id="fe-e-val" value="' + esc(c.value || '') + '" placeholder="100000" style="width:120px"/>' +
        '</div>';
      document.getElementById('fe-e-cond').onchange = (ev) => {
        if (ev.target.checked) e.condition = { fieldId: 'amount', operator: '>=', value: '' };
        else delete e.condition;
        render();
      };
      const upd = () => {
        if (!e.condition) return;
        e.condition.fieldId = document.getElementById('fe-e-field').value.trim();
        e.condition.operator = document.getElementById('fe-e-op').value;
        e.condition.value = document.getElementById('fe-e-val').value.trim();
        renderEdges();
        runCheck();
      };
      ['fe-e-field', 'fe-e-op', 'fe-e-val'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.oninput = upd; el.onchange = upd; }
      });
      return;
    }

    const n = nodeById(selected.id);
    if (!n) { selected = null; return renderSide(); }

    if (n.type === 'start' || n.type === 'end') {
      box.innerHTML = '<h4>' + esc(nodeLabel(n)) + '</h4><span class="muted">起訖節點沒有可設定的屬性。</span>';
      return;
    }
    if (n.type === 'join') {
      box.innerHTML = '<h4>匯合節點</h4><div class="fe-row"><label>匯合條件</label><select id="fe-j-mode">' +
        '<option value="all" ' + (n.mode !== 'any' ? 'selected' : '') + '>所有連入分支都完成才繼續</option>' +
        '<option value="any" ' + (n.mode === 'any' ? 'selected' : '') + '>任一分支完成即繼續</option></select></div>';
      document.getElementById('fe-j-mode').onchange = (ev) => { n.mode = ev.target.value; render(); };
      return;
    }

    const others = g.nodes.filter((x) => x.type === 'approval' && x.id !== n.id);
    const assignOpts = [['users', '指定人員'], ['users_pick', '申請人自選'], ['cosign_pick', '會簽（選填）'],
      ['dept_head', '部門主管／可略過'], ['department', '指定單位'], ['form_user', '表單欄位指定']];
    box.innerHTML =
      '<h4>簽核關卡</h4>' +
      '<div class="fe-row"><label>關卡名稱</label><input type="text" id="fe-n-name" value="' + esc(n.name || '') + '" style="width:200px"/></div>' +
      '<div class="fe-row"><label>指派方式</label><select id="fe-n-assign">' +
        assignOpts.map((o) => '<option value="' + o[0] + '" ' + (n.assignType === o[0] ? 'selected' : '') + '>' + o[1] + '</option>').join('') +
      '</select><label style="min-width:auto">簽核方式</label><select id="fe-n-mode">' +
        '<option value="any" ' + (n.mode !== 'all' ? 'selected' : '') + '>任一人核准</option>' +
        '<option value="all" ' + (n.mode === 'all' ? 'selected' : '') + '>全部都要核准</option></select></div>' +
      (n.assignType === 'department'
        ? '<div class="fe-row"><label>單位</label><select id="fe-n-dept" style="width:200px"><option value="">請選擇…</option>' +
          (typeof collectWorkflowDeptNames === 'function' ? collectWorkflowDeptNames([n.department]) : [n.department].filter(Boolean))
            .map((d) => '<option value="' + esc(d) + '" ' + (n.department === d ? 'selected' : '') + '>' + esc(d) + '</option>')
            .join('') +
          '</select></div>' : '') +
      (n.assignType === 'form_user'
        ? '<div class="fe-row"><label>表單欄位</label><input type="text" id="fe-n-field" value="' + esc(n.formFieldId || 'agent') + '" style="width:160px"/></div>' : '') +
      '<div class="fe-row"><label>駁回退回</label><select id="fe-n-rejectto">' +
        '<option value="requester" ' + (!n.rejectTo || n.rejectTo === 'requester' ? 'selected' : '') + '>退回申請人（整單駁回）</option>' +
        others.map((o) => '<option value="' + esc(o.id) + '" ' + (n.rejectTo === o.id ? 'selected' : '') + '>退回「' + esc(o.name) + '」重簽</option>').join('') +
      '</select></div>' +
      '<div class="fe-row" style="align-items:flex-start"><label>簽核人</label>' + userCheckboxes(n) + '</div>';

    document.getElementById('fe-n-name').oninput = (ev) => { n.name = ev.target.value; render(); };
    document.getElementById('fe-n-assign').onchange = (ev) => { n.assignType = ev.target.value; render(); };
    document.getElementById('fe-n-mode').onchange = (ev) => { n.mode = ev.target.value; render(); };
    const dept = document.getElementById('fe-n-dept');
    if (dept) dept.onchange = (ev) => { n.department = ev.target.value; };
    const fld = document.getElementById('fe-n-field');
    if (fld) fld.oninput = (ev) => { n.formFieldId = ev.target.value; };
    document.getElementById('fe-n-rejectto').onchange = (ev) => { n.rejectTo = ev.target.value; };
    box.querySelectorAll('[data-approver]').forEach((cb) => {
      cb.onchange = () => {
        const id = Number(cb.dataset.approver);
        const set = new Set(n.approverIds || []);
        if (cb.checked) set.add(id); else set.delete(id);
        n.approverIds = Array.from(set);
        render();
      };
    });
  }

  function runCheck() {
    const errs = feValidate(g);
    const box = document.getElementById('fe-check');
    box.innerHTML = errs.length
      ? '<div class="fe-errors"><strong>流程有 ' + errs.length + ' 個問題，修正後才能儲存：</strong><ul>' +
        errs.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>'
      : '<div class="fe-ok">✓ 流程檢查通過，可以儲存</div>';
    const save = document.getElementById('fe-save');
    if (save) save.disabled = errs.length > 0;
  }

  function render() {
    Array.prototype.slice.call(canvas.querySelectorAll('.fe-node')).forEach((el) => el.remove());
    for (const n of g.nodes) {
      const el = document.createElement('div');
      el.className = 'fe-node t-' + n.type +
        (selected && selected.kind === 'node' && selected.id === n.id ? ' selected' : '') +
        (linkFrom === n.id ? ' linking-src' : '');
      el.style.left = (n.ui && n.ui.x ? n.ui.x : 0) + 'px';
      el.style.top = (n.ui && n.ui.y ? n.ui.y : 0) + 'px';
      el.dataset.id = n.id;
      const sub = nodeSub(n);
      el.innerHTML = '<div class="fe-title">' + esc(nodeLabel(n)) + '</div>' +
        (sub ? '<div class="fe-sub">' + esc(sub) + '</div>' : '');
      canvas.appendChild(el);
    }
    renderEdges();
    renderSide();
    runCheck();
  }

  // 掛在 wrap 而非 canvas：縮小時 wrap 內會有 canvas 以外的空白區域，
  // 點在那裡也應該要能平移或取消選取
  wrap.onpointerdown = (ev) => {
    // 連線必須在 pointerdown 就處理：pointerdown 早於 click，
    // 若這裡先當成「點空白處」而呼叫 render()，SVG 會整個重建，
    // 那條 path 在 click 觸發前就已從 DOM 移除，等於永遠選不到連線。
    const path = ev.target.closest ? ev.target.closest('path[data-edge]') : null;
    if (path) {
      selected = { kind: 'edge', index: Number(path.dataset.edge) };
      render();
      return;
    }

    const el = ev.target.closest ? ev.target.closest('.fe-node') : null;
    if (!el) {
      if (linkFrom) {
        linkFrom = null;
        document.getElementById('fe-hint').textContent = FE_HINT;
      }
      // 空白處按住拖曳 = 平移畫布
      pan = {
        x: ev.clientX,
        y: ev.clientY,
        sl: wrap.scrollLeft,
        st: wrap.scrollTop,
        moved: false,
      };
      wrap.classList.add('is-panning');
      return;
    }
    const n = nodeById(el.dataset.id);
    if (!n) return;

    if (linkFrom) {
      if (linkFrom !== n.id && !g.edges.some((e) => e.from === linkFrom && e.to === n.id)) {
        g.edges.push({ from: linkFrom, to: n.id });
      }
      linkFrom = null;
      document.getElementById('fe-hint').textContent = FE_HINT;
      render();
      return;
    }
    selected = { kind: 'node', id: n.id };
    // 記錄起始的「節點座標」與「滑鼠螢幕座標」，移動時只用兩者的差值換算。
    // 不可依賴即時的 canvas.getBoundingClientRect()：pointerdown 會觸發
    // render()，側欄與檢查訊息重繪會改變版面高度，畫布位置跟著位移，
    // 用即時 rect 換算就會產生固定偏移。
    drag = {
      id: n.id,
      ox: (n.ui && n.ui.x) || 0,
      oy: (n.ui && n.ui.y) || 0,
      sx: ev.clientX,
      sy: ev.clientY,
    };
    // 捕捉在 wrap 上（移動與放開的 handler 也在 wrap）；
    // 若捕捉在節點上，render() 重建節點時捕捉會中斷，拖曳就會卡住
    try { wrap.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    render();
  };

  // 平移與拖曳都掛在 wrap 上：節點被拖出畫布邊界時，
  // 事件仍需持續收到，掛在 canvas 上會在游標離開時斷掉
  wrap.onpointermove = (ev) => {
    if (pan) {
      const dx = ev.clientX - pan.x;
      const dy = ev.clientY - pan.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
      wrap.scrollLeft = pan.sl - dx;
      wrap.scrollTop = pan.st - dy;
      return;
    }
    if (!drag) return;
    const n = nodeById(drag.id);
    if (!n) return;
    // 螢幕位移 ÷ 縮放倍率 = 畫布位移
    n.ui = {
      x: Math.max(0, Math.round(drag.ox + (ev.clientX - drag.sx) / zoom)),
      y: Math.max(0, Math.round(drag.oy + (ev.clientY - drag.sy) / zoom)),
    };
    const el = canvas.querySelector('.fe-node[data-id="' + (window.CSS && CSS.escape ? CSS.escape(n.id) : n.id) + '"]');
    if (el) { el.style.left = n.ui.x + 'px'; el.style.top = n.ui.y + 'px'; }
    renderEdges();
  };

  wrap.onpointerup = () => {
    if (pan) {
      const wasClick = !pan.moved;
      pan = null;
      wrap.classList.remove('is-panning');
      // 只有「點一下沒拖動」才視為點空白處取消選取，
      // 否則平移完會把使用者原本選好的節點清掉
      if (wasClick && selected) {
        selected = null;
        render();
      }
      return;
    }
    drag = null;
  };
  wrap.onpointerleave = () => {
    if (pan) { pan = null; wrap.classList.remove('is-panning'); }
    drag = null;
  };

  // Ctrl／⌘ + 滾輪縮放（單純滾輪維持捲動，符合一般預期）
  wrap.onwheel = (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    setZoom(zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), ev.clientX, ev.clientY);
  };

  document.getElementById('fe-zoom-in').onclick = () => setZoom(zoom * 1.2);
  document.getElementById('fe-zoom-out').onclick = () => setZoom(zoom / 1.2);
  document.getElementById('fe-zoom-fit').onclick = () => zoomToFit();
  document.getElementById('fe-zoom-val').onclick = () => setZoom(1);

  document.getElementById('fe-add-approval').onclick = () => {
    const id = feUid('n');
    g.nodes.push({
      id: id, type: 'approval', name: '新關卡', assignType: 'users', mode: 'any',
      approverIds: [], approverFields: [], formFieldId: 'agent', department: '',
      rejectTo: 'requester', ui: { x: 420, y: 160 + (g.nodes.length % 5) * 30 },
    });
    selected = { kind: 'node', id: id };
    render();
  };
  document.getElementById('fe-add-join').onclick = () => {
    const id = feUid('j');
    g.nodes.push({ id: id, type: 'join', mode: 'all', ui: { x: 640, y: 300 } });
    selected = { kind: 'node', id: id };
    render();
  };
  document.getElementById('fe-add-end').onclick = () => {
    const id = feUid('end');
    g.nodes.push({ id: id, type: 'end', ui: { x: 900, y: 300 } });
    selected = { kind: 'node', id: id };
    render();
  };
  document.getElementById('fe-link').onclick = () => {
    if (selected && selected.kind === 'node') {
      linkFrom = selected.id;
      document.getElementById('fe-hint').textContent = '連線模式：請點選目標節點（點空白處取消）';
      render();
    } else {
      toast('請先點選一個來源節點，再按連線模式', 'error');
    }
  };
  document.getElementById('fe-del').onclick = () => {
    if (!selected) { toast('請先選取要刪除的節點或連線', 'error'); return; }
    if (selected.kind === 'edge') {
      g.edges.splice(selected.index, 1);
    } else {
      const n = nodeById(selected.id);
      if (n && n.type === 'start') { toast('開始節點不可刪除', 'error'); return; }
      g.nodes = g.nodes.filter((x) => x.id !== selected.id);
      g.edges = g.edges.filter((e) => e.from !== selected.id && e.to !== selected.id);
    }
    selected = null;
    render();
  };
  document.getElementById('fe-tidy').onclick = () => { feAutoLayout(g); render(); };
  document.getElementById('fe-cancel').onclick = () => closeModal();
  document.getElementById('fe-save').onclick = () => {
    const errs = feValidate(g);
    if (errs.length) { toast('流程尚有問題，請先修正', 'error'); return; }
    onSave(JSON.parse(JSON.stringify(g)));
  };

  render();
  applyZoom();
  // 開啟時自動縮放到看得見全部節點
  setTimeout(zoomToFit, 0);
}
