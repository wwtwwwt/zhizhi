import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
export function LinkTooltip() {
  const [preview,setPreview]=useState<{url:string;label:string;x:number;y:number}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(()=>{
    let target: HTMLAnchorElement | null=null;
    const clear=()=>{clearTimeout(timer.current);target=null;setPreview(null);};
    const show=(event:Event)=>{
      const link=(event.target as Element).closest?.('.markdown a[href]') as HTMLAnchorElement|null;
      if(!link || !/^https?:$/.test(new URL(link.href).protocol)){clear();return;}
      if(link===target)return;
      clear();target=link;
      timer.current=setTimeout(()=>{const rect=link.getBoundingClientRect();setPreview({url:link.href,label:link.textContent?.trim() || '',x:Math.max(12,Math.min(rect.left,innerWidth-332)),y:rect.bottom+9});},200);
    };
    const out=(event:MouseEvent)=>{if(target && !target.contains(event.relatedTarget as Node|null))clear();};
    document.addEventListener('mouseover',show);document.addEventListener('mouseout',out);document.addEventListener('focusin',show);document.addEventListener('focusout',clear);document.addEventListener('click',clear);window.addEventListener('scroll',clear,true);window.addEventListener('resize',clear);window.addEventListener('blur',clear);
    return()=>{clearTimeout(timer.current);document.removeEventListener('mouseover',show);document.removeEventListener('mouseout',out);document.removeEventListener('focusin',show);document.removeEventListener('focusout',clear);document.removeEventListener('click',clear);window.removeEventListener('scroll',clear,true);window.removeEventListener('resize',clear);window.removeEventListener('blur',clear);};
  },[]);
  if(!preview)return null;
  return createPortal(<div role="tooltip" className="link-hover-preview" style={{left:preview.x,top:Math.min(preview.y,innerHeight-110)}}><div><ExternalLink size={13}/><strong>{preview.label || new URL(preview.url).hostname}</strong></div><span>{preview.url}</span></div>,document.body);
}
