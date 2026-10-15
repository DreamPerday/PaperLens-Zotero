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
    '| 方法 | 结果 |', '| --- | --- |', '| A | 通过 |', '', fence + 'python', 'print(1)', fence, '',
    '**理解时要注意： **这是一段说明。', '', '这是**“最小间隙”**的定义。', '',
    '** 公式 $x_i$ 和 [第1页](#source-b6)： **继续核对。', '',
    fence + 'md', '** 原样保留 ** ' + slash + '(x' + slash + ')', fence
  ].join(newline),
  createdAt: new Date().toISOString(), sourceVersion: c.source.version, sourceIds: ['b6']
}];
c.emit();
await wait(() => doc.querySelectorAll('.katex-display').length === 2, 'Display formulas failed to render');
assert(doc.querySelectorAll('.katex').length === 4, 'Inline, matrix or emphasized formula missing');
assert(!doc.querySelector('.katex-error'), 'Math contains a KaTeX error');
assert(doc.querySelector('.answer table') && doc.querySelector('.answer pre code'), 'Markdown table or code block missing');
assert(doc.querySelector('link[href^="katex.min.css"]'), 'KaTeX stylesheet missing');
assert([...doc.querySelectorAll('.answer strong')].some(node => node.textContent === '理解时要注意：'), 'Whitespace emphasis regression');
assert([...doc.querySelectorAll('.answer strong')].some(node => node.textContent === '“最小间隙”'), 'CJK punctuation emphasis regression');
assert([...doc.querySelectorAll('.answer pre code')].some(node => node.textContent.includes('** 原样保留 ** ' + slash + '(x' + slash + ')')), 'Code example was rewritten');
assert(doc.querySelector('.answer .citation[data-source-id="b6"]'), 'Citation inside emphasis stopped working');
const version = Zotero.PaperLens.info.version;
assert(doc.querySelector(`link[href="ui-${version}.css"]`) && doc.querySelector(`script[src="ui-${version}.js"]`), 'UI assets are not versioned');
const originalModel = c.settings.model;
await c.bridge.refreshModels();
const trigger = () => doc.querySelector('.model-trigger');
const openMenu = async () => { if (!doc.querySelector('.model-menu')) trigger().click(); await wait(() => doc.querySelector('.model-search'), 'Model menu did not open'); };
const key = name => doc.querySelector('.model-search').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: name, bubbles: true }));
const search = value => {
  const input = doc.querySelector('.model-search');
  Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
};
const headerHeight = doc.querySelector('header').getBoundingClientRect().height;
await openMenu();
await wait(() => doc.querySelectorAll('.model-option').length >= 3, 'Model menu failed to update');
assert(doc.defaultView.getComputedStyle(doc.querySelector('.model-menu')).position === 'absolute', 'Model menu styles did not load');
assert(doc.querySelector('header').getBoundingClientRect().height === headerHeight, 'Model menu pushes down the reading area');
key('ArrowDown');
await wait(() => doc.querySelector('.model-search').getAttribute('aria-activedescendant') === 'paperlens-model-option-1', 'Arrow navigation did not move');
key('ArrowUp');
await wait(() => doc.querySelector('.model-search').getAttribute('aria-activedescendant') === 'paperlens-model-option-0', 'Arrow navigation did not return');
search('sLoW');
await wait(() => doc.querySelectorAll('.model-option').length === 1 && doc.querySelector('.model-option').textContent.includes('paperlens-slow'), 'Model search failed');
key('Enter');
await wait(() => doc.querySelector('.model-name')?.textContent === 'paperlens-slow' && !doc.querySelector('.model-menu'), 'Keyboard model switch failed');
assert(doc.activeElement === trigger(), 'Model switch did not restore focus');
await openMenu();
key('Escape');
await wait(() => !doc.querySelector('.model-menu'), 'Escape did not close the menu');
await openMenu();
search('no-such-model');
await wait(() => doc.querySelector('.model-empty')?.textContent.includes('没有匹配'), 'Search empty state missing');
doc.querySelector('.output').dispatchEvent(new doc.defaultView.PointerEvent('pointerdown', { bubbles: true }));
await wait(() => !doc.querySelector('.model-menu'), 'Outside click did not close the menu');
const refreshModels = c.bridge.refreshModels;
try {
  c.bridge.refreshModels = async () => { throw new Error('模拟模型列表连接失败'); };
  await openMenu();
  doc.querySelector('.model-menu-actions button').click();
  await wait(() => doc.querySelector('.model-error')?.textContent.includes('连接失败'), 'Model error state missing');
  assert(doc.querySelectorAll('.model-option').length >= 3, 'Failed refresh discarded usable models');
} finally { c.bridge.refreshModels = refreshModels; }
key('Escape');
await wait(() => !doc.querySelector('.model-menu'), 'Menu did not close before layout check');
const originalWidth = entry.frame.style.width;
const originalModels = [...c.availableModels];
try {
  const longModel = 'paperlens-a-very-long-model-name-for-reading-and-reasoning-version-2026';
  c.availableModels = [...originalModels, longModel, ...Array.from({ length: 30 }, (_, i) => `paperlens-model-${i}`)];
  await c.bridge.setModel(longModel);
  await wait(() => doc.querySelector('.model-name')?.textContent === longModel, 'Long model label did not update');
  for (const width of [260, 320, 480]) {
    entry.frame.style.width = width + 'px';
    await pause(100);
    await openMenu();
    const rect = doc.querySelector('.model-menu').getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= doc.documentElement.clientWidth, `Menu escapes ${width}px sidebar`);
    assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, `Horizontal overflow at ${width}px`);
    assert(trigger().getBoundingClientRect().right <= doc.documentElement.clientWidth, `Model trigger overflows at ${width}px`);
    assert(doc.querySelector('.model-options').scrollHeight > doc.querySelector('.model-options').clientHeight, 'Long model list does not scroll');
    if (width === 260) {
      for (let index = 1; index <= 15; index++) {
        key('ArrowDown');
        await wait(() => doc.querySelector('.model-search').getAttribute('aria-activedescendant') === `paperlens-model-option-${index}`, 'Long list keyboard navigation failed');
      }
      assert(doc.querySelector('.model-options').scrollTop > 0, 'Keyboard highlight is outside the visible model list');
    }
    key('Escape');
    await wait(() => !doc.querySelector('.model-menu'), 'Menu did not close after layout check');
  }
} finally { entry.frame.style.width = originalWidth; c.availableModels = originalModels; }
await c.bridge.setModel('paperlens-slow');
const sending = c.bridge.send('验证回答期间的模型切换状态');
try {
  await wait(() => [...doc.querySelectorAll('.composer-bottom button')].some(button => button.textContent === '停止生成'), 'Slow response did not start');
  await openMenu();
  assert([...doc.querySelectorAll('.model-option')].every(button => button.disabled), 'Model selection remains active while generating');
  assert(doc.querySelector('.model-hint')?.textContent.includes('回答生成中'), 'Busy model hint missing');
} finally { c.bridge.stop(); await sending; }
key('Escape');
await wait(() => !doc.querySelector('.model-menu'), 'Busy menu did not close');
await c.bridge.setModel(originalModel);
return { passed: ['annotation without selection', 'chat without selection', 'inline formula', 'display formula', 'matrix formula', 'GFM table', 'code block', 'KaTeX stylesheet', 'whitespace emphasis', 'CJK emphasis', 'literal code unchanged', 'citation inside emphasis', 'versioned assets', 'model menu styles', 'stable header height', 'model search', 'arrow navigation', 'keyboard model switch and focus', 'Escape close', 'search empty state', 'outside click close', 'model refresh error', 'long names and scrollable list', 'keyboard option stays visible', '260/320/480px sidebar layout', 'busy model switch state'] };
