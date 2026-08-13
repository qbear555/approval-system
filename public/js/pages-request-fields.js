/**
 * 申請欄位／假別／加班時數
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
function renderDeptHeadChooserHtml(step) {
  const fieldId = `dept_head_${step.order}`;
  const { deptMembers, others, myDeptLabel } = splitUsersForDeptHeadChooser();
  const opt = (u) =>
    `<option value="${u.id}">${esc(u.name)}${
      u.department ? `（${esc(u.department)}）` : ''
    }</option>`;
  let groups = '';
  if (deptMembers.length) {
    groups += `<optgroup label="同部門成員${myDeptLabel ? `（${esc(myDeptLabel)}）` : ''}">${deptMembers
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (others.length) {
    groups += `<optgroup label="${deptMembers.length ? '其他人員' : '全體人員'}">${others
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (!deptMembers.length && !others.length) {
    groups = `<option value="" disabled>尚無可選人員</option>`;
  }
  return `
    <div class="field" data-dept-head-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '部門主管簽核')}
        <span class="muted" style="font-weight:400">（可指定成員或略過）</span>
      </label>
      <select name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}" data-type="dept_head">
        <option value="skip" selected>不需要經過部門主管（略過此步驟）</option>
        ${groups}
      </select>
    </div>`;
}

/**
 * 會簽人員：申請人可多位勾選，非必填（不勾＝略過）
 * 名單為全體啟用成員（排除本人）
 */
