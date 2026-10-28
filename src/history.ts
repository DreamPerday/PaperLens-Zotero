import type { Message, Task } from './types';

// A new attempt replaces abandoned or failed assistant answers for the same task.
// Remove the matching prompt as well so the visible transcript cannot grow orphaned questions.
export function discardIncompleteAnswers(messages: Message[], task: Task): Message[] {
  const discard = new Set<string>();
  const lastPrompt = new Map<Task, string>();
  for (const message of messages) {
    if (message.role === 'user') {
      lastPrompt.set(message.task, message.id);
      continue;
    }
    if (message.task !== task || message.status === 'complete' && message.content.trim()) continue;
    discard.add(message.id);
    const promptID = lastPrompt.get(message.task);
    if (promptID) discard.add(promptID);
  }
  return discard.size ? messages.filter(message => !discard.has(message.id)) : messages;
}
