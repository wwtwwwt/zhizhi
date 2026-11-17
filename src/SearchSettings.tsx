import { useState } from 'react';
import { Globe, SlidersHorizontal, X } from 'lucide-react';
import { api, loadSearchSettings, useAppState } from './client';
import { WindowPanel } from './WindowPanel';
import { searchProviderNames, type SearchProvider } from '../shared/search';
export function SearchSettings() {
  const state = useAppState();
  const [open,setOpen]=useState(false),[provider,setProvider]=useState<SearchProvider>('deepseek'),[key,setKey]=useState(''),[clear,setClear]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const configured=state.searchSettings?.configuredProviders[provider];
  const begin=()=>{setProvider(state.searchSettings?.provider || 'deepseek');setKey('');setClear(false);setError('');setOpen(true);};
  const descriptions={deepseek:'使用 DeepSeek Search 和 Fetch 搜索、读取网页。',tavily:'使用 Tavily Search 和 Extract 搜索、读取网页。',exa:'使用 Exa 官方 MCP 搜索、读取网页。可免密钥试用；有免费限额，网络或额度受限时请填写 Exa API Key。不需要配置 MCP 地址。'};
  return <section className="search-provider-settings"><div className="model-list-heading"><span>联网搜索</span></div><div className="model-row"><button onClick={begin}><strong><Globe size={14}/>{state.searchSettings?.configured ? searchProviderNames[state.searchSettings.provider] : '选择搜索服务'}</strong><span>{state.searchSettings?.configured ? '已配置 · 搜索与网页读取' : '配置后可在对话框启用联网'}</span></button><button className="icon-button" aria-label="配置联网搜索" title="配置联网搜索" onClick={begin}><SlidersHorizontal size={14}/></button></div>{open && <WindowPanel title="联网搜索" onClose={()=>{if(!busy)setOpen(false);}}><form className="model-editor model-config-form" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await api('/search-settings','PUT',{provider,apiKey:key,clear});await loadSearchSettings();setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <label className="setting-row"><span>搜索服务</span><select aria-label="搜索服务" disabled={busy} value={provider} onChange={event=>{setProvider(event.target.value as SearchProvider);setKey('');setClear(false);setError('');}}>{Object.entries(searchProviderNames).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
    <p className="model-form-intro">{descriptions[provider]} 支持工具调用的对话模型均可使用。</p>
    <div className="setting-row"><label htmlFor="search-key">API Key{provider==='exa'?'（可选）':''}</label><div className="model-input-action"><input id="search-key" aria-label="联网搜索 API Key" autoComplete="off" type="password" value={key} disabled={busy} placeholder={configured && !clear ? '已配置；留空保持' : provider==='exa' ? '留空使用免费限额，或填写 Exa API Key' : `填写 ${searchProviderNames[provider]} API Key`} onChange={event=>{setKey(event.target.value);setClear(false);}}/><button type="button" className="icon-button" aria-label="清除联网密钥" disabled={busy} onClick={()=>{setKey('');setClear(true);}}><X size={14}/></button></div></div>
    <p className="model-field-hint">切换服务会保留各自已保存的密钥。费用与额度以服务商为准，模型调用另计。本轮最多8次模型请求、12次工具操作、3分钟，停止按钮可随时取消。查询过程仅在本轮保留。</p>{error && <p role="alert" className="config-error">{error}</p>}<div className="model-editor-actions"><button className="secondary-button" type="button" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy?'保存中…':'保存'}</button></div>
  </form></WindowPanel>}</section>;
}
