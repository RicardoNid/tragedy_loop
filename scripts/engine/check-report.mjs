import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pageUrl = pathToFileURL(resolve(root, 'products/engine/index.html')).href;
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pageUrl);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('h1').innerText(), '规则引擎：实现、接口与验收');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Page overflow at ${width}px`,
    );
    for (const link of await page
      .locator('a')
      .evaluateAll((nodes) => nodes.map((a) => a.getAttribute('href')))) {
      if (link.startsWith('#')) assert.equal(await page.locator(link).count(), 1);
      else if (!/^[a-z]+:/i.test(link))
        assert.ok(existsSync(fileURLToPath(new URL(link, pageUrl))), `Missing ${link}`);
    }
  }
  await page.locator('#replay details summary').click();
  assert.ok((await page.locator('#replay details').getAttribute('open')) !== null);
  assert.deepEqual(errors, []);
  if (process.argv.includes('--screenshot')) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(root, 'products/engine/review-desktop.png') });
  }
  console.log(
    'HTML report: desktop/mobile layout, local links, replay disclosure, and browser errors checked. Human acceptance remains pending.',
  );
} finally {
  await browser.close();
}
