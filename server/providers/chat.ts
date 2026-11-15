import { readSSE } from '../../shared/sse';
import type { ModelConfig } from '../../shared/models';
import { endpoint, authHeaders, requestBody, responseEvents, type ModelEvent } from './protocol';
import type { ChatMessage } from '../../shared/types';
import { AppError } from '../store';

export async function* streamChat(options: { messages: ChatMessage[]; settings: { modelConfig: ModelConfig }; apiKey: string; internalToken?: string; fakeUrl: string; kind: string; depth: number; signal: AbortSignal; onReasoning?: (text: string) => void; onEvent?: (event: ModelEvent) => void }): AsyncGenerator<string> {
  const { signal } = options;
  const settings = options.settings.modelConfig;
  const api = settings.provider === 'fake' ? 'chat' : settings.apiType || 'chat';
  const url = settings.provider === 'fake' ? options.fakeUrl : endpoint(settings.baseUrl, api);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason); signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), 60_000);
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(settings.provider === 'openai' ? authHeaders(api, options.apiKey, settings.authType) : options.internalToken ? { 'x-zhizhi-token':options.internalToken } : {}) }, body: JSON.stringify({ ...requestBody({ ...settings, apiType: api }, options.messages), ...(settings.provider === 'fake' ? { __fake: { kind: options.kind, depth: options.depth, delay: settings.fakeDelay } } : {}) }) });
    if (!response.ok) {
      // Recognize only known parameter names; never surface a raw upstream body
      // which may echo credentials or full request contents.
      let unsupported = '';
      if (response.status === 400) {
        const detail = await response.text();
        if (/max_tokens/.test(detail) && /max_completion_tokens/.test(detail)) unsupported = 'max_tokens';
      }
      throw new AppError(502, unsupported ? 'OUTPUT_PARAMETER_UNSUPPORTED' : 'UPSTREAM_ERROR', unsupported ? '此模型要求使用 max_completion_tokens 作为输出上限参数' : `模型服务返回 ${response.status}，请检查地址、模型和密钥`);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new AppError(502, 'INVALID_PROTOCOL', '模型服务没有返回有效的流式响应');
    for await (const event of readSSE(response.body)) {
      clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), 60_000);
      if (api === 'chat' && event.data === '[DONE]') { options.onEvent?.({ type: 'done' }); return; }
      let item; try { item = JSON.parse(event.data); } catch { throw new AppError(502, 'INVALID_PROTOCOL', '模型服务返回了无法解析的数据'); }
      for (const normalized of responseEvents(api, item)) {
        options.onEvent?.(normalized);
        if (normalized.type === 'done') return;
        if (normalized.type === 'reasoning') options.onReasoning?.(normalized.text);
        if (normalized.type === 'text') yield normalized.text;
      }
    }
    throw new AppError(502, 'STREAM_INTERRUPTED', '模型连接提前结束');
  } catch (e) {
    if (controller.signal.aborted && !signal.aborted) throw new AppError(504, 'TIMEOUT', '等待模型响应超时');
    throw e;
  } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); }
}
