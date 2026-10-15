// Synthetic annotations and PDF scrolling, isolated from the personal library.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const entry = [...Zotero.PaperLens.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js first.');
const c = entry.controller, doc = entry.frame.contentDocument;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 120; i++) { if (check()) return; await pause(50); }
  const output = doc.querySelector('.output');
  throw new Error(message + ' ' + JSON.stringify({ active: [c.state.activeSourceID, c.state.activeMessageID], pdfTop: c.reader._internalReader._lastView._iframeWindow.document.getElementById('viewerContainer').scrollTop, outputTop: output?.scrollTop, outputHeight: output?.clientHeight, target: doc.querySelector('.source-active')?.getBoundingClientRect(), bounds: output?.getBoundingClientRect() }));
};
const view = c.reader._internalReader._lastView;
const pdf = view._iframeWindow.PDFViewerApplication.pdfViewer;
const container = view._iframeWindow.document.getElementById('viewerContainer');
const oldScale = pdf.currentScaleValue, oldScroll = { top: container.scrollTop, left: container.scrollLeft };
const oldMessages = c.session.messages, oldTask = c.state.task;
const newline = String.fromCharCode(10);
const scrollToBlock = id => {
  const block = c.source.blocks.find(block => block.id === id);
  const rect = view.getPositionBoundingViewRect(Components.utils.cloneInto(block.location, c.reader._iframeWindow));
  container.scrollTop = (rect[1] + rect[3]) / 2 - container.clientHeight / 2;
  container.scrollLeft = (rect[0] + rect[2]) / 2 - container.clientWidth / 2;
};
const activeVisible = id => {
  const target = doc.querySelector('.citation.source-active[data-source-id="' + id + '"]');
  const bounds = doc.querySelector('.output')?.getBoundingClientRect(), rect = target?.getBoundingClientRect();
  return Boolean(rect && bounds && rect.top >= bounds.top && rect.bottom <= bounds.bottom);
};
try {
  c.bridge.removeQuote();
  c.bridge.setTask('close');
  c.session.messages = [{
    id: 'annotation-follow-check', role: 'assistant', task: 'close', status: 'complete',
    content: c.source.blocks.map(block => [
      '### [第' + block.pageLabel + '页 · ' + block.id + '](#source-' + block.id + ')', '',
      ('Paragraph annotation for ' + block.id + '. ').repeat(35), ''
    ].join(newline)).join(newline),
    sourceIds: c.source.blocks.map(block => block.id), sourceVersion: c.source.version,
    createdAt: new Date().toISOString()
  }];
  c.emit();
  pdf.currentScaleValue = '1.6';
  await pause(500);
  await wait(() => doc.querySelector('.annotation-follow'), 'Follow control missing');
  scrollToBlock('b6');
  await wait(() => c.state.activeSourceID === 'b6' && activeVisible('b6'), 'Annotation did not follow physical scrolling to b6');
  const firstScroll = doc.querySelector('.output').scrollTop;
  scrollToBlock('b11');
  await wait(() => c.state.activeSourceID === 'b11' && activeVisible('b11'), 'Annotation did not follow physical scrolling to b11');
  assert(doc.querySelector('.output').scrollTop > firstScroll, 'Annotation panel did not actually scroll');

  doc.querySelector('.annotation-follow').click();
  await wait(() => doc.querySelector('.annotation-follow').getAttribute('aria-pressed') === 'false', 'Pause did not activate');
  await pause(400);
  const pausedScroll = doc.querySelector('.output').scrollTop;
  scrollToBlock('b6');
  await wait(() => c.state.activeSourceID === 'b6', 'PDF position did not update while paused');
  await pause(400);
  assert(Math.abs(doc.querySelector('.output').scrollTop - pausedScroll) < 2, 'Paused annotations moved');
  doc.querySelector('.annotation-follow').click();
  await wait(() => activeVisible('b6'), 'Resuming did not reveal the current annotation');

  await c.bridge.navigate('b14', 'annotation-follow-check');
  await pause(800);
  assert(c.state.activeSourceID === 'b14' && activeVisible('b14'), 'Clicking a citation lost its target to polling');

  // A newer selection-only annotation must not hide full-text annotations elsewhere.
  c.session.messages.push({ ...c.session.messages[0], id: 'selection-only', content: '[Selected](#source-b6)', sourceIds: ['b6'] });
  c.emit();
  scrollToBlock('b11');
  await wait(() => c.state.activeSourceID === 'b11' && c.state.activeMessageID === 'annotation-follow-check', 'A selection annotation hid earlier full-text annotations');
  return { passed: ['physical PDF scrolling', 'annotation scroll position', 'source highlight', 'pause follow', 'resume follow', 'citation target retained', 'multiple annotation ranges'], sources: ['b6', 'b11', 'b14'] };
} finally {
  pdf.currentScaleValue = oldScale;
  await pause(300);
  container.scrollTop = oldScroll.top;
  container.scrollLeft = oldScroll.left;
  c.session.messages = oldMessages;
  c.bridge.setTask(oldTask);
  c.emit();
}
