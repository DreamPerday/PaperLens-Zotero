// Verify selected-text translation in a separate native PDF reader window.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) throw new Error('Use isolated profile.');
const plugin = Zotero.PaperLens;
const original = [...plugin.views.values()].find(view => view.controller.source && view.controller.reader.tabID);
if (!original) throw new Error('Run native-smoke.js first.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => { for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); } throw new Error(message); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const saved = await plugin.storage.getSettings();
await plugin.storage.saveSettings({ ...saved, baseURL: 'http://127.0.0.1:18791', model: 'paperlens-fixture', autoTranslate: true });
let reader;
try {
  await Zotero.Reader.open(original.controller.item.id, undefined, { openInWindow: true, allowDuplicate: true });
  await wait(() => reader = Zotero.Reader._readers.find(candidate => !candidate.tabID && candidate.itemID === original.controller.item.id), 'Separate reader did not open');
  await reader._initPromise;
  await plugin.show(reader);
  let entry;
  await wait(() => { entry = [...plugin.views.values()].find(candidate => candidate.controller.reader === reader); return entry?.controller.source; }, 'Separate sidebar did not load');
  const focus = entry.controller.source.blocks.find(block => block.text.startsWith('To isolate'));
  const view = reader._internalReader._primaryView;
  await wait(() => view._iframeWindow?.PDFViewerApplication?.pdfViewer?.getPageView(0)?.viewport, 'Separate PDF page did not become ready');
  const hostDoc = reader._iframe.ownerDocument;
  const select = async () => {
    view._setSelectionRanges(Components.utils.cloneInto([], reader._iframeWindow));
    await pause(100);
    view._setSelectionRanges(Components.utils.cloneInto([{ pageIndex: 0, position: focus.location, text: focus.text,
      sortIndex: '00000|000000|00000', anchorOffset: 0, headOffset: 20 }], reader._iframeWindow));
  };
  const popup = () => hostDoc.querySelector('.paperlens-translation-popup');
  const ui = () => popup()?.querySelector('iframe')?.contentDocument;
  await select();
  await wait(() => ui()?.querySelector('.translation-answer strong'), 'Separate window did not translate');
  assert(ui().querySelector('.translation-original p').textContent === focus.text, 'Separate window has the wrong quote');
  assert(!original.frame.ownerDocument.querySelector('.paperlens-translation-popup'), 'Window translation appeared in the main window');
  const rect = popup().getBoundingClientRect(), bounds = reader._iframe.getBoundingClientRect();
  assert(rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom, 'Window popup escapes PDF reader bounds');
  ui().querySelector('.translation-original summary').click();
  await pause(50);
  assert(ui().querySelector('.translation-body').scrollHeight > ui().querySelector('.translation-body').clientHeight, 'Long translation does not scroll');
  view._iframeWindow.document.getElementById('viewerContainer').dispatchEvent(new view._iframeWindow.Event('scroll', { bubbles: true }));
  await wait(() => !popup(), 'PDF scrolling does not close translation');
  await select();
  await wait(() => popup(), 'Translation did not reopen');
  reader.close();
  await wait(() => ![...plugin.views.values()].some(candidate => candidate.controller.reader === reader), 'Closing reader did not clean sidebar');
  assert(!hostDoc.querySelector('.paperlens-translation-popup'), 'Closing reader left a detached popup');
  return { passed: ['standalone PDF window', 'correct quote', 'window isolation', 'PDF viewport bounds', 'long text scrolls', 'PDF scroll dismissal', 'window cleanup'] };
} finally {
  if (reader?._window && !reader._window.closed) reader.close();
  await plugin.storage.saveSettings(saved);
}
