import { expect, test } from 'vitest';
import { onRestoreQuestion, restoreQuestion, takeQuestion } from '../src/composer-drafts';

test('restored questions are scoped to their composer, queued when closed, and consumed once', () => {
  const seen: string[] = []; const unsubscribe = onRestoreQuestion(key => seen.push(key));
  restoreQuestion('branch-a', { text: '第一条', attachments: [{ name: 'a.md', kind: 'text', mime: 'text/plain', data: '附件' }] });
  expect(takeQuestion('root')).toBeUndefined();
  restoreQuestion('branch-a', { text: '第二条', attachments: [] });
  expect(takeQuestion('branch-a')).toEqual({ text: '第二条\n\n第一条', attachments: [{ name: 'a.md', kind: 'text', mime: 'text/plain', data: '附件' }] });
  expect(takeQuestion('branch-a')).toBeUndefined();
  expect(seen).toEqual(['branch-a', 'branch-a']); unsubscribe();
});
