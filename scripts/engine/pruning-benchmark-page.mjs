import { pruningLabel } from './compiled-pruning.mjs';
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rate = (base, work) => (base ? (((base - work) * 100) / base).toFixed(1) + '%' : '—');
const statsRow = (r) => [
  r.queries,
  r.possible,
  r.excluded,
  r.exhaustive,
  r.previous,
  r.pruned,
  rate(r.exhaustive, r.pruned),
];
const cols = ['查询', '相容', '排除', '穷举步', '原策略步', '改后步', '较穷举减少'];
function table(head, rows) {
  return (
    '<table><thead><tr>' +
    head.map((v) => '<th>' + esc(v) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map((row) => '<tr>' + row.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>')
      .join('') +
    '</tbody></table>'
  );
}
const detail = (title, body) =>
  '<details><summary>' + esc(title) + '</summary>' + body + '</details>';
const jsonValue = (_, value) => (value === Infinity ? 'Infinity' : value);
const raw = (data) => '<pre>' + esc(JSON.stringify(data, jsonValue, 2)) + '</pre>';
const groupNames = {
  characters: '角色',
  identities: '身份',
  plots: '主副线',
  incidents: '事件',
  modules: '模组能力',
};
const quotaHead = ['规则', '待定位置', '穷举分支', '传播后分支', '减少', '传播检查', '完整解'];
const quotaRow = (q) => [
  q.rules.join(' + '),
  q.unknown ?? '3、4',
  q.exhaustive,
  q.pruned,
  rate(q.exhaustive, q.pruned),
  q.checks,
  q.solutions,
];

const terms = {
  $self: '发动者',
  $it: '当前对象',
  $target: '所选目标',
  $culprit: '当事人',
  area: '区域',
  initialArea: '初始区域',
  identity: '身份',
  character: '角色',
  status: '状态',
  paranoiaLimit: '不安限度',
  rawTotal: '指示物总数',
  kinds: '指示物种类数',
  alive: '存活角色',
  dead: '死亡角色',
  cards: '角色牌',
  boards: '版图',
  'alive-or-boards': '存活角色或版图',
  day: '当前日',
  days: '总天数',
  loop: '当前轮回',
  loops: '总轮回数',
  ex: 'Ex',
  world: '世界线',
};
const operators = { eq: '＝', ne: '≠', ge: '≥', le: '≤', gt: '＞', lt: '＜' };
function expression(value) {
  if (value === true) return '成立';
  if (value === false) return '不成立';
  if (value === null || typeof value !== 'object')
    return terms[value] ?? String(pruningLabel(value));
  if (Array.isArray(value)) return value.map(expression).join('、');
  if (value.cmp)
    return expression(value.left) + ' ' + operators[value.cmp] + ' ' + expression(value.right);
  if (value.all)
    return (
      value.all
        .filter((v) => v !== true)
        .map(expression)
        .join(' 且 ') || '成立'
    );
  if (value.any) return '（' + (value.any.map(expression).join(' 或 ') || '不成立') + '）';
  if ('not' in value) return '不满足（' + expression(value.not) + '）';
  if (value.ref) return expression(value.ref);
  if (value.field) return expression(value.target) + '的' + expression(value.field);
  if (value.counter)
    return (
      expression(value.target) + '的' + (value.raw ? '原始' : '有效') + expression(value.counter)
    );
  if (value.kind)
    return (
      expression(value.kind) +
      (value.where !== undefined ? '（' + expression(value.where) + '）' : '')
    );
  if (value.count) return expression(value.count) + '的数量';
  if (value.sum) return '对' + expression(value.sum) + '合计' + expression(value.value);
  if (value.game) return expression(value.game);
  if (value.gameFlag || value.flag)
    return (
      (value.target ? expression(value.target) : '局面') + '标记 ' + (value.gameFlag ?? value.flag)
    );
  if (value.attribute) return expression(value.target) + '具有属性 ' + value.attribute;
  if (value.hasAbility) return expression(value.target) + '具有能力 ' + value.hasAbility;
  if (value.incidentOccurred) return '已发生事件 ' + value.incidentOccurred;
  if (value.args)
    return (
      ({ add: '加', subtract: '减', min: '取最小', max: '取最大' }[value.op] ?? value.op) +
      '（' +
      value.args.map(expression).join('、') +
      '）'
    );
  return JSON.stringify(value);
}
function sourceLogic(rule, labels) {
  const rows = rule.sources.map((s) => {
    const observed = [
      pruningLabel(s.timing),
      pruningLabel(s.kind ?? '间接或未定效果'),
      pruningLabel(s.counter ?? ''),
      s.sign === 1 ? '增加' : s.sign === -1 ? '减少' : '',
      s.amount === undefined ? '' : '数量 ' + s.amount,
    ].filter(Boolean);
    const checks = [
      s.directDeclaration ? '核对已声明的能力与首步选择' : '',
      s.target ? '目标为' + expression(s.target) : '',
      ...Object.entries(s.choices).map(
        ([key, select]) => expression('$' + key) + '从以下范围选取：' + expression(select),
      ),
      s.destination ? '目的地 ' + s.destination : '',
      s.threshold !== undefined ? '发动门槛 ' + s.threshold : '',
      s.loopLimit !== undefined ? '每轮次数上限 ' + s.loopLimit : '',
      ...s.gates.map((g) => labels[g]),
      s.conditions?.length ? '成立条件：' + s.conditions.map(expression).join('，且') : '',
      s.indirect ? '核对被调用来源的阶段与效果；保留未解析调用' : '',
    ].filter(Boolean);
    return [
      s.ability ?? rule.name,
      observed.join(' · '),
      checks.join('。') || '进入候选来源，继续核对联合约束',
    ];
  });
  const policies = rule.policies.length
    ? table(
        ['窗口或建域环节', '纳入、排除与保留条件'],
        rule.policies.map((p) => [p.window, p.condition]),
      )
    : '';
  return (
    policies +
    (rule.programs.some((p) => p.goodwillLogic)
      ? table(
          ['主动能力', '声明之后何时检查隐藏候选'],
          rule.programs.filter((p) => p.goodwillLogic).map((p) => [p.id, p.goodwillLogic]),
        )
      : '') +
    (rows.length
      ? table(['能力或事件', '观察匹配', '进一步核对'], rows)
      : '<p>没有独立的可见变化来源，按建域、窗口义务或阶段历史核验。</p>')
  );
}
const isLow = (work, base) => base > 0 && work * 10 >= base * 9;
function lowReview(packs) {
  return packs
    .map((p) => {
      const rows = p.rules.flatMap((r) =>
        r.programs
          .filter(
            (m) =>
              isLow(m.windows[0].previous, m.windows[0].exhaustive) ||
              isLow(m.pruned, m.exhaustive),
          )
          .map((m) => {
            const initial = m.windows[0];
            const branching = m.windows.filter((w) => w.branchPoints > 0).length;
            return [
              r.name,
              m.id,
              rate(initial.exhaustive, initial.previous),
              initial.branchPoints,
              branching + '/' + m.windows.length,
              m.exhaustive,
              m.previous,
              m.pruned,
              rate(m.exhaustive, m.pruned),
              m.lowQueries + '/' + m.queries,
            ];
          }),
      );
      return detail(
        p.module + (p.anniversary ? ' 周年' : ' 基础') + ' · ' + rows.length + ' 项',
        table(
          [
            '规则',
            '能力',
            '原盘面原收益',
            '原盘面分叉点',
            '扩测有分叉盘面',
            '扩测穷举',
            '扩测原策略',
            '扩测改后',
            '扩测现收益',
            '仍低收益的查询',
          ],
          rows,
        ),
      );
    })
    .join('');
}
export function render(data) {
  const rules = data.packs.flatMap((p) => p.rules);
  const programs = rules.flatMap((r) => r.programs);
  const sum = (rows, field) => rows.reduce((s, r) => s + r[field], 0);
  const total = Object.fromEntries(
    ['queries', 'possible', 'excluded', 'exhaustive', 'previous', 'pruned'].map((k) => [
      k,
      sum(programs, k),
    ]),
  );
  const phaseTotals = (samples) =>
    Object.fromEntries(Object.keys(total).map((k) => [k, sum(samples, k)]));
  const quotas = data.packs.flatMap((p) => p.combinations);
  const passive = rules.flatMap((r) => (r.passive ? [r.passive] : []));
  const passiveTotal = Object.fromEntries(Object.keys(total).map((k) => [k, sum(passive, k)]));
  const initial = programs.map((m) => m.windows[0]);
  const zero = initial.filter((w) => w.exhaustive === w.previous);
  const sourceCount = sum(rules, 'scanned');
  const lookups = data.packs.map((p) => p.lookup);
  const sourceVisits = sum(lookups, 'timingChecks') + sum(lookups, 'candidateChecks');
  const remaining = data.packs
    .flatMap((pack) =>
      pack.rules.flatMap((rule) =>
        rule.programs.flatMap((p) =>
          p.windows.map((w) => ({
            pack: pack.module + (pack.anniversary ? ' 周年' : ' 基础'),
            rule: rule.name,
            id: p.id,
            variant: w.variant,
            ...w.worst,
          })),
        ),
      ),
    )
    .sort((a, b) => b.pruned / b.exhaustive - a.pruned / a.exhaustive || b.pruned - a.pruned);
  const packs = data.packs
    .map((p) =>
      detail(
        p.module + (p.anniversary ? ' 周年' : ' 基础') + ' · ' + p.rules.length + ' 个条目',
        p.rules
          .map((r) =>
            detail(
              groupNames[r.group] +
                ' · ' +
                r.name +
                '　来源 ' +
                r.sources.length +
                '　程序 ' +
                r.programs.length,
              sourceLogic(r, data.gateLabels) +
                '<p>全扫描来源候选 ' +
                r.scanned +
                '，索引返回 ' +
                r.selected +
                '，减少 ' +
                rate(r.scanned, r.selected) +
                '。</p>' +
                (r.programs.length
                  ? table(
                      ['能力', '时点', '激活', '终局路径', ...cols],
                      r.programs.map((m) => [
                        m.id,
                        m.timing,
                        m.activation,
                        m.paths,
                        ...statsRow(m),
                      ]),
                    )
                  : '<p>无独立可执行步骤。</p>') +
                (r.quota ? table(quotaHead, [quotaRow(r.quota), quotaRow(r.quotaFour)]) : '') +
                (r.passive
                  ? table(
                      ['被动盘面', ...cols],
                      r.passive.windows.map((w) => [w.variant, ...statsRow(w)]),
                    )
                  : '') +
                (r.programs.length
                  ? detail(
                      '按能力和盘面复核低收益步骤',
                      table(
                        ['能力', '盘面', '分叉点', '抵达边界路径', ...cols],
                        r.programs.flatMap((m) =>
                          m.windows.map((w) => [
                            m.id,
                            w.variant,
                            w.branchPoints,
                            w.paths,
                            ...statsRow(w),
                          ]),
                        ),
                      ),
                    )
                  : '') +
                detail('编译后的反向筛选条件', raw(r.sources)) +
                detail('规则定义与参数', raw(r.definition)),
            ),
          )
          .join(''),
      ),
    )
    .join('');
  const payload = JSON.stringify(data, jsonValue).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>反向剪枝与穷举对照</title><style>
body{max-width:74rem;margin:2rem auto;padding:0 1rem;font:16px/1.65 system-ui;color:#213639}h1,h2{line-height:1.3}summary,button{cursor:pointer}details{border-left:2px solid #bacac7;margin:.55rem 0;padding:.25rem .8rem;overflow:auto}table{border-collapse:collapse}th,td{border:1px solid #ced8d4;padding:.3rem .7rem;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f4;padding:1rem}button{padding:.45rem .85rem}</style><main><h1>反向剪枝与穷举对照</h1>
<p>${data.packs.length} 个模组版本，${rules.length} 个规则条目，${programs.length} 个已成立的能力或事件程序。各版本分别计数。<button id="save">下载结构化 JSON</button></p>
<p><a href="#rules">按名称查每条规则的剪枝逻辑</a>　<a href="#cards">查行动牌</a>　<a href="#low">查看低收益程序</a></p>
<h2 id="low">哪些步骤省得少</h2><p>原盘面有 ${zero.length} 个程序的原策略与穷举步数完全相同，其中 ${zero.filter((w) => !w.branchPoints).length} 个没有出现多个合法选择。相同查询重新运行，原策略共 ${sum(zero, 'previous')} 步，改后 ${sum(zero, 'pruned')} 步。日末已消费全部公告、待处理能力和反应都已结清时，直接核对下一条边界；若只需一个见证，且当前确实可放弃，还可使用无声放弃。已知决策、另一个可能的结算结局以及刚发出的冲突公告仍须核验。以上步数只统计内核推进和选择提交，边界判断本身也会检查状态及可用能力。</p>
<p>下表收录原盘面原收益或扩测后合计收益不超过 10% 的程序。分叉点是出现两个及以上合法选项的位置。每行的原盘面和扩测列使用各自的同输入基线。</p>${lowReview(data.packs)}
<p>扩测中，相对穷举节省不超过 10% 的单程序查询有 ${sum(programs, 'lowQueries')} 次。下表从每个盘面取收益最低的查询，按节省比例由小到大列出前 12 项，同率时优先列出剩余工作量大的样本。只查边界的负例在没有冲突公告时，需要证明所有可选路径都无法抵达指定边界。选择提交以外的步数均为阶段推进。完整证据字段见下载数据的 windows[].worst。</p>
${table(
  ['版本', '规则 / 能力', '盘面', '边界', '缺席的公告类型', '判定', '穷举', '改后', '其中提交选择'],
  remaining
    .slice(0, 12)
    .map((q) => [
      q.pack,
      q.rule + ' / ' + q.id,
      q.variant,
      pruningLabel(q.end.phase),
      q.absent.map((a) => a.type).join('、') || '只查边界',
      q.status === 'possible' ? '相容' : '排除',
      q.exhaustive,
      q.pruned,
      q.choices,
    ]),
)}
<h2>完整历史的联合解</h2><p>从合法开局生成实际公开历史。从同一开局冷启动两个求解器，一次提交同一段历史。穷举端逐一物化开局候选，实时端运行联合历史核验。以两端实际调用内核尝试决策的次数比较工作量，并比对完整剧本解集。建域与传播开销未计入本栏。</p>
${table(
  ['场景', '检查点', '末条时点', '公开观察', '开局候选', '完整解', '穷举展开', '实时展开', '减少'],
  data.history.map((h) => [
    h.scenario,
    h.checkpoint,
    pruningLabel(h.endPhase),
    h.observations,
    h.domainSize,
    h.solutions,
    h.exhaustive,
    h.pruned,
    rate(h.exhaustive, h.pruned),
  ]),
)}
<p>中段边界中，${data.history.filter((h) => h.checkpoint === '中段边界' && h.domainSize === h.solutions && h.exhaustive === h.pruned).length} 个检查点的全部开局候选仍有合法见证，且历史展开与穷举相同。这些前缀无法再排除完整剧本；跨候选复用相同历史前缀的成本收益尚未计量。</p>
<h2>单程序阶段搜索</h2>${table(cols, [statsRow(total)])}
<p>每个程序在三个四人隔离盘面中从已成立的首步执行。原盘面保留上轮查询；同区样本提高发动者友好并为 B 添加守护，异区样本令 B 已死、改变 C 的位置及不安并设置 Ex。扩测盘面对每种实测公告的完整字段及可能的提前轮末边界分别查询。基线走完每条合法选择路径，到边界才检查缺席证据。原策略按原顺序深搜，遇到已发出的冲突公告或闭合见证即停止。对保存的穷举树逐边重算原策略步数；改后核验器还可直接证明已结清的日末边界。每次单步推进与提交一次选择均计一步。逐查询比较是否存在合法见证。穷举树在同一输入内复用；表中按每个查询独立搜索计费。节省比例按总步数加权，计入提前找到见证的收益。此处未测运行时间、触发准入或跨轮整局成本。</p>
<h2>主副线名额与复合搜索</h2><p>${data.packs.reduce((n, p) => n + p.combinations.length, 0)} 个名额样本覆盖全部 Y 与 X 槽位组合，每组分别留下 3 或 4 个待定位置并比对完整分配集合。每条主副线也单独测量。按名额上限合并重复身份，双面占同一席，取满可选名额，本样本不另增秘密身份。加入平民并固定尾部。基线遍历待定位置的笛卡尔积，在叶子核对名额；生产约束在分支前传播。两边均只计有多个选择时尝试的赋值分支。传播检查另列。零分支表示仅靠传播或初始单值即可确定。此实验隔离名额约束，某些组合另有角色属性或特殊建域限制。</p>
${table(quotaHead, [quotaRow({ rules: ['全部组合合计'], exhaustive: sum(quotas, 'exhaustive'), pruned: sum(quotas, 'pruned'), checks: sum(quotas, 'checks'), solutions: sum(quotas, 'solutions') })])}
${data.packs.map((p) => detail(p.module + (p.anniversary ? ' 周年' : ' 基础') + ' · ' + p.combinations.length + ' 组', table(quotaHead, p.combinations.map(quotaRow)))).join('')}
<h2>常驻角色与身份</h2><p>对缺少独立能力步骤的 ${passive.length} 个角色或身份条目，分别在本人有 0、1、2 枚守护时加入一项日末延迟死亡请求，逐条对照所有选择路径。样本覆盖该盘面下的可观察反应；移动禁区、友好拒绝等其他时点的特性需另行验证。</p>${table(cols, [statsRow(passiveTotal)])}
<h2>复合规则的身份解集</h2><p>BTX 日末从自然阶段入口开始。A、B 各有平民、杀人狂、时间旅者、关键人物四种有效身份。对两人同区、异区及第三人在场三个盘面，交叉 B 的守护数与缺席证据，各自核验 16 组身份；守护、强制死亡、不死及死亡导致败北均通过正向内核结算。这里测局部有效身份，未施加剧本名额。</p>
${table(
  ['位置', 'B 的守护', '观察', ...cols],
  data.compound.map((c) => [c.layout, c.guard, c.label, ...statsRow(c)]),
)}${detail('各窗口保留的完整身份对', raw(data.compound.map(({ layout, guard, label, kept }) => ({ layout, guard, label, kept }))))}
<h2 id="cards">行动牌的剪枝逻辑与实测</h2><p>在已翻牌的结算入口逐一检查 16 种牌及其同目标双牌组合，另测双重禁止密谋和希望转换后受禁止。普通角色、无绕过身份，分别取 BTX 与 WM（Ex = 3）。将反向牌面预测的最终位置及各项指示物同正向内核比对，再核对缺席查询。三段牌面结算全部结束、没有待处理选择或反应时，边界核验可以省去最后的回收牌与公告写入。此处测已翻牌后的结算，持牌合法性与身份特例另有用例。</p>
${table(
  ['牌种', '判定依据', '盘面', ...cols],
  data.cards.map((c) => [c.kind, c.logic, c.samples.length, ...statsRow(phaseTotals(c.samples))]),
)}
<h2 id="rules">每条规则的剪枝逻辑</h2><p>实时求解器按阶段与可见变化找来源，再查目标、公开条件、发动者和时点；一项必要条件被公开证据证伪，只能排除该观察的这个来源。条件未知时保留；联合约束或完整历史排尽其他解释后，才排除完整候选。采用全角色、全事件目录，比较 ${data.phases.length} 个阶段 × ${data.changes.length} 个变化签名。每个查询独立全扫描并逐项核对索引返回的来源。全扫描累计 ${sum(rules, 'scanned')} 个候选，索引返回 ${sum(rules, 'selected')} 个。该指标衡量下游少收到多少来源，源访问次数在下表单列，后续门槛耗时未计入。本组签名未附带主动能力声明。</p>
<p>同阶段出现第二种变化时，复用上一次已筛出的阶段来源。跨阶段来源保留在对应列表里，主动声明使用独立的角色来源表。每种变化第一次查询均与完整扫描逐个比对来源和次序，再重复整批签名检查缓存。</p>
${table(
  ['来源访问工作量（各版本合计）', '原策略', '改后', '减少'],
  [
    [
      '每版只查一次剧作家阶段的移动',
      sum(lookups, 'sourceCount'),
      sum(lookups, 'firstVisit'),
      rate(sum(lookups, 'sourceCount'), sum(lookups, 'firstVisit')),
    ],
    ['每版首次查询全部阶段与变化签名', sourceCount, sourceVisits, rate(sourceCount, sourceVisits)],
    ['重复整批相同签名', 0, 0, '缓存命中 ' + sum(lookups, 'cacheHits') + ' 次'],
  ],
)}<p>原策略每个首次查询遍历全部来源。改后访问数为填阶段表的 ${sum(lookups, 'timingChecks')} 次（同一遍同时筛效果）与以后从阶段表筛效果的 ${sum(lookups, 'candidateChecks')} 次之和。首次查询同时建表与选来源，后续新签名只访问本阶段和跨阶段来源。阶段表占用额外内存。索引访问数与历史展开、阶段执行步分别计量。</p>
${detail(
  '观测路由、保留条件与排除结论',
  table(
    ['窗口', '何时纳入', '何时跳过或保留', '结论'],
    Object.entries(data.routes).map(([key, r]) => [key, r.include, r.skip, r.result]),
  ),
)}${detail('必要条件字段释义', raw(data.gateLabels))}
<label>按名称查规则 <input type="search" id="query" placeholder="例如：医院事故"></label> <output id="matches"></output><div id="packs">${packs}</div>
<p>复现命令 <code>pnpm exec tsx scripts/engine/pruning-benchmark.mjs</code>。仅在所有断言通过后更新此页。</p></main>
<script type="application/json" id="data">${payload}</script><script>
document.getElementById('query').oninput = event => {
  const term = event.target.value.trim();
  let count = 0;
  for (const pack of document.querySelectorAll('#packs > details')) {
    let found = 0;
    for (const rule of pack.querySelectorAll(':scope > details')) {
      rule.hidden = !rule.firstElementChild.textContent.includes(term);
      if (!rule.hidden) found++;
    }
    pack.hidden = found === 0;
    pack.open = Boolean(term && found);
    count += found;
  }
  document.getElementById('matches').textContent = term ? count + ' 个匹配条目' : '';
};
document.getElementById('save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([document.getElementById('data').textContent], {type:'application/json'}));
  a.download = 'pruning-benchmark.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
</script></html>`;
}
