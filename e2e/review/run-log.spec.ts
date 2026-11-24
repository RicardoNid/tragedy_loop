import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function downloadRun(page: import('@playwright/test').Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

async function start(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('region', { name: '解空间3', exact: true }).getByRole('table')).toHaveCount(4);
  await expect(page.getByRole('region', { name: '解空间', exact: true }).getByRole('table')).toHaveCount(3);
}

test('each run retains engine and both solver inputs and outputs after reload', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await start(page);
  await page.reload();
  const first = await downloadRun(page, '导出最近诊断（含剧透）');
  expect(first.version).toBe(2);
  expect(first.engine.choices.map((c: any) => c.choice.kind)).toEqual(['start', 'continue']);
  expect(first.calls.find((c: any) => c.method === 'create').engine.setup).toEqual(first.engine.setup);
  const command = first.calls.find((c: any) => c.method === 'submit' && c.input[2].choice.kind === 'start');
  expect(command.input[1]).toBe('p0');
  expect(command.output.phase).toBe('discussion');
  expect(command.engine.choices).toHaveLength(1);
  for (const method of ['knowledge', 'solution3']) {
    const call = first.calls.filter((c: any) => c.method === method && c.output?.status !== 'waiting').at(-1);
    expect(call.solverInput.opening).toBeDefined();
    expect(call.solverInput.opening.secret).toBeUndefined();
    expect(call.inputMatchesOutput).toBe(true);

    if (method === 'knowledge') {
      expect(call.solverInputMode).toBe('full-history-replay');
      expect(call.solverInput.history.length).toBe(call.output.evidenceThrough);
    } else {
      expect(call.solverInputMode).toBe('public-view');
      expect(call.solverInput.current.secret).toBeUndefined();
      expect(call.output.rows.length).toBeGreaterThan(0);
      expect(call.output.work.configurations).toBe(0);
    }
  }
  await start(page);
  await page.reload();
  const second = await downloadRun(page, '导出最近诊断（含剧透）');
  expect(second.id).not.toBe(first.id);
  await page.getByText('本地运行记录（含剧透）', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '已保存的运行' }).locator('option')).toHaveCount(2);
  await page.getByRole('combobox', { name: '已保存的运行' }).selectOption(first.id);
  const old = await downloadRun(page, '导出所选运行记录');
  expect(old.id).toBe(first.id);
  expect(old.calls).toEqual(first.calls);
});

test('failed creation is saved as a separate failed run', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.getByText('导入测试剧本', { exact: true }).click();
  await page.getByRole('textbox', { name: '剧本 JSON' }).fill(JSON.stringify({ module: 'invalid' }));
  await page.getByRole('button', { name: '校验并开局' }).click();
  await expect(page.getByRole('status').first()).not.toHaveText('正在更新盘面…');
  await expect(page.getByRole('status').first()).not.toHaveText('');
  await page.reload();
  const log = await downloadRun(page, '导出最近诊断（含剧透）');
  expect(log.calls).toHaveLength(1);
  expect(log.calls[0].method).toBe('create');
  expect(log.calls[0].input[0].module).toBe('invalid');
  expect(log.calls[0].error).toBeTruthy();
});

test('storage failure is visible and pending records recover on the next write', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).failRunStorage = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if ((window as any).failRunStorage) throw new DOMException('test quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '新建 FS 测试对局' }).click();
  await expect(page.getByRole('status').first()).toContainText('运行记录保存失败');
  await page.evaluate(() => { (window as any).failRunStorage = false; });
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.reload();
  const log = await downloadRun(page, '导出最近诊断（含剧透）');
  expect(log.calls.filter((c: any) => c.method === 'create')).toHaveLength(1);
  expect(log.calls.filter((c: any) => c.method === 'submit')).toHaveLength(1);
  expect(log.engine.choices).toHaveLength(1);
});

test('version one local records remain exportable after database upgrade', async ({ page }) => {
  await page.goto(process.env.REVIEW_FILE_UI ?? '/');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('tragedy-review-log', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' }).createIndex('updated', 'updated');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('games', 'readwrite');
      tx.objectStore('games').put({ id: 'legacy-run', updated: 1, engine: { setup: { module: 'FS' } },
        checkpoints: [], calculations: [], passes: { 1: { status: 'exact' } } });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  const log = await downloadRun(page, '导出最近诊断（含剧透）');
  expect(log.id).toBe('legacy-run');
  expect(log.passes['1'].status).toBe('exact');
  expect(log.calls).toEqual([]);
});
