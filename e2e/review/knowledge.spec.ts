import { test, expect } from '@playwright/test';
import type { Choice, MastermindView } from '../../packages/contracts/src/game.js';

for (const module of ['FS', 'BTX'] as const)
  test(
    module + ' real ability stops at its public cause and preserves all character rows',
    { tag: '@http' },
    async ({ page, request }) => {
      const btx = module === 'BTX';
      const board = btx ? 'city' : 'school';
      const ability = btx ? 'rumor-intrigue' : 'brain';
      const setup = {
        module,
        anniversary: false,
        loops: 2,
        days: 2,
        captain: 'p0',
        discussion: 'allowed',
        y: btx ? '巨大定时炸弹X' : '复仇的火种',
        x: btx ? ['流言四起', '因果线'] : ['开膛者的魔影'],
        characters: [
          { id: 'a', character: '男学生', identity: btx ? '魔女' : '主谋' },
          { id: 'b', character: '住院患者', identity: btx ? '传谣人' : '杀人狂' },
          { id: 'c', character: btx ? '黑猫' : '巫女', identity: btx ? '平民' : '传谣人' },
        ],
        incidents: btx ? [{ day: 1, name: '医院事故', culprit: 'c' }] : [],
      };
      await page.goto(process.env.REVIEW_FILE_UI ?? '/');
      await page.getByText('导入测试剧本', { exact: true }).click();
      await page.getByRole('textbox', { name: '剧本 JSON' }).fill(JSON.stringify(setup));
      const creation = page.waitForResponse(
        (r) => r.url().endsWith('/api/games') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '校验并开局' }).click();
      const { id } = await (await creation).json();
      let used = false,
        observed = false;
      for (let i = 0; i < 30; i++) {
        const turn = await (await request.get(`/api/games/${id}/turn`)).json();
        const view: MastermindView = await (
          await request.get(`/api/games/${id}/${turn.actor}`)
        ).json();
        if (view.boards[board] === 1 && view.phase === 'mastermind-abilities') {
          observed = true;
          break;
        }
        const d = view.decision!;
        let choice: Choice;
        if (d.cardPlacement) {
          const menu = d.cardPlacement;
          const cards = menu.cards.filter(
            (id) =>
              !['horizontal', 'vertical', 'diagonal'].includes(
                view.hands[d.actor]!.find((c) => c.id === id)!.kind,
              ),
          );
          choice = {
            kind: 'cards',
            placements: cards.slice(0, menu.count).map((card, n) => ({
              card,
              target: menu.targets.filter((t) => ['a', 'b', 'c'].includes(t))[n]!,
            })),
          };
        } else if (!used && d.options.some((c) => c.kind === 'ability' && c.ability === ability)) {
          choice = d.options.find((c) => c.kind === 'ability' && c.ability === ability)!;
          used = true;
        } else if (
          d.kind === 'choice' &&
          d.options.some((c) => c.kind === 'select' && c.value === board)
        )
          choice = { kind: 'select', value: board };
        else
          choice =
            d.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ?? d.options[0]!;
        const response = await request.post(`/api/games/${id}/${turn.actor}`, {
          data: { id: `ui-${i}`, expectedRevision: view.revision, decisionId: d.id, choice },
        });
        expect(response.ok(), await response.text()).toBe(true);
        await request.get(`/api/games/${id}/knowledge`);
      }
      expect(observed).toBe(true);
      await page.getByRole('button', { name: '主人公 1', exact: true }).click();
      const panel = page.getByRole('region', { name: '解空间', exact: true });
      await expect(panel.locator('[aria-live]')).toContainText(/局部传播完成|正在验证|候选取值验证完成|尚未判定完毕/);
      const scope = panel.getByRole('table', { name: '本次计算范围' });
      if (btx) {
        await expect(panel.getByText(/本次保留的原因（1）/)).toBeVisible();
        await expect(panel.getByText('所有相容解释都要求剧本含有“流言四起”。')).toBeVisible();
        await expect(
          panel.getByText(/本次新增历史搜索起点 \d+ 个，推进隐藏行动 \d+ 个分支/),
        ).toBeVisible();
        await expect(
          scope.getByRole('row').filter({ hasText: '医院事故' }).locator('td').first(),
        ).toHaveText('无直接来源');
        await expect(
          panel.getByRole('table', { name: '角色 × 初始身份', exact: true }).locator('tbody tr'),
        ).toHaveCount(3);
        return;
      }
      const rules = panel.getByRole('table', { name: '规则候选判定' });
      await expect(rules.getByRole('row').filter({ hasText: '流言四起' })).toContainText('？');
      await expect(scope).toContainText('住院患者');
      await expect(scope).toContainText('流言四起');
      await expect(panel.getByText(/若不包含“流言四起”/).first()).toBeVisible();
      await expect(panel.getByText(/解空间 S\d+ ← S\d+/)).toBeVisible();
      await expect(panel.getByText(/第 1 轮至多 1 次/).first()).toBeVisible();
      await expect(
        panel.getByRole('table', { name: '角色 × 初始身份', exact: true }).locator('tbody tr'),
      ).toHaveCount(3);
      await panel.screenshot({ path: test.info().outputPath('pruning-scope.png') });
      // Local compound settlement can leave full-history verification deferred.
      const verify = panel.getByRole('button', { name: '核验联合历史' });
      if (await verify.isVisible()) await verify.click();
      await expect(panel.locator('[aria-live]')).toContainText('候选取值验证完成', {
        timeout: 20000,
      });
      await expect(panel.getByText(/跨表逻辑关系/)).toBeVisible();
    },
  );

