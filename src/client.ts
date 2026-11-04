import { useSyncExternalStore } from 'react';
import { restoreQuestion, type RestoredQuestion } from './composer-drafts';
import { readSSE } from '../shared/sse';
import type { ModelConfig } from '../shared/models';
import type { GenerationResult, Session, Settings, Stream } from '../shared/types';

type Job = { id: string; streamId: string; messageId?: string; nodeId?: string; kind: 'reply' | 'rewrite'; stopping?: boolean; text: string; reasoning: string; reasoningStartedAt?: number; reasoningEndedAt?: number };
type State = { models: ModelConfig[]; sessions: Session[]; streams: Record<string, Stream>; settings: Settings | null; jobs: Record<string, Job>; toast: string; toastAction?: { label: string; run: () => Promise<void> } };
let state: State = { models: [], sessions: [], streams: {}, settings: null, jobs: {}, toast: '' };
const deletedStreams = new Set<string>();
const listeners = new Set<() => void>();
export function patch(update: Partial<State>) { state = { ...state, ...update }; listeners.forEach(fn => fn()); }
export function useAppState() { return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state); }
let toastTimer: ReturnType<typeof setTimeout>;
export function notify(message: string, toastAction?: State['toastAction']) { patch({ toast: message, toastAction }); clearTimeout(toastTimer); toastTimer = setTimeout(() => patch({ toast: '', toastAction: undefined }), toastAction ? 15000 : 4500); }
export async function reeditQuestion(messageId: string, streamId: string) {
  const result = await api<RestoredQuestion & { streamIds: string[] }>(`/messages/${messageId}/reedit`, 'POST');
  restoreQuestion(streamId, result); forgetStreams(result.streamIds);
  await loadStream(streamId); await refreshSessions();
}
export async function api<T = { ok: boolean }>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '操作失败，请重试');
  return data as T;
}
export async function refreshSessions() { const sessions = await api<Session[]>('/sessions'); patch({ sessions }); return sessions; }
export async function loadStream(id: string) { const stream = await api<Stream>(`/streams/${id}`); if (deletedStreams.has(id)) throw new Error('分支已删除'); patch({ streams: { ...state.streams, [id]: stream } }); return stream; }
export async function loadSettings() { const settings = await api<Settings>('/settings'); patch({ settings }); return settings; }
export async function loadModels() { const models = await api<ModelConfig[]>('/models'); patch({ models }); return models; }
export async function runGeneration(result: GenerationResult, kind: 'reply' | 'rewrite', nodeId?: string) {
  const gid = result.generationId;
  if (Object.hasOwn(state.jobs, gid)) return;
  patch({ jobs: { ...state.jobs, [gid]: { id: gid, streamId: result.streamId, messageId: result.messageId, nodeId, kind, text: '', reasoning: '' } } });
  let failure = '';
  let questionId: string | undefined = result.questionMessageId;
  try {
    const initial = await loadStream(result.streamId);
    const index = initial.messages.findIndex(m => m.id === result.messageId);
    if (index > 0 && initial.messages[index - 1].role === 'user') questionId = initial.messages[index - 1].id;
    const response = await fetch(`/api/generations/${gid}/events`);
    if (!response.ok || !response.body) throw new Error('无法开始生成，请刷新页面检查任务状态');
    let complete = false;
    for await (const event of readSSE(response.body)) {
      const data = JSON.parse(event.data);
      if (event.event === 'delta') { const job = state.jobs[gid]; if (job) patch({ jobs: { ...state.jobs, [gid]: { ...job, text: job.text + data.text, reasoningEndedAt: job.reasoningStartedAt ? job.reasoningEndedAt ?? Date.now() : undefined } } }); }
      if (event.event === 'reasoning') { const job = state.jobs[gid]; if (job) patch({ jobs: { ...state.jobs, [gid]: { ...job, reasoning: job.reasoning + data.text, reasoningStartedAt: job.reasoningStartedAt ?? Date.now(), reasoningEndedAt: undefined } } }); }
      if (event.event === 'complete') complete = true;
      if (event.event === 'error') { if (data.code === 'BRANCH_DELETED') deletedStreams.add(result.streamId); throw new Error(data.message); }
    }
    if (!complete) throw new Error('连接中断，可以重新生成');
  } catch (e) {
    // Also release a queued generation if the event connection could not open.
    if (!deletedStreams.has(result.streamId)) await api(`/generations/${gid}/cancel`, 'POST').catch(() => {});
    if (!deletedStreams.has(result.streamId)) failure = state.jobs[gid]?.stopping ? '生成已停止' : e instanceof Error ? e.message : '生成失败';
  }
  finally {
    // Publish persisted content and retire its streaming draft in one store
    // update. Session/parent refreshes may be slow and must not prolong drafts.
    const loaded = deletedStreams.has(result.streamId) ? undefined : await api<Stream>(`/streams/${result.streamId}`).catch(() => undefined);
    const stream = deletedStreams.has(result.streamId) ? undefined : loaded;
    const jobs = { ...state.jobs }; delete jobs[gid];
    patch({ jobs, ...(stream ? { streams: { ...state.streams, [result.streamId]: stream } } : {}) });
    if (failure) {
      const target = stream?.messages.some(m => m.id === result.messageId) ? result.messageId : questionId;
      const last = stream?.messages.at(-1);
      notify(failure, kind === 'reply' && target && last?.id === target && questionId ? { label: '重新编辑', run: async () => { await reeditQuestion(target, result.streamId); notify('原问题已恢复到输入框'); } } : undefined);
    }
    if (stream?.source?.parent_stream_id) await loadStream(stream.source.parent_stream_id).catch(() => {});
    await refreshSessions().catch(() => {});
  }
}
export async function cancelJob(id: string) {
  const job = state.jobs[id]; if (job) patch({ jobs: { ...state.jobs, [id]: { ...job, stopping: true } } });
  await api(`/generations/${id}/cancel`, 'POST');
}

export async function deleteBranch(branchId: string) {
  const result = await api<{streamIds:string[];parentStreamId:string}>(`/branches/${branchId}`,'DELETE');
  forgetStreams(result.streamIds);
  await loadStream(result.parentStreamId); await refreshSessions();
}

export function forgetStreams(streamIds: string[]) {
  streamIds.forEach(id => deletedStreams.add(id));
  const streams = { ...state.streams }, jobs = { ...state.jobs };
  streamIds.forEach(id => delete streams[id]);
  for (const [id,job] of Object.entries(jobs)) if (deletedStreams.has(job.streamId)) delete jobs[id];
  patch({streams,jobs});
}
