import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { registerCaptureShortcut } from '../src/reading/capture-shortcut';

class ReaderDocument extends EventTarget {
  frames: { localName: string; contentDocument: ReaderDocument }[] = [];
  querySelectorAll() { return this.frames; }
  loadFrame(frame: ReaderDocument) {
    const element = { localName: 'iframe', contentDocument: frame };
    this.frames.push(element);
    const event = new Event('load');
    Object.defineProperty(event, 'target', { value: element });
    this.dispatchEvent(event);
  }
}

function key(doc: ReaderDocument, changes: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: 'a', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false,
    repeat: false, isComposing: false, getModifierState: () => false, ...changes });
  doc.dispatchEvent(event);
  return event;
}

test('screenshot shortcuts work from nested PDF and sidebar documents without taking Ctrl+A', async t => {
  const root = new ReaderDocument(), reader = new ReaderDocument(), pdf = new ReaderDocument(), sidebar = new ReaderDocument();
  reader.frames.push({ localName: 'iframe', contentDocument: pdf });
  root.frames.push({ localName: 'iframe', contentDocument: reader }, { localName: 'iframe', contentDocument: sidebar });
  let captures = 0;
  const cleanup = registerCaptureShortcut(root as unknown as Document, { enabled: () => true,
    capture: async () => { captures++; }, onError: error => { throw error; } });
  t.after(cleanup);
  assert.equal(key(pdf).defaultPrevented, true);
  await nextTurn();
  assert.equal(key(sidebar, { ctrlKey: true }).defaultPrevented, true);
  await nextTurn();
  assert.equal(captures, 2);
  for (const change of [{ altKey: false, ctrlKey: true }, { altKey: false }, { shiftKey: true },
    { metaKey: true }, { isComposing: true }, { getModifierState: () => true }, { repeat: true }, { key: 'b' }]) {
    assert.equal(key(pdf, change).defaultPrevented, false);
  }
  assert.equal(captures, 2);
});

test('new/reloaded frames are registered and detached documents stop receiving the shortcut', async t => {
  const root = new ReaderDocument(), first = new ReaderDocument(), replacement = new ReaderDocument();
  let captures = 0, activePDF = false;
  const cleanup = registerCaptureShortcut(root as unknown as Document, { enabled: () => activePDF,
    capture: async () => { captures++; }, onError: error => { throw error; } });
  t.after(cleanup);
  root.loadFrame(first);
  assert.equal(key(first).defaultPrevented, false);
  activePDF = true;
  assert.equal(key(first, { key: 'A' }).defaultPrevented, true);
  await nextTurn();
  root.frames = [];
  root.loadFrame(replacement);
  assert.equal(key(first).defaultPrevented, false);
  assert.equal(key(replacement).defaultPrevented, true);
  await nextTurn();
  cleanup();
  assert.equal(key(root).defaultPrevented, false);
  assert.equal(key(replacement).defaultPrevented, false);
  assert.equal(captures, 2);
});

test('repeated shortcuts do not restart an active crop and failures allow the next attempt', async t => {
  const root = new ReaderDocument();
  let finish!: () => void, captures = 0, rejectNext = false;
  const errors: unknown[] = [];
  const cleanup = registerCaptureShortcut(root as unknown as Document, { enabled: () => true,
    capture: async () => {
      captures++;
      if (rejectNext) throw new Error('Capture failed');
      await new Promise<void>(resolve => { finish = resolve; });
    }, onError: error => { errors.push(error); } });
  t.after(cleanup);
  key(root); key(root); key(root, { ctrlKey: true });
  assert.equal(captures, 1);
  finish(); await nextTurn();
  rejectNext = true;
  key(root); await nextTurn();
  key(root); await nextTurn();
  assert.equal(captures, 3);
  assert.equal(errors.length, 2);
});
