import { test, expect } from '@playwright/test';
test('reload and repeated official FS creation do not open browser dialogs or extra pages', async ({
  page,
  context,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  for (let n = 0; n < 3; n++) {
    if (n) await page.reload();
    await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(page.locator('.character')).toHaveCount(6);
    const knowledge = page.getByRole('region', { name: '解空间', exact: true });
    await expect(knowledge).toHaveCount(1);
    await expect(knowledge.getByRole('table', { name: '角色 × 初始身份', exact: true }).locator('tbody tr')).toHaveCount(6);
  }
  expect(dialogs).toEqual([]);
  expect(context.pages()).toHaveLength(1);
});

test('human review: board, protagonist controls, hidden cards, history, export and real victory', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏盘面' })).toBeVisible();
  await expect(page.locator('.location')).toHaveCount(4);
  await expect(page.locator('.character')).toHaveCount(6);
  await expect(page.getByText('AI 剧作家', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByText('测试推进', { exact: true }).click();
  await page.getByRole('button', { name: '推进剧作家测试回合' }).click();
  await expect(page.locator('.board').getByText('剧作家 · 暗置牌')).toHaveCount(3);
  await page
    .getByRole('combobox', { name: '行动牌', exact: true })
    .selectOption({ label: '友好 +2' });
  await page.getByRole('combobox', { name: '目标', exact: true }).selectOption({ label: '男学生' });
  await page.getByRole('button', { name: '盖放行动牌' }).click();
  await expect(page.getByRole('button', { name: '盖放行动牌' })).toHaveCount(0);
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.getByText('正在回看，返回当前盘面后可继续操作。')).toBeVisible();
  await expect(page.getByRole('button', { name: '盖放行动牌' })).toBeDisabled();
  await page.getByRole('button', { name: '返回当前', exact: true }).click();
  await page.getByLabel('审阅笔记').fill('测试：暗牌不可见，回看不可操作。');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出审阅记录' }).click();
  expect((await download).suggestedFilename()).toBe('主人公审阅记录.json');
  await page.getByRole('button', { name: '主人公 2', exact: true }).click();
  await page.getByRole('button', { name: '主人公 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '主人公 2', exact: true }).click();
  await expect(page.getByRole('button', { name: '盖放行动牌' })).toBeVisible();
  await page.screenshot({ path: 'products/review/desktop.png', fullPage: true });
  for (let i = 0; i < 160 && !(await page.locator('.result').count()); i++) {
    let acted = false;
    for (const seat of ['主人公 1', '主人公 2', '主人公 3']) {
      await page.getByRole('button', { name: seat, exact: true }).click();
      await expect(page.getByRole('status').first()).toHaveText('');
      const cards = page.getByRole('button', { name: '盖放行动牌', exact: true });
      if (await cards.count()) {
        await page
          .getByRole('combobox', { name: '行动牌', exact: true })
          .selectOption({ label: '横向移动' });
        await cards.click();
        acted = true;
        break;
      }
      const pass = page.getByRole('button', { name: '结束本阶段', exact: true });
      const next = page.getByRole('button', { name: '继续', exact: true });
      if (await pass.count()) {
        await pass.click();
        acted = true;
        break;
      }
      if (await next.count()) {
        await next.click();
        acted = true;
        break;
      }
    }
    if (!acted && !(await page.locator('.result').count()))
      await page.getByRole('button', { name: '推进剧作家测试回合' }).click();
    await expect(page.getByRole('status').first()).toHaveText('');
  }
  await expect(page.locator('.result')).toHaveText('主人公 1、主人公 2、主人公 3获胜 · 对局结束');
  expect(errors).toEqual([]);
});

test('mobile layout and invalid import preserve the board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(6);
  await page.getByText('导入测试剧本', { exact: true }).click();
  await page.getByLabel('剧本 JSON').fill('{"module":"FS"}');
  await page.getByRole('button', { name: '校验并开局' }).click();
  await expect(page.getByRole('status').first()).toContainText('校验');
  await expect(page.locator('.character')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByText('导入测试剧本', { exact: true }).click();
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText('');
  await page.screenshot({ path: 'products/review/mobile.png', fullPage: true });
});

test('official BTX roster, hospital incident and restart retain the selected module', async ({
  page,
}) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 BTX 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(7);
  await expect(page.getByText('医院事故', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(7);
  await expect(page.getByText('医院事故', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.clock')).toContainText('BTX');
});
