import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowUp, ArrowUpCircle, Check, ChevronLeft, ChevronRight, GitBranch, MessageSquare, GripVertical, Copy, History, StickyNote, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings as SettingsIcon, Sparkles, Square, Trash2, Files, FileText, X } from 'lucide-react';
import { api, cancelJob, deleteBranch, forgetStreams, loadSettings, loadModels, loadStream, notify, refreshSessions, runGeneration, useAppState } from './client';
import { createPortal } from 'react-dom';
import { useCenteredResize } from './useCenteredResize';
import { layoutSideItems, type Corner } from '../shared/workspace-layout';
import { releaseVersion } from '../shared/updates';
import { checkUpdates } from './client';
import { SessionList } from './SessionList';
import { ReeditQuestion } from './ReeditQuestion';
import { ReasoningPanel } from './ReasoningPanel';
import { SendComposer, composerModelId } from './SendComposer';
import { ImportActions } from './DocumentImport';
import { useSidebarMaterial } from './desktop';
import { useTheme } from './theme';
import { SettingsPage } from './SettingsPage';
import type { SendOptions } from '../shared/models';
import brandMark from './assets/zhizhi-mark.svg';
import { Markdown } from './Markdown';
import { StreamingMarkdown, MarkdownBlocks } from './StreamingMarkdown';
import { canonicalOffset, normalizeFormulaRange, copyMarkdownSelection, selectionMarkdown, syncFormulaSelection } from './selection';
import { expandMathSelection } from '../shared/markdown';
import type { Anchor, GenerationResult, Message, Session, Settings, Slot } from '../shared/types';

type Layer = { streamId: string; quote: string; branchId: string };
type SelectionData = { nodeId: string; streamId: string; start: number; end: number; text: string; raw: string; x: number; y: number };

const avatarSegmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
function userInitial(nickname?: string) {
  return Array.from(avatarSegmenter.segment(nickname?.trim() || '你'))[0]?.segment || '你';
}

