import { useRef, useState } from 'react';
import { Plus, Trash2, ChevronLeft, RefreshCw, X, Copy, SlidersHorizontal } from 'lucide-react';
import { api, loadModels, loadSettings, notify, useAppState } from './client';
import { defaultParameters, validateParameters, type ModelConfig, type ModelParameter } from '../shared/models';
import { WindowPanel } from './WindowPanel';

type Row = { key: string; raw: string; enabled: boolean };
export function ModelManager() {
  const state = useAppState(); const [editing, setEditing] = useState<ModelConfig | 'new' | null>(null);
  const openCopy = (model: ModelConfig) => setEditing({ ...model, id: '', name: `${model.name} 副本`, hasApiKey: false });
  return <>{editing && <WindowPanel title="配置模型" onClose={() => setEditing(null)}><ModelEditor key={typeof editing === 'string' ? editing : editing.id || 'copy'} model={editing === 'new' ? undefined : editing} onBack={() => setEditing(null)}/></WindowPanel>}<div className="model-manager-body" inert={!!editing}><div className="model-list-heading"><span>模型</span><button className="secondary-button" onClick={() => setEditing('new')}><Plus size={14}/>添加模型</button></div><div className="model-list">{state.models.map(model => <div className="model-row" key={model.id} title={`模型：${model.name}`}><button onClick={() => setEditing(model)}><strong>{model.name}</strong><span>{model.fixed ? '内置模拟模型' : model.model}</span></button>{!model.fixed && <button className="icon-button" aria-label={`复制模型：${model.name}`} title="复制模型配置" onClick={() => openCopy(model)}><Copy size={14}/></button>}<button className="icon-button" aria-label={`编辑模型：${model.name}`} title="配置模型" onClick={() => setEditing(model)}><SlidersHorizontal size={14}/></button>{!model.fixed && <button className="icon-button" aria-label={`删除模型：${model.name}`} onClick={async () => { if (state.settings?.confirmDeletion !== false && !confirm(`删除模型“${model.name}”？聊天记录会保留。`)) return; try { await api(`/models/${model.id}`, 'DELETE'); await loadModels(); await loadSettings(); } catch (e) { notify((e as Error).message); } }}><Trash2 size={14}/></button>}</div>)}</div></div></>;

}
function ModelEditor({ model, onBack }: { model?: ModelConfig; onBack: () => void }) {
  const parameters = model?.parameters || defaultParameters();
  const [name,setName] = useState(model?.name || ''), [baseUrl,setBaseUrl] = useState(model?.baseUrl || 'https://api.openai.com/v1');
  const [key,setKey] = useState(''), [clearKey,setClearKey] = useState(false), [modelId,setModelId] = useState(model?.model || ''), [vision,setVision] = useState(model?.supportsImages || false);
  const [contextLength,setContextLength] = useState(String(parameters.find(p=>p.key==='context_length' && p.enabled)?.value || 128000));
  const [rows,setRows] = useState<Row[]>(parameters.filter(p=>p.key!=='context_length').map(p => ({ key:p.key,raw:typeof p.value === 'string' ? p.value : JSON.stringify(p.value),enabled:p.enabled })));
  const [discovered,setDiscovered] = useState<string[]>([]), [showModels,setShowModels] = useState(false), [fetching,setFetching] = useState(false), [delay,setDelay] = useState(model?.fakeDelay || 0),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const discoveryRequest = useRef(0);
  const hasKey=!!model?.hasApiKey;
  const shortName = (id:string) => { const value = id.trim().split('/').at(-1) || id.trim(); return value.split('-').map((part, index) => index === 0 && /^gpt$/i.test(part) ? 'GPT' : /^[a-z]/i.test(part) ? part[0].toUpperCase() + part.slice(1) : part).join('-'); };
  const changeModel = (id:string) => { setModelId(id); if (!name.trim() || name === shortName(modelId)) setName(shortName(id)); };
  const resetDiscovery = () => { discoveryRequest.current++; setDiscovered([]); setShowModels(false); setFetching(false); };
  const readModels = async () => {
    const request = ++discoveryRequest.current; setFetching(true); setShowModels(false);
    try {
      const result = await api<{models:string[]}>('/models/discover','POST',{baseUrl,apiKey:key,configuredModelId:clearKey ? undefined : model?.id || undefined});
      if (request !== discoveryRequest.current) return;
      setDiscovered(result.models);setShowModels(result.models.length>0);
      if (!result.models.length) notify('没有可用模型');
    } catch(e) { if(request===discoveryRequest.current) notify((e as Error).message); }
    finally { if(request===discoveryRequest.current) setFetching(false); }
  };
  const values = rows.map(r=>{let value:ModelParameter['value'];try{value=JSON.parse(r.raw);}catch{value=r.raw;}return {key:r.key.trim(),value,enabled:r.enabled};});
  const currentParameters=[...values,{key:'context_length',value:Number(contextLength),enabled:true}];
  let invalid='';
  if(!model?.fixed){
    if(!name.trim() || !modelId.trim()) invalid='请填写模型 ID 和显示名称';
    else {try{const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{invalid='请输入有效的 Base URL';}}
    if(!invalid)invalid=values.some(p=>p.key==='context_length')?'上下文长度请在上方填写':validateParameters(currentParameters) || '';
  }
  const payload=model?.fixed?{fakeDelay:delay}:{name:name.trim(),baseUrl,apiKey:key,clearApiKey:clearKey,model:modelId.trim(),supportsImages:vision,parameters:currentParameters};
  const save=async()=>{
    if(saving)return;
    if(invalid){setError(invalid);return;}
    setSaving(true);setError('');
    try{
      if(model?.fixed)await api('/models/fake','PUT',payload);
      else await api(model?.id?`/models/${model.id}`:'/models',model?.id?'PUT':'POST',payload);
      await loadModels();await loadSettings();onBack();
    }catch(e){setError((e as Error).message);}finally{setSaving(false);}
  };
  return <form className="model-editor model-config-form" onSubmit={e=>{e.preventDefault();void save();}}>
    <div className="model-editor-heading"><button type="button" className="back-link" disabled={saving} onClick={onBack}><ChevronLeft size={14}/>模型列表</button><h2>{model?.fixed ? '模拟模式' : model ? '编辑模型' : '添加模型'}</h2></div>
    <fieldset className="config-fields" disabled={saving}>{model?.fixed ? <label className="setting-row"><span className="setting-label">输出间隔</span><span className="setting-range"><input aria-label="模拟输出间隔" type="range" min="0" max="100" step="5" value={delay} onChange={e=>setDelay(Number(e.target.value))}/><span>{delay} ms</span></span></label> : <>
      <label className="setting-row"><span className="setting-label">Base URL</span><input aria-label="Base URL" type="url" required value={baseUrl} onChange={e=>{setBaseUrl(e.target.value);resetDiscovery();}}/></label>
      <div className="setting-row"><label className="setting-label" htmlFor="model-api-key">API Key</label><div className="model-input-action"><input id="model-api-key" aria-label="API Key" type="password" autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);setClearKey(false);resetDiscovery();}} placeholder={hasKey && !clearKey ? '已配置；留空保持' : '输入 API Key'}/><button type="button" className="icon-button" aria-label="清除密钥" title="清除密钥" disabled={!key && (!hasKey || clearKey)} onClick={()=>{setKey('');setClearKey(true);resetDiscovery();}}><X size={14}/></button></div></div>
      <div className="setting-row"><label className="setting-label" htmlFor="model-id">模型 ID</label><div className="model-id-controls"><div className="model-input-action"><input id="model-id" aria-label="模型 ID" required value={modelId} onChange={e=>changeModel(e.target.value)} placeholder="输入或选择模型 ID"/><button type="button" className="icon-button" aria-label="读取模型列表" title="读取模型列表" aria-expanded={showModels} disabled={fetching || !baseUrl} onClick={()=>void readModels()}><RefreshCw size={14} className={fetching?'model-discovery-loading':''}/></button></div>{showModels && <select autoFocus aria-label="选择发现的模型" value="" onChange={e=>{changeModel(e.target.value);setShowModels(false);}}><option value="" disabled>选择模型</option>{discovered.map(id=><option key={id} value={id}>{id}</option>)}</select>}</div></div>
      <label className="setting-row"><span className="setting-label">显示名称</span><input aria-label="显示名称" required value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="setting-row"><span className="setting-label">上下文长度</span><span className="model-context-input"><input aria-label="上下文长度" type="number" min="256" max="10000000" step="1" required value={contextLength} onChange={e=>setContextLength(e.target.value)}/><span>token</span></span></label>
      <label className="setting-row"><span className="setting-label">支持图片输入</span><input className="setting-toggle" type="checkbox" checked={vision} onChange={e=>setVision(e.target.checked)}/></label>
      <details className="model-advanced"><summary>高级设置</summary><table className="parameter-table"><thead><tr><th>启用</th><th>参数</th><th>值</th><th/></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><input type="checkbox" aria-label={`启用参数 ${i+1}`} checked={r.enabled} onChange={e=>setRows(rows.map((row,j)=>j===i?{...row,enabled:e.target.checked}:row))}/></td><td><input aria-label={`参数名 ${i+1}`} value={r.key} onChange={e=>setRows(rows.map((row,j)=>j===i?{...row,key:e.target.value}:row))}/></td><td><input aria-label={`参数值 ${i+1}`} value={r.raw} onChange={e=>setRows(rows.map((row,j)=>j===i?{...row,raw:e.target.value}:row))}/></td><td><button type="button" className="icon-button" aria-label={`删除参数 ${i+1}`} onClick={()=>setRows(rows.filter((_,j)=>i!==j))}><Trash2 size={13}/></button></td></tr>)}</tbody></table><button type="button" className="secondary-button" onClick={()=>setRows([...rows,{key:'',raw:'',enabled:true}])}><Plus size={13}/>添加参数</button><p className="parameter-hint">仅启用的参数发送给模型。</p></details>
    </>}
    </fieldset>{error&&<p className="config-error" role="alert">{error}</p>}
    <div className="model-editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onBack}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving?'保存中…':'保存模型'}</button></div>
  </form>;
}
