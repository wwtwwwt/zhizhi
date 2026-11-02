import templates from '../prompts/context.json';
import type { ChatMessage } from '../shared/types';

/** Substitute template slots once: inserted user data is never interpreted as a template. */
export function renderPrompt(name: keyof typeof templates, values: Record<string, string> = {}): string {
  return templates[name].replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Missing prompt variable: ${name}.${key}`);
    return values[key];
  });
}

export function replyContext(history: ChatMessage[]): ChatMessage[] {
  return [{ role: 'system', content: renderPrompt('replySystem') }, ...history];
}

export function rewriteContext(background: ChatMessage[], original: string, descendants: string): ChatMessage[] {
  return [
    { role: 'system', content: renderPrompt('rewriteSystem') },
    ...background,
    { role: 'user', content: renderPrompt('rewriteRequest', { original, descendants }) },
  ];
}
