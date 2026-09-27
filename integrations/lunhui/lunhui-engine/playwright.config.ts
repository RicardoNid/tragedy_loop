import { defineConfig } from '@playwright/test';

// A dedicated, fresh server: never attach tests to the human's 5173/5174 game.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 5000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1050 },
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'on',
  },
  webServer: {
    command: 'pnpm gui',
    env: { GUI_PORT: '5180' },
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
