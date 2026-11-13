import { useEffect, useRef, useState, type PointerEvent } from 'react';
export function sidebarWidthLimit(viewport: number) { return Math.max(180, Math.min(360, viewport - 480)); }
export function useSidebarResize() {
  const [preferred,setPreferred]=useState(()=>{try {const value=Number(localStorage.getItem('sidebarWidth'));return Number.isFinite(value)&&value>=180?Math.min(360,value):208;}catch{return 208;}});
  const [viewport,setViewport]=useState(innerWidth),[ready,setReady]=useState(false),[resizing,setResizing]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag=useRef<{id:number;x:number;width:number}|null>(null);
  const width=Math.max(180,Math.min(sidebarWidthLimit(viewport),preferred));
  const leave=()=>{clearTimeout(timer.current);if(!drag.current)setReady(false);};
  useEffect(()=>{const changed=()=>setViewport(innerWidth);window.addEventListener('resize',changed);return()=>{window.removeEventListener('resize',changed);clearTimeout(timer.current);};},[]);
  useEffect(()=>{try{localStorage.setItem('sidebarWidth',String(preferred));}catch{}},[preferred]);
  useEffect(()=>{document.documentElement.classList.toggle('sidebar-resizing',resizing);return()=>document.documentElement.classList.remove('sidebar-resizing');},[resizing]);
  const stop=()=>{drag.current=null;setResizing(false);setReady(false);};
  return {width,ready,resizing,enter:()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setReady(true),250);},leave,stop,
    start:(e:PointerEvent<HTMLElement>)=>{if(!ready||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,width};setResizing(true);},
    move:(e:PointerEvent<HTMLElement>)=>{const d=drag.current;if(d?.id===e.pointerId)setPreferred(Math.max(180,Math.min(sidebarWidthLimit(innerWidth),d.width+e.clientX-d.x)));},
    keyboard:(key:string)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return false;setPreferred(key==='Home'?180:key==='End'?sidebarWidthLimit(innerWidth):Math.max(180,Math.min(sidebarWidthLimit(innerWidth),width+(key==='ArrowRight'?10:-10))));return true;}};
}
