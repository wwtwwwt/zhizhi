import type { SearchProgress } from '../shared/search';
export function SearchProgressPanel({ progress }: { progress: SearchProgress }) {
  const running = progress.activities.some(item => item.status === 'running');
  return <details className="search-progress-panel"><summary>{running ? '正在查找资料…' : '资料查询'} · {progress.activities.length} 次操作</summary><div>{progress.activities.map(item => <div key={item.id} className="search-activity"><span>{item.tool} · {item.status === 'running' ? '进行中' : item.status === 'error' ? '失败' : '完成'}</span><p>{item.input}</p>{item.message && <p role="status">{item.message}</p>}</div>)}{progress.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div></details>;
}
