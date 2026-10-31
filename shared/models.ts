import type { ChatMessage } from './types';

export type ModelParameter = { key: string; value: string | number | boolean | null | object; enabled: boolean };
export type ModelConfig = { id: string; provider: 'fake' | 'openai'; name: string; baseUrl: string; model: string; supportsImages: boolean; parameters: ModelParameter[]; hasApiKey?: boolean; fixed?: boolean; fakeDelay?: number };
export type AttachmentInput = { name: string; kind: 'image' | 'text'; mime: string; data: string };
export type AttachmentInfo = { id: string; name: string; kind: 'image' | 'text'; mime: string; size: number; text?: string };
export type SendOptions = { modelId?: string; attachments?: AttachmentInput[] };
export const defaultParameters = (): ModelParameter[] => [
  { key: 'temperature', value: 0.7, enabled: true },
  { key: 'max_tokens', value: 4096, enabled: true },
  { key: 'context_length', value: 128000, enabled: true },
  { key: 'reasoning_effort', value: 'medium', enabled: false },
];
export const fakeModel = (delay = 30): ModelConfig => ({ id: 'fake', provider: 'fake', name: '模拟模式', model: 'fake', baseUrl: '', supportsImages: true, parameters: defaultParameters(), fixed: true, fakeDelay: delay });
export function parameter(model: ModelConfig, key: string) { return model.parameters.find(p => p.enabled && p.key === key)?.value; }
export function modelBudget(model: ModelConfig) {
  const limit = Number(parameter(model, 'context_length')) || 128000;
  const output = Number(parameter(model, 'max_completion_tokens') ?? parameter(model, 'max_tokens')) || 4096;
  return { limit, output };
}
export function estimateText(text: string): number {
  // Conservative local estimate, not the provider's tokenizer or billed usage.
  let ascii = 0, other = 0;
  for (const c of text) { if (c.codePointAt(0)! <= 127) ascii++; else other++; }
  return Math.ceil(ascii / 3 + other);
}
export function estimateMessages(messages: ChatMessage[]): number {
  return 4 + messages.reduce((n, m) => n + 4 + (typeof m.content === 'string' ? estimateText(m.content) : m.content.reduce((v, p) => v + (p.type === 'text' ? estimateText(p.text) : 1536), 0)), 0);
}
export function requestParameters(model: ModelConfig) {
  return Object.fromEntries(model.parameters.filter(p => p.enabled && p.key !== 'context_length').map(p => [p.key, p.value]));
}
export function validateParameters(parameters: ModelParameter[]): string | null {
  const keys = new Set<string>();
  const reserved = new Set(['model','messages','stream','api_key','apiKey','baseUrl','base_url','headers','Authorization','__fake','__proto__','prototype','constructor']);
  for (const p of parameters) {
    if (!/^[A-Za-z][\w.]*$/.test(p.key) || reserved.has(p.key)) return '参数名无效或属于保留字段';
    if (keys.has(p.key)) return '参数名不能重复'; keys.add(p.key);
    if (!p.enabled) continue;
    if (p.key === 'context_length' && (!Number.isInteger(p.value) || Number(p.value) < 256 || Number(p.value) > 10_000_000)) return '上下文长度需要为 256 到 10000000 的整数';
    if (['max_tokens','max_completion_tokens'].includes(p.key) && (!Number.isInteger(p.value) || Number(p.value) < 1)) return '输出 token 上限需要为正整数';
    if (p.key === 'temperature' && (typeof p.value !== 'number' || p.value < 0 || p.value > 2)) return 'temperature 需要为 0 到 2 的数字';
  }
  if (parameters.some(p => p.enabled && p.key === 'max_tokens') && parameters.some(p => p.enabled && p.key === 'max_completion_tokens')) return 'max_tokens 和 max_completion_tokens 只能启用一个';
  return null;
}
