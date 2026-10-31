import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID as uuid } from 'node:crypto';
import { Store } from '../server/store';
import type { GenerationResult } from '../shared/types';
let dir: string, s: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'learnhelper-test-')); s = new Store(dir); });
afterEach(() => { s.db.close(); rmSync(dir, { recursive: true, force: true }); });
function finish(g: GenerationResult, text: string) { s.run("UPDATE generations SET status='streaming' WHERE id=?", g.generationId); return s.finish(g.generationId, text); }
function root(text = '先解释 **梯度下降**，然后更新参数。\n\n后面的独立内容。') {
  const session = s.createSession(); const g = s.appendQuestion(session.root_stream_id, '我的问题', uuid()); finish(g, text);
  return { stream: session.root_stream_id, node: s.stream(session.root_stream_id).messages[1].slots[0].node };
}
test('overlap rejected, adjacent accepted, request replay atomic, grapheme boundaries enforced', () => {
  const { node } = root('甲乙丙丁👩‍💻结束'); const rid = uuid();
  const a = s.createBranch(node.id, 0, 2, '甲乙', '解释', rid); finish(a, '已解释');
  expect(s.createBranch(node.id, 0, 2, '甲乙', '解释', rid).streamId).toBe(a.streamId);
  expect(() => s.createBranch(node.id, 1, 3, '乙丙', '解释', uuid())).toThrow('已有分支');
  const b = s.createBranch(node.id, 2, 4, '丙丁', '解释', uuid()); finish(b, '相邻');
  expect(() => s.createBranch(node.id, 4, 6, '👩', '解释', uuid())).toThrow('重新选择');
  expect(s.all('SELECT * FROM branches')).toHaveLength(2);
});
test('frozen ancestor prefix excludes later blocks and siblings; includes each quote', () => {
  const { stream, node } = root(); const start = node.selection_text.indexOf('梯度');
  const a = s.createBranch(node.id, start, start + 4, '梯度下降', 'A问题', uuid()); finish(a, 'A回答');
  const b = s.createBranch(node.id, 0, 2, '先解', '兄弟秘密', uuid()); finish(b, '兄弟回答');
  const childNode = s.stream(a.streamId).messages[1].slots[0].node;
  const c = s.createBranch(childNode.id, 0, 2, 'A回', 'C问题', uuid()); finish(c, 'C回答');
  const text = JSON.stringify(s.context(c.streamId));
  expect(text).toContain('我的问题'); expect(text).toContain('梯度下降'); expect(text).toContain('A回');
  expect(text).not.toContain('后面的独立内容'); expect(text).not.toContain('兄弟秘密');
  const frozen = JSON.stringify(s.context(a.streamId));
  const rewrite = s.rewrite(node.id, uuid()); const proposal = finish(rewrite, '重新解释梯度。');
  const slot = s.need('block_slots', node.slot_id); s.decideProposal(proposal.proposalId, true, node.id);
  expect(JSON.stringify(s.context(a.streamId))).toBe(frozen);
  expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(0);
  s.switchVersion(slot.id, node.id, proposal.candidateNodeId);
  expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(2);
});
test('rewrite reads descendants, rejects safely and isolates independent version branches', () => {
  const { stream, node } = root('原版文本与背景');
  const a = s.createBranch(node.id, 0, 2, '原版', 'A疑问', uuid()); finish(a, 'A解答');
  const child = s.stream(a.streamId).messages[1].slots[0].node;
  const c = s.createBranch(child.id, 0, 2, 'A解', '深层问题', uuid()); finish(c, '深层回答');
  const rw = s.rewrite(node.id, uuid()); expect(s.need('generations', rw.generationId).context_json).toContain('深层问题');
  const p = finish(rw, '新版解释。'); s.decideProposal(p.proposalId, false);
  expect(s.need('block_slots', node.slot_id).active_node_id).toBe(node.id);
  const p2 = finish(s.rewrite(node.id, uuid()), '新版解释。'); s.decideProposal(p2.proposalId, true, node.id);
  expect(() => s.switchVersion(node.slot_id, node.id, node.id)).toThrow('版本已变化');
  const b = s.createBranch(p2.candidateNodeId, 0, 2, '新版', 'B独有', uuid()); finish(b, 'B答复');
  s.switchVersion(node.slot_id, node.id, p2.candidateNodeId);
  expect(s.stream(stream).messages[1].slots[0].anchors.map(x => x.stream_id)).toEqual([a.streamId]);
  expect(s.need('generations', s.rewrite(node.id, uuid()).generationId).context_json).not.toContain('B独有');
});
test('reopen recovers pending tasks, durable complete branches, secrets never returned', () => {
  const { stream, node } = root(); const b = s.createBranch(node.id, 0, 2, '先解', '解释', uuid());
  s.models.setKey('fake', 'test-secret');
  expect(JSON.stringify(s.settings())).not.toContain('test-secret');
  s.db.close(); s = new Store(dir);
  expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(1);
  expect(s.stream(b.streamId).messages[1].status).toBe('interrupted');
  expect(s.retry(b.messageId!, uuid()).streamId).toBe(b.streamId);
});

