import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discardIncompleteAnswers } from '../src/history';
import type { Message } from '../src/types';

function message(id: string, role: Message['role'], task: Message['task'], status: Message['status'],
  content = 'content'): Message {
  return { id, role, task, status, content, createdAt: '2026-10-28T00:00:00.000Z' };
}

test('a new overview attempt replaces failed overview prompt and partial answer', () => {
  const messages = [
    message('keep-user', 'user', 'chat', 'complete', 'question'),
    message('keep-answer', 'assistant', 'chat', 'complete', 'answer'),
    message('overview-user', 'user', 'overview', 'complete', 'overview'),
    message('overview-failed', 'assistant', 'overview', 'error', 'partial overview'),
  ];
  assert.deepEqual(discardIncompleteAnswers(messages, 'overview').map(item => item.id), ['keep-user', 'keep-answer']);
});

test('completed answers and other task history are retained', () => {
  const messages = [
    message('complete-user', 'user', 'close', 'complete', 'annotation'),
    message('complete-answer', 'assistant', 'close', 'complete', 'full annotation'),
    message('failed-user', 'user', 'overview', 'complete', 'overview'),
    message('failed-answer', 'assistant', 'overview', 'stopped', 'partial'),
  ];
  assert.deepEqual(discardIncompleteAnswers(messages, 'close').map(item => item.id),
    ['complete-user', 'complete-answer', 'failed-user', 'failed-answer']);
});

test('empty completed answers are treated as unfinished and their prompt is removed', () => {
  const messages = [
    message('prompt', 'user', 'chat', 'complete', 'question'),
    message('empty', 'assistant', 'chat', 'complete', ''),
  ];
  assert.deepEqual(discardIncompleteAnswers(messages, 'chat'), []);
});
