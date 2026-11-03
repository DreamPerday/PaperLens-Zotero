import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../src/reading/context';
import { imageDescription, validateImages } from '../src/reading/images';
import { AIClient } from '../src/ai/client';
import { ReaderController } from '../src/controller';
import { normalizeSettings } from '../src/settings';
import { saveNote } from '../src/zotero-adapter';
import type { Storage } from '../src/storage';
import type { ImageAttachment, Message, Source } from '../src/types';

const image: ImageAttachment = { id: 'figure-1', name: '论文截图', width: 640, height: 400,
  dataURL: 'data:image/png;base64,aW1hZ2U=', pageLabel: '3', location: { pageIndex: 2, rects: [[0, 0, 200, 100]] }, sourceVersion: 'v1' };
const source: Source = { identity: '1_PAPER', version: 'v1', title: 'Test paper', itemID: 1, pageCount: 3,
  blocks: [
    { id: 'b1', text: 'Introduction. '.repeat(300), section: 'Introduction', kind: 'paragraph', pageLabel: '1', location: { pageIndex: 0 } },
    { id: 'b2', text: 'Figure 2: Accuracy improves with more evidence.', section: 'Results', kind: 'caption', pageLabel: '3', location: { pageIndex: 2 } },
    { id: 'b3', text: 'We compare three conditions under a fixed budget.', section: 'Results', kind: 'paragraph', pageLabel: '3', location: { pageIndex: 2 } },
  ] };
const user: Message = { id: 'u1', role: 'user', content: '解释此图', images: [image], task: 'chat', status: 'complete', createdAt: '2026-11-03' };
const answer: Message = { id: 'a1', role: 'assistant', content: '初步解读', task: 'chat', status: 'complete', createdAt: '2026-11-03' };

test('PDF image questions prioritize the figure page and provide distinct image and text citations', () => {
  const request = buildMessages(source, [], '解释图中的趋势', undefined, 'chat', 'standard', 220, [image]);
  assert.deepEqual(request.blocks.map(block => block.id), ['b2', 'b3']);
  assert.deepEqual(request.messages.at(-1)?.images, [image]);
  assert.match(request.messages.at(-1)!.content, /第3页.*#image-figure-1/);
  assert.match(request.messages[0].content, /图中直接观察/);
  assert.match(request.range, /1 张图片/);
});

test('follow-up sends the last image even when a long previous answer exhausts the text-history budget', () => {
  const request = buildMessages(source, [user, { ...answer, content: 'x'.repeat(15000) }], '纵轴表示什么？', undefined, 'chat', 'standard', 220);
  assert.deepEqual(request.messages.filter(message => message.images?.length).flatMap(message => message.images!), [image]);
  assert.ok(request.blocks.some(block => block.id === 'b2'));
});

test('new images replace previous visual context and external images are not assigned invented PDF locations', () => {
  const external = { ...image, id: 'uploaded', name: 'example.png', location: undefined, pageLabel: undefined, sourceVersion: undefined };
  const request = buildMessages(source, [user, answer], '两条曲线的差异', undefined, 'chat', 'standard', 1000, [external]);
  assert.deepEqual(request.messages.flatMap(message => message.images || []), [external]);
  assert.match(imageDescription([external]), /未关联 PDF 位置/);
  assert.doesNotMatch(request.messages.at(-1)!.content, /#image-/);
});

test('old PDF pictures and unrelated reading tasks do not resend stale visual data', () => {
  const updated = { ...source, version: 'v2' };
  assert.ok(buildMessages(updated, [user, answer], '解释这张图', undefined, 'chat', 'standard', 1000)
    .messages.every(message => !message.images?.length));
  assert.ok(buildMessages(source, [user, answer], '生成概览', undefined, 'overview', 'standard', 1000)
    .messages.every(message => !message.images?.length));
});

test('multimodal requests contain user image_url parts and keep text-only requests compatible', async () => {
  const requests: any[] = [];
  const ai = new AIClient((async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
  }) as typeof fetch);
  const settings = { baseURL: 'https://relay.example/v1', apiKey: '', model: 'vision-model' };
  await ai.stream(settings, [{ role: 'system', content: 'read' }, { role: 'user', content: 'Explain', images: [image] }], () => {});
  assert.deepEqual(requests[0].messages, [
    { role: 'system', content: 'read' },
    { role: 'user', content: [{ type: 'text', text: 'Explain' }, { type: 'image_url', image_url: { url: image.dataURL } }] },
  ]);
  await ai.stream(settings, [{ role: 'user', content: 'Text only' }], () => {});
  assert.deepEqual(requests[1].messages, [{ role: 'user', content: 'Text only' }]);
});

test('image count and format errors give actionable feedback', () => {
  assert.throws(() => validateImages(Array(5).fill(image)), /最多.*4/);
  assert.throws(() => validateImages([{ ...image, dataURL: 'https://example.com/image.png' }]), /图片格式/);
  validateImages([image]);
});

test('image-only send, failed request, model switch, retry and follow-up retain the actual image', async () => {
  let serial = 0;
  (globalThis as any).Zotero = { Utilities: { randomString: () => String(++serial) } };
  let settings = normalizeSettings({ baseURL: 'https://relay.example/v1', model: 'text-model' });
  const snapshots: string[] = [];
  const storage = {
    getSettings: async () => structuredClone(settings),
    saveSettings: async (value: typeof settings) => { settings = structuredClone(value); },
    saveSession: async (value: unknown) => { snapshots.push(JSON.stringify(value)); },
  } as unknown as Storage;
  const requests: any[] = [];
  const ai = new AIClient((async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)); requests.push(request);
    return request.model === 'text-model' ? Response.json({ error: { message: 'image input is not supported' } }, { status: 400 })
      : Response.json({ choices: [{ message: { content: '图中结果 [图片 1](#image-figure-1)' }, finish_reason: 'stop' }] });
  }) as typeof fetch);
  const controller = new ReaderController({ defaultView: { AbortController } } as unknown as Document, storage, ai, () => {});
  controller.source = source; controller.item = { attachmentHash: Promise.resolve('v1') };
  controller.session = { identity: source.identity, messages: [], draft: '', task: 'chat' };
  controller.state.identity = source.identity;
  try {
    await controller.bridge.addImages([image]);
    await controller.bridge.send('');
    assert.equal(controller.session.images?.length, 0);
    assert.deepEqual(controller.session.messages[0].images, [image]);
    assert.equal(controller.session.messages.at(-1)!.status, 'error');
    assert.match(controller.session.messages.at(-1)!.error!, /模型支持图片输入/);
    await controller.bridge.setModel('vision-model');
    await controller.bridge.retry(controller.session.messages.at(-1)!.id);
    assert.equal(controller.session.messages.length, 2);
    assert.equal(controller.session.messages.at(-1)!.status, 'complete');
    assert.deepEqual(requests[0].messages.at(-1).content, requests[1].messages.at(-1).content);
    await controller.bridge.send('蓝色曲线意味着什么？');
    assert.ok(requests[2].messages.some((message: any) => Array.isArray(message.content) && message.content.some((part: any) => part.image_url?.url === image.dataURL)));
    assert.ok(snapshots.some(snapshot => JSON.parse(snapshot).messages[0]?.images[0]?.dataURL === image.dataURL));
  } finally { await controller.dispose(); delete (globalThis as any).Zotero; }
});