test('manual edit preserves frozen context; deleting a block removes its branches', () => {
  const { stream, node } = root('保留原始内容。\n\n第二段。');
  const branch = s.createBranch(node.id, 0, 2, '保留', '解释原文', uuid()); finish(branch, '解释完毕');
  const frozen = JSON.stringify(s.context(branch.streamId));
  s.changeBlock(node.slot_id, node.id, '手动修改后的新内容。');
  const edited = s.stream(stream).messages[1].slots[0];
  expect(edited.node.id).not.toBe(node.id); expect(edited.versions).toHaveLength(2); expect(edited.anchors).toHaveLength(0);
  expect(() => s.changeBlock(node.slot_id, node.id, '过期编辑')).toThrow('内容已变化');
  expect(s.need('content_nodes', node.id).markdown).toBe('保留原始内容。');
  s.switchVersion(node.slot_id, node.id, edited.node.id); expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(1);
  s.changeBlock(node.slot_id, node.id);
  expect(s.stream(stream).messages[1].slots).toHaveLength(1);
  expect(()=>s.context(branch.streamId)).toThrow('不存在');
  expect(JSON.stringify(s.context(stream))).not.toContain('保留原始内容');
  expect(() => s.createBranch(node.id, 2, 4, '原始', '不可创建', uuid())).toThrow('不存在');
  s.db.close(); s = new Store(dir); expect(s.stream(stream).messages[1].slots).toHaveLength(1);
  expect(()=>s.context(branch.streamId)).toThrow('不存在');
});

test('branch preview reads current visible versions, persists and remains isolated by source version', () => {
  const { stream, node } = root('原始块的内容。');
  const b = s.createBranch(node.id, 0, 2, '原始', '用户的问题', uuid()); finish(b, '**原来的回答**。');
  const preview = () => s.stream(stream).messages[1].slots[0].anchors[0].preview;
  expect(preview()).toEqual({ question: '用户的问题', answer: '原来的回答。', status: 'complete' });
  const answer = s.stream(b.streamId).messages[1].slots[0];
  s.changeBlock(answer.id, answer.node.id, '修改后的回答。');
  expect(preview()?.answer).toBe('修改后的回答。');
  expect(s.stream(b.streamId).source?.parent_stream_id).toBe(stream);
  s.db.close(); s = new Store(dir); expect(preview()?.answer).toBe('修改后的回答。');
  s.changeBlock(answer.id, s.need('block_slots', answer.id).active_node_id); expect(preview()?.answer).toBe('');
  s.changeBlock(node.slot_id, node.id, '新的源版本。');
  expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(0);
});