export function App() {
  const state = useAppState();
  useTheme(state.settings?.theme);
  useSidebarMaterial(state.settings?.sidebarBlur === true);
  const checkedOnStartup = useRef(false);
  useEffect(() => {
    if (!state.settings || checkedOnStartup.current) return;
    checkedOnStartup.current = true;
    if (releaseVersion && state.settings.updateNotifications) void checkUpdates();
  }, [state.settings]);
  const [sessionId, setSessionId] = useState<string | null>(localStorage.getItem('lastSession'));
  const [stack, setStack] = useState<Layer[]>([]);
  const [closingFrom, setClosingFrom] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTarget = useRef<number | null>(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const resetLayers = () => { clearTimeout(closeTimer.current); closeTarget.current = null; setClosingFrom(null); setStack([]); };
  const [selection, setSelection] = useState<SelectionData | null>(null);
  const [askOpen, setAskOpen] = useState(false), [noteMode, setNoteMode] = useState(false), [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsSidebar,setSettingsSidebar]=useState<HTMLDivElement | null>(null);
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [page, setPage] = useState(location.pathname === '/settings' ? 'settings' : 'chat');
  const [manage, setManage] = useState<{ session: Session; kind: 'rename' | 'delete' } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const session = state.sessions.find(s => s.id === sessionId);
  useEffect(() => { void refreshSessions().catch(e => notify(e.message)); void loadSettings().catch(e => notify(e.message)); void loadModels().catch(e => notify(e.message)); const pop = () => { setPage(location.pathname === '/settings' ? 'settings' : 'chat'); resetLayers(); setSelection(null); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => { if (session) void loadStream(session.root_stream_id).catch(e => notify(e.message)); }, [session?.root_stream_id]);
  useEffect(() => { const update = () => syncFormulaSelection(document.body); document.addEventListener('selectionchange', update); return () => document.removeEventListener('selectionchange', update); }, []);
  const navigate = (next: string) => { if (next === 'about' || next === 'settings') setSettingsVisit(value => value + 1); history.pushState({}, '', next === 'about' ? '/settings?tab=about' : next === 'settings' ? '/settings' : '/'); setPage(next === 'about' ? 'settings' : next); setSelection(null); resetLayers(); };
  const chooseSession = (id: string | null) => { setSessionId(id); if (id) localStorage.setItem('lastSession', id); else localStorage.removeItem('lastSession'); resetLayers(); setSelection(null); if (page !== 'chat') navigate('chat'); };
  const openBranch = (anchor: Anchor, parentDepth: number) => { clearTimeout(closeTimer.current); closeTarget.current = null; setClosingFrom(null); setSelection(null); setAskOpen(false); window.getSelection()?.removeAllRanges(); setStack(prev => [...prev.slice(0, parentDepth), { streamId: anchor.stream_id, quote: anchor.selected_text, branchId: anchor.id }]); void loadStream(anchor.stream_id).catch(e => notify(e.message)); };
  const closeTo = (requested: number) => {
    const length = Math.min(requested, closeTarget.current === null ? stack.length : Math.max(0, closeTarget.current - 1));
    const closing = stack[length];
    clearTimeout(closeTimer.current); closeTarget.current = length;
    setClosingFrom(length); setSelection(null);
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
    closeTimer.current = setTimeout(() => {
      setStack(prev => prev.slice(0, length)); setClosingFrom(null); closeTarget.current = null;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-branch="${closing?.branchId}"]`)?.focus({ preventScroll: true }));
    }, duration);
  };
  const send = async (text: string, streamId?: string, options: SendOptions = {}) => {
    try {
      let target = streamId;
      if (!target) { const created = await api<Session>('/sessions', 'POST', {}); await refreshSessions(); chooseSession(created.id); target = created.root_stream_id; }
      const result = await api<GenerationResult>(`/streams/${target}/messages`, 'POST', { text, ...options, requestId: crypto.randomUUID() });
      void runGeneration(result, 'reply');
      return true;
    } catch (e) { notify((e as Error).message); return false; }
  };
  const pick = (value: SelectionData, mode?: 'question' | 'note') => { setSelection(value); setAskOpen(!!mode); setNoteMode(mode === 'note'); };
  const submitBranch = async (text: string, options: SendOptions) => {
    if (!selection || creating) return false;
    setCreating(true);
    try {
      const result = await api<GenerationResult>('/branches', 'POST', { sourceNodeId: selection.nodeId, start: selection.start, end: selection.end, selectedText: selection.text, question: text || undefined, ...options, requestId: crypto.randomUUID() });
      await loadStream(selection.streamId); const depth = stack.findIndex(s => s.streamId === selection.streamId) + 1;
      openBranch(result.branch!, depth); void runGeneration(result, 'reply'); return true;
    } catch (error) { notify((error as Error).message); return false; } finally { setCreating(false); }
  };
  const createNote = async (text: string) => {
    if (!selection || creating) return false; setCreating(true);
    try {
      const result = await api<{ branch: Anchor; streamId: string }>('/branches', 'POST', { sourceNodeId: selection.nodeId, start: selection.start, end: selection.end, selectedText: selection.text, question: text, kind: 'note', requestId: crypto.randomUUID() });
      await loadStream(selection.streamId); await refreshSessions(); setSelection(null); window.getSelection()?.removeAllRanges(); return true;
    } catch (e) { notify((e as Error).message); return false; } finally { setCreating(false); }
  };
  return <div onCopy={copyMarkdownSelection} style={{ '--reading-font-size':`${state.settings?.fontSize || 15}px` } as CSSProperties} className={`app-shell ${state.settings?.blurBackdrop ? 'blur-backdrops' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar" inert={stack.length > 0 || !!manage}>
      <div className="sidebar-brand"><div className="brand"><span>枝知</span></div>{releaseVersion && state.updates?.available && state.settings?.updateNotifications === true && <button className="icon-button update-indicator" aria-label="查看新版本" title={`新版本 ${state.updates.release?.tag}`} onClick={() => navigate('about')}><ArrowUpCircle size={18}/></button>}</div>
      {page === 'settings' ? <div ref={setSettingsSidebar} id="settings-sidebar" className="settings-sidebar"/> : <><button className="new-chat" onClick={() => chooseSession(null)}><Plus size={17}/><span>新的对话</span></button>
      <SessionList selectedId={page === 'chat' ? sessionId : null} onChoose={chooseSession} onManage={(session, kind) => {
        if (kind === 'delete' && state.settings?.confirmDeletion === false) { void api(`/sessions/${session.id}`, 'DELETE').then(async () => { if (sessionId === session.id) chooseSession(null); await refreshSessions(); }).catch(e => notify(e.message)); }
        else { setManage({ session, kind }); setNewTitle(session.title); }
      }}/></>}
      <div className="sidebar-footer"><button className={`settings-link ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate(page === 'settings' ? 'chat' : 'settings')}><SettingsIcon size={17}/>设置</button></div>
    </aside>
    <div className="workspace" inert={stack.length > 0 || !!manage}>
      <header className="topbar"><div className="topbar-left"><button className="icon-button sidebar-toggle" aria-label="切换侧栏" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button><span className="topbar-divider"/><span>{page === 'settings' ? '设置' : session?.title || '新的对话'}</span></div></header>
      {page === 'settings' ? <SettingsPage sidebar={settingsSidebar} key={`${settingsVisit}:${location.search}`} onBack={() => navigate('chat')}/> : <Conversation key={session?.root_stream_id || 'empty'} streamId={session?.root_stream_id} depth={0} onImported={async created => { await refreshSessions(); chooseSession(created.id); await loadStream(created.root_stream_id); }} onSend={send} onBranch={openBranch} onSelect={pick} onDismissSelection={() => setSelection(null)}/>}
    </div>
    {stack.length > 0 && <div className={`branch-backdrop ${state.settings?.blurBackdrop ? 'blurred' : ''} ${closingFrom === 0 ? 'closing' : ''}`} onClick={() => closeTo(stack.length - 1)}/>}
    {stack.length > 0 && <div className="branch-outside-dismiss" style={{ zIndex: 109 + (stack.length - 1) * 2 }} onClick={() => closeTo(stack.length - 1)}/>}
    {stack.map((layer, index) => <BranchLayer key={layer.streamId} layer={layer} index={index} total={stack.length} closing={closingFrom !== null && index >= closingFrom} onClose={() => closeTo(index)} onJump={closeTo} onSend={send} onBranch={openBranch} onSelect={pick} onDismissSelection={() => setSelection(null)}/>)}
    {selection && <div className={`selection-popover ${askOpen ? 'expanded' : ''}`} style={{ left: Math.min(Math.max(16, selection.x), innerWidth - (askOpen ? 382 : 220)), top: Math.min(Math.max(16, selection.y), innerHeight - (askOpen ? 260 : 60)) }}>
      {!askOpen ? <div className="selection-toolbar" role="toolbar" aria-label="选区操作" onMouseDown={e => e.preventDefault()}><button className="selection-trigger" onClick={() => { setAskOpen(true); setNoteMode(false); window.getSelection()?.removeAllRanges(); }}><GitBranch size={14}/>追问</button><button disabled={creating} onClick={() => { setNoteMode(true); setAskOpen(true); window.getSelection()?.removeAllRanges(); }}><StickyNote size={14}/>笔记</button><button onClick={() => { void navigator.clipboard.writeText(selection.raw).then(() => notify('已复制')).catch(() => notify('复制失败')); }}><Copy size={14}/>复制</button></div> : <div className="followup-editor">
        <div className="selection-heading">{noteMode ? <StickyNote size={15}/> : <GitBranch size={15}/>}<span>{noteMode ? '笔记' : '追问'}</span><button type="button" className="icon-button" aria-label={noteMode ? '关闭笔记编辑' : '取消追问'} onClick={() => setSelection(null)}><X size={15}/></button></div>
        <blockquote>{selection.text.length > 130 ? `${selection.text.slice(0, 130)}…` : selection.text}</blockquote>
        <SendComposer key={noteMode ? 'note' : 'question'} noteMode={noteMode} onCancel={() => setSelection(null)} draftKey={`${noteMode ? 'note' : 'followup'}:${selection.nodeId}:${selection.start}:${selection.end}`} streamId={selection.streamId} sourceNodeId={selection.nodeId} quote={selection.text} busy={creating} autoFocus label={noteMode ? '笔记内容' : '输入追问'} placeholder={noteMode ? '写下笔记…' : '这里有什么想进一步了解的？'} sendLabel="创建分支" onSend={noteMode ? createNote : submitBranch}/>
      </div>}
    </div>}
    {manage && <div className="manage-backdrop"><section className="manage-dialog" role="dialog" aria-modal="true" aria-label={manage.kind === 'rename' ? '重命名对话' : '删除对话'}><h3>{manage.kind === 'rename' ? '给这段对话起个名字' : '删除这段对话？'}</h3>{manage.kind === 'rename' ? <input autoFocus value={newTitle} maxLength={120} onChange={e => setNewTitle(e.target.value)}/> : <p>主对话和所有分支都会被删除，此操作无法撤销。</p>}<div className="dialog-actions"><button className="secondary-button" onClick={() => setManage(null)}>取消</button><button className={manage.kind === 'delete' ? 'danger-button' : 'primary-button'} disabled={manage.kind === 'rename' && !newTitle.trim()} onClick={async () => { try { await api(`/sessions/${manage.session.id}`, manage.kind === 'rename' ? 'PATCH' : 'DELETE', manage.kind === 'rename' ? { title: newTitle.trim() } : undefined); if (manage.kind === 'delete' && sessionId === manage.session.id) chooseSession(null); await refreshSessions(); setManage(null); } catch (e) { notify((e as Error).message); } }}>{manage.kind === 'rename' ? '保存' : '删除'}</button></div></section></div>}
    {state.toast && <div className="toast" role="status">{state.toast}{state.toastAction && <button className="toast-action" onClick={() => void state.toastAction?.run().catch(e => notify(e.message))}>{state.toastAction.label}</button>}<button className="icon-button" aria-label="关闭提示" onClick={() => notify('')}><X size={14}/></button></div>}
  </div>;
}

function Composer({ streamId, busy, onSend, compact = false }: { streamId?: string; busy: boolean; onSend: (text: string, streamId?: string, options?: SendOptions) => Promise<boolean>; compact?: boolean }) {
  const state = useAppState(); const job = Object.values(state.jobs).find(j => j.streamId === streamId && j.kind === 'reply');
  return <div className={`composer-wrap ${compact ? 'compact' : ''}`}><SendComposer draftKey={streamId || 'new'} streamId={streamId} busy={busy} label={compact ? '继续分支对话' : '输入你的问题'} placeholder={compact ? '继续追问…' : '输入问题…'} onSend={(text,options) => onSend(text,streamId,options)} onStop={job ? () => void cancelJob(job.id).catch(e=>notify(e.message)) : undefined}/></div>;
}

type ConversationProps = { onImported?: (session: Session) => Promise<void>; streamId?: string; depth: number; onSend: (text: string, id?: string, options?: SendOptions) => Promise<boolean>; onBranch: (anchor: Anchor, depth: number) => void; onSelect: (selection: SelectionData, mode?: 'question' | 'note') => void; onDismissSelection: () => void };
function Conversation(props: ConversationProps) {
  const { streamId, depth, onSend } = props; const state = useAppState(); const stream = streamId ? state.streams[streamId] : undefined;
  const scroll = useRef<HTMLDivElement>(null), nearBottom = useRef(true), initiallyPositioned = useRef(false), manualGeneration = useRef(false), lastGeneration = useRef('');
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [navPreview, setNavPreview] = useState<{ message: Message; top: number } | null>(null);
  const showNavPreview = (message: Message, el: HTMLElement) => { const bounds = el.getBoundingClientRect(), parent = el.closest('.conversation')!.getBoundingClientRect(); setNavPreview({ message, top: Math.max(8, Math.min(bounds.top - parent.top - 16, parent.height - 56)) }); };
  const syncPosition = () => {
    const el = scroll.current; if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    const limit = el.getBoundingClientRect().top + 36;
    const messages = [...el.querySelectorAll<HTMLElement>('[data-message]')];
    const assistantMessages = messages.filter(m => m.classList.contains('message-assistant'));
    const current = assistantMessages.filter(m => m.getBoundingClientRect().top <= limit).at(-1) || assistantMessages[0];
    setActiveMessage(current?.dataset.message || null);
  };
  const jumpToMessage = (id: string) => {
    const el = scroll.current, message = el?.querySelector<HTMLElement>(`[data-message="${id}"]`);
    if (!el || !message) return;
    nearBottom.current = false; setActiveMessage(id);
    el.scrollTo({ top: el.scrollTop + message.getBoundingClientRect().top - el.getBoundingClientRect().top - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    message.focus({ preventScroll: true });
  };
  const jobs = Object.values(state.jobs).filter(j => j.streamId === streamId);
  const busy = jobs.some(j => j.kind === 'reply') || !!stream?.messages.some(m => ['queued','streaming'].includes(m.status));
  const empty = !streamId || stream?.messages.length === 0;
  const generationKey = jobs.filter(j=>j.kind==='reply').map(j=>j.id).join(',') || stream?.messages.filter(m=>['queued','streaming'].includes(m.status)).map(m=>m.id).join(',') || '';
  useLayoutEffect(()=>{if(generationKey && generationKey !== lastGeneration.current){lastGeneration.current=generationKey;manualGeneration.current=false;if(state.settings?.autoScroll !== false)nearBottom.current=true;}},[generationKey]);
  const stopFollowing = () => { if (busy) manualGeneration.current = true; };
  const contentKey = `${stream?.messages.length}-${jobs.map(j => j.text.length).join('-')}`;
  useLayoutEffect(() => { const el = scroll.current; if (el) { if (!initiallyPositioned.current && stream?.messages[0]?.document_name) { el.scrollTop = 0; nearBottom.current = false; } else if (state.settings?.autoScroll !== false && !manualGeneration.current && nearBottom.current) el.scrollTop = el.scrollHeight; if (stream?.messages.length) initiallyPositioned.current = true; } syncPosition(); }, [contentKey, state.settings?.autoScroll]);
  useEffect(()=>{
    const el=scroll.current, messages=el?.querySelector('.messages'); if(!el || !messages) return;
    const observer=new ResizeObserver(()=>{
      if(state.settings?.autoScroll !== false && !manualGeneration.current && nearBottom.current){el.scrollTop=el.scrollHeight;syncPosition();}
    });
    observer.observe(messages);return ()=>observer.disconnect();
  },[streamId,empty,state.settings?.autoScroll]);
  return <section className={`conversation ${empty ? 'empty' : ''} ${depth ? 'branch-conversation' : ''}`}>
    {empty ? <div className="welcome"><h1>想从哪里开始？</h1>{props.onImported && <ImportActions onImported={props.onImported}/>}</div> : <div className="conversation-scroll" ref={scroll} onWheel={stopFollowing} onTouchMove={stopFollowing} onScroll={syncPosition} onMouseDown={e => { if (!(e.target as HTMLElement).closest('mark')) props.onDismissSelection(); }}>
      <div className="messages"> { !stream && <div className="loading-label">正在打开对话…</div>}{stream?.messages.map(message => <MessageView key={message.id} message={message} {...props}/>)}<div className="end-space"/></div>
    </div>}
    {!empty && <nav className="message-navigation" aria-label="消息定位" onMouseLeave={() => setNavPreview(null)}>{stream?.messages.map((message, i) => message.role === 'assistant' ? <button key={message.id} aria-label={`跳转到第 ${i + 1} 条消息：AI`} aria-current={activeMessage === message.id ? 'location' : undefined} onMouseEnter={e => { const previous=stream.messages[i-1]; if(previous?.role==='user')showNavPreview(previous,e.currentTarget);else setNavPreview(null); }} onFocus={e => { const previous=stream.messages[i-1]; if(previous?.role==='user')showNavPreview(previous,e.currentTarget);else setNavPreview(null); }} onBlur={() => setNavPreview(null)} onClick={() => { jumpToMessage(message.id); setNavPreview(null); }}><span/></button> : null)}</nav>}
    {navPreview && <div className="message-nav-preview" role="tooltip" style={{ top: navPreview.top }}><div className="nav-question-preview">{navPreview.message.slots.length ? navPreview.message.slots.map(s => s.node.selection_text).join(' ') : navPreview.message.content_markdown}</div></div>}
    <Composer key={streamId || 'new'} streamId={streamId} busy={busy} onSend={onSend} compact={depth > 0}/>
  </section>;
}

function MessageView({ message, ...props }: ConversationProps & { message: Message }) {
  const state = useAppState(); const job = Object.values(state.jobs).find(j => j.messageId === message.id);
  // Persisted completed blocks are authoritative even if another refresh arrives
  // before the stream runner has retired its local job.
  const pending = ['queued','streaming'].includes(message.status) || !!job && message.generation_id !== job.id;
  const isNote = message.role === 'user' && state.streams[message.stream_id]?.source?.kind === 'note' && message.ordinal === 0;
  const documentRef = useRef<HTMLDivElement>(null);
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const document = documentRef.current; if (!document || !toolsHost) return;
    let frame = 0;
    const update = () => {
      const sections = [...toolsHost.querySelectorAll<HTMLElement>('[data-slot-tools]')].sort((a, b) => {
        const top = (section: HTMLElement) => document.querySelector<HTMLElement>(`[data-slot="${section.dataset.slotTools}"]`)?.offsetTop || 0;
        return top(a) - top(b);
      });
      const items = sections.flatMap(section => {
        const block = document.querySelector<HTMLElement>(`[data-slot="${section.dataset.slotTools}"]`); if (!block) return [];
        const natural = [...section.children].reduce((height, child) => height + (child as HTMLElement).offsetHeight, 0) + (section.children.length > 1 ? 6 : 0);
        return [{ id: section.dataset.slotTools!, top: block.offsetTop, blockHeight: block.offsetHeight, height: natural }];
      });
      const layout = layoutSideItems(items);
      layout.forEach((item, i) => { sections[i].style.top = `${item.top}px`; sections[i].style.height = `${item.height}px`; });
      document.style.minHeight = `${layout.length ? layout.at(-1)!.top + layout.at(-1)!.height : 0}px`;
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); });
    observer.observe(document.querySelector('.message-content')!);
    document.querySelectorAll('[data-slot]').forEach(el => observer.observe(el));
    toolsHost.querySelectorAll('[data-side-content]').forEach(el => observer.observe(el));
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [toolsHost, message.slots]);
  return <article className={`message message-${message.role}`} data-message={message.id} tabIndex={-1}>
    <div className={`message-avatar ${message.document_name ? 'document-avatar' : isNote ? 'note-avatar' : ''}`} title={message.document_name || undefined}>{message.document_name ? <FileText size={13} aria-label="文档" role="img"/> : isNote ? <StickyNote size={13} aria-label="笔记" role="img"/> : message.role === 'user' ? <span>{userInitial(state.settings?.nickname)}</span> : <img src={brandMark} width={13} height={13} alt="AI"/>}</div>
    <div className="message-main"><div className="message-role">{message.document_name || (message.role === 'user' ? (isNote ? '笔记' : state.settings?.nickname || '你') : '枝知')}{message.role === 'assistant' && <span>{message.model_label || ''}</span>}</div>
      <div className="message-document" ref={documentRef}>
      <div className="message-content">{message.attachments && message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map(a => <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" title={a.name}>{a.kind === 'image' ? <img src={`/api/attachments/${a.id}`} alt={a.name}/> : <span>TXT</span>}<small>{a.name}</small></a>)}</div>}{(job?.reasoning || message.reasoning_text) && <ReasoningPanel text={job?.reasoning || message.reasoning_text || ''} simulated={message.model_label === '模拟模式'} startedAt={job?.reasoningStartedAt} endedAt={job?.reasoningEndedAt}/>}{message.slots.map(slot => <BlockView key={slot.id} messageId={message.id} slot={slot} role={message.role} toolsHost={toolsHost} {...props}/>)}
      {pending && <div className="streaming-container" aria-live="off">{job?.text || message.content_markdown ? <StreamingMarkdown source={job?.text || message.content_markdown}/> : <span className="thinking">正在整理思路<span>···</span></span>}</div>}
      {!pending && message.status !== 'complete' && <div className="failed-message">{message.status !== 'stopped' && !message.slots.length && message.content_markdown && <div className="stopped-draft markdown"><Markdown source={message.content_markdown}/></div>}<span>{message.status === 'stopped' ? '已停止生成' : '回答未完成'}</span></div>}
      </div><aside className="message-tools" aria-label="右侧功能区" ref={setToolsHost}></aside></div>
    </div>
  </article>;
}

function BlockView({ messageId, slot, role, streamId, depth, onBranch, onSelect, onDismissSelection, toolsHost }: ConversationProps & { messageId:string; slot: Slot; role: string; toolsHost: HTMLElement | null }) {
  const state = useAppState(); const node = slot.node; const pending = Object.values(state.jobs).find(j => j.nodeId === node.id);
  const [starting, setStarting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; raw: string; copyOnly: boolean; selection?: SelectionData; reason: string; branchId?: string } | null>(null);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const [menu, setMenu] = useState(false), [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false), [addText, setAddText] = useState('');
  const [editText, setEditText] = useState(node.markdown), [saving, setSaving] = useState(false);
  const [deletingBranch,setDeletingBranch] = useState(false);
  const [deletingMessage,setDeletingMessage]=useState(false), [deleteSubmenu,setDeleteSubmenu]=useState(false);
  const message=state.streams[streamId!]?.messages.find(m=>m.id===messageId);
  const messageBusy=Object.values(state.jobs).some(job=>job.streamId===streamId) || !!state.streams[streamId!]?.messages.some(m=>['queued','streaming'].includes(m.status));
  const removeMessage=async()=>{
    setSaving(true);try{const result=await api<{streamIds:string[]}>(`/messages/${messageId}`,'DELETE');forgetStreams(result.streamIds);await loadStream(streamId!);await refreshSessions();setMenu(false);setDeletingMessage(false);}catch(e){notify((e as Error).message);}finally{setSaving(false);}
  };
  useEffect(()=>{if(!menu){setDeletingMessage(false);setDeleteSubmenu(false);}},[menu]);
  const [deleteScope,setDeleteScope] = useState<'all'|'current'>('all');
  const menuRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setEditing(false); setDeleting(false); setAdding(false); setContextMenu(current => current ? { ...current, selection:undefined, reason:'内容版本已切换，请重新选择文字' } : null); }, [node.id]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node) && !handleRef.current?.parentElement?.contains(e.target as Node)) { setMenu(false); setDeleting(false); } };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setMenu(false); setDeleting(false); handleRef.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', escape, true);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape, true); };
  }, [menu]);
  useLayoutEffect(() => {
    if (!menu || !contextMenu || !menuRef.current) return;
    const el=menuRef.current, rect=el.getBoundingClientRect();
    el.style.left=`${Math.max(8,Math.min(contextMenu.x,innerWidth-rect.width-8))}px`;
    el.style.top=`${Math.max(8,Math.min(contextMenu.y,innerHeight-rect.height-8))}px`;
  },[menu,contextMenu,deleting,deletingBranch,deletingMessage,slot.versions.length]);
  useEffect(() => {
    if (!menu || !contextMenu) return;
    const close=(e:Event)=>{if (!menuRef.current?.contains(e.target as Node)) setMenu(false);};
    window.addEventListener('scroll',close,true); window.addEventListener('resize',close);
    return ()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};
  },[menu,contextMenu]);
  useLayoutEffect(()=>{
    const submenu=menuRef.current?.querySelector<HTMLElement>('.block-delete-submenu');if(!submenu)return;
    const parent=submenu.parentElement!.getBoundingClientRect();
    const rect=submenu.getBoundingClientRect();
    const left=parent.right+rect.width>innerWidth-8 ? parent.left-rect.width : parent.right;
    submenu.style.left=`${Math.max(8,left)}px`;submenu.style.top=`${Math.max(8,Math.min(parent.top-3,innerHeight-rect.height-8))}px`;
  },[deleteSubmenu]);
  const changeContent = async (remove = false, scope: 'all' | 'current' = 'all') => {
    setSaving(true);
    try {
      const result = await api<{streamIds?:string[]}>(`/slots/${slot.id}${remove ? '' : '/content'}`, remove ? 'DELETE' : 'PATCH', { expectedActiveNodeId: node.id, ...(remove ? {scope} : { markdown: editText }) });
      forgetStreams(result.streamIds || []);
      await loadStream(streamId!); setEditing(false); setMenu(false); setDeleting(false);
    } catch (e) { notify((e as Error).message); } finally { setSaving(false); }
  };
  const removeBranch = async () => {
    if (!contextMenu?.branchId || saving) return;
    setSaving(true);
    try { await deleteBranch(contextMenu.branchId); setMenu(false); setDeletingBranch(false); setActiveBranch(null); window.getSelection()?.removeAllRanges(); }
    catch(e) { notify((e as Error).message); } finally { setSaving(false); }
  };
  const requestBlockDelete = (scope: 'all' | 'current') => {
    setDeleteSubmenu(false);
    if (state.settings?.confirmDeletion === false) void changeContent(true,scope);
    else { setDeleteScope(scope); setDeleting(true); }
  };
  const version = slot.versions.findIndex(v => v.id === node.id);
  const readSelection = (): { raw: string; copyOnly: boolean; reason: string; selection?: SelectionData } => {
    const native = window.getSelection(), body = document.querySelector<HTMLElement>(`[data-node="${node.id}"]`);
    const empty = { raw: node.markdown, copyOnly: false, reason: '请先选中当前块中的文字' };
    if (!native || native.isCollapsed || !native.rangeCount || !body) return empty;
    let range = native.getRangeAt(0);
    const selectedBodies = [...document.querySelectorAll<HTMLElement>('[data-node][data-markdown]')].filter(el => {
      if (el.closest('[inert]') || !range.intersectsNode(el)) return false;
      const clip = range.cloneRange(), whole = document.createRange(); whole.selectNodeContents(el);
      if (clip.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clip.setStart(whole.startContainer,whole.startOffset);
      if (clip.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clip.setEnd(whole.endContainer,whole.endOffset);
      return !clip.collapsed;
    });
    const raw = selectionMarkdown(document.body,range) || native.toString();
    if (selectedBodies.length > 1) return { raw, copyOnly: true, reason: '跨块选区只能复制' };
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return { ...empty, reason: '请在同一个内容块内选择文字' };
    range = normalizeFormulaRange(range, body);
    let start = canonicalOffset(body, range.startContainer, range.startOffset, 'start'), end = canonicalOffset(body, range.endContainer, range.endOffset, 'end');
    while (start < end && /\s/.test(node.selection_text[start])) start++;
    while (end > start && /\s/.test(node.selection_text[end - 1])) end--;
    ({ start, end } = expandMathSelection(node.markdown, start, end));
    const text = node.selection_text.slice(start,end), rect = range.getBoundingClientRect();
    const data: SelectionData = { nodeId:node.id, streamId:streamId!, start, end, text, raw:selectionMarkdown(body,range) || text, x:rect.left, y:rect.bottom+6 };
    const busy = Object.values(state.jobs).some(j => j.streamId === streamId) || state.streams[streamId!]?.messages.some(m => ['queued','streaming'].includes(m.status));
    const reason = !text.trim() || node.block_type === 'thematicBreak' ? '请先选中当前块中的文字'
      : slot.anchors.some(a => a.start_offset < end && a.end_offset > start) ? '选区包含已有分支，请重新选择'
      : busy ? '这段对话正在生成，请稍后再试' : '';
    return { raw:data.raw, copyOnly:false, selection:data, reason };
  };
  const selected = (event?: MouseEvent) => {
    if ((event && event.button !== 0) || menu) return;
    const native = window.getSelection(), body = document.querySelector<HTMLElement>(`[data-node="${node.id}"]`);
    if (!native?.rangeCount || native.isCollapsed || !body) return;
    const range = native.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
    const normalized = normalizeFormulaRange(range,body); native.removeAllRanges(); native.addRange(normalized);
    const result = readSelection();
    if (result.selection && !result.reason) onSelect(result.selection);
    else if (result.selection && result.reason.includes('已有分支')) onDismissSelection();
  };
  const openContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('textarea,input,[contenteditable=true],.block-menu')) return;
    event.preventDefault(); event.stopPropagation();
    const selection = readSelection();
    const highlight = (event.target as HTMLElement).closest<HTMLElement>('[data-branch]');
    const branchId = slot.anchors.find(a => a.id === highlight?.dataset.branch)?.id;
    onDismissSelection(); setDeleting(false); setDeletingBranch(false); setDeletingMessage(false);setDeleteSubmenu(false); setContextMenu({ ...selection, branchId, x:event.clientX, y:event.clientY }); setMenu(true);
  };
  const contextAction = (mode: 'question' | 'note') => {
    if (!contextMenu?.selection || contextMenu.reason) { notify(contextMenu?.reason || '请先选中文字'); return; }
    const selection = { ...contextMenu.selection, x:contextMenu.x, y:contextMenu.y };
    setMenu(false); setContextMenu(null); onSelect(selection,mode); window.getSelection()?.removeAllRanges();
  };
  // mouseup belongs to the document: the pointer may be outside the block
  // while both native selection endpoints remain inside it.
  useEffect(() => { document.addEventListener('mouseup', selected); return () => document.removeEventListener('mouseup', selected); });
  const rewrite = async () => { setStarting(true); try { const result = await api<GenerationResult>(`/nodes/${node.id}/rewrites`, 'POST', { requestId: crypto.randomUUID(), modelId: composerModelId(streamId || 'new') }); void runGeneration(result, 'rewrite', node.id); } catch (e) { notify((e as Error).message); } finally { setStarting(false); } };
  const changeVersion = async (index: number) => { try { await api(`/slots/${slot.id}/active-version`, 'PATCH', { nodeId: slot.versions[index].id, expectedActiveNodeId: node.id }); await loadStream(streamId!); } catch (e) { notify((e as Error).message); } };
  const blockMenu = <div className={`block-menu ${contextMenu ? 'context-block-menu' : ''}`} style={contextMenu ? { position:'fixed', left:contextMenu.x, top:contextMenu.y } : undefined} ref={menuRef} role="menu" aria-label={contextMenu ? '内容右键菜单' : '块操作菜单'} onMouseDown={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const at = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
      if (e.key === 'Tab') { setMenu(false); setDeleting(false); }
    }}>{contextMenu?.copyOnly ? <button role="menuitem" onClick={() => { void navigator.clipboard.writeText(contextMenu.raw).then(() => notify('已复制')).catch(() => notify('复制失败')); setMenu(false); }}><Copy size={14}/>复制为 Markdown</button> : deletingMessage ? <><p>删除整条消息？消息内的分支也将删除</p><div className="block-menu-confirm"><button disabled={saving} onClick={()=>setDeletingMessage(false)}>取消</button><button className="delete-action" disabled={saving} onClick={()=>void removeMessage()}>确认删除消息</button></div></> : deletingBranch ? <><p>删除此分支？其子分支也将被同时删除</p><div className="block-menu-confirm"><button disabled={saving} onClick={() => setDeletingBranch(false)}>取消</button><button className="delete-action" disabled={saving} onClick={() => void removeBranch()}>确认删除分支</button></div></> : deleting ? <><p>{slot.versions.length > 1 ? (deleteScope === 'current' ? '删除当前版本？此版本的分支也将删除' : '删除所有版本？块内的分支也将删除') : '删除此块？块内的分支也将被同时删除'}</p><div className="block-menu-confirm"><button onClick={() => setDeleting(false)} disabled={saving}>取消</button><button className="delete-action" onClick={() => void changeContent(true,deleteScope)} disabled={saving}>确认删除</button></div></> : <>
      {contextMenu && <>
        <button role="menuitem" aria-disabled={!!contextMenu.reason} onClick={() => contextAction('question')}><GitBranch size={14}/>追问</button>
        <button role="menuitem" aria-disabled={!!contextMenu.reason} onClick={() => contextAction('note')}><StickyNote size={14}/>笔记</button>
        {contextMenu?.branchId && <button role="menuitem" className="delete-action" onClick={() => { if (state.settings?.confirmDeletion === false) void removeBranch(); else setDeletingBranch(true); }}><Trash2 size={14}/>删除分支</button>}
        <div className="menu-separator" role="separator"/>
      </>}
      {slot.versions.length > 1 && <div className="menu-versions"><span>历史版本</span><div className="version-switcher"><button className="icon-button" aria-label="上一个版本" disabled={version <= 0} onClick={() => void changeVersion(version - 1)}><ChevronLeft size={13}/></button><span>版本 {version + 1} / {slot.versions.length}</span><button className="icon-button" aria-label="下一个版本" disabled={version >= slot.versions.length - 1} onClick={() => void changeVersion(version + 1)}><ChevronRight size={13}/></button></div></div>}
      {slot.versions.length > 1 && <div className="menu-separator" role="separator"/>}
      {node.block_type !== 'image' && slot.anchors.length > 0 && <button role="menuitem" disabled={starting || !!pending} onClick={() => { setMenu(false); void rewrite(); }}><Sparkles size={14}/>结合追问重新回答</button>}
      <button role="menuitem" disabled={!!pending} onClick={() => { setAdding(true); setAddText(''); setMenu(false); }}><Plus size={14}/>在下方添加块</button>
      <button role="menuitem" disabled={!!pending} onClick={() => { setEditText(node.markdown); setEditing(true); setMenu(false); }}><Pencil size={14}/>编辑内容</button>
      <div className="menu-separator" role="separator"/>
      <button role="menuitem" onClick={() => { void navigator.clipboard.writeText(node.markdown).then(() => notify('已复制')).catch(() => notify('复制失败')); setMenu(false); }}><Copy size={14}/>复制块</button>
      <button role="menuitem" onClick={()=>{const raw=message?.slots.map(s=>`${s.meta.quote?'> ':''}${s.meta.marker?`${s.meta.marker==='•'?'-':s.meta.marker} `:''}${s.node.markdown}`).join('\n\n') || message?.content_markdown || '';void navigator.clipboard.writeText(raw).then(()=>notify('已复制')).catch(()=>notify('复制失败'));setMenu(false);}}><Copy size={14}/>复制整条消息</button>
      <div className="menu-separator" role="separator"/>
      {slot.versions.length > 1 ? <div className="menu-submenu" onMouseEnter={()=>{if(!messageBusy && !saving)setDeleteSubmenu(true);}} onMouseLeave={()=>setDeleteSubmenu(false)}>
        <button role="menuitem" className="delete-action" aria-haspopup="menu" aria-expanded={deleteSubmenu} disabled={messageBusy || saving} onClick={()=>setDeleteSubmenu(!deleteSubmenu)} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();setDeleteSubmenu(true);const target=e.currentTarget;requestAnimationFrame(()=>target.parentElement?.querySelector<HTMLButtonElement>('[role=menu] button')?.focus());}}}><Trash2 size={14}/>删除块<ChevronRight size={14}/></button>
        {deleteSubmenu && <div className="block-delete-submenu" role="menu" aria-label="删除块版本" onKeyDown={e=>{if(e.key==='ArrowLeft'){e.preventDefault();setDeleteSubmenu(false);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('button')?.focus();}}}>
          <button role="menuitem" className="delete-action" disabled={messageBusy || saving} onClick={()=>requestBlockDelete('current')}><Trash2 size={14}/>删除当前版本</button>
          <button role="menuitem" className="delete-action" disabled={messageBusy || saving} onClick={()=>requestBlockDelete('all')}><Files size={14}/>删除所有版本</button>
        </div>}
      </div> : <button role="menuitem" className="delete-action" disabled={messageBusy || saving} onClick={()=>requestBlockDelete('all')}><Trash2 size={14}/>删除块</button>}
      <button role="menuitem" className="delete-action" disabled={messageBusy || saving} onClick={()=>{if(state.settings?.confirmDeletion===false)void removeMessage();else setDeletingMessage(true);}}><Trash2 size={14}/>删除整条消息</button>
      {contextMenu && <ReeditQuestion messageId={messageId} streamId={streamId!} menu onDone={()=>setMenu(false)}/>}
    </>}</div>;
  return <div className={`content-block document-block ${menu ? 'menu-open' : ''} ${slot.meta.quote ? 'quoted' : ''} ${slot.meta.marker ? 'list-block' : ''}`} style={{ marginLeft: (slot.meta.depth || 0) * 20 }} data-slot={slot.id} onContextMenu={openContextMenu}>
    {!editing && <div className="block-handles">{slot.versions.length > 1 && <button className="block-history" aria-label="历史版本" title="历史版本" onClick={() => { setContextMenu(null); setMenu(!menu); setDeleting(false); setDeletingBranch(false); }}><History size={16}/></button>}<button ref={handleRef} className="block-handle" aria-label="块操作" aria-haspopup="menu" aria-expanded={menu} title="块操作" onClick={() => { setContextMenu(null); setMenu(!menu); setDeleting(false); setDeletingBranch(false); }}><GripVertical size={16}/></button></div>}
    {menu && (contextMenu ? createPortal(blockMenu, document.body) : blockMenu)}
    {slot.meta.marker && <span className="list-marker" aria-hidden="true">{slot.meta.marker}</span>}
    {editing ? <form className="block-editor" onSubmit={e => { e.preventDefault(); void changeContent(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); handleRef.current?.focus(); } }}><textarea aria-label="编辑块内容" autoFocus value={editText} onChange={e => setEditText(e.target.value)} rows={Math.min(14, Math.max(3, editText.split('\n').length + 1))}/><div><span>Markdown</span><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditing(false)}>取消</button><button className="primary-button" disabled={saving}>保存新版本</button></div></form> : <div className="selectable markdown" data-node={node.id} data-markdown={node.markdown} data-prefix={`${slot.meta.quote ? '> ' : ''}${slot.meta.marker ? `${slot.meta.marker === '•' ? '-' : slot.meta.marker} ` : ''}`} onKeyUp={e => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) selected(); }}><Markdown source={node.markdown} anchors={slot.anchors} activeBranchId={activeBranch} onActiveBranch={setActiveBranch} onBranch={a => onBranch(a, depth)}/></div>}
    {toolsHost && slot.anchors.length > 0 && createPortal(<section className="block-side" data-slot-tools={slot.id} aria-label="内容块功能">
      {slot.anchors.length > 0 && <div className="branch-previews" data-side-content>{slot.anchors.map(anchor => {
        const loaded = state.streams[anchor.stream_id];
        const firstUser = loaded?.messages.find(m => m.role === 'user');
        const firstAnswer = loaded?.messages.find(m => m.role === 'assistant');
        const live = Object.values(state.jobs).find(j => j.messageId === firstAnswer?.id);
        const question = firstUser ? firstUser.slots.map(s => s.node.selection_text).join(' ') : anchor.preview?.question || anchor.selected_text;
        const answer = live?.text || (firstAnswer ? firstAnswer.slots.map(s => s.node.selection_text).join(' ') || firstAnswer.content_markdown : anchor.preview?.answer) || (['queued','streaming'].includes(firstAnswer?.status || anchor.preview?.status || '') ? '正在生成…' : anchor.kind === 'note' ? '笔记' : '暂无回答');
        return <button key={anchor.id} className={`branch-preview ${anchor.kind === 'note' ? 'note-preview' : ''} ${activeBranch === anchor.id ? 'active' : ''}`} data-preview-branch={anchor.id} aria-label={`预览分支：${question}`} onMouseEnter={() => setActiveBranch(anchor.id)} onMouseLeave={() => setActiveBranch(null)} onFocus={() => setActiveBranch(anchor.id)} onBlur={() => setActiveBranch(null)} onClick={() => onBranch(anchor, depth)}><span className="preview-question">{question}</span><span className="preview-answer">{answer}</span></button>;
      })}</div>}
    </section>, toolsHost)}
    {pending && <div className="rewrite-preview"><div className="preview-label"><Sparkles size={14}/>正在结合追问，重新解释<button className="icon-button" aria-label="停止重构" onClick={() => void cancelJob(pending.id)}><Square size={12}/></button></div>{pending.reasoning && <ReasoningPanel text={pending.reasoning} startedAt={pending.reasoningStartedAt} endedAt={pending.reasoningEndedAt}/>}<StreamingMarkdown source={pending.text || '整理相关分支…'} firstMeta={slot.meta}/></div>}
    {slot.proposals.map(proposal => <div className="rewrite-preview" key={proposal.id}><div className="preview-label"><Sparkles size={14}/>新的解释<span>预览</span></div><div className="rewrite-blocks"><MarkdownBlocks source={proposal.markdown} firstMeta={slot.meta}/></div><div className="preview-actions"><button className="secondary-button" onClick={async () => { try { await api(`/rewrite-proposals/${proposal.id}/reject`, 'POST'); await loadStream(streamId!); } catch (e) { notify((e as Error).message); } }}>保留原文</button><button className="primary-button" onClick={async () => { try { await api(`/rewrite-proposals/${proposal.id}/accept`, 'POST', { expectedActiveNodeId: node.id }); await loadStream(streamId!); } catch (e) { notify((e as Error).message); } }}><Check size={14}/>采用新版</button></div></div>)}
    {adding && <form className="block-editor insert-block-editor" onSubmit={async e => { e.preventDefault(); if (!addText.trim() || saving) return; setSaving(true); try { await api(`/slots/${slot.id}/after`, 'POST', { markdown: addText, expectedActiveNodeId: node.id }); await loadStream(streamId!); setAdding(false); } catch (e) { notify((e as Error).message); } finally { setSaving(false); } }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }}><textarea autoFocus aria-label="新块内容" value={addText} onChange={e => setAddText(e.target.value)} rows={3}/><div><button type="button" className="secondary-button" onClick={() => setAdding(false)}>取消</button><button className="primary-button" disabled={!addText.trim() || saving}>添加块</button></div></form>}
  </div>;
}

function BranchLayer({ layer, index, total, closing, onClose, onJump, ...props }: { layer: Layer; index: number; total: number; closing: boolean; onClose: () => void; onJump: (n: number) => void } & Omit<ConversationProps, 'streamId' | 'depth'>) {
  const state = useAppState();
  const direction = state.settings?.stackDirection || 'up';
  const ref = useRef<HTMLDivElement>(null); const top = index === total - 1;
  const resize = useCenteredResize();
  const [entered, setEntered] = useState(false);
  const latestClose = useRef(onClose); latestClose.current = onClose;
  useEffect(() => { if (!top) return; const panel = ref.current!; const target = panel.querySelector<HTMLElement>('textarea') || panel; target.focus({ preventScroll: true });
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); latestClose.current(); }
      if (e.key === 'Tab') {
        const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [top, layer.streamId]);
  const behind = Math.min(total - index - 1, 2);
  return <div data-direction={direction} className={`branch-dialog ${top ? 'top-layer' : ''} ${closing ? 'closing' : ''} ${resize.resizing ? 'resizing' : ''} ${entered ? 'entered' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && ['branch-in','branch-in-left'].includes(e.animationName)) setEntered(true); }} ref={ref} role="dialog" aria-modal={top ? true : undefined} aria-label={`分支 ${index + 1}：${layer.quote.slice(0, 30)}`} aria-hidden={!top} inert={!top} tabIndex={-1} style={{ width: resize.size.width, height: resize.size.height, zIndex: 110 + index * 2, '--behind': behind, '--stack-scale': 1 - behind * .045, visibility: total - index > 3 ? 'hidden' : undefined } as CSSProperties}>
    <header className="branch-header"><div className="branch-path"><button onClick={() => onJump(0)}>主对话</button>{index > 1 && <><ChevronRight size={12}/><button onClick={() => onJump(index - 1)}>…</button></>}{index > 0 && <><ChevronRight size={12}/><button onClick={() => onJump(index)}>分支 {index}</button></>}<ChevronRight size={12}/><span><GitBranch size={14}/>分支 {index + 1}</span></div><button className="icon-button" aria-label="关闭分支" title="返回上一层 · Esc" onClick={onClose}><X size={18}/></button></header>
    <div className="source-quote"><span>引用</span><blockquote>{layer.quote}</blockquote></div>
    <Conversation {...props} streamId={layer.streamId} depth={index + 1}/>
    {(['nw','ne','sw','se'] as Corner[]).map(corner => <button key={corner} className={`resize-corner resize-${corner}`} aria-label={`调整窗口大小：${({ nw: '左上', ne: '右上', sw: '左下', se: '右下' })[corner]}`} onPointerDown={e => { setEntered(true); resize.start(e, corner); }} onPointerMove={resize.move} onPointerUp={resize.stop} onPointerCancel={resize.stop} onLostPointerCapture={resize.stop} onKeyDown={e => { if (resize.keyboard(corner, e.key)) { e.preventDefault(); e.stopPropagation(); } }}/>)}
  </div>;
}
