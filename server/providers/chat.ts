import { readSSE } from '../../shared/sse';
import { requestParameters, type ModelConfig } from '../../shared/models';
import type { ChatMessage } from '../../shared/types';
import { AppError } from '../store';

export async function* streamChat(options: { messages: ChatMessage[]; settings: { modelConfig: ModelConfig }; apiKey: string; internalToken?: string; fakeUrl: string; kind: string; depth: number; signal: AbortSignal; onReasoning?: (text: string) => void }): AsyncGenerator<string> {
  const { signal } = options;
  const settings = options.settings.modelConfig;
  const url = settings.provider === 'fake' ? options.fakeUrl : `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason); signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), 60_000);
  try {
    const response = await fetch(url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(settings.provider === 'openai' ? { Authorization: `Bearer ${options.apiKey}` } : options.internalToken ? { 'x-zhizhi-token':options.internalToken } : {}) }, body: JSON.stringify({ ...requestParameters(settings), model: settings.model, messages: options.messages, stream: true, ...(settings.provider === 'fake' ? { __fake: { kind: options.kind, depth: options.depth, delay: settings.fakeDelay } } : {}) }) });
    if (!response.ok) throw new AppError(502, 'UPSTREAM_ERROR', `模型服务返回 ${response.status}，请检查地址、模型和密钥`);
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new AppError(502, 'INVALID_PROTOCOL', '模型服务没有返回有效的流式响应');
    for await (const event of readSSE(response.body)) {
      clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), 60_000);
      if (event.data === '[DONE]') return;
      let item; try { item = JSON.parse(event.data); } catch { throw new AppError(502, 'INVALID_PROTOCOL', '模型服务返回了无法解析的数据'); }
      if (item.error) throw new AppError(502, 'UPSTREAM_ERROR', '模型服务中途返回错误');
      const reasoning = item.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === 'string') options.onReasoning?.(reasoning);
      const delta = item.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') yield delta;
    }
    throw new AppError(502, 'STREAM_INTERRUPTED', '模型连接提前结束');
  } catch (e) {
    if (controller.signal.aborted && !signal.aborted) throw new AppError(504, 'TIMEOUT', '等待模型响应超时');
    throw e;
  } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); }
}
