import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, chunkBlocks, groupSummaries, overviewCoverage, overviewEvidence, overviewSynthesisMessages, selectContext, sourceText } from '../src/reading/context';
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

const completePaper: Source = {
  identity: '1_COMPLETE', version: 'v1', itemID: 2, title: 'Complete synthetic paper', pageCount: 5,
  blocks: [
    { ...blocks[0], id: 'b1', text: 'Abstract. We evaluate retrieval under controlled conditions.', section: 'Abstract', pageLabel: '1', location: { pageIndex: 0 } },
    { ...blocks[0], id: 'b2', text: 'The generator and corpus remain fixed. '.repeat(180), section: 'Methods', pageLabel: '2', location: { pageIndex: 1 } },
    { ...blocks[0], id: 'b3', text: 'Evidence coverage increased under the tested conditions.', section: '3. Results', pageLabel: '3', location: { pageIndex: 2 } },
    { ...blocks[0], id: 'b4', text: 'Table 1\nCondition | Coverage\nBaseline | 62%\nRetrieval | 74%', section: '3. Results', kind: 'table', pageLabel: '3', location: { pageIndex: 2 } },
    { ...blocks[0], id: 'b5', text: 'The conclusion is conditional; this does not establish broader accuracy.', section: '4. Conclusion', pageLabel: '4', location: { pageIndex: 3 } },
    { ...blocks[0], id: 'b6', text: 'References. Synthetic citation list. '.repeat(100), section: 'References', pageLabel: '5', location: { pageIndex: 4 } },
  ],
};

test('long-paper overview covers abstract, results, table text and conclusion before references', () => {
  const chunks = chunkBlocks(completePaper.blocks, 4000);
  assert.ok(chunks.length > 1);
  for (const block of completePaper.blocks) {
    assert.equal(chunks.flat().filter(part => part.id === block.id).map(part => part.text).join(''), block.text);
  }
  const coverage = overviewCoverage(completePaper);
  assert.match(coverage, /全部 6 段，文字覆盖 5\/5 页/);
  assert.match(coverage, /摘要：已读取相关文字（第1页）/);
  assert.match(coverage, /实验与结果：已读取相关文字（第3页）/);
  assert.match(coverage, /结论：已读取相关文字（第4页）/);
  assert.match(coverage, /已读取 1 个表格/);

  const evidence = overviewEvidence(completePaper, 1000);
  assert.deepEqual(evidence.map(block => block.id), ['b1', 'b3', 'b4', 'b5']);
  assert.ok(evidence.reduce((n, block) => n + block.text.length, 0) <= 1000);
  const messages = overviewSynthesisMessages(completePaper, '生成概览',
    '正文片段：未覆盖结论。\n参考文献片段：不含方法与结果。', 'deep', evidence);
  assert.match(messages[0].content, /各片段的“未提供”仅描述局部/);
  assert.ok(messages[0].content.includes(coverage));
  assert.match(messages[0].content, /结构化概览/);
  assert.match(messages[0].content, /展开方法假设/);
  assert.match(messages[1].content, /Baseline \| 62%\nRetrieval \| 74%/);
  assert.match(messages[1].content, /\[b5 \| 第4页/);
});

test('single-request overview includes the same coverage record and original table cells', () => {
  const request = buildMessages(completePaper, [], '生成概览', undefined, 'overview', 'standard', 32000);
  assert.match(request.range, /全文/);
  assert.ok(request.messages[0].content.includes(overviewCoverage(completePaper)));
  assert.match(request.messages[0].content, /Baseline \| 62%\nRetrieval \| 74%/);
  assert.match(request.messages[0].content, /The conclusion is conditional/);
});

test('coverage reports pages without extracted text and does not invent missing sections', () => {
  const source = { ...completePaper, blocks: completePaper.blocks.slice(1, 2) };
  assert.match(overviewCoverage(source), /文字覆盖 1\/5 页/);
  assert.match(overviewCoverage(source), /摘要：未识别明确标题/);
  assert.deepEqual(overviewEvidence(source, 1000), []);
});

test('overview evidence budgets include citation headers without crowding out tables or conclusions', () => {
  const source = { ...completePaper, blocks: [
    ...Array.from({ length: 80 }, (_, i) => ({ ...completePaper.blocks[0], id: `abstract${i}`, text: 'A.' })),
    ...completePaper.blocks.slice(1),
  ] };
  const evidence = overviewEvidence(source, 1000);
  assert.ok(sourceText(evidence).length <= 1000);
  assert.ok(evidence.some(block => block.id === 'b4'));
  assert.ok(evidence.some(block => block.id === 'b5'));
});