test('scope table keeps skipped candidates and offers explicit full-history verification', { tag: '@http' }, async ({
  page,
}) => {
  let verified = false;
  await page.route('**/api/games/*/knowledge/verify', async (route) => {
    verified = true;
    await route.continue();
  });
  await page.route('**/api/games/*/knowledge', async (route) => {
    const response = await route.fetch(),
      result = await response.json();
    // Renderer contract test; actual causal inference and IPC are covered by engine/server tests.
    await route.fulfill({
      json: {
        ...result,
        status: verified ? 'exact' : 'incomplete',
        scope: {
          kind: 'board-intrigue',
          observation: 2,
          phase: 'mastermind-abilities',
          target: 'school',
          characters: ['local'],
          rules: [],
          events: [],
          fields: [
            { field: 'A 移动', alternatives: ['同时移动和死亡'] },
            { field: 'A 死亡', alternatives: ['同时移动和死亡'] },
            { field: 'A 友好增加', alternatives: ['两个来源共同贡献'] },
          ],
          skippedCharacters: ['remote'],
          skippedRules: ['流言四起'],
          skippedEvents: ['1:谋杀'],
          compound: { variables: ['culprit:1'], participants: ['local'], branches: 6, unresolved: true },
          conservative: [],
          deferred: !verified,
        },
      },
    });
  });
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const panel = page.getByRole('region', { name: '解空间', exact: true });
  await expect(panel.locator('[aria-live]')).toContainText(/局部传播完成|正在验证|候选取值验证完成|尚未判定完毕/);
  const fields = panel.getByRole('list', { name: '复合观察的逐项原因' });
  await expect(fields.getByRole('listitem')).toHaveCount(3);
  await expect(fields.getByRole('listitem').nth(2)).toContainText('两个来源共同贡献');
  await expect(panel.getByLabel('复合结算', {exact:true})).toContainText('6 个分支');
  await expect(panel.getByLabel('复合结算', {exact:true})).toContainText('第 1 天的当事人');
  await expect(panel.getByRole('table', { name: '本次计算范围' })).toContainText('remote');
  await expect(panel.getByRole('table', { name: '本次计算范围' })).toContainText('流言四起');
  await expect(
    panel.getByRole('table', { name: '角色 × 初始身份', exact: true }).locator('tbody tr'),
  ).toHaveCount(6);
  await panel.getByRole('button', { name: '核验联合历史' }).click();
  await expect(panel.locator('[aria-live]')).toContainText('候选取值验证完成');
});

test('live solution space, visibility toggle and revision-safe history', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const panel = page.getByRole('region', { name: '解空间', exact: true });
  await expect(panel.getByText(/^候选取值 [1-9][0-9]*$/)).toBeVisible({ timeout: 10000 });
  await expect(panel.locator('[aria-live]')).toContainText(/局部传播完成|正在验证|候选取值验证完成|尚未判定完毕/);
  await expect(
    panel.getByRole('table', { name: '角色 × 初始身份', exact: true }).locator('tbody tr'),
  ).toHaveCount(6);
  await expect(panel.getByRole('table', { name: '事件 × 当事人', exact: true })).toBeVisible();
  await expect(panel.getByRole('table', { name: '真实事件候选', exact: true })).toBeVisible();
  await expect(
    panel
      .getByRole('table', { name: '角色 × 初始身份', exact: true })
      .locator('.candidate-pending')
      .first(),
  ).toHaveText('?');
  await expect(
    panel
      .getByRole('table', { name: '角色 × 初始身份', exact: true })
      .locator('.candidate-certain'),
  ).toHaveCount(0);
  await panel.getByRole('checkbox').uncheck();
  await expect(panel.locator('table')).toHaveCount(0);
  await panel.getByRole('checkbox').check();
  // The official six-character script has a larger post-action search domain.
  // Verify a fresh result and historical isolation while the search may continue.
  await expect(panel.getByText(/观察版本 1$/)).toHaveCount(0);
  await expect(panel.getByText(/^候选取值 [1-9][0-9]*$/)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(panel.getByRole('table')).toHaveCount(0);
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '返回当前', exact: true }).click();
  await expect(panel.getByText(/观察版本 1$/)).toHaveCount(0);
  await expect(panel.locator('[aria-live]')).toContainText('局部传播完成', { timeout: 15000 });
  await page.screenshot({ path: test.info().outputPath('desktop.png'), fullPage: true });
});

