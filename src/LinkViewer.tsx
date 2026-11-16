import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { WindowPanel } from './WindowPanel';
import { desktop } from './desktop';
import { useAppState } from './client';
import { readerUrl } from '../shared/links';
export function LinkViewer() {
  const state=useAppState(), [url,setUrl]=useState(''), [error,setError]=useState(false);
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const click=(event:MouseEvent)=>{
      if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
      const anchor=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if(!anchor || anchor.hasAttribute('download'))return;
      const address=readerUrl(anchor.href); if(!address || new URL(address).origin===location.origin)return;
      if(state.settings?.externalLinks){event.preventDefault();if(desktop)void desktop.linkReader('external',address);else window.open(address,'_blank','noopener,noreferrer');return;}
      event.preventDefault();setError(false);setUrl(address);
    };
    document.addEventListener('click',click);return()=>document.removeEventListener('click',click);
  },[state.settings?.externalLinks]);
  useEffect(()=>{
    if(!url || !desktop)return;
    const native=desktop;
    let disposed=false, frame=0, previous='';
    const sync=()=>{if(disposed)return;const bounds=host.current?.getBoundingClientRect();if(bounds){const next=JSON.stringify({x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height});if(next!==previous){previous=next;void native.linkReader('bounds',JSON.parse(next));}}frame=requestAnimationFrame(sync);};
    // Wait for the shared window's entrance animation before placing native content.
    const timer=setTimeout(()=>{void native.linkReader('open',url).then(()=>{if(!disposed)sync();});},200);
    const unsubscribe=native.onLinkReaderError(()=>setError(true));
    const unsubscribeClose=native.onLinkReaderClose(()=>setUrl(''));
    return()=>{disposed=true;clearTimeout(timer);cancelAnimationFrame(frame);unsubscribe();unsubscribeClose();void native.linkReader('close');};
  },[url]);
  if(!url)return null;
  const external=()=>{if(desktop)void desktop.linkReader('external',url);else window.open(url,'_blank','noopener,noreferrer');};
  return createPortal(<WindowPanel title="网页" heading={<span className="link-view-address" title={url}>{url}</span>} actions={<button type="button" className="link-view-external" onClick={external}><ExternalLink size={13}/>用默认浏览器打开</button>} onClose={()=>setUrl('')}>
    {error && <p className="link-view-hint" role="status">网页加载失败，请使用默认浏览器打开。</p>}
    <div className="link-view-content" ref={host}>{!desktop && <iframe title="网页内容" src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"/>}</div>
  </WindowPanel>,document.body);
}
