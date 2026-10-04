/**
 * 主管簽核常用片語：正規化與預設值
 */
'use strict';

const DEFAULT_COMMENT_PHRASES = [
  '同意',
  '核可',
  '准予備查',
  '依規定辦理',
  '請檢附單據正本',
  '依規定核銷',
];

const MAX_PHRASES = 20;
const MAX_LEN = 80;

function normalizePhrases(input) {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const s = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    const clipped = s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    out.push(clipped);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

function parsePhrasesJson(json) {
  if (json == null || json === '') return DEFAULT_COMMENT_PHRASES.slice();
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const n = normalizePhrases(parsed);
    return n.length ? n : DEFAULT_COMMENT_PHRASES.slice();
  } catch {
    return DEFAULT_COMMENT_PHRASES.slice();
  }
}

module.exports = {
  DEFAULT_COMMENT_PHRASES,
  MAX_PHRASES,
  MAX_LEN,
  normalizePhrases,
  parsePhrasesJson,
};