test('image citations navigate to the saved PDF region and return to the previous reading position', async () => {
  const destinations: any[] = [];
  (globalThis as any).Components = { utils: { cloneInto: (value: unknown) => value } };
  const storage = { saveSession: async () => {} } as unknown as Storage;
  const controller = new ReaderController({ defaultView: { AbortController } } as unknown as Document, storage, new AIClient(), () => {});
  const viewer = { _getVisiblePages: () => ({ first: { id: 1, x: 0, y: 0, view: { getPagePoint: () => [10, 20] } } }), currentScale: 1 };
  controller.reader = { _iframeWindow: {}, _internalReader: {
    navigate: async (location: unknown) => { destinations.push(location); },
    _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: viewer },
      document: { getElementById: () => ({ scrollLeft: 0, scrollTop: 0 }) } } },
  } };
  controller.source = source; controller.item = { attachmentHash: Promise.resolve('v1') };
  controller.session = { identity: source.identity, messages: [user, { ...answer, sourceVersion: 'v1' }], draft: '', task: 'chat' };
  try {
    await controller.bridge.navigate('image-figure-1', answer.id);
    assert.deepEqual(destinations[0], { position: image.location });
    await controller.bridge.returnToReading();
    assert.deepEqual(destinations[1], { dest: [0, { name: 'XYZ' }, 10, 20, 1] });
    controller.source = { ...source, version: 'v2' };
    await assert.rejects(controller.bridge.navigate('image-figure-1', answer.id), /旧版 PDF/);
    assert.equal(destinations.length, 2);
  } finally { await controller.dispose(); delete (globalThis as any).Components; }
});

test('saved notes retain PDF image links and label uploaded images without embedding image data', async () => {
  let html = '';
  (globalThis as any).Zotero = { Libraries: { get: () => ({ libraryType: 'user' }) },
    Item: class { id = 7; libraryID = 0; parentID = 0; setNote(value: string) { html = value; } async saveTx() {} } };
  const external = { ...image, id: 'external', name: '<example>.png', location: undefined };
  try {
    const noteID = await saveNote({ libraryID: 1, key: 'PAPER', parentID: 2 },
      { ...answer, content: '观察 [图片 1](#image-figure-1)。' }, user, source, [image, external]);
    assert.equal(noteID, 7);
    assert.match(html, /zotero:\/\/open-pdf\/library\/items\/PAPER\?page=3/);
    assert.match(html, /&lt;example&gt;\.png（用户图片/);
    assert.doesNotMatch(html, /#image-|data:image/);
  } finally { delete (globalThis as any).Zotero; }
});
