import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateBlock } from '../src/reading/position';
import type { Block } from '../src/types';

const blocks: Block[] = [
  { id: 'b1', text: 'first', section: '', kind: 'paragraph', pageLabel: '1', location: { pageIndex: 0, rects: [[0, 0, 500, 90]] } },
  { id: 'b2', text: 'second', section: '', kind: 'paragraph', pageLabel: '1', location: { pageIndex: 0, rects: [[0, 110, 500, 210]] } },
  { id: 'b3', text: 'third', section: '', kind: 'paragraph', pageLabel: '2', location: { pageIndex: 1, rects: [[0, 0, 500, 90]] } },
];

test('locates the nearest source block on the visible page', () => {
  assert.equal(locateBlock(blocks, { pageIndex: 0, x: 250, y: 160 })?.id, 'b2');
  assert.equal(locateBlock(blocks, { pageIndex: 1, x: 250, y: 40 })?.id, 'b3');
});

test('falls back to the first block when a page has no coordinates', () => {
  const pageBlocks = blocks.slice(0, 2).map(block => ({ ...block, location: { pageIndex: 0 } }));
  assert.equal(locateBlock(pageBlocks, { pageIndex: 0, x: 250, y: 160 })?.id, 'b1');
});
test('keeps a paragraph linked on the continuation page', () => {
  const continued: Block = { ...blocks[0], locations: [
    blocks[0].location, { pageIndex: 1, rects: [[0, 120, 500, 220]] },
  ] };
  assert.equal(locateBlock([continued, blocks[2]], { pageIndex: 1, x: 250, y: 170 })?.id, 'b1');
});

test('uses horizontal position to distinguish columns', () => {
  const right: Block = { ...blocks[0], id: 'right', location: { pageIndex: 0, rects: [[320, 0, 550, 90]] } };
  const left: Block = { ...blocks[0], location: { pageIndex: 0, rects: [[40, 0, 270, 90]] } };
  assert.equal(locateBlock([left, right], { pageIndex: 0, x: 430, y: 45 })?.id, 'right');
});

test('does not jump to another page when the current page has no source text', () => {
  assert.equal(locateBlock(blocks, { pageIndex: 5, x: 250, y: 160 }), undefined);
});
