// Resize Zotero's actual context pane while leaving the iframe at its production width.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const entry = [...Zotero.PaperLens.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js first.');
const frame = entry.frame, doc = frame.contentDocument, outerDoc = frame.ownerDocument;
const pane = outerDoc.getElementById('zotero-context-pane');
if (!pane) throw new Error('Open the tabbed PDF reader for this check.');
if (frame.style.width !== '100%') throw new Error('The iframe has a fixed test width instead of its production width.');
const originalStyle = pane.getAttribute('style');
const originalWidth = pane.getAttribute('width');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const sizes = [];
try {
  if (!doc.querySelector('.model-menu')) doc.querySelector('.model-trigger').click();
  await pause(100);
  for (const width of [360, 400, 460, 540, 620, 700, 620, 540, 460, 400, 360]) {
    pane.style.width = width + 'px';
    pane.setAttribute('width', String(width));
    await pause(80);
    const parentWidth = frame.parentElement.clientWidth;
    const viewport = doc.documentElement.clientWidth;
    const menu = doc.querySelector('.model-menu').getBoundingClientRect();
    assert(Math.abs(viewport - parentWidth) <= 1, `Iframe ${viewport}px does not follow parent ${parentWidth}px`);
    assert(doc.documentElement.scrollWidth <= viewport, `Reading content overflows at ${viewport}px`);
    assert(menu.left >= 0 && menu.right <= viewport, `Model menu does not follow ${viewport}px viewport`);
    sizes.push({ pane: pane.getBoundingClientRect().width, parent: parentWidth, viewport });
  }
  const viewports = [...new Set(sizes.map(size => size.viewport))];
  assert(viewports.length >= 4, 'Pane resizing did not reach the actual iframe ' + JSON.stringify(sizes));
  assert(Math.max(...viewports) - Math.min(...viewports) >= 70, 'Pane width range was too small ' + JSON.stringify(sizes));
} finally {
  if (originalStyle === null) pane.removeAttribute('style'); else pane.setAttribute('style', originalStyle);
  if (originalWidth === null) pane.removeAttribute('width'); else pane.setAttribute('width', originalWidth);
  if (doc.querySelector('.model-menu')) doc.querySelector('.model-trigger').click();
}
return { sizes, iframeWidth: frame.style.width, restored: true, passed: ['native pane resizing', 'iframe follows parent', 'reading content wraps', 'open model menu resizes', 'pane width restored'] };
