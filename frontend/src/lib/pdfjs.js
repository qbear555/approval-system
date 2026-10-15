/**
 * PDF.js 由 Vite 打包，開 PDF 時才載入。
 * workerSrc 透過靜態 ?url 由 Vite 解析為靜態資產路徑，避免動態載入 dummy module 導致瀏覽器模組載入失敗。
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

let libPromise = null;

export function getPdfjs() {
  if (!libPromise) {
    libPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist/build/pdf');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjsLib;
    })();
  }
  return libPromise;
}
