function formatMoney(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/,/g, ''));
  if (Number.isFinite(n)) {
    return n.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return String(val);
}

/** 西元日期時間 → 民國年、月、日、時、分 */
function toRocParts(val) {
  if (val == null || val === '') {
    return { y: '', m: '', d: '', hh: '', mm: '', text: '—' };
  }
  const s = String(val).trim().replace(' ', 'T');
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/
  );
  if (!m) {
    return { y: '', m: '', d: '', hh: '', mm: '', text: String(val) };
  }
  const adY = Number(m[1]);
  const rocY = adY >= 1911 ? adY - 1911 : adY;
  return {
    y: String(rocY),
    m: String(Number(m[2])),
    d: String(Number(m[3])),
    hh: m[4] != null ? m[4] : '',
    mm: m[5] != null ? m[5] : '',
    text: `${rocY}/${Number(m[2])}/${Number(m[3])}${
      m[4] != null ? ` ${m[4]}:${m[5] || '00'}` : ''
    }`,
  };
}

function formFieldByLabel(formFields, re) {
  return (formFields || []).find((f) => re.test(String(f.label || '')));
}

function pickFormValue(formData, formFields, ids, labelRe) {
  const data = formData || {};
  for (const id of ids || []) {
    if (data[`${id}__label`]) return data[`${id}__label`];
    if (data[`${id}__name`]) return data[`${id}__name`];
    if (data[id] != null && data[id] !== '') return data[id];
  }
  if (labelRe) {
    const f = formFieldByLabel(formFields, labelRe);
    if (f) {
      if (data[`${f.id}__label`]) return data[`${f.id}__label`];
      if (data[`${f.id}__name`]) return data[`${f.id}__name`];
      if (data[f.id] != null && data[f.id] !== '') return data[f.id];
    }
  }
  return '';
}

/** 從簽核歷程取某步驟核准人（多人則以、串接）；matcher 可為 RegExp 或 (stepName)=>boolean */
/**
 * 簽核歷程「步驟」欄的顯示文字。
 * v2 圖模型的系統動作（匯合、路徑判定）不屬於任何編號關卡，
 * step_order 為 NULL，直接內插會在 PDF 上印出「null · 匯合」。
 */
/** 簽核人未填意見時，系統自動代入的預設值（server/index.js） */
const DEFAULT_APPROVAL_COMMENTS = new Set(['同意', '駁回']);
/**
 * 意見欄由簽核人自由填寫的動作。
 * 不含 cosign／forward：它們的 comment 是系統組出來的加簽／轉簽紀錄，屬於歷程而非意見。
 */
const COMMENTABLE_ACTIONS = new Set(['approve', 'reject', 'return', 'cancel']);

/**
 * 取出簽核人員「實際填寫」的意見。
 * 未填寫（系統預設的同意／駁回）、代理標記、Email 催辦通知一律視為沒有意見。
 * @returns {string} 意見內容；沒有則為空字串
 */
function approverWrittenComment(a) {
  if (!a || !COMMENTABLE_ACTIONS.has(a.action)) return '';
  let s = String(a.comment || '').trim();
  if (!s || /Email 催辦/.test(s)) return '';
  // 代理簽核時系統會附加「(代理 某某 簽核)」，本身不算意見
  s = s.replace(/\(代理\s*[^)]*簽核\)/g, '').trim();
  if (!s || DEFAULT_APPROVAL_COMMENTS.has(s)) return '';
  return s;
}

/**
 * 簽核歷程表「意見」欄的顯示文字。
 * 已完整列在上方「簽核意見」區塊的內容不再重複塞進窄欄，改為指向上方；
 * 其餘（送出申請、加簽／轉簽、系統訊息、通知確認）仍照原樣顯示。
 */
function historyCommentCell(a) {
  return approverWrittenComment(a) ? '詳見上方簽核意見' : a.comment || '—';
}

/** 篩出有填寫意見的簽核動作 */
function actionsWithWrittenComments(actions) {
  return (actions || [])
    .map((action) => ({ action, text: approverWrittenComment(action) }))
    .filter((x) => x.text);
}