test('formula branches accept full source, reject partial ranges, and settings preserve direction', () => {
  const { stream } = root('前 $x^2$ 后\n\n$$\n\\theta_{t+1} = \\theta_t - \\eta\n$$');
  const slots = s.stream(stream).messages[1].slots;
  expect(() => s.createBranch(slots[0].node.id, 2, 3, 'x', '部分公式', uuid())).toThrow('公式未完整选择');
  const formula = slots[1].node;
  const b = s.createBranch(formula.id, 0, formula.selection_text.length, formula.selection_text, '解释这个公式', uuid());
  finish(b, '解释公式'); expect(JSON.stringify(s.context(b.streamId))).toContain('theta');
  s.saveSettings({ ...s.settings(), stackDirection: 'left' });
  s.db.close(); s = new Store(dir); expect(s.settings().stackDirection).toBe('left');
});

test('notes persist without generation or credentials, then can continue as LLM conversations', () => {
  const { stream, node } = root('笔记来源。'); const rid = uuid();
  const note = s.createBranch(node.id, 0, 2, '笔记', '**我的理解**。\n\n再记一段。', rid, 'note');
  expect(s.createBranch(node.id, 0, 2, '笔记', '**我的理解**。\n\n再记一段。', rid, 'note').streamId).toBe(note.streamId);
  expect(s.stream(note.streamId).messages).toHaveLength(1);
  expect(s.all('SELECT * FROM generations WHERE stream_id=?', note.streamId)).toHaveLength(0);
  expect(s.stream(note.streamId).messages[0].slots).toHaveLength(2);
  expect(s.stream(stream).messages[1].slots[0].anchors[0].kind).toBe('note');
  expect(s.stream(stream).messages[1].slots[0].anchors[0].preview?.question).toContain('我的理解');
  s.db.close(); s = new Store(dir);
  expect(s.stream(note.streamId).source?.kind).toBe('note');
  const q = s.appendQuestion(note.streamId, '帮我验证笔记', uuid());
  expect(s.need('generations', q.generationId).context_json).toContain('我的理解'); finish(q, '验证结果');
  expect(s.stream(note.streamId).messages).toHaveLength(3);
});

test('editing creates independent extra blocks whose versions, branches and visibility survive original changes', () => {
  const { stream, node } = root('- 旧列表项\n- 后续列表项');
  const old = s.stream(stream).messages[1].slots;
  const branch = s.createBranch(node.id, 0, 1, '旧', '旧分支', uuid()); finish(branch, '旧回答');
  const frozen = JSON.stringify(s.context(branch.streamId));
  s.changeBlock(node.slot_id, node.id, '- 新列表一\n- 新列表二\n\n独立段落');
  const edited = s.stream(stream).messages[1].slots;
  expect(edited.map(s => s.node.markdown)).toEqual(['新列表一','新列表二','独立段落','后续列表项']);
  expect(edited.slice(0, 2).map(s => s.meta.marker)).toEqual(['•','•']);
  const child = edited[1]; s.changeBlock(child.id, child.node.id, '嵌套改动\n\n额外一段');
  const childBranch = s.createBranch(child.node.id === s.need('block_slots', child.id).active_node_id ? child.node.id : s.need('block_slots', child.id).active_node_id, 0, 2, '嵌套', '分支', uuid()); finish(childBranch, '回答');
  s.switchVersion(node.slot_id, node.id, edited[0].node.id);
  expect(s.stream(stream).messages[1].slots.map(s => s.node.markdown)).toEqual(['旧列表项','嵌套改动','额外一段','独立段落','后续列表项']);
  expect(JSON.stringify(s.context(stream))).toContain('独立段落');
  expect(s.stream(stream).messages[1].slots[1].anchors[0].stream_id).toBe(childBranch.streamId);
  const currentChild = s.need('block_slots', child.id).active_node_id;
  s.switchVersion(child.id, child.node.id, currentChild);
  expect(s.stream(stream).messages[1].slots[2].node.markdown).toBe('额外一段');
  s.switchVersion(child.id, currentChild, child.node.id);
  expect(JSON.stringify(s.context(branch.streamId))).toBe(frozen);
  s.switchVersion(node.slot_id, edited[0].node.id, node.id);
  expect(s.stream(stream).messages[1].slots.map(s => s.node.markdown)).toEqual(['新列表一','嵌套改动','额外一段','独立段落','后续列表项']);
  s.changeBlock(node.slot_id, edited[0].node.id);
  expect(s.stream(stream).messages[1].slots.map(s => s.node.markdown)).toEqual(['嵌套改动','额外一段','独立段落','后续列表项']);
  s.addBlock(old[1].id, old[1].node.id, '新增段落\n\n- 新增列表一\n- 新增列表二');
  s.db.close(); s = new Store(dir);
  expect(s.stream(stream).messages[1].slots.slice(-3).map(s => s.node.markdown)).toEqual(['新增段落','新增列表一','新增列表二']);
});

