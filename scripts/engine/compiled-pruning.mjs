import assert from 'node:assert/strict';
import { officialModules, supportsAnniversary } from '../../packages/contracts/src/game.ts';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.ts';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.ts';
import { initializeDiscussion } from '../../packages/engine/src/runtime/engine.ts';
import { fixtures, officialScenarioSetup } from '../../tests/engine/official-harness.ts';
import { lifecycle } from '../../packages/engine/src/runtime/shared-lifecycle.ts';
import { routes } from '../../packages/engine/src/runtime/knowledge-routes.ts';
import {
  PruningCatalog,
  necessaryConditions,
  requiresGoodwillDeclaration,
  gateLabels,
} from '../../packages/engine/src/runtime/knowledge-pruning.ts';
import { compileOfficial } from '../../packages/content/src/official/compile.ts';

// The generator uses the production catalog. All published slots are included so an
// indirect source is displayed even when a particular opening would omit its callee.
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const zh = {
  modules: '模组固有能力',
  characters: '角色',
  identities: '身份',
  plots: '主副线',
  incidents: '事件',
  counter: '指示物',
  kill: '死亡',
  revive: '复活',
  remove: '移出',
  move: '移动',
  failure: '主人公失败',
  'protagonist-death': '主人公死亡',
  goodwill: '友好',
  paranoia: '不安',
  intrigue: '密谋',
  guard: '护卫',
  hope: '希望',
  despair: '绝望',
  shrine: '神社',
  school: '学校',
  hospital: '医院',
  city: '都市',
  'loop-start': '轮回开始',
  'day-start': '回合开始',
  'loop-end': '轮末',
  'day-end': '日末',
  'mastermind-abilities': '剧作家能力',
  'protagonist-abilities': '主人公能力',
  incident: '事件阶段',
  'card-resolution': '行动结算',
  '*': '跨阶段（须核对触发源）',
};
const name = (k) => zh[k] ?? k;
const json = (v) =>
  JSON.stringify(
    v,
    (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x === Infinity ? '无固定上界' : x),
    2,
  );
const details = (title, obj) =>
  '<details><summary>' + esc(title) + '</summary><pre>' + esc(json(obj)) + '</pre></details>';
const para = (label, text) => '<p><b>' + label + '</b> ' + esc(text) + '</p>';

