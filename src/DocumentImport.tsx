import { useEffect, useRef, useState } from 'react';
import { FileUp, FolderOpen, Link, LoaderCircle } from 'lucide-react';
import { WindowPanel } from './WindowPanel';
import { api } from './client';
import { imageNodes, resourcePath } from '../shared/documents';
import type { Session } from '../shared/types';

const imageFile = /\.(png|jpe?g|gif|webp|svg)$/i;
const base64 = (file: File) => new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(`无法读取 ${file.name}`)); reader.readAsDataURL(file); });
export function DocumentImport({ kind, onClose, onImported }: { kind: 'markdown' | 'paper'; onClose: () => void; onImported: (session: Session) => Promise<void> }) {
  const [file,setFile] = useState<File | null>(null), [resources,setResources] = useState<File[]>([]), [url,setUrl] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const folderRef = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory',''); return () => controller.current?.abort(); }, []);
  const folder = (files: File[]) => {
    const docs = files.filter(f=>/\.(md|markdown)$/i.test(f.name));
    if (!file && docs.length === 1) setFile(docs[0]);
    else if (file) { const matching = docs.filter(f=>f.name === file.name); if (matching.length === 1) setFile(matching[0]); }
    setResources(files.filter(f=>imageFile.test(f.name))); setError('');
  };
  const submit = async () => {
    setBusy(true); setError('');
    try {
      let session: Session;
      if (kind === 'paper') {
        controller.current = new AbortController();
        const response = await fetch('/api/documents/paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.current.signal});
        const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || '导入失败'); session = data;
      } else {
        if (!file) throw new Error('请选择 Markdown 文件');
        if (file.size > 2 * 1024 * 1024) throw new Error('Markdown 文件最多 2 MiB');
        const markdown = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
        const nodes = imageNodes(markdown), path = file.webkitRelativePath || file.name;
        const parent = path.includes('/') ? path.slice(0,path.lastIndexOf('/')+1) : '';
        const selected = new Map<string,File>(), missing: string[] = [];
        for (const n of nodes) {
          const ref = n.url || ''; if (/^https?:|^data:/i.test(ref)) continue;
          const wanted = resourcePath(parent+ref), relative = resourcePath(ref);
          const matches = resources.filter(f=>resourcePath(f.webkitRelativePath || f.name) === wanted || resourcePath(f.webkitRelativePath || f.name) === relative);
          // A flat multi-file picker does not provide directory paths. Match a
          // basename only when exactly one selected file can fill the reference.
          const fallback = matches.length ? matches : resources.filter(f=>!f.webkitRelativePath && f.name === relative.split('/').at(-1));
          if (fallback.length !== 1) { missing.push(ref); continue; }
          selected.set(wanted || relative,fallback[0]);
        }
        if (missing.length) throw new Error(`缺少图片资源：${missing.slice(0,8).join('、')}。请补选图片文件或所在文件夹。`);
        if ([...selected.values()].some(f=>f.size>5*1024*1024) || [...selected.values()].reduce((n,f)=>n+f.size,0)>12*1024*1024) throw new Error('单张图片最多 5 MiB，总计最多 12 MiB');
        session = await api<Session>('/documents/import','POST',{name:file.name,markdown,documentPath:path,resources:await Promise.all([...selected].map(async ([path,f])=>({path,data:await base64(f)})))});
      }
      await onImported(session); onClose();
    } catch(e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <WindowPanel title={kind === 'markdown' ? '导入 Markdown' : '导入论文'} onClose={onClose}><form className="document-import-form" onSubmit={e=>{e.preventDefault();void submit();}}>
    {kind === 'markdown' ? <>
      <label className="field">Markdown 文件<input aria-label="Markdown 文件" type="file" accept=".md,.markdown,text/markdown" disabled={busy} onChange={e=>{setFile(e.target.files?.[0] || null);setError('');}}/></label>
      {file && <div className="import-filename">{file.name}</div>}
      <div className="document-resource-actions"><label className="secondary-button"><FileUp size={14}/>添加图片<input aria-label="文档图片" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg" multiple hidden disabled={busy} onChange={e=>{const files=Array.from(e.target.files || []);setResources(prev=>[...new Map([...prev,...files].map(f=>[f.webkitRelativePath || f.name,f])).values()]);setError('');e.target.value='';}}/></label><label className="secondary-button"><FolderOpen size={14}/>选择文件夹<input ref={folderRef} aria-label="文档文件夹" type="file" multiple hidden disabled={busy} onChange={e=>folder(Array.from(e.target.files || []))}/></label><span>{resources.length ? `${resources.length} 张图片` : ''}</span></div>
      <p className="import-hint">文档引用本地图片时，请一并选择图片或所在文件夹。</p>
    </> : <label className="field">论文链接或 arXiv ID<input aria-label="论文链接或 arXiv ID" autoFocus value={url} disabled={busy} onChange={e=>{setUrl(e.target.value);setError('');}} placeholder="https://arxiv.org/abs/1706.03762"/><span className="import-hint">通过 InkToMd 转为 Markdown，可能需要一至两分钟。</span></label>}
    {error && <p role="alert" className="import-error">{error}</p>}
    <div className="document-import-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || (kind === 'markdown' ? !file : !url.trim())}>{busy ? <><LoaderCircle size={14} className="import-spinner"/>导入中…</> : '导入'}</button></div>
  </form></WindowPanel>;
}
export function ImportActions({ onImported }: { onImported: (session:Session)=>Promise<void> }) {
  const [kind,setKind] = useState<'markdown'|'paper'|null>(null);
  return <><div className="suggestions import-actions"><button onClick={()=>setKind('markdown')}><FileUp size={16}/>导入 Markdown</button><button onClick={()=>setKind('paper')}><Link size={16}/>导入论文链接</button></div>{kind && <DocumentImport kind={kind} onClose={()=>setKind(null)} onImported={onImported}/>}</>;
}
