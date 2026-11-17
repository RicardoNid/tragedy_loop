import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('private engine and solver diagnostics survive a reload of the test page', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 BTX 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText(/^候选取值 [1-9]/)).toBeVisible();
  await expect(page.getByRole('button', { name: '导出完整诊断（含剧透）' })).toHaveCount(0);
  await page.reload();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出最近诊断（含剧透）' }).click();
  const downloaded = await pending;
  const log = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(log.engine.setup.module).toBe('BTX');
  expect(log.engine.choices.map((c: {choice:{kind:string}}) => c.choice.kind)).toEqual(['start','continue']);
  expect(log.checkpoints.at(-1).observationThrough).toEqual(log.engine.observations.length);
  expect(log.calculations.at(-1).observation).toEqual(log.engine.observations.length);
  expect(Object.values(log.passes).length).toBeGreaterThan(1);
});

test('manual mastermind ability, target selection and protagonist goodwill ability settle on the board', async ({
  page,
}) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  const panel = page.getByRole('region', { name: '对局操作', exact: true });
  const ready = () => expect(page.getByRole('status').first()).toHaveText('');
  const current = async () => {
    await ready();
    const switcher = panel.getByRole('button', { name: /^切换到/ });
    if (await switcher.count()) {
      await switcher.click();
      await ready();
    }
  };
  await panel.getByRole('button', { name: '继续', exact: true }).click();
  await current();
  for (const [i, card, target] of [
    [1, '横向移动', '医院'],
    [2, '纵向移动', '神社'],
    [3, '不安 −1', '都市'],
  ] as const) {
    await panel
      .getByRole('combobox', { name: `行动牌 ${i}`, exact: true })
      .selectOption({ label: card });
    await panel
      .getByRole('combobox', { name: `目标 ${i}`, exact: true })
      .selectOption({ label: target });
  }
  await panel.getByRole('button', { name: '提交剧作家行动牌' }).click();
  for (const [card, target] of [
    ['友好 +2', '女学生'],
    ['不安 +1', '男学生'],
    ['横向移动', '医院'],
  ]) {
    await current();
    await panel
      .getByRole('combobox', { name: '行动牌', exact: true })
      .selectOption({ label: card });
    await panel
      .getByRole('combobox', { name: '目标', exact: true })
      .selectOption({ label: target });
    await panel.getByRole('button', { name: '盖放行动牌', exact: true }).click();
  }
  await current();
  const simultaneous = page.locator('.log article').filter({ has: page.getByText('同时发生', { exact: true }) }).first();
  await expect(simultaneous.getByRole('listitem')).toHaveCount(2);
  await expect(simultaneous).toContainText('男学生');
  await expect(simultaneous).toContainText('女学生');
  await panel.getByRole('button', { name: '医生 · 主谋：放置密谋', exact: true }).click();
  await ready();
  await panel.getByRole('button', { name: '医院', exact: true }).click();
  await ready();
  await expect(page.locator('.hospital > .section-heading')).toContainText('密谋 1');
  await panel.getByRole('button', { name: '结束本阶段', exact: true }).click();
  await current();
  await expect(
    page.locator('.character').filter({ has: page.getByText('男学生', { exact: true }) }),
  ).toContainText('不安 1');
  await panel.getByRole('button', { name: '女学生 · 减少学生的不安', exact: true }).click();
  await ready();
  await expect(
    page.locator('.character').filter({ has: page.getByText('男学生', { exact: true }) }),
  ).toContainText('不安 0');
});

test('BTX final-answer proposal, three votes and all identity answers are operable through UI', async ({
  page,
}) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 BTX 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  const panel = page.getByRole('region', { name: '对局操作', exact: true });
  const ready = () => expect(page.getByRole('status').first()).toHaveText('');
  await panel.getByRole('button', { name: '提议最终回答', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await ready();
    const switcher = panel.getByRole('button', { name: /^切换到/ });
    if (await switcher.count()) {
      await switcher.click();
      await ready();
    }
    await panel.getByRole('button', { name: '同意最终回答', exact: true }).click();
  }
  await ready();
  const switcher = panel.getByRole('button', { name: /^切换到/ });
  if (await switcher.count()) {
    await switcher.click();
    await ready();
  }
  const fixture = JSON.parse(await readFile('apps/server/src/fixtures/btx-01g.json', 'utf8'));
  for (const character of fixture.setup.characters) {
    await panel.getByRole('combobox', { name: '角色', exact: true }).selectOption(character.id);
    await panel.getByRole('textbox', { name: '身份', exact: true }).fill(character.identity);
    await panel.getByRole('button', { name: '提交回答', exact: true }).click();
    await ready();
  }
  await expect(page.locator('.result')).toContainText('主人公 1、主人公 2、主人公 3获胜');
});

