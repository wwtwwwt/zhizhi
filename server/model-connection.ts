import type { ApiType, ModelConfig } from '../shared/models';
import { AppError } from './store';
import { endpoint, authHeaders, ResponseIncompleteError } from './providers/protocol';
import { streamChat } from './providers/chat';
import { renderPrompt } from './prompts';

export async function discoverModels(baseUrl: string, apiType: ApiType, key: string, signal: AbortSignal, authType?: ModelConfig['authType']) {
  const models = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint(baseUrl, apiType, true));
    if (apiType === 'messages') url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set(apiType === 'messages' ? 'after_id' : 'after', after);
    const response = await fetch(url, { headers: authHeaders(apiType, key, authType), signal, redirect: 'error' });
    if (!response.ok) throw new AppError(502, 'MODEL_LIST_ERROR', `读取模型列表失败（${response.status}），请检查地址、密钥及接口类型；也可手动填写模型 ID`);
    const data = await response.json() as { data?: { id?: string }[]; has_more?: boolean; last_id?: string };
    if (!Array.isArray(data.data)) throw new AppError(502, 'MODEL_LIST_ERROR', '服务未返回有效的模型列表，可手动填写模型 ID');
    for (const model of data.data) if (typeof model.id === 'string' && model.id) models.add(model.id);
    if (!data.has_more) return [...models].sort();
    const next = data.last_id || data.data.at(-1)?.id;
    if (!next || next === after) throw new AppError(502, 'MODEL_LIST_ERROR', '模型列表分页异常，可手动填写模型 ID');
    after = next;
  }
  throw new AppError(502, 'MODEL_LIST_ERROR', '模型列表分页过多，可手动填写模型 ID');
}
export async function checkModel(model: ModelConfig, key: string, signal: AbortSignal) {
  const probe = async (config: ModelConfig) => {
    let output = '', reasoning = '';
    try {
      for await (const text of streamChat({ settings: { modelConfig: config }, apiKey: key, messages: [{ role: 'user', content: renderPrompt('modelCheck') }], fakeUrl: '', kind: 'check', depth: 0, signal, onReasoning:text => reasoning += text })) output += text;
    } catch(e) {
      // A bounded probe may exhaust its output budget in reasoning. A valid
      // response with actual generated content still establishes connectivity.
      if (!(e instanceof ResponseIncompleteError && e.reason === 'max_output_tokens' && (output.trim() || reasoning.trim()))) throw e;
    }
    if (!output.trim() && !reasoning.trim()) throw new AppError(502, 'MODEL_CHECK_EMPTY', '服务已连接，但没有返回内容；请检查模型 ID 或参数');
  };
  try { await probe(model); return 'max_tokens'; }
  catch(e) {
    if (model.apiType !== 'messages' && model.apiType !== 'responses' && e instanceof AppError && e.code === 'OUTPUT_PARAMETER_UNSUPPORTED') {
      await probe({ ...model, parameters: model.parameters.map(parameter => parameter.key === 'max_tokens' ? { ...parameter, key:'max_completion_tokens' } : parameter) });
      return 'max_completion_tokens';
    }
    throw e;
  }
}
