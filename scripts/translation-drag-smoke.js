// Gecko input-event integration check; this does not inject a Windows mouse.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) throw new Error('Use isolated profile.');
const plugin = Zotero.PaperLens;
const entry = [...plugin.views.values()].find(view => view.controller.source && view.controller.reader.tabID);
if (!entry) throw new Error('Open the synthetic paper with native-smoke.js first.');
const c = entry.controller, reader = c.reader, pdfDoc = reader._iframeWindow.document, hostDoc = reader._iframe.ownerDocument;
const view = reader._internalReader._primaryView;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => { for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); } throw new Error(message); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const previous = await plugin.storage.getSettings();
await c.bridge.saveSettings({ ...previous, autoTranslate: true, providers: previous.providers.map(provider =>
  provider.id === previous.activeProviderId ? { ...provider, baseURL: 'http://127.0.0.1:18791', model: 'paperlens-fixture' } : provider) });
const focus = c.source.blocks.find(block => block.text.startsWith('To isolate'));
view._setSelectionRanges(Components.utils.cloneInto([], reader._iframeWindow));
await pause(100);
view._setSelectionRanges(Components.utils.cloneInto([{ pageIndex: 0, position: focus.location, text: focus.text,
  sortIndex: '00000|000000|00000', anchorOffset: 0, headOffset: 20 }], reader._iframeWindow));
const panel = () => hostDoc.querySelector('.paperlens-translation-popup');
await wait(() => panel()?.querySelector('iframe')?.contentDocument?.querySelector('.translation-answer strong'), 'Translation popup is not ready');
const frame = panel().querySelector('iframe'), doc = frame.contentDocument, win = doc.defaultView;
const header = doc.querySelector('.translation-header');
const bounds = reader._iframe.getBoundingClientRect();
const position = () => { const rect = panel().getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
const start = position();
const input = hostDoc.defaultView.windowUtils;
const origin = frame.getBoundingClientRect();
const events = [];
const record = event => { events.push({ type: event.type, trusted: event.isTrusted, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY }); };
for (const name of ['pointerdown', 'pointermove', 'pointerup', 'gotpointercapture', 'lostpointercapture']) header.addEventListener(name, record);
try {
  input.sendMouseEvent('mousedown', origin.x + 35, origin.y + 18, 0, 1, 0);
  input.sendMouseEvent('mousemove', origin.x + 115, origin.y + 78, 0, 0, 0);
  await pause(100);
  assert(panel(), 'Panel closed during drag');
  const dragged = position();
  input.sendMouseEvent('mouseup', origin.x + 115, origin.y + 78, 0, 1, 0);
  assert(dragged.x !== start.x || dragged.y !== start.y, 'Header drag produced no movement: ' + JSON.stringify(events));
  assert(Math.abs(dragged.x - start.x) >= 20 || Math.abs(dragged.y - start.y) >= 20, 'Drag displacement is too small');
  assert(dragged.x >= bounds.left && dragged.y >= bounds.top && dragged.x + dragged.width <= bounds.right && dragged.y + dragged.height <= bounds.bottom, 'Dragging escaped reader bounds');
  // Verify a released pointer does not keep moving the panel.
  input.sendMouseEvent('mousemove', origin.x + 140, origin.y + 25, 0, 0, 0);
  await pause(50);
  assert(position().x === dragged.x && position().y === dragged.y, 'Panel keeps moving after release');
  const canvas = hostDoc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = hostDoc.defaultView.innerWidth; canvas.height = hostDoc.defaultView.innerHeight;
  canvas.getContext('2d').drawWindow(hostDoc.defaultView, 0, 0, canvas.width, canvas.height, '#ffffff');
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
  const root = PathUtils.parent(PathUtils.parent(PathUtils.parent(Zotero.DataDirectory.dir)));
  await IOUtils.write(PathUtils.join(root, 'output', 'paperlens-translation-0.3.0.png'), bytes);
  return { input: 'Gecko sendMouseEvent (not Windows mouse injection)', start, dragged, events,
    passed: ['header drag moves actual panel', 'reader boundary clamp', 'pointer release stops drag'] };
} catch (error) { throw new Error(String(error) + '\nDrag events: ' + JSON.stringify(events)); }
finally {
  try { input.sendMouseEvent('mouseup', origin.x + 115, origin.y + 78, 0, 1, 0); } catch {}
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'gotpointercapture', 'lostpointercapture']) header.removeEventListener(name, record);
  doc.querySelector('.translation-close')?.click();
  await c.bridge.saveSettings(previous);
}
