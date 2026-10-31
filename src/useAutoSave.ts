import { notify } from './client';
import { useEffect, useRef, useState } from 'react';

// Serialize writes and coalesce pending edits so slow responses cannot restore older values.
export function useAutoSave<T>(value: T, save: (value: T) => Promise<void>, delay = 450) {
  const [status,setStatus] = useState<'idle'|'pending'|'saving'|'saved'|'error'>('idle');
  const [error,setError] = useState('');
  const encoded = JSON.stringify(value);
  const writer = useRef(save); writer.current = save;
  const mounted = useRef(true), pending = useRef<{value:T;encoded:string} | undefined>(undefined), saved = useRef(encoded);
  const failed = useRef<{value:T;encoded:string} | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), running = useRef<Promise<void> | null>(null);
  const publish = (next:typeof status,message='') => { if(mounted.current){setStatus(next);setError(message);} };
  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    if (running.current) return running.current.then(()=>pending.current ? flush() : undefined);
    const task = pending.current || failed.current; if(!task)return Promise.resolve();pending.current=undefined;failed.current=undefined;
    publish('saving');
    running.current = (async()=>{
      try { await writer.current(task.value);saved.current=task.encoded;if(pending.current?.encoded===task.encoded)pending.current=undefined;publish(pending.current?'pending':'saved'); }
      catch(e) { failed.current=task;const message=(e as Error).message || '自动保存失败';publish('error',message);notify(message); }
      finally { running.current=null; }
    })();
    return running.current.then(()=>pending.current ? flush() : undefined);
  };
  useEffect(()=>{
    clearTimeout(timer.current);
    if(encoded===saved.current && !running.current){pending.current=undefined;return;}
    failed.current=undefined;pending.current={value:JSON.parse(encoded) as T,encoded};publish('pending');
    timer.current=setTimeout(()=>void flush(),delay);
  },[encoded]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(pending.current)void flush();};},[]);
  return {status,error,flush};
}
