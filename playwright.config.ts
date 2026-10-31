import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 45_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 1440, height: 900 }, trace: { mode: 'retain-on-failure', screenshots: false } },
  webServer: { command: 'npm run build && LEARNHELPER_DATA_DIR=.learnhelper/e2e PORT=5175 npm start', url: 'http://127.0.0.1:5175/api/health', timeout: 60_000, reuseExistingServer: false },
});