function renderCosignChooserHtml(step) {
  const fieldId = `cosign_${step.order}`;
  const me = state.user?.id;
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  const checks = all
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" data-ff="${esc(fieldId)}" data-type="cosign_pick"
          value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-cosign-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '會簽人員')}
        <span class="muted" style="font-weight:400">（選填・可多選・不勾則略過）</span>
      </label>
      <div class="approver-list" style="margin-top:6px;max-height:220px">
        ${
          checks ||
          '<span class="muted">尚無可選人員</span>'
        }
      </div>
    </div>`;
}

/**
 * 申請人自選簽核人（如副總）：勾選方式（可多位，至少一位）
 * 候選名單來自步驟 approverIds
 */
function renderUsersPickChooserHtml(step) {
  const fieldId = `users_pick_${step.order}`;
  const poolIds = (step.approverIds || []).map(Number).filter(Boolean);
  const me = state.user?.id;
  let candidates = (state.users || []).filter(
    (u) => u.active !== 0 && poolIds.includes(u.id) && u.id !== me
  );
  // 若 pool 在 state.users 對不到，仍顯示 id
  if (!candidates.length && poolIds.length) {
    candidates = poolIds
      .filter((id) => id !== me)
      .map((id) => ({ id, name: `使用者 #${id}`, department: '' }));
  }
  const modeHintText =
    candidates.length > 1
      ? (step.mode || 'any') === 'all'
        ? '多位需全部核准'
        : '多位任一核准即可'
      : '';
  const stepLabel = step.name || '副總經理簽核';
  const checks = candidates
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}"
          data-type="users_pick" value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-users-pick-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
        <span style="white-space:nowrap">${esc(stepLabel)} <span style="color:#b91c1c">*</span></span>
        <span class="muted" style="font-weight:400;font-size:0.82rem;white-space:nowrap">必填・可勾選多位${modeHintText ? '・' + modeHintText : ''}</span>
        <button type="button" class="btn sm outline" data-users-pick-all="${esc(fieldId)}">全選</button>
        <button type="button" class="btn sm outline" data-users-pick-none="${esc(fieldId)}">取消全選</button>
      </label>
      <div class="approver-list" style="margin-top:0;max-height:280px">
        ${
          candidates.length
            ? checks
            : `<span class="muted">尚無可選簽核人，請聯絡管理員設定流程</span>`
        }
      </div>
    </div>`;
}

/** 綁定副總等 users_pick 全選／取消全選 */
function bindUsersPickChooser(root) {
  root.querySelectorAll('[data-users-pick-all]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickAll;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = true;
        });
    };
  });
  root.querySelectorAll('[data-users-pick-none]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickNone;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = false;
        });
    };
  });
}

function renderDynamicFieldHtml(f, defaults = {}, opts = {}) {
  const req = f.required ? ' *' : '';
  const reqAttr = f.required ? 'required' : '';
  const ph = f.placeholder ? esc(f.placeholder) : '';
  const name = `ff_${esc(f.id)}`;
  const defVal =
    defaults[f.id] != null && defaults[f.id] !== ''
      ? String(defaults[f.id])
      : '';
  // 請假／電腦異常報修：不使用富文字／自繪表格
  const allowRich = opts.enableRich !== false;
  if (f.type === 'textarea') {
    // 說明／事由等：Word 式富文字（顏色、字級、表格、可貼上）
    // 請假、電腦異常報修整份表單關閉（enableRich: false）
    const useRich =
      allowRich &&
      (/說明|事由|用途|內容|備註|主旨|廠商/.test(String(f.label || '')) ||
        f.id === 'subject' ||
        f.id === 'reason' ||
        f.id === 'purpose' ||
        f.id === 'desc');
    // 舊版 __table 物件轉提示（合併顯示於初始 HTML）
    let initial = defVal;
    const legacyTable = defaults[`${f.id}__table`];
    if (
      useRich &&
      legacyTable &&
      typeof legacyTable === 'object' &&
      Array.isArray(legacyTable.cells)
    ) {
      const rows = legacyTable.cells
        .map(
          (row, ri) =>
            `<tr>${(row || [])
              .map((c) => {
                const tag = ri === 0 ? 'th' : 'td';
                return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
              })
              .join('')}</tr>`
        )
        .join('');
      const tbl = `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      if (initial && !/<table/i.test(initial)) {
        initial =
          (typeof RichEditor !== 'undefined'
            ? RichEditor.plainToHtml(initial)
            : esc(initial).replace(/\n/g, '<br>')) + tbl;
      } else if (!initial) {
        initial = tbl;
      }
    }
    // 請假等純文字：若誤存 HTML，顯示為純文字
    if (!useRich && typeof RichEditor !== 'undefined' && RichEditor.isProbablyHtml(initial)) {
      initial = RichEditor.htmlToPlain(initial);
    }
    return `<div class="field" style="grid-column:1/-1">
      <label>${esc(f.label)}${req}</label>
      <textarea name="${name}" data-ff="${esc(f.id)}" ${useRich ? 'data-rich="1"' : ''}
        ${reqAttr} placeholder="${
          useRich
            ? ph || '可輸入文字、設定顏色／字級、插入或貼上表格…'
            : ph || ''
        }"
        rows="${useRich ? 5 : 3}">${esc(initial)}</textarea>
      ${
        useRich
          ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">支援粗體／顏色／字級／插入表格；可從 Word、Excel 直接貼上</div>`
          : ''
      }
    </div>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || [])
      .map(
        (o) =>
          `<option value="${esc(o)}" ${defVal === String(o) ? 'selected' : ''}>${esc(o)}</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" ${reqAttr}>
        <option value="">請選擇…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'user') {
    const me = state.user?.id;
    const opts = (state.users || [])
      .filter((u) => u.active !== 0 && u.id !== me)
      .map(
        (u) =>
          `<option value="${u.id}" ${defVal === String(u.id) ? 'selected' : ''}>${esc(u.name)}${
            u.department ? `（${esc(u.department)}）` : ''
          }</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" data-type="user" ${reqAttr}>
        <option value="">請選擇人員…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'datetime') {
    // 請假：09:00～17:30；延長工時／實際工時：17:30～24:00；其餘：00:00～23:30
    const isLeaveRange = f.id === 'start_date' || f.id === 'end_date';
    const isOtRange =
      f.id === 'ot_start' ||
      f.id === 'ot_end' ||
      f.id === 'actual_start' ||
      f.id === 'actual_end' ||
      /延長工時|實際工時/.test(String(f.label || ''));
    const isEnd =
      f.id === 'end_date' ||
      f.id === 'ot_end' ||
      f.id === 'actual_end' ||
      /結束|迄/.test(String(f.label || ''));
    const tStart = isLeaveRange
      ? WORK_TIME_START
      : isOtRange
        ? OT_TIME_START
        : '00:00';
    const tEnd = isLeaveRange
      ? WORK_TIME_END
      : isOtRange
        ? OT_TIME_END
        : '23:30';
    const defaultTime = isEnd
      ? isLeaveRange
        ? WORK_TIME_END
        : isOtRange
          ? '21:00'
          : '18:00'
      : isLeaveRange
        ? WORK_TIME_START
        : isOtRange
          ? OT_TIME_START
          : '18:00';
    const parts = parseDateTimeParts('', defaultTime);
    const selTime = clampWorkTime(parts.time, defaultTime, tStart, tEnd);
    // 日期時間佔一欄（與其他短欄並排）
    return `<div class="field">
      <label>${esc(f.label)}${req}</label>
      <div class="datetime-row" data-datetime-field="${esc(f.id)}">
        <input type="date" data-ff-date="${esc(f.id)}" ${reqAttr} title="日期" />
        <select data-ff-time="${esc(f.id)}" ${reqAttr}
          title="時間 ${tStart}～${tEnd}（每 30 分鐘）"
          data-default-time="${defaultTime}">
          ${halfHourTimeOptions(selTime, { start: tStart, end: tEnd })}
        </select>
      </div>
      <input type="hidden" name="${name}" data-ff="${esc(f.id)}" data-type="datetime" value="" />
      <div class="muted" style="font-size:0.8rem;margin-top:4px">
        可選時間 ${tStart}～${tEnd}（每 30 分鐘）
      </div>
    </div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" name="${name}" data-ff="${esc(f.id)}" data-type="checkbox" ${reqAttr} />
        ${esc(f.label)}${req}
      </label></div>`;
  }
  const type = ['number', 'date'].includes(f.type) ? f.type : 'text';
  const valAttr = defVal !== '' ? ` value="${esc(defVal)}"` : '';
  // 天數／小時：最小單位 0.5（避免瀏覽器 step 預設為 1 導致 22.5 被拒）
  const isHalfStep =
    f.type === 'number' &&
    (f.id === 'hours' ||
      f.id === 'days' ||
      f.id === 'actual_hours' ||
      f.id === 'comp_leave_balance' ||
      f.id === 'remaining_special_leave_days' ||
      f.id === 'remaining_special_leave_hours' ||
      /小時|天數|時數/.test(String(f.label || '')));
  const halfHint = isHalfStep
    ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">最小單位 0.5（例：0、0.5、1、3.5、7.5、22.5）</div>`
    : '';

  const isWide =
    /主旨|標題|地址|說明|內容|備註|事由/.test(String(f.label || '')) ||
    f.id === 'subject' ||
    f.id === 'title' ||
    f.id === 'address';
  const fieldStyle = isWide ? 'style="grid-column:1/-1"' : '';

  if (type === 'number' && isHalfStep) {
    return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
      <input type="number" name="${name}" data-ff="${esc(f.id)}" data-half-step="1"
        step="0.5" min="0" inputmode="decimal" ${reqAttr}
        placeholder="${ph}"${valAttr} />
      ${halfHint}
    </div>`;
  }
  return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
    <input type="${type}" name="${name}" data-ff="${esc(f.id)}" ${reqAttr}
      placeholder="${ph}"${valAttr}${type === 'number' ? ' step="any"' : ''} />
    ${halfHint}
  </div>`;
}

