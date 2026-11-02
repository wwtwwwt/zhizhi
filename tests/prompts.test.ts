import { expect, test } from 'vitest';
import { renderPrompt, replyContext, rewriteContext } from '../server/prompts';
import type { ChatMessage } from '../shared/types';

test('template substitution preserves user placeholders and replacement metacharacters literally', () => {
  const text = '{{name}} $& $` </attachment>\n新内容';
  const result = renderPrompt('textAttachment', { name: 'source.md', text });
  expect(result).toContain('附件 source.md');
  expect(result).toContain(text);
  expect(() => renderPrompt('textAttachment', { name: 'source.md' })).toThrow('textAttachment.text');
  expect(() => renderPrompt('quote', Object.create({ text: 'inherited' }))).toThrow('quote.text');
});

test('reply and rewrite builders keep history roles and attachments without mutating input', () => {
  const background: ChatMessage[] = [
    { role: 'user', content: [{ type: 'text', text: '问题' }, { type: 'image_url', image_url: { url: 'attachment:test' } }] },
    { role: 'assistant', content: '目标原文' },
  ];
  const before = JSON.stringify(background);
  const reply = replyContext(background);
  const rewrite = rewriteContext(background, '目标原文', 'user: 后代问题');
  expect(reply.map(m => m.role)).toEqual(['system', 'user', 'assistant']);
  expect(rewrite.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(reply[0]).not.toEqual(rewrite[0]);
  expect(rewrite.slice(1, -1)).toEqual(background);
  expect(rewrite.at(-1)?.content).toBe(renderPrompt('rewriteRequest', { original: '目标原文', descendants: 'user: 后代问题' }));
  expect(JSON.stringify(background)).toBe(before);
});