test('certainty symbols distinguish witnesses, unique unverified candidates, and proven identity', { tag: '@http' }, async ({
  page,
}) => {
  let mode: 'multiple' | 'unverified' | 'certain' = 'multiple';
  let roster: { id: string; character: string }[] = [];
  await page.route('**/api/games/*/knowledge', async (route) => {
    const response = await route.fetch();
    const result = await response.json();
    const identities = Object.fromEntries(
      roster.map((c, i) => [c.id, i === 0 && mode !== 'multiple' ? ['主谋'] : ['主谋', '传谣人']]),
    );
    const verified = Object.fromEntries(
      roster.map((c, i) => [c.id, i === 0 && mode === 'unverified' ? [] : identities[c.id]]),
    );
    await route.fulfill({
      json: {
        ...result,
        domainComplete: true,
        jointCount: mode === 'certain' ? 1 : null,
        identities,
        verified: { ...result.verified, identities: verified },
      },
    });
  });
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/games') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const { id } = await (await created).json();
  roster = (await (await page.request.get(`/api/games/${id}/p0`)).json()).characters;
  const matrix = page.getByRole('table', { name: '角色 × 初始身份', exact: true });
  const name = roster[0]!.character;
  await expect(page.getByText('联合解总数：未计算', { exact: true })).toBeVisible();
  await expect(
    matrix.getByRole('cell', { name: `${name} · 主谋：可能是`, exact: true }),
  ).toHaveText('?');
  await expect(matrix.locator('.candidate-certain')).toHaveCount(0);
  mode = 'unverified';
  await expect(
    matrix.getByRole('cell', { name: `${name} · 传谣人：确定不是`, exact: true }),
  ).toHaveText('×');
  await expect(
    matrix.getByRole('cell', { name: `${name} · 主谋：可能是`, exact: true }),
  ).toHaveText('?');
  mode = 'certain';
  await expect(
    matrix.getByRole('cell', { name: `${name} · 主谋：确定是`, exact: true }),
  ).toHaveText('✓');
  await expect(matrix.getByRole('columnheader', { name: '传谣人', exact: true })).toBeVisible();
  await expect(page.getByText('联合解总数：1', { exact: true })).toBeVisible();
});

test('mobile solution space remains readable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText(/^候选取值 [1-9][0-9]*$/)).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole('region', { name: '解空间', exact: true }).locator('[aria-live]'),
  ).toContainText(/局部传播完成|正在验证|候选取值验证完成|尚未判定完毕/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const matrix = page.getByRole('region', { name: '角色 × 初始身份滚动区域', exact: true });
  expect(await matrix.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await matrix.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(matrix.getByRole('rowheader', { name: '女学生', exact: true })).toBeVisible();
  await matrix.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true });
});

test('official BTX roster, hospital incident and restart retain the selected module', async ({
  page,
}) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 BTX 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const panel = page.getByRole('region', { name: '解空间', exact: true });
  await expect(page.locator('.character')).toHaveCount(7);
  await expect(page.getByText('医院事故', { exact: false }).first()).toBeVisible();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(7);
  await expect(page.getByText('医院事故', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.clock')).toContainText('BTX');
});

test('BTX solution space stays mounted across mastermind operations and seat switches', async ({
  page,
}) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByRole('button', { name: '新建 BTX 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const knowledge = page.getByRole('region', { name: '解空间', exact: true });
  const actions = page.getByRole('region', { name: '对局操作', exact: true });
  const ready = () => expect(page.getByRole('status').first()).toHaveText('');
  await expect(knowledge).toBeVisible();

  await ready();
  await actions.getByRole('button', { name: '切换到剧作家操作', exact: true }).click();
  await ready();
  await expect(knowledge).toBeVisible();
  await expect(knowledge.getByText(/^候选取值 [1-9]\d*$/)).toBeVisible({ timeout: 10000 });
  const previous = await knowledge.locator('[aria-live]').innerText();
  await actions.getByRole('button', { name: '提交剧作家行动牌', exact: true }).click();
  await ready();
  await expect(knowledge).toBeVisible();
  await expect(knowledge.locator('[aria-live]')).not.toContainText(
    previous.match(/观察版本\s+\d+/)![0],
  );
  await expect(knowledge.getByText(/^候选取值 [1-9]\d*$/)).toBeVisible({ timeout: 10000 });
  await knowledge.getByRole('checkbox').uncheck();
  await actions.getByRole('button', { name: '切换到主人公 1操作', exact: true }).click();
  await ready();
  await expect(knowledge).toBeVisible();
  await expect(knowledge.getByRole('checkbox')).not.toBeChecked();
  await knowledge.getByRole('checkbox').check();
  await expect(knowledge.getByText(/^候选取值 [1-9]\d*$/)).toBeVisible();
  await page.getByRole('button', { name: '剧作家', exact: true }).click();
  await ready();
  await expect(knowledge).toBeVisible();
  await expect(knowledge.getByText('主人公共享观察', { exact: false })).toBeVisible();
});
