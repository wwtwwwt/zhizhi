import { useEffect, useRef, useState } from 'react';
import { FileUp, FolderOpen, Link, LoaderCircle, ExternalLink } from 'lucide-react';
import { WindowPanel } from './WindowPanel';
import { api } from './client';
import { imageNodes, resourcePath } from '../shared/documents';
import type { DocumentImport as ImportData } from '../shared/documents';
import type { Session } from '../shared/types';

const imageFile = /\.(png|jpe?g|gif|webp|svg)$/i;
const base64 = (file: File) => new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(`无法读取 ${file.name}`)); reader.readAsDataURL(file); });
export function DocumentImport({ onClose, onImported }: { onClose: () => void; onImported: (session: Session) => Promise<void> }) {
  const [file,setFile] = useState<File | null>(null), [resources,setResources] = useState<File[]>([]), [url,setUrl] = useState('');
  const [native,setNative] = useState(false), [needsFolder,setNeedsFolder] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const folderRef = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory',''); void api<{available:boolean}>('/documents/picker').then(result=>setNative(result.available)).catch(()=>{}); return () => controller.current?.abort(); }, []);
  const folder = (files: File[]) => {
    const docs = files.filter(f=>/\.(md|markdown)$/i.test(f.name));
    if (!file && docs.length === 1) setFile(docs[0]);
    else if (file) { const matching = docs.filter(f=>f.name === file.name); if (matching.length === 1) setFile(matching[0]); }
    setResources(files.filter(f=>imageFile.test(f.name))); setError('');
  };
  const chooseFile = async () => {
    if (!native) { fileRef.current?.click(); return; }
    setBusy(true); setError('');
    try {
      const doc = await api<ImportData | null>('/documents/picker','POST'); if (!doc) return;
      setFile(new File([doc.markdown],doc.name,{type:'text/markdown'}));
      setResources(doc.resources.map(resource=>{
        const bytes = Uint8Array.from(atob(resource.data), c=>c.charCodeAt(0));
        const image = new File([bytes],resource.path.split('/').at(-1)!);
        Object.defineProperty(image,'webkitRelativePath',{value:resource.path}); return image;
      })); setNeedsFolder(false);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  const submit = async (kind: 'markdown'|'paper') => {
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
        if (missing.length) { setNeedsFolder(true); throw new Error(`缺少图片资源：${missing.slice(0,8).join('、')}。请选择 Markdown 所在文件夹。`); }
        if ([...selected.values()].some(f=>f.size>5*1024*1024) || [...selected.values()].reduce((n,f)=>n+f.size,0)>12*1024*1024) throw new Error('单张图片最多 5 MiB，总计最多 12 MiB');
        session = await api<Session>('/documents/import','POST',{name:file.name,markdown,documentPath:path,resources:await Promise.all([...selected].map(async ([path,f])=>({path,data:await base64(f)})))});
      }
      await onImported(session); onClose();
    } catch(e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <WindowPanel title="导入文档" onClose={onClose}><div className="document-import-form document-import-grid">
    <section className="import-markdown-panel"><h3><FileUp size={16}/>Markdown 文档</h3>
      <input ref={fileRef} aria-label="Markdown 文件" type="file" accept=".md,.markdown,text/markdown" hidden disabled={busy} onChange={e=>{setFile(e.target.files?.[0] || null);setResources([]);setNeedsFolder(false);setError('');}}/>
      <div className="import-file-row"><button className="secondary-button" disabled={busy} onClick={()=>void chooseFile()}>选择 Markdown 文件</button><span className="import-filename">{file?.name || '未选择文件'}</span></div>
      <input ref={folderRef} id="document-resource-folder" aria-label="文档文件夹" type="file" multiple hidden disabled={busy} onChange={e=>folder(Array.from(e.target.files || []))}/>
      {needsFolder && <div className="document-resource-actions"><button className="secondary-button" disabled={busy} onClick={()=>folderRef.current?.click()}><FolderOpen size={14}/>选择文件夹</button><span>选择 Markdown 所在文件夹以补全图片</span></div>}
      <div className="document-import-actions"><button className="primary-button" disabled={busy || !file} onClick={()=>void submit('markdown')}>{busy ? <LoaderCircle size={14} className="import-spinner"/> : null}导入 Markdown</button></div>
    </section>
    <section className="import-paper-panel"><h3><Link size={16}/>论文链接</h3><form onSubmit={e=>{e.preventDefault();void submit('paper');}}><label className="field">论文链接或 arXiv ID<input aria-label="论文链接或 arXiv ID" value={url} disabled={busy} onChange={e=>{setUrl(e.target.value);setError('');}} placeholder="arxiv.org/abs/…"/></label><div className="document-import-actions"><button className="primary-button" disabled={busy || !url.trim()}>导入论文</button></div></form></section>
    <section className="import-convert-panel"><h3><ExternalLink size={16}/>其他文档</h3><p className="import-hint">先使用 MinerU 将 PDF 等文档转换为 Markdown，再回来导入。</p><a className="secondary-button" href="https://mineru.net/OpenSourceTools/Extractor" target="_blank" rel="noreferrer">前往转换<ExternalLink size={13}/></a></section>
    {busy && <p className="import-hint" role="status">正在导入…</p>}{error && <p role="alert" className="import-error">{error}</p>}
  </div></WindowPanel>;
}
export function ImportActions({ onImported }: { onImported: (session:Session)=>Promise<void> }) {
  const [open,setOpen] = useState(false);
  return <><div className="suggestions import-actions"><button onClick={()=>setOpen(true)}><FileUp size={16}/>导入文档</button></div>{open && <DocumentImport onClose={()=>setOpen(false)} onImported={onImported}/>}</>;
}
