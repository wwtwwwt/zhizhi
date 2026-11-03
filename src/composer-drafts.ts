import type { AttachmentInput } from '../shared/models';

export type RestoredQuestion = { text: string; attachments: AttachmentInput[] };
const pending = new Map<string, RestoredQuestion>();
const listeners = new Set<(key: string) => void>();
export function restoreQuestion(key: string, question: RestoredQuestion) {
  const previous = pending.get(key);
  pending.set(key, previous ? { text: [question.text, previous.text].filter(Boolean).join('\n\n'), attachments: [...question.attachments, ...previous.attachments] } : question);
  listeners.forEach(fn => fn(key));
}
export function takeQuestion(key: string) { const question = pending.get(key); pending.delete(key); return question; }
export function onRestoreQuestion(listener: (key: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
