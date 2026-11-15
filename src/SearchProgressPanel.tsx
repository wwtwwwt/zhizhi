import { BookOpen, Search, LoaderCircle } from 'lucide-react';
import type { SearchProgress } from '../shared/search';
export function SearchProgressPanel({ progress }: { progress: SearchProgress }) {
  const searches = progress.activities.filter(item => item.tool === '搜索网页');
  const reading = progress.activities.filter(item => item.tool === '读取网页');
  const searching = searches.some(item => item.status === 'running');
  const pendingReads = new Set(reading.filter(item => item.status === 'running').map(item => item.input)).size;
  const read = new Set(reading.filter(item => item.status === 'complete').map(item => item.input)).size;
  const count = searches.reduce((total, item) => total + (item.resultCount || 0), 0);
  const failed = progress.activities.filter(item => item.status === 'error');
  return <div className="search-progress-panel" role="status"><div className={`search-status ${searching || pendingReads ? 'has-running' : ''}`}>{searching || pendingReads ? <LoaderCircle size={13}/> : read ? <BookOpen size={13}/> : <Search size={13}/>}<span>{searching ? '正在检索资料…' : `已检索到 ${count} 篇资料`}{pendingReads ? ` · 正在精读 ${pendingReads} 篇资料` : read ? ` · 已精读 ${read} 篇资料` : ''}</span></div>{failed.length > 0 && <span>{failed.at(-1)?.message || '部分资料查询失败'}</span>}</div>;
}
