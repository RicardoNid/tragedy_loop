import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { faq, checkSources } from './source-check.js';
import {
  inherited,
  nonRuntime,
  unsupported,
  manual,
  limits,
} from '../../tests/comprehensive/faq-policy.js';
const read = (p: string) => JSON.parse(readFileSync(`products/comprehensive/${p}`, 'utf8'));
const results = read('cases.json') as {
  id: string;
  faq: number[];
  title: string;
  status: string;
  error?: string;
  ms: number;
}[];
const verification = read('verification.json') as {
  completedAt: string;
  checks: { name: string; status: string; log: string; ms: number }[];
};
const stress = read('stress.json');
const engineLog = readFileSync('products/comprehensive/engine-regression.txt', 'utf8');
const source = checkSources();
const escape = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const aliases: Record<string, string> = {
  passed: '关联断言通过',
  partial: '部分覆盖',
  nonruntime: '非引擎问答',
  unsupported: '不支持的特规',
  manual: '待人类验收',
  failed: '测试失败',
  missing: '未关联用例',
};
const rows = faq.map((q, i) => {
  const links = results.filter((r) => r.faq.includes(i));
  const old = inherited.filter((r) => r.faq.includes(i));
  for (const t of old)
    assert.ok(engineLog.includes(`# Subtest: ${t.test}`), `Missing inherited test ${t.test}`);
  let status = links.length || old.length ? 'passed' : 'missing';
  if (nonRuntime.includes(i)) status = 'nonruntime';
  if (unsupported.includes(i)) status = 'unsupported';
  if (manual.includes(i)) status = 'manual';
  if (limits[i] && status === 'passed') status = 'partial';
  if (
    links.some((t) => t.status === 'failed') ||
    (old.length &&
      !verification.checks.some((c) => c.name === 'engine-regression' && c.status === 'passed'))
  )
    status = 'failed';
  return {
    ...q,
    index: i,
    status,
    cases: links.map((r) => r.id),
    inherited: old.map((t) => t.test),
    note:
      limits[i] ??
      (status === 'unsupported'
        ? '严格契约拒绝任意自定义特殊规则；未实现文本规则解释器。'
        : status === 'nonruntime'
          ? '已核对本地问答及出处；属于开局约定、资料、实体组件或趣味说明。未验证外部群号、密码、购物或现行服务。'
          : '通过所关联用例的明确断言；不等于穷举该问答的所有合法剧本与状态。'),
  };
});
assert.ok(
  rows.every((r) => r.status !== 'missing'),
  'Every FAQ must have an explicit disposition',
);
assert.equal(new Set(results.map((r) => r.id)).size, results.length, 'Duplicate test id');
for (const r of results) for (const i of r.faq) assert.ok(faq[i], `Bad FAQ index ${i}`);
writeFileSync('products/comprehensive/faq-results.json', JSON.stringify(rows, null, 2) + '\n');
const counts = Object.fromEntries(
  Object.keys(aliases).map((k) => [k, rows.filter((r) => r.status === k).length]),
);
const defects: [string, string, string][] = [
  ['幻想版图禁止友好', '时间旅者幻想错误忽略版图上的禁止友好', 'illusion-board-block'],
  ['尸体忍者公开', '尸体仍可谎报身份', 'death-reveal-ninja'],
  ['模仿犯身份通知', '错误包含模仿犯自己', 'copycat-reveal'],
  ['未登场角色保密', '首次登场前泄露神灵等角色', 'projection-arrival'],
  ['傀儡班长回收牌', '剧作家使用班长时无法回收自己的绝望牌', 'class-puppet-despair'],
  ['鉴别员移交指示物', '可选择不存在的指示物规避必须移动', 'appraiser-empty'],
  ['黑猫事件EX', '错误套用银色子弹0／猎奇杀人2的特殊增量', 'black-cat-events'],
  ['事件首次发生', '不同日期同名事件错误共用首次发生记录', 'once-scheduled-incident'],
  ['模仿犯制作限制', '错误豁免剧本身份的属性限制', 'setup-copycat-attributes'],
  ['捏造秘密与局外人', '追加身份错误占用局外人的可分配身份池', 'setup-secret-addition'],
  ['局外人因果残片', '错误允许直接取得周年追加身份', 'plus-fragment-allocation'],
  ['虚幻世界移除角色', '错误统计不在场强迫症', 'virtual-world'],
  ['大人物鬼魂', '尸体仍可借用领地特性', 'boss-ghost'],
  ['存活丧尸', '局外人丧尸未计入优势判定', 'living-zombie'],
  ['AI调用封锁', '仅调用效果也错误封锁版图', 'ai-forged'],
  ['封锁公开通知', '主人公未收到被封锁区域', 'lockdown-moves'],
  ['大人物条件判断', '只按实际位置判断强制能力，漏掉领地的合法发动', 'boss-serial'],
  ['大人物移动与从者', '相邻目的地和跟随起点错误使用实际位置', 'boss-coward-servant'],
  ['亵渎杀人空分支', '无可杀目标仍能选择杀人分支规避放密谋', 'desecration-no-target'],
  ['伪装自杀与EX牌', '其他效果放置的EX牌未禁止主人公行动牌', 'fake-suicide-ex'],
  ['大人物邪教徒', '取消禁止密谋时丢失所选择的领地', 'cultist-virtual-area'],
  ['大人物侦探', '缺少以领地触发事件的选择', 'boss-detective'],
];
for (const d of defects)
  assert.ok(
    results.some((r) => r.id === d[2]),
    `Missing regression ${d[2]}`,
  );
