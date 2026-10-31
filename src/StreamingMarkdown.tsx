import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { parseTree } from '../shared/markdown';
import { Markdown } from './Markdown';

const StableBlock = memo(({ source }: { source: string }) => <div className="stream-block"><Markdown source={source} streaming/></div>);
export function StreamingMarkdown({ source }: { source: string }) {
  const [visible, setVisible] = useState(source);
  const latest = useRef(source); latest.current = source;
  useEffect(() => {
    const timer = setInterval(() => setVisible(latest.current), 45);
    return () => clearInterval(timer);
  }, []);
  const blocks = useMemo(() => {
    const tree = parseTree(visible);
    return (tree.children || []).map(n => ({ start: n.position?.start.offset || 0, end: n.position?.end.offset || visible.length }));
  }, [visible]);
  return <div className="streaming-draft markdown streaming-markdown" aria-busy="true">{blocks.map((block, i) => <StableBlock key={block.start} source={visible.slice(block.start, i === blocks.length - 1 ? undefined : block.end)}/>)}</div>;
}
