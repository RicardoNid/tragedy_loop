import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../e2e/review',
  outputDir: '../../products/comprehensive/browser-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5193',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1100 },
  },
  webServer: {
    command: 'node scripts/review/dev.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:5193',
    env: { REVIEW_WEB_PORT: '5193', REVIEW_API_PORT: '3101' },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
