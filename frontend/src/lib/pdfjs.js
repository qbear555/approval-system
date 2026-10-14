/**
 * PDF.js 由 Vite 打包，開 PDF 時才載入。不再插入 /vendor/pdfjs/pdf.min.js。
 */
let libPromise = null;

export function getPdfjs() {
  if (!libPromise) {
    libPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist/build/pdf');
      const workerMod = await import('pdfjs-dist/build/pdf.worker.min.js?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
      return pdfjsLib;
    })();
  }
  return libPromise;
}
