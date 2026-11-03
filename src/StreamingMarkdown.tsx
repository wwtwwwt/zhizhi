import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { splitMarkdown } from '../shared/markdown';
import type { RenderMeta } from '../shared/types';
import { Markdown } from './Markdown';

const StableBlock = memo(({ source, marker, quote, depth = 0, streaming = false }: { source: string; streaming?: boolean } & RenderMeta) =>
  <div className={`${streaming ? 'stream-block' : ''} content-block ${quote ? 'quoted' : ''} ${marker ? 'list-block' : ''}`} style={{ marginLeft: depth * 20 }}>
    {marker && <span className="list-marker" aria-hidden="true">{marker}</span>}
    <div className="markdown"><Markdown source={source} streaming={streaming}/></div>
  </div>
);
export function MarkdownBlocks({ source, streaming = false, firstMeta }: { source: string; streaming?: boolean; firstMeta?: RenderMeta }) {
  const blocks = useMemo(() => splitMarkdown(source), [source]);
  return <div className="markdown-blocks">{blocks.map((block, i) => <StableBlock key={i} source={block.markdown} streaming={streaming} {...(i === 0 && block.type === 'paragraph' && firstMeta?.marker ? firstMeta : block.meta)}/>)}</div>;
}
export function StreamingMarkdown({ source, firstMeta }: { source: string; firstMeta?: RenderMeta }) {
  const [visible, setVisible] = useState(source);
  const latest = useRef(source); latest.current = source;
  useEffect(() => {
    const timer = setInterval(() => setVisible(latest.current), 45);
    return () => clearInterval(timer);
  }, []);
  // Match persisted block boundaries and layout, including list markers and
  // nested indentation, instead of switching from native lists on completion.
  return <div className="streaming-draft streaming-markdown" aria-busy="true"><MarkdownBlocks source={visible} firstMeta={firstMeta} streaming/></div>;
}