test('model registry preserves independent secrets, snapshots parameters and persists defaults', () => {
  const create = (name: string, key: string, images = true) => s.models.save({ provider: 'openai', name, model: 'stub', baseUrl: 'http://127.0.0.1:1234/v1', supportsImages: images, parameters: [{key:'context_length',value:16000,enabled:true},{key:'max_completion_tokens',value:2000,enabled:true},{key:'temperature',value:.4,enabled:false}], apiKey:key });
  const a = create('模型 A','secret-A'), b = create('模型 B','secret-B');
  expect(JSON.stringify(s.models.list())).not.toContain('secret-'); expect(s.models.key(a.id)).toBe('secret-A'); expect(s.models.key(b.id)).toBe('secret-B');
   const sess = s.createSession(); const q = s.appendQuestion(sess.root_stream_id,'问题',uuid(),{modelId:a.id});
  const snapshot = JSON.parse(s.need('generations',q.generationId).settings_json); expect(snapshot.modelConfig.name).toBe('模型 A'); expect(JSON.stringify(snapshot)).not.toContain('secret-A');
   expect(JSON.parse(s.need('generations',q.generationId).settings_json).modelConfig.id).toBe(a.id);
  s.models.save({...a,name:'修改A',apiKey:''}); expect(s.models.key(a.id)).toBe('secret-A');
  expect(()=>s.models.delete('fake')).toThrow('不可删除');
  s.models.delete(b.id); expect(s.models.get().id).toBe('fake');
  s.db.close();s=new Store(dir); expect(s.models.list().map(m=>m.id)).toEqual(['fake',a.id]);
  expect(s.models.key(a.id)).toBe('secret-A');
});

test('attachment references freeze through ancestor context, hydrate at request time, persist and delete with session', () => {
  const session = s.createSession();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
  const options = { modelId:'fake', attachments:[{name:'note.md',kind:'text' as const,mime:'text/plain',data:'附件里的独特背景'}, {name:'pixel.png',kind:'image' as const,mime:'image/png',data:png}] };
  const rid=uuid(), q=s.appendQuestion(session.root_stream_id,'看附件',rid,options);finish(q,'原文内容');
  expect(s.appendQuestion(session.root_stream_id,'看附件',rid,options).generationId).toBe(q.generationId);
  const message=s.stream(session.root_stream_id).messages[0];expect(message.attachments).toHaveLength(2);
  const context=s.context(session.root_stream_id); expect(JSON.stringify(context)).toContain('附件里的独特背景');expect(JSON.stringify(context)).not.toContain(png);
  expect(JSON.stringify(s.hydrate(context))).toContain(`data:image/png;base64,${png}`);
  const source=s.stream(session.root_stream_id).messages[1].slots[0].node;
  const child=s.createBranch(source.id,0,2,'原文','继续解释',uuid());finish(child,'解释');
  expect(JSON.stringify(s.context(child.streamId))).toContain('附件里的独特背景');
  const noImage=s.models.save({provider:'openai',name:'文本模型',baseUrl:'http://localhost/v1',model:'text',supportsImages:false,parameters:[{key:'context_length',value:32000,enabled:true}],apiKey:'stub'});
  expect(()=>s.appendQuestion(child.streamId,'新问题',uuid(),{modelId:noImage.id})).toThrow('上下文包含图片');
  expect(s.stream(child.streamId).messages).toHaveLength(2);
  expect(()=>s.appendQuestion(session.root_stream_id,'坏文件',uuid(),{attachments:[{name:'bad.png',kind:'image',mime:'image/png',data:'YmluYXJ5'}]})).toThrow('JPG 和 PNG');
  s.db.close();s=new Store(dir);expect(s.stream(session.root_stream_id).messages[0].attachments).toHaveLength(2);
  s.tx(()=>s.run('DELETE FROM sessions WHERE id=?',session.id));expect(s.all('SELECT * FROM attachments')).toHaveLength(0);
});

