import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIClient, endpointCandidates } from '../src/ai/client';
import type { AIConnection } from '../src/types';

const settings: AIConnection = { baseURL: 'https://relay.example', apiKey: 'test-only-key', model: 'test-model' };
const response = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
test('base URLs support explicit version and full endpoint without duplicating v1', () => {
  assert.deepEqual(endpointCandidates('https://relay.example/v1/chat/completions/', 'models'), ['https://relay.example/v1/models']);
  assert.deepEqual(endpointCandidates('https://relay.example/api', 'models'), ['https://relay.example/api/models', 'https://relay.example/api/v1/models']);
});
test('model discovery falls back only on a missing endpoint and preserves authorization', async () => {
  const urls: string[] = [];
  const client = new AIClient((async (url: string, init: RequestInit) => {
    urls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
    if (urls.length === 1) return new Response('missing', { status: 404 });
    return Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] });
  }) as typeof fetch);
  assert.deepEqual(await client.models(settings), ['model-a', 'model-b']);
  assert.deepEqual(urls, ['https://relay.example/models', 'https://relay.example/v1/models']);
});
test('different provider connections use their own endpoints and keys', async () => {
  const requests: string[] = [];
  const client = new AIClient((async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    requests.push(`${headers.Authorization}|${url}`);
    return Response.json({ data: [] });
  }) as typeof fetch);
  await client.models({ baseURL: 'https://one.example/v1', apiKey: 'key-one', model: 'one' });
  await client.models({ baseURL: 'https://two.example/v1', apiKey: 'key-two', model: 'two' });
  assert.deepEqual(requests, [
    'Bearer key-one|https://one.example/v1/models',
    'Bearer key-two|https://two.example/v1/models',
  ]);
});
test('authentication failure does not retry and redacts a reflected key', async () => {
  let requests = 0;
  const client = new AIClient((async () => { requests++; return Response.json({ error: { message: 'invalid test-only-key' } }, { status: 401 }); }) as typeof fetch);
  await assert.rejects(client.models(settings), /HTTP 401：invalid …/);
  assert.equal(requests, 1);
});
test('SSE accepts arbitrarily split UTF-8 and final event without newline', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"论文"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"依据"},"finish_reason":"stop"}]}\n\ndata: [DONE]');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i=0; i<bytes.length; i+=7) controller.enqueue(bytes.slice(i, i+7)); controller.close(); } });
  const client = new AIClient((async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch);
  let text = '';
  await client.stream(settings, [], chunk => { text += chunk; });
  assert.equal(text, '论文依据');
});
test('a prematurely closed stream reports interruption while preserving partial text', async () => {
  const client = new AIClient((async () => response('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n')) as typeof fetch);
  let text = '';
  await assert.rejects(client.stream(settings, [], chunk => { text += chunk; }), /连接中断/);
  assert.equal(text, '部分回答');
});
test('non-streaming relay responses are supported and truncation is reported', async () => {
  const client = new AIClient((async () => Response.json({ choices: [{ message: { content: 'text' }, finish_reason: 'length' }] })) as typeof fetch);
  let text = '';
  await assert.rejects(client.stream(settings, [], chunk => { text += chunk; }), /长度上限/);
  assert.equal(text, 'text');
});
test('stop signal reaches the upstream fetch request', async () => {
  const abort = new AbortController();
  const client = new AIClient((async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, abort.signal);
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
  }) as typeof fetch);
  const request = client.models(settings, abort.signal);
  abort.abort();
  await assert.rejects(request, { name: 'AbortError' });
});
