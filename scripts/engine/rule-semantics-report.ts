import { writeFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { officialModules, supportsAnniversary } from '../../packages/contracts/src/game.js';
import { absenceProgramIndex } from '../../packages/engine/src/absence/programs.js';
import { lifecycle } from '../../packages/engine/src/runtime/shared-lifecycle.js';

const packs = officialModules.flatMap((module) =>
  (supportsAnniversary(module) ? [false, true] : [false]).map((anniversary) => {
    const pack = compileOfficial(module, anniversary);
    return {
      module,
      anniversary,
      digest: pack.digest,
      setupRules: pack.setupRules,
      identities: Object.values(pack.identities).map((i) => ({
        name: i.name,
        source: i.source,
        culpritRequirement: i.culpritRequirement,
        ordinaryIncidentTrigger: i.ordinaryIncidentTrigger,
        sameAreaIncidentTrigger: i.sameAreaIncidentTrigger,
      })),
      incidents: Object.values(pack.incidents).map((i) => ({
        name: i.name,
        source: i.source,
        crowdThreshold: i.crowdThreshold,
      })),
      programs: absenceProgramIndex(pack).programs,
    };
  }),
);
const escape = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const payload = JSON.stringify({ packs, lifecycle }).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>求解器1规则语义统一</title>
<style>body{margin:0;background:#f4f7f5;color:#203b34;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1150px;margin:auto;padding:28px}h1{line-height:1.3}section,details{background:white;border:1px solid #cbded4;border-radius:10px;padding:16px;margin:14px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef4f0;padding:12px;max-height:480px;overflow:auto;font-size:13px}select,input,button{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}.toolbar{display:flex;gap:12px;flex-wrap:wrap}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #d8e4dc;text-align:left;vertical-align:top}.note{border-left:4px solid #bd8b32;padding-left:14px}a{color:#176747}small{color:#536f63}@media(max-width:600px){main{padding:16px}.toolbar>*{width:100%}}</style><main>
<h1>求解器1内部的规则语义统一</h1><p>规则结构沿用 <code>RuleProgram → Ability → Step → choices / condition / effects</code>。制作约束使用 <code>RulePack.setupRules</code>，常驻性质使用 traits。此页直接展示运行内容包中的结构，不以中文解释替代规则本体。</p>
<section><h2>本轮迁移</h2><div class="scroll"><table><tr><th>规则信息</th><th>统一声明</th><th>使用位置</th></tr>
<tr><td>副线数量、可少配身份、角色属性要求</td><td>setupRules</td><td>正向制作验证、反向初始域、穷举合法性筛选</td></tr>
<tr><td>身份必须／不得担任当事人</td><td>IdentityTraits.culpritRequirement</td><td>正向验证与反向事件日程约束；表里身份沿用豁免</td></tr>
<tr><td>群众事件的门槛</td><td>IncidentDefinition.crowdThreshold</td><td>正向触发和两种候选构造</td></tr>
<tr><td>普通公开事件触发模型的覆盖范围</td><td>IdentityTraits.ordinaryIncidentTrigger</td><td>反向快速路径；未声明或有特殊同区触发条件时保留完整核验</td></tr>
<tr><td>阶段能力与事件步骤</td><td>原始 Ability / Step 对象</td><td>来源索引保留同一规则本体，不另外维护效果正文</td></tr></table></div>
<p><code>ordinaryIncidentTrigger</code> 是快速路径覆盖声明，不是新规则操作码，也不能替代触发条件。</p></section>
<section><h2>验证与复现</h2><p><code>pnpm check:engine</code> 包含声明变更测试、正向验证与两种构造器的完整集合对照。<code>pnpm report:timeline</code> 在每个共同公开前缀比较原逐条、节点调度和独立穷举。</p><p><a href="timeline-audit.html">打开时间节点完整解集报告</a>。该报告的源指纹与完成状态独立保存；测试数量和当前运行结果以该次执行为准。</p><p>重建本页：<code>pnpm exec tsx scripts/engine/rule-semantics-report.ts</code>。</p></section>
<h2>当前声明与能力本体</h2><div class="toolbar"><select id="pack" aria-label="内容包">${packs.map((p, i) => `<option value="${i}">${p.module}${p.anniversary ? ' 周年' : ' 基础'}</option>`).join('')}</select><input id="query" placeholder="搜索归属、时点或规则" aria-label="搜索规则"><button id="download">下载规则结构 JSON</button></div><div id="content"></div>
<h2>尚未覆盖的宿主语义</h2><p class="note">以下生命周期元数据仍由宿主适配器执行，尚未完整迁移成带宿主绑定的 Ability 程序；本轮不宣称它们已经统一。迁移时需补充读取时点、跨轮快照含义及独立回归，不能将其伪装成已有操作码。</p>
<details><summary>现有生命周期元数据</summary><pre>${escape(JSON.stringify(lifecycle, null, 2))}</pre></details>
<p>其中跨轮友好应读取上一轮结束且尚未清盘的有效友好；身份公开状态跨轮保留。开局区域选择、学者指示物、临时工日末死亡、身份转变等宿主流程仍需逐项整理。这里仅记录边界。</p>
<p><small>自动检查不能替代人工规则验收；人工验收：待确认。</small></p></main><script id="data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('data').textContent);const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function show(){const p=data.packs[Number(document.getElementById('pack').value)],q=document.getElementById('query').value.trim();const items=p.programs.filter(x=>JSON.stringify(x).includes(q));document.getElementById('content').innerHTML='<details><summary>制作约束与 traits</summary><pre>'+esc(JSON.stringify({setupRules:p.setupRules,identities:p.identities,incidents:p.incidents,digest:p.digest},null,2))+'</pre></details><p>显示 '+items.length+' / '+p.programs.length+' 条能力程序</p>'+items.map(x=>'<details><summary>'+esc(x.owner+' · '+x.id+' · '+x.timing)+'</summary><pre>'+esc(JSON.stringify(x,null,2))+'</pre></details>').join('')}
document.getElementById('pack').onchange=show;document.getElementById('query').oninput=show;document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='solver1-rule-semantics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};show();
</script></html>`;
writeFileSync('products/engine/rule-semantics.html', html);
console.log(
  `${packs.length} content configurations; ${packs.reduce((n, p) => n + p.programs.length, 0)} native programs. Lifecycle gaps explicitly listed.`,
);