test('creating a note with initial content saves atomically without model configuration or generation', () => {
  const {stream,node}=root();
  const count=s.all('SELECT id FROM generations').length, requestId=uuid();
  const note=s.createBranch(node.id,0,2,node.selection_text.slice(0,2),'第一段笔记\n\n第二段',requestId,'note');
  expect(s.stream(note.streamId).messages[0].slots).toHaveLength(2);
  expect(s.all('SELECT id FROM generations')).toHaveLength(count);
  expect(s.createBranch(node.id,0,2,node.selection_text.slice(0,2),'第一段笔记\n\n第二段',requestId,'note').streamId).toBe(note.streamId);
  expect(()=>s.createBranch(node.id,0,2,node.selection_text.slice(0,2),'不同内容',requestId,'note')).toThrow('请求标识');
  expect(s.stream(stream).messages[1].slots[0].anchors[0].preview?.question).toContain('第一段笔记');
});

test('branch deletion recursively removes historical and deleted-slot descendants, resources and versions while preserving parent and sibling', () => {
  const {stream,node}=root('甲乙丙丁');
  const target=s.createBranch(node.id,0,1,'甲','目标笔记\n\n待隐藏块',uuid(),'note');
  const sibling=s.createBranch(node.id,1,2,'乙','兄弟笔记',uuid(),'note');
  const slots=s.stream(target.streamId).messages[0].slots;
  const oldChild=s.createBranch(slots[0].node.id,0,2,'目标','旧版子分支',uuid(),'note');
  const leaf=s.stream(oldChild.streamId).messages[0].slots[0].node;
  const deep=s.createBranch(leaf.id,0,2,'旧版','更深笔记',uuid(),'note');
  const hiddenChild=s.createBranch(slots[1].node.id,0,2,'待隐','隐藏子分支',uuid(),'note');
  s.changeBlock(slots[0].id,slots[0].node.id,'新版正文\n\n独立拆分块');
  s.changeBlock(slots[1].id,slots[1].node.id);
  const pending=s.appendQuestion(deep.streamId,'仍在排队',uuid(),{attachments:[{name:'a.txt',kind:'text',mime:'text/plain',data:'子分支附件'}]});
  const mid=s.stream(target.streamId).messages[0].id;
  s.run('INSERT INTO document_resources VALUES(?,?,?,?,?)',uuid(),mid,'a.png','image/png',Buffer.from('resource'));
  const tree=s.branchTree(target.branch!.id);expect(new Set(tree)).toEqual(new Set([target.streamId,oldChild.streamId,deep.streamId]));
  const siblingContext=JSON.stringify(s.context(sibling.streamId));
  expect(()=>s.deleteBranch('missing')).toThrow('不存在');
  const result=s.deleteBranch(target.branch!.id);expect(result.parentStreamId).toBe(stream);
  for(const id of tree)expect(s.one('SELECT id FROM streams WHERE id=?',id)).toBeUndefined();
  expect(s.one('SELECT id FROM generations WHERE id=?',pending.generationId)).toBeUndefined();
  expect(s.all('SELECT * FROM attachments')).toHaveLength(0);expect(s.all('SELECT * FROM document_resources')).toHaveLength(0);
  expect(s.stream(stream).messages[1].slots[0].node.id).toBe(node.id);
  expect(s.stream(stream).messages[1].slots[0].anchors.map(a=>a.id)).toEqual([sibling.branch!.id]);
  expect(JSON.stringify(s.context(sibling.streamId))).toBe(siblingContext);
  expect(s.all('PRAGMA foreign_key_check')).toHaveLength(0);
  s.db.close();s=new Store(dir);expect(s.stream(stream).messages[1].slots[0].anchors).toHaveLength(1);
  expect(s.createBranch(node.id,0,1,'甲','重新使用选区',uuid(),'note').branch!.id).toBeTruthy();
});


