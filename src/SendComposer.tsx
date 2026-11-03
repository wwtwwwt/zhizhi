import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Image, FileText, X, ChevronDown, Check, Settings } from 'lucide-react';
import { api, loadSettings, notify, useAppState } from './client';
import { estimateText, modelBudget, type AttachmentInput, type SendOptions } from '../shared/models';

import { onRestoreQuestion, takeQuestion } from './composer-drafts';

type Draft = { text: string; attachments: AttachmentInput[]; modelId?: string };
const drafts = new Map<string, Draft>();
// Model selection outlives clearing a submitted draft and remains local to each composer.
const selectedModels = new Map<string, string>();
export function composerModelId(draftKey: string) { return selectedModels.get(draftKey); }
export function SendComposer({ draftKey, streamId, sourceNodeId, quote = '', busy, label, placeholder, sendLabel = '发送问题', onSend, onStop, autoFocus = false, noteMode = false, onCancel }: { noteMode?: boolean; onCancel?: () => void; draftKey: string; streamId?: string; sourceNodeId?: string; quote?: string; busy?: boolean; label: string; placeholder?: string; sendLabel?: string; onSend: (text: string, options: SendOptions) => Promise<boolean>; onStop?: () => void; autoFocus?: boolean }) {
  const state = useAppState(), initial = drafts.get(draftKey);
  const rememberedModel = (() => { try { return localStorage.getItem('lastModelId') || 'fake'; } catch { return 'fake'; } })();
  const [text,setText] = useState(initial?.text || ''), [attachments,setAttachments] = useState<AttachmentInput[]>(initial?.attachments || []), [modelId,setModelId] = useState(initial?.modelId || rememberedModel);
  const [submitting,setSubmitting] = useState(false), [reading,setReading] = useState(false), [open,setOpen] = useState(false), [used,setUsed] = useState(80);
  const input = useRef<HTMLTextAreaElement>(null), imageInput = useRef<HTMLInputElement>(null), textInput = useRef<HTMLInputElement>(null), selector = useRef<HTMLDivElement>(null);
  const model = state.models.find(m=>m.id===modelId) || state.models[0];
  useLayoutEffect(() => { if (!noteMode && model) selectedModels.set(draftKey, model.id); }, [draftKey, model?.id, noteMode]);
  useEffect(()=>{ drafts.set(draftKey,{text,attachments,modelId:model?.id}); },[draftKey,text,attachments,model?.id]);
  useEffect(() => {
    const restore = (key: string) => {
      if (key !== draftKey) return;
      const question = takeQuestion(key); if (!question) return;
      setText(current => [question.text, current].filter(Boolean).join('\n\n'));
      setAttachments(current => [...question.attachments, ...current]);
      requestAnimationFrame(() => input.current?.focus());
    };
    const unsubscribe = onRestoreQuestion(restore); restore(draftKey); return unsubscribe;
  }, [draftKey]);
  const stream = streamId ? state.streams[streamId] : undefined;
  useEffect(()=>{let active=true;if(noteMode || !streamId){setUsed(80);return;} void api<{used:number}>(`/streams/${streamId}/context${sourceNodeId?`?sourceNodeId=${sourceNodeId}`:''}`).then(result=>{if(active)setUsed(result.used);}).catch(()=>{});return()=>{active=false;};},[streamId,sourceNodeId,stream,noteMode]);
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!selector.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
  useLayoutEffect(()=>{const el=input.current;if(el){el.style.height='24px';el.style.height=`${Math.min(el.scrollHeight,140)}px`;}},[text]);
  const budget = model ? modelBudget(model) : {limit:128000,output:4096};
  const projected = used + estimateText(text) + estimateText(quote) + attachments.reduce((n,a)=>n+(a.kind==='image'?1536:estimateText(a.data)+16),0);
  const remaining = Math.max(0,budget.limit-projected-budget.output), ratio=Math.min(1,(projected+budget.output)/budget.limit);
  const badImages = attachments.some(a=>a.kind==='image') && !model?.supportsImages;
  const disabled = !!busy || submitting || (noteMode ? !text.trim() : reading || !model || (!text.trim() && !attachments.length) || badImages || remaining === 0);
  const submit=async()=>{if(disabled)return;setSubmitting(true);try{if(await onSend(text.trim(),noteMode ? {} : {modelId:model!.id,attachments})){setText('');setAttachments([]);drafts.delete(draftKey);}}finally{setSubmitting(false);}};
  const readingFiles = useRef(false);
  const addFiles=async(files:FileList|File[]|null,requestedKind?:'image'|'text')=>{if(!files?.length || noteMode)return;if(readingFiles.current){notify('文件正在读取，请稍候');return;}readingFiles.current=true;setReading(true);try{
    const next:AttachmentInput[]=[];
    for(const file of Array.from(files)){
      const kind = requestedKind || (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name) ? 'image' : 'text');
      if(kind==='image'){
        if(!model?.supportsImages)throw new Error('当前模型不支持图片输入，请切换模型');
        if(!/\.(png|jpe?g)$/i.test(file.name)||!['image/png','image/jpeg'].includes(file.type))throw new Error('仅支持 JPG 和 PNG 图片');
        if(file.size>5*1024*1024)throw new Error('单张图片最多 5 MiB');
        const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve((r.result as string).split(',')[1]);r.onerror=()=>reject(new Error('图片读取失败'));r.readAsDataURL(file);});
        next.push({name:file.name,kind,mime:file.type,data});
      }else{
        if(/\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|epub|zip|rar|7z)$/i.test(file.name))throw new Error('仅支持纯文本附件，其他文档请先使用 MinerU 转换为 Markdown');
        if(file.size>1024*1024)throw new Error('单个文本附件最多 1 MiB');
        let data:string;try{data=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw new Error('附件需要为 UTF-8 纯文本');}
        if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data))throw new Error('不能添加二进制文件');
        next.push({name:file.name,kind,mime:'text/plain',data});
      }
    }
    if(attachments.length+next.length>6)throw new Error('每条消息最多 6 个附件');
    if([...attachments,...next].reduce((n,a)=>n+(a.kind==='image'?a.data.length*.75:new TextEncoder().encode(a.data).length),0)>12*1024*1024)throw new Error('附件总计最多 12 MiB');
    setAttachments(a=>[...a,...next]);
  }catch(e){notify((e as Error).message);}finally{readingFiles.current=false;setReading(false);if(imageInput.current)imageInput.current.value='';if(textInput.current)textInput.current.value='';}};
  return <form className="composer unified-composer" onDragOver={e=>{if(!noteMode && e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();if(!noteMode)void addFiles(e.dataTransfer.files);}} onPaste={e=>{const files=Array.from(e.clipboardData.items).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(!files.length || noteMode)return;e.preventDefault();const pasted=e.clipboardData.getData('text/plain');if(pasted)setText(current=>current+pasted);void addFiles(files);}} onSubmit={e=>{e.preventDefault();void submit();}}>
    {attachments.length>0&&<div className="draft-attachments">{attachments.map((a,i)=><div className="attachment-chip" key={i}>{a.kind==='image'&&<img src={`data:${a.mime};base64,${a.data}`} alt={a.name}/>}<span>{a.name}</span><button type="button" aria-label={`移除附件：${a.name}`} onClick={()=>setAttachments(attachments.filter((_,j)=>i!==j))}><X size={12}/></button></div>)}</div>}
    <textarea ref={input} autoFocus={autoFocus} aria-label={label} rows={1} value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} onKeyDown={e=>{if(!noteMode&&e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&((state.settings?.sendShortcut || 'enter') === 'mod-enter' ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey)){e.preventDefault();void submit();}}}/>
    <div className="composer-controls">{noteMode ? <div className="note-composer-actions"><button type="button" className="secondary-button" disabled={submitting || busy} onClick={onCancel}>取消</button><button type="submit" className="primary-button" disabled={disabled}>保存笔记</button></div> : <><div className="attachment-controls">{model?.supportsImages&&<button type="button" className="icon-button" aria-label="添加图片附件" title="图片附件：JPG、PNG" disabled={reading||submitting} onClick={()=>imageInput.current?.click()}><Image size={16}/></button>}<button type="button" className="icon-button" aria-label="添加文本附件" title="文本附件：TXT、MD、代码；其他文档请先用 MinerU 转换：https://mineru.net/OpenSourceTools/Extractor" disabled={reading||submitting} onClick={()=>textInput.current?.click()}><FileText size={16}/></button><input hidden type="file" multiple ref={imageInput} aria-label="图片附件" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={e=>void addFiles(e.target.files,'image')}/><input hidden type="file" multiple ref={textInput} aria-label="文本附件" accept="text/*,.txt,.md,.markdown,.py,.js,.jsx,.ts,.tsx,.json,.jsonl,.yaml,.yml,.toml,.csv,.c,.cpp,.h,.hpp,.rs,.go,.java,.sh,.sql,.tex,.css,.html,.xml,.ipynb,.r,.R,.swift,.kt,.vue,.svelte,.log,.ini,.cfg" onChange={e=>void addFiles(e.target.files,'text')}/></div>
    <div className="composer-send-controls"><button type="button" className={`context-meter ${remaining===0?'exhausted':''}`} aria-label="上下文余量"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity=".18"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${ratio*50.27} 50.27`} transform="rotate(-90 12 12)"/></svg><span role="tooltip" className="context-tooltip">估算剩余 {remaining.toLocaleString()} / {budget.limit.toLocaleString()} token<br/>输入约 {projected.toLocaleString()} · 预留输出 {budget.output.toLocaleString()}</span></button><div ref={selector} className="model-selector" onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);}}}><button className="model-switch" type="button" aria-label="切换模型" aria-expanded={open} onClick={()=>setOpen(!open)} title={model?.name}>{model?.name||'选择模型'}<ChevronDown size={12}/></button>{open&&<div role="menu" aria-label="模型切换" className="composer-model-menu">{state.models.map(m=><button type="button" role="menuitemradio" aria-checked={model?.id===m.id} key={m.id} onClick={()=>{try { localStorage.setItem('lastModelId',m.id); } catch {} setModelId(m.id);setOpen(false);}}>{m.name}{model?.id===m.id&&<Check size={13}/>}</button>)}<div className="menu-separator" role="separator"/><button type="button" role="menuitem" className="manage-models-link" onClick={()=>{setOpen(false);history.pushState({},'','/settings');window.dispatchEvent(new PopStateEvent('popstate'));}}><Settings size={13}/>供应商</button></div>}</div>{onStop?<button type="button" className="send-button stop" aria-label="停止生成" onClick={onStop}><Square size={13} fill="currentColor"/></button>:<button type="submit" className="send-button" aria-label={sendLabel} disabled={disabled} title={badImages?'请移除图片或选择支持图片的模型':remaining===0?'上下文预算不足':sendLabel}><ArrowUp size={17}/></button>}</div></>}</div>
  </form>;
}
