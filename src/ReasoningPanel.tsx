import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';

export function ReasoningPanel({ text, simulated = false, startedAt, endedAt }: { text: string; simulated?: boolean; startedAt?: number; endedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  const running = startedAt !== undefined && endedAt === undefined;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  const seconds = startedAt === undefined ? null : Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
  return <details className="reasoning-panel"><summary>{simulated ? '模拟思考摘要' : '思考摘要'}{running ? ' · 生成中' : ''}{seconds !== null && <span className="reasoning-timer" aria-label="思考用时">{seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`}</span>}</summary><div className="markdown"><Markdown source={text}/></div></details>;
}