test('block deletion clears all version branches and unused resources but preserves sibling frozen ancestors', () => {
  const {stream,node}=root('原始内容\n\n兄弟内容');
  const rootMessage=s.stream(stream).messages[1], siblingSlot=rootMessage.slots[1];
  const own=s.createBranch(node.id,0,2,'原始','旧版笔记',uuid(),'note');
  const ownNode=s.stream(own.streamId).messages[0].slots[0].node;
  const nested=s.createBranch(ownNode.id,0,2,'旧版','后代笔记',uuid(),'note');
  const queued=s.appendQuestion(nested.streamId,'等待回答',uuid(),{attachments:[{name:'data.txt',kind:'text',mime:'text/plain',data:'data'}]});
  const sibling=s.createBranch(siblingSlot.node.id,0,2,'兄弟','保留的分支',uuid(),'note');
  const frozen=JSON.stringify(s.context(sibling.streamId));
  s.changeBlock(node.slot_id,node.id,'新版内容');
  const edited=s.need('block_slots',node.slot_id).active_node_id;
  const current=s.createBranch(edited,0,2,'新版','新版分支',uuid(),'note');
  const result=s.changeBlock(node.slot_id,edited);
  expect(new Set(result.streamIds)).toEqual(new Set([own.streamId,nested.streamId,current.streamId]));
  expect(s.one('SELECT id FROM generations WHERE id=?',queued.generationId)).toBeUndefined();
  expect(s.all('SELECT * FROM attachments')).toHaveLength(0);
  expect(s.one('SELECT id FROM content_nodes WHERE id=?',edited)).toBeUndefined();
  expect(s.need('content_nodes',node.id)).toBeTruthy();
  expect(JSON.stringify(s.context(sibling.streamId))).toBe(frozen);
  const imageId=uuid(), keepId=uuid();
  s.run('INSERT INTO document_resources VALUES(?,?,?,?,?)',imageId,rootMessage.id,'unused.png','image/png',Buffer.from('unused'));
  s.run('INSERT INTO document_resources VALUES(?,?,?,?,?)',keepId,rootMessage.id,'shared.png','image/png',Buffer.from('shared'));
  s.addBlock(siblingSlot.id,siblingSlot.node.id,`![image](/api/document-resources/${imageId})\n\n![shared](/api/document-resources/${keepId})`);
  const imageSlot=s.stream(stream).messages[1].slots[1];
  s.changeBlock(imageSlot.id,imageSlot.node.id);
  expect(s.one('SELECT id FROM document_resources WHERE id=?',imageId)).toBeUndefined();
  expect(s.one('SELECT id FROM document_resources WHERE id=?',keepId)).toBeTruthy();
  expect(s.all('PRAGMA foreign_key_check')).toHaveLength(0);
  s.db.close();s=new Store(dir);expect(JSON.stringify(s.context(sibling.streamId))).toBe(frozen);
});


