import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, RefreshCw, X, Copy, SlidersHorizontal, ChevronLeft, Check, ArrowRight, Share2, Download } from 'lucide-react';
import { api, loadModels, loadSettings, notify, useAppState } from './client';
import { apiLabels, defaultParameters, validateParameters, type ApiType, type ModelConfig, type ModelImportSource, type ModelParameter } from '../shared/models';
import { SearchSettings } from './SearchSettings';
import { WindowPanel } from './WindowPanel';

type Row = { key: string; raw: string; enabled: boolean };
type Step = 'loading' | 'source' | 'connection' | 'model' | 'options';
const providers: { name: string; url: string; api: ApiType }[] = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1', api: 'responses' },
  { name: 'Anthropic', url: 'https://api.anthropic.com', api: 'messages' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com', api: 'chat' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1', api: 'chat' },
  { name: '本机服务（LM Studio）', url: 'http://127.0.0.1:1234/v1', api: 'chat' },
  { name: '其他兼容服务', url: '', api: 'chat' },
];
const validUrl = (value: string) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } };
const shortName = (id: string) => (id.trim().split('/').at(-1) || '').split('-').map(part => /^gpt$/i.test(part) ? 'GPT' : /^[a-z]/i.test(part) ? part[0].toUpperCase() + part.slice(1) : part).join('-');

export function ModelManager() {
  const state = useAppState();
  const [editing, setEditing] = useState<ModelConfig | 'new' | null>(null);
  const [sharing,setSharing] = useState<ModelConfig | 'import' | null>(null);
  return <>
    {sharing && <ModelShare model={sharing === 'import' ? undefined : sharing} onClose={()=>setSharing(null)}/>}
    {editing && <WindowPanel title="配置模型" onClose={() => setEditing(null)}><ModelEditor key={typeof editing === 'string' ? editing : editing.id || 'copy'} model={editing === 'new' ? undefined : editing} onBack={() => setEditing(null)}/></WindowPanel>}
    <div className="model-manager-body" inert={!!editing || !!sharing}>
      <div className="model-list-heading"><span>模型</span><div className="model-list-actions"><button className="secondary-button" onClick={()=>setSharing('import')}><Download size={14}/>导入分享码</button><button className="secondary-button" onClick={() => setEditing('new')}><Plus size={14}/>添加模型</button></div></div>
      <div className="model-list">{state.models.map(model => <div className="model-row" key={model.id} title={`模型：${model.name}`}>
        <button onClick={() => setEditing(model)}><strong>{model.name}</strong><span>{model.fixed ? '内置模拟模型' : model.model}</span></button>
        {!model.fixed && <button className="icon-button" aria-label={`分享模型：${model.name}`} title="导出分享码" onClick={()=>setSharing(model)}><Share2 size={14}/></button>}
        {!model.fixed && <button className="icon-button" aria-label={`复制模型：${model.name}`} title="复制模型配置" onClick={() => setEditing({ ...model, id: '', name: `${model.name} 副本`, hasApiKey: false })}><Copy size={14}/></button>}
        <button className="icon-button" aria-label={`编辑模型：${model.name}`} title="配置模型" onClick={() => setEditing(model)}><SlidersHorizontal size={14}/></button>
        {!model.fixed && <button className="icon-button" aria-label={`删除模型：${model.name}`} title="删除模型" onClick={async () => {
          if (state.settings?.confirmDeletion !== false && !confirm(`删除模型“${model.name}”？聊天记录会保留。`)) return;
          try { await api(`/models/${model.id}`, 'DELETE'); await loadModels(); await loadSettings(); } catch (e) { notify((e as Error).message); }
        }}><Trash2 size={14}/></button>}
      </div>)}</div>
      <SearchSettings/>
    </div>
  </>;
}

