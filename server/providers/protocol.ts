import type { ChatMessage, ContentPart } from '../../shared/types';
import { requestParameters, type ApiType, type ModelConfig } from '../../shared/models';

export function endpoint(baseUrl: string, api: ApiType, list = false) {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${api === 'messages' && !/\/v1$/.test(base) ? '/v1' : ''}/${list ? 'models' : api === 'chat' ? 'chat/completions' : api}`;
}
export function authHeaders(api: ApiType, key: string, authType?: ModelConfig['authType']): Record<string, string> {
  const auth = key ? api === 'messages' && authType !== 'bearer' ? { 'x-api-key': key } : { Authorization: `Bearer ${key}` } : {};
  return { ...auth, ...(api === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}) } as Record<string, string>;
}
function image(part: Extract<ContentPart, { type: 'image_url' }>) {
  const url = part.image_url.url;
  const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  return { type: 'image', source: data ? { type: 'base64', media_type: data[1], data: data[2] } : { type: 'url', url } };
}
export function requestBody(model: ModelConfig, messages: ChatMessage[]) {
  const api = model.apiType || 'chat';
  const params = requestParameters(model);
  if (api === 'chat') return { ...params, model: model.model, messages, stream: true };
  const output = params.max_output_tokens ?? params.max_completion_tokens ?? params.max_tokens;
  const effort = params.reasoning_effort;
  delete params.max_output_tokens; delete params.max_completion_tokens; delete params.max_tokens; delete params.reasoning_effort;
  if (api === 'responses') return {
    ...params, model: model.model, stream: true, store: false,
    ...(output !== undefined ? { max_output_tokens: output } : {}),
    ...(effort !== undefined ? { reasoning: { effort } } : {}),
    input: messages.map(message => ({ role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text } : { type: 'input_image', image_url: part.image_url.url }) })),
  };
  if (effort !== undefined) throw new Error('Anthropic Messages 不支持 reasoning_effort，请在高级设置中关闭该参数');
  return {
    ...params, model: model.model, stream: true, max_tokens: output ?? 4096,
    system: messages.filter(message => message.role === 'system').flatMap(message => typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content.filter(part => part.type === 'text')),
    messages: messages.filter(message => message.role !== 'system').map(message => ({ role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? part : image(part)) })),
  };
}

// Protocol metadata has a place alongside text so future tool loops need not
// flatten provider-specific blocks into visible text.
export type ModelEvent = { type: 'text' | 'reasoning'; text: string } | { type: 'done' } | { type: 'metadata'; value: unknown };
export class ResponseIncompleteError extends Error {
  constructor(public reason?: string) { super(reason === 'max_output_tokens' ? '模型输出达到上限' : '模型输出未完成'); }
}
export function responseEvents(api: ApiType, item: any): ModelEvent[] {
  if (item.error || item.type === 'error' || item.type === 'response.failed') throw new Error('模型服务中途返回错误');
  if (api === 'chat') {
    const delta = item.choices?.[0]?.delta;
    return [typeof delta?.reasoning_content === 'string' ? { type: 'reasoning' as const, text: delta.reasoning_content } : null, typeof delta?.content === 'string' ? { type: 'text' as const, text: delta.content } : null].filter((event): event is Extract<ModelEvent, { text: string }> => !!event);
  }
  if (api === 'responses') {
    if (item.type === 'response.output_text.delta' || item.type === 'response.refusal.delta') return [{ type: 'text', text: item.delta }];
    if (item.type === 'response.reasoning_summary_text.delta') return [{ type: 'reasoning', text: item.delta }];
    if (item.type === 'response.completed') return [{ type: 'metadata', value: item.response }, { type: 'done' }];
    if (item.type === 'response.incomplete') throw new ResponseIncompleteError(item.response?.incomplete_details?.reason);
  } else {
    if (item.type === 'content_block_delta' && item.delta?.type === 'text_delta') return [{ type: 'text', text: item.delta.text }];
    if (item.type === 'content_block_delta' && item.delta?.type === 'thinking_delta') return [{ type: 'reasoning', text: item.delta.thinking }];
    if (item.type === 'message_stop') return [{ type: 'done' }];
  }
  return [{ type: 'metadata', value: item }];
}
