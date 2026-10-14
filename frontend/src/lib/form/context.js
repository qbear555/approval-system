import { inject } from 'vue';

export const FORM_CTX = Symbol('approvalFormCtx');

export function useFormCtx() {
  const ctx = inject(FORM_CTX, null);
  if (!ctx) {
    throw new Error('表單欄位必須放在 FormFields 內');
  }
  return ctx;
}
