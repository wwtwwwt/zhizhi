import { useEffect } from 'react';
type Desktop = { onLinkReaderClose: (callback: () => void) => () => void; linkReader: (action: 'open'|'close'|'bounds'|'external', data?: unknown) => Promise<boolean>; onLinkReaderError: (callback: () => void) => () => void; platform: string; setSidebarBlur: (enabled: boolean) => Promise<boolean> };
export const desktop = (window as Window & { zhizhiDesktop?: Desktop }).zhizhiDesktop;
export const nativeSidebarSupported = desktop?.platform === 'darwin' || desktop?.platform === 'win32';
if (desktop?.platform === 'darwin') document.documentElement.classList.add('native-mac-sidebar');
export function useSidebarMaterial(enabled: boolean) {
  useEffect(() => {
    let current = true;
    document.documentElement.classList.remove('native-sidebar-blur');
    if (nativeSidebarSupported) void desktop!.setSidebarBlur(enabled).then(supported => {
      if (current) document.documentElement.classList.toggle('native-sidebar-blur', enabled && supported);
    }).catch(() => {});
    return () => { current = false; };
  }, [enabled]);
}
