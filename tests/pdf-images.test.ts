import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfImage } from '../src/reading/pdf-images';
import { MAX_IMAGE_EDGE } from '../src/reading/images';

function readerFixture(rotation = 0) {
  const wrappedPage = { rotate: 0 }; // An awaited Gecko Xray does not expose class methods.
  const renders: any[] = [];
  const canvas = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => 'data:image/png;base64,cGRm' };
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({
      width: (rotation === 90 ? 800 : 500) * scale,
      height: (rotation === 90 ? 500 : 800) * scale,
      convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => rotation === 90
        ? [y1 * scale, x1 * scale, y2 * scale, x2 * scale]
        : [x1 * scale, (800 - y1) * scale, x2 * scale, (800 - y2) * scale],
    }),
    render: (options: unknown) => { renders.push(options); return { promise: Promise.resolve() }; },
  };
  const win = { Object, document: { createElement: () => canvas }, PDFViewerApplication: {
    pdfDocument: { getPage: async (number: number) => { assert.equal(number, 3); return wrappedPage; } },
    pdfViewer: { getPageView: () => ({ viewport: { rotation } }) },
  } };
  (globalThis as any).Components = { utils: {
    waiveXrays: (value: unknown) => { assert.equal(value, wrappedPage); return page; },
    cloneInto: (value: unknown, target: unknown) => { assert.equal(target, win); return structuredClone(value); },
  } };
  (globalThis as any).Zotero = { Utilities: { randomString: () => 'crop' } };
  return { reader: { _internalReader: { _lastView: { _iframeWindow: win } } }, renders };
}

test('PDF capture unwraps the awaited Zotero page before invoking its prototype methods', async t => {
  t.after(() => { delete (globalThis as any).Components; delete (globalThis as any).Zotero; });
  const { reader, renders } = readerFixture();
  const location = { pageIndex: 2, rects: [[100, 200, 260, 320]] };
  const image = await renderPdfImage(reader, location, 'iii');
  assert.deepEqual([image.width, image.height], [480, 360]);
  assert.deepEqual(renders[0].transform, [1, 0, 0, 1, -300, -1440]);
  assert.equal(renders[0].background, 'rgb(255, 255, 255)');
  assert.equal(image.location, location);
  assert.equal(image.pageLabel, 'iii');
  assert.match(image.dataURL, /^data:image\/png;base64,/);
});

test('PDF capture follows the displayed rotation rather than assuming the page is unrotated', async t => {
  t.after(() => { delete (globalThis as any).Components; delete (globalThis as any).Zotero; });
  const { reader, renders } = readerFixture(90);
  const image = await renderPdfImage(reader, { pageIndex: 2, rects: [[100, 200, 260, 320]] });
  assert.deepEqual([image.width, image.height], [360, 480]);
  assert.deepEqual(renders[0].transform, [1, 0, 0, 1, -600, -300]);
});

test('large PDF crops stay within the image size limit and empty crops are not rendered', async t => {
  t.after(() => { delete (globalThis as any).Components; delete (globalThis as any).Zotero; });
  const { reader, renders } = readerFixture();
  const image = await renderPdfImage(reader, { pageIndex: 2, rects: [[0, 0, 500, 800]] });
  assert.ok(image.width <= MAX_IMAGE_EDGE && image.height <= MAX_IMAGE_EDGE);
  assert.ok(image.height >= MAX_IMAGE_EDGE - 2);
  await assert.rejects(renderPdfImage(reader, { pageIndex: 2, rects: [[600, 100, 650, 150]] }), /区域过小/);
  assert.equal(renders.length, 1);
});