function signature(s) {
  return [
    s.ability?.id,
    name(s.timing),
    s.kind ? name(s.kind) : '间接或未定类型',
    s.counter ? name(s.counter) : '',
    s.sign === undefined ? '' : s.sign > 0 ? '增加' : s.sign < 0 ? '减少' : '不变',
    s.amount === undefined ? '' : '（单指令 ' + s.amount + '）',
  ]
    .filter(Boolean)
    .join(' · ');
}
// Describe the evidence to wait for using the same steps as the engine.
export function goodwillPolicy(ability) {
  const effects = [];
  function walk(list) {
    for (const e of list) {
      effects.push(e);
      if ('effects' in e) walk(e.effects);
    }
  }
  for (const step of ability.steps) walk(step.effects);
  const has = (op) => effects.some((e) => e.op === op);
  const flag = (key) => effects.some((e) => e.op === 'flag' && e.key === key);
  const notes = [];
  if (has('kill'))
    notes.push(
      '目标实际死亡时检查不死身份。护卫减少、别人代死或无人死亡时核对死亡结算。随后出现败北或幸存者不安增加，才查死者及幸存者的反应；阶段正常结束也可排除必定导致败北的身份。',
    );
  if (has('revive') || has('remove'))
    notes.push(
      '只更新已指定目标的存活或移出状态。对象、状态与声明不符，或之后有规则因其在场状态触发时，再核对相应规则。',
    );
  if (has('reveal-identity'))
    notes.push('收到身份公开报告时立即约束该目标。身份可变化、可伪报或涉及替身时按相应例外核验。');
  if (has('same-identity')) notes.push('同身份名单公开时核对角色之间的身份关系。');
  if (has('reveal-rule')) notes.push('规则名正式公开时排除不含该规则的组合。');
  if (has('reveal-culprit')) notes.push('事件当事人正式公开时，约束被点名的那一天。');
  if (has('invoke-goodwill'))
    notes.push('按代发规则核对被点名者的能力及其后续报告；代发有自己的门槛和拒绝例外。');
  if (has('invoke-incident'))
    notes.push('指定事件被调用后核对其正文和后续反应。与日程上自然发生的事件分别判断。');
  if (has('move'))
    notes.push(
      '目标按声明到达目的地时更新位置。没有移动、进入禁区或另一人也移动时，检查禁行、解除禁行或随行。',
    );
  if (flag('protect')) notes.push('记住保护对象；以后有相关移动、代死或护卫消耗时核对从者。');
  if (flag('free-movement')) notes.push('以后目标尝试进入原禁行区域时才检查解除禁行。');
  if (flag('no-incidents'))
    notes.push('以后该角色可能是当事人、且事件未发生时，保留事先禁止事件的解释。');
  if (has('protect-protagonists')) notes.push('以后出现主人公死亡请求时才核对保护是否改变结果。');
  if (has('recover-card')) notes.push('记录回手；该牌再次打出且能否持有影响历史合法性时核对。');
  if (has('counter') || has('transfer') || has('replace') || has('clear'))
    notes.push(
      '能由声明和公开盘面确定的增减、交换或清除只记入盘面。种类、数量或对象对不上时核验；之后达到事件或身份门槛时查对应规则。',
    );
  if (has('ex') || flag('streamer-target'))
    notes.push('记录 Ex 或标记的变化。后续规则使用该数值或标记时再核对。');
  return notes.join(' ') || '出现正式披露、额外现象，或结果与公开选择矛盾时，再核对相应来源。';
}
function effect(s, cat) {
  const gates = necessaryConditions(s);
  const children = cat.outputsFor(s);
  const voluntary =
    s.ability?.timing === 'protagonist-abilities' &&
    !s.ability.mandatory &&
    s.ability.threshold !== undefined;
  const checks = gates.filter((g) => g !== 'entry').map((g) => gateLabels[g]);
  return (
    '<li>' +
    (requiresGoodwillDeclaration(s)
      ? para('主动发动', routes.declaredEffect.include + routes.declaredEffect.skip)
      : voluntary && s.invocationTiming === 'protagonist-abilities'
        ? para(
            '调用来源',
            '按已声明的调用能力核对。若先前的调用可能安排了延迟效果，仍核验其到期时点。',
          )
        : '') +
    para(
      requiresGoodwillDeclaration(s) ? '声明对应的盘面变化' : '纳入',
      signature(s) + (s.target ? '；目标 ' + name(s.target) : '') + '。',
    ) +
    (requiresGoodwillDeclaration(s) ? para('何时检查隐藏候选', goodwillPolicy(s.ability)) : '') +
    para(
      '跳过本来源',
      '阶段或可见变化不匹配；' +
        (checks.length
          ? '以下检查中有一项被证伪：' + checks.join('；')
          : '无附加的公开目标／数值门槛') +
        '。',
    ) +
    (gates.includes('entry') ? para('快照', gateLabels.entry) : '') +
    (s.invocation
      ? para('间接调用', '须有可产生此观察的被调用效果；调用未解析或递归时保留未知。')
      : '') +
    (s.ability?.loopLimit !== undefined
      ? para(
          '次数',
          '每轮上限 ' +
            s.ability.loopLimit +
            '；在相容原因组合中检查剩余容量，不能把同一次发动的多份报告重复扣次。',
        )
      : '') +
    details('检查参数、选择绑定和时点', {
      ...s,
      ability: s.ability?.id,
      program: gates,
      indirect: children?.map(signature),
    }) +
    '</li>'
  );
}
function other(group, d, pack) {
  const out = [];
  if (group === 'incidents' && pack.module === 'MC')
    out.push([
      '事件后 Ex',
      '紧接发生报告的 Ex 增量通常为 ' +
        (d.exGain ?? 1) +
        '，取消正文的当事人使增量为 1。不符的事件与当事人配对被排除。',
    ]);
  if (group === 'incidents' && pack.module === 'AHR' && !d.thresholdCounter)
    out.push(['世界线', '奇数 Ex 时事件通常改查有效友好；强制触发或可能抑制时保留对应解释。']);
  if (
    group === 'characters' &&
    pack.module === 'AHR' &&
    d.abilities.some((a) => a.threshold !== undefined)
  )
    out.push(['世界线', '独立发动时按公开 Ex 核对门槛：奇数时使用有效不安，偶数时使用有效友好。']);
  if (group === 'plots')
    out.push([
      '建域',
      d.type +
        ' 槽；名额 ' +
        (Object.entries(d.identities)
          .map(([k, n]) => k + '×' + n)
          .join('、') || '无') +
        '。公开规则不符、组合名额不可分配或全无相容解释时排除该组合。',
    ]);
  if (d.pair)
    out.push([
      '双面名额',
      d.pair.join('／') + '须成对分配给同一角色；公开当前面后仍须核对 Ex 与可能的身份变化。',
    ]);
  if (group === 'identities')
    out.push([
      '建域',
      '作为实际所选规则的身份名额或特殊分配处理；候选角色必须可占其槽位。' +
        (d.max ? '上限 ' + d.max + '。' : '') +
        (d.immortal ? '普通角色发生实际死亡时排除不死身份；临时工身份须另核。' : '') +
        (d.ignore ? '拒绝友好类型：' + d.ignore + '；只在正确的声明／拒绝窗口传播。' : ''),
    ]);
  if (group === 'incidents')
    out.push([
      '发生报告',
      d.crowdThreshold !== undefined
        ? '区域当事人；按事发时区域中的尸体数核对门槛 ' +
          d.crowdThreshold +
          '。无法从当前公开快照确定时核验历史。'
        : '按真实事件与当事人成对检查：' +
          name(d.thresholdCounter ?? 'paranoia') +
          '达到当事人限度（偏移 ' +
          (d.thresholdOffset ?? 0) +
          '，按角色修正）。已知阈值与发生报告相反时排除此配对；私有门槛、可能抑制或未建模触发保留。',
    ]);
  if (
    group === 'characters' &&
    d.abilities.some(
      (a) => a.timing === 'protagonist-abilities' && a.threshold !== undefined && !a.mandatory,
    )
  )
    out.push([
      '主人公主动发动',
      routes.declaredEffect.include +
        routes.declaredEffect.skip +
        routes.declaredEffect.result +
        ' 拒绝不消耗完成次数。',
    ]);
  const unrefusable =
    d.abilities?.filter((a) => a.timing === 'protagonist-abilities' && a.cannotRefuse) ?? [];
  if (unrefusable.length)
    out.push([
      '不可拒绝',
      unrefusable.map((a) => a.id).join('、') + ' 跳过拒绝判定。收到该能力的拒绝报告会形成矛盾。',
    ]);
  if (group === 'characters')
    out.push([
      '开局及能力',
      '只在公开名册或合法替身中作为发动者。已知区域、存活、目标和时点不合可跳过本来源；未登场不等于不在剧本。',
    ]);
  if (d.name === lifecycle.startCounter.owner)
    out.push([
      '轮回开始',
      '存活时在友好、不安、密谋中选一种增加 1。相应报告可纳入；其余种类或其他阶段不由这条特性解释。',
    ]);
  if (d.name === lifecycle.startPlacement.owner)
    out.push(['轮回开始', '放置时可以选择版图；轮初位置改变不能据此排除手下的剧本初始区域。']);
  if (d.name === lifecycle.dayEndDeath.owner)
    out.push([
      '日末',
      '存活且指示物总数至少 ' +
        lifecycle.dayEndDeath.minimumTotal +
        ' 时产生死亡请求；死亡或护卫减少均可能出现，达不到门槛不能用该请求解释。',
    ]);
  if (d.name === lifecycle.borrowed.identity)
    out.push([
      '借用身份能力',
      '学校密谋达到 ' +
        lifecycle.borrowed.threshold +
        ' 可解释传谣人的效果；都市密谋达到门槛时可解释关键人物的死亡反应。身份本身不变。',
    ]);
  if (d.name === lifecycle.transformation.plot)
    out.push([
      '有效身份',
      '存活的初始平民有效不安达 ' +
        lifecycle.transformation.paranoia +
        ' 时按杀人狂处理；公开杀人狂不能直接排除该初始平民。',
    ]);
  if (d.name === lifecycle.previousFriend.plot)
    out.push([
      '跨轮回',
      '上一轮有友好或希望的存活角色应增加 ' +
        lifecycle.previousFriend.paranoia +
        ' 不安；窗口闭合且缺少必报效果才排除含此副线的组合。',
    ]);
  if (d.name === lifecycle.revealedFriend.identity)
    out.push([
      '跨轮回',
      '已正式公开且存活的亲友轮回开始获得友好；单独见到友好增加不等于正式公开亲友。',
    ]);
  if (d.name === lifecycle.bypass.goodwill)
    out.push([
      '禁止友好',
      '本人可无视自身的禁止友好；行动牌结算窗口闭合且应有的友好增加未出现时才核对，替身或其他来源转历史核验。',
    ]);
  if (d.name === lifecycle.bypass.intrigue)
    out.push([
      '禁止密谋',
      '同区密谋禁止被绕过可纳入原因。虚拟区域、多个禁止、替身或其他可能来源须保留。',
    ]);
  if (d.incident)
    out.push([
      '角色事件修正',
      ({
        cancel: '当事人取消事件正文；无现象不能排除其当事人资格，后续步骤另计。',
        repeat: '非嵌套事件正文重复、重新选择；只按普通单次效果不相容不能排除。',
        proxy: '本人和替身分别检查触发，保留普通／并行解释。',
      }[d.incident.execution] ?? '') +
        (d.incident.privateTrigger ? ' 私有触发条件不从公开门槛硬删。' : '') +
        (d.incident.totalThreshold ? ' 通常不安门槛改查全部指示物之和。' : '') +
        (d.incident.maySuppress ? ' 未发生时可能被私下禁止，不据此排除。' : '') +
        (d.incident.thresholdMultiplier
          ? ' 门槛偏移乘 ' + d.incident.thresholdMultiplier + '。'
          : ''),
    ]);
  if (d.partnerReaction)
    out.push([
      '同批死亡',
      '本人实际死亡后，存活的' +
        d.partnerReaction.survivor +
        '增加 ' +
        d.partnerReaction.paranoia +
        ' 不安。事件窗闭合、有应披露的幸存者且无其他未决反应时，缺失上升才排除对应身份配对。',
    ]);
  if (d.loopShrineIntrigue)
    out.push(['轮回开始', '存活时神社密谋增加；只在轮回开始的完整强制窗口闭合后利用缺失报告。']);
  if (d.forbiddenInitial)
    out.push([
      '开局禁配',
      d.forbiddenInitial === 'civilian' ? '不可分配普通平民。' : '不可分配无视友好的初始身份。',
    ]);
  if (d.protects)
    out.push([
      '替代',
      '共区保护对象的移动、死亡或消耗护卫可由随行／替代解释，不能单凭目标不同排除。',
    ]);
  if (d.name === '仙人')
    out.push([
      '支持边界',
      '无界整数 X 不作人为截断；能传播的有限域仍可显示，完整配置查询返回未决，不作精确计数。',
    ]);
  if (!d.supported) out.push(['支持边界', '此条目未翻译；可达时不能用空效果推导无解。']);
  if (d.name === pack.setupRules.attribute?.plot)
    out.push(['开局资格', '关键人物须有少女属性（局外人例外）；无可行分配时淘汰规则组合。']);
  return out.map(([k, v]) => para(k, v)).join('');
}
export function compiledSection() {
  const rows = [];
  let sources = 0;
  let configurations = 0;
  const checks = [];
  const moduleNotes = {
    FS: '一条副线；按公开拒绝、死亡反应和事件窗口缩小候选。',
    BTX: '两条副线；妄想扩大病毒可改变有效身份，正式公开杀人狂时保留符合条件的初始平民。',
    MZ: '忍者公开其他在场身份、因果之绊改变当前身份时保留原身份解释。心无灵犀仅在同目标禁止友好与移动牌同时出现时检查。',
    MC: '侦探不得担任当事人，愚者和双胞胎等身份必须担任当事人。事件发生后按紧接的 Ex 增量约束事件与当事人，再看后续效果。',
    HSA: '群体事件分配区域当事人。尸体移动和尸体数量按事发时盘面核验，纸老虎的不死与拒绝取决于有效不安。',
    WM: '疯狂的真相需要情报商和另一条主线。Ex 影响禁止密谋牌及跨轮回效果，拒绝后增加的 Ex 单独处理。',
    AHR: '主副线指定的表里身份成对占一个名额，模仿犯复制整对。Ex 改变当前面和能力门槛；身份公开时保留对应的初始分配。',
    LL: '三个私有席位保留六种排列。捏造的秘密按身份池和密钥分支，公开事件当事人按日期约束，死亡标记和最终猜测另核验。',
  };
  for (const mod of officialModules)
    for (const plus of supportsAnniversary(mod) ? [false, true] : [false]) {
      configurations++;
      const pack = compileOfficial(mod, plus),
        roster = Object.keys(pack.characters).map((character) => ({ character, id: character }));
      const cat = new PruningCatalog(
        pack,
        { incidents: Object.keys(pack.incidents).map((name, i) => ({ name, day: i + 1 })) },
        roster,
      );
      const scenario = fixtures.find((f) => f.setup.module === mod);
      const setup = officialScenarioSetup(mod, plus);
      const started = initializeDiscussion(pack, setup);
      assert.ok(started.state, JSON.stringify(started.diagnostics));
      const opening = initialPlacementView(started.state);
      // This acceptance case supplies the roster explicitly, without any hidden role or arrival parameter.
      opening.roster = setup.characters.map(({ id, character }) => ({ id, character }));
      const solver = new LiveKnowledge(pack, opening);
      assert.deepEqual(solver.reasons, []);
      assert.equal(solver.queryConfiguration(setup), 'possible', mod);
      checks.push(
        '<li>' +
          esc(
            mod +
              (plus ? ' 周年追加' : ' 基础版') +
              ' · ' +
              scenario.id +
              ' · 开局真配置已找到见证',
          ) +
          '　<a download="' +
          mod +
          (plus ? '-anniversary' : '') +
          '-setup.json" href="data:application/json;charset=utf-8,' +
          esc(encodeURIComponent(JSON.stringify(setup, null, 2))) +
          '">下载可导入的测试剧本（含隐藏设定）</a></li>',
      );
      const entities = [];
      for (const { owner, ability } of pack.moduleAbilities) {
        const list = cat.sourcesFor('modules', owner);
        sources += list.length;
        entities.push(
          '<details data-rule><summary>' +
            esc('模组 · ' + owner + ' · ' + ability.id) +
            '</summary><ol>' +
            list.map((s) => effect(s, cat)).join('') +
            '</ol>' +
            details('共享规则原始定义', ability) +
            '</details>',
        );
      }
      for (const group of ['characters', 'identities', 'plots', 'incidents'])
        for (const d of Object.values(pack[group])) {
          const list = cat.sourcesFor(group, d.name);
          const nonIndexed = (d.abilities ?? []).filter(
            (a) => !list.some((s) => s.ability?.id === a.id),
          );
          const nonIndexedRows = nonIndexed
            .map((a) =>
              para(
                '非直接来源 · ' + a.id,
                name(a.timing) +
                  '。' +
                  (a.threshold !== undefined
                    ? goodwillPolicy(a)
                    : '如有正式披露，按披露变量传播；隐藏标志、加牌或其他后续影响在相应窗口或历史回放核验。'),
              ),
            )
            .join('');
          sources += list.length;
          entities.push(
            '<details data-rule><summary>' +
              esc(name(group) + ' · ' + d.name + '　｜　' + list.length + ' 个可见效果来源') +
              '</summary>' +
              other(group, d, pack) +
              (list.length
                ? '<ol>' + list.map((s) => effect(s, cat)).join('') + '</ol>'
                : para(
                    '本次变化',
                    '没有可从普通步骤编译的直接来源；继续使用建域、正式披露、角色特性、观察窗口或回放。不能因此删除规则。',
                  )) +
              nonIndexedRows +
              details('共享规则原始定义', d) +
              '</details>',
          );
        }
      rows.push(
        '<section data-pack="' +
          mod +
          '"><h3>' +
          mod +
          ' · ' +
          (plus ? '启用周年追加' : '基础版') +
          '　' +
          entities.length +
          ' 条目</h3><p>规则摘要 <code>' +
          pack.digest +
          '</code></p>' +
          para('观察与剪枝', moduleNotes[mod]) +
          details('开局规则', pack.setupRules) +
          entities.join('') +
          '</section>',
      );
    }
  return (
    '<section id="compiled"><h2>逐条编译清单：什么时候纳入、什么时候跳过</h2>' +
    para(
      '主人公主动发动',
      routes.declaredEffect.include + routes.declaredEffect.skip + routes.declaredEffect.result,
    ) +
    '<details><summary>逐模组开局实测（提供完整角色名册）</summary><ul>' +
    checks.join('') +
    '</ul></details>' +
    '<p>下表取自生产求解器。' +
    configurations +
    ' 种配置共 ' +
    sources +
    ' 个编译来源（含各版共有来源）。展开条目查看实际参数。阶段与变化匹配后才检查目标、快照和公开条件；未知保留。间接来源随实际开局名册和事件表收窄。此处用全名册展示可能入口，不把它当成一个合法剧本。</p><p>跳过一个来源只对本观察有效。删除候选配置还需要名额冲突、正式披露矛盾、闭合窗口中全部解释被排除，或完整历史穷尽。搜索预算耗尽为未决。页面后半部分的逐项样例补充行动牌、特殊角色、窗口和回放路径。</p><details><summary>按观察窗口查：触发、跳过与结论</summary>' +
    Object.entries(routes)
      .map(
        ([id, r]) =>
          '<article><b>' +
          esc(id) +
          '</b>' +
          para('纳入', r.include) +
          para('跳过／保留', r.skip) +
          para('结论', r.result) +
          '</article>',
      )
      .join('') +
    '</details><label>选择模组 <select id="compiled-mod"><option value="">全部</option>' +
    officialModules.map((m) => '<option>' + m + '</option>').join('') +
    '</select></label><label>查找编译条目 <input id="compiled-query" placeholder="例如：医院事故"></label>' +
    rows.join('') +
    '</section>'
  );
}
