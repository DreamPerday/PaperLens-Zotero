import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupImportedPublication, PublicationImportQueue } from '../src/publication-import';
import { normalizeSettings } from '../src/settings';
import type { PublicationLookup } from '../src/paper-online';

const settings = normalizeSettings({});
const result: PublicationLookup = {
  title: 'A synthetic paper', type: 'journal', venue: 'Test Journal', year: '2026',
  doi: '10.1000/test', source: 'test', ccf: '', core: '',
};
const immediate = async () => {};
const waitFor = async (check: () => boolean) => {
  for (let n = 0; n < 500; n++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Timed out waiting for import queue');
};

test('empty lookup is retried once and a successful response is returned', async () => {
  let calls = 0;
  const found = await lookupImportedPublication({}, settings, async () => {
    if (++calls === 1) throw new Error('No matching metadata');
    return result;
  }, immediate);
  assert.equal(calls, 2);
  assert.deepEqual(found, result);
});

test('a complete first response is used without another request', async () => {
  let calls = 0;
  await lookupImportedPublication({}, settings, async () => { calls++; return result; }, immediate);
  assert.equal(calls, 1);
});

test('empty EasyScholar response is retried even when bibliographic metadata is complete', async () => {
  let calls = 0;
  const found = await lookupImportedPublication({}, { ...settings, easyScholarApiKey: 'synthetic' }, async (): Promise<PublicationLookup> => {
    calls++;
    return calls === 1 ? { ...result, ranks: {} } : { ...result, jcr: 'JCR-Q1', ranks: { sci: 'Q1', hzau: 'A' } };
  }, immediate);
  assert.equal(calls, 2);
  assert.equal(found?.jcr, 'JCR-Q1');
  assert.equal(found?.ranks?.hzau, 'A');
});

test('a failed or partial retry preserves useful first-response metadata', async () => {
  let calls = 0;
  const found = await lookupImportedPublication({}, settings, async () => {
    if (++calls === 2) throw new Error('Timeout');
    return { ...result, year: '' };
  }, immediate);
  assert.equal(found?.venue, result.venue);
  assert.equal(calls, 2);
  calls = 0;
  const merged = await lookupImportedPublication({}, settings, async () => ++calls === 1
    ? { ...result, year: '', jcr: 'JCR-Q1' }
    : { ...result, venue: '', jcr: '' }, immediate);
  assert.equal(merged?.venue, result.venue);
  assert.equal(merged?.year, '2026');
  assert.equal(merged?.jcr, 'JCR-Q1');
});

test('two failed attempts stop without inventing metadata', async () => {
  let calls = 0;
  await assert.rejects(lookupImportedPublication({}, settings, async () => {
    calls++;
    throw new Error('No result');
  }, immediate), /No result/);
  assert.equal(calls, 2);
});

function queueFixture(overrides: Record<string, any> = {}) {
  const calls: number[] = [];
  const applied: number[] = [];
  const errors: unknown[] = [];
  const papers = new Map([[1, { id: 1 }], [2, { id: 2 }]]);
  const queue = new PublicationImportQueue({
    getItem: id => papers.get(id),
    eligible: item => Boolean(item),
    getSettings: async () => settings,
    lookup: async item => { calls.push(item.id); return result; },
    apply: async item => { applied.push(item.id); },
    onError: error => { errors.push(error); },
    ...overrides,
  }, 5, 1);
  return { queue, calls, applied, errors };
}

test('only new papers are queried, duplicate adds and later modifications do not query again', async t => {
  const { queue, calls, applied, errors } = queueFixture();
  t.after(() => queue.stop());
  queue.notify('modify', 'item', [2]);
  queue.notify('add', 'item', [1, 1, 99]);
  queue.notify('modify', 'item', [1]);
  queue.notify('add', 'item', [1]);
  await waitFor(() => applied.length === 1);
  queue.notify('modify', 'item', [1]);
  queue.notify('add', 'item', [1, 2]);
  await waitFor(() => applied.length === 2);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(errors, []);
});

test('batch imports run sequentially and a deleted queued paper is skipped', async t => {
  let running = 0;
  let maxRunning = 0;
  const { queue, applied } = queueFixture({ lookup: async () => {
    maxRunning = Math.max(maxRunning, ++running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return result;
  } });
  t.after(() => queue.stop());
  queue.notify('add', 'item', [1, 2]);
  await waitFor(() => applied.length === 2);
  assert.equal(maxRunning, 1);
  const deleted = queueFixture();
  t.after(() => deleted.queue.stop());
  deleted.queue.notify('add', 'item', [1, 2]);
  deleted.queue.notify('trash', 'item', [1]);
  await waitFor(() => deleted.applied.length === 1);
  assert.deepEqual(deleted.calls, [2]);
});

test('disabling automatic lookup prevents requests and stopping drops pending/in-flight results', async t => {
  const disabled = queueFixture({ getSettings: async () => ({ ...settings, autoPublicationLookup: false }) });
  t.after(() => disabled.queue.stop());
  disabled.queue.notify('add', 'item', [1]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(disabled.calls, []);

  let release!: (value: PublicationLookup) => void;
  let started = false;
  const active = queueFixture({ lookup: async () => {
    started = true;
    return new Promise<PublicationLookup>(resolve => { release = resolve; });
  } });
  t.after(() => active.queue.stop());
  active.queue.notify('add', 'item', [1, 2]);
  await waitFor(() => started);
  active.queue.stop();
  release(result);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(active.applied, []);
});

test('turning automatic lookup off during a request prevents the later write', async t => {
  let enabled = true;
  const { queue, applied, calls } = queueFixture({
    getSettings: async () => ({ ...settings, autoPublicationLookup: enabled }),
    lookup: async () => { calls.push(1); enabled = false; return result; },
  });
  t.after(() => queue.stop());
  queue.notify('add', 'item', [1]);
  await waitFor(() => calls.length > 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(applied, []);
});