/** 對齊 0.5 單位（小時／天數） */
function snapHalfUnit(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 2) / 2);
}

/**
 * 請假最小計算單位（與後端 labor.getLeaveMinUnit 一致）
 * 補休／公假／公傷／病假／事假 → 0.5 小時
 * 特休 → 0.5 日
 * 產假／喪假／曠職 → 1 日
 */
const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5 },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};
const WORK_DAY_HOURS_CLIENT = 7.5;

function matchLeaveTypeIdClient(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (/特別休假|特休/.test(t) && !/不休假|代金/.test(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
  // 公傷須先於病假（避免「公傷病假」命中病假）
  if (/公傷/.test(t)) return 'occupational';
  if (/住院/.test(t)) return 'hospital';
  if (/普通傷病|病假/.test(t)) return 'sick';
  if (/事假/.test(t)) return 'personal';
  if (/婚假/.test(t)) return 'marriage';
  if (/祭儀/.test(t)) return 'ritual';
  if (/喪假|喪葬/.test(t)) return 'funeral';
  if (/產假|分娩/.test(t) && !/陪產|產檢/.test(t)) return 'maternity';
  if (/產檢/.test(t) && !/陪產/.test(t)) return 'prenatal';
  if (/安胎/.test(t)) return 'tocolysis';
  if (/陪產/.test(t)) return 'paternity';
  if (/生理/.test(t)) return 'menstrual';
  if (/家庭照顧|家照/.test(t)) return 'family';
  if (/公假/.test(t)) return 'official';
  if (/補休|調休/.test(t)) return 'comp';
  return 'other';
}

function getLeaveMinUnitClient(typeName) {
  const id = matchLeaveTypeIdClient(typeName);
  const base = LEAVE_MIN_UNIT_BY_ID[id] || { unit: 'day', step: 0.5 };
  const label =
    base.unit === 'hour' ? `${base.step} 小時` : `${base.step} 日`;
  return { id, unit: base.unit, step: base.step, label };
}

function snapToStepClient(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return 0;
  if (!Number.isFinite(s) || s <= 0) return x;
  return Math.round((Math.round(x / s) * s) * 1000) / 1000;
}

/** 依假別對齊天數／小時（試算與手動修改） */
function applyLeaveMinUnitClient(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnitClient(leaveType);
  let days = Number(daysIn);
  let hours = Number(hoursIn);
  if (!Number.isFinite(days) || days < 0) days = 0;
  if (!Number.isFinite(hours) || hours < 0) hours = 0;

  if (rule.unit === 'hour') {
    let h = hours > 0 ? hours : days * WORK_DAY_HOURS_CLIENT;
    h = snapToStepClient(h, rule.step);
    if (h > 0 && h < rule.step) h = rule.step;
    return {
      days: Math.round((h / WORK_DAY_HOURS_CLIENT) * 1000) / 1000,
      hours: h,
      rule,
    };
  }
  let d = days > 0 ? days : hours / WORK_DAY_HOURS_CLIENT;
  d = snapToStepClient(d, rule.step);
  if (d > 0 && d < rule.step) d = rule.step;
  // 特休：只以日計，不換算／填寫小時
  if (rule.id === 'special') {
    return { days: d, hours: 0, rule };
  }
  return {
    days: d,
    hours: snapToStepClient(d * WORK_DAY_HOURS_CLIENT, 0.5),
    rule,
  };
}

function leaveUnitHintText(leaveType) {
  const rule = getLeaveMinUnitClient(leaveType);
  if (rule.id === 'special') {
    return `此假別（特休）最小單位 0.5 日，以日計算，不換算小時`;
  }
  if (rule.unit === 'hour') {
    return `此假別最小單位 ${rule.label}（以小時為準；全日＝7.5 小時）。例：0.5、1、1.5、3.5、7.5 小時`;
  }
  if (rule.step === 1) {
    return `此假別最小單位 1 日（僅能請整天，不可半日／小時）`;
  }
  return `此假別最小單位 0.5 日（例：0.5、1、1.5 日；全日＝7.5 小時）`;
}

/**
 * 解析日期時間（支援 24:00＝當日結束／次日 00:00）
 * @returns {Date|null}
 */
function parseOtDateTime(val) {
  if (!val) return null;
  const m = String(val)
    .trim()
    .replace(' ', 'T')
    .match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(5, 7)) - 1;
  const d = Number(m[1].slice(8, 10));
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // 24:00 → 次日 00:00
  if (hh === 24 && mm === 0) {
    const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * 延長工時時數：結束−開始，對齊 0.5 小時
 * @returns {number|null} 無效或結束≤開始時回傳 null
 */
function calcOvertimeHours(startStr, endStr) {
  const a = parseOtDateTime(startStr);
  const b = parseOtDateTime(endStr);
  if (!a || !b) return null;
  if (b.getTime() <= a.getTime()) return null;
  let h = (b.getTime() - a.getTime()) / 3600000;
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  return h;
}

/**
 * 綁定起迄時間 → 時數自動換算
 * @param {HTMLElement} root
 * @param {{ startId: string, endId: string, hoursId: string, hintId?: string, hintText?: string }} cfg
 */
function bindHoursAutoCalc(root, cfg) {
  if (!root || !cfg) return;
  const { startId, endId, hoursId, hintId, hintText } = cfg;
  const startDate = root.querySelector(`[data-ff-date="${startId}"]`);
  const startTime = root.querySelector(`[data-ff-time="${startId}"]`);
  const endDate = root.querySelector(`[data-ff-date="${endId}"]`);
  const endTime = root.querySelector(`[data-ff-time="${endId}"]`);
  const hoursInp = root.querySelector(`[data-ff="${hoursId}"]`);
  if (!hoursInp || (!startDate && !startTime && !endDate && !endTime)) return;

  // 時數改為唯讀自動帶入（仍可後端驗證）
  hoursInp.readOnly = true;
  hoursInp.title = '依起迄時間自動換算（最小 0.5 小時）';
  hoursInp.placeholder = '依起迄自動換算';
  if (hoursInp.hasAttribute('required')) {
    // 保持 required，送出前會寫入值
  }

  let hint = hintId ? root.querySelector(`#${hintId}`) : null;
  const hintHost = hoursInp.parentElement;
  if (hintHost && hintId && !hint) {
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'muted';
    hint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
    hint.textContent =
      hintText ||
      '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
    hintHost.appendChild(hint);
  }

  const recalc = () => {
    syncDateTimeHidden(root, startId);
    syncDateTimeHidden(root, endId);
    const a = root.querySelector(`[data-ff="${startId}"]`)?.value;
    const b = root.querySelector(`[data-ff="${endId}"]`)?.value;
    if (!a || !b) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent =
          hintText ||
          '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
      }
      return;
    }
    const h = calcOvertimeHours(a, b);
    if (h == null) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent = '結束時間須晚於開始時間，才能換算時數';
        hint.style.color = '#b45309';
      }
      return;
    }
    hoursInp.value = snapHalfUnit(h);
    if (hint) {
      hint.style.color = '';
      const st = a.slice(11, 16);
      const et = b.slice(11, 16);
      const sameDay = a.slice(0, 10) === b.slice(0, 10);
      hint.textContent = sameDay
        ? `自動換算：${st}～${et}＝${h} 小時（最小單位 0.5）`
        : `自動換算：${a.slice(0, 16).replace('T', ' ')}～${b
            .slice(0, 16)
            .replace('T', ' ')}＝${h} 小時`;
    }
  };

  [startDate, startTime, endDate, endTime].forEach((el) => {
    if (el) el.addEventListener('change', recalc);
  });
  // 初次若已有值則試算
  recalc();
}

