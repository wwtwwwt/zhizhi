import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderPrompt, replyContext, rewriteContext } from './prompts';
import { ModelRegistry } from './model-registry';
import { Secrets, type SecretCodec } from './secrets';
import { attachmentInfo, saveAttachments, validateAttachments } from './attachments';
import { estimateMessages, modelBudget, type SendOptions, type ModelConfig } from '../shared/models';
import { withoutImages } from '../shared/documents';
import { nodeTree, splitMarkdown, validBoundary, validMathSelection } from '../shared/markdown';
import type { Anchor, ChatMessage, ContentNode, ContextRef, GenerationResult, Session, Settings, Slot, Stream } from '../shared/types';
import type { ConversationMapData, MapMessage, MapSearchHit } from '../shared/conversation-map';

// SQLite's row boundary is decoded by repository methods below.
export type Row = Record<string, any>;
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const id = () => randomUUID();
const now = () => new Date().toISOString();
export const defaults: Settings = { updateNotifications:true, sidebarBlur:false, replySystem:null, blurBackdrop:false, autoScroll:true, showOutline:true, theme: 'system', fakeDelay: 30, nickname: '你', fontSize:15, sendShortcut:'enter', confirmDeletion:true, stackDirection: 'up' };
export class Store {
  db: DatabaseSync;
  models: ModelRegistry;
  secrets: Secrets;
  constructor(public dir: string, secretCodec?: SecretCodec) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'learnhelper.sqlite'));
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    if (!this.one("SELECT name FROM sqlite_master WHERE name='sessions'")) {
      this.tx(() => this.db.exec(readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')));
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,position REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS session_folders(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,position REAL NOT NULL);`);
    this.secrets = new Secrets(dir, secretCodec);
    this.models = new ModelRegistry(this);
    this.tx(() => {
      this.run("UPDATE messages SET status='interrupted' WHERE status IN ('queued','streaming')");
      this.run("UPDATE generations SET status='interrupted',error_code='INTERRUPTED',finished_at=? WHERE status IN ('queued','streaming')", now());
      for (const message of this.all("SELECT * FROM messages WHERE status='interrupted'")) {
        if (!this.visibleSlots(message.id).length) {
          const draft = this.one('SELECT draft_markdown FROM generations WHERE id=?', message.generation_id)?.draft_markdown || message.content_markdown;
          if (splitMarkdown(draft).length) { this.finalizeMessage(message.id, draft); this.run("UPDATE messages SET status='interrupted' WHERE id=?", message.id); }
          else this.removeEmptyMessage(message.id);
        }
      }
    });
  }
  one(sql: string, ...args: SQLInputValue[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  all(sql: string, ...args: SQLInputValue[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  run(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).run(...args); }
  tx<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  need(table: string, key: string): Row { const row = this.one(`SELECT * FROM ${table} WHERE id=?`, key); if (!row) throw new AppError(404, 'NOT_FOUND', '内容不存在，可能已被删除'); return row; }
  settings(): Settings { return { ...defaults, ...JSON.parse(this.one("SELECT value_json FROM settings WHERE key='preferences'")?.value_json || '{}') }; }
  saveSettings(value: Settings) {
    this.run("INSERT INTO settings VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", JSON.stringify(value));
    return this.settings();
  }
  storageInfo(): import('../shared/types').StorageInfo {
    const files = ['learnhelper.sqlite','learnhelper.sqlite-wal','learnhelper.sqlite-shm','secrets.json'].map(name => {
      const path = join(this.dir,name); return {name,path,bytes:existsSync(path) ? statSync(path).size : 0};
    });
    const count = (table:string) => Number(this.one(`SELECT COUNT(*) AS n FROM ${table}`)!.n);
    return {mode:'local',path:this.dir,totalBytes:files.reduce((n,f)=>n+f.bytes,0),files,sessions:count('sessions'),messages:count('messages'),blocks:count('block_slots'),branches:count('branches'),attachments:count('attachments')+count('document_resources'),models:count('models')};
  }
  clearData() {
    const path=join(this.dir,'secrets.json'), oldSecret=existsSync(path) ? readFileSync(path) : undefined;
    this.db.exec('PRAGMA secure_delete=ON');
    try {
      this.tx(()=>{
        this.run('DELETE FROM sessions'); this.run('DELETE FROM folders'); this.run('DELETE FROM models'); this.run('DELETE FROM settings');
        this.secrets.write({});
      });
    } catch(e) { if(oldSecret) writeFileSync(path,oldSecret,{mode:0o600}); throw e; }
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
    return {ok:true};
  }
  sessions(): Session[] { return this.all("SELECT s.*,f.folder_id,f.position,t.id AS root_stream_id FROM sessions s LEFT JOIN session_folders f ON f.session_id=s.id JOIN streams t ON t.session_id=s.id AND t.kind='root' ORDER BY s.updated_at DESC") as Session[]; }
  folders() { return this.all('SELECT * FROM folders ORDER BY position,id'); }
  saveFolder(folderId: string | null, name: string, parentId: string | null = null) {
    return this.tx(() => {
      if (parentId) { const parent = this.need('folders', parentId); if (parent.parent_id) throw new AppError(400, 'FOLDER_DEPTH', '最多支持两级文件夹'); }
      if (this.one('SELECT id FROM folders WHERE name=? AND parent_id IS ? AND id!=?', name, parentId, folderId || '')) throw new AppError(409, 'FOLDER_NAME', '同级文件夹名称重复');
      const fid = folderId || id();
      if (folderId) { this.need('folders', fid); this.run('UPDATE folders SET name=? WHERE id=?', name, fid); }
      else this.run('INSERT INTO folders VALUES(?,?,?,?)', fid, name, parentId, Number(this.one('SELECT COALESCE(MAX(position),-1)+1 AS n FROM folders WHERE parent_id IS ?', parentId)!.n));
      return this.need('folders', fid);
    });
  }
  moveFolder(folderId: string, parentId: string | null, beforeId?: string) {
    return this.tx(() => {
      this.need('folders', folderId);
      if (parentId) {
        const parent = this.need('folders', parentId);
        if (parentId === folderId || parent.parent_id || this.one('SELECT id FROM folders WHERE parent_id=?', folderId)) throw new AppError(400, 'FOLDER_DEPTH', '最多支持两级文件夹，不能移动到自身或子文件夹');
      }
      const folder = this.need('folders', folderId);
      if (this.one('SELECT id FROM folders WHERE name=? AND parent_id IS ? AND id!=?', folder.name, parentId, folderId)) throw new AppError(409, 'FOLDER_NAME', '同级文件夹名称重复');
      const siblings = this.all('SELECT id FROM folders WHERE parent_id IS ? AND id!=? ORDER BY position,id', parentId, folderId).map(f => f.id as string);
      const index = beforeId ? siblings.indexOf(beforeId) : siblings.length;
      if (index < 0) throw new AppError(400, 'FOLDER_ORDER', '目标文件夹已变化');
      siblings.splice(index, 0, folderId);
      this.run('UPDATE folders SET parent_id=? WHERE id=?', parentId, folderId);
      siblings.forEach((fid, i) => this.run('UPDATE folders SET position=? WHERE id=?', i, fid));
      return { ok: true };
    });
  }
  moveSession(sessionId: string, folderId: string | null, beforeId?: string) {
    return this.tx(() => {
      this.need('sessions', sessionId);
      if (!folderId) { this.run('DELETE FROM session_folders WHERE session_id=?', sessionId); return { ok: true }; }
      this.need('folders', folderId);
      const siblings = this.all('SELECT session_id FROM session_folders WHERE folder_id=? AND session_id!=? ORDER BY position,session_id', folderId, sessionId).map(s => s.session_id as string);
      const index = beforeId ? siblings.indexOf(beforeId) : siblings.length;
      if (index < 0) throw new AppError(400, 'SESSION_ORDER', '目标对话已变化');
      siblings.splice(index, 0, sessionId);
      siblings.forEach((sid, i) => this.run('INSERT INTO session_folders VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET folder_id=excluded.folder_id,position=excluded.position', sid, folderId, i));
      return { ok: true };
    });
  }
  deleteFolder(folderId: string) { this.need('folders', folderId); this.run('DELETE FROM folders WHERE id=?', folderId); return { ok: true }; }
  createSession(title = '新的对话'): Session {
    return this.tx(() => { const sid = id(), root = id(), time = now(); this.run('INSERT INTO sessions VALUES(?,?,?,?)', sid, title, time, time); this.run("INSERT INTO streams VALUES(?,?,'root','[]')", root, sid); return { id: sid, title, root_stream_id: root, updated_at: time }; });
  }
  touch(streamId: string) { this.run('UPDATE sessions SET updated_at=? WHERE id=(SELECT session_id FROM streams WHERE id=?)', now(), streamId); }
  visibleSlots(messageId: string): Row[] {
    return this.all('SELECT * FROM block_slots WHERE message_id=? AND deleted_at IS NULL ORDER BY ordinal', messageId);
  }
  assertVisible(slot: Row) { if (!this.visibleSlots(slot.message_id).some(s => s.id === slot.id)) throw new AppError(409, 'STALE_VERSION', '内容已变化，请从当前显示的版本操作'); }
  branchPreview(streamId: string): NonNullable<Anchor['preview']> {
    const first = (role: string) => this.one("SELECT * FROM messages WHERE stream_id=? AND role=? AND status!='deleted' ORDER BY ordinal LIMIT 1", streamId, role);
    const snippet = (message?: Row) => !message ? '' : ['complete','stopped','error','interrupted'].includes(message.status)
      ? this.visibleSlots(message.id).map(s => this.need('content_nodes', s.active_node_id).selection_text).join(' ').slice(0, 180)
      : nodeTree(message.content_markdown || '').text.slice(0, 180);
    const answer = first('assistant');
    return { question: snippet(first('user')), answer: snippet(answer), status: answer?.status || 'empty' };
  }
  mapMessageText(message: Row) {
    const text = this.visibleSlots(message.id).map(slot => this.need('content_nodes', slot.active_node_id).selection_text).join('\n\n');
    return text || nodeTree(message.content_markdown || '').text || attachmentInfo(this, message.id).map(file => file.name).join('、');
  }
  searchConversationMap(sessionId: string, query: string): MapSearchHit[] {
    const data = this.conversationMap(sessionId);
    const branches = new Map(data.branches.map(branch => [branch.anchor.stream_id, branch]));
    const seen = new Set<string>(), hits: MapSearchHit[] = [];
    const needle = query.trim().toLowerCase();
    if (!needle) return hits;
    for (const message of data.messages) {
      const branch = !seen.has(message.streamId) ? branches.get(message.streamId) : undefined;
      seen.add(message.streamId);
      const text = [branch?.anchor.selected_text, this.mapMessageText(this.need('messages', message.id))].filter(Boolean).join('\n\n');
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 45), end = Math.min(text.length, index + needle.length + 100);
      const slot = this.visibleSlots(message.id).find(slot => this.need('content_nodes', slot.active_node_id).selection_text.toLowerCase().includes(needle));
      hits.push({ messageId: message.id, excerpt: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`, slotId: slot?.id, nodeId: slot?.active_node_id, quote: !slot && !!branch?.anchor.selected_text.toLowerCase().includes(needle) });
    }
    return hits;
  }
  conversationMap(sessionId: string): ConversationMapData {
    this.need('sessions', sessionId);
    const root = this.one("SELECT id FROM streams WHERE session_id=? AND kind='root'", sessionId)!;
    const result: ConversationMapData = { rootStreamId: root.id, messages: [], branches: [] };
    const pending = [{ streamId: root.id as string, parentId: null as string | null, note: false }];
    const visited = new Set<string>();
    for (let index = 0; index < pending.length; index++) {
      const stream = pending[index];
      if (visited.has(stream.streamId)) continue;
      visited.add(stream.streamId);
      let previous = stream.parentId;
      const messages = this.all("SELECT * FROM messages WHERE stream_id=? AND status!='deleted' ORDER BY ordinal", stream.streamId);
      for (const message of messages) {
        const slots = this.visibleSlots(message.id);
        result.messages.push({ id: message.id, streamId: stream.streamId, parentId: previous, role: message.role, kind: message.document_name ? 'document' : stream.note && message.ordinal === 0 && message.role === 'user' ? 'note' : message.role === 'assistant' ? 'assistant' : 'user', status: message.status, preview: this.mapMessageText(message).slice(0, 1200) } as MapMessage);
        previous = message.id;
        for (const slot of slots) {
          const branches = this.all('SELECT * FROM branches WHERE source_node_id=? ORDER BY created_at,id', slot.active_node_id);
          for (const branch of branches) {
            result.branches.push({ anchor: branch as Anchor, parentMessageId: message.id, parentStreamId: stream.streamId });
            pending.push({ streamId: branch.stream_id, parentId: message.id, note: branch.kind === 'note' });
          }
        }
      }
    }
    return result;
  }
  stream(streamId: string): Stream {
    const stream = this.need('streams', streamId);
    const messages = this.all("SELECT * FROM messages WHERE stream_id=? AND status!='deleted' ORDER BY ordinal", streamId).map(m => ({ ...m, attachments: attachmentInfo(this, m.id),
      slots: this.visibleSlots(m.id).map(s => {
        const node = this.need('content_nodes', s.active_node_id) as ContentNode;
        return { ...s, meta: JSON.parse(this.one('SELECT meta_json FROM node_layout WHERE node_id=?', node.id)?.meta_json || s.render_meta_json), node,
          versions: this.all("SELECT * FROM content_nodes WHERE slot_id=? AND status='available' ORDER BY version_no", s.id),
          anchors: this.all('SELECT * FROM branches WHERE source_node_id=? ORDER BY start_offset', node.id).map(a => ({ ...a, preview: this.branchPreview(a.stream_id) })),
          proposals: this.all("SELECT * FROM rewrite_proposals WHERE source_node_id=? AND status='pending'", node.id).map(p => ({ id: p.id, node: this.need('content_nodes', p.candidate_node_id), markdown: this.need('generations', p.generation_id).draft_markdown })),
        } as Slot;
      }),
    }));
    return { ...stream, messages, source: this.one('SELECT b.*,m.stream_id AS parent_stream_id FROM branches b JOIN content_nodes n ON n.id=b.source_node_id JOIN block_slots s ON s.id=n.slot_id JOIN messages m ON m.id=s.message_id WHERE b.stream_id=?', streamId), pendingRewrites: this.all("SELECT id,source_node_id,status,draft_markdown FROM generations WHERE stream_id=? AND kind='rewrite' AND status IN ('queued','streaming')", streamId) } as Stream;
  }
  finalizeMessage(messageId: string, markdown: string) {
    const blocks = splitMarkdown(markdown);
    if (!blocks.length) throw new AppError(502, 'EMPTY_OUTPUT', '模型未返回正文');
    blocks.forEach((block, index) => { const slot = id(), node = id(); this.run('INSERT INTO block_slots(id,message_id,ordinal,active_node_id,render_meta_json) VALUES(?,?,?,?,?)', slot, messageId, index, null, JSON.stringify(block.meta)); this.run('INSERT INTO content_nodes VALUES(?,?,1,NULL,?,?,?,?,?)', node, slot, block.markdown, block.text, block.type, 'available', now()); this.run('UPDATE block_slots SET active_node_id=? WHERE id=?', node, slot); });
    this.run("UPDATE messages SET status='complete',content_markdown=? WHERE id=?", markdown, messageId);
  }
  refs(streamId: string, throughNode?: string): ContextRef[] {
    const stream = this.need('streams', streamId);
    const refs: ContextRef[] = JSON.parse(stream.context_snapshot_json);
    for (const message of this.all("SELECT * FROM messages WHERE stream_id=? AND status IN ('complete','stopped','error','interrupted') ORDER BY ordinal", streamId)) {
      const slots = this.visibleSlots(message.id);
      const ids: string[] = slots.map(s => s.active_node_id);
      if (ids.length) refs.push({ role: message.role, nodeIds: ids, attachmentMessageId: attachmentInfo(this, message.id).length ? message.id : undefined });
      if (throughNode && ids.includes(throughNode)) return refs;
    }
    if (throughNode) throw new AppError(409, 'STALE_VERSION', '请从当前显示的版本创建分支');
    return refs;
  }
  resolve(refs: ContextRef[]): ChatMessage[] {
    return refs.map(r => {
      const text = r.quote !== undefined ? renderPrompt('quote', { text: r.quote }) : (r.nodeIds || []).map(n => withoutImages(this.need('content_nodes', n).markdown)).filter(Boolean).join('\n\n');
      const parts: import('../shared/types').ContentPart[] = [{ type: 'text', text }];
      if (r.attachmentMessageId) for (const file of this.all('SELECT * FROM attachments WHERE message_id=? ORDER BY rowid', r.attachmentMessageId)) {
        if (file.kind === 'image') parts.push({ type: 'image_url', image_url: { url: `attachment:${file.id}` } });
        else parts.push({ type: 'text', text: renderPrompt('textAttachment', { name: file.name, text: Buffer.from(file.data).toString('utf8') }) });
      }
      return { role: r.role, content: parts.length > 1 ? parts : text };
    }).filter(m => typeof m.content !== 'string' || !!m.content.trim());
  }
  context(streamId: string): ChatMessage[] { return replyContext(this.resolve(this.refs(streamId)), this.settings().replySystem); }
  budget(streamId?: string, sourceNodeId?: string) {
    if (!streamId) return { used: 80 };
    const messages = sourceNodeId ? this.resolve(this.refs(streamId, sourceNodeId)) : this.context(streamId);
    return { used: estimateMessages(messages) };
  }
  hydrate(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : m.content.map(p => {
      if (p.type !== 'image_url' || !p.image_url.url.startsWith('attachment:')) return p;
      const file = this.need('attachments', p.image_url.url.slice('attachment:'.length));
      return { type: 'image_url' as const, image_url: { url: `data:${file.mime};base64,${Buffer.from(file.data).toString('base64')}` } };
    }) }));
  }
  replay(requestId: string, signature: string): Row | undefined { const g = this.one('SELECT * FROM generations WHERE request_id=?', requestId); if (g && g.request_signature !== signature) throw new AppError(409, 'REQUEST_CONFLICT', '请求标识已用于其他操作'); return g; }
  result(g: Row): GenerationResult {
    const branch = this.one('SELECT * FROM branches WHERE stream_id=?', g.stream_id) as Anchor | undefined;
    const answer = g.target_message_id ? this.one('SELECT ordinal FROM messages WHERE id=?', g.target_message_id) : undefined;
    const previous = answer ? this.one("SELECT id,role FROM messages WHERE stream_id=? AND ordinal<? AND status!='deleted' ORDER BY ordinal DESC LIMIT 1", g.stream_id, answer.ordinal) : undefined;
    return { generationId: g.id, streamId: g.stream_id, messageId: g.target_message_id || undefined, questionMessageId: previous?.role === 'user' ? previous.id : undefined, branch };
  }
  generation(streamId: string, messageId: string | null, sourceNodeId: string | null, kind: string, messages: ChatMessage[], requestId: string, signature: string, selectedModel?: ModelConfig) {
    const model = selectedModel || this.models.get();
    const settings = { modelConfig: model };
    if (model.provider === 'openai' && !this.models.key(model.id)) throw new AppError(400, 'MODEL_CONFIG_REQUIRED', '请先配置此模型的 API Key');
    if (!model.supportsImages && messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'))) throw new AppError(400, 'IMAGES_UNSUPPORTED', '当前上下文包含图片，请选择支持图片输入的模型');
    const budget = modelBudget(model); if (estimateMessages(messages) + budget.output > budget.limit) throw new AppError(400, 'CONTEXT_TOO_LARGE', '上下文超过所选模型的预算，请减少附件或选择更大上下文的模型');
    const context = JSON.stringify(messages); if (Buffer.byteLength(context) > 8 * 1024 * 1024) throw new AppError(400, 'CONTEXT_TOO_LARGE', '上下文过长，请选择较小范围的内容');
    const gid = id();
    this.run('INSERT INTO generations(id,stream_id,target_message_id,source_node_id,kind,status,provider,settings_json,context_json,request_id,request_signature,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', gid, streamId, messageId, sourceNodeId, kind, 'queued', model.provider, JSON.stringify(settings), context, requestId, signature, now());
    if (messageId) this.run('UPDATE messages SET generation_id=?,model_label=? WHERE id=?', gid, model.name, messageId);
    this.touch(streamId); return this.need('generations', gid);
  }
  assertIdle(streamId: string) { if (this.one("SELECT id FROM generations WHERE stream_id=? AND status IN ('queued','streaming')", streamId)) throw new AppError(409, 'BUSY', '这段对话正在生成，请稍后再试'); }
  sendSignature(options: SendOptions) { return { modelId: options.modelId, attachments: options.attachments?.map(a => ({ name: a.name, kind: a.kind, mime: a.mime, digest: createHash('sha256').update(a.data).digest('hex') })) || [] }; }
  appendQuestion(streamId: string, text: string, requestId: string, options: SendOptions = {}): GenerationResult {
    const signature = JSON.stringify(['message', streamId, text, this.sendSignature(options)]); const old = this.replay(requestId, signature); if (old) return this.result(old);
    return this.tx(() => this.appendInside(streamId, text, requestId, signature, options));
  }
  appendInside(streamId: string, text: string, requestId: string, signature: string, options: SendOptions = {}) {
    this.need('streams', streamId); this.assertIdle(streamId);
    const next = Number(this.one('SELECT COALESCE(MAX(ordinal),-1)+1 AS n FROM messages WHERE stream_id=?', streamId)!.n);
    const user = id(), assistant = id();
    this.run("INSERT INTO messages(id,stream_id,ordinal,role,status) VALUES(?,?,?,'user','complete')", user, streamId, next); this.finalizeMessage(user, text || '附件'); saveAttachments(this, user, options.attachments || []);
    this.run("INSERT INTO messages(id,stream_id,ordinal,role,status) VALUES(?,?,?,'assistant','queued')", assistant, streamId, next + 1);
    const stream = this.need('streams', streamId);
    if (stream.kind === 'root' && next === 0) this.run("UPDATE sessions SET title=? WHERE id=? AND title='新的对话'", text.slice(0, 32), stream.session_id);
    return this.result(this.generation(streamId, assistant, null, stream.kind === 'root' ? 'reply' : 'branch', this.context(streamId), requestId, signature, this.models.get(options.modelId)));
  }
  createBranch(sourceNodeId: string, start: number, end: number, selectedText: string, question: string, requestId: string): GenerationResult;
  createBranch(sourceNodeId: string, start: number, end: number, selectedText: string, question: string, requestId: string, kind: 'question' | 'note', options?: SendOptions): GenerationResult | { streamId: string; branch: Anchor };
  createBranch(sourceNodeId: string, start: number, end: number, selectedText: string, question: string, requestId: string, kind: 'question' | 'note' = 'question', options: SendOptions = {}): GenerationResult | { streamId: string; branch: Anchor } {
    if (kind === 'note' && !question.trim()) throw new AppError(422, 'EMPTY_NOTE', '笔记不能为空');
    const signature = JSON.stringify(['branch', sourceNodeId, start, end, selectedText, question, this.sendSignature(options)]);
    if (kind === 'question') { const old = this.replay(requestId, signature); if (old) return this.result(old); }
    else { const old = this.one('SELECT * FROM branches WHERE request_id=?', requestId); if (old) { if (old.source_node_id !== sourceNodeId || old.start_offset !== start || old.end_offset !== end || old.selected_text !== selectedText || this.one('SELECT content_markdown FROM messages WHERE stream_id=? AND ordinal=0', old.stream_id)?.content_markdown !== question) throw new AppError(409, 'REQUEST_CONFLICT', '请求标识已用于其他操作'); return { streamId: old.stream_id, branch: old as Anchor }; } }
    return this.tx(() => {
      const node = this.need('content_nodes', sourceNodeId), slot = this.need('block_slots', node.slot_id), message = this.need('messages', slot.message_id), parent = this.need('streams', message.stream_id);
      if (slot.deleted_at || slot.active_node_id !== sourceNodeId || node.status !== 'available' || node.block_type === 'thematicBreak' || !['complete','stopped','error','interrupted'].includes(message.status)) throw new AppError(409, 'STALE_VERSION', '只能从当前已完成的正文创建分支');
      this.assertVisible(slot);
      if (!validBoundary(node.selection_text, start, end) || !validMathSelection(node.markdown, start, end) || !selectedText.trim() || node.selection_text.slice(start, end) !== selectedText) throw new AppError(422, 'INVALID_SELECTION', '选中文字发生变化或公式未完整选择，请重新选择');
      if (this.one('SELECT id FROM branches WHERE source_node_id=? AND start_offset<? AND end_offset>?', sourceNodeId, end, start)) throw new AppError(409, 'ANCHOR_OVERLAP', '选区包含已有分支，请重新选择');
      const refs = [...this.refs(message.stream_id, sourceNodeId), { role: 'user' as const, quote: selectedText }];
      const stream = id(); this.run("INSERT INTO streams VALUES(?,?,'branch',?)", stream, parent.session_id, JSON.stringify(refs));
      this.run('INSERT INTO branches(id,source_node_id,stream_id,start_offset,end_offset,selected_text,created_at,kind,request_id) VALUES(?,?,?,?,?,?,?,?,?)', id(), sourceNodeId, stream, start, end, selectedText, now(), kind, kind === 'note' ? requestId : null);
      if (kind === 'note') { const mid = id(); this.run("INSERT INTO messages(id,stream_id,ordinal,role,status) VALUES(?,?,0,'user','complete')", mid, stream); this.finalizeMessage(mid, question); this.touch(stream); return { streamId: stream, branch: this.one('SELECT * FROM branches WHERE stream_id=?', stream) as Anchor }; }
      return this.appendInside(stream, question, requestId, signature, options);
    });
  }
  branchTree(branchId: string): string[] {
    const branch = this.need('branches', branchId);
    return this.all(`WITH RECURSIVE subtree(id) AS (
      SELECT ? UNION
      SELECT b.stream_id FROM subtree t JOIN messages m ON m.stream_id=t.id
      JOIN block_slots s ON s.message_id=m.id JOIN content_nodes n ON n.slot_id=s.id
      JOIN branches b ON b.source_node_id=n.id
    ) SELECT id FROM subtree`, branch.stream_id).map(row => row.id as string);
  }
  deleteBranch(branchId: string) {
    return this.tx(() => {
      const branch = this.need('branches', branchId), source = this.need('content_nodes', branch.source_node_id);
      const slot = this.need('block_slots', source.slot_id), parent = this.need('messages', slot.message_id);
      const streamIds = this.branchTree(branchId);
      // Enumerate all versions and deleted slots before cascading source nodes.
      // Deleting a branch row alone does not cascade into its stream.
      for (const streamId of [...streamIds].reverse()) this.run('DELETE FROM streams WHERE id=?', streamId);
      this.pruneDeletedResources();
      this.touch(parent.stream_id);
      return { streamIds, parentStreamId: parent.stream_id };
    });
  }
  reeditQuestion(messageId: string) {
    return this.tx(() => {
      const answer = this.need('messages', messageId); this.assertIdle(answer.stream_id);
      const latest = this.one("SELECT id FROM messages WHERE stream_id=? AND status!='deleted' ORDER BY ordinal DESC LIMIT 1", answer.stream_id);
      const question = this.one("SELECT * FROM messages WHERE stream_id=? AND ordinal<? AND status!='deleted' ORDER BY ordinal DESC LIMIT 1", answer.stream_id, answer.ordinal);
      const standalone = answer.role === 'user' && latest?.id === messageId;
      if (!standalone && (answer.role !== 'assistant' || latest?.id !== messageId || question?.role !== 'user')) throw new AppError(409, 'NOT_LATEST_ANSWER', '只能重新编辑最新一轮问答');
      const original = standalone ? answer : question!;
      let text = this.visibleSlots(original.id).map(slot => {
        const meta = JSON.parse(this.one('SELECT meta_json FROM node_layout WHERE node_id=?', slot.active_node_id)?.meta_json || slot.render_meta_json);
        const prefix = `${meta.quote ? '> ' : ''}${meta.marker ? `${meta.marker === '•' ? '-' : meta.marker} ` : ''}`;
        return prefix + this.need('content_nodes', slot.active_node_id).markdown;
      }).join('\n\n');
      // An imported document can also be the preceding user message. Keep its
      // display images usable after deleting their original resource records.
      for (const resource of this.all('SELECT * FROM document_resources WHERE message_id=?', original.id)) text = text.replaceAll(`/api/document-resources/${resource.id}`, `data:${resource.mime};base64,${Buffer.from(resource.data).toString('base64')}`);
      const attachments = this.all('SELECT * FROM attachments WHERE message_id=? ORDER BY rowid', original.id).map(file => ({ name: file.name as string, kind: file.kind as 'image' | 'text', mime: file.mime as string, data: Buffer.from(file.data).toString(file.kind === 'image' ? 'base64' : 'utf8') }));
      const first = standalone ? { streamIds: [] as string[] } : this.deleteMessageInside(answer.id), second = this.deleteMessageInside(original.id);
      return { streamIds: [...new Set([...first.streamIds, ...second.streamIds])], parentStreamId: answer.stream_id as string, text, attachments };
    });
  }
  deleteMessage(messageId: string) { return this.tx(() => this.deleteMessageInside(messageId)); }
  private deleteMessageInside(messageId: string) {
      const message=this.need('messages',messageId);this.assertIdle(message.stream_id);
      const streamIds:string[]=[];
      for(const branch of this.all('SELECT b.id FROM branches b JOIN content_nodes n ON n.id=b.source_node_id JOIN block_slots s ON s.id=n.slot_id WHERE s.message_id=?',messageId)) streamIds.push(...this.branchTree(branch.id));
      for(const id of [...new Set(streamIds)].reverse()) this.run('DELETE FROM streams WHERE id=?',id);
      this.run('UPDATE block_slots SET deleted_at=? WHERE message_id=?',now(),messageId);
      this.run("UPDATE messages SET status='deleted',content_markdown='',reasoning_text='' WHERE id=?",messageId);
      this.run('DELETE FROM generations WHERE target_message_id=?',messageId);
      this.pruneDeletedResources();this.touch(message.stream_id);
      return {streamIds:[...new Set(streamIds)],parentStreamId:message.stream_id};
  }
  private removeEmptyMessage(messageId: string) {
    const message = this.one('SELECT * FROM messages WHERE id=?', messageId);
    if (message && !['queued','streaming','deleted'].includes(message.status) && !this.visibleSlots(messageId).length) {
      this.run("UPDATE messages SET status='deleted',content_markdown='',reasoning_text='' WHERE id=?", messageId);
      this.pruneDeletedResources();
    }
  }
  pruneDeletedResources() {
    // Frozen snapshots in surviving branches still need their ancestor nodes.
    const retained = new Set<string>(), attachmentMessages = new Set<string>();
    for (const stream of this.all('SELECT context_snapshot_json FROM streams'))
      for (const ref of JSON.parse(stream.context_snapshot_json) as ContextRef[]) {
        for (const id of ref.nodeIds || []) retained.add(id);
        if (ref.attachmentMessageId) attachmentMessages.add(ref.attachmentMessageId);
      }
    for (const slot of this.all("SELECT id,deleted_at FROM block_slots WHERE deleted_at IS NOT NULL OR EXISTS(SELECT 1 FROM content_nodes n WHERE n.slot_id=block_slots.id AND n.status='deleted')")) {
      for (const node of this.all("SELECT id FROM content_nodes WHERE slot_id=? AND (status='deleted' OR ? IS NOT NULL)",slot.id,slot.deleted_at))
        if (!retained.has(node.id)) this.run('DELETE FROM content_nodes WHERE id=?',node.id);
      if (!this.one('SELECT id FROM content_nodes WHERE slot_id=?',slot.id)) this.run('DELETE FROM block_slots WHERE id=?',slot.id);
    }
    for (const message of this.all("SELECT id FROM messages WHERE status IN ('complete','stopped','deleted') AND NOT EXISTS(SELECT 1 FROM block_slots s WHERE s.message_id=messages.id AND s.deleted_at IS NULL)"))
      if (!attachmentMessages.has(message.id)) this.run('DELETE FROM attachments WHERE message_id=?',message.id);
    for(const message of this.all("SELECT id FROM messages WHERE status='deleted'"))
      if(!attachmentMessages.has(message.id) && !this.one('SELECT id FROM block_slots WHERE message_id=?',message.id)) this.run('DELETE FROM messages WHERE id=?',message.id);
    // Imported images never enter model context; only renderable versions need them.
    const markdown = this.all("SELECT n.markdown FROM content_nodes n JOIN block_slots s ON s.id=n.slot_id WHERE s.deleted_at IS NULL AND n.status!='deleted'").map(n=>n.markdown as string);
    for (const resource of this.all('SELECT id FROM document_resources'))
      if (!markdown.some(text=>text.includes(`/api/document-resources/${resource.id}`))) this.run('DELETE FROM document_resources WHERE id=?',resource.id);
  }
  rewrite(nodeId: string, requestId: string, modelId?: string): GenerationResult {
    const signature = JSON.stringify(['rewrite', nodeId, modelId]); const old = this.replay(requestId, signature); if (old) return this.result(old);
    return this.tx(() => {
      const node = this.need('content_nodes', nodeId), slot = this.need('block_slots', node.slot_id), message = this.need('messages', slot.message_id);
      this.assertVisible(slot);
      if (slot.deleted_at || slot.active_node_id !== nodeId || node.block_type === 'image') throw new AppError(409, 'STALE_VERSION', '请从当前正文重新解释');
      this.assertIdle(message.stream_id);
      if (!this.one('SELECT id FROM branches WHERE source_node_id=?', nodeId)) throw new AppError(400, 'NO_BRANCHES', '请先针对这段内容追问');
      const parts: string[] = [], stack = [nodeId], visited = new Set<string>();
      while (stack.length) {
        const source = stack.pop()!;
        if (visited.has(source)) throw new AppError(409, 'INVALID_TREE', '分支关系异常'); visited.add(source);
        for (const branch of this.all('SELECT * FROM branches WHERE source_node_id=? ORDER BY created_at,id', source)) {
          const child = this.need('streams', branch.stream_id); if (child.session_id !== this.need('streams', message.stream_id).session_id) throw new AppError(409, 'INVALID_TREE', '分支不属于当前会话');
          this.assertIdle(branch.stream_id);
          parts.push(renderPrompt('rewriteSource', { nodeId: source, text: branch.selected_text }));
          parts.push(...this.resolve(this.refs(branch.stream_id).slice(JSON.parse(child.context_snapshot_json).length)).map(m => renderPrompt('rewriteTurn', { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })));
          const ids = this.all("SELECT id FROM messages WHERE stream_id=? AND status IN ('complete','stopped','error','interrupted') ORDER BY ordinal", branch.stream_id).flatMap(m => this.visibleSlots(m.id).map(s => s.active_node_id as string));
          stack.push(...ids.reverse());
        }
      }
      const context = rewriteContext(this.resolve(this.refs(message.stream_id, nodeId)), withoutImages(node.markdown), parts.join('\n\n'));
      return this.result(this.generation(message.stream_id, null, nodeId, 'rewrite', context, requestId, signature, this.models.get(modelId)));
    });
  }
  finish(gid: string, markdown: string): Record<string, string> {
    return this.tx(() => {
      const g = this.need('generations', gid); if (g.status !== 'streaming') throw new AppError(409, 'GENERATION_ENDED', '生成已结束');
      if (!splitMarkdown(markdown).length && g.target_message_id) {
        this.run("UPDATE generations SET status='complete',finished_at=? WHERE id=?", now(), gid);
        this.run("UPDATE messages SET status='complete' WHERE id=?", g.target_message_id);
        this.removeEmptyMessage(g.target_message_id); this.touch(g.stream_id); return { generationId: gid };
      }
      if (!markdown.trim()) throw new AppError(502, 'EMPTY_OUTPUT', '模型未返回正文');
      let result: Record<string, string> = { generationId: gid };
      if (g.kind === 'rewrite') {
        const source = this.need('content_nodes', g.source_node_id), nid = id(), pid = id();
        const version = Number(this.one('SELECT MAX(version_no)+1 AS n FROM content_nodes WHERE slot_id=?', source.slot_id)!.n);
        const first = splitMarkdown(markdown)[0];
        if (!first) throw new AppError(502, 'EMPTY_OUTPUT', '模型未返回正文');
        const sourceSlot = this.need('block_slots', source.slot_id);
        const oldMeta = JSON.parse(this.one('SELECT meta_json FROM node_layout WHERE node_id=?', source.id)?.meta_json || sourceSlot.render_meta_json);
        if (first.type === 'paragraph' && oldMeta.marker) first.meta = oldMeta;
        this.run('INSERT INTO content_nodes VALUES(?,?,?,?,?,?,?,?,?)', nid, source.slot_id, version, source.id, first.markdown, first.text, first.type, 'candidate', now());
        this.run('INSERT INTO node_layout VALUES(?,?)', nid, JSON.stringify(first.meta));
        this.run("INSERT INTO rewrite_proposals VALUES(?,?,?,?,'pending')", pid, gid, source.id, nid); result = { ...result, proposalId: pid, candidateNodeId: nid };
      } else { this.run('UPDATE messages SET reasoning_text=? WHERE id=?', g.reasoning_text || '', g.target_message_id); this.finalizeMessage(g.target_message_id, markdown); result.messageId = g.target_message_id; }
      this.run("UPDATE generations SET status='complete',draft_markdown=?,finished_at=? WHERE id=?", markdown, now(), gid); this.touch(g.stream_id); return result;
    });
  }
  end(gid: string, status: 'error' | 'stopped' | 'interrupted', code: string, draft: string) {
    if (!this.one('SELECT id FROM generations WHERE id=?', gid)) return;
    this.tx(() => {
      const g = this.need('generations', gid);
      if (!['streaming','queued'].includes(g.status)) return;
      if (g.target_message_id && splitMarkdown(draft).length) {
        this.finalizeMessage(g.target_message_id, draft);
      }
      this.run('UPDATE generations SET status=?,error_code=?,draft_markdown=?,finished_at=? WHERE id=?', status, code, draft, now(), gid);
      if (g.target_message_id) {
        this.run('UPDATE messages SET status=?,content_markdown=?,reasoning_text=? WHERE id=?', status, draft, g.reasoning_text || '', g.target_message_id);
        this.removeEmptyMessage(g.target_message_id);
      }
      this.touch(g.stream_id);
    });
  }

  switchVersion(slotId: string, nodeId: string, expected: string) {
    this.tx(() => { const slot = this.need('block_slots', slotId), node = this.need('content_nodes', nodeId); this.assertVisible(slot); if (slot.deleted_at || slot.active_node_id !== expected || node.slot_id !== slotId || node.status !== 'available') throw new AppError(409, 'VERSION_CONFLICT', '版本已变化，请刷新后再试'); this.run('UPDATE block_slots SET active_node_id=? WHERE id=?', nodeId, slotId); });
  }
  changeBlock(slotId: string, expected: string, markdown?: string, scope: 'all' | 'current' | 'history' = 'all') {
    return this.tx(() => {
      const slot = this.need('block_slots', slotId), message = this.need('messages', slot.message_id);
      this.assertVisible(slot);
      if (slot.deleted_at || slot.active_node_id !== expected || !['complete','stopped','error','interrupted'].includes(message.status)) throw new AppError(409, 'VERSION_CONFLICT', '内容已变化，请刷新后再试');
      this.assertIdle(message.stream_id);
      if (this.one("SELECT id FROM rewrite_proposals WHERE source_node_id=? AND status='pending'", expected)) throw new AppError(409, 'PENDING_REWRITE', '请先处理重构预览');
      const streamIds: string[] = [];
      if (markdown === undefined) {
        for (const branch of this.all("SELECT b.id FROM branches b JOIN content_nodes n ON n.id=b.source_node_id WHERE n.slot_id=? AND (?='all' OR (?='current' AND n.id=?) OR (?='history' AND n.id!=?))",slotId,scope,scope,expected,scope,expected)) {
          streamIds.push(...this.branchTree(branch.id));
        }
        for (const id of [...new Set(streamIds)].reverse()) this.run('DELETE FROM streams WHERE id=?',id);
        const versions = this.all("SELECT id FROM content_nodes WHERE slot_id=? AND status='available' ORDER BY version_no",slotId);
        const at = versions.findIndex(n=>n.id===expected);
        const next = versions[at-1] || versions[at+1];
        if (scope === 'history') {
          this.run("UPDATE content_nodes SET status='deleted' WHERE slot_id=? AND id!=?",slotId,expected);
        } else if (scope === 'current' && next) {
          this.run("UPDATE content_nodes SET status='deleted' WHERE id=?",expected);
          this.run('UPDATE block_slots SET active_node_id=? WHERE id=?',next.id,slotId);
        } else this.run('UPDATE block_slots SET deleted_at=? WHERE id=?', now(), slotId);
        this.pruneDeletedResources();
      } else {
        const blocks = splitMarkdown(markdown);
        if (!blocks.length) {
          for (const branch of this.all('SELECT b.id FROM branches b JOIN content_nodes n ON n.id=b.source_node_id WHERE n.slot_id=?', slotId)) streamIds.push(...this.branchTree(branch.id));
          for (const child of [...new Set(streamIds)].reverse()) this.run('DELETE FROM streams WHERE id=?', child);
          this.run('UPDATE block_slots SET deleted_at=? WHERE id=?', now(), slotId); this.pruneDeletedResources();
          this.removeEmptyMessage(message.id); this.touch(message.stream_id); return { ok: true, streamIds };
        }
        const node = this.need('content_nodes', expected);
        if (markdown !== node.markdown || blocks.length > 1) {
          const first = blocks[0], nid = id(), version = Number(this.one('SELECT MAX(version_no)+1 AS n FROM content_nodes WHERE slot_id=?', slotId)!.n);
          const oldMeta = JSON.parse(this.one('SELECT meta_json FROM node_layout WHERE node_id=?', expected)?.meta_json || slot.render_meta_json);
          // Editing a list item's body retains its marker unless new Markdown supplies structure.
          if (first.type === 'paragraph' && oldMeta.marker) first.meta = oldMeta;
          this.run('INSERT INTO content_nodes VALUES(?,?,?,?,?,?,?,?,?)', nid, slotId, version, expected, first.markdown, first.text, first.type, 'available', now());
          this.run('INSERT INTO node_layout VALUES(?,?)', nid, JSON.stringify(first.meta));
          this.run('UPDATE block_slots SET active_node_id=? WHERE id=?', nid, slotId);
          this.insertBlocks(slot, blocks.slice(1));
        }
      }
      this.removeEmptyMessage(message.id);
      this.touch(message.stream_id);
      return { ok: true, streamIds };
    });
  }
  insertBlocks(after: Row, blocks: ReturnType<typeof splitMarkdown>) {
    // Shift in two phases to preserve UNIQUE(message_id, ordinal) at every row update.
    this.run('UPDATE block_slots SET ordinal=-ordinal-1 WHERE message_id=? AND ordinal>?', after.message_id, after.ordinal);
    this.run('UPDATE block_slots SET ordinal=-ordinal-1+? WHERE message_id=? AND ordinal<0', blocks.length, after.message_id);
    return blocks.map((b, i) => {
      const sid = id(), nid = id();
      this.run('INSERT INTO block_slots(id,message_id,ordinal,active_node_id,render_meta_json) VALUES(?,?,?,?,?)', sid, after.message_id, after.ordinal + i + 1, null, JSON.stringify(b.meta));
      this.run('INSERT INTO content_nodes VALUES(?,?,1,NULL,?,?,?,?,?)', nid, sid, b.markdown, b.text, b.type, 'available', now());
      this.run('UPDATE block_slots SET active_node_id=? WHERE id=?', nid, sid);
      return sid;
    });
  }
  addBlock(slotId: string, expected: string, markdown: string) {
    return this.tx(() => {
      const slot = this.need('block_slots', slotId), message = this.need('messages', slot.message_id);
      this.assertVisible(slot); this.assertIdle(message.stream_id);
      if (slot.active_node_id !== expected || !['complete','stopped','error','interrupted'].includes(message.status)) throw new AppError(409, 'VERSION_CONFLICT', '内容已变化，请刷新后再试');
      const blocks = splitMarkdown(markdown); if (!blocks.length) throw new AppError(422, 'EMPTY_BLOCK', '内容不能为空');
      const ids = this.insertBlocks(slot, blocks); this.touch(message.stream_id); return { slotIds: ids };
    });
  }
  decideProposal(pid: string, accept: boolean, expected?: string) {
    this.tx(() => {
      const p = this.need('rewrite_proposals', pid);
      if (p.status !== 'pending') throw new AppError(409, 'PROPOSAL_ENDED', '这个预览已经处理');
      const node = this.need('content_nodes', p.candidate_node_id), slot = this.need('block_slots', node.slot_id);
      if (accept) {
        if (slot.active_node_id !== expected || expected !== p.source_node_id) throw new AppError(409, 'VERSION_CONFLICT', '原文版本已切换，请保留原文后重新生成');
        this.assertVisible(slot);
        this.assertIdle(this.need('messages', slot.message_id).stream_id);
        const blocks = splitMarkdown(this.need('generations', p.generation_id).draft_markdown);
        if (!blocks.length) throw new AppError(422, 'EMPTY_BLOCK', '内容不能为空');
        this.run("UPDATE content_nodes SET status='available' WHERE id=?", node.id);
        this.run('UPDATE block_slots SET active_node_id=? WHERE id=?', node.id, slot.id);
        this.insertBlocks(slot, blocks.slice(1));
        this.touch(this.need('messages', slot.message_id).stream_id);
      } else this.run("UPDATE content_nodes SET status='discarded' WHERE id=?", node.id);
      this.run('UPDATE rewrite_proposals SET status=? WHERE id=?', accept ? 'accepted' : 'rejected', pid);
    });
  }
}
