import { defineConfig } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
process.env.REVIEW_FILE_UI = pathToFileURL(resolve('tragedy-test-ui.html')).href;
export default defineConfig({
  testDir: '../../e2e/review',
  grepInvert: /@http/,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: '../../products/review/local-browser-results',
  use: {
    offline: true,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1100 },
  },
});
