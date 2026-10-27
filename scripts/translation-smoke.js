// Run through the isolated Zotero harness, after opening the synthetic paper.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) throw new Error('Use the isolated development profile.');
const plugin = Zotero.PaperLens;
const entry = [...plugin.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js first to open the synthetic paper.');
const c = entry.controller, reader = c.reader;
const view = reader._internalReader._primaryView, doc = reader._iframeWindow.document;
const hostDoc = reader._iframe.ownerDocument;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
const focus = c.source.blocks.find(block => block.text.startsWith('To isolate'));
const other = c.source.blocks.find(block => block.id !== focus.id && block.location.pageIndex === 0 && block.text.length > 70);
const requests = [];
const stream = plugin.ai.stream;
plugin.ai.stream = function(settings, messages, onText, signal) {
  if (messages[0].content.includes('学术翻译助手')) requests.push({ model: settings.model, text: messages.at(-1).content, signal });
  return stream.call(this, settings, messages, onText, signal);
};
const savedSettings = await plugin.storage.getSettings();
const settings = { ...savedSettings, baseURL: 'http://127.0.0.1:18791', model: 'paperlens-fixture', autoTranslate: true };
const popup = () => hostDoc.querySelector('.paperlens-translation-popup');
const ui = () => popup()?.querySelector('iframe')?.contentDocument;
const close = async () => { ui()?.querySelector('.translation-close')?.click(); await wait(() => !popup(), 'Popup did not close'); };
const select = async block => {
  view._setSelectionRanges(Components.utils.cloneInto([], reader._iframeWindow));
  await wait(() => ![...doc.querySelectorAll('.selection-popup button')].some(button => button.textContent === '翻译'), 'Old selection did not clear');
  view._setSelectionRanges(Components.utils.cloneInto([{ pageIndex: block.location.pageIndex, position: block.location, text: block.text,
    sortIndex: '00000|000000|00000', anchorOffset: 0, headOffset: 20 }], reader._iframeWindow));
  await wait(() => [...doc.querySelectorAll('.selection-popup button')].some(button => button.textContent === '翻译'), 'Translation action is missing');
};
const complete = async () => {
  await wait(() => ui()?.querySelector('.translation-answer strong')?.textContent === '12%' && !ui()?.querySelector('.translation-progress'), 'Translation did not complete');
};
try {
  await c.bridge.saveSettings(settings);
  const count = c.session.messages.length;
  await select(focus); await complete();
  assert(requests.length === 1, 'Automatic selection makes duplicate requests');
  assert(requests[0].text.endsWith(focus.text), 'Translation uses the wrong selected text');
  assert(ui().querySelectorAll('.katex').length === 2 && !ui().querySelector('.katex-error'), 'Translation formula rendering failed');
  assert(c.session.messages.length === count, 'Translation polluted the paper conversation');
  const rect = popup().getBoundingClientRect();
  assert(rect.left >= 0 && rect.right <= hostDoc.defaultView.innerWidth && rect.top >= 0 && rect.bottom <= hostDoc.defaultView.innerHeight, 'Popup is outside the reader');
  const frame = popup().querySelector('iframe');
  for (const width of [260, 320, 380]) {
    frame.style.width = width + 'px'; await pause(80);
    assert(ui().documentElement.scrollWidth <= ui().documentElement.clientWidth, 'Translation has horizontal overflow at ' + width);
  }
  frame.style.width = '100%';
  const pane = hostDoc.getElementById('zotero-context-pane');
  const paneStyle = pane.getAttribute('style'), paneWidth = pane.getAttribute('width');
  try {
    for (const width of [400, 700, 400]) {
      pane.style.width = width + 'px'; pane.setAttribute('width', String(width)); await pause(100);
      await wait(() => {
        const moved = popup()?.getBoundingClientRect(), bounds = reader._iframe.getBoundingClientRect();
        return moved && moved.left >= bounds.left && moved.right <= bounds.right;
      }, 'Popup did not reposition after reader resize');
      const moved = popup().getBoundingClientRect(), bounds = reader._iframe.getBoundingClientRect();
      assert(moved.left >= bounds.left && moved.right <= bounds.right, 'Popup ignores reader resize: ' + JSON.stringify({ width, popup: { left: moved.left, right: moved.right }, reader: { left: bounds.left, right: bounds.right } }));
    }
  } finally {
    if (paneStyle === null) pane.removeAttribute('style'); else pane.setAttribute('style', paneStyle);
    if (paneWidth === null) pane.removeAttribute('width'); else pane.setAttribute('width', paneWidth);
  }
  ui().querySelector('.translation-footer input').click();
  await wait(() => ui().querySelector('.translation-footer input').checked === false, 'Auto preference did not update');
  assert((await plugin.storage.getSettings()).autoTranslate === false, 'Auto preference was not saved');
  await close(); await select(other); await pause(700);
  assert(!popup() && requests.length === 1, 'Disabled automatic translation still calls AI');
  [...doc.querySelectorAll('.selection-popup button')].find(button => button.textContent === '翻译').click();
  await complete();
  assert(requests.length === 2, 'Manual translation did not start exactly once');
  ui().querySelector('.translation-footer input').click();
  await wait(() => ui().querySelector('.translation-footer input').checked, 'Auto translation did not re-enable');
  await close();
  await c.bridge.saveSettings({ ...settings, model: 'paperlens-slow' });
  await select(focus);
  await wait(() => ui()?.querySelector('.translation-answer')?.textContent.length > 0, 'Streaming translation did not start');
  ui().querySelector('.translation-stop').click();
  await wait(() => ui()?.querySelector('.translation-progress')?.textContent.includes('已停止'), 'Stop does not preserve a stopped state');
  assert(requests.at(-1).signal.aborted, 'Stop did not cancel the upstream request');
  assert(ui().querySelector('.translation-answer').textContent.length > 0, 'Stop discarded the partial translation');
  [...ui().querySelectorAll('button')].find(button => button.textContent === '重试').click();
  await wait(() => ui()?.querySelector('.translation-stop'), 'Retry did not restart translation');
  await select(other);
  await wait(() => ui()?.querySelector('.translation-original p')?.textContent === other.text, 'New selection displays an old translation');
  assert(requests.at(-1).signal.aborted || requests.at(-1).text.endsWith(other.text), 'Changing selection did not cancel the previous request');
  await complete();
  [...ui().querySelectorAll('button')].find(button => button.textContent.includes('在侧栏追问')).click();
  await wait(() => !popup() && c.state.quote?.text === other.text, 'Follow-up did not carry the selected passage to the sidebar');
  assert(c.session.messages.length === count, 'Follow-up sent a question without user input');
  await c.bridge.saveSettings({ ...settings, model: '' });
  const previousRequests = requests.length;
  await select(focus);
  await wait(() => ui()?.querySelector('.translation-setup'), 'Missing connection state did not offer setup');
  assert(requests.length === previousRequests, 'Missing model still calls AI');
  await close();
  await c.bridge.saveSettings(settings);
  await select(other); await complete();
  ui().querySelector('.translation').dispatchEvent(new (ui().defaultView.KeyboardEvent)('keydown', { key: 'Escape', bubbles: true }));
  await wait(() => !popup(), 'Escape did not close the popup');
  return { version: plugin.info.version, translationRequests: requests.length,
    passed: ['automatic popup', 'dedicated selected text', 'Markdown and equations', 'reader bounds', '260/320/380px layout', 'reader resizes with native pane', 'conversation unchanged', 'persistent auto toggle', 'manual action', 'streaming', 'stop and retry', 'replace selection', 'follow-up with context', 'missing AI setup', 'Escape close'] };
} finally {
  plugin.ai.stream = stream;
  if (popup()) ui()?.querySelector('.translation-close')?.click();
  await c.bridge.saveSettings(savedSettings);
}
