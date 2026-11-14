import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  fixtures,
  generate,
  verify,
  hash,
  type History,
} from '../../tests/engine/official-harness.js';
const out = 'products/engine/tutorials';
mkdirSync(out, { recursive: true });
const histories: History[] = [];
for (const f of fixtures)
  for (const aggressive of [false, true]) {
    const h = generate(f, aggressive, f.setup.module === 'HSA' && aggressive ? 2 : 1);
    assert.equal(h.winner, aggressive ? 'mastermind' : 'protagonists', f.id);
    // Check the complete trace under different execution chunk sizes before accepting a baseline.
    for (const budget of [1, 7, 10000]) verify(h, budget, true);
    histories.push(h);
    console.log(`${h.scenario} ${h.winner}: ${h.steps.length} commands verified`);
  }
writeFileSync(`${out}/histories.json`, JSON.stringify(histories, null, 2) + '\n');
writeFileSync(
  `${out}/verification.json`,
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      fixturesHash: hash(fixtures),
      historiesHash: hash(histories),
      modules: fixtures.length,
      games: histories.length,
      commands: histories.reduce((n, h) => n + h.steps.length, 0),
      budgets: [1, 7, 10000],
      views: ['mastermind', 'p0', 'p1', 'p2', 'protagonists'],
      humanAcceptance: '待人类验收',
    },
    null,
    2,
  ) + '\n',
);
const esc = (s: unknown) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
writeFileSync(
  `${out}/index.html`,
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>官方剧本完整对局与确定性验证</title><style>body{font:16px/1.7 system-ui;margin:40px auto;max-width:1200px;padding:0 24px;color:#20332f;background:#f4f7f5}table{border-collapse:collapse;width:100%;background:white}td,th{padding:12px;text-align:left;border:1px solid #d3dfd9}h1{font-size:28px}code{background:#e5ece8;padding:3px}a{color:#006b59}.note{padding:18px;background:#fff4cf}small{color:#53655d}</style><h1>官方剧本完整对局与确定性验证</h1><p>8 个模组、16 条完整历史，均从合法初始配置开始，通过公开命令入口执行到胜负结算。每个模组包含主人公胜利和剧作家胜利。胜负为定向测试路线；不是双方最优策略证明。</p><table><thead><tr><th>模组 / 剧本</th><th>主人公胜利</th><th>剧作家胜利</th><th>配置来源</th></tr></thead><tbody>${fixtures
    .map((f) => {
      const hs = histories.filter((h) => h.scenario === f.id);
      return `<tr><td>${f.id}<br>${esc(f.title)}</td>${hs.map((h) => `<td>${h.steps.length} 条命令<br>第 ${h.loop} 轮，第 ${h.day} 天<br>${h.incidents.length} 次事件</td>`).join('')}<td><a href="${esc((f.source as { url: string }).url)}">来源</a></td></tr>`;
    })
    .join(
      '',
    )}</tbody></table><h2>验证范围</h2><p>逐步比较完整引擎状态 SHA-256，以及剧作家、三位主人公和主人公共享视图。执行预算为 1、7、10000；在决策边界和内部暂停点进行 JSON 保存与恢复；验证输入不被修改、命令重试不产生重复效果。另由回归测试验证标准 replay / runBatch API 和被篡改历史的拒绝。</p><p>相同结果的前提：相同规则包摘要、初始配置、LL 秘密座位分配、行动顺序及命令。规则升级时须审阅基线差异，不能自动将旧历史当成新版本真值。</p><h2>来源与版本</h2><p>官方身份由本地 Wiki 官方目录核对；配置沿其链接的剧本数据库读取，LL 使用规则手册第 18 页链接的官方样本英译文档。不是所有资料都由发行方直接托管。FS 已对照官方体验版剧本图核对。MZ 的数据库误将职员自白写为第 4 天；依据 Midnight Circle 发行方手册第 6 页改为第 3 天。AHR 采用数据库的 3 轮版本，本地目录同时列出 4/3 轮。所有测试不叠加十周年增量规则。BTX Plus 为独立组合模组，当前引擎 Module 契约不包含它，未冒充 BTX 覆盖。</p><div class="note">本验证证明这些历史可运行且可重放；不证明所有可能行动组合或全部规则语义均正确。无 Web GUI 自动验收；图文与规则人工验收：待人类验收。测试文件含完整秘密配置和动作，应仅用于测试、维护和全知复盘。</div><h2>复现与证据</h2><p><code>pnpm check:engine</code> 运行全部内核回归（包含本组固定历史）；<code>pnpm exec tsx scripts/engine/official-report.ts</code> 在明确审阅更新后重建历史与报告。</p><p><a href="histories.json">16 条完整历史与逐步指纹</a> · <a href="verification.json">验证元数据</a> · <a href="../../../../tests/engine/fixtures/official-scenarios.json">可执行剧本配置</a></p><p><small>运行环境：${esc(process.version)} / ${esc(process.platform)}。未经跨操作系统实测；CI 可使用同一基线检查。生成日期按 verification.json UTC 时间记录。</small></p><p>验收证据：<a href="acceptance.json">测试与报告页面检查记录</a> · <a href="engine-test.log">内核测试日志</a> · <a href="sources/manifest.json">来源文件与固定版本哈希</a>。验收记录须与当前 historiesHash 匹配。sources/ 内为正式复现证据；离线来源转换工具为 scripts/engine/prepare-official-fixtures.mjs。</p></html>`,
);