/**
 * 「簽核意見」區塊：把簽核人員填寫的意見完整列出，放在簽核歷程之上。
 * 歷程表的「意見」欄寬度有限，長意見會被擠壓，這裡以整列寬度呈現全文。
 * @param {object} s 版面介面（各版型自備）：需有 doc/useFont/C/leftX/contentW、
 *   ensureSpace/fillRect/strokeRect/textAt/textMid，以及可讀寫的 y
 * @param {Array} actions 簽核歷程
 * @param {() => void} drawTitle 由呼叫端繪製標題（各版型標題樣式不同）
 */
function drawApproverComments(s, actions, drawTitle) {
  const list = actionsWithWrittenComments(actions);
  if (!list.length) return;
  const { doc, useFont, C, leftX, contentW } = s;
  const FS_TEXT = 10.5;
  const HEAD_H = 17;
  const PAD = 9;

  s.ensureSpace(44);
  drawTitle();

  for (const { action: a, text } of list) {
    const who = a.delegated_for_name
      ? `${a.actor_name} (代 ${a.delegated_for_name})`
      : a.actor_name || '—';
    const time = String(a.created_at || '').replace('T', ' ').slice(0, 16);
    useFont();
    doc.fontSize(FS_TEXT);
    const textW = contentW - PAD * 2;
    const boxH = HEAD_H + doc.heightOfString(text, { width: textW }) + PAD + 2;
    s.ensureSpace(boxH + 6);
    const top = s.y;
    s.fillRect(leftX, top, contentW, HEAD_H, C.altBg);
    s.strokeRect(leftX, top, contentW, boxH, C.softLine, 0.5);
    s.fillRect(leftX, top, 3, boxH, C.header);
    s.textMid(`${formatStepCell(a)}　${who}`, leftX + PAD, top, contentW * 0.66, HEAD_H, {
      size: 9.5,
      color: C.softInk,
    });
    s.textMid(time, leftX + contentW * 0.66, top, contentW * 0.34 - PAD, HEAD_H, {
      size: 9.5,
      color: C.muted,
      align: 'right',
    });
    s.textAt(text, leftX + PAD, top + HEAD_H + 5, textW, {
      size: FS_TEXT,
      color: C.ink,
    });
    s.y = top + boxH + 6;
  }
}

/**
 * 簽核表格的「簽名」欄：有 base64 簽名圖就畫圖，
 * 沒有圖或圖片無法解碼則改印文字（drawText）。
 */
function drawSignatureCell(doc, dataUrl, { x, y, w, h }, drawText) {
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
    try {
      const imgBuf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      doc.image(imgBuf, x + 2, y + 2, {
        fit: [w - 4, h - 4],
        align: 'center',
        valig: 'center',
      });
      return;
    } catch {
      /* 圖片無法解碼 → 退回文字 */
    }
  }
  drawText();
}

function formatStepCell(a) {
  const name = a.step_name ? String(a.step_name) : '';
  if (a.step_order == null || a.step_order === '') return name || '—';
  return `${a.step_order}${name ? ` · ${name}` : ''}`;
}

function actorsForStep(actions, matcher) {
  const match =
    typeof matcher === 'function'
      ? matcher
      : (name) => matcher.test(String(name || ''));
  const list = (actions || []).filter(
    (a) => a.action === 'approve' && match(String(a.step_name || ''))
  );
  if (!list.length) return { names: '', times: '' };
  const names = [...new Set(list.map((a) => a.actor_name).filter(Boolean))];
  const times = list
    .map((a) => {
      const t = String(a.created_at || '');
      return t.replace('T', ' ').slice(0, 16);
    })
    .filter(Boolean);
  return {
    names: names.join('、'),
    times: times[times.length - 1] || '',
  };
}

function flattenApproverData(ad) {
  const flat = {};
  const src = ad || {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  return flat;
}

module.exports = {
  formatMoney,
  toRocParts,
  formFieldByLabel,
  pickFormValue,
  DEFAULT_APPROVAL_COMMENTS,
  COMMENTABLE_ACTIONS,
  approverWrittenComment,
  historyCommentCell,
  actionsWithWrittenComments,
  drawApproverComments,
  drawSignatureCell,
  formatStepCell,
  actorsForStep,
  flattenApproverData,
};
