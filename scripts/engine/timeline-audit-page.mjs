const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function renderTimeline(data) {
  const scenarios = data.scenarios.filter((s) => s.nodes),
    nodes = scenarios.flatMap((s) => s.nodes);
  const total = (key) => nodes.reduce((n, r) => n + (r.work[key]?.expansions ?? 0), 0);
  const base = nodes.reduce((n, r) => n + r.work.exhaustive, 0),
    work = total('nodeExact');
  const originalWork = total('originalExact');
  const labels = {
    initial: '初始域',
    entry: '阶段入口',
    evidence: '公开证据',
    'phase-end': '阶段内结算完成',
  };
  const stageRows = data.phaseCatalog
    .map((p) => {
      const n = nodes.filter((n) => n.phase === p.id);
      return `<tr><th>${esc(p.name)}<small>${p.id}</small></th><td>${esc(p.reduce)}</td><td>${esc(p.skip)}</td><td>${esc(p.close)}</td><td>${p.id === 'briefing' ? scenarios.filter((s) => s.briefing === 'waiting').length + ' 次等待检查' : n.length + ' 个节点<br>' + n.filter((x) => x.before > x.after).length + ' 次缩减'}</td></tr>`;
    })
    .join('');
  const costRows = data.phaseCatalog
    .filter((p) => p.id !== 'briefing')
    .map((p) => {
      const rows = nodes.filter((n) => n.phase === p.id);
      const sum = (fn) => rows.reduce((n, row) => n + fn(row), 0).toLocaleString();
      return `<tr><th>${esc(p.name)}</th><td>${rows.length}</td><td>${sum((r) => r.before - r.after)}</td><td>${sum((r) => r.work.originalLocal.checks)} / ${sum((r) => r.work.nodeLocal.checks)}</td><td>${sum((r) => r.work.originalExact.expansions)} / ${sum((r) => r.work.nodeExact.expansions)}</td><td>${sum((r) => r.work.exhaustive)}</td></tr>`;
    })
    .join('');
  const scenarioRows = scenarios
    .map(
      (s) =>
        `<tr><th>${esc(s.name)}</th><td>${s.domain.length} → ${s.nodes.at(-1)?.after ?? '—'}</td><td>${s.nodes.filter((n) => n.before > n.after).length}</td><td>${s.nodes.length}</td><td>${s.initialDomainAgreement ? (s.initialDomainAgreement.missing.length + s.initialDomainAgreement.extra.length ? '有差异' : '两个初始域一致') : '待核对'}</td><td>${esc(s.status)}</td></tr>`,
    )
    .join('');
  const focusedRows = scenarios
    .filter((s) => s.focus)
    .map((s) => {
      const rows = s.nodes.filter((n) => n.phase === s.focus || n.closed === s.focus);
      const checks = rows.reduce((sum, n) => sum + n.work.originalLocal.checks, 0);
      return `<tr><th>${esc(s.name)}</th><td>${rows[0]?.before ?? '—'} → ${rows.at(-1)?.after ?? '—'}</td><td>${checks}</td><td>${checks ? '存在相关候选，执行核验' : '公开结算跳过约束检查'}</td><td>${s.nodes.at(-1)?.after ?? '—'}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>解空间时间节点核查</title>
<style>
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#18302d;background:#f3f6f4;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:32px;line-height:1.25}h2{font-size:23px;margin-top:38px}h3{margin:12px 0}p{max-width:1100px}small{display:block;color:#58706a;font-weight:normal}.tag{font-size:12px;letter-spacing:2px;color:#357766}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,section.panel{background:white;border:1px solid #d4e2db;border-radius:12px;padding:18px}.card b{display:block;font-size:28px;color:#1c6955}.good{color:#176b4b}.bad{color:#ac352b}.muted{color:#59726b}.warn{background:#fff4dc;padding:14px;border-left:4px solid #ba8b25}.scroll{overflow:auto;background:#fff;border:1px solid #d4e2db;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px 14px;border-bottom:1px solid #e4ebe7;text-align:left;vertical-align:top}thead{background:#e6f0ea}th{min-width:130px}tbody tr:hover{background:#f3f9f5}button,select,input{font:inherit;padding:9px 12px;border:1px solid #a9c4b6;border-radius:7px;background:white;color:inherit}button{cursor:pointer}button:hover{background:#e6f3eb}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:18px 0}.toolbar label{display:flex;gap:6px;align-items:center}a{color:#176a55}details{margin:8px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;padding:14px;background:#edf3ef;max-height:440px;overflow:auto}.count{font-variant-numeric:tabular-nums;white-space:nowrap}.timeline th{min-width:90px}.timeline td{max-width:280px}.timeline .rowdetail td{max-width:none;background:#fbfdfb}.check{font-size:12px;white-space:nowrap}@media(max-width:800px){main{padding:18px}.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:27px}.toolbar{align-items:stretch}.toolbar>*{max-width:100%}}@media print{.toolbar,button{display:none}.scroll{overflow:visible}.cards{break-inside:avoid}main{padding:0}}
.toolbar label{min-width:0;max-width:100%}.toolbar select{min-width:0;max-width:100%;flex:1}.scroll{max-width:100%}
</style><main><div class="tag">TRAGEDY LOOP · SOLVER AUDIT</div><h1>按时间节点检查解空间</h1>
<p>同一条公开历史，同时对比<strong>原流程逐条处理</strong>、<strong>阶段节点批量处理</strong>与<strong>完整穷举</strong>。阶段节点策略保留阶段内全部观察及其原始顺序，只改变提交时机；没有丢弃阶段中的信息，也没有更换游戏规则。</p>
<div class="cards"><div class="card"><b>${scenarios.filter((s) => s.status === 'complete').length}</b>完成样本 / ${data.scenarios.length} 个已尝试样本</div><div class="card"><b>${nodes.length}</b>共同前缀检查点</div><div class="card"><b>${data.findings.length}</b>当前未通过记录</div><div class="card"><b>${base ? ((1 - work / base) * 100).toFixed(1) + '%' : '—'}</b>节点策略历史展开较穷举减少</div></div>
<p class="${data.status === 'complete' ? 'good' : 'warn'}">状态：${esc(data.status)}。${data.status === 'complete' ? '已完成所列样本的对照。' : '当前报告有未完成任务或差异，请查看下方记录；不能视为全部通过。'} 完成时间：${esc(data.completedAt ?? '运行中')}。</p>
<p>累计历史展开：原流程 <strong>${originalWork.toLocaleString()}</strong>，节点策略 <strong>${work.toLocaleString()}</strong>，穷举 <strong>${base.toLocaleString()}</strong>。节点策略较原流程${work <= originalWork ? '减少' : '增加'} ${Math.abs(originalWork - work).toLocaleString()} 步${originalWork ? '（' + ((Math.abs(originalWork - work) / originalWork) * 100).toFixed(1) + '%）' : ''}；这是共同检查点上的审计成本，不是游戏运行帧率。</p>
<h2>对比口径</h2><section class="panel"><ul>
<li><strong>原流程</strong>指工作区生产求解器逐条接收观察的流程；本轮保留其结构化剪枝逻辑，仅修正发现的穷举参照错误。源文件指纹保存在证据中，不以 Git 中可能更旧的版本为基准。</li>
<li><strong>时间节点</strong>包括阶段入口、阶段内最后一批结算、发生／无现象／失败／正式披露，以及终局。下一阶段入口另列，以观察前一窗口闭合产生的排除。</li>
<li><strong>终局猜测要收齐同次操作</strong>：结果记录先于己方选择记录，且结果中没有反面身份回答。试跑在 MZ 基础、MC 基础与周年的半条猜测处得到“未完成”；正式对照将这类节点延后至对应 <code>own-choice</code> 到达，原位置保存在 <code>deferredFrom</code>。这项等待限制仍然存在，不计作剪枝错误或已经修复。</li>
<li><strong>精确对照</strong>比较完整剧本集合，不能用各角色候选数量相同代替联合解集相同。每个节点都在同一公开前缀上完成穷举和两种提交策略的联合核验。</li>
<li>同时交叉核对穷举器与结构化求解器构造的完整初始域，防止两个后续查询共同漏掉初始配置。</li>
<li>较大样本可逐个调用完整配置查询接口，只有有限域内每个配置均得到明确结论才形成精确集合；具体方式见下载证据的 <code>proofMode</code>。预算未完成会单独记录。</li>
<li><strong>本地候选</strong>允许包含尚未核验的值。“保守余量”是本地候选比穷举投影更多，不等于错误解；误删精确解、提交分组改变本地候选或精确解集不一致均列为差异。</li>
<li><strong>计算量</strong>分别记录历史展开、约束检查、局部搜索分支与因果分支。分支数不是墙钟耗时。按节点批量提交并不自动减少每条观察必要的分析。</li>
<li>两种生产流程保留增量状态，穷举参照在每个节点独立重算，防止参照器早期缓存路径膨胀干扰判定。因此与穷举的比率是本次审计方法的工作量对比；判断节点调度本身的收益，应直接比较原流程和节点策略。</li>
<li><strong>覆盖边界</strong>结论仅适用于报告中的公开历史与有限域；静态阶段清单覆盖可能情况，不表示每条规则组合都已穷举。开局说明使用等待状态检查，不将未公布名单的空间当作空集。</li>
<li>14 种官方内容包配置采用缩小的合法角色名单与空事件日程；复杂事件、替代、同时死亡、转变与拒绝另由五条 FS/BTX 历史覆盖，并补充两日跨轮样本。仙人的无界整数参数不纳入有限域计数。</li>
</ul><button id="download">下载完整验证证据 JSON</button></section>
<h2>每个阶段可能缩减什么</h2><div class="scroll"><table><thead><tr><th>时间阶段</th><th>可能缩减的情况</th><th>可跳过的情况</th><th>闭合与跨阶段注意</th><th>本次动态覆盖</th></tr></thead><tbody>${stageRows}</tbody></table></div>
<h2>阶段计算量与样本结果</h2><p>“排除配置”累计各样本在该节点新排除的完整剧本，跨阶段闭合的排除记在实际生效的入口。零缩减只说明这些样本未提供新的区分证据，不能据此永久跳过该阶段。友好能力和事件应按条件、现象是否区分候选来决定是否构造约束。历史展开是本次主动要求完整联合核验的成本，不代表正常经过每个阶段都会自动重放；日常开销应先看本地约束检查列。</p>
<div class="scroll"><table><thead><tr><th>阶段</th><th>节点数</th><th>排除配置</th><th>本地约束检查<br>逐条 / 节点</th><th>历史展开<br>逐条 / 节点</th><th>穷举历史展开</th></tr></thead><tbody>${costRows}</tbody></table></div>
<p>若逐条与节点计算量相同，单纯改变提交时机没有带来剪枝收益；更值得优化的是候选相关性判定与已经确认的公开效果记账。两者都必须保留窗口关闭后的缺失现象核验。</p>
<details><summary>各样本：初始空间 → 最后检查点空间</summary><div class="scroll"><table><thead><tr><th>样本</th><th>完整配置数</th><th>缩减次数</th><th>检查点数</th><th>初始构造交叉核对</th><th>状态</th></tr></thead><tbody>${scenarioRows}</tbody></table></div></details>
<h2>友好能力与事件的穷举专项</h2><p>新增真实执行历史逐节点同步比较完整穷举集合。目标阶段的零检查不代表之后永远不能缩减：例如公开增加区域密谋，可能在轮末胜负判定时排除规则。BTX 两条友好能力样本都排除了发动者为魔女的四个配置（12 → 8）：有可见效果时立即确认；零值无变化时等到窗口关闭，确认没有拒绝报告。即使没有数值变化，隐藏拒绝条件仍可能区分候选。</p>
<div class="scroll"><table><thead><tr><th>专项样本</th><th>目标阶段前 → 闭合后</th><th>本地约束检查</th><th>处理</th><th>全历史最终配置数</th></tr></thead><tbody>${focusedRows}</tbody></table></div>
<p>故意错误的公开历史另用独立穷举核对，应同时得到空解；不能把“未完成”当作零。</p>
<div class="scroll"><table><thead><tr><th>错误记录</th><th>逐条 / 节点 / 穷举配置数</th><th>验证状态</th></tr></thead><tbody>${(data.negativeCases ?? []).map((c) => `<tr><th>${esc({ 'goodwill-wrong-amount': '友好能力现象数量错误', 'incident-wrong-amount': '事件现象数量错误', 'incident-missing-effect': '事件应有现象缺失' }[c.kind] ?? c.kind)}</th><td>${c.counts.join(' / ')}</td><td>${esc(c.status)}</td></tr>`).join('')}</tbody></table></div>
<h2>逐节点对照</h2><div class="toolbar"><label>样本 <select id="scenario"><option value="all">全部样本</option>${scenarios.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>阶段 <select id="phase"><option value="all">全部阶段</option>${data.phaseCatalog.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label><input type="checkbox" id="changes">仅显示缩减或差异</label><input id="query" placeholder="搜索样本或公开记录" aria-label="搜索样本或公开记录"></div><p id="summary" class="muted"></p>
<div class="scroll"><table class="timeline"><thead><tr><th>样本 / 轮日</th><th>节点 / 前缀</th><th>原空间 → 当前</th><th>逐条 / 节点 / 穷举</th><th>解集差异</th><th>本地保守余量</th><th>历史展开<br>逐条 / 节点 / 穷举</th><th>详情</th></tr></thead><tbody id="rows"></tbody></table></div>
<h2>本轮发现与修复</h2>${(data.repairs ?? []).map((r) => `<section class="panel"><h3>${esc(r.area)}</h3><p>修复前：${esc(r.before)}</p><p>修复后：${esc(r.after)}</p><small>回归验证：${esc(r.regression)}</small></section>`).join('')}
<h2>当前差异与未完成记录</h2>${data.findings.length ? `<pre id="findings">${esc(JSON.stringify(data.findings, null, 2))}</pre>` : '<p class="good">修复后，本次样本未发现精确解集差异、误删或提交分组引起的本地候选差异。</p>'}
<h2>规则来源与复现</h2><p>运行 <code>pnpm report:timeline</code> 重建全部样本与此页面。实际剧本仅用于生成测试历史和事后核对，不作为候选剪枝输入。所有候选来自公开开局域。</p>
${(data.methodNotes ?? []).map((note) => `<p class="warn">方法核查：${esc(note.issue)}</p>`).join('')}
<details><summary>源文件指纹与观察／完整剧本证据</summary><pre>${esc(JSON.stringify({ fingerprint: data.fingerprint, sourceHashes: data.sourceHashes, startedAt: data.startedAt, completedAt: data.completedAt }, null, 2))}</pre><p>完整观察、操作记录、候选剧本、每个节点的解集合及计算量包含在下载 JSON 中。</p></details>
<details><summary>14 种内容包配置的规则时点索引（含死亡、事件完成等跨阶段反应）</summary>${(data.inventory ?? []).map((p) => `<details><summary>${p.module}${p.anniversary ? ' 周年' : ' 基础'} · ${p.sources.length} 条来源</summary><pre>${esc(JSON.stringify(p.sources, null, 2))}</pre></details>`).join('')}</details>
<p class="muted">报告与离线页面的自动检查不能代替人工验收。人工验收：待确认。</p>
</main><script id="data" type="application/json">${JSON.stringify(data).replaceAll('<', '\u003c')}</script><script>
const data=JSON.parse(document.getElementById('data').textContent),labels=${JSON.stringify(labels)};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const entries=data.scenarios.filter(s=>s.nodes).flatMap(s=>s.nodes.map(n=>({s,n})));
const differs=n=>n.differences.original.missing.length+n.differences.original.extra.length+n.differences.node.missing.length+n.differences.node.extra.length+Number(n.differences.localDelivery)+n.differences.localProjection.missing.length;
function render(){
 const scenario=document.getElementById('scenario').value,phase=document.getElementById('phase').value,q=document.getElementById('query').value.trim().toLowerCase(),changes=document.getElementById('changes').checked;
 const rows=entries.filter(({s,n})=>(scenario==='all'||s.id===scenario)&&(phase==='all'||n.phase===phase)&&(!changes||n.before!==n.after||differs(n))&&(!q||JSON.stringify([s.name,n.phaseName,n.observations]).toLowerCase().includes(q)));
 document.getElementById('summary').textContent='显示 '+rows.length+' 个节点；'+rows.filter(r=>r.n.before>r.n.after).length+' 次精确缩减；'+rows.filter(r=>differs(r.n)).length+' 个差异节点。';
 document.getElementById('rows').innerHTML=rows.map(({s,n},i)=>'<tr><td>'+esc(s.name)+'<small>第 '+n.loop+' 轮 · 第 '+n.day+' 日</small></td><td>'+esc(n.phaseName)+'<small>'+labels[n.kind]+' · #'+n.through+(n.closed?' · 关闭 '+esc(n.closed):'')+'</small></td><td class="count">'+n.before+' → <b>'+n.after+'</b></td><td class="count">'+n.original.length+' / '+n.node.length+' / '+n.exhaustive.length+'</td><td class="'+(differs(n)?'bad':'good')+'">'+(differs(n)?'发现差异':'完整集合一致')+'</td><td>'+n.differences.localProjection.extra.length+' 个候选值</td><td class="count">'+n.work.originalExact.expansions+' / '+n.work.nodeExact.expansions+' / '+n.work.exhaustive+'</td><td><details><summary>展开</summary><pre>'+esc(JSON.stringify({减去的剧本:n.eliminated,公开观察:n.observations,原流程分析:n.deductions,计算量:n.work,差异:n.differences,精确候选:n.exhaustive},null,2))+'</pre></details></td></tr>').join('');
}
for(const id of ['scenario','phase','changes','query'])document.getElementById(id).addEventListener(id==='query'?'input':'change',render);
document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='timeline-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();
</script></html>`;
}
