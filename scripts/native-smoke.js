// Run only through the isolated development harness. This creates synthetic
// library items and notes and configures a fake key for the local mock service.
const plugin = Zotero.PaperLens;
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Run this check only in the isolated output/zotero-dev profile.');
}
if (!plugin) throw new Error('PaperLens is not enabled.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
const directory = PathUtils.parent(Zotero.DataDirectory.dir);
const seedPath = PathUtils.join(directory, 'fixture-state.json');
let seed = await IOUtils.exists(seedPath) ? await IOUtils.readJSON(seedPath) : undefined;
let attachment = seed && Zotero.Items.get(seed.itemID);
if (!attachment) {
  const parent = new Zotero.Item('journalArticle');
  parent.libraryID = Zotero.Libraries.userLibraryID;
  parent.setField('title', 'PaperLens Synthetic Reading Test');
  await parent.saveTx();
  attachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(directory, 'synthetic-paper.pdf'), parentItemID: parent.id });
  await IOUtils.writeJSON(seedPath, { parentID: parent.id, itemID: attachment.id });
}
let reader = await Zotero.Reader.open(attachment.id);
if (!reader) {
  await wait(() => Zotero.Reader._readers.some(r => r.itemID === attachment.id), 'Reader did not restore');
  reader = Zotero.Reader._readers.find(r => r.itemID === attachment.id);
}
await reader._initPromise;
await plugin.show(reader);
await wait(() => [...plugin.views.values()].some(v => v.controller.reader === reader && v.controller.source && v.frame.contentDocument?.querySelector('.app')), 'Sidebar did not mount');
const entry = [...plugin.views.values()].find(v => v.controller.reader === reader);
const c = entry.controller, doc = entry.frame.contentDocument;
const settings = { baseURL: 'http://127.0.0.1:18791', apiKey: 'paperlens-test-key', model: 'paperlens-fixture', depth: 'standard', hints: true, contextChars: 32000 };
await c.bridge.saveSettings(settings);
assert((await c.bridge.models(settings)).includes(settings.model), 'Model discovery failed');
assert((await c.bridge.testConnection(settings)).includes('已连接'), 'Connection test failed');
assert(!Zotero.Prefs.get('extensions.paperlens.settings', true).includes(settings.apiKey), 'Key entered plain preferences');
await c.bridge.newConversation();
const focus = c.source.blocks.find(b => b.text.startsWith('To isolate'));
const view = reader._internalReader._primaryView;
view._setSelectionRanges(Components.utils.cloneInto([{ pageIndex: 0, position: focus.location, text: focus.text,
  sortIndex: '00000|000000|00000', anchorOffset: 0, headOffset: 20 }], reader._iframeWindow));
await wait(() => [...reader._iframeWindow.document.querySelectorAll('button')].some(b => b.textContent === '问 PaperLens'), 'Selection action missing');
[...reader._iframeWindow.document.querySelectorAll('button')].find(b => b.textContent === '问 PaperLens').click();
await wait(() => c.state.quote?.text === focus.text, 'Selection action did not carry context');
await c.bridge.send('为什么固定生成模型？');
const answer = c.session.messages.at(-1);
assert(answer.status === 'complete', 'Chat failed: ' + answer.error);
await wait(() => doc.querySelector('.citation'), 'Citation button missing');
const container = view._iframeWindow.document.getElementById('viewerContainer');
const initial = container.scrollTop;
await c.bridge.navigate('b11', answer.id);
await pause(150);
const target = view.getPositionBoundingViewRect(Components.utils.cloneInto(c.source.blocks.find(b => b.id === 'b11').location, reader._iframeWindow));
assert(target[1] >= container.scrollTop && target[3] <= container.scrollTop + container.clientHeight, 'Cited paragraph is not visible');
await c.bridge.returnToReading();
await pause(150);
assert(Math.abs(container.scrollTop - initial) < 3, 'Return did not restore the scroll position');
await c.bridge.saveNote(answer.id);
const note = await Zotero.Items.getAsync(answer.noteID);
assert(note.parentID === attachment.parentID && note.getNote().includes('zotero://open-pdf/'), 'Child note/source link missing');
for (const task of ['close', 'overview', 'verify']) {
  c.bridge.setTask(task);
  await c.bridge.send(task === 'verify' ? '检索总能提升准确性吗？' : '');
  assert(c.session.messages.at(-1).status === 'complete', task + ' failed');
}
c.bridge.setTask('chat');
await c.bridge.saveSettings({ ...settings, model: 'paperlens-slow' });
const sending = c.bridge.send('Explain again');
const duplicate = c.bridge.send('Duplicate request');
await pause(300); c.bridge.stop(); await Promise.all([sending, duplicate]);
assert(c.session.messages.at(-1).status === 'stopped', 'Stop failed');
const count = c.session.messages.length;
await c.bridge.saveSettings(settings);
await c.bridge.retry(c.session.messages.at(-1).id);
assert(c.session.messages.length === count && c.session.messages.at(-1).status === 'complete', 'Retry failed');
const result = { version: Zotero.version, pages: c.source.pageCount, blocks: c.source.blocks.length, noteID: answer.noteID,
  passed: ['sidebar', 'models', 'connection', 'credential storage', 'selection popup', 'streaming chat', 'source navigation', 'return position', 'native note', 'close reading', 'overview', 'verify', 'stop', 'duplicate prevention', 'retry'] };
await IOUtils.writeJSON(PathUtils.join(directory, 'native-smoke-result.json'), result);
return result;
