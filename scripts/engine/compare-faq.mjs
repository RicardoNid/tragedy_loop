// Run with pnpm exec tsx scripts/engine/compare-faq.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { checkSources } from '../comprehensive/source-check.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = path.join(root, 'tests/comprehensive');
const units = ['cases', 'setup-cases', 'more', 'interactions', 'remaining', 'final-cases'];
const load = (dir, name) => import(pathToFileURL(path.join(dir, name + '.ts')).href);
async function run(dir) {
  for (const name of units) await load(dir, name);
  const { cases } = await load(dir, 'cases');
  return cases.map(({ id, title, faq, run }) => {
    try {
      run();
      return { id, title, faq, status: '通过' };
    } catch (error) {
      return { id, title, faq, status: String(error.message) };
    }
  });
}
const esc = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function checkCatalogs() {
  const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const modules = ['First Steps', 'Basic Tragedy X'];
  const items = json(path.join(root, 'facts/data/catalog.json')).items.filter((e) =>
    e.kind === 'characters' || (e.kind === 'modules' && modules.includes(e.title)) ||
    (modules.includes(e.scope) && ['rules', 'identities', 'incidents'].includes(e.kind)));
  const official = items.filter((e) => !e.tags.includes('民间'));
  const drafts = [];
  {
    const dir = root;
    const entries = json(path.join(dir, 'packages/content/src/official/source-catalog.json')).entries;
    for (const item of official) {
      const src = json(path.join(root, 'facts', item.path));
      const published = entries.find((e) => e.id === item.id);
      assert.deepEqual(published?.fields, src.fields, item.title + ' 字段不一致');
      if (dir === root) for (const [key, p] of Object.entries(src.provenance))
        if (p.status === 'draft_needs_human_review') drafts.push(item.title + ' / ' + key);
    }
    const { createCards } = await load(path.join(dir, 'packages/engine/src/runtime'), 'setup');
    const cards = createCards().filter((c) => c.owner === 'mastermind');
    const id = { move_vertical: 'vertical', move_horizontal: 'horizontal', move_diagonal: 'diagonal',
      paranoia_plus_1: 'paranoia+1', paranoia_minus_1: 'paranoia-1', forbid_paranoia: 'block-paranoia',
      forbid_goodwill: 'block-goodwill', intrigue_plus_1: 'intrigue+1', intrigue_plus_2: 'intrigue+2' };
    const hand = entries.find((e) => e.module === 'FS' && e.kind === 'modules').fields.mastermind_hand;
    assert.deepEqual(cards.map((c) => c.kind + '/' + c.once).sort(),
      hand.cards.flatMap((c) => Array(c.count).fill(id[c.id] + '/' + !!c.once_per_loop)).sort());
  }
  return '统一规则内容包与本地资料逐字段核对了 ' + official.length + ' 个官方条目。另有 ' +
    items.filter((e) => e.tags.includes('民间')).length + ' 张民间角色卡。资料中标为草稿的字段为 ' +
    drafts.join('、') + '。FS 剧作家手牌已逐张比较数量及每轮限次。';
}
const sourceCount = checkSources().count;
const catalog = await checkCatalogs();
const results = await run(sources);
const index = JSON.parse(readFileSync(path.join(sources, 'fixtures/faq-index.json'), 'utf8'));
const failures = results.filter((c) => c.status !== '通过');
const summary = '统一规则引擎通过 ' + (results.length - failures.length) + '/' + results.length;
const rows = results.map((c) => {
  const links = c.faq.map((n) => '<a href="../../facts/data/faq/' + esc(index[n].id) + '.json">' + n + '</a>');
  return '<tr><th>' + esc(c.title) + '</th><td>' + links.join('、') + '</td><td>' + esc(c.status) + '</td></tr>';
}).join('\n');
writeFileSync(path.join(root, 'products/engine/faq-engine-comparison.html'),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>统一规则引擎 FAQ 验收</title><style>body{font:16px/1.6 system-ui;margin:2em auto;padding:0 1em;max-width:78em}table{border-collapse:collapse}th,td{text-align:left;vertical-align:top;border:1px solid #bbb;padding:.45em;white-space:pre-line}thead{background:#edf5f0}</style><main><h1>统一规则引擎 FAQ 验收</h1><p>' +
  summary + '。求解器回放和对局使用本工作区相同的规则内核与内容包。</p><p>' + esc(catalog) + ' 已核对本地 ' + sourceCount +
  ' 条 FAQ 的来源；下表列出有定向断言的盘面。</p><table><thead><tr><th>测试盘面</th><th>FAQ 编号</th><th>实测结果</th></tr></thead><tbody>' + rows + '</tbody></table></main></html>');
console.log(summary);
if (failures.length) process.exitCode = 1;
