import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store';
import { layoutConversationMap, mapBranchPath } from '../shared/conversation-map';
import type { GenerationResult } from '../shared/types';

let directory: string, store: Store;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'zhizhi-map-')); store = new Store(directory); });
afterEach(() => { store.db.close(); rmSync(directory, { recursive: true, force: true }); });
function finish(generation: GenerationResult, text: string) {
  store.run("UPDATE generations SET status='streaming' WHERE id=?", generation.generationId);
  store.finish(generation.generationId, text);
}

test('map includes reachable current-version messages, notes and deep branches with valid navigation paths', () => {
  const session = store.createSession();
  const root = store.appendQuestion(session.root_stream_id, '主问题', randomUUID()); finish(root, '甲乙丙丁');
  const source = store.stream(root.streamId).messages[1].slots[0].node;
  const branch = store.createBranch(source.id, 0, 2, '甲乙', '分支问题', randomUUID()); finish(branch, '子分支来源');
  const branchSource = store.stream(branch.streamId).messages[1].slots[0].node;
  const note = store.createBranch(branchSource.id, 0, 2, '子分', '我的笔记', randomUUID(), 'note');
  const sibling = store.createBranch(source.id, 2, 4, '丙丁', '另一个分支', randomUUID()); finish(sibling, '兄弟回答');
  const data = store.conversationMap(session.id);
  expect(data.messages).toHaveLength(7);
  expect(data.messages.find(message => message.streamId === note.streamId)?.kind).toBe('note');
  expect(mapBranchPath(data, note.streamId).map(branch => branch.anchor.stream_id)).toEqual([branch.streamId, note.streamId]);
  const layout = layoutConversationMap(data), points = new Map(layout.nodes.map(node => [node.id, node]));
  expect(new Set(layout.nodes.map(node => `${node.x},${node.y}`)).size).toBe(7);
  expect(layout.nodes.filter(node => node.streamId === root.streamId).every(node => node.x === 24)).toBe(true);
  for (const node of layout.nodes) {
    if (!node.parentId) continue;
    const parent = points.get(node.parentId)!;
    expect(node.y).toBeGreaterThan(parent.y);
    expect(node.streamId === parent.streamId ? node.x === parent.x : node.x > parent.x).toBe(true);
  }
  store.changeBlock(source.slot_id, source.id, '新的版本');
  expect(store.conversationMap(session.id).messages).toHaveLength(2);
  const active = store.need('block_slots', source.slot_id).active_node_id;
  store.switchVersion(source.slot_id, source.id, active);
  expect(store.conversationMap(session.id).messages).toHaveLength(7);
  store.deleteBranch(branch.branch!.id);
  expect(store.conversationMap(session.id).messages).toHaveLength(4);
});

test('map uses edited visible content and rejects unreachable navigation paths', () => {
  const session = store.createSession();
  const generation = store.appendQuestion(session.root_stream_id, '问题', randomUUID()); finish(generation, '旧的回答');
  const slot = store.stream(generation.streamId).messages[1].slots[0];
  store.changeBlock(slot.id, slot.node.id, '更新后的内容\n\n新的独立块');
  const data = store.conversationMap(session.id);
  expect(data.messages[1].preview).toContain('更新后的内容');
  expect(data.messages[1].preview).toContain('新的独立块');
  expect(data.messages[1].preview).not.toContain('旧的回答');
  expect(mapBranchPath(data, session.root_stream_id)).toEqual([]);
  expect(() => mapBranchPath(data, 'missing')).toThrow('分支已发生变化');
});

test('map search checks full current text and includes a branch quote only on its first message', () => {
  const session = store.createSession();
  const root = store.appendQuestion(session.root_stream_id, '问题', randomUUID());
  finish(root, `唯一来源${'普通内容'.repeat(400)}DeepNeedle终点`);
  const source = store.stream(root.streamId).messages[1].slots[0].node;
  const branch = store.createBranch(source.id, 0, 4, '唯一来源', '分支问题', randomUUID()); finish(branch, '普通回复');
  expect(store.conversationMap(session.id).messages[1].preview).not.toContain('DeepNeedle');
  const tail = store.searchConversationMap(session.id, 'deepneedle');
  expect(tail.map(hit => hit.messageId)).toEqual([root.messageId]);
  expect(tail[0].excerpt).toContain('DeepNeedle终点');
  expect(tail[0]).toMatchObject({ slotId: source.slot_id, nodeId: source.id });
  expect(store.searchConversationMap(session.id, '唯一来源')[1]).toMatchObject({ messageId: branch.questionMessageId, quote: true });
  expect(store.searchConversationMap(session.id, '唯一来源').map(hit => hit.messageId)).toEqual([root.messageId, branch.questionMessageId]);
  expect(store.searchConversationMap(session.id, '   ')).toEqual([]);
  store.changeBlock(source.slot_id, source.id, '替换后的正文');
  expect(store.searchConversationMap(session.id, 'deepneedle')).toEqual([]);
  expect(store.searchConversationMap(session.id, '分支问题')).toEqual([]);
});
