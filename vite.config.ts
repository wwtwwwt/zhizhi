import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: process.env.ZHIZHI_DESKTOP_DEV ? 5174 : 5173, strictPort: true, proxy: { '/api': process.env.ZHIZHI_DESKTOP_DEV ? 'http://127.0.0.1:3002' : 'http://127.0.0.1:3001' } },
});
