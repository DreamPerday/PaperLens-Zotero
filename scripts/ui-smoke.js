// Run after native-smoke.js through the isolated development harness.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const entry = [...Zotero.PaperLens.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js first.');
const c = entry.controller, doc = entry.frame.contentDocument;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 100; i++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
await c.bridge.newConversation();
c.bridge.setTask('close');
await wait(() => doc.querySelector('.annotation-callout'), 'Full document annotation action missing');
assert(!doc.querySelector('.annotation-callout button').disabled, 'Annotation requires a quote');
c.bridge.setTask('chat');
await wait(() => doc.querySelector('nav button[aria-current]')?.textContent === '问答', 'Chat tab did not activate');
assert(!doc.querySelector('.error'), 'Chat shows an error without a quote');
const slash = String.fromCharCode(92);
const newline = String.fromCharCode(10);
const fence = String.fromCharCode(96).repeat(3);
c.session.messages = [{
  id: 'render-check', role: 'assistant', task: 'chat', status: 'complete',
  content: [
    '### 数学与 Markdown', '', '行内 $x^2$。', '',
    '$$' + slash + 'sum_{i=1}^{n} i = ' + slash + 'frac{n(n+1)}{2}$$', '',
    slash + '[' + slash + 'begin{pmatrix}a&b' + slash + slash + 'c&d' + slash + 'end{pmatrix}' + slash + ']', '',
    '| 方法 | 结果 |', '| --- | --- |', '| A | 通过 |', '', fence + 'python', 'print(1)', fence
  ].join(newline),
  createdAt: new Date().toISOString(), sourceVersion: c.source.version, sourceIds: ['b6']
}];
c.emit();
await wait(() => doc.querySelectorAll('.katex-display').length === 2, 'Display formulas failed to render');
assert(doc.querySelectorAll('.katex').length === 3, 'Inline or matrix formula missing');
assert(!doc.querySelector('.katex-error'), 'Math contains a KaTeX error');
assert(doc.querySelector('.answer table') && doc.querySelector('.answer pre code'), 'Markdown table or code block missing');
assert(doc.querySelector('link[href="katex.min.css"]'), 'KaTeX stylesheet missing');
const originalModel = c.settings.model;
await c.bridge.refreshModels();
await wait(() => doc.querySelectorAll('.model-switcher option').length >= 3, 'Model menu failed to update');
await c.bridge.setModel('paperlens-slow');
await wait(() => doc.querySelector('.model-switcher strong')?.textContent === 'paperlens-slow', 'Quick model switch failed');
await c.bridge.setModel(originalModel);
return { passed: ['annotation without selection', 'chat without selection', 'inline formula', 'display formula', 'matrix formula', 'GFM table', 'code block', 'KaTeX stylesheet', 'model refresh', 'quick model switch'] };
