import type { AIClient } from '../ai/client';
import type { Storage } from '../storage';
import type { Quote, TranslationBridge } from '../types';
import { TranslationController } from './controller';

const HTML = 'http://www.w3.org/1999/xhtml';

export class TranslationPopups {
  private entries = new Map<any, { quote: Quote; show: () => void; close: () => void }>();
  private pending = new Map<any, { anchor: HTMLElement; timer: ReturnType<typeof setTimeout> }>();

  constructor(private url: string, private storage: Storage, private ai: AIClient,
    private ask: (reader: any, quote: Quote) => Promise<void>, private notifySettings: () => void) {}

  schedule(reader: any, anchor: HTMLElement, quote: Quote) {
    this.cancelPending(reader);
    const current = this.entries.get(reader);
    if (current && !this.sameQuote(current.quote, quote)) current.close();
    else if (current) return;
    const timer = setTimeout(async () => {
      try {
        const settings = await this.storage.getSettings();
        if (this.pending.get(reader)?.anchor !== anchor) return;
        this.pending.delete(reader);
        if (anchor.isConnected && settings.autoTranslate !== false) {
          this.open(reader, anchor, quote, settings.translationKeepOpen !== false);
        }
      } catch (error) { Zotero.logError(error); }
    }, 450);
    this.pending.set(reader, { anchor, timer });
  }

  private sameQuote(a: Quote, b: Quote) {
    return a.text === b.text && a.location.pageIndex === b.location.pageIndex &&
      JSON.stringify(a.location.rects) === JSON.stringify(b.location.rects);
  }
  private cancelPending(reader: any) {
    clearTimeout(this.pending.get(reader)?.timer); this.pending.delete(reader);
  }

  async openFromPreferences(reader: any, anchor: HTMLElement, quote: Quote) {
    const settings = await this.storage.getSettings();
    this.open(reader, anchor, quote, settings.translationKeepOpen !== false);
  }

  open(reader: any, anchor: HTMLElement, quote: Quote, keepOpen = true) {
    this.cancelPending(reader);
    const current = this.entries.get(reader);
    if (current && this.sameQuote(current.quote, quote)) { current.show(); return; }
    current?.close();
    const readerDoc = anchor.ownerDocument;
    // Reader content cannot embed chrome:// pages; mount in Zotero's privileged host.
    const hostFrame = reader._iframe as HTMLElement;
    const doc = hostFrame.ownerDocument, win = doc.defaultView!;
    const panel = doc.createElementNS(HTML, 'div') as HTMLDivElement;
    panel.className = 'paperlens-translation-popup';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'PaperLens 选文翻译');
    panel.style.cssText = 'position:fixed;z-index:10000;box-sizing:border-box;overflow:hidden;border:1px solid light-dark(#dce1e8,#484e58);border-radius:9px;background:light-dark(#fff,#24272d);box-shadow:0 6px 24px rgb(0 0 0 / 18%);color-scheme:light dark;';
    const frame = doc.createElementNS(HTML, 'iframe') as HTMLIFrameElement;
    frame.setAttribute('title', 'PaperLens 译文');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;min-width:0;';
    panel.append(frame);
    let closed = false, unmount: (() => void) | undefined;
    let x = 0, y = 0;
    const place = () => {
      const bounds = hostFrame.getBoundingClientRect();
      if (bounds.width <= 24 || bounds.height <= 24) { close(); return; }
      const width = Math.min(380, bounds.width - 24), height = Math.min(312, bounds.height - 24);
      x = Math.max(bounds.left + 12, Math.min(x, bounds.right - width - 12));
      y = Math.max(bounds.top + 12, Math.min(y, bounds.bottom - height - 12));
      Object.assign(panel.style, { width: width + 'px', height: height + 'px', left: x + 'px', top: y + 'px' });
    };
    const controller = new TranslationController(quote, this.storage, this.ai,
      () => new (win as any).AbortController(), this.notifySettings);
    const viewDocs: Document[] = [doc, readerDoc];
    for (const view of [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]) {
      const viewDoc = view?._iframeWindow?.document;
      if (viewDoc && !viewDocs.includes(viewDoc)) viewDocs.push(viewDoc);
    }
    const close = () => {
      if (closed) return;
      closed = true; controller.dispose(); unmount?.(); panel.remove();
      win.clearInterval(layoutTimer);
      for (const viewDoc of viewDocs) {
        viewDoc.removeEventListener('pointerdown', outside, true);
        viewDoc.removeEventListener('keydown', escape, true);
        viewDoc.removeEventListener('scroll', scrolled, true);
        viewDoc.defaultView?.removeEventListener('unload', close);
      }
      win.removeEventListener('resize', place); win.removeEventListener('unload', close);
      this.entries.delete(reader); this.cancelPending(reader);
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (target.ownerDocument !== frame.contentDocument && !panel.contains(target) &&
        !(target as Element).closest?.('.selection-popup')) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const scrolled = (event: Event) => {
      if (event.currentTarget !== doc && event.currentTarget !== readerDoc &&
        !(event.target as Element).closest?.('.selection-popup')) close();
    };
    // XUL browser width changes do not reliably notify ResizeObserver.
    const layoutTimer = win.setInterval(place, 200);
    const bridge: TranslationBridge = {
      subscribe: listener => controller.subscribe(listener), translate: () => controller.translate(),
      stop: () => controller.stop(), close,
      copy: text => Components.classes['@mozilla.org/widget/clipboardhelper;1'].getService(Components.interfaces.nsIClipboardHelper).copyString(text),
      setAutoTranslate: value => controller.setAutoTranslate(value),
      ask: async () => { close(); await this.ask(reader, quote); },
      openSettings: () => { close(); Zotero.Utilities.Internal.openPreferences('paperlens-settings'); },
      move: (dx, dy) => { x += dx; y += dy; place(); },
    };
    const ready = () => {
      if (closed || unmount || !frame.contentWindow?.PaperLensUI) return;
      unmount = frame.contentWindow.PaperLensUI.mountTranslation(bridge);
      void controller.init().then(() => { if (!closed) return controller.translate(); }).catch(error => Zotero.logError(error));
    };
    frame.addEventListener('load', ready); frame.addEventListener('paperlens-ui-ready', ready);
    frame.src = this.url;
    const rect = anchor.closest('.selection-popup')?.getBoundingClientRect() || anchor.getBoundingClientRect();
    const hostRect = hostFrame.getBoundingClientRect();
    x = hostRect.left + rect.left; y = hostRect.top + rect.bottom + 8;
    if (y + 312 > win.innerHeight - 12) y = hostRect.top + rect.top - 320;
    (doc.body || doc.documentElement).append(panel); place();
    if (closed) return;
    for (const viewDoc of viewDocs) {
      if (!keepOpen) viewDoc.addEventListener('pointerdown', outside, true);
      viewDoc.addEventListener('keydown', escape, true);
      if (!keepOpen) viewDoc.addEventListener('scroll', scrolled, true);
      viewDoc.defaultView?.addEventListener('unload', close, { once: true });
    }
    win.addEventListener('resize', place); win.addEventListener('unload', close, { once: true });
    this.entries.set(reader, { quote, show: () => { place(); frame.contentWindow?.focus(); }, close });
  }

  close(reader: any) { this.cancelPending(reader); this.entries.get(reader)?.close(); }
  dispose() {
    for (const reader of this.pending.keys()) this.cancelPending(reader);
    for (const entry of this.entries.values()) entry.close();
  }
}
