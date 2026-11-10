import { createPortal } from 'react-dom';
import { nativeSidebarSupported } from './desktop';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Database, Settings, Cpu, RefreshCw, Info, SlidersHorizontal } from 'lucide-react';
import { api, patch, notify, useAppState, loadUpdateStatus, checkUpdates } from './client';
import { AutoSaveStatus } from './AutoSaveStatus';
import { useAutoSave } from './useAutoSave';
import { ModelManager } from './ModelManager';
import { WindowPanel } from './WindowPanel';
import { dialogSizeKey } from './useCenteredResize';
import brandMark from './assets/zhizhi-mark.svg';
import { releaseVersion, releasesUrl } from '../shared/updates';
import type { StorageInfo } from '../shared/types';

export function SettingsPage({onBack,sidebar}:{onBack:()=>void;sidebar:HTMLElement | null}) {
  const state=useAppState();
  const [tab,setTab]=useState<'models'|'general'|'data'|'about'|'personalization'>(new URLSearchParams(location.search).get('tab') === 'about' ? 'about' : 'models');
  const tabs=[{id:'models' as const,name:'供应商',Icon:Cpu},{id:'general' as const,name:'通用',Icon:Settings},{id:'personalization' as const,name:'系统提示词',Icon:SlidersHorizontal},{id:'data' as const,name:'数据',Icon:Database},{id:'about' as const,name:'关于',Icon:Info}];
  return <div className="settings-page settings-layout"><header className="settings-page-header"><h1>设置</h1></header><div className="settings-columns">{sidebar && createPortal(<><div className="settings-return"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/>回到对话</button></div><nav role="tablist" aria-label="设置分类" aria-orientation="vertical" className="settings-tabs">{tabs.map(({id,name,Icon})=><button key={id} id={`settings-tab-${id}`} role="tab" aria-selected={tab===id} aria-controls={`settings-panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const index=tabs.findIndex(t=>t.id===id);const target=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length].id;setTab(target);document.getElementById(`settings-tab-${target}`)?.focus();}}}><Icon size={15}/>{name}</button>)}</nav></>, sidebar)}<section className="settings-tab-content" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}><h2>{tabs.find(t=>t.id===tab)!.name}</h2>{tab==='models'?<ModelManager/>:tab==='general'?(state.settings?<GeneralSettings/>:<div className="loading-label">正在读取设置…</div>):tab==='personalization'?<PersonalizationSettings/>:tab==='data'?<DataSettings/>:<AboutSettings/>}</section></div></div>;
}
function PersonalizationSettings(){
  const state=useAppState();
  const [defaultPrompt,setDefaultPrompt]=useState<string | null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;void api<{defaultPrompt:string}>('/settings/reply-system').then(value=>{if(active)setDefaultPrompt(value.defaultPrompt);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  return state.settings && defaultPrompt !== null ? <PromptEditor defaultPrompt={defaultPrompt}/> : <p className="loading-label">{error || '正在读取提示词…'}</p>;
}
function PromptEditor({defaultPrompt}:{defaultPrompt:string}){
  const state=useAppState();
  const [value,setValue]=useState<string | null>(state.settings!.replySystem);
  const auto=useAutoSave(value,async replySystem=>{await api('/settings','PUT',{replySystem});});
  const change=(replySystem:string | null)=>{setValue(replySystem);if(state.settings)patch({settings:{...state.settings,replySystem}});};
  return <div className="personalization-settings"><div className="prompt-editor-heading"><label htmlFor="reply-system-editor">自定义指令</label><button className="secondary-button" disabled={value===null} onClick={()=>change(null)}><RefreshCw size={13}/>恢复默认</button></div><textarea id="reply-system-editor" aria-label="系统提示词" className="prompt-editor" spellCheck={false} maxLength={32000} value={value ?? defaultPrompt} onChange={e=>change(e.target.value)} onBlur={()=>void auto.flush()}/><AutoSaveStatus status={auto.status} error={auto.error}/></div>;
}
function GeneralSettings(){
  const state=useAppState();
  const [values,setValues]=useState(()=>({sidebarBlur:state.settings?.sidebarBlur === true,blurBackdrop:state.settings?.blurBackdrop === true,autoScroll:state.settings?.autoScroll !== false,theme:state.settings?.theme || 'system',nickname:state.settings?.nickname || '你',stackDirection:state.settings?.stackDirection || 'up',fontSize:state.settings?.fontSize || 15,sendShortcut:state.settings?.sendShortcut || 'enter',confirmDeletion:state.settings?.confirmDeletion !== false}));
  const {sidebarBlur,blurBackdrop,autoScroll,theme,nickname,stackDirection:direction,fontSize,sendShortcut:shortcut,confirmDeletion}=values;
  const payload={...values,...(!nickname.trim()?{nickname:state.settings?.nickname || '你'}:{nickname:nickname.trim()})};
  const delay=useRef(450);
  const auto=useAutoSave(payload,async value=>{await api('/settings','PUT',value);},delay.current);
  const change=(update:Partial<typeof values>)=>{delay.current=update.nickname===undefined?0:450;const next={...values,...update};setValues(next);if(state.settings)patch({settings:{...state.settings,...next,nickname:next.nickname.trim() || state.settings.nickname}});};
  return <form className="general-settings" onSubmit={e=>{e.preventDefault();void auto.flush();}} onBlur={()=>void auto.flush()}><label className="setting-row"><span className="setting-label">昵称</span><input aria-label="昵称" maxLength={40} required value={nickname} onChange={e=>change({nickname:e.target.value})}/></label><label className="setting-row"><span className="setting-label">外观</span><select aria-label="外观" value={theme} onChange={e=>change({theme:e.target.value as 'light'|'dark'|'system'})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="setting-row"><span className="setting-label">分支窗口堆叠方向</span><select aria-label="堆叠方向" value={direction} onChange={e=>change({stackDirection:e.target.value as 'up'|'left'})}><option value="up">向上</option><option value="left">向左</option></select></label><label className="setting-row"><span className="setting-label">正文文字大小</span><span className="setting-range"><input aria-label="正文文字大小" type="range" min="12" max="22" step="1" value={fontSize} onChange={e=>change({fontSize:Number(e.target.value)})}/><span>{fontSize} px</span></span></label><label className="setting-row"><span className="setting-label">发送快捷键</span><select aria-label="发送快捷键" value={shortcut} onChange={e=>change({sendShortcut:e.target.value as 'enter'|'mod-enter'})}><option value="enter">Enter 发送，Shift+Enter 换行</option><option value="mod-enter">Ctrl / ⌘ + Enter 发送，Enter 换行</option></select></label><label className="setting-row"><span className="setting-label">删除二次确认</span><input className="setting-toggle" aria-label="删除二次确认" type="checkbox" checked={confirmDeletion} onChange={e=>change({confirmDeletion:e.target.checked})}/></label><label className="setting-row"><span className="setting-label">生成时自动滚动</span><input className="setting-toggle" aria-label="生成时自动滚动" type="checkbox" checked={autoScroll} onChange={e=>change({blurBackdrop:state.settings?.blurBackdrop === true,autoScroll:e.target.checked})}/></label><label className="setting-row"><span className="setting-label">窗口背景模糊</span><input className="setting-toggle" aria-label="窗口背景模糊" type="checkbox" checked={blurBackdrop} onChange={e=>change({blurBackdrop:e.target.checked})}/></label><label className="setting-row"><span className="setting-label">侧栏系统模糊（Beta）</span><input className="setting-toggle" aria-label="侧栏系统模糊（Beta）" title={nativeSidebarSupported ? "使用系统原生模糊材质" : "仅支持 macOS 和 Windows 桌面版"} type="checkbox" disabled={!nativeSidebarSupported} checked={sidebarBlur} onChange={e=>change({sidebarBlur:e.target.checked})}/></label><AutoSaveStatus status={auto.status} error={!nickname.trim()?'昵称不能为空':auto.error}/></form>;

}
function size(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(2)} MiB`;}
function DataSettings(){
  const [info,setInfo]=useState<StorageInfo|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[confirm,setConfirm]=useState(false),[clearing,setClearing]=useState(false);
  const refresh=async()=>{setLoading(true);setError('');try{setInfo(await api<StorageInfo>('/storage'));}catch(e){setError((e as Error).message);}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[]);
  return <><div className="storage-details" inert={confirm}><div className="storage-heading"><span>存储信息</span><button className="icon-button" aria-label="刷新存储信息" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={14}/></button></div>{error&&<p role="alert">{error}</p>}{info?<><dl className="storage-summary"><dt>存储位置</dt><dd>{info.mode==='local'?(info.path || '本地数据目录'):'数据存储在浏览器缓存中'}</dd><dt>占用空间</dt><dd>{size(info.totalBytes)}</dd><dt>对话／消息</dt><dd>{info.sessions} / {info.messages}</dd><dt>内容块／分支</dt><dd>{info.blocks} / {info.branches}</dd><dt>附件及图片资源</dt><dd>{info.attachments}</dd><dt>自定义模型</dt><dd>{info.models}</dd></dl><table className="storage-files"><thead><tr><th>文件</th><th>大小</th></tr></thead><tbody>{info.files.map(f=><tr key={f.name}><td>{f.name}</td><td>{size(f.bytes)}</td></tr>)}</tbody></table></>:loading?<p>读取中…</p>:null}<section className="storage-clear"><button className="danger-button" onClick={()=>setConfirm(true)}>清除所有数据</button></section></div>{confirm&&<WindowPanel title="清除所有数据" onClose={()=>{if(!clearing)setConfirm(false);}}><div className="clear-data-confirm"><p>将永久删除全部对话、分支、笔记、内容块及历史版本、附件、模型配置与 API Key，并恢复默认设置。正在生成的任务会停止，此操作无法撤销。</p><div className="dialog-actions"><button className="secondary-button" disabled={clearing} onClick={()=>setConfirm(false)}>取消</button><button className="danger-button" disabled={clearing} onClick={async()=>{setClearing(true);try{await api('/storage','DELETE',{confirm:'DELETE_ALL_DATA'});localStorage.removeItem('lastSession');localStorage.removeItem(dialogSizeKey);localStorage.removeItem('expandedFolders');location.reload();}catch(e){notify((e as Error).message);setClearing(false);}}}>{clearing?'清除中…':'确认清除所有数据'}</button></div></div></WindowPanel>}</>;
}

function AboutSettings(){
  const state = useAppState();
  useEffect(() => { void loadUpdateStatus().catch(e => notify(e.message)); }, []);
  const update = state.updates;
  const release = update?.release;
  const checkedAt = update?.checkedAt ? new Date(update.checkedAt).toLocaleString() : '';
  return <div className="about-settings">
    <div className="about-brand"><img src={brandMark} width={52} height={52} alt="枝知图标"/><div><strong>枝知</strong><span>zhizhi</span></div></div>
    <dl className="about-details"><dt>版本</dt><dd>{releaseVersion || '开发版本'}</dd><dt>许可证</dt><dd>GNU AGPL-3.0-only</dd></dl>
    <section className="about-updates" aria-label="软件更新">
      <div className="update-heading"><strong>软件更新</strong><button className="secondary-button" disabled={!releaseVersion || state.checkingUpdates} onClick={() => void checkUpdates(true)}><RefreshCw size={13} className={state.checkingUpdates ? 'update-checking' : ''}/>{state.checkingUpdates ? '检查中…' : '检查更新'}</button></div>
      {state.settings && <UpdatePreference/>}
      {!releaseVersion ? <p className="update-status">开发版本不检查更新</p> : <>
        {update?.available && release ? <div className="release-card"><div><strong>新版本 {release.tag}</strong>{release.publishedAt && <time dateTime={release.publishedAt}>{new Date(release.publishedAt).toLocaleDateString()}</time>}</div>{release.name !== release.tag && <p>{release.name}</p>}{release.notes && <p className="release-notes">{release.notes}</p>}<a className="release-download" href={release.url} target="_blank" rel="noreferrer">前往 GitHub Release 下载 ↗</a></div> : update?.checkedAt && !update.error && <p className="update-status">当前已是最新版本</p>}
        {update?.error && <p className="update-error" role="alert">{update.error}</p>}
        {checkedAt && <p className="update-status">上次检查：{checkedAt}</p>}
      </>}
    </section>
    <a className="about-repository" href="https://github.com/wwtwwwt/zhizhi" target="_blank" rel="noreferrer">GitHub 仓库 <span aria-hidden="true">↗</span></a>
    {!release && releaseVersion && <a className="about-repository" href={releasesUrl} target="_blank" rel="noreferrer">GitHub Releases ↗</a>}
  </div>;
}
function UpdatePreference() {
  const state = useAppState();
  const [enabled, setEnabled] = useState(state.settings!.updateNotifications);
  const auto = useAutoSave({ updateNotifications: enabled }, async value => { await api('/settings', 'PUT', value); }, 0);
  return <div className="update-preference"><label className="setting-row"><span className="setting-label">新版本提醒</span><input className="setting-toggle" aria-label="新版本提醒" title="关闭后不再自动检查更新" type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); patch({ settings: { ...state.settings!, updateNotifications: e.target.checked } }); }}/></label><AutoSaveStatus status={auto.status} error={auto.error}/></div>;
}
