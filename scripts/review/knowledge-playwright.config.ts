import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../e2e/review',
  testMatch: 'knowledge.spec.ts',
  workers: 1,
  outputDir: '../../.cache/knowledge-tests',
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5186',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1100 },
  },
  webServer: {
    command: 'node scripts/review/dev.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:5186',
    reuseExistingServer: false,
    env: { REVIEW_WEB_PORT: '5186', REVIEW_API_PORT: '3007' },
    timeout: 30000,
  },
});
