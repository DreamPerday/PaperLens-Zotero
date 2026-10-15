import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, chunkBlocks, groupSummaries, selectContext } from '../src/reading/context';
import type { Block, Source } from '../src/types';

const blocks: Block[] = Array.from({ length: 30 }, (_, i) => ({ id: `b${i+1}`, text: (`Paragraph ${i+1}: ` + (i === 20 ? 'retrieval evidence ' : 'other methods ')).repeat(30), section: 'Methods', kind: 'paragraph', pageLabel: `${Math.floor(i/3)+1}`, location: { pageIndex: Math.floor(i/3) } }));
test('focused passage and neighbours take priority under the context budget', () => {
  const quote = { text: blocks[20].text, pageLabel: blocks[20].pageLabel, location: blocks[20].location, blockIds: ['b21'] };
  const context = selectContext(blocks, 'retrieval', quote, [], 3000);
  assert.ok(context.blocks.some(b => b.id === 'b21'));
  assert.ok(context.blocks.some(b => b.id === 'b20'));
  assert.ok(context.blocks.reduce((n,b) => n+b.text.length, 0) <= 3000);
  assert.equal(context.complete, false);
});
test('long document chunking covers every paragraph exactly once', () => {
  const chunks = chunkBlocks(blocks, 3000);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat().map(b => b.id), blocks.map(b => b.id));
});
test('prompt labels partial context and only offers available source IDs', () => {
  const source: Source = { identity: '1_TEST', version: 'v1', itemID: 1, title: 'Synthetic paper', blocks, pageCount: 10 };
  const request = buildMessages(source, [], 'Explain retrieval', undefined, 'chat', 'deep', 2000);
  assert.match(request.range, /相关节选/);
  assert.match(request.messages[0].content, /不能编造来源编号/);
  const offered = [...request.messages[0].content.matchAll(/\[(b\d+) \|/g)].map(m => m[1]);
  assert.deepEqual(offered, request.blocks.map(b => b.id));
});
test('annotation prompt supports a full document without a selected quote', () => {
  const source: Source = { identity: '1_TEST', version: 'v1', itemID: 1, title: 'Synthetic paper', blocks: blocks.slice(0, 2), pageCount: 1 };
  const request = buildMessages(source, [], '请生成全文注解', undefined, 'close', 'standard', 20000);
  assert.match(request.messages[0].content, /全文段落级注解/);
  assert.match(request.messages[0].content, /关键术语或公式/);
  assert.match(request.messages.at(-1)?.content || '', /全文注解/);
});
test('oversized paragraph keeps the selected sentence and is labeled as an excerpt', () => {
  const text = 'Before. '.repeat(500) + 'The selected claim.' + ' After.'.repeat(500);
  const large = { ...blocks[0], text };
  const quote = { text: 'The selected claim.', pageLabel: '1', location: large.location, blockIds: [large.id] };
  const selected = selectContext([large], 'Explain the claim', quote, [], 500);
  assert.equal(selected.complete, false);
  assert.ok(selected.blocks[0].text.includes(quote.text));
  assert.equal(selected.blocks[0].excerpt, true);
  assert.ok(selected.blocks[0].text.length <= 500);
  const chunks = chunkBlocks([large], 500);
  assert.equal(chunks.flat().map(b => b.text).join(''), text);
  assert.ok(chunks.every(group => group.reduce((n, b) => n + b.text.length, 0) <= 500));
});
test('summary batches retain all content while bounding each consolidation request', () => {
  const summaries = ['a'.repeat(1100), 'b'.repeat(300), 'c'.repeat(450)];
  const groups = groupSummaries(summaries, 500);
  assert.ok(groups.every(group => group.length <= 500));
  assert.equal(groups.join('').replace(/\n/g, ''), summaries.join(''));
});
