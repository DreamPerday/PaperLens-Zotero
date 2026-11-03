export const CAPTURE_SHORTCUT = 'Alt+A';

export function isCaptureShortcut(event: KeyboardEvent) {
  return event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && !event.isComposing
    && !event.getModifierState('AltGraph') && event.key.toLowerCase() === 'a';
}

/** Keyboard events do not bubble out of PDF/sidebar iframes. Bind each document. */
export function registerCaptureShortcut(root: Document, options: {
  enabled(): boolean; capture(): Promise<void>; onError(error: unknown): void;
}) {
  const documents = new Set<Document>();
  const capture = { capture: true };
  let running = false;
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !isCaptureShortcut(event) || !options.enabled()) return;
    event.preventDefault(); event.stopPropagation();
    if (running) return;
    running = true;
    void options.capture().catch(options.onError).finally(() => { running = false; });
  };
  const load = (event: Event) => {
    const name = (event.target as Element).localName;
    if (name === 'iframe' || name === 'browser') sync();
  };
  const detach = (doc: Document) => {
    doc.removeEventListener('keydown', keydown, capture);
    doc.removeEventListener('load', load, capture);
  };
  function sync() {
    const current = new Set<Document>();
    const visit = (doc: Document) => {
      current.add(doc);
      for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe, browser')) {
        if (frame.contentDocument) visit(frame.contentDocument);
      }
    };
    visit(root);
    for (const doc of documents) if (!current.has(doc)) { detach(doc); documents.delete(doc); }
    for (const doc of current) if (!documents.has(doc)) {
      doc.addEventListener('keydown', keydown, capture);
      doc.addEventListener('load', load, capture);
      documents.add(doc);
    }
  }
  sync();
  return () => { for (const doc of documents) detach(doc); documents.clear(); };
}
