import { streamText, isStepCount, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ChatMessage } from '../../shared/types';
import { estimateText, modelBudget, requestParameters, type ModelConfig } from '../../shared/models';
import type { SearchProgress } from '../../shared/search';
import { createSearchTools } from '../web-search';
import { renderPrompt } from '../prompts';
import { AppError } from '../store';

export async function* streamAgent(options: { model: ModelConfig; apiKey: string; searchKey: string; messages: ChatMessage[]; signal: AbortSignal; onReasoning: (text: string) => void; onProgress: (value: SearchProgress) => void; searchEndpoint?: string }) {
  const { model } = options;
  const api = model.apiType || 'chat', base = model.baseUrl.replace(/\/+$/, '');
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]);
  const parameters = requestParameters(model);
  const budget = modelBudget(model);
  // Keep existing custom parameters while letting SDK own tools, messages and
  // protocol-specific continuation (including opaque reasoning signatures).
  const transport: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    const body = JSON.parse(String(init?.body || '{}'));
    const extra = { ...parameters };
    delete extra.max_tokens; delete extra.max_completion_tokens; delete extra.max_output_tokens;
    if (api === 'responses' && extra.reasoning_effort !== undefined) { body.reasoning = { ...body.reasoning, effort: extra.reasoning_effort }; delete extra.reasoning_effort; }
    if (api === 'messages' && extra.reasoning_effort !== undefined) throw new AppError(400, 'INVALID_PARAMETERS', 'Messages 请关闭 reasoning_effort，按服务商说明配置 thinking');
    Object.assign(body, extra);
    if (api === 'chat') {
      delete body.max_completion_tokens; delete body.max_tokens;
      body[parameters.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens'] = budget.output;
    }
    if (api === 'responses') { body.store = false; body.include = [...new Set([...(body.include || []), 'reasoning.encrypted_content'])]; }
    const wire = JSON.stringify(body);
    let images = 0;
    const estimate = JSON.stringify(body, (_key, value) => {
      if (value && typeof value === 'object' && value.type === 'base64' && String(value.media_type).startsWith('image/')) { images++; return { ...value, data: '[image]' }; }
      if (typeof value === 'string' && value.startsWith('data:image/')) { images++; return '[image]'; }
      return value;
    });
    if (Buffer.byteLength(wire) > 16 * 1024 * 1024 || estimateText(estimate) + images * 1536 + budget.output > budget.limit) throw new AppError(400, 'CONTEXT_TOO_LARGE', '联网资料组装后超过模型上下文预算，请缩小查询范围');
    return fetch(input, { ...init, body: wire, redirect: 'error', signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
  };
  const openai = createOpenAI({ apiKey: options.apiKey || 'local', baseURL: base, fetch: transport });
  const compatible = createOpenAICompatible({ name: 'compatible', apiKey: options.apiKey || 'local', baseURL: base, fetch: transport });
  const anthropic = createAnthropic({ apiKey: options.apiKey || 'local', baseURL: /\/v1$/.test(base) ? base : `${base}/v1`, headers: model.authType === 'bearer' ? { Authorization: `Bearer ${options.apiKey}`, 'x-api-key': '' } : undefined, fetch: transport });
  const messages: ModelMessage[] = options.messages.map(message => ({ role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? part : { type: 'file', data: part.image_url.url, mediaType: /^data:([^;]+);/.exec(part.image_url.url)?.[1] || 'image/*' }) })) as ModelMessage[];
  messages.unshift({ role: 'system', content: renderPrompt('webSearchSystem') });
  const search = createSearchTools({ key: options.searchKey, signal, onProgress: options.onProgress, endpoint: options.searchEndpoint });
  let lastFinish = '', steps = 0;
  const result = streamText({
    model: api === 'messages' ? anthropic(model.model) : api === 'responses' ? openai.responses(model.model) : compatible.chatModel(model.model),
    messages, allowSystemInMessages: true, providerOptions: api === 'responses' ? { openai: { store: false, include: ['reasoning.encrypted_content'] } } : undefined, tools: search.tools, maxOutputTokens: budget.output, maxRetries: 0, abortSignal: signal,
    stopWhen: isStepCount(8), onStepEnd: step => { lastFinish = step.finishReason; steps++; },
  });
  for await (const event of result.fullStream) {
    if (event.type === 'text-delta') yield event.text;
    if (event.type === 'reasoning-delta') options.onReasoning(event.text);
    if (event.type === 'error') {
      if (signal.aborted) throw new AppError(408, 'AGENT_INTERRUPTED', '联网查询已停止或超过3分钟，请缩小范围后继续');
      if (event.error instanceof AppError) throw event.error;
      throw new AppError(502, 'AGENT_MODEL_ERROR', '联网生成失败，请检查模型是否支持工具调用、接口及参数配置');
    }
    if (event.type === 'tool-error') throw new AppError(502, 'TOOL_CALL_ERROR', '模型工具调用无效，请检查模型的工具调用能力');
    if (event.type === 'abort') throw new AppError(408, 'AGENT_INTERRUPTED', '联网查询已停止或超过3分钟，请缩小范围后继续');
  }
  signal.throwIfAborted();
  if (steps >= 8 && lastFinish === 'tool-calls') throw new AppError(400, 'AGENT_LIMIT', '本轮已达到8次模型请求上限，请缩小查询范围后继续');
  if (lastFinish === 'length') throw new AppError(400, 'OUTPUT_LIMIT', '模型输出达到上限');
  // Links come from sources produced by real successful tool results. Keep
  // references available after refresh even if the model omitted inline links.
  const sources = search.getSources();
  if (sources.length) yield `\n\n参考来源：\n${sources.map(source => `- [${source.title.replace(/[\[\]\\\n\r]/g, ' ')}](<${source.url.replace(/>/g, '%3E')}>)`).join('\n')}`;
}
