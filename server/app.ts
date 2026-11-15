import { renderPrompt } from './prompts';
import { UpdateChecker } from './updates';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError, Store } from './store';
import { streamAgent } from './providers/agent';
import { streamChat } from './providers/chat';
import { importDocument, convertPaper } from './documents';
import fakePrompts from '../prompts/fake.json';
import { fixture } from './providers/fake';
import { ModelImportCache, type ImportCandidate } from './model-import';
import { discoverModels, checkModel } from './model-connection';

const requestId = z.string().uuid();
const question = z.string().trim().min(1, '请输入问题').max(30_000);
const idParam = (req: Request) => String(req.params.id);
export function createApp(store: Store, options: { searchEndpoint?: string; readModelImports?: () => Promise<ImportCandidate[]>; releaseVersion?: string; paperEndpoint?: string; staticDir?: string; apiToken?: string; allowedOrigins?: string[]; pickDocument?: () => Promise<import('../shared/documents').DocumentImport | null> } = {}) {
  const app = express();
  const updates = new UpdateChecker(store, options.releaseVersion);
  const active = new Map<string, AbortController>();
  const activeDrafts = new Map<string, () => string>();
  const modelImports = new ModelImportCache(options.readModelImports);
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    if (options.apiToken && req.get('x-zhizhi-token') !== options.apiToken && req.get('authorization') !== `Bearer ${options.apiToken}`) {
      res.status(401).json({error:{code:'UNAUTHORIZED',message:'请从枝知应用中访问'}}); return;
    }
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try { const u = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !['http:', 'https:'].includes(u.protocol) || ![req.get('host'), ...(options.allowedOrigins || ['http://127.0.0.1:5173','http://localhost:5173']).map(value=>new URL(value).host)].includes(u.host)) throw new Error(); }
      catch { res.status(403).json({ error: { code: 'ORIGIN_DENIED', message: '只允许本机应用访问' } }); return; }
    }
    next();
  });
  const parameters = z.array(z.object({ key: z.string().min(1).max(100), value: z.json(), enabled: z.boolean() })).max(50);
  const connectionInput = z.object({ baseUrl: z.string().trim().url().refine(s => { const url = new URL(s); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }), apiType: z.enum(['chat','responses','messages']).default('chat'), authType: z.enum(['bearer','api-key']).optional(), apiKey: z.string().max(10000).optional(), configuredModelId: z.string().optional(), importSourceId: z.string().optional() });
  const modelInput = connectionInput.omit({ configuredModelId: true }).extend({ name: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), supportsImages: z.boolean(), parameters, clearApiKey: z.boolean().optional() });
  const credentials = (d: z.infer<typeof connectionInput>) => {
    if (d.apiKey) return d.apiKey;
    if (d.importSourceId) {
      try { return modelImports.resolve(d.importSourceId, d.baseUrl, d.apiType, d.authType); }
      catch(e) { throw new AppError(400, 'IMPORT_EXPIRED', (e as Error).message); }
    }
    return d.configuredModelId ? store.models.key(d.configuredModelId) : '';
  };
  const saveModel = (d: z.infer<typeof modelInput>, id?: string) => {
    const { importSourceId, ...value } = d;
    return store.models.save({ ...value, id, apiKey: d.clearApiKey ? undefined : credentials(d), provider: 'openai' });
  };
  const attachmentInput = z.array(z.object({ name: z.string().min(1).max(250), kind: z.enum(['text','image']), mime: z.string().max(100), data: z.string().max(8 * 1024 * 1024) })).max(6).default([]);
  const sendOptions = { webSearch: z.enum(['off','auto']).default('off'), modelId: z.string().max(100).optional(), attachments: attachmentInput };
  app.get('/api/documents/picker', (_req,res) => res.json({available:!!options.pickDocument}));
  app.post('/api/documents/picker', async (_req,res) => res.json(options.pickDocument ? await options.pickDocument() : null));
  app.get('/api/search-settings', (_req, res) => res.json({ provider: 'deepseek', configured: !!store.secrets.read().searchKey }));
  app.put('/api/search-settings', (req, res) => {
    const data = z.object({ apiKey: z.string().trim().max(10000).optional(), clear: z.boolean().optional() }).parse(req.body);
    const secrets = store.secrets.read();
    if (data.clear) delete secrets.searchKey;
    else if (data.apiKey) secrets.searchKey = data.apiKey;
    store.secrets.write(secrets);
    res.json({ provider: 'deepseek', configured: !!secrets.searchKey });
  });
  app.get('/api/models', (_req, res) => res.json(store.models.list()));
  app.post('/api/models', (req, res) => res.json(saveModel(modelInput.parse(req.body))));
  app.put('/api/models/:id', (req, res) => {
    if (idParam(req) === 'fake') { const { fakeDelay } = z.object({ fakeDelay: z.number().int().min(0).max(250) }).parse(req.body); store.saveSettings({ ...store.settings(), fakeDelay }); res.json(store.models.get('fake')); }
    else { store.models.get(idParam(req)); res.json(saveModel(modelInput.parse(req.body), idParam(req))); }
  });
  app.delete('/api/models/:id', (req, res) => { store.models.delete(idParam(req)); res.json({ ok: true }); });
  app.post('/api/models/import-sources', async (_req, res) => { res.set('Cache-Control','no-store'); res.json(await modelImports.list()); });
  app.post('/api/models/discover', async (req, res) => {
    const d = connectionInput.parse(req.body), key = credentials(d);
    const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.once('close',close);
    try { res.json({ models: await discoverModels(d.baseUrl, d.apiType, key, AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), d.authType) }); }
    catch (e) { throw e instanceof AppError ? e : new AppError(502, 'MODEL_LIST_ERROR', '无法读取模型列表，请检查连接；也可手动填写模型 ID'); }
    finally { res.off('close',close); }
  });
  app.post('/api/models/check', async (req, res) => {
    const d = connectionInput.extend({ model: z.string().trim().min(1).max(200) }).parse(req.body), key = credentials(d);
    const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.once('close',close);
    try {
      const outputParameter = await checkModel({ id:'check', provider:'openai', name:'check', ...d, supportsImages:false, parameters:[{ key:'max_tokens', value:256, enabled:true }] }, key, AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]));
      res.json({ ok:true, outputParameter });
    } catch(e) { throw e instanceof AppError ? e : new AppError(502, 'MODEL_CHECK_FAILED', '模型测试失败，请检查接口类型、模型 ID 及连接'); }
    finally { res.off('close',close); }
  });
  app.get('/api/streams/:id/context', (req, res) => res.json(store.budget(idParam(req), typeof req.query.sourceNodeId === 'string' ? req.query.sourceNodeId : undefined)));
  app.get('/api/attachments/:id', (req, res) => { const file = store.need('attachments', idParam(req)); res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }); res.send(Buffer.from(file.data)); });
  app.post('/api/documents/import', (req, res) => {
    const data = z.object({ name: z.string().trim().min(1).max(250), documentPath: z.string().max(1000).optional(), markdown: z.string().min(1).max(2 * 1024 * 1024), resources: z.array(z.object({path:z.string().min(1).max(1000),data:z.string().max(7*1024*1024)})).max(200).default([]) }).parse(req.body);
    res.json(importDocument(store,data));
  });
  app.post('/api/documents/paper', async (req,res) => {
    const {url} = z.object({url:z.string().trim().min(1).max(2000)}).parse(req.body);
    const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.once('close',close);
    try { const document = await convertPaper(url,options.paperEndpoint,abort.signal); if (!abort.signal.aborted) res.json(importDocument(store,document)); }
    finally { res.off('close',close); }
  });
  app.get('/api/document-resources/:id', (req,res) => {
    const file = store.need('document_resources',idParam(req));
    res.set({'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}); res.send(Buffer.from(file.data));
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/sessions', (_req, res) => res.json(store.sessions()));
  app.get('/api/sessions/:id/map', (req, res) => res.json(store.conversationMap(idParam(req))));
  app.get('/api/sessions/:id/map/search', (req, res) => { const { q } = z.object({ q: z.string().trim().max(200) }).parse(req.query); res.json(store.searchConversationMap(idParam(req), q)); });
  app.post('/api/sessions', (req, res) => res.json(store.createSession(z.object({ title: z.string().trim().min(1).max(120).optional() }).parse(req.body).title)));
  app.patch('/api/sessions/:id', (req, res) => { store.need('sessions', idParam(req)); const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(req.body); store.run('UPDATE sessions SET title=? WHERE id=?', title, idParam(req)); res.json({ ok: true }); });
  app.delete('/api/sessions/:id', (req, res) => { const sid = idParam(req); store.need('sessions', sid); for (const g of store.all('SELECT g.id FROM generations g JOIN streams s ON s.id=g.stream_id WHERE s.session_id=?', sid)) active.get(g.id)?.abort(); store.tx(() => store.run('DELETE FROM sessions WHERE id=?', sid)); res.json({ ok: true }); });
  app.get('/api/streams/:id', (req, res) => res.json(store.stream(idParam(req))));
  app.post('/api/streams/:id/messages', (req, res) => { const data = z.object({ text: z.string().trim().max(30_000), requestId, ...sendOptions }).parse(req.body); if (!data.text && !data.attachments.length) throw new AppError(400, 'INVALID_INPUT', '请输入问题或添加附件'); res.json(store.appendQuestion(idParam(req), data.text, data.requestId, data)); });
  app.post('/api/branches', (req, res) => { const d = z.object({ sourceNodeId: z.string().uuid(), start: z.number().int(), end: z.number().int(), selectedText: z.string().min(1), question: question.optional(), kind: z.enum(['question','note']).default('question'), requestId, ...sendOptions }).parse(req.body); if (d.kind === 'question' && !d.question && !d.attachments.length) throw new AppError(400, 'INVALID_INPUT', '请输入问题'); res.json(store.createBranch(d.sourceNodeId, d.start, d.end, d.selectedText, d.question || '', d.requestId, d.kind, d)); });
  app.delete('/api/branches/:id', (req,res) => {
    const streams = new Set(store.branchTree(idParam(req)));
    for (const generation of store.all("SELECT id,stream_id FROM generations WHERE status IN ('queued','streaming')")) {
      if (streams.has(generation.stream_id)) active.get(generation.id)?.abort('deleted');
    }
    res.json(store.deleteBranch(idParam(req)));
  });
  app.post('/api/slots/:id/after', (req, res) => { const d = z.object({ markdown: question, expectedActiveNodeId: z.string().uuid() }).parse(req.body); res.json(store.addBlock(idParam(req), d.expectedActiveNodeId, d.markdown)); });
  app.post('/api/nodes/:id/rewrites', (req, res) => { const data = z.object({ requestId, modelId: z.string().max(100).optional(), webSearch: z.enum(['off','auto']).default('off') }).parse(req.body); res.json(store.rewrite(idParam(req), data.requestId, data.modelId, data.webSearch)); });
  app.patch('/api/slots/:id/active-version', (req, res) => { const d = z.object({ nodeId: z.string().uuid(), expectedActiveNodeId: z.string().uuid() }).parse(req.body); store.switchVersion(idParam(req), d.nodeId, d.expectedActiveNodeId); res.json({ ok: true }); });
  app.patch('/api/slots/:id/content', (req, res) => { const d = z.object({ markdown: z.string().trim().max(30_000), expectedActiveNodeId: z.string().uuid() }).parse(req.body); res.json(store.changeBlock(idParam(req), d.expectedActiveNodeId, d.markdown)); });
  app.post('/api/messages/:id/reedit', (req,res) => res.json(store.reeditQuestion(idParam(req))));
  app.delete('/api/messages/:id', (req,res)=>{const result=store.deleteMessage(idParam(req));for(const g of active.keys())if(!store.one('SELECT id FROM generations WHERE id=?',g))active.get(g)?.abort('deleted');res.json(result);});
  app.delete('/api/slots/:id', (req, res) => { const d = z.object({ expectedActiveNodeId: z.string().uuid(), scope:z.enum(['all','current','history']) }).parse(req.body); const result = store.changeBlock(idParam(req), d.expectedActiveNodeId, undefined, d.scope); for (const g of active.keys()) { if (!store.one('SELECT id FROM generations WHERE id=?',g)) active.get(g)?.abort('deleted'); } res.json(result); });
  app.post('/api/rewrite-proposals/:id/accept', (req, res) => { store.decideProposal(idParam(req), true, z.object({ expectedActiveNodeId: z.string().uuid() }).parse(req.body).expectedActiveNodeId); res.json({ ok: true }); });
  app.post('/api/rewrite-proposals/:id/reject', (req, res) => { store.decideProposal(idParam(req), false); res.json({ ok: true }); });
  app.get('/api/storage', (_req,res) => res.json(store.storageInfo()));
  app.delete('/api/storage', (req,res) => {
    z.object({confirm:z.literal('DELETE_ALL_DATA')}).parse(req.body);
    for(const controller of active.values()) controller.abort('deleted');
    res.json(store.clearData());
  });
  app.get('/api/folders', (_req,res) => res.json(store.folders()));
  app.post('/api/folders', (req,res) => { const d=z.object({ name:z.string().trim().min(1).max(80),parentId:z.string().nullable().optional() }).parse(req.body); res.json(store.saveFolder(null,d.name,d.parentId)); });
  app.patch('/api/folders/:id', (req,res) => { const d=z.object({ name:z.string().trim().min(1).max(80) }).parse(req.body); const f=store.need('folders',idParam(req)); res.json(store.saveFolder(f.id,d.name,f.parent_id)); });
  app.post('/api/folders/:id/move', (req,res) => { const d=z.object({ parentId:z.string().nullable(),beforeId:z.string().optional() }).parse(req.body); res.json(store.moveFolder(idParam(req),d.parentId,d.beforeId)); });
  app.delete('/api/folders/:id', (req,res) => res.json(store.deleteFolder(idParam(req))));
  app.post('/api/sessions/:id/move', (req,res) => { const d=z.object({ folderId:z.string().nullable(),beforeId:z.string().optional() }).parse(req.body); res.json(store.moveSession(idParam(req),d.folderId,d.beforeId)); });
  app.get('/api/updates', (_req,res) => res.json(updates.status()));
  app.post('/api/updates/check', async (req,res) => { const data=z.object({manual:z.boolean().default(false)}).parse(req.body); res.json(await updates.check(data.manual)); });
  app.get('/api/settings/reply-system', (_req, res) => res.json({ defaultPrompt: renderPrompt('replySystem') }));
  app.get('/api/settings', (_req, res) => res.json(store.settings()));
  app.put('/api/settings', (req, res) => {
    const data = z.object({ theme: z.enum(['light','dark','system']).optional(), stackDirection: z.enum(['up','left']).optional(), nickname:z.string().trim().min(1).max(40).optional(), fontSize:z.number().int().min(12).max(22).optional(), sendShortcut:z.enum(['enter','mod-enter']).optional(), confirmDeletion:z.boolean().optional(), autoScroll:z.boolean().optional(), showOutline:z.boolean().optional(), blurBackdrop:z.boolean().optional(), sidebarBlur:z.boolean().optional(), replySystem:z.string().max(32000).nullable().optional(), updateNotifications:z.boolean().optional(), fakeDelay: z.number().int().min(0).max(250).optional() }).parse(req.body); res.json(store.saveSettings({ ...store.settings(), ...data }));
  });
  app.post('/api/fake/v1/chat/completions', async (req, res) => {
    const d = z.object({ messages: z.array(z.object({ role: z.string(), content: z.union([z.string(), z.array(z.unknown())]) })), stream: z.literal(true), __fake: z.object({ kind: z.enum(['reply','branch','rewrite']), depth: z.number().int().min(0).max(500), delay: z.number().min(0).max(250), failure: z.enum(['error','disconnect']).optional() }) }).parse(req.body);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    const reasoning = fakePrompts.reasoning;
    for (let i = 0; i < reasoning.length && !res.destroyed; i += 12) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning.slice(i, i + 12) } }] })}\n\n`); if (d.__fake.delay) await delay(d.__fake.delay); }
    const text = fixture(d.__fake.kind, d.__fake.depth); const chunks = Array.from(text);
    for (let i = 0; i < chunks.length && !res.destroyed; i += 12) {
      if (d.__fake.failure && i > 48) { if (d.__fake.failure === 'error') res.write(`data: ${JSON.stringify({ error: { message: 'fake failure' } })}\n\n`); res.end(); return; }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks.slice(i, i + 12).join('') } }] })}\n\n`);
      if (d.__fake.delay) await delay(d.__fake.delay);
    }
    if (!res.destroyed) res.end('data: [DONE]\n\n');
  });
  app.post('/api/generations/:id/cancel', (req, res) => { const gid = idParam(req); store.need('generations', gid); active.get(gid)?.abort('stopped'); const g = store.need('generations', gid); store.end(gid, 'stopped', 'STOPPED', activeDrafts.get(gid)?.() ?? g.draft_markdown); res.json({ ok: true }); });
  app.get('/api/generations/:id/events', async (req, res) => {
    const gid = idParam(req), g = store.need('generations', gid);
    if (g.status !== 'queued' || active.has(gid)) throw new AppError(409, 'GENERATION_ENDED', '生成已启动或结束，请刷新对话');
    const controller = new AbortController(); active.set(gid, controller);
    store.run("UPDATE generations SET status='streaming' WHERE id=?", gid);
    if (g.target_message_id) store.run("UPDATE messages SET status='streaming' WHERE id=?", g.target_message_id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    const send = (event: string, data: unknown) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    let draft = '', reasoning = '', savedAt = 0;
    activeDrafts.set(gid, () => draft);
    const close = () => { if (!res.writableEnded) controller.abort('interrupted'); }; res.on('close', close);
    send('start', { generationId: gid, kind: g.kind });
    try {
      const stream = store.need('streams', g.stream_id);
      const depth = JSON.parse(stream.context_snapshot_json).filter((r: { quote?: string }) => r.quote !== undefined).length;
      const address = req.socket.localAddress?.includes(':') ? '127.0.0.1' : req.socket.localAddress || '127.0.0.1';
      const settings = JSON.parse(g.settings_json);
      const messages = JSON.parse(g.context_json);
      const onReasoning = (text: string) => { reasoning += text; store.run('UPDATE generations SET reasoning_text=? WHERE id=?', reasoning, gid); if (g.target_message_id) store.run('UPDATE messages SET reasoning_text=? WHERE id=?', reasoning, g.target_message_id); send('reasoning', { text }); };
      const output = settings.webSearch === 'auto'
        ? streamAgent({ model: settings.modelConfig, apiKey: store.models.key(settings.modelConfig.id), searchKey: store.secrets.read().searchKey || '', messages: store.hydrate(messages), signal: controller.signal, onReasoning, onProgress: progress => send('search-progress', progress), searchEndpoint: options.searchEndpoint })
        : streamChat({ messages: store.hydrate(messages), settings, apiKey: store.models.key(settings.modelConfig.id), internalToken: options.apiToken, onReasoning, fakeUrl: `http://${address}:${req.socket.localPort}/api/fake/v1/chat/completions`, kind: g.kind, depth, signal: controller.signal });
      for await (const text of output) {
        if (controller.signal.aborted) break;
        draft += text; send('delta', { text });
        if (Date.now() - savedAt > 250) { store.run('UPDATE generations SET draft_markdown=? WHERE id=?', draft, gid); savedAt = Date.now(); }
      }
      if (controller.signal.aborted) throw new Error('aborted');
      const result = store.finish(gid, draft); send('complete', result);
    } catch (e) {
      const stopped = controller.signal.aborted;
      const err = e instanceof AppError ? e : new AppError(502, 'UPSTREAM_ERROR', '生成未完成，请检查模型设置');
      store.end(gid, stopped ? (controller.signal.reason === 'stopped' ? 'stopped' : 'interrupted') : 'error', stopped ? 'INTERRUPTED' : err.code, draft);
      send('error', { code: controller.signal.reason === 'deleted' ? 'BRANCH_DELETED' : stopped ? 'INTERRUPTED' : err.code, message: stopped ? '生成已停止' : err.message });
    } finally { active.delete(gid); activeDrafts.delete(gid); res.off('close', close); res.end(); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }));
  const dist = options.staticDir || resolve('dist');
  if (existsSync(dist)) { app.use(express.static(dist)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html'))); }
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = e instanceof AppError ? e : e instanceof ZodError ? new AppError(400, 'INVALID_INPUT', e.issues[0]?.message || '输入无效') : new AppError(500, 'INTERNAL_ERROR', '操作失败，请重试');
    if (!res.headersSent) res.status(error.status).json({ error: { code: error.code, message: error.message } });
  });
  return { app, active };
}
