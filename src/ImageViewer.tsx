import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

export function ImageViewer({url,alt,onClose}:{url:string;alt:string;onClose:()=>void}) {
  const [view,setView]=useState({zoom:1,x:0,y:0}), [dragging,setDragging]=useState(false), [fitWidth,setFitWidth]=useState<number|null>(null);
  const {zoom,x,y}=view;
  const panel=useRef<HTMLDivElement>(null), viewport=useRef<HTMLDivElement>(null);
  const drag=useRef<{id:number;clientX:number;clientY:number;x:number;y:number}|null>(null), moved=useRef(false);
  const change=useCallback((factor:number,point?:{x:number;y:number})=>setView(previous=>{
    const next=Math.max(.25,Math.min(8,previous.zoom*factor)), ratio=next/previous.zoom;
    const anchor=point || {x:0,y:0};
    return {zoom:next,x:anchor.x-(anchor.x-previous.x)*ratio,y:anchor.y-(anchor.y-previous.y)*ratio};
  }),[]);
  const finishDrag=()=>{drag.current=null;setDragging(false);};
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null; panel.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose();}
      if(e.key==='Tab'){e.preventDefault();const controls=[...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=controls.indexOf(document.activeElement as HTMLButtonElement);controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();}
    };
    let trackpadUntil=0;
    const wheel=(e:WheelEvent)=>{
      e.stopPropagation();e.preventDefault();
      // Chromium exposes trackpad pinch as ctrl+wheel. Pixel deltas with a
      // horizontal component or small/fractional steps are two-finger panning;
      // coarse wheel notches retain mouse-wheel zoom.
      const trackpad=!e.ctrlKey && !e.metaKey && e.deltaMode===0 && (Date.now()<trackpadUntil || e.deltaX!==0 || Math.abs(e.deltaY)<40 || !Number.isInteger(e.deltaY));
      if(trackpad)trackpadUntil=Date.now()+250;
      if(trackpad){setView(previous=>({...previous,x:previous.x-e.deltaX,y:previous.y-e.deltaY}));return;}
      if(!e.deltaY)return;
      const bounds=viewport.current!.getBoundingClientRect();
      const point=e.clientX>=bounds.left && e.clientX<=bounds.right && e.clientY>=bounds.top && e.clientY<=bounds.bottom ? {x:e.clientX-bounds.left-bounds.width/2,y:e.clientY-bounds.top-bounds.height/2} : undefined;
      change(e.ctrlKey||e.metaKey ? Math.exp(-e.deltaY*.01) : e.deltaY<0?1.1:1/1.1,point);
    };
    const area=viewport.current;area?.addEventListener('wheel',wheel,{passive:false});
    window.addEventListener('keydown',key,true);
    return ()=>{window.removeEventListener('keydown',key,true);area?.removeEventListener('wheel',wheel);previous?.focus({preventScroll:true});};
  },[onClose,change]);
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片查看器" ref={panel} tabIndex={-1} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="image-viewer-controls"><button aria-label="缩小图片" onClick={()=>change(1/1.25)} disabled={zoom<=.25}><Minus size={18}/></button><output aria-label="图片缩放比例">{Math.round(zoom*100)}%</output><button aria-label="放大图片" onClick={()=>change(1.25)} disabled={zoom>=8}><Plus size={18}/></button><button aria-label="重置图片缩放" onClick={()=>{setView({zoom:1,x:0,y:0});finishDrag();}}><RotateCcw size={17}/></button><button aria-label="关闭图片查看器" onClick={onClose}><X size={20}/></button></div>
    <div className={`image-viewer-scroll ${dragging?'dragging':''}`} ref={viewport} onClick={e=>{if(e.target===e.currentTarget && !moved.current)onClose();}}
      onPointerDown={e=>{
        moved.current=false;
        if(e.button!==0 || !(e.target instanceof HTMLImageElement))return;
        e.preventDefault();e.stopPropagation();
        drag.current={id:e.pointerId,clientX:e.clientX,clientY:e.clientY,x,y};setDragging(true);
        e.target.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e=>{
        const start=drag.current;if(!start || start.id!==e.pointerId)return;
        const dx=e.clientX-start.clientX,dy=e.clientY-start.clientY;
        if(Math.abs(dx)+Math.abs(dy)>3)moved.current=true;
        setView(previous=>({...previous,x:start.x+dx,y:start.y+dy}));
      }}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
      <img src={url} alt={alt} draggable={false} onLoad={e=>{const img=e.currentTarget;const bounds=img.parentElement!.getBoundingClientRect();setFitWidth(Math.min(img.naturalWidth,bounds.width,bounds.height*img.naturalWidth/img.naturalHeight));}} style={{width:fitWidth ? `${fitWidth}px` : 'auto',transform:`translate(-50%, -50%) translate(${x}px, ${y}px) scale(${zoom})`}}/>
    </div>
  </div>,document.body);
}
