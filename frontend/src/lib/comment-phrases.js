export const DEFAULT_COMMENT_PHRASES = [
  '同意',
  '核可',
  '准予備查',
  '依規定辦理',
  '請檢附單據正本',
  '依規定核銷',
];

export function resolveCommentPhrases(user) {
  const list = user && Array.isArray(user.comment_phrases) ? user.comment_phrases : [];
  const cleaned = list.map((s) => String(s || '').trim()).filter(Boolean);
  return cleaned.length ? cleaned : DEFAULT_COMMENT_PHRASES.slice();
}
