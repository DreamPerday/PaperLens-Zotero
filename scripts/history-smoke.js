// Verify that a new task generation replaces failed or stopped answers for that same task.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const entry = [...Zotero.PaperLens.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js first.');
const c = entry.controller;
const failed = [];
for (const task of ['chat', 'overview', 'close']) {
  const suffix = task + '-stale';
  const prompt = { id: 'prompt-' + suffix, role: 'user', content: 'stale prompt', task,
    status: 'complete', createdAt: new Date().toISOString() };
  const answer = { id: 'answer-' + suffix, role: 'assistant', content: 'partial stale answer', task,
    status: 'error', error: 'previous failure', createdAt: new Date().toISOString() };
  c.session.messages.push(prompt, answer);
  failed.push(prompt.id, answer.id);
}
c.emit();
const generated = [];
for (const task of ['chat', 'overview', 'close']) {
  c.bridge.setTask(task);
  const before = c.session.messages.filter(message => message.role === 'assistant' && message.task === task && message.status === 'complete').length;
  await c.bridge.send(task === 'chat' ? 'Generate a replacement answer.' : '');
  const messages = c.session.messages;
  const stale = messages.filter(message => message.task === task && failed.includes(message.id));
  if (stale.length) throw new Error(task + ' retained failed or stopped history.');
  const complete = messages.filter(message => message.role === 'assistant' && message.task === task && message.status === 'complete').length;
  if (complete !== before + 1) throw new Error(task + ' did not save exactly one replacement answer.');
  generated.push(task);
}
return { generated, passed: ['chat replaces failed prompt and answer', 'overview replaces failed prompt and answer',
  'annotation replaces failed prompt and answer', 'completed history retained'] };
