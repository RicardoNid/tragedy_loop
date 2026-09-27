import { test, expect, type Page } from '@playwright/test';
import { firstStepsPath } from './first-steps-path.js';

async function ready(page: Page) {
  await expect(page.getByTestId('game-status')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('game-error')).toBeEmpty();
}
async function auditIds(page: Page) {
  const audit = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll(
        'a,button,input,select,textarea,[role="button"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]',
      ),
    ];
    const ids = [...document.querySelectorAll('[data-testid]')].map((e) =>
      e.getAttribute('data-testid'),
    );
    return {
      missing: controls
        .filter((e) => !e.getAttribute('data-testid')?.trim())
        .map((e) => e.outerHTML),
      duplicate: ids.filter((id, i) => ids.indexOf(id) !== i),
    };
  });
  expect(audit).toEqual({ missing: [], duplicate: [] });
}
async function reset(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('game-reset').click();
  await expect(page.getByTestId('game-phase')).toHaveText('开局');
  await ready(page);
}

test('First Steps: 66 GUI choices complete four days and a protagonist victory', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  const actions: unknown[] = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  try {
    await page.goto('/');
    await ready(page);
    await reset(page);
    expect(firstStepsPath).toHaveLength(66);
    await expect(page.getByTestId('choice-submit')).toBeDisabled();
    for (const [index, step] of firstStepsPath.entries()) {
      await test.step(`${index + 1}/66 · 第${step.day}日 · ${step.seat} · ${step.option}`, async () => {
        await ready(page);
        await auditIds(page);
        await expect(page.getByTestId('game-phase')).toHaveText(step.phase);
        await expect(page.getByTestId('game-clock')).toContainText(`${step.day} / 4`);
        const selectedSeat = await page.getByTestId('seat-selector').inputValue();
        if (selectedSeat !== step.seat) {
          await page.getByTestId('seat-follow').click();
          await expect(page.getByTestId('seat-selector')).toHaveValue(step.seat);
          await ready(page);
        }
        // No hidden identity in the protagonist's rendered character cards.
        if (step.seat !== 'mastermind')
          await expect(page.getByTestId('character-doctor')).not.toContainText('关键人物');
        const oldRevision = Number(
          await page.getByTestId('game-status').getAttribute('data-revision'),
        );
        await expect(page.getByTestId('choice-submit')).toBeDisabled();
        const option = page.getByTestId(`choice-${step.option}`);
        await option.click();
        await expect(option).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('choice-submit')).toBeEnabled();
        await page.getByTestId('choice-submit').click();
        await ready(page);
        await expect
          .poll(async () =>
            Number(await page.getByTestId('game-status').getAttribute('data-revision')),
          )
          .toBeGreaterThan(oldRevision);
        actions.push({
          step: index + 1,
          ...step,
          beforeRevision: oldRevision,
          afterRevision: Number(
            await page.getByTestId('game-status').getAttribute('data-revision'),
          ),
        });
        if (step.phase === '每日结束') {
          await expect(page.getByTestId('counter-doctor-goodwill')).toHaveText(`友好 ${step.day}`);
          await expect(page.getByTestId('counter-doctor-intrigue')).toHaveText(
            `密谋 ${step.day + 1}`,
          );
          for (const character of ['male_student', 'female_student'])
            await expect(page.getByTestId(`counter-${character}-goodwill`)).toHaveText(
              `友好 ${step.day}`,
            );
          await page.screenshot({
            path: testInfo.outputPath(`day-${step.day}.png`),
            fullPage: true,
          });
        }
        expect(problems).toEqual([]);
      });
    }
    await expect(page.getByTestId('game-result')).toContainText(
      '主人公 A、主人公 B、主人公 C 获胜',
    );
    await expect(page.getByTestId('game-result')).toContainText('protagonists-won-loop');
    await expect(page.getByTestId('game-clock')).toHaveText('1 / 3轮回4 / 4日');
    await expect(page.getByTestId('choice-submit')).toHaveCount(0);
    await expect(page.getByTestId('public-log')).toContainText('预定事件未发生：医院事故');
    await expect(page.getByTestId('public-log')).toContainText('预定事件未发生：自杀');
    await auditIds(page);
    await testInfo.attach('final-board', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    expect(problems).toEqual([]);
  } finally {
    await testInfo.attach('gui-actions', {
      body: JSON.stringify(actions, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('browser-problems', {
      body: JSON.stringify(problems, null, 2),
      contentType: 'application/json',
    });
  }
});

test('Reset can be cancelled; confirmed reset returns to initial state', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const revision = await page.getByTestId('game-status').getAttribute('data-revision');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('game-reset').click();
  await expect(page.getByTestId('game-status')).toHaveAttribute('data-revision', revision!);
  await reset(page);
  await expect(page.getByTestId('counter-doctor-goodwill')).toHaveText('友好 0');
  await expect(page.getByTestId('game-result')).toHaveCount(0);
  await page.getByTestId('seat-selector').selectOption('mastermind');
  await ready(page);
  await expect(page.getByTestId('character-doctor')).toContainText('关键人物');
  await page.getByTestId('seat-selector').selectOption('protagonistA');
  await ready(page);
  await expect(page.getByTestId('character-doctor')).not.toContainText('关键人物');
  await auditIds(page);
});

test('Connection error exposes named retry control and recovers', async ({ page }) => {
  // Deliberate transport failure, not part of the real-engine happy path.
  await page.route('**/api/state?*', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '无法连接游戏' })).toBeVisible();
  await auditIds(page);
  await page.unroute('**/api/state?*');
  await page.getByTestId('connection-retry').click();
  await ready(page);
  await expect(page.getByTestId('game-phase')).toHaveText('开局');
});
