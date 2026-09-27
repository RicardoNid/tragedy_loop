import { test, expect } from '@playwright/test';

test('read-only reference navigation, atlas filtering and source links survive migration', async ({
  page,
  request,
}) => {
  await page.goto('/site/');
  await expect(page.getByRole('link', { name: /审阅编辑器/ })).toHaveCount(0);
  await page.getByTestId('rules-atlas').click();
  await expect(page.locator('#module-count')).toContainText('8 / 8');
  await page.locator('#module-search').fill('Last Liar');
  await expect(page.locator('#module-count')).toHaveText('1 / 8 套');
  await page.locator('#module-search').fill('no-such-module-xyz');
  await expect(page.locator('#no-results')).toBeVisible();
  await page.locator('#clear-search').click();
  await expect(page.locator('#module-count')).toHaveText('8 / 8 套');
  const links = await page
    .locator('a[href]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).href));
  for (const url of new Set(
    links.filter((url) => url.startsWith('http://127.0.0.1:5180/') && !url.includes('#')),
  )) {
    expect((await request.get(url)).status(), url).toBe(200);
  }
});