/** 假別顯示用短名：祭儀假、病假、特休… */
function shortLeaveTypeLabel(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypeClient(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

/** 更新欄位 label，保留必填 * 標記 */
function setFieldLabelText(inputEl, text) {
  const lab = inputEl?.closest('.field')?.querySelector('label');
  if (!lab) return;
  const hadReq = !!lab.querySelector('.req') || !!inputEl?.required;
  lab.textContent = '';
  lab.appendChild(document.createTextNode(text));
  if (hadReq) {
    lab.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = 'req';
    sp.textContent = '*';
    lab.appendChild(sp);
  }
}

/**
 * 人事簽核：假別（人事核定）變更時
 * - 標籤改為「剩餘{假別}日數（目前／核准後）」
 * - 特休：自動帶入剩餘日數（核准後＝目前−本單）；不再使用／換算小時
 * - 非特休：數值留白，不帶入
 * - 隱藏「剩餘特休小時」欄（若流程定義仍殘留）
 */
function bindHrLeaveTypeAutoRemain(root, labor) {
  if (!root || !labor) return;
  const typeSel = root.querySelector('[data-ff="hr_leave_type"]');
  const daysInp = root.querySelector('[data-ff="remaining_special_leave_days"]');
  const hoursInp = root.querySelector(
    '[data-ff="remaining_special_leave_hours"]'
  );
  // 特休不以小時計算：隱藏殘留的小時欄
  if (hoursInp) {
    const wrap = hoursInp.closest('.field');
    if (wrap) wrap.classList.add('hidden');
    hoursInp.required = false;
    hoursInp.value = '';
    hoursInp.removeAttribute('name');
  }
  if (!typeSel || !daysInp) return;

  // 確保下拉含全部假別選項
  const opts =
    Array.isArray(labor.leaveTypeOptions) && labor.leaveTypeOptions.length
      ? labor.leaveTypeOptions
      : labor.remainByLeaveType
        ? Object.keys(labor.remainByLeaveType)
        : [];
  if (opts.length && typeSel.tagName === 'SELECT') {
    const cur = typeSel.value || labor.leaveType || '';
    const existing = new Set(
      [...typeSel.options].map((o) => o.value).filter(Boolean)
    );
    opts.forEach((opt) => {
      if (!existing.has(opt)) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        typeSel.appendChild(o);
      }
    });
    if (cur && !existing.has(cur) && !opts.includes(cur)) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      typeSel.appendChild(o);
    }
    if (cur) typeSel.value = cur;
  }

  const applyRemain = () => {
    const t = typeSel.value || '';
    const isSpecial = isSpecialLeaveTypeClient(t);
    const shortName = shortLeaveTypeLabel(t);
    let days = '';

    if (isSpecial) {
      const map = labor.remainByLeaveType || {};
      if (map[t] && map[t].days !== '' && map[t].days != null) {
        days = map[t].days ?? '';
      } else {
        const before = Number(labor.remainingBefore);
        const thisDays = Number(labor.thisLeaveDays);
        let remain = Number.isFinite(before) ? before : null;
        if (remain != null && Number.isFinite(thisDays) && thisDays > 0) {
          remain = Math.round((remain - thisDays) * 2) / 2;
        }
        if (remain != null) {
          remain = Math.max(0, remain);
          days = String(remain);
        }
      }
    }
    // 非特休：強制留白

    if (daysInp) {
      daysInp.value = isSpecial ? days : '';
      daysInp.required = isSpecial;
      daysInp.placeholder = isSpecial
        ? '例如：7 或 7.5（核准後剩餘日數）'
        : '非特休可留白';
      daysInp.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 標籤依假別變動（僅日數，不換算小時）
    const dayLabel = isSpecial
      ? `剩餘${shortName}日數（核准後）`
      : `剩餘${shortName}日數（目前）`;
    if (daysInp) setFieldLabelText(daysInp, dayLabel);
  };

  typeSel.addEventListener('change', applyRemain);
  applyRemain();
}

/** 人事簽核：申請人特休剩餘提示區塊 */
let leaveBalanceReqSeq = 0;

/** 新增申請頁：選到請假類流程時，載入並顯示我的請假餘額（僅供參考，實際以人事核定為準） */
async function loadAndRenderLeaveBalance(box) {
  if (!box) return;
  const seq = ++leaveBalanceReqSeq;
  box.innerHTML = `<div class="muted" style="font-size:0.85rem">載入請假餘額中…</div>`;
  try {
    const me = state.user?.id;
    if (!me) {
      box.innerHTML = '';
      return;
    }
    const res = await api(`/api/users/${me}/labor`);
    if (seq !== leaveBalanceReqSeq) return; // 使用者已切換流程，捨棄此結果
    const balances = (res?.labor?.leaveBalances || []).filter(
      (b) => b && (b.hasFixedQuota || b.canTrackManual)
    );
    if (!balances.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
        <strong>我的請假餘額</strong>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:0.88rem">
          ${balances
            .map(
              (b) =>
                `<span>${esc(b.name)}：剩餘 <strong style="color:#15803d">${esc(
                  String(b.remainingLabel ?? b.remaining ?? '—')
                )}</strong></span>`
            )
            .join('')}
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:0.78rem">僅供參考；實際可休天數與扣除以人事核定為準。</p>
      </div>`;
  } catch (e) {
    if (seq !== leaveBalanceReqSeq) return;
    box.innerHTML = '';
  }
}

function renderApplicantLaborBanner(labor, request) {
  if (!labor) return '';
  const sl = labor.specialLeave || {};
  const thisDays = labor.thisLeaveDays;
  const after =
    labor.remainingAfter != null
      ? labor.remainingAfter
      : labor.suggestRemainingDays;
  const warnAfter = after != null && after < 0;
  const entitled = sl.entitled ?? 0;
  return `
    <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
      <strong>申請人特休（成員名單手動可休）</strong>
      <div style="margin-top:8px;font-size:0.9rem;line-height:1.55">
        <div>申請人：${esc(request.requester_name || '')}${
          request.requester_dept ? `（${esc(request.requester_dept)}）` : ''
        }</div>
        <div>到職日：${esc(labor.hireDate || '未設定')}${
          labor.seniority?.label ? ` · 年資：${esc(labor.seniority.label)}（僅顯示）` : ''
        }</div>
        <div>統計年度：${esc(sl.yearLabel || '—')}</div>
        <div>
          可休 <strong>${entitled}</strong> 日（手動）·
          已休 ${sl.used ?? '—'} 日
          ${
            sl.manualUsedDays
              ? `（含手動 ${sl.manualUsedDays || 0} 日）`
              : ''
          } ·
          目前剩餘 <strong style="color:#15803d">${
            labor.remainingBefore != null ? labor.remainingBefore : sl.remaining ?? '—'
          }</strong> 日
        </div>
        ${
          entitled === 0
            ? `<div class="muted" style="margin-top:4px">可休為 0：請至「成員名單」手動填寫特休可休天數。</div>`
            : ''
        }
        ${
          labor.thisIsSpecial && thisDays != null
            ? `<div>
                本單特休申請 <strong>${thisDays}</strong> 日 →
                核准後剩餘
                <strong style="color:${warnAfter ? '#b91c1c' : '#15803d'}">${after}</strong> 日
                ${warnAfter ? '（已超休，請確認）' : '（已自動填入下方「剩餘特休日數」）'}
              </div>`
            : labor.leaveType
              ? `<div>本單假別：${esc(labor.leaveType)}${
                  thisDays != null ? ` · ${thisDays} 日` : ''
                }（非特休時，剩餘欄位可留白）</div>`
              : ''
        }
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
        特休以<strong>日</strong>計算（不換算小時）。可休日數由成員名單手動設定；統計年度為曆年制（1/1～12/31）。實際給假以人事核定為準。
      </p>
    </div>`;
}

function syncDateTimeHidden(root, fieldId) {
  const dateEl = root.querySelector(`[data-ff-date="${fieldId}"]`);
  const timeEl = root.querySelector(`[data-ff-time="${fieldId}"]`);
  const hidden = root.querySelector(`[data-ff="${fieldId}"][data-type="datetime"]`);
  if (!dateEl || !timeEl || !hidden) return;
  if (dateEl.value && timeEl.value) {
    hidden.value = `${dateEl.value}T${timeEl.value}`;
  } else {
    hidden.value = '';
  }
}

function bindDateTimeFields(root) {
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    const id = wrap.dataset.datetimeField;
    const dateEl = wrap.querySelector(`[data-ff-date="${id}"]`);
    const timeEl = wrap.querySelector(`[data-ff-time="${id}"]`);
    const onChange = () => syncDateTimeHidden(root, id);
    if (dateEl) dateEl.addEventListener('change', onChange);
    if (timeEl) timeEl.addEventListener('change', onChange);
    onChange();
  });
}
