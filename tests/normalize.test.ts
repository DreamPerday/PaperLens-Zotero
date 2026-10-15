import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStructured } from '../src/reading/normalize';

test('Zotero SDT pageRects preserve native PDF coordinates and printed page labels', () => {
  const blocks = normalizeStructured({ catalog: { pages: [{ label: 'i' }, { label: '1' }] }, content: [
    { type: 'heading', content: [{ type: 'text', text: 'Methods' }], anchor: { pageRects: [[0, 54, 680, 550, 700]] } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Cross-page paragraph.' }], anchor: { pageRects: [[0, 54, 60, 550, 80], [1, 54, 720, 550, 740]] } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Result on page two.' }], anchor: { pageRects: [[1, 320, 600, 550, 630]] } },
  ] });
  assert.deepEqual(blocks.map(b => b.id), ['b1', 'b2', 'b3']);
  assert.equal(blocks[1].locations?.length, 2);
  assert.equal(blocks[1].pageLabel, 'i');
  assert.equal(blocks[2].pageLabel, '1');
  assert.equal(blocks[2].section, 'Methods');
  assert.deepEqual(blocks[2].location, { pageIndex: 1, rects: [[320, 600, 550, 630]] });
});
test('an empty document stays empty rather than inventing OCR text', () => {
  assert.deepEqual(normalizeStructured({ content: [] }), []);
});
