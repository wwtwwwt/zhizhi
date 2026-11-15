import { z } from 'zod';
import { tool } from 'ai';
import { isIP } from 'node:net';
import { renderPrompt } from './prompts';
import type { SearchProgress, SearchSource } from '../shared/search';

export function publicWebUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !isIP(host)) throw new Error('只允许读取公开网页');
  if (isIP(host)) {
    const bytes = host.split('.').map(Number);
    if (host.includes(':') || bytes[0] === 0 || bytes[0] === 10 || bytes[0] === 127 || bytes[0] >= 224 || bytes[0] === 169 && bytes[1] === 254 || bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127) throw new Error('只允许读取公开网页');
  }
  url.hash = ''; return url.href;
}

export function createSearchTools(options: { key: string; signal: AbortSignal; onProgress: (value: SearchProgress) => void; endpoint?: string; fetch?: typeof fetch }) {
  const progress: SearchProgress = { activities: [], sources: [] };
  const pages = new Map<string, { title: string; content: string }>();
  let calls = 0;
  const publish = () => options.onProgress(structuredClone(progress));
  const source = (url: string, title: string): SearchSource => {
    const known = progress.sources.find(item => item.url === url);
    if (known) return known;
    const item = { id: progress.sources.length + 1, url, title: (title || url).slice(0, 500) };
    progress.sources.push(item); return item;
  };
  const request = async (path: string, body: unknown) => {
    const response = await (options.fetch || fetch)(`${options.endpoint || 'https://api.deepseek.com/v1/tools'}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}${response.status === 402 ? '，请检查余额' : response.status === 401 ? '，请检查密钥' : ''}`);
    // Bound actual response bytes, not only Content-Length.
    const reader = response.body?.getReader(); if (!reader) throw new Error('搜索服务没有返回内容');
    let length = 0; const parts: Uint8Array[] = [];
    try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 4 * 1024 * 1024) throw new Error('网页结果过大，请缩小查询范围'); parts.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('搜索服务返回了无效JSON'); }
  };
  const execute = async (name: string, input: string, fn: () => Promise<unknown>) => {
    options.signal.throwIfAborted();
    if (++calls > 12) throw new Error('本轮已达到12次工具调用上限');
    const activity = { id: calls, tool: name, input, status: 'running' as 'running' | 'complete' | 'error' };
    progress.activities.push(activity); publish();
    try { const result = await fn(); activity.status = 'complete'; Object.assign(activity, { resultCount: name === '搜索网页' ? (result as { results: unknown[] }).results.length : 1 }); publish(); return result; }
    catch (error) {
      options.signal.throwIfAborted();
      activity.status = 'error'; const message = error instanceof Error ? error.message : '查询失败';
      Object.assign(activity, { message }); publish(); return { error: message };
    }
  };
  return {
    tools: {
      web_search: tool({ description: renderPrompt('webSearchTool'), inputSchema: z.object({ query: z.string().trim().min(1).max(128) }), execute: async ({ query }) => execute('搜索网页', query, async () => {
        const data = await request('search', { query, count: 5, need_content: false });
        if (!Array.isArray(data.results)) throw new Error('搜索服务返回格式无效');
        return { results: data.results.slice(0, 5).flatMap((result: any) => {
          try { const url = publicWebUrl(result.url); const item = source(url, typeof result.title === 'string' ? result.title : url); return [{ ...item, date: typeof result.date === 'string' ? result.date.slice(0, 64) : null, summary: String(result.summary || result.snippet || '').slice(0, 2400) }]; } catch { return []; }
        }), untrusted: true };
      }) }),
      web_read: tool({ description: renderPrompt('webReadTool'), inputSchema: z.object({ url: z.string().max(8192), offset: z.number().int().min(0).default(0) }), execute: async ({ url, offset }) => execute('读取网页', url, async () => {
        const address = publicWebUrl(url);
        let page = pages.get(address);
        if (!page) {
          const data = await request('fetch', { url: address });
          if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('网页没有可读取的正文');
          page = { title: String(data.title || address), content: data.content }; pages.set(address, page);
        }
        const end = Math.min(offset + 10000, page.content.length);
        return { ...source(address, page.title), content: page.content.slice(offset, end), offset, nextOffset: end < page.content.length ? end : null, totalCharacters: page.content.length, untrusted: true };
      }) }),
    },
    getSources: () => progress.sources,
  };
}
