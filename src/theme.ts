import { useEffect } from 'react';
export type ThemeMode = 'light' | 'dark' | 'system';
const key = 'appearance';
function apply(mode: ThemeMode) {
  const dark = mode === 'dark' || mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#202020' : '#ffffff');
}
export function initializeTheme() {
  let mode: ThemeMode = 'system';
  try { const saved=localStorage.getItem(key);if(saved==='light'||saved==='dark'||saved==='system')mode=saved; } catch {}
  apply(mode);
}
export function useTheme(mode: ThemeMode | undefined) {
  useEffect(()=>{
    if(!mode)return;
    apply(mode);
    try {localStorage.setItem(key,mode);} catch {}
    const media=matchMedia('(prefers-color-scheme: dark)');
    const changed=()=>apply(mode);
    media.addEventListener('change',changed);
    return ()=>media.removeEventListener('change',changed);
  },[mode]);
}