for (const profile of ['FS', 'BTX']) {
  test(`${profile}: a complete game through both human UI ports without fixture automation`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const commands: { actor: string; choice: { kind: string; placements?: unknown[] } }[] = [];
    const errors: string[] = [];
    let fixtures = 0;
    const network: string[] = [];
    const played = new Set<string>();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (req) => {
      if (/^https?:/.test(req.url())) network.push(req.url());
      if (req.method() !== 'POST') return;
      if (req.url().endsWith('/fixture')) fixtures++;
      const actor = req.url().match(/\/api\/games\/[^/]+\/(mastermind|p[012])$/)?.[1];
      if (actor) commands.push({ actor, choice: req.postDataJSON().choice });
    });
    await page.goto(process.env.REVIEW_FILE_UI ?? '/');
    await page.getByRole('button', { name: `新建 ${profile} 测试对局` }).click();
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    const panel = page.getByRole('region', { name: '对局操作', exact: true });
    const status = page.getByRole('status').first();
    const knowledge = page.getByRole('region', { name: '解空间', exact: true });
    const matrix = knowledge.getByRole('table', { name: '角色 × 初始身份', exact: true });
    await expect(matrix).toHaveCount(0);
    await panel.getByRole('button', { name: '继续', exact: true }).click();
    await expect(matrix.locator('tbody tr')).toHaveCount(profile === 'FS' ? 6 : 7);
    const openingStatus = await knowledge.locator('[aria-live]').innerText();
    await expect(panel).toBeVisible();
    for (let step = 0; step < 120; step++) {
      await expect(status).toHaveText('');
      if (await page.locator('.result').count()) break;
      const switcher = panel.getByRole('button', { name: /^切换到/ });
      if (await switcher.count()) {
        await switcher.click();
        await expect(status).toHaveText('');
      }
      const title = await panel.getByRole('heading').innerText();
      played.add(title);
      const master = title.includes('剧作家');
      await expect(page.locator('.secret')).toHaveCount(master ? 1 : 0);
      const masterCards = panel.getByRole('button', { name: '提交剧作家行动牌', exact: true });
      const playerCards = panel.getByRole('button', { name: '盖放行动牌', exact: true });
      if (await masterCards.count()) {
        for (const [i, card, target] of [
          [1, '横向移动', '医院'],
          [2, '纵向移动', '神社'],
          [3, '不安 −1', '都市'],
        ] as const) {
          await panel
            .getByRole('combobox', { name: `行动牌 ${i}`, exact: true })
            .selectOption({ label: card });
          await panel
            .getByRole('combobox', { name: `目标 ${i}`, exact: true })
            .selectOption({ label: target });
        }
        if (step < 5)
          await page.screenshot({
            path: `products/review/manual-${profile.toLowerCase()}.png`,
            fullPage: true,
          });
        await masterCards.click();
      } else if (await playerCards.count()) {
        await panel
          .getByRole('combobox', { name: '行动牌', exact: true })
          .selectOption({ label: '横向移动' });
        await panel.getByRole('combobox', { name: '目标', exact: true }).selectOption({
          label: title.includes('主人公 1') ? '医院' : title.includes('主人公 2') ? '神社' : '都市',
        });
        await playerCards.click();
      } else {
        const pass = panel.getByRole('button', { name: '结束本阶段', exact: true });
        const next = panel.getByRole('button', { name: '继续', exact: true });
        if (await pass.count()) await pass.click();
        else if (await next.count()) await next.click();
        else throw new Error(`No manual operation at ${title}: ${await panel.innerText()}`);
      }
    }
    await expect(page.locator('.result')).toContainText('主人公 1、主人公 2、主人公 3获胜');
    // The terminal board and inference must refer to the same public evidence.
    await page.getByRole('button', { name: '主人公 1', exact: true }).click();
    await expect(status).toHaveText('');
    const observationCount = await page.locator('.log article').count();
    await expect(
      knowledge.getByText(new RegExp(`证据截至第 ${observationCount} 条观察`)),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(matrix.locator('tbody tr')).toHaveCount(profile === 'FS' ? 6 : 7);
    await expect(knowledge.locator('[aria-live]')).not.toHaveText(openingStatus);
    await expect(knowledge.locator('[aria-live]')).not.toContainText(
      /计算失败|观察与规则矛盾|暂不支持/,
    );
    if (process.env.REVIEW_FILE_UI) {
      expect(network).toEqual([]);
      expect(played.size).toBe(4);
    } else {
      expect(new Set(commands.map((c) => c.actor))).toEqual(
        new Set(['mastermind', 'p0', 'p1', 'p2']),
      );
      const cards = commands.filter((c) => c.choice.kind === 'cards');
      expect(cards.filter((c) => c.actor === 'mastermind')).toHaveLength(profile === 'FS' ? 3 : 5);
      for (const c of cards)
        expect(c.choice.placements).toHaveLength(c.actor === 'mastermind' ? 3 : 1);
    }
    expect(fixtures).toBe(0);
    expect(errors).toEqual([]);
    await expect(page.locator('.secret')).toHaveCount(0);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出审阅记录' }).click();
    const download = await downloading;
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(exported.histories.mastermind).toBeUndefined();
    for (const history of Object.values(exported.histories) as any[][])
      for (const snapshot of history) expect(snapshot.secret).toBeUndefined();
  });
}

