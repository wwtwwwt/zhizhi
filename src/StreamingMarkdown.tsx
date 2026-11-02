import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { splitMarkdown } from '../shared/markdown';
import type { RenderMeta } from '../shared/types';
import { Markdown } from './Markdown';

const StableBlock = memo(({ source, marker, quote, depth = 0 }: { source: string } & RenderMeta) =>
  <div className={`stream-block content-block ${quote ? 'quoted' : ''} ${marker ? 'list-block' : ''}`} style={{ marginLeft: depth * 20 }}>
    {marker && <span className="list-marker" aria-hidden="true">{marker}</span>}
    <div className="markdown"><Markdown source={source} streaming/></div>
  </div>
);
export function StreamingMarkdown({ source }: { source: string }) {
  const [visible, setVisible] = useState(source);
  const latest = useRef(source); latest.current = source;
  useEffect(() => {
    const timer = setInterval(() => setVisible(latest.current), 45);
    return () => clearInterval(timer);
  }, []);
  // Match persisted block boundaries and layout, including list markers and
  // nested indentation, instead of switching from native lists on completion.
  const blocks = useMemo(() => splitMarkdown(visible), [visible]);
  return <div className="streaming-draft streaming-markdown" aria-busy="true">{blocks.map((block, i) => <StableBlock key={i} source={block.markdown} {...block.meta}/>)}</div>;
}
