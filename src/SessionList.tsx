import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronRight, Folder as FolderIcon, FolderPlus, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, notify, refreshSessions, useAppState } from './client';
import type { Folder, Session } from '../shared/types';

type DragItem = { kind: 'folder' | 'session'; id: string };
const dragType = 'application/x-zhizhi-sidebar';
export function SessionList({ selectedId, onChoose, onManage }: { selectedId: string | null; onChoose: (id: string) => void; onManage: (session: Session, kind: 'rename' | 'delete') => void }) {
  const state = useAppState();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem('expandedFolders') || '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; } catch { return []; } });
  const [dialog, setDialog] = useState<{ kind: 'create' | 'rename' | 'delete'; folder?: Folder; parentId?: string | null } | null>(null);
  const [name, setName] = useState(''), [saving, setSaving] = useState(false), [dropTarget, setDropTarget] = useState('');
  const dragging = useRef<DragItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const endDrag = () => { dragging.current = null; setDropTarget(''); setIsDragging(false); };
  const canDrop = (item: DragItem, target: string) => {
    const beforeFolder = target.startsWith('before:') ? folders.find(f => f.id === target.slice(7)) : undefined;
    const beforeSession = state.sessions.find(s => s.id === target);
    const destination = beforeFolder ? beforeFolder.parent_id : beforeSession ? beforeSession.folder_id : target.startsWith('end:') ? target.slice(4) : ['root','recent'].includes(target) ? null : target;
    const folder = folders.find(f => f.id === destination);
    if (item.kind === 'folder') {
      const source = folders.find(f => f.id === item.id);
      if (target === 'recent' || beforeSession || beforeFolder?.id === item.id || destination === item.id) return false;
      if (folder && (folder.parent_id || folders.some(f => f.parent_id === item.id))) return false;
      return !source || !folders.some(f => f.id !== item.id && f.parent_id === destination && f.name === source.name);
    }
    return !beforeFolder && target !== 'root' && beforeSession?.id !== item.id;
  };
  const refresh = async () => setFolders(await api<Folder[]>('/folders'));
  useEffect(() => { void refresh().catch(e => notify(e.message)); }, []);
  useEffect(() => { localStorage.setItem('expandedFolders', JSON.stringify(expanded)); }, [expanded]);
  const toggle = (id: string) => setExpanded(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  const open = (value: NonNullable<typeof dialog>) => { setDialog(value); setName(value.kind === 'rename' ? value.folder!.name : ''); };
  const removeFolder = async (folder: Folder) => { try { await api(`/folders/${folder.id}`, 'DELETE'); await refresh(); await refreshSessions(); } catch (error) { notify((error as Error).message); } };
  const start = (e: DragEvent, item: DragItem) => { e.stopPropagation(); dragging.current = item; setIsDragging(true); e.dataTransfer.setData(dragType, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'move'; };
  const read = (e: DragEvent): DragItem | null => { try { const item = JSON.parse(e.dataTransfer.getData(dragType)); return ['folder', 'session'].includes(item.kind) && typeof item.id === 'string' ? item : null; } catch { return null; } };
  const over = (e: DragEvent, target: string) => {
    if (!e.dataTransfer.types.includes(dragType)) return;
    e.preventDefault(); e.stopPropagation();
    const item = dragging.current;
    const allowed = !!item && canDrop(item, target);
    e.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    setDropTarget(allowed ? target : '');
  };
  const drop = async (e: DragEvent, folderId: string | null, beforeSessionId?: string, beforeFolderId?: string) => {
    e.preventDefault(); e.stopPropagation(); const item = read(e);
    const target = beforeFolderId ? `before:${beforeFolderId}` : beforeSessionId || folderId || (item?.kind === 'folder' ? 'root' : 'recent');
    const invalid = !item || !canDrop(item, target); endDrag(); if (invalid || !item) return;
    if (item.id === beforeSessionId || item.id === beforeFolderId) return;
    try {
      if (item.kind === 'session') await api(`/sessions/${item.id}/move`, 'POST', { folderId, beforeId: beforeSessionId });
      else await api(`/folders/${item.id}/move`, 'POST', { parentId: folderId, beforeId: beforeFolderId });
      if (folderId) setExpanded(prev => [...new Set([...prev, folderId])]);
      await refresh(); await refreshSessions();
    } catch (error) { notify((error as Error).message); }
  };
  const sessionRow = (session: Session, inFolder: boolean) => <div className={`session-row ${selectedId === session.id ? 'active' : ''} ${dropTarget === session.id ? 'drop-before' : ''}`} key={session.id} draggable onDragStart={e => start(e, { kind: 'session', id: session.id })} onDragEnd={endDrag} onDragOver={inFolder ? e => over(e, session.id) : undefined} onDrop={inFolder ? e => void drop(e, session.folder_id!, session.id) : undefined}>
    <button className="session-link" onClick={() => onChoose(session.id)}><MessageSquare size={14}/><span>{session.title}</span></button>
    <div className="session-actions"><button className="icon-button" title="重命名" onClick={() => onManage(session, 'rename')}><Pencil size={13}/></button><button className="icon-button" title="删除对话" onClick={() => onManage(session, 'delete')}><Trash2 size={13}/></button></div>
  </div>;
  const renderFolder = (folder: Folder) => {
    const children = folders.filter(f => f.parent_id === folder.id);
    const sessions = state.sessions.filter(s => s.folder_id === folder.id).sort((a,b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
    const isOpen = expanded.includes(folder.id);
    return <div className="folder-entry" key={folder.id}>
      <div className={`folder-insert ${dropTarget === `before:${folder.id}` ? 'drop-before' : ''}`} aria-label={`移动到${folder.name}之前`} onDragOver={e => over(e, dragging.current?.kind === 'session' ? folder.id : `before:${folder.id}`)} onDrop={e => void (dragging.current?.kind === 'session' ? drop(e, folder.id) : drop(e, folder.parent_id, undefined, folder.id))}/>
      <div className={`folder-row ${dropTarget === folder.id ? 'drop-inside' : ''}`} draggable onDragStart={e => start(e, { kind: 'folder', id: folder.id })} onDragEnd={endDrag} onDragOver={e => over(e, folder.id)} onDrop={e => void drop(e, folder.id)}>
        <button className="folder-link" aria-expanded={isOpen} onClick={() => toggle(folder.id)}><ChevronRight className={isOpen ? 'expanded' : ''} size={12}/><FolderIcon size={14}/><span>{folder.name}</span></button>
        <div className="session-actions">{!folder.parent_id && <button className="icon-button" title="新建子文件夹" onClick={() => open({ kind: 'create', parentId: folder.id })}><FolderPlus size={13}/></button>}<button className="icon-button" title="重命名文件夹" onClick={() => open({ kind: 'rename', folder })}><Pencil size={13}/></button><button className="icon-button" title="删除文件夹" onClick={() => { if (state.settings?.confirmDeletion === false) void removeFolder(folder); else open({ kind: 'delete', folder }); }}><Trash2 size={13}/></button></div>
      </div>
      {isOpen && (children.length > 0 || sessions.length > 0) && <div className="folder-children">{children.map(renderFolder)}{sessions.map(s => sessionRow(s, true))}<div className={`folder-append ${dropTarget === `end:${folder.id}` ? 'drop-before' : ''}`} onDragOver={e => over(e, `end:${folder.id}`)} onDrop={e => void drop(e, folder.id)}/></div>}
    </div>;
  };
  return <><div className={`sidebar-lists ${isDragging ? 'dragging-sidebar' : ''}`} onDragOver={e => {
    // Rows and explicit insertion zones stop propagation. Empty padding is not a folder target.
    if (e.dataTransfer.types.includes(dragType)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; setDropTarget(''); }
  }} onDragLeave={e => {
    const underPointer = document.elementFromPoint(e.clientX, e.clientY);
    if (!underPointer || !e.currentTarget.contains(underPointer)) setDropTarget('');
  }}>
    <section className="folder-section"><div className="sidebar-label"><span>文件夹</span><button className="icon-button" title="新建文件夹" onClick={() => open({ kind: 'create', parentId: null })}><Plus size={13}/></button></div><nav className="folder-scroll" aria-label="文件夹">{folders.filter(f => !f.parent_id).map(renderFolder)} {folders.length > 0 && <div className={`folder-root-drop ${dropTarget === 'root' ? 'drop-inside' : ''}`} onDragOver={e => over(e, 'root')} onDrop={e => { if (read(e)?.kind === 'folder') void drop(e, null); else { e.preventDefault(); e.stopPropagation(); endDrag(); } }}/>}</nav></section>
    <section className="recent-section" onDragOver={e => over(e, 'recent')} onDrop={e => { const item = read(e); if (item?.kind === 'session') void drop(e, null); else { e.preventDefault(); endDrag(); } }}><div className="sidebar-label">最近对话</div><nav className="sessions" aria-label="对话列表">{state.sessions.filter(s => !s.folder_id).map(s => sessionRow(s, false))}{!state.sessions.some(s => !s.folder_id) && <p className="sidebar-empty">暂无对话</p>}</nav></section>
  </div>{dialog && <div className="manage-backdrop" onKeyDown={e => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); setDialog(null); } }}><form className="manage-dialog" role="dialog" aria-modal="true" aria-label={dialog.kind === 'delete' ? '删除文件夹' : dialog.kind === 'rename' ? '重命名文件夹' : '新建文件夹'} onSubmit={async e => { e.preventDefault(); if (saving) return; setSaving(true); try { if (dialog.kind === 'delete') await api(`/folders/${dialog.folder!.id}`, 'DELETE'); else await api(dialog.kind === 'create' ? '/folders' : `/folders/${dialog.folder!.id}`, dialog.kind === 'create' ? 'POST' : 'PATCH', { name: name.trim(), parentId: dialog.parentId }); if (dialog.parentId) setExpanded(prev => [...new Set([...prev, dialog.parentId!])]); await refresh(); await refreshSessions(); setDialog(null); } catch (error) { notify((error as Error).message); } finally { setSaving(false); } }}><h3>{dialog.kind === 'delete' ? `删除“${dialog.folder!.name}”？` : dialog.kind === 'rename' ? '重命名文件夹' : '新建文件夹'}</h3>{dialog.kind === 'delete' ? <p>其中的对话将移回最近对话，不会删除聊天内容。</p> : <input autoFocus aria-label="文件夹名称" required maxLength={80} value={name} onChange={e => setName(e.target.value)}/>}<div className="dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setDialog(null)}>取消</button><button className={dialog.kind === 'delete' ? 'danger-button' : 'primary-button'} disabled={saving || dialog.kind !== 'delete' && !name.trim()}>{dialog.kind === 'delete' ? '删除' : '确认'}</button></div></form></div>}</>;
}