const summary = {
  faq: source.count,
  counts,
  targeted: { total: results.length, passed: results.filter((r) => r.status === 'passed').length },
  stress,
  defects: defects.map(([title, problem, test]) => ({
    title,
    problem,
    test,
    status: results.find((r) => r.id === test)!.status,
  })),
  humanAcceptance: 'pending',
};
writeFileSync('products/comprehensive/summary.json', JSON.stringify(summary, null, 2) + '\n');
const stats = [
  ['FAQ来源完整性', `${source.count}/${source.count}`],
  ['定向用例', `${summary.targeted.passed}/${results.length}`],
  ['完整对局／输入', `${stress.games} / ${stress.commands}`],
  ['角色组合／计数向量', `${stress.characterProfiles} / ${stress.counterVectors}`],
  [
    '缺陷回归',
    `${defects.filter((d) => results.find((r) => r.id === d[2])!.status === 'passed').length}/${defects.length}`,
  ],
];
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>规则与FAQ综合验收</title><style>
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#25313b;background:#f4f6f8;line-height:1.65}body{margin:0}main{max-width:1340px;margin:auto;padding:42px 28px}h1{font-size:32px;margin:0}h2{margin-top:36px;font-size:22px}p{max-width:1100px}a{color:#235a9b}small{color:#62717e}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.stat,section{background:#fff;border:1px solid #dce2e6;border-radius:10px;padding:18px}.stat b{display:block;font-size:25px}.notice{border-left:4px solid #c18b32;padding:12px 18px;background:#fff8e6}.toolbar{position:sticky;top:0;background:#f4f6f8;padding:12px 0;display:flex;gap:12px;z-index:2}input,select{padding:10px;border:1px solid #bcc8d0;border-radius:6px;font:inherit}input{flex:1}table{border-collapse:collapse;width:100%;background:#fff}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce2e6;padding:12px}th{background:#e8edf2}code{background:#eef2f5;padding:2px 5px;overflow-wrap:anywhere}details{margin:7px 0}summary{cursor:pointer}.tag{display:inline-block;border-radius:12px;padding:2px 9px;background:#e3f0e7;white-space:nowrap;font-size:13px}.partial,.manual,.unsupported{background:#fff0ce}.failed{background:#f9dcdc}.nonruntime{background:#e8edf2}.answer{white-space:pre-wrap}.faq-meta{font-size:13px;color:#62717e}.count{padding:10px}#faq td:first-child{width:110px}#faq td:last-child{width:30%}@media(max-width:800px){main{padding:24px 12px}.stats{grid-template-columns:repeat(2,1fr)}.toolbar{flex-wrap:wrap}th,td{padding:8px}#faq td:last-child{width:auto}table{font-size:14px}}
</style><main><small>TRAGEDY LOOP · 综合测试证据 · ${escape(verification.completedAt)}</small><h1>复合规则、特殊角色与全量 FAQ</h1><p>本次按当前只读 facts 快照测试。规则断言、完整对局重放、角色组合压力、公开视角与 UI 联调分别记录；所有结果可以用 <code>pnpm check:comprehensive</code> 重跑。</p><div class="stats">${stats.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
<p class="notice"><b>人类验收：待进行。</b>479 条问答全部核对来源并有处理结论，不能表述为“479 条规则语义全部通过”。任意文本特规仍不支持；讨论阶段角色摆放／显示时点待确认；部分 FAQ 仅覆盖关联边界。候选资料标注“待核定”的原始权威状态保留，不由测试结果提升。</p>
<h2>验证范围与复现</h2><section><p>定向测试使用隔离状态构造规则边界，其中部分角色身份组合并非完整合法剧本。64 局来自八模组有效剧本，每个剧本四个种子、两种策略，重新执行全部输入并比较状态及公开投影；这是确定性与流程证据，不能代替独立规则断言。6,993 个角色组合覆盖 14 个规则配置，测试能力流程的健壮性；没有声称穷举所有合法组合。</p><p>FAQ 映射由固定 ID 和内容哈希保护，顺序、内容或来源发生变化即失败。来源检查对全部实体问答和引用快照计算哈希，核对本轮开始／结束一致；不修改 facts、archive。编号使用固定的 <b>零起始索引</b>，另列永久 ID。</p><p>原有 1,140 个回放检查点经受限迁移核对：首次未登场保密只允许主人公投影的角色列表变化；虚幻世界修复只允许内容摘要变化，其他权威状态及视图必须一致。证据：<a href="projection-migration.json">投影迁移</a>、<a href="content-migration.json">内容摘要迁移</a>。未使用直接重录结果的方式接受任意差异。</p><p><a href="cases.json">定向断言结果</a> · <a href="stress.json">压力测试</a> · <a href="faq-results.json">逐条FAQ JSON</a> · <a href="verification.json">命令及源码哈希</a> · <a href="sources.json">只读来源校验</a></p></section>
<table><thead><tr><th>检查</th><th>结果</th><th>耗时</th><th>证据</th></tr></thead><tbody>${verification.checks.map((c) => `<tr><td>${escape(c.name)}</td><td>${escape(c.status)}</td><td>${Math.round(c.ms / 1000)} 秒</td><td><a href="${escape(c.log)}">日志</a></td></tr>`).join('')}</tbody></table>
<h2>修复与回归</h2><table><thead><tr><th>交互</th><th>发现的问题</th><th>回归用例</th></tr></thead><tbody>${defects.map(([t, p, id]) => `<tr><td>${t}</td><td>${p}</td><td><a href="#case-${id}">${id}</a></td></tr>`).join('')}</tbody></table>
<h2>全部 479 条 FAQ</h2><p>${Object.entries(counts)
  .filter(([, n]) => n)
  .map(([k, n]) => `${aliases[k]} ${n}`)
  .join(
    ' · ',
  )}</p><div class="toolbar"><input id="search" type="search" placeholder="搜索角色、规则、问题、答案、用例或 ID" aria-label="搜索FAQ"><select id="status" aria-label="筛选结果"><option value="">全部结果</option>${Object.entries(
  aliases,
)
  .map(([k, v]) => `<option value="${k}">${v}</option>`)
  .join('')}</select><span class="count" id="count">479 条</span></div>
<table id="faq"><thead><tr><th>编号／状态</th><th>问题与答案</th><th>验收依据</th></tr></thead><tbody>${rows.map((r) => `<tr data-status="${r.status}"><td><b>FAQ ${r.index}</b><br><span class="tag ${r.status}">${aliases[r.status]}</span></td><td><b>${escape(r.question)}</b><div class="answer">${escape(r.answer)}</div><details><summary>出处与身份</summary><div class="faq-meta">${escape(r.scope)} · ${escape(r.authority)}<br>ID: ${r.id}<br><a href="../../facts/${escape(r.path)}">本地实体</a>${r.faqSources.map((s) => `<br><a href="../../facts/${escape(s.snapshot ?? s.path)}">${escape(s.snapshot ?? s.path)}</a> ${escape(s.sheet ?? '')} ${s.row ? `第 ${s.row} 行` : ''}`).join('')}</div></details></td><td>${r.cases.map((id) => `<a href="#case-${id}">${escape(id)}</a>`).join('<br>')}${r.inherited.map((t) => `<details><summary>既有回归</summary>${escape(t)}</details>`).join('')}<p>${escape(r.note)}</p></td></tr>`).join('')}</tbody></table>
<h2>定向用例明细</h2>${results.map((r) => `<section id="case-${r.id}"><b>${escape(r.title)}</b> <span class="tag ${r.status}">${r.status}</span><br><code>${r.id}</code> · FAQ ${r.faq.join(', ')}${r.error ? `<pre>${escape(r.error)}</pre>` : ''}</section>`).join('')}
<p><small>本报告只作为工程验收证据。GUI 自动测试与人类视觉、规则体验验收分开；未发生人工确认。</small></p></main><script>const rows=[...document.querySelectorAll('#faq tbody tr')],search=document.querySelector('#search'),status=document.querySelector('#status');function filter(){const q=search.value.toLowerCase();let n=0;for(const row of rows){const show=(!status.value||row.dataset.status===status.value)&&row.textContent.toLowerCase().includes(q);row.hidden=!show;if(show)n++;}document.querySelector('#count').textContent=n+' 条';}search.addEventListener('input',filter);status.addEventListener('change',filter);</script></html>`;
writeFileSync('products/comprehensive/index.html', html);
console.log(
  JSON.stringify(
    {
      targeted: summary.targeted,
      faq: counts,
      checks: verification.checks.map((c) => [c.name, c.status]),
    },
    null,
    2,
  ),
);
if (rows.some((r) => r.status === 'failed')) process.exitCode = 1;
