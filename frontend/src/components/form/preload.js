/** 讓 Vite 編譯第 0 步表單核心（實際頁面之後再靜態 import） */
export function loadFormKernel() {
  return Promise.all([
    import('./FormFields.vue'),
    import('./FormDataViewer.vue'),
    import('./AttachmentList.vue'),
    import('./LaborBanner.vue'),
  ]);
}
