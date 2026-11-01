import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

export function ImageViewer({url,alt,onClose}:{url:string;alt:string;onClose:()=>void}) {
  const [zoom,setZoom]=useState(1), [fitWidth,setFitWidth]=useState<number|null>(null), panel=useRef<HTMLDivElement>(null), viewport=useRef<HTMLDivElement>(null);
  const change=(factor:number)=>setZoom(value=>Math.max(.25,Math.min(8,value*factor)));
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null; panel.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose();}
      if(e.key==='Tab'){e.preventDefault();const controls=[...panel.current!.querySelectorAll<HTMLButtonElement>('button')];const index=controls.indexOf(document.activeElement as HTMLButtonElement);controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();}
    };
    const wheel=(e:WheelEvent)=>{e.stopPropagation();if(e.ctrlKey||e.metaKey){e.preventDefault();change(e.deltaY<0?1.1:1/1.1);}};
    const area=viewport.current;area?.addEventListener('wheel',wheel,{passive:false});
    window.addEventListener('keydown',key,true);
    return ()=>{window.removeEventListener('keydown',key,true);area?.removeEventListener('wheel',wheel);previous?.focus({preventScroll:true});};
  },[onClose]);
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片查看器" ref={panel} tabIndex={-1} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="image-viewer-controls"><button aria-label="缩小图片" onClick={()=>change(1/1.25)} disabled={zoom<=.25}><Minus size={18}/></button><output aria-label="图片缩放比例">{Math.round(zoom*100)}%</output><button aria-label="放大图片" onClick={()=>change(1.25)} disabled={zoom>=8}><Plus size={18}/></button><button aria-label="重置图片缩放" onClick={()=>setZoom(1)}><RotateCcw size={17}/></button><button aria-label="关闭图片查看器" onClick={onClose}><X size={20}/></button></div>
    <div className="image-viewer-scroll" ref={viewport} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><img src={url} alt={alt} draggable={false} onLoad={e=>{const img=e.currentTarget;const bounds=img.parentElement!.getBoundingClientRect();setFitWidth(Math.min(img.naturalWidth,bounds.width,bounds.height*img.naturalWidth/img.naturalHeight));}} style={{width:fitWidth ? `${zoom*fitWidth}px` : 'auto',maxWidth:'none',maxHeight:'none'}}/></div>
  </div>,document.body);
}