test('delete current version selects its neighbor and removes only its branches while preserving frozen sibling context', () => {
  const {stream,node}=root('第一版本\n\n兄弟内容');
  const firstBranch=s.createBranch(node.id,0,2,'第一','首版分支',uuid(),'note');
  s.changeBlock(node.slot_id,node.id,'第二版本');
  const second=s.need('block_slots',node.slot_id).active_node_id;
  const secondBranch=s.createBranch(second,0,2,'第二','第二版分支',uuid(),'note');
  const childNode=s.stream(secondBranch.streamId).messages[0].slots[0].node;
  const child=s.createBranch(childNode.id,0,2,'第二','嵌套分支',uuid(),'note');
  const siblingSlot=s.stream(stream).messages[1].slots[1];
  const sibling=s.createBranch(siblingSlot.node.id,0,2,'兄弟','冻结第二版本',uuid(),'note');
  const frozen=JSON.stringify(s.context(sibling.streamId));
  s.changeBlock(node.slot_id,second,'第三版本');
  const third=s.need('block_slots',node.slot_id).active_node_id;
  s.switchVersion(node.slot_id,second,third);
  const removed=s.changeBlock(node.slot_id,second,undefined,'current');
  expect(new Set(removed.streamIds)).toEqual(new Set([secondBranch.streamId,child.streamId]));
  let slot=s.stream(stream).messages[1].slots[0];
  expect(slot.node.id).toBe(node.id);expect(slot.versions.map(n=>n.id)).toEqual([node.id,third]);
  expect(slot.anchors[0].stream_id).toBe(firstBranch.streamId);
  expect(s.need('content_nodes',second).status).toBe('deleted');
  expect(JSON.stringify(s.context(sibling.streamId))).toBe(frozen);
  expect(()=>s.switchVersion(node.slot_id,second,node.id)).toThrow('版本已变化');
  expect(()=>s.changeBlock(node.slot_id,second,undefined,'current')).toThrow('内容已变化');
  // First version falls forward; last remaining version removes the block.
  s.changeBlock(node.slot_id,node.id,undefined,'current');
  slot=s.stream(stream).messages[1].slots[0];expect(slot.node.id).toBe(third);expect(slot.versions).toHaveLength(1);
  s.changeBlock(node.slot_id,third,undefined,'current');
  expect(s.stream(stream).messages[1].slots).toHaveLength(1);
  expect(JSON.stringify(s.context(sibling.streamId))).toBe(frozen);
  expect(s.all('PRAGMA foreign_key_check')).toHaveLength(0);
  s.db.close();s=new Store(dir);expect(JSON.stringify(s.context(sibling.streamId))).toBe(frozen);
});


test('fresh schema has no historical tables; current preferences and data survive reopening', () => {
  expect(s.one("SELECT name FROM sqlite_master WHERE name='schema_migrations'")).toBeUndefined();
  expect(s.one("SELECT name FROM sqlite_master WHERE name='slot_owners'")).toBeUndefined();
  const {stream,node}=root('**注意：**LLM...');
  expect(node.selection_text).toBe('注意：LLM...');
  expect(()=>s.createBranch(node.id,0,3,'注意：','',uuid(),'note')).toThrow('笔记不能为空');
  expect(s.all('SELECT * FROM branches')).toHaveLength(0);
  s.saveSettings({...s.settings(),nickname:'纸船'});
  s.db.close();s=new Store(dir);
  expect(s.settings().nickname).toBe('纸船');
  expect(s.stream(stream).messages[1].slots[0].node.id).toBe(node.id);
  expect(()=>s.run('UPDATE content_nodes SET selection_text=? WHERE id=?','不能修改',node.id)).toThrow('IMMUTABLE_NODE');
  expect(s.all('PRAGMA foreign_key_check')).toHaveLength(0);
});