function ModelShare({model,onClose}:{model?:ModelConfig;onClose:()=>void}) {
  const [code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<{name:string;baseUrl:string;model:string;apiType:ApiType;hasApiKey:boolean}|null>(null);
  useEffect(()=>{if(!model)return;let active=true;void api<{code:string}>(`/models/${model.id}/share`,'POST').then(value=>{if(active)setCode(value.code);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[model]);
  return <WindowPanel title={model ? '分享模型' : '导入分享码'} onClose={()=>{if(!busy)onClose();}}><form className="model-editor model-share-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(model){await navigator.clipboard.writeText(code);notify('分享码已复制');}else if(!preview){setPreview(await api('/models/share/preview','POST',{code}));}else{await api('/models/share/import','POST',{code});await loadModels();onClose();notify('模型已导入');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <p className="model-form-intro">{model ? '分享码包含 API Key 和完整模型配置，请仅分享给可信的人。分享码只是编码，不是加密。' : '粘贴枝知模型分享码，确认配置后即可导入使用。'}</p>
    <label className="field">分享码<textarea aria-label="模型分享码" spellCheck={false} autoComplete="off" readOnly={!!model} disabled={busy} value={code} onChange={e=>{setCode(e.target.value);setPreview(null);setError('');}} rows={6}/></label>
    {preview && <div className="model-share-preview"><strong>{preview.name}</strong><span>{preview.model}</span><span>{preview.baseUrl}</span><span>{apiLabels[preview.apiType]} · {preview.hasApiKey ? '包含 API Key' : '无 API Key（免密钥服务可直接使用）'}</span></div>}
    {error && <p role="alert" className="config-error">{error}</p>}
    <div className="model-editor-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !code.trim()}>{busy ? '处理中…' : model ? '复制分享码' : preview ? '导入模型' : '读取配置'}</button></div>
  </form></WindowPanel>;
}

function ModelEditor({ model, onBack }: { model?: ModelConfig; onBack: () => void }) {
  const editing = !!model?.id;
  const parameters = model?.parameters || defaultParameters().map(parameter => parameter.key === 'temperature' ? { ...parameter, enabled: false } : parameter.key === 'context_length' ? { ...parameter, value: 256000 } : parameter);
  const [step, setStep] = useState<Step>(editing ? 'options' : 'loading');
  const [sources, setSources] = useState<ModelImportSource[]>([]), [sourceId, setSourceId] = useState<string>();
  const [provider, setProvider] = useState(providers.find(p => p.url === model?.baseUrl)?.name || '');
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl || ''), [apiType, setApiType] = useState<ApiType>(model?.apiType || 'chat');
  const [authType, setAuthType] = useState<ModelConfig['authType']>(model?.authType);
  const [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [modelId, setModelId] = useState(model?.model || ''), [name, setName] = useState(model?.name || '');
  const [vision, setVision] = useState(model?.supportsImages ?? true);
  const [contextLength, setContextLength] = useState(String(parameters.find(p => p.key === 'context_length' && p.enabled)?.value || 256000));
  const [rows, setRows] = useState<Row[]>(parameters.filter(p => p.key !== 'context_length').map(p => ({ key: p.key, raw: typeof p.value === 'string' ? p.value : JSON.stringify(p.value), enabled: p.enabled })));
  const [discovered, setDiscovered] = useState<string[]>([]), [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [listError, setListError] = useState('');
  const [delay, setDelay] = useState(model?.fakeDelay || 0), [verified, setVerified] = useState(false);
  const request = useRef<AbortController | null>(null), locked = useRef(false);
  const hasKey = !!model?.hasApiKey;
  const connection = { baseUrl: baseUrl.trim(), apiType, authType, apiKey: key.trim(), importSourceId: sourceId, configuredModelId: clearKey ? undefined : model?.id || undefined };
  useEffect(() => {
    if (editing) return;
    const abort = new AbortController(); request.current = abort;
    void fetch('/api/models/import-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const values = await response.json() as ModelImportSource[];
      if (!abort.signal.aborted) { setSources(values); setStep(values.length ? 'source' : 'connection'); }
    }).catch(() => { if (!abort.signal.aborted) setStep('connection'); });
    return () => abort.abort();
  }, [editing]);
  useEffect(() => () => request.current?.abort(), []);
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    const response = await fetch(`/api/models/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '请求失败，请检查连接');
    return data;
  };
  const invalidate = () => { setSourceId(undefined); setVerified(false); setDiscovered([]); setListError(''); setError(''); };
  const changeModel = (id: string) => { setModelId(id); setVerified(false); if (!name.trim() || name === shortName(modelId)) setName(shortName(id)); };
  const connect = async (source?: ModelImportSource) => {
    if (locked.current) return;
    if (!source && !validUrl(baseUrl.trim())) { setError('请填写有效的 API 地址'); return; }
    const value = source ? { baseUrl: source.baseUrl, apiType: source.apiType, authType: source.authType, importSourceId: source.id } : connection;
    if (source) {
      setSourceId(source.id); setBaseUrl(source.baseUrl); setApiType(source.apiType); setAuthType(source.authType); setKey(''); setClearKey(false);
      setProvider(providers.find(p => p.url === source.baseUrl)?.name || '其他兼容服务'); changeModel(source.model || ''); setStep('model');
    }
    locked.current = true; setBusy(true); setError(''); setListError(''); setDiscovered([]);
    try { const data = await post<{ models: string[] }>('discover', value); setDiscovered(data.models); if (!editing) setStep('model'); }
    catch (e) { if (!request.current?.signal.aborted) setListError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  };
  const check = async () => {
    if (locked.current) return;
    if (!modelId.trim()) { setError('请选择或输入模型 ID'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await post<{ outputParameter?: string }>('check', { ...connection, model: modelId.trim() });
      if (apiType === 'chat' && result.outputParameter) setRows(current => current.map(row => ['max_tokens','max_completion_tokens','max_output_tokens'].includes(row.key) ? { ...row, key: result.outputParameter! } : row));
      setVerified(true); setStep('options');
    }
    catch (e) { if (!request.current?.signal.aborted) setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  };
  const values: ModelParameter[] = rows.map(row => { let value; try { value = JSON.parse(row.raw); } catch { value = row.raw; } return { key: row.key.trim(), value, enabled: row.enabled }; });
  const currentParameters = [...values, { key: 'context_length', value: Number(contextLength), enabled: true }];
  const save = async () => {
    if (locked.current) return;
    if (!model?.fixed) {
      if (!editing && (!verified || step !== 'options')) return;
      const invalid = !validUrl(baseUrl.trim()) ? '请填写有效的 API 地址' : !name.trim() || !modelId.trim() ? '请填写模型 ID 和显示名称' : validateParameters(currentParameters);
      if (invalid) { setError(invalid); return; }
    }
    locked.current = true; setBusy(true); setError('');
    try {
      const payload = model?.fixed ? { fakeDelay: delay } : { name: name.trim(), ...connection, clearApiKey: clearKey, model: modelId.trim(), supportsImages: vision, parameters: currentParameters };
      await api(model?.fixed ? '/models/fake' : model?.id ? `/models/${model.id}` : '/models', model?.id ? 'PUT' : 'POST', payload);
      await loadModels(); await loadSettings(); onBack();
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  };
  const steps = ['连接服务', '选择模型', '模型选项'], index = step === 'model' ? 1 : step === 'options' ? 2 : 0;
  const connectionFields = <>
    <label className="setting-row"><span>供应商</span><select aria-label="供应商" value={provider} onChange={event => {
      const selected = providers.find(p => p.name === event.target.value)!; setProvider(selected.name); setBaseUrl(selected.url); setApiType(selected.api); setAuthType(undefined); invalidate();
    }}><option value="" disabled>选择供应商</option>{providers.map(p => <option key={p.name}>{p.name}</option>)}</select></label>
    <label className="setting-row"><span>API 地址</span><input aria-label="Base URL" type="url" value={baseUrl} placeholder="https://你的服务商/v1" onChange={event => { setBaseUrl(event.target.value); invalidate(); }}/></label>
    <label className="setting-row"><span>接口类型</span><select aria-label="接口类型" value={apiType} onChange={event => { setApiType(event.target.value as ApiType); setAuthType(undefined); invalidate(); }}>{Object.entries(apiLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {validUrl(baseUrl.trim()) && <div className="setting-row"><label htmlFor="model-api-key">API Key</label><div className="model-input-action"><input id="model-api-key" aria-label="API Key" type="password" autoComplete="off" value={key} onChange={event => { setKey(event.target.value); setClearKey(false); invalidate(); }} placeholder={sourceId ? '已从配置读取' : hasKey && !clearKey ? '已配置；留空保持' : '粘贴密钥，本机服务可留空'}/><button type="button" className="icon-button" aria-label="清除密钥" disabled={!key && !sourceId && (!hasKey || clearKey)} onClick={() => { setKey(''); setClearKey(true); invalidate(); }}><X size={14}/></button></div></div>}
    {apiType === 'messages' && <label className="setting-row"><span>密钥发送方式</span><select aria-label="密钥发送方式" value={authType || 'api-key'} onChange={event => { setAuthType(event.target.value as ModelConfig['authType']); invalidate(); }}><option value="api-key">x-api-key（官方）</option><option value="bearer">Bearer（部分中转服务）</option></select></label>}
  </>;
  const updateRow = (i: number, update: Partial<Row>) => setRows(rows.map((row, j) => i === j ? { ...row, ...update } : row));
  const outputRow = rows.findIndex(row => ['max_tokens','max_output_tokens','max_completion_tokens'].includes(row.key));
  return <form className="model-editor model-config-form model-wizard" noValidate onSubmit={event => { event.preventDefault(); if (editing || step === 'options') void save(); else if (step === 'connection') void connect(); else if (step === 'model') void check(); }}>
    <div className="model-editor-heading"><h2>{model?.fixed ? '模拟模式' : editing ? '编辑模型' : '添加模型'}</h2></div>
    {!editing && step !== 'loading' && step !== 'source' && <ol className="model-wizard-steps" aria-label="配置进度">{steps.map((label, i) => <li key={label} aria-current={i === index ? 'step' : undefined}><span>{i < index ? <Check size={12}/> : i + 1}</span>{label}</li>)}</ol>}
    {step === 'loading' ? <p className="model-form-intro" role="status">正在查找 Claude Code 和 Codex 配置…</p> : <fieldset className="config-fields" disabled={busy}>
      {model?.fixed ? <label className="setting-row"><span>输出间隔</span><span className="setting-range"><input aria-label="模拟输出间隔" type="range" min="0" max="100" step="5" value={delay} onChange={event => setDelay(Number(event.target.value))}/><span>{delay} ms</span></span></label> : <>
        {step === 'source' && <div className="model-import-options"><p className="model-form-intro">找到已有配置，选择一个即可继续。</p>{sources.map(source => <button type="button" className="model-import-choice" key={source.id} onClick={() => void connect(source)}><div><strong>从 {source.source} 导入</strong><span>{source.baseUrl}</span><small>{apiLabels[source.apiType]}{source.model ? ` · ${source.model}` : ''}</small></div><ArrowRight size={16}/></button>)}<button type="button" className="secondary-button" onClick={() => { setStep('connection'); setError(''); }}>手动填写</button></div>}
        {(step === 'connection' || editing) && connectionFields}
        {(step === 'model' || editing) && <>
          <div className="model-selection-heading"><p className="model-form-intro">选择列表中的模型，或直接输入模型 ID。</p><button type="button" className="icon-button" title="读取模型列表" aria-label="读取模型列表" onClick={() => void connect()}><RefreshCw size={14}/></button></div>
          {!!discovered.length && <><input className="model-filter" aria-label="筛选模型" placeholder={`筛选 ${discovered.length} 个模型`} value={filter} onChange={event => setFilter(event.target.value)}/><div className="model-choice-list" role="group" aria-label="可用模型">{discovered.filter(id => id.toLowerCase().includes(filter.toLowerCase())).map(id => <button type="button" key={id} aria-pressed={modelId === id} onClick={() => changeModel(id)}><span>{id}</span>{modelId === id && <Check size={14}/>}</button>)}</div></>}
          <label className="setting-row"><span>模型 ID</span><input aria-label="模型 ID" value={modelId} placeholder="输入模型 ID" onChange={event => changeModel(event.target.value)}/></label>
          {!editing && <p className="model-field-hint">下一步将发送一条简短测试请求，可能产生少量 API 费用。</p>}
        </>}
        {(step === 'options' || editing) && <>
          {!editing && <p className="model-check-success"><Check size={14}/>模型连接正常</p>}
          <label className="setting-row"><span>显示名称</span><input aria-label="显示名称" maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
          <label className="setting-row"><span>支持图片输入</span><input className="setting-toggle" aria-label="支持图片输入" type="checkbox" checked={vision} onChange={event => setVision(event.target.checked)}/></label>
          <label className="setting-row"><span>上下文长度</span><span className="model-context-input"><input aria-label="上下文长度" type="number" min={256} max={10000000} value={contextLength} onChange={event => setContextLength(event.target.value)}/><span>token</span></span></label>
          <p className="model-field-hint">按模型实际容量填写，用于估算对话长度；图片能力需按模型说明选择。</p>
          {outputRow >= 0 && <label className="setting-row"><span>最长输出</span><span className="model-context-input"><input aria-label="最长输出" type="number" min={1} value={rows[outputRow].raw} onChange={event => updateRow(outputRow, { raw: event.target.value })}/><span>token</span></span></label>}
          <details className="model-advanced"><summary>高级参数</summary><p className="model-field-hint">仅启用的参数会发送；输出上限按接口转换。思考等参数请按服务商说明配置。</p><table className="parameter-table"><thead><tr><th>启用</th><th>参数</th><th>值</th><th/></tr></thead><tbody>{rows.map((row, i) => <tr key={i}><td><input type="checkbox" aria-label={`启用参数 ${i+1}`} checked={row.enabled} onChange={event => updateRow(i, { enabled: event.target.checked })}/></td><td><input aria-label={`参数名 ${i+1}`} value={row.key} onChange={event => updateRow(i, { key: event.target.value })}/></td><td><input aria-label={`参数值 ${i+1}`} value={row.raw} onChange={event => updateRow(i, { raw: event.target.value })}/></td><td><button type="button" className="icon-button" aria-label={`删除参数 ${i+1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={13}/></button></td></tr>)}</tbody></table><button type="button" className="secondary-button" onClick={() => setRows([...rows, { key:'', raw:'', enabled:true }])}><Plus size={13}/>添加参数</button></details>
        </>}
      </>}
    </fieldset>}
    {listError && <p className="config-error" role="alert">{listError}</p>}
    {listError && step === 'connection' && <button type="button" className="secondary-button" onClick={() => { setStep('model'); setError(''); }}>手动填写模型 ID</button>}
    {error && <p className="config-error" role="alert">{error}</p>}
    <div className="model-editor-actions">
      {!editing && step !== 'loading' && step !== 'source' && (step !== 'connection' || sources.length > 0) && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setListError(''); setStep(step === 'options' ? 'model' : step === 'model' ? 'connection' : 'source'); }}><ChevronLeft size={14}/>上一步</button>}
      <button type="button" className="secondary-button" disabled={busy && (editing || step === 'options')} onClick={onBack}>取消</button>
      {step !== 'source' && step !== 'loading' && <button type="submit" className="primary-button" disabled={busy || step === 'connection' && !validUrl(baseUrl.trim()) || step === 'model' && !modelId.trim()}>{busy ? (step === 'model' ? '正在检测…' : '处理中…') : editing || step === 'options' ? '保存模型' : '下一步'}</button>}
    </div>
  </form>;
}