test('board perspective shows the true script and hides it again for each protagonist', async ({
  page,
}) => {
  const fixtures = JSON.parse(
    await readFile('tests/engine/fixtures/official-scenarios.json', 'utf8'),
  );
  const setup = fixtures.find((f: { id: string }) => f.id === 'MZ-01G').setup;
  setup.characters[0] = { id: 'boyStudent', character: '转校生', identity: '平民', enterDay: 2 };
  setup.characters[3] = { id: 'shrineMaiden', character: '神灵', identity: '平民', enterLoop: 2 };
  setup.publicSpecialRules = ['本局允许主人公在轮回间交换笔记。'];
  setup.incidents[0] = {
    day: 2,
    name: '伪造事件',
    publicName: '公开事件甲',
    culprit: 'richStudent',
  };
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByText('导入测试剧本', { exact: true }).click();
  await page.getByRole('textbox', { name: '剧本 JSON' }).fill(JSON.stringify(setup));
  await page.getByRole('button', { name: '校验并开局' }).click();
  const seats = page.getByRole('group', { name: '盘面视角' });
  const script = page.getByRole('region', { name: '剧作家剧本信息' });
  await expect(page.locator('textarea[aria-label="剧本 JSON"]')).toHaveValue('');
  await expect(page.locator('textarea[aria-label="剧本 JSON"]')).toBeHidden();
  await expect(page.locator('.clock')).toContainText('游戏开始前');
  await expect(page.getByRole('region', { name: '公开特殊规则' })).toContainText(setup.publicSpecialRules[0]);
  await expect(page.locator('.character')).toHaveCount(0);
  await seats.getByRole('button', { name: '剧作家', exact: true }).click();
  await expect(script).toContainText('男子汉的战争');
  await expect(script).toContainText('爱与恨的螺旋');
  await expect(script.getByRole('listitem').first()).toContainText(
    '伪造事件 · 当事人 大小姐（公开名：公开事件甲）',
  );
  await expect(page.locator('.character').filter({ hasText: '异界人' })).toContainText(
    '身份 · 不安定因子',
  );
  const roster = script.getByRole('table', { name: '剧作家角色名册' });
  await expect(roster.locator('tbody tr')).toHaveCount(7);
  await expect(roster.getByRole('row').filter({ hasText: '转校生' })).toContainText('未登场');
  await expect(roster.getByRole('row').filter({ hasText: '转校生' })).toContainText('第 2 日登场');
  await expect(roster.getByRole('row').filter({ hasText: '神灵' })).toContainText('第 2 轮登场');
  for (const seat of ['主人公 1', '主人公 2', '主人公 3']) {
    await seats.getByRole('button', { name: seat, exact: true }).click();
    await expect(script).toHaveCount(0);
    await expect(page.locator('.board-identity')).toHaveCount(0);
    await expect(page.locator('.character')).toHaveCount(0);
    await expect(page.locator('.schedule .badge')).toHaveCount(3);
    await expect(page.locator('.schedule')).toContainText('公开事件甲');
    await expect(page.locator('.schedule')).not.toContainText('伪造事件');
  }
  await seats.getByRole('button', { name: '主人公 1', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(5);
  await expect(page.locator('.board')).not.toContainText('转校生');
  await expect(page.locator('.board')).not.toContainText('神灵');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
});
