import { MAX_IMAGE_EDGE } from './images';
import type { ImageAttachment, Location } from '../types';

export async function renderPdfImage(reader: any, location: Location, pageLabel?: string): Promise<ImageAttachment> {
  const view = reader._internalReader._lastView;
  const win = view._iframeWindow;
  const app = win.PDFViewerApplication;
  // Awaiting a promise from the reader's compartment reapplies Gecko's Xray
  // wrapper, which hides PDFPageProxy prototype methods from the add-on.
  const page = Components.utils.waiveXrays(await app.pdfDocument.getPage(location.pageIndex + 1));
  const rotation = app.pdfViewer.getPageView(location.pageIndex)?.viewport?.rotation ?? page.rotate ?? 0;
  const base = page.getViewport(Components.utils.cloneInto({ scale: 1, rotation }, win));
  const rect = location.rects?.[0];
  if (!rect) throw new Error('请先框选图片区域。');
  const nativeRect = Components.utils.cloneInto(rect, win);
  const [x1, y1, x2, y2] = base.convertToViewportRectangle(nativeRect);
  const scale = Math.min(3, (MAX_IMAGE_EDGE - 2) / Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)));
  const viewport = page.getViewport(Components.utils.cloneInto({ scale, rotation }, win));
  const points = viewport.convertToViewportRectangle(nativeRect);
  const left = Math.max(0, Math.floor(Math.min(points[0], points[2])));
  const top = Math.max(0, Math.floor(Math.min(points[1], points[3])));
  const right = Math.min(Math.ceil(viewport.width), Math.ceil(Math.max(points[0], points[2])));
  const bottom = Math.min(Math.ceil(viewport.height), Math.ceil(Math.max(points[1], points[3])));
  if (right <= left || bottom <= top) throw new Error('框选区域过小，请重新选择。');
  const canvas = win.document.createElement('canvas') as HTMLCanvasElement;
  canvas.width = right - left; canvas.height = bottom - top;
  const options = new win.Object();
  options.canvasContext = canvas.getContext('2d'); options.viewport = viewport;
  options.transform = Components.utils.cloneInto([1, 0, 0, 1, -left, -top], win);
  options.background = 'rgb(255, 255, 255)';
  await page.render(options).promise;
  return { id: Zotero.Utilities.randomString(12), name: `论文截图 · 第 ${pageLabel || location.pageIndex + 1} 页`,
    dataURL: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
    pageLabel: pageLabel || String(location.pageIndex + 1), location };
}

/** Select a region without creating or changing any Zotero annotation. */
export function selectPdfRegion(reader: any, signal: AbortSignal): Promise<Location | undefined> {
  const view = reader?._internalReader?._lastView;
  const win = view?._iframeWindow;
  const doc = win?.document as Document | undefined;
  const viewer = win?.PDFViewerApplication?.pdfViewer;
  if (!doc || !viewer) throw new Error('请等待 PDF 页面加载完成后再框选图片。');
  return new Promise(resolve => {
    const overlay = doc.createElement('div');
    overlay.className = 'paperlens-image-capture';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;';
    const hint = doc.createElement('div');
    hint.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:6px;background:#20252d;color:white;font:13px system-ui;white-space:nowrap;box-shadow:0 2px 8px #0003;';
    hint.append('拖动框选图片 · Esc 取消 ');
    const cancel = doc.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText = 'margin-left:8px;border:1px solid #adb8c7;border-radius:4px;color:white;background:transparent;cursor:pointer;';
    hint.append(cancel);
    const box = doc.createElement('div');
    box.style.cssText = 'display:none;position:absolute;border:2px solid #2d64ad;background:rgba(45,100,173,.12);pointer-events:none;';
    overlay.append(hint, box);
    let start: { x: number; y: number; pageIndex: number; bounds: DOMRect; viewport: any } | undefined;
    const finish = (location?: Location) => {
      overlay.remove(); doc.removeEventListener('keydown', key, true);
      win.removeEventListener('pagehide', abort); signal.removeEventListener('abort', abort);
      resolve(location);
    };
    const abort = () => finish();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
    };
    const point = (event: PointerEvent) => ({
      x: Math.max(start!.bounds.left, Math.min(start!.bounds.right, event.clientX)),
      y: Math.max(start!.bounds.top, Math.min(start!.bounds.bottom, event.clientY)),
    });
    cancel.addEventListener('pointerdown', event => event.stopPropagation());
    cancel.addEventListener('click', abort);
    overlay.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      overlay.style.pointerEvents = 'none';
      const page = doc.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.page[data-page-number]');
      overlay.style.pointerEvents = '';
      if (!page) return;
      const pageIndex = Number(page.dataset.pageNumber) - 1;
      const pageView = viewer.getPageView(pageIndex);
      const surface = page.querySelector('.canvasWrapper') || page;
      start = { x: event.clientX, y: event.clientY, pageIndex, bounds: surface.getBoundingClientRect(), viewport: pageView.viewport };
      overlay.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    overlay.addEventListener('pointermove', event => {
      if (!start) return;
      const end = point(event);
      Object.assign(box.style, { display: 'block', left: `${Math.min(start.x, end.x)}px`, top: `${Math.min(start.y, end.y)}px`,
        width: `${Math.abs(end.x - start.x)}px`, height: `${Math.abs(end.y - start.y)}px` });
    });
    overlay.addEventListener('pointerup', event => {
      if (!start) return;
      const end = point(event);
      if (Math.abs(end.x - start.x) < 8 || Math.abs(end.y - start.y) < 8) { start = undefined; box.style.display = 'none'; return; }
      const toPDF = (x: number, y: number) => start!.viewport.convertToPdfPoint(
        (x - start!.bounds.left) * start!.viewport.width / start!.bounds.width,
        (y - start!.bounds.top) * start!.viewport.height / start!.bounds.height);
      const a = toPDF(start.x, start.y), b = toPDF(end.x, end.y);
      finish({ pageIndex: start.pageIndex, rects: [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]] });
    });
    overlay.addEventListener('pointercancel', abort);
    overlay.addEventListener('wheel', event => { if (start) event.preventDefault(); }, { passive: false });
    doc.addEventListener('keydown', key, true);
    win.addEventListener('pagehide', abort, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    doc.documentElement.append(overlay);
    win.focus();
    if (signal.aborted) finish();
  });
}
