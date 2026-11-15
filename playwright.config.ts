import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 30000, env: { PORT: '3301', VITE_PORT: '5174', RETROMANIA_DB_PATH: resolve('node_modules/.cache/playwright-test.sqlite') } },
});
