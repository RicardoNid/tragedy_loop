import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser } from '@playwright/test';
import { makeDecisionServer } from '../apps/server/src/decision/server.js';
import type { PolicyNode } from '../packages/contracts/src/decision.js';
import { exportObservation } from '../scripts/engine/observed-game.js';
import type { CandidateReplay } from '../scripts/engine/candidate-replays.js';

let server: Awaited<ReturnType<typeof makeDecisionServer>>;
let browser: Browser;
let url: string;
const results = new URL('../test-results/decision-workbench/', import.meta.url);

test('浏览器展示完整日末的公开范围和一个被排除的假设组合', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: /两人独处的日末/ }).click();
    await page.getByText('日末静默排除 8 条历史').click();
    await expect(page.getByText(/观察 24 至 25/)).toBeVisible();
    await expect(page.getByText(/排除示例.*杀人狂/)).toBeVisible();
  } finally {
    await page.close();
  }
});

test('载入已经答对医生身份的观察，展示排除剧本数与对应观察序号', async () => {
  const input = JSON.parse(
    await readFile(
      new URL('../products/engine/final-decision-example.json', import.meta.url),
      'utf8',
    ),
  );
  const c: CandidateReplay = input.candidates[0];
  c.choices.push({
    actor: 'p0',
    choice: { kind: 'guess', character: 'doctor', identity: '传谣人' },
  });
  const evidence = exportObservation(c);
  const source = {
    evidence,
    setups: input.candidates.map((entry: CandidateReplay) => entry.setup),
    exhaustiveSetups: true,
  };
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: '导入问题' }).click();
    await page.getByRole('textbox', { name: 'JSON 内容' }).fill(JSON.stringify(source));
    await page.getByRole('button', { name: '载入问题' }).click();
    await page.getByText('剧本剪枝依据（1）').click();
    await expect(page.getByText(/历史重放前排除 1 个剧本/)).toBeVisible();
    await expect(page.getByText(/观察 \d+ · 最终决战身份裁定/)).toBeVisible();
  } finally {
    await page.close();
  }
});
before(async () => {
  server = await makeDecisionServer();
  url = await server.listen({ host: '127.0.0.1', port: 0 });
  const executablePath = [
    process.env.DECISION_TEST_BROWSER,
    '/opt/google/chrome/chrome',
    process.env['ProgramFiles(x86)'] + '/Microsoft/Edge/Application/msedge.exe',
  ].find((path) => path && existsSync(path));
  browser = await chromium.launch({ executablePath, headless: true });
  await mkdir(results, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
const post = (body: unknown, headers = {}) =>
  fetch(url + '/api/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('工作台调查可结合职员公告确定当事人，零次发动时保留两种答案', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: /职员的证言/ }).click();
    await expect(page.getByRole('combobox', { name: '调查对象' })).toHaveValue(
      JSON.stringify({ kind: 'culprit', day: 2 }),
    );
    await page.getByRole('button', { name: '求解调查' }).click();
    await expect(page.getByText('当前 2 种答案 · 这条路线最坏剩 1 种')).toBeVisible();
    await expect(page.getByRole('heading', { name: '职员发动公开身份' })).toBeVisible();
    await page.locator('.investigation summary').first().click();
    await page.getByRole('button', { name: '查看调查应对' }).first().click();
    await expect(page.getByText(/结束调查后仍可能是/)).toBeVisible();
    await page.getByRole('spinbutton', { name: '调查发动上限' }).fill('0');
    await page.getByRole('button', { name: '求解调查' }).click();
    await expect(page.getByText('当前 2 种答案 · 这条路线最坏剩 2 种')).toBeVisible();
  } finally {
    await page.close();
  }
});

test('本地服务仅导出公开局面，计算不阻塞读取，同一时间只执行一项计算', async () => {
  const q = { mode: 'solve', scenario: 'game-policy' };
  const [a, b, catalog] = await Promise.all([post(q), post(q), fetch(url + '/api/scenarios')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 503]);
  assert.equal(catalog.status, 200);
  const solved = await (a.status === 200 ? a : b).json();
  assert.equal(solved.advice.status, 'guaranteed');
  assert.equal(solved.worlds, 2);
  assert.doesNotMatch(
    JSON.stringify(solved),
    /"initialIdentity"|"ruleDigest"|"receipts"|"mastermind-\d+"|"hostWitness"/,
  );
  assert.equal((await post({ ...q, scenario: 'missing' })).status, 422);
  assert.equal((await post({ ...q, workLimit: 1000001 })).status, 422);
  assert.equal((await post(q, { origin: 'https://example.invalid' })).status, 403);
});

test('桌面从真实 FS 盘面取得出牌、下载策略、独立复核；修改目标后展示公开败局', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: '求解策略' }).click();
    await expect(page.getByRole('heading', { name: '对学校使用禁止密谋' })).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载策略' }).click();
    const download = await downloading;
    const plan: PolicyNode = JSON.parse(await readFile((await download.path())!, 'utf8'));
    assert.equal(plan.choice.kind, 'cards');
    await page.getByRole('button', { name: '独立复核', exact: true }).click();
    await expect(page.getByText('策略通过复核')).toBeVisible();
    await expect(page.getByText(/56 个已验证达标分支/)).toBeVisible();
    await page.screenshot({ path: fileURLToPath(new URL('desktop.png', results)), fullPage: true });
    plan.choice = { kind: 'cards', placements: [{ card: 'p2-7', target: 'hospital' }] };
    await page.getByRole('button', { name: '导入策略复核' }).click();
    await page.getByRole('textbox', { name: 'JSON 内容' }).fill(JSON.stringify(plan));
    await page.getByRole('button', { name: '载入策略' }).click();
    await expect(page.getByText('发现反例')).toBeVisible();
    await page.getByText(/查看反例 · 第/).click();
    await expect(page.locator('.verdict pre')).toContainText('victory');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('窄屏加载有限域医院事故、下钻策略并回退，预算耗尽保持未判定', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: /医院事故前夕/ }).click();
    await expect(page.getByText('生成剧本')).toBeVisible();
    await page.getByRole('button', { name: '求解策略' }).click();
    await expect(page.getByRole('heading', { name: '医生发动调整不安' })).toBeVisible();
    await page.locator('.branches summary').first().click();
    await page.getByRole('button', { name: '查看应对' }).first().click();
    await expect(page.getByText('后续行动', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(page.getByRole('heading', { name: '医生发动调整不安' })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: fileURLToPath(new URL('mobile.png', results)), fullPage: true });
    await page.getByRole('spinbutton', { name: '正向预算' }).fill('0');
    await page.getByRole('button', { name: '求解策略' }).click();
    await expect(page.getByText('尚无法判定')).toBeVisible();
    await expect(page.getByRole('button', { name: '下载策略' })).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test('导入实际 LL 问题、读取本人 Ex、正确处理非法 JSON 及无保证的最终决战', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '公开盘面' })).toBeVisible();
    await page.getByRole('button', { name: '导入问题' }).click();
    await page.getByRole('textbox', { name: 'JSON 内容' }).fill('{');
    await page.getByRole('button', { name: '载入问题' }).click();
    await expect(page.getByRole('alert')).toContainText('JSON');
    await page.locator('input[type=file]').setInputFiles({
      name: '个人问题.json',
      mimeType: 'application/json',
      buffer: await readFile(
        new URL('../products/engine/seat-policy-example.json', import.meta.url),
      ),
    });
    await page.getByRole('button', { name: '载入问题' }).click();
    await expect(page.getByText(/Ex C/)).toBeVisible();
    await page.getByRole('button', { name: '求解策略' }).click();
    await expect(page.getByText('存在保证策略')).toBeVisible();
    await page.getByRole('button', { name: /交换身份的嫌疑人/ }).click();
    await page.getByRole('button', { name: '求解策略' }).click();
    await expect(page.getByText('没有保证策略')).toBeVisible();
  } finally {
    await page.close();
  }
});
