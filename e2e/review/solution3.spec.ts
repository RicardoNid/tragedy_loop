import { expect, test } from '@playwright/test';
test('求解器3在公开登场后显示四张表，支持回看公告与证据', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  const panel = page.getByRole('region', { name: '解空间3', exact: true });
  await expect(panel).toContainText('等待第一轮回角色登场');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(panel.getByRole('table')).toHaveCount(4);
  await expect(panel.getByRole('table', { name: '角色身份' })).toContainText('未登场');
  const history = panel.getByLabel('公开记录');
  await history.selectOption('0');
  await expect(panel).toContainText('已处理至 #0');
  await panel
    .getByRole('table', { name: '真实事件' })
    .getByRole('button', { name: /自杀 √ 证据/ })
    .click();
  await expect(panel.getByLabel('所选命题的证据')).toContainText('公开');
  await history.selectOption('live');
  await expect(panel).toContainText('完整配置 0');
  expect(errors).toEqual([]);
});
