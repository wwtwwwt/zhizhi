import React from 'react';
import { initializeTheme } from './theme';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import 'katex/dist/katex.min.css';
if ((window as Window & { zhizhiDesktop?: { nativeSidebar: boolean } }).zhizhiDesktop?.nativeSidebar) {
  document.documentElement.classList.add('native-mac-sidebar');
}
initializeTheme();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
