// pnpm exec tsx scripts/engine/pruning-order.mjs <solver checkout>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const solver = path.resolve(process.argv[2] ?? root);
const runtime = 'packages/engine/src/runtime/';
const get = (p) => import(pathToFileURL(path.join(solver, p)).href);
const { compileOfficial } = await get('packages/content/src/official/compile.ts');
const { PruningCatalog, indexOwners, eligibleSource } = await get(runtime + 'knowledge-pruning.ts');
const { initialState, validateSetup } = await get(runtime + 'setup.ts');
const { project } = await get(runtime + 'ports.ts');
const { LiveKnowledge } = await get(runtime + 'knowledge-live.ts');
const entries = JSON.parse(
  fs.readFileSync(path.join(solver, 'packages/content/src/official/source-catalog.json')),
).entries;
const packs = Object.fromEntries(['FS', 'BTX'].map((m) => [m, compileOfficial(m)]));
const rows = [];
const both = 'FS、BTX';
const moduleFor = (e) =>
  entries.some(
    (v) =>
      v.kind === e.kind &&
      v.name === e.name &&
      v.module &&
      v.module !== e.module &&
      ['FS', 'BTX'].includes(v.module),
  )
    ? both
    : e.module;
const loc = {
  index: ['knowledge-pruning', 'forChange(phase:'],
  range: ['knowledge-pruning', 'export function indexOwners'],
  eligible: ['knowledge-pruning', 'export function eligibleSource'],
  effect: ['knowledge-scope', 'private visibleEffect('],
  diff: ['knowledge-scope', 'private classifyChanges('],
  cause: ['knowledge-causes', 'export class CauseNetwork'],
  clock: ['knowledge-scope', 'private mandatoryWindow('],
  end: ['knowledge-scope', 'private closedDayEnd('],
  bypass: ['knowledge-scope', 'private bypass('],
  cards: ['knowledge-cards', '  collect(o:'],
  happen: ['knowledge-pruning', '  permitsOccurrence('],
  incident: ['knowledge-scope', 'private incident('],
  empty: ['knowledge-scope', 'private quietIncident('],
  pair: ['knowledge-pair', 'export class PairExecution'],
  arrive: ['knowledge-scope', 'private arrival('],
  reset: ['knowledge-scope', 'private reset('],
  refuse: ['knowledge-scope', 'private refusal('],
  trait: ['knowledge-traits', 'export function intrinsicCauses'],
  domain: ['knowledge-domain', 'export function buildProfiles'],
  disclose: ['knowledge-domain', 'export function applyDisclosure'],
  hist: ['knowledge-history', '  step()'],
  avail: ['engine', 'function available('],
  batch: ['engine', 'function processBatch('],
  play: ['engine', 'export function drive('],
  init: ['setup', 'export function validateSetup'],
  receive: ['knowledge-live', '  append('],
  change: ['knowledge-effects', 'export function compileEffects'],
  public: ['knowledge-scope', '  publicUpdate('],
  condition: ['knowledge-conditions', 'export function publicValue'],
  move: ['settlement', 'export function settle('],
  finish: ['engine', 'function finalizeLoop('],
  legal: ['engine', 'export function legalCardTargets'],
};
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function source(key) {
  const [name, anchor] = loc[key],
    file = path.join(solver, runtime + name + '.ts');
  const line =
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .findIndex((l) => l.includes(anchor)) + 1;
  assert.ok(line, key);
  return (
    '<a href="' +
    esc(pathToFileURL(file).href) +
    '"><code>' +
    esc(name + '.ts:' + line) +
    '</code></a>'
  );
}
function row(mod, kind, name, unit, example, route, steps, end, refs, raw) {
  rows.push({
    mod,
    kind,
    name,
    unit,
    example,
    route,
    steps: steps.split('｜'),
    end,
    refs: refs.split(' '),
    raw,
  });
}
const labels = {
  school: '学校',
  shrine: '神社',
  hospital: '医院',
  city: '都市',
  far: '远方',
  paranoia: '不安',
  intrigue: '密谋',
  goodwill: '友好',
  hope: '希望',
  despair: '绝望',
  guard: '护卫',
  kill: '死亡',
  revive: '复活',
  move: '移动',
  remove: '移出',
  failure: '主人公失败',
  'protagonist-death': '主人公死亡',
  'mastermind-abilities': '剧作家能力阶段',
  'protagonist-abilities': '主人公能力阶段',
  'day-end': '回合结束',
  'loop-end': '轮回结束',
  incident: '事件阶段',
  death: '死亡触发',
  'card-resolution': '行动结算',
  '*': '跨阶段／触发后',
  alive: '存活',
  dead: '死亡',
  $counter: '所选指示物',
};
const cn = (k) => labels[k] ?? k;
function rumor(mod) {
  const pack = packs[mod],
    setup = {
      module: mod,
      anniversary: false,
      loops: 2,
      days: 2,
      captain: 'p0',
      discussion: 'allowed',
      y: '',
      x: [],
      incidents: [],
      characters: ['男学生', '女学生', '职员', '巫女'].map((character, i) => ({
        id: 'abcd'[i],
        character,
        identity: '平民',
      })),
    };
  setup.y = mod === 'FS' ? '守护此地' : '被封印的邪灵';
  setup.x = mod === 'FS' ? ['流言四起'] : ['流言四起', '因果线'];
  setup.characters.forEach((c, i) => {
    c.identity = ['传谣人', '平民', '邪教徒', mod === 'FS' ? '关键人物' : '主谋'][i];
  });
  assert.deepEqual(validateSetup(pack, setup), []);
  const s = initialState(pack, setup),
    k = new LiveKnowledge(pack, project(s, 'protagonists')),
    before = k.snapshot();
  const o = { loop: 1, day: 1, phase: 'mastermind-abilities' };
  const opening = project(s, 'protagonists'),
    roster = opening.characters.map(({ id, character }) => ({ id, character }));
  const catalog = new PruningCatalog(pack, opening, roster),
    characters = new Map(opening.characters.map((c) => [c.id, c]));
  const change = {
    kind: 'counter',
    target: 'b',
    counter: 'paranoia',
    sign: 1,
    before: 0,
    after: 1,
  };
  const lookup = (clock, delta) =>
    catalog.forChange(clock.phase, delta).identities.get('传谣人') ?? [];
  const [gossip] = lookup(o, change);
  assert.ok(gossip);
  assert.equal(lookup({ ...o, phase: 'protagonist-abilities' }, change).length, 0);
  assert.equal(lookup(o, { ...change, counter: 'intrigue' }).length, 0);
  assert.equal(lookup(o, { ...change, sign: -1 }).length, 0);
  const owners = indexOwners(roster, characters, change, false, pack)(gossip).map((c) => c.id);
  assert.deepEqual(owners.slice().sort(), ['a', 'b']);
  const allowed = (owner, delta) =>
    eligibleSource(
      gossip,
      delta,
      {
        clock: o,
        days: 2,
        loops: 2,
        pack,
        characters,
        boards: opening.boards,
        owner,
        target: 'b',
        bindings: { target: 'b' },
        staticOnly: false,
      },
      { phase: o.phase, deaths: new Set(), occurrence: new Map() },
    );
  assert.deepEqual(
    owners.map((id) => allowed(id, change)),
    [true, true],
  );
  assert.equal(allowed('a', { ...change, after: 2 }), false);
  k.append(
    [
      { ...o, sequence: 1, type: 'boundary', data: { phase: o.phase, captain: 'p0' } },
      {
        ...o,
        sequence: 2,
        type: 'character',
        data: {
          character: 'b',
          area: 'school',
          status: 'alive',
          counters: { ...s.characters.b.counters, paranoia: 1 },
        },
      },
    ],
    0,
    2,
  );
  const after = k.snapshot();
  assert.deepEqual(new Set(after.scope.characters), new Set(['a', 'b']));
  assert.equal(pack.identities['传谣人'].max, 1);
  assert.deepEqual(
    new Set(after.scope.alternatives),
    new Set(['男学生（a）是传谣人（gossip）', '女学生（b）是传谣人（gossip）']),
  );
  return {
    before: before.ruleCombinations.length,
    after: after.ruleCombinations.length,
    alternatives: after.scope.alternatives,
    skipped: after.scope.skippedCharacters,
    remote: after.identities.c.includes('传谣人'),
    owners,
  };
}
const runs = Object.fromEntries(['FS', 'BTX'].map((m) => [m, rumor(m)]));
const records = entries.filter((e) => ['FS', 'BTX'].includes(e.module) || e.kind === 'characters');
for (const e of records)
  assert.deepEqual(e.fields, JSON.parse(fs.readFileSync(path.join(root, e.source))).fields, e.name);
row(
  'FS',
  '模组',
  'First Steps',
  '一条 X',
  '选择“守护此地＋流言四起”。',
  '建域',
  '按 Y 建分支｜每个 X 单独配一个 Y｜依规则池分配身份，资源不足即丢弃分支',
  '不会生成两条 X 的 FS 分支。',
  'domain init',
);
row(
  'BTX',
  '模组',
  'Basic Tragedy X',
  '两条不同 X',
  '选择“改变未来＋流言四起＋因果线”。',
  '建域',
  '枚举一个 Y｜按索引从 X 列表取不同的两个｜合并身份名额后传播',
  '同一 X 重复两次、仅一条 X 都不在初始组合中。',
  'domain init',
);
for (const m of ['FS', 'BTX'])
  row(
    m,
    '模组',
    m,
    '末轮失败后的阶段',
    '末轮失败，观察接下来的阶段。',
    '历史',
    '读取轮末失败及剩余轮数｜用 finalizeLoop 推进候选｜比较结束或最终决战的公开记录',
    m === 'FS'
      ? '末轮直接剧作家胜利，进入最终决战的轨迹不相容。'
      : '末轮转入最终决战，直接宣布剧作家胜利的这一跳不相容。',
    'finish hist',
  );
for (const e of records.filter((e) => e.kind === 'rules')) {
  const p = e.fields;
  for (const [id, n] of Object.entries(p.identityCounts)) {
    row(
      e.module,
      '规则 ' + p.ruleType,
      e.name,
      '配置 ' + id + ' ' + n,
      id === '暴徒' ? '试配 0、1、2、3 名暴徒。' : '在该规则组合中把一位应配置的' + id + '改成平民。',
      '建域',
      '选择含此规则的 Y/X 组合｜累计各规则的' +
        id +
        '名额' +
        (id === '暴徒' ? '，另从 0 到名额上限枚举人数' : '，按身份上限截断') +
        '｜扣除不占普通位的角色，余位补平民｜把名额约束加到角色域并传播',
      id === '暴徒'
        ? '其他条件满足时，0、1、2 各有相应分支；3 没有。'
        : '普通位无法满足该组合的名额时排除相应赋值；名额本身不指认哪一名角色。',
      'domain init',
    );
  }
  if (!Object.keys(p.identityCounts).length)
    row(
      e.module,
      '规则 ' + p.ruleType,
      e.name,
      '无追加身份',
      '因果线与另一条 X 同时列入剧本。',
      '建域',
      '读取因果线的空身份表｜只累计另一规则及 Y 的名额｜为余位补平民',
      '不会因选择因果线而凭空追加一种身份。',
      'domain',
    );
}
const plotCases = {
  守护此地: [
    '学校密谋 1 或 2，轮末出现失败。',
    '按轮末失败查来源｜取轮末入口的公开盘面，判学校密谋 ≥2｜为包含本 Y 的组合保留该失败原因',
    '1 时排除此来源，2 时保留；仍须考虑其他失败来源。',
  ],
  被封印的邪灵: [
    '神社密谋 1 或 2，轮末出现失败。',
    '按轮末失败查来源｜在轮末入口检查神社密谋 ≥2｜把通过的本 Y 作为候选原因',
    '不满足阈值的版图不能支持这一失败来源。',
  ],
  复仇的火种: [
    '学校有 2 密谋，候选主谋最初在学校或医院。',
    '按轮末失败查规则｜效果依赖角色的隐藏身份和初始区域，公开条件可返回未知｜历史层枚举主谋，取其初始版图密谋，再比较失败记录',
    '学校起始且达标可解释；仅当前位于学校不足以确定本 Y。',
  ],
  巨大定时炸弹X: [
    '魔女从都市移往学校，都市密谋 2，学校 0。',
    '检索轮末失败｜保留含本 Y 的条件来源｜历史层定位魔女并读取初始区域，以该版图 ≥2 结算',
    '移动后的学校密谋不是判定值。',
  ],
  '和我签订契约吧！': [
    '关键人物候选密谋 1 或 2，轮末出现失败。',
    '检索轮末失败｜查询存活角色中的关键人物及其密谋；身份未知时保留｜历史层用具体身份和密谋检查是否至少一人达标',
    '仅有一名普通角色密谋 2 不能锁定本规则。',
  ],
  改变未来: [
    '蝴蝶效应列在日程，但本轮明确未发生。',
    '检索轮末失败｜按事件名及日期读取本轮发生记录｜已知均未发生则条件为假，缺记录保留未知',
    '有日程不等于已发生；明确发生才支持此失败条件。',
  ],
  流言四起: [
    '剧作家阶段，空无角色的都市版图密谋 0→1。',
    '按阶段、版图密谋增加检索｜规则来源检查版图目标与增量，不按角色区域筛选｜加入包含本 X 的组合，并与同轮已用次数合并',
    '若本轮次数已经用完，这次变化不能再归给流言四起。',
  ],
  妄想扩大病毒: [
    '平民不安达到 3，随后公开为杀人狂。',
    '实际结算按初始平民、存活和有效不安重算当前身份｜日末死亡原因分析可加入转化分支｜正式公开杀人狂时，含本 X 的组合也保留初始平民的前像',
    '公开身份处的快捷筛选没有再次核对 3 枚门槛，剩余解释须回放。',
  ],
  因果线: [
    '上一轮末 a 有友好，下一轮开始至日开始都没有不安增加。',
    '讨论边界记下上轮有友好或希望者｜轮初建立存活者待查名单｜连续窗口内有不安增加即划去｜窗口完整关闭仍缺 a 时排除含本 X 的组合',
    '窗口只核对是否增加；应增加 2 的精确数量由历史结算核对。',
  ],
};
for (const e of records.filter((e) => e.kind === 'rules' && plotCases[e.name])) {
  const [example, steps, end] = plotCases[e.name];
  row(
    e.module,
    '规则 ' + e.fields.ruleType,
    e.name,
    '运行效果',
    example,
    '即时＋历史',
    steps,
    end,
    e.name === '因果线'
      ? 'clock trait'
      : e.name === '妄想扩大病毒'
        ? 'effect disclose hist'
        : 'index eligible effect hist',
  );
  if (e.name === '和我签订契约吧！')
    row(
      e.module,
      '规则 Y',
      e.name,
      '关键人物的少女属性',
      '普通男学生与女学生分别尝试配置为关键人物。',
      '建域',
      '在本 Y 的组合里枚举身份｜检查普通角色是否有少女属性｜删去不合者的关键人物取值，再传播名额',
      '女学生保留，普通男学生排除。模仿犯虽不占普通名额，复制关键人物时仍须有少女属性，因此也排除。',
      'domain init',
    );
}

const identityCases = {
  传谣人: [
    [
      '任意 · 不安 +1',
      '学校 b 不安 0→1，同区还有 a，c、d 在外区。',
      '核对阶段边界与角色前后盘面｜按剧作家阶段、指示物、不安、增加检索｜对同区来源以 b 所在学校筛人｜核对仍存活、目标合法及数值正好 +1｜将 a 或 b 是传谣人写入各组合的原因约束',
      '在举例盘面只剩 a、b 可发动；角色可选自己。',
      'index range eligible cause',
    ],
  ],
  主谋: [
    [
      '角色密谋 +1',
      '学校 b 密谋 0→1。',
      '识别剧作家阶段角色密谋增加｜筛同区角色来源｜核对目标和 +1｜绑定候选发动者的主谋身份及阶段次数',
      '外区普通主谋不能解释本次变化。',
      'index range eligible effect',
    ],
    [
      '版图密谋 +1',
      '都市版图密谋 0→1，a 在都市，b 在学校。',
      '版图变化走剧作家专门入口｜取主谋的角色或版图选择器｜按都市筛主人并核对 +1｜并列其他可用版图来源',
      '排除 b 作为本次主谋来源；a 与全局规则仍可构成替代解释。',
      'effect range eligible',
    ],
  ],
  关键人物: [
    [
      '死亡触发失败',
      'a 死亡后紧接主人公失败。',
      '收集阶段窗口内的死亡者｜对失败报告检索死亡反应｜候选主人必须可能已在该窗口死亡｜在其身份域中挂入关键人物解释',
      '有多名同时死亡者时不据此任选一人定身份。',
      'effect eligible hist',
    ],
  ],
  杀手: [
    [
      '日末杀关键人物',
      '日末同区 b 密谋 2 并死亡；对照 b 只有 1。',
      '死亡报告查日末可杀人来源｜筛目标所在区域、存活及密谋条件（快照可判时）｜关键人物属于隐藏条件，具体赋值在历史核验｜可选能力还要有发动分支',
      '门槛未达不支持此杀手路径；未杀人不能反推没有杀手。',
      'eligible condition hist',
    ],
    [
      '日末杀主人公',
      '日末主人公死亡，a 自身密谋 3 或 4。',
      '区分主人公死亡与普通失败｜检索日末来源｜检查发动者自身有效密谋 ≥4；公开状态不足时保留｜回放发动或放弃',
      '4 可发动，3 不可；此条不按受害角色所在区域筛。',
      'index eligible hist',
    ],
  ],
  邪教徒: [
    [
      '无效化禁止密谋',
      '学校同时有密谋 +1 和有效禁止密谋，实际仍增加。',
      '核对翻牌及结算窗口｜匹配应被禁止的密谋变化｜排查替身及其他结算来源｜枚举同区存活者，给可持邪教徒者添加至少一人条件',
      '保留实际同区者与可能从领地发动的大人物。回放核对领地及本次所选区域；一次发动只覆盖一个区域。',
      'cards bypass',
    ],
  ],
  亲友: [
    [
      '死于轮末状态检查',
      '轮末 a 已死，出现公开 a 为亲友及失败。',
      '正式身份公开先约束 a 的身份域｜失败另走轮末原因检索，检查死亡状态｜历史验证该角色的公开及失败顺序',
      '轮末活着的 a 不能通过本条造成失败。',
      'disclose effect hist',
    ],
    [
      '曾正式公开，轮初友好 +1',
      '新一轮 a 获得 1 友好。',
      '轮初友好增加 → 查询 a 身份域是否含亲友｜加入亲友可能解释｜历史层检查 a 是否活着、先前确实公开并结算 +1',
      '快捷分支没有以“曾公开”筛尽候选；推测身份不能触发这项加成。',
      'trait play hist',
    ],
  ],
  时间旅者: [
    [
      '无视禁止友好',
      '目标有禁止友好与友好增加牌，结算后友好仍增加。',
      '核对翻牌和变化｜禁止被绕过时绑定目标自身为时间旅者｜若完整窗口关闭而应有的增加没出现，排查替身或其他来源后删除该身份',
      '此处限定角色身上的牌。幻想受其版图上的禁止友好影响，即使身份为时间旅者也不能绕过。',
      'cards bypass',
    ],
    [
      '最终日失败',
      '最终日日末 a 友好为 2，主人公失败。',
      '按日末失败检索｜条件先看今日等于最终日，再看自身有效友好 ≤2｜历史层区分主动使用与放弃',
      '友好 3 或非最终日排除此来源；放弃时仍可持该身份。',
      'index eligible hist',
    ],
  ],
  求爱者: [
    [
      '心上人死亡后不安 +6',
      'b 死亡，a 不安 0→6。',
      '记录窗口内死者｜发现另一角色不安增加｜取 a 可为求爱者、b 可为心上人的成对身份解释｜历史检查确切 +6',
      '快捷特性分支只看正向变化及配对，不能仅凭增加锁定身份。',
      'trait effect hist',
    ],
    [
      '日末杀主人公',
      '主人公死亡；a 不安 3，密谋 0 或 1。',
      '主人公死亡报告查日末来源｜检查自身密谋 ≥1，再查不安 ≥3｜满足两项才支持发动；搜索保留放弃分支',
      '密谋 0 不可用，不安 2 同样不可用。',
      'index eligible hist',
    ],
  ],
  心上人: [
    [
      '求爱者死亡后不安 +6',
      'b 死亡，a 不安 1→7。',
      '记录死者｜发现 a 不安增加｜以 a 心上人、b 求爱者建立成对支持｜历史检查 +6',
      '区域不限制此死亡反应；不能只看 a 所在区域。',
      'trait effect hist',
    ],
  ],
  杀人狂: [
    [
      '日末同区恰一人',
      'a、b 同区且存活；日末 b 死亡，或整个日末安静。',
      '死亡时查日末强制来源与入口人数｜若日末完整且无变化，重新计算同区其他存活者是否恰为一人｜在支持的普通盘面加入“a 若是杀人狂，则 b 必有不死身份”的关系',
      '零人或两人都不满足。存在保护、替代等未解决情况时不能直接排除。',
      'end eligible hist',
    ],
  ],
  不安定因子: [
    [
      '学校密谋 ≥2 借传谣人能力',
      '学校已有 2 密谋，剧作家阶段 b 不安 +1。',
      '先按传谣人效果查阶段与同区发动者｜再读候选发动者身份｜若可为不安定因子且学校密谋 ≥2，也加入来源',
      '新解释保留不安定因子的原身份。',
      'effect eligible',
    ],
    [
      '都市密谋 ≥2 借关键人物能力',
      '都市密谋 1 或 2，a 死亡并发生失败。',
      '死亡反应进入关键人物来源｜即时路径给不安定因子也加入该反应｜该处没有与学校分支对称的都市 ≥2 检查｜历史层核对都市门槛',
      '都市只有 1 时，不能把快捷候选当成真实可发动的见证。',
      'effect hist',
    ],
  ],
  暴徒: [
    [
      '剧本制作时，自选 0 至 2 名',
      'FS 选「最黑暗的剧本」，其余必需身份已配齐，三个普通位可配平民或暴徒。',
      '读取所选规则的暴徒名额｜按 0、1、2 名分别建域｜检查普通位是否够用，余位补平民｜枚举满足各身份名额的赋值',
      '三个普通位分别配置 0、1、2 名暴徒时，对应保留 1、3、3 种赋值；三个全是暴徒时排除。',
      'domain init',
    ],
  ],
};
for (const e of records.filter((e) => e.kind === 'identities')) {
  if (rows.some((r) => r.kind === '身份' && r.name === e.name)) continue;
  const mod = moduleFor(e);
  for (const [unit, example, steps, end, refs] of identityCases[e.name] ?? [])
    row(mod, '身份', e.name, unit, example, e.name === '暴徒' ? '建域' : '即时＋历史', steps, end, refs);
  if (e.fields.traits?.replace(/\s/g, '').includes('无视'))
    row(
      mod,
      '身份',
      e.name,
      e.fields.traits.replace(/\s/g, ''),
      '普通角色提出友好请求，随后公开拒绝。无希望或绝望。',
      '即时＋历史',
      '匹配拒绝者及其确有的角色能力｜遍历拒绝者的候选身份并处理当前身份变化｜按希望、绝望和身份无视友好特性筛选｜传播拒绝者身份域',
      '保留可拒绝或必拒绝的身份。对于独立请求且可拒绝的友好能力，声明后的下一条公开观察未出现必定拒绝时，按当时的希望、绝望与身份缩窄。',
      'refuse hist',
    );
  if (e.fields.traits === '不死')
    row(
      mod,
      '身份',
      e.name,
      '不死',
      '普通角色 a 从存活变为死亡。',
      '即时',
      '比较同一角色前后状态｜确认真实存活→死亡｜排除替身特例后，从 a 的身份域删除有不死特性的值并传播',
      '仅看到死亡请求、护卫减少或无人死亡时，不能套用这个删除条件。',
      'effect move',
    );
}
row(
  both,
  '身份',
  '平民',
  '填补空位',
  '普通登场者多于所需剧情身份。',
  '建域',
  '统计普通角色数｜减去所需身份数｜余位补平民并传播，另核对角色配置限制',
  '平民没有独立的主动效果来源。',
  'domain',
);
const events = {
  自杀: [
    [
      '当事人死亡',
      '事件已发生，a 死亡。',
      '按事件死亡查到目标为当事人自身｜绑定受害者与当事人；保留替身、代死等可行解释｜核对生存状态',
      '普通、无替代的盘面下，异人的当事人候选不能解释 a 自杀。',
    ],
  ],
  谋杀: [
    [
      '杀同区另一人',
      '学校 b 死亡，a 在学校，c 在都市。',
      '按事件死亡检索｜按当事人筛目标的同区与非自身条件；位置不安全时保留｜把仍可解释 b 死亡的事件、当事人成对绑定',
      '普通盘面可排除 b 自杀式的解释以及异区 c；未知虚拟位置不得硬删。',
    ],
  ],
  远距离杀人: [
    [
      '目标密谋 ≥2',
      '医院 b 密谋 2 并死亡，a 在学校。',
      '按事件死亡检索｜看目标密谋条件｜该选人不依赖当事人所在区域｜用事件发生门槛另查当事人',
      '死亡本身不能排除异区的 a。',
    ],
  ],
  医院事故: [
    [
      '医院密谋 ≥1：院内角色死亡',
      '医院密谋 1，a 在院内，b 在学校。',
      '读已发生的事件｜按入口医院密谋及位置求应受害者｜追踪逐个死亡、护卫与幸存者｜窗口关闭时检查剩余解释',
      '不能把院内死者认定为当事人。',
    ],
    [
      '医院密谋 ≥2：主人公死亡',
      '只有 1 枚和已有 2 枚密谋两种盘面。',
      '按主人公死亡报告查事件来源｜检查医院密谋 ≥2｜保留明确达标或尚不能判假的条件，历史核验保护及结算',
      '一枚只触发角色死亡条款，不能单靠它解释主人公死亡。',
    ],
  ],
  不安扩散: [
    [
      '第一步加 2 不安',
      'a 从 0 不安变成 2。',
      '确认发生｜从变化类型匹配第一步｜记录第一目标 a 和可行的执行位置',
      '此步骤目标可以异区。',
    ],
    [
      '第二步给另一人加 1 密谋',
      '接着 b 密谋 0→1。',
      '读取第一步候选｜匹配第二步的种类、数值及不同目标｜窗口关闭时检查是否走完整条两步路径',
      '普通单次结算中 a 不能兼为两个目标。',
    ],
  ],
  散播: [
    [
      '第一步减 2 友好',
      'a 只有 1 友好，观察 1→0。',
      '从事件发生打开窗口｜匹配第一步的负方向和扣到零的实际变化｜保存仍可行的第一目标',
      '不能强求观测净差一定为 −2。',
    ],
    [
      '第二步给另一人加 2 友好',
      '随后 b 友好 0→2。',
      '匹配第二步正向友好｜与第一目标作不同人约束｜保留完整两步和可能的无变化步骤',
      '仅凭这两步不能推定当事人和 b 同区。',
    ],
  ],
  蝴蝶效应: ['友好', '不安', '密谋'].map((k) => [
    '同区 ' + k + ' +1',
    '学校 b 的' + k + '从 0 到 1。',
    '按事件阶段和' + k + '增加检索｜绑定选择的指示物与受影响者｜筛当事人对该目标的同区可达性',
    '普通盘面保留同区候选，也允许当事人选自己。',
  ]),
  邪气污染: [
    [
      '神社密谋 +2',
      '神社密谋 0→2，当事人可能在都市。',
      '按事件阶段的版图密谋增加检索｜目标必须是固定神社｜事件效果与当事人位置独立，另判发生条件',
      '不据此删除都市当事人。',
    ],
  ],
  失踪: [
    [
      '移动当事人',
      'a 从学校移动到都市。',
      '匹配事件移动｜检查移动者是否可作为当事人、目的版图是否可达｜保存本次移动所支持的来源',
      '同一事件的下一步仍要核对版图密谋。',
    ],
    [
      '在所在版图加 1 密谋',
      'a 移到都市后，都市密谋 +1。',
      '匹配事件版图密谋变化｜读取当事人所在版图，结合已知移动或未知位置保留解释｜搜索确认同一当事人的顺序和移动结果',
      '不能把起始版图当作第二步的固定目标。',
    ],
  ],
};
for (const e of records.filter((e) => e.kind === 'incidents')) {
  if (rows.some((r) => r.kind === '事件' && r.name === e.name)) continue;
  const mod = moduleFor(e);
  row(
    mod,
    '事件',
    e.name,
    '发生／未发生',
    '普通 a 达到不安限度，普通 b 差一枚，日程记为' + e.name + '。',
    '即时',
    '核对事件阶段、日期和发生标志｜按当天事件名 × 当事人枚举｜先查存活，再算有效不安及限度，比较结果与发生标志｜对可相容的二元组传播',
    '已发生排除 b，未发生排除 a；特殊阈值、黑猫的效果取消和私有条件要分开处理。',
    'incident happen',
  );
  for (const [unit, ex, steps, end] of events[e.name])
    row(
      mod,
      '事件',
      e.name,
      unit,
      ex,
      '即时＋历史',
      steps,
      end,
      ['散播', '不安扩散'].includes(e.name)
        ? 'incident pair empty'
        : 'incident effect eligible empty',
    );
}

const traits = {
  学者: [
    [
      '轮初选择指示物',
      'a 轮初友好 0→1。',
      '先认轮初并定位变化角色｜允许学者自身正向友好、不安或密谋为特性来源｜具体选哪一枚由历史核验',
      '单靠学者自身增加不能锁定其隐藏身份。',
      'trait',
    ],
  ],
  御神木: [
    [
      '剧作家阶段强制转移',
      '剧作家阶段 a 少 1 不安，b 多 1 不安。',
      '为御神木额外编译剧作家阶段转移来源｜匹配一减一增并保留目标选择｜回放时检查生效身份能无视友好、存在可转移指示物及同区目标',
      '即时来源记录不独立证明御神木的隐藏身份。',
      'index effect play',
    ],
  ],
  AI: [
    [
      '不能配置平民',
      '尝试给 AI 配置平民。',
      '枚举配置身份｜对普通身份取基础值｜遇 AI＋平民即从域中剔除',
      '直接排除这个开局赋值。',
      'domain init',
    ],
    [
      '事件阈值按所有实物合计',
      '不安 0、友好 4 的 AI 担任自杀当事人。',
      '读事件发生标志｜存活检查｜普通不安事件改用全部实际指示物总数｜与限度 4 比较',
      '4 可以发生，3 不达标；不会重复计入希望、绝望。',
      'happen',
    ],
  ],
  从者: [
    [
      '跟随移动',
      '大小姐与从者同区，大小姐移动。',
      '匹配从者移动报告｜保留跟随来源｜历史在移动前快照筛同区保护对象；有多个目的地时枚举跟随选择',
      '从者移动无需另有一张给从者的移动牌。',
      'trait cards move',
    ],
    [
      '代替死亡',
      '大小姐受死亡请求，从者死而大小姐存活。',
      '看到从者死亡或消耗护卫则保留替代解释｜历史读取同区、受保护者和死亡请求｜核对最终死亡与护卫记录',
      '不能仅凭从者死亡把从者锁为原始攻击目标。',
      'trait move',
    ],
  ],
  临时工: [
    [
      '有效身份覆盖',
      '临时工配置主谋，生效身份公开为平民。',
      '辨认原卡或替身｜公开身份的快捷路径跳过初始身份等同约束｜回放时原卡按平民结算',
      '配置主谋仍可保留。',
      'disclose hist',
    ],
    [
      '总指示物 ≥3 日末死亡',
      'a 有 2 不安和 1 友好，日末死亡。',
      '日末死亡或耗护卫先收录临时工特性来源｜历史累加实际枚数并检验 ≥3｜结算死亡请求',
      '快捷原因不核对每枚数量；总计 2 的解释须在历史中淘汰。',
      'trait play hist',
    ],
    [
      '死亡后替身登场',
      '原卡昨日死亡，今日都市出现临时工？。',
      '名册预留替身｜日初回放检查原卡死亡与替身尚未登场｜比对替身都市出现的报告',
      '仅见替身不揭示原配置身份。',
      'effect play hist',
    ],
  ],
  '临时工？': [
    [
      '继承配置身份',
      '公开替身为主谋，原临时工场上的身份曾为平民。',
      '识别替身｜applyDisclosure 跳过直接缩窄｜历史从原剧本配置初始化替身并比对公开身份',
      '替身的公开结果不应按原卡生效平民处理。',
      'disclose hist',
    ],
    [
      '继承当事人',
      '原卡已死，替身达到事件限度。',
      '事件表按原配置编号取候选｜快捷路径保留代理及私有触发｜历史分别检查原卡、替身是否能触发和执行',
      '不能因原卡已死就删除其当事人配置。',
      'happen incident play',
    ],
  ],
  妹妹: [
    [
      '不得配置无视友好身份',
      '妹妹候选为杀手或平民。',
      '枚举该规则池的身份｜查询身份的 ignore 标志｜从妹妹的配置域排除有该标志的值，再传播',
      '排除杀手，平民还须满足剩余名额。',
      'domain init',
    ],
  ],
  大人物: [
    [
      '指定领地',
      '大人物位于都市，公开领地为学校。',
      '建立角色身份域｜将 territory 限定为公开标志的学校；旧输入缺少标志时保留四个版图｜历史枚举并核对使用该领地的选择',
      '起始位置不能替代领地。',
      'domain hist',
    ],
    [
      '剧作家可按领地位置发动',
      '本人在都市，学校出现角色来源的效果。',
      '过滤同区来源时保留有虚拟位置的大人物｜不以实际区域判为不可达｜回放用所选区域模式与剧本领地验证目标',
      '未知领地时不能仅因人在都市而排除。',
      'range eligible avail',
    ],
  ],
  教主: [
    [
      '事件重复执行',
      '同一事件的两步效果先后出现两遍。',
      '事件发生先按限度筛当事人｜按角色特性选择重复执行模式｜逐条匹配两次步骤与选择，窗口关闭后删除走不完的路径',
      '重复效果支持教主；单次无可见变化也可能合法。',
      'incident pair empty',
    ],
  ],
  UP主: [
    [
      '首起事件当日日末放 Ex 牌',
      '本轮第 2 日首次发生事件，日末在少年 b 上出现标记。',
      '回放查询本轮首次发生的事件日期｜对上日末并枚举合法少年或少女｜记录目标，比对公开标记',
      '标记的日序与目标通过历史核对。',
      'play hist',
    ],
    [
      '借 Ex 牌所在区域',
      'UP 主在远方，Ex 牌在学校。',
      '检索效果类别｜区域预筛保留虚拟位置角色｜回放按所选模式取实际位置或 Ex 目标的位置',
      '学校变化仍可由 UP 主解释。',
      'range eligible avail',
    ],
  ],
  局外人: [
    [
      '从规则池外取身份',
      '已选规则含主谋，局外人尝试配置主谋。',
      '先生成所选规则池｜将局外人移出普通名额分配｜从模组身份中去掉平民及池内身份后建立局外人域',
      '这个组合排除局外人＝主谋。',
      'domain init',
    ],
  ],
  手下: [
    [
      '每轮选起始区',
      '手下第一轮在都市，第二轮出现在学校。',
      '轮初识别手下位置变化为合法特性来源｜历史枚举本轮选择的版图｜与本轮公开位置比较',
      '不能用上一轮位置排除新一轮选择。',
      'trait play',
    ],
  ],
  幻想: [
    [
      '不能在其身上放牌',
      '主人公盖牌，目标写为幻想。',
      '枚举玩家及可用牌｜legalCardTargets 从存活目标中移去幻想｜提交动作或回放不接受这一目标',
      '排除直接盖在幻想身上的行动路径。',
      'legal hist',
    ],
    [
      '版图牌也作用于幻想',
      '神社有不安 +1 牌，神社的幻想增加不安。',
      '收集翻开牌和目标｜匹配角色所在版图的牌｜核对幻想对应的移动或指示物变化，回放验证禁牌及抵消',
      '无需再假设单独给幻想放过同一张牌。',
      'cards play',
    ],
  ],
  转校生: [
    [
      '指定登场日',
      '第 2 日开始，原先未登场的转校生出现在学校。',
      '开局建立隐藏日期域｜核对日初边界、状态变存活、指示物不变及区域｜将登场日缩为 2，已知区域也收紧',
      '排除第 1、3 日等备选日期。',
      'domain arrive',
    ],
  ],
  神灵: [
    [
      '指定登场轮',
      '第 2 轮重置时神灵仍缺席。',
      '建立入场轮域｜识别零指示物且区域正确的轮回重置报告｜按存活与否筛“入场轮 ≤ 当前轮”｜传播',
      '仍缺席可排除入场轮 1、2；仅见存活时只能推出已到入场轮。',
      'domain reset',
    ],
  ],
  黑猫: [
    [
      '轮初神社密谋 +1',
      '黑猫存活，神社轮初 0→1。',
      '轮初打开黑猫强制窗口｜识别神社密谋增加并划去待查项｜若连续窗口关闭仍缺应有变化，标记组合冲突',
      '无须反推出同区有主谋；注意窗口快捷检验的是增加。',
      'clock trait',
    ],
    [
      '当事人效果为空',
      '自杀已发生，但没有死亡报告。',
      '先按发生判定筛当事人｜另查实际结算方式，黑猫可取消效果｜窗口关闭时把黑猫保留为无现象解释',
      '已发生与无现象可以同时成立。',
      'incident empty',
    ],
  ],
  模仿犯: [
    [
      '复制他人配置身份',
      '复制对象可能是 a 或 b，只有 a 的身份域与模仿犯有交集。',
      '从普通名额移出模仿犯｜建立其他角色的复制对象域｜按身份交集过滤对象，再按剩余对象缩窄身份域',
      '删除 b 作为复制对象；额外复制不消耗普通名额。',
      'domain init',
    ],
  ],
  仙人: [
    [
      '事件判定使用私有 X',
      '仙人不安 2，事件发生。',
      '认出私有阈值｜permitsOccurrence 保留可能性｜具体 X 给定时历史逐案比对，不把无界 X 截断后宣称精确',
      '单凭公开 2 不可直接判定当事人。',
      'happen hist',
    ],
    [
      '事件外不安限度为 0',
      '护士检查与其同区、不安为 1 的仙人。',
      '能力目标谓词读取不安限度｜公开值函数在事件外为仙人返回 0｜用有效不安比较并继续检查其他目标条件',
      '无需知道剧本 X 才能通过这一项。',
      'condition eligible',
    ],
    [
      '事件可视为顺时针邻区',
      '仙人在医院，谋杀受害人在神社。',
      '识别仙人虚拟位置｜区域预筛保留异区表象｜历史对实际位置或顺时针相邻位置作选择，再比对受害者',
      '不能按普通当事人同区硬删。',
      'range incident hist',
    ],
  ],
};
for (const [name, list] of Object.entries(traits))
  for (const [unit, ex, steps, end, refs] of list)
    row(
      both,
      '角色特性',
      name,
      unit,
      ex,
      refs.includes('domain') ? '建域／传播' : refs.includes('hist') ? '即时／历史' : '专项处理',
      steps,
      end,
      refs,
    );

// A row describes one observable branch. Examples assume ordinary targets, no other effect and sufficient goodwill.
const abilityExamples = {
  'scholar-clear': [
    [
      '清空自身',
      '学者有 3 友好、1 不安，结算后两项都为 0。',
      '目标是学者自身，各枚数降到零；FS、BTX 的普通配置没有 Ex 槽加减分支。',
    ],
  ],
  'idol-paranoia': [
    [
      '移除不安',
      '偶像与 b 在都市，c 在学校，b 不安 2→1。',
      '同区另一人 b 可选；本人及异区 c 不可选。',
    ],
  ],
  'idol-goodwill': [
    [
      '放置友好',
      '偶像与 b 在都市，b 友好 0→1。',
      '只允许同区另一人；观察偶像自身增加不支持此能力。',
    ],
  ],
  'media-paranoia': [
    [
      '任意区域另一人不安 +1',
      '媒体人在都市，学校的 b 不安 1→2。',
      'b 可选，媒体人本人不可选；没有同区条件。',
    ],
  ],
  'media-intrigue': [
    ['同区角色密谋 +1', '都市 b 密谋 0→1，媒体人也在都市。', 'b 或本人可选。'],
    [
      '所在版图密谋 +1',
      '都市版图密谋 0→1，媒体人位于都市。',
      '选择版图时核对媒体人所在区；异区版图不可选。',
    ],
  ],
  'sacred-tree': [
    [
      '主人公阶段转移',
      '神社御神木不安 1→0，同区 b 不安 0→1。',
      '同一枚从树转到同区另一人，无友好数门槛；整次转移由回放核对。',
    ],
  ],
  'soldier-paranoia': [
    ['不安 +2', '同区 b 不安 1→3，另一候选 c 在学校。', '可选本人；普通情况异区 c 不可选。'],
  ],
  'soldier-protect': [
    [
      '保护主人公',
      '本轮先成功使用军人能力，随后出现主人公死亡请求。',
      '结算层保存本轮保护，死亡请求受保护；单凭暂时没有死亡不能推出用了军人。',
    ],
  ],
  ai: [
    [
      '代为结算事件',
      '已公布日程含自杀，AI 选择自杀后自身死亡。',
      '将 AI 作为当事人，队长决定选择；执行事件效果不会在事件发生记录中追加一次自杀。',
    ],
  ],
  servant: [
    [
      '追加保护对象',
      '从者选择原本不受保护的 b，此后 b 与从者同区。',
      '记录本轮保护对象；后续跟随或代死时才使用，同一个声明不能证明 b 已移动或死亡。',
    ],
  ],
  informant: [
    [
      '公开另一条 X',
      'BTX 中主人公声明因果线，剧作家公开流言四起。',
      '公开结果排除没有流言四起的组合；声明的因果线本身无此证明力。FS 只有一条 X，须检查公开选择是否存在。',
    ],
  ],
  'higher-being': [
    [
      '放置希望',
      '上位存在在神社，b 与其同区，希望 0→1。',
      '可选本人或同区 b；绝望增加不能归给这次希望选择。',
    ],
    ['放置绝望', '同区 b 的绝望 0→1。', '选绝望并核对实际放置的种类。'],
  ],
  student: [
    [
      '同区另一学生减不安',
      '同区另一名学生 b 不安 2→1，同区成人职员 c 也有不安。',
      'b 可选；本人、无学生属性的 c 和异区学生均不可选。',
    ],
  ],
  'class-representative': [
    [
      '收回队长自己的牌',
      '队长本轮已用友好 +2，使用班长后该牌回到手牌。',
      '回放核对所有者、本轮限一次、已用及回手；普通可重复牌不能作该选择。',
    ],
  ],
  'little-sister': [
    [
      '调用同区成人能力',
      '妹妹同区的教师友好 0，队长选择教师给学生 b 加不安。',
      '允许忽略教师的友好门槛及拒绝，但仍受次数及所选能力的合法目标限制。索引先按可调用的效果保留解释。',
    ],
  ],
  'boss-reveal': [
    [
      '公开领地中另一人',
      '领地为学校，大人物在都市，学校的 b 公开为主谋。',
      '在具体配置中定位领地并选另一人，身份报告另缩小 b 的域。',
    ],
  ],
  'forensic-transfer': [
    [
      '同区另两人间转移',
      '鉴别员、b、c 同区，b 不安 2→1，c 不安 0→1。',
      '必须是本人以外两个不同目标；任选两人身上实际存在的一枚在两人间移动。只有双方都无指示物时才没有变化。',
    ],
  ],
  'forensic-reveal': [
    [
      '公开尸体身份',
      '鉴别员在都市，学校有尸体 b，公开 b 为亲友。',
      '可选异区尸体；存活 b 不能成为这一请求的对象。',
    ],
  ],
  'leader-goodwill': [
    [
      '达限者加友好',
      '教主在神社，都市 b 不安等于限度，友好 0→1。',
      '可选异区另一人；不安低于限度的普通 b 不可选。',
    ],
  ],
  'leader-reveal': [
    [
      '公开同区达限者',
      '同区 b 不安等于限度并公开为主谋。',
      '同时要求另一人、同区和不安达限；异区达限仍不能选。',
    ],
  ],
  nurse: [
    [
      '达限者减不安且不可拒绝',
      '同区 b 限度 3，不安 3→2。',
      '比较扣除前的有效不安；2 不达标。本能力不能因无视友好而拒绝。',
    ],
  ],
  streamer: [
    [
      '同一目标加友好、减不安',
      'b 与 UP 主有效位置同区，b 友好 0→1、不安 2→1。',
      '两项作用于同一个非自身目标；一次快照不能单独证明完整结算。',
    ],
    [
      '可选转移 Ex 牌',
      '前一步目标 b 持有 Ex 牌，同区另有 c；选转移给 c 或放弃。',
      '检查原持有者、目标区域及非 UP 主条件，再记录转移选择；该标记由回放核对。',
    ],
  ],
  'detective-incident': [
    [
      '公开本轮已发生事件的当事人',
      '第 1 日自杀已发生，主人公获知当事人 b。',
      '只可选本轮已发生事件；该日当事人缩至 b。',
    ],
  ],
  'detective-guard': [
    [
      '放置护卫',
      '刑警与 b 同区，b 护卫 0→1。',
      '可以给本人；异区 b 不可选。发动前须先查全场是否已有护卫，见该角色单列的条件。',
    ],
    [
      '护卫替代死亡',
      'b 带 1 护卫受普通死亡请求，仍存活，护卫 1→0。',
      '结算死亡请求时核对护卫并扣除；护卫减少可以解释一次被挡住的死亡。',
    ],
  ],
  'outsider-reveal': [
    [
      '第 2 轮起公开自身',
      '局外人在第 2 轮公开为传谣人；对照第 1 轮。',
      '第 1 轮不能发动；达标后不能因无视友好拒绝，公开后还须满足池外身份。',
    ],
  ],
  henchman: [
    [
      '本轮抑制自己的事件',
      '手下不安 2、限度 1，已发动此能力，本轮事件未发生。',
      '未发生时快捷路径容许手下达标；回放核对本轮标志和配置的当事人。',
    ],
  ],
  'girl-release': [
    [
      '解除自身禁行',
      '小女孩原在学校，使用后本轮可尝试去都市。',
      '保存本轮解禁标志，随后的目标或移动才受影响。',
    ],
  ],
  'girl-move': [
    [
      '移到相邻版图',
      '小女孩已解禁，从学校选择一个相邻版图，与对角版图作对照。',
      '只能选择相邻版图；实际移动还要核对禁行。',
    ],
  ],
  'teacher-counter': [
    ['学生加不安', '教师与学生 b 同区，b 不安 1→2。', '绑定学生 b 和增加选择；同区非学生排除。'],
    ['学生减不安', '同区学生 b 不安 2→1。', '绑定学生 b 和移除选择；同一发动中的两个方向互斥。'],
  ],
  'teacher-reveal': [
    [
      '公开学生身份',
      '教师同区的学生 b 公开为传谣人。',
      '排除作为这次公开目标的异区学生和普通非学生。',
    ],
  ],
  'illusion-move': [
    [
      '移动同区一人',
      '幻想和 b 同区，选 b 去都市。',
      '普通角色可选择任意版图目的地；结算另检查移动限制。',
    ],
  ],
  'illusion-remove': [
    ['自身移出', '幻想由存活变为移出，位置离开版图。', '目标限定本人，移出与死亡分别匹配。'],
  ],
  'shrine-maiden-remove': [
    [
      '神社减密谋',
      '巫女在神社，神社密谋 1→0；对照巫女在学校。',
      '必须人在神社，版图目标固定为神社。',
    ],
  ],
  'shrine-maiden-reveal': [
    [
      '公开同区身份',
      '巫女在学校，选择学校的 b 公开身份。',
      '可以选本人；此项没有必须在神社的条件。',
    ],
  ],
  'transfer-student': [
    [
      '密谋替换为友好',
      '同区另一人 b 密谋 1→0、友好 0→1。',
      '同一目标须有可替换的密谋；两项报告共享目标。',
    ],
  ],
  'alien-kill': [
    [
      '同区另一人死亡',
      '异界人与 b 同在神社，普通 b 死亡。',
      'b 可以成为目标，本人不能选；发生死亡请求时也可能只消耗护卫。',
    ],
  ],
  'alien-revive': [
    [
      '复活同区尸体',
      '神社尸体 b 变为存活，异界人在神社。',
      '必须是同区尸体，异区或仍存活的人不能这样复活。',
    ],
  ],
  'doctor-counter': [
    [
      '同区另一人加不安',
      '医生在医院，医院的 b 不安 1→2。',
      '增加分支可选同区另一人，不能选医生本人。',
    ],
    ['同区另一人减不安', '同区 b 不安 2→1。', '绑定减少分支；与上一行互斥。'],
  ],
  'doctor-release': [
    [
      '住院患者解禁',
      '住院患者仍在医院，医生使用能力后患者本轮能够移出医院。',
      '设置患者本轮解禁；能力本身不会把人移动。',
    ],
  ],
  'copycat-reveal': [
    [
      '公布同身份者姓名',
      '第 2 轮公布 b 与模仿犯身份相同，未公布身份名。',
      '不得拒绝。报告列出其他同身份存活者，排除本人、尸体和未登场者，无符合者时名单为空。回放比对整份名单。',
    ],
  ],
  'office-worker': [
    ['公开自己', '职员 a 公开为亲友。', '公开对象是 a；普通配置下删除 a 的其他身份。'],
  ],
  'immortal-revive': [
    [
      '先移动仙人',
      '仙人从神社移至学校，学校有尸体 b。',
      '首步可选版图或远方，后续区域按移动结果取。',
    ],
    ['再复活同区尸体', '仙人已到学校，学校尸体 b 变为存活。', '复活目标必须在移动后的同区。'],
    [
      '复活者加 X 友好',
      'X=2，复活者 b 友好 0→2。',
      '在同一复活目标上增加私有 X；未知 X 时不能凭固定 +1 作排除。',
    ],
  ],
  'divinity-incident': [
    [
      '公开一个事件当事人',
      '日程有第 2 日自杀，尚未发生，可公开其当事人 b。',
      '检查日程选择；没有刑警的“本轮已发生”门槛。',
    ],
  ],
  'divinity-intrigue': [
    ['同区角色减密谋', '同区 b 密谋 1→0。', '可选同区角色含本人。'],
    ['所在版图减密谋', '神灵在神社，神社版图密谋 1→0。', '版图分支固定为神灵所在区。'],
  ],
  'parttimer-reveal': [
    [
      '先公开替身身份',
      '临时工？公开为主谋。',
      '回放检查继承配置；即时公开跳过替身，不能据此把原卡生效身份直接改写。',
    ],
    [
      '再给同区一人加友好',
      '替身在都市，都市 b 友好 0→2。',
      '第二步选同区目标，可以选本人；先前的公开对象仍然是替身。',
    ],
  ],
  'rich-girl': [
    [
      '在学校或都市加友好',
      '大小姐在学校与 b 同区，b 友好 0→1。',
      '学校与都市都可用；医院同区仍不满足发动条件。',
    ],
  ],
};
const pack = packs.FS;
const characters = records.filter((e) => e.kind === 'characters');
assert.deepEqual(Object.keys(pack.characters).sort(), characters.map((e) => e.name).sort());
const cat = new PruningCatalog(
  pack,
  { incidents: Object.keys(pack.incidents).map((name, i) => ({ day: i + 1, name })) },
  characters.map((e) => ({ id: e.name, character: e.name })),
);
const shownById = new Set([
  'office-worker',
  'shrine-maiden-reveal',
  'boss-reveal',
  'forensic-reveal',
  'teacher-reveal',
  'leader-reveal',
  'outsider-reveal',
]);
const phase = 'protagonist-abilities';
const effectLabel = (s) =>
  s.invocation
    ? '调用的子程序'
    : s.kind === 'counter'
      ? cn(s.counter ?? '任意指示物') + (s.sign === 1 ? '增加' : s.sign === -1 ? '减少' : '变化')
      : cn(s.kind ?? '未限定变化');
const uniq = (xs) => [...new Set(xs)];
// Preserve the selector's predicate order so reviewers can compare the replay with the live prefilter.
const terms = {
  $self: '发动者',
  $it: '候选目标',
  $target: '已选目标',
  $from: '转出者',
  $territory: '领地',
  area: '区域',
  character: '角色名',
  paranoiaLimit: '不安限度',
  loop: '轮数',
  alive: '存活角色',
  dead: '尸体',
  boards: '版图',
  cards: '所有角色卡',
  'alive-or-boards': '存活角色或版图',
  eq: '＝',
  ne: '≠',
  ge: '≥',
  le: '≤',
  gt: '>',
  lt: '<',
};
function phrase(v) {
  if (v === true || v === undefined) return '';
  if (v === null || typeof v !== 'object') return terms[v] ?? cn(v);
  if (v.all || v.any)
    return (v.all ?? v.any)
      .map(phrase)
      .filter(Boolean)
      .join(v.all ? ' 且 ' : ' 或 ');
  if (v.cmp) return phrase(v.left) + ' ' + terms[v.cmp] + ' ' + phrase(v.right);
  if (v.ref || v.game) return phrase(v.ref ?? v.game);
  if (v.attribute) return phrase(v.target) + '具有「' + v.attribute + '」属性';
  if (v.field || v.counter) return phrase(v.target) + '的' + phrase(v.field ?? v.counter);
  if (v.count) return phrase(v.count.kind) + '中符合「' + phrase(v.count.where) + '」的数量';
  return JSON.stringify(v);
}
function replayChecks(ability, gate) {
  const checks = [
    '所属阶段与存活状态',
    '本阶段使用次数' + (ability.loopLimit ? '及本轮上限 ' + ability.loopLimit : ''),
  ];
  if (ability.condition) checks.push(phrase(ability.condition));
  if (gate !== undefined) checks.push('有效友好 ≥' + gate);
  for (const choice of ability.steps[0]?.choices ?? []) {
    const options = choice.options;
    if (!Array.isArray(options))
      checks.push(
        '选' +
          phrase(options.kind) +
          (options.where && phrase(options.where) ? '（' + phrase(options.where) + '）' : ''),
      );
    else if (options.length && options.every((v) => !v.startsWith('$')))
      checks.push(
        '选择 ' +
          options
            .map((v) => ({ add: '增加', remove: '移除', yes: '是', no: '否' })[v] ?? cn(v))
            .join('／'),
      );
    else checks.push('按程序列举合法选项 ' + options.join('／'));
  }
  return '回放验证宣告资格：' + checks.join(' → ');
}
function abilityRow(name, ability, text, branch, ex, end, special = false) {
  const id = ability.id,
    ph = special ? 'mastermind-abilities' : phase;
  const sources = cat
    .sourcesFor('characters', name)
    .filter((s) => s.ability?.id === id && (s.timing === ph || s.invocationTiming === ph));
  const shown = shownById.has(id) || (id === 'parttimer-reveal' && branch.includes('公开'));
  const rule = id === 'informant',
    culprit = ['divinity-incident', 'detective-incident'].includes(id);
  const hidden =
    !shown &&
    !rule &&
    !culprit &&
    (!sources.length || branch.includes('转移 Ex') || branch === '护卫替代死亡');
  const gate = special && id === 'higher-being' ? 1 : ability.threshold;
  let steps, route, refs;
  if (shown || rule || culprit) {
    route = '正式公开 → 传播';
    steps =
      '回放先查阶段与使用次数、发动条件、有效友好' +
      (gate ?? 0) +
      '，再绑定合法选择｜' +
      (shown
        ? '收到身份名及目标，按角色编号找其配置身份域'
        : rule
          ? '收到公开规则名，遍历活动的 Y/X 组合'
          : '收到公开当事人编号与事件日，查该日当事人域') +
      '｜' +
      (shown
        ? id === 'parttimer-reveal'
          ? '替身例外跳过直接缩窄；保留配置，随后回放继承关系'
          : '普通目标删除与公开身份不相容的值，再传播名额；变身身份保留可能的原身份'
        : rule
          ? '排除不含该公开规则的组合'
          : '删除该日其余当事人候选并传播');
    refs = 'disclose avail batch hist';
  } else if (hidden) {
    route = branch === '护卫替代死亡' ? '死亡结算' : '回放／状态';
    steps =
      branch === '护卫替代死亡'
        ? '历史结算读死亡请求与目标｜检查目标可被杀及死亡替代｜消耗护卫并与存活状态、护卫报告比对'
        : '定位' +
          cn(ph) +
          '中的声明及拥有者｜按次数、能力条件、有效友好' +
          (gate ?? 0) +
          '与首步选择排除非法发动｜执行该步并更新候选历史中的状态或披露记录｜比对公开记录，矛盾的具体历史淘汰';
    refs = 'avail batch move hist';
  } else {
    route = '变化索引 → 历史';
    const kinds = uniq(sources.map(effectLabel)).join('、');
    steps =
      '按' +
      cn(ph) +
      '和观测种类／指示物／方向匹配此能力的来源（' +
      kinds +
      '）｜' +
      (sources.some((s) => s.invocation)
        ? '只从可调用的子程序中匹配输出，保留间接原因'
        : '从公开角色牌定位' +
          name +
          '；检查目标可达性' +
          (sources.every((s) => s.safeSnapshot)
            ? '及可确定的区域／对象'
            : '；多步或非独立效果的中途位置与数值可能未知')) +
      '｜在适用且已知时，依次核对改变量、公开条件、发动者状态、有效友好' +
      (gate ?? '（无门槛）') +
      '与目标选择条件｜保留相容来源及次数约束；回放再检验目标、拒绝与完整结算';
    refs = 'index eligible effect avail hist';
  }
  if (special) {
    steps += '｜回放时先检验剧作家使用权限：当前允许无视友好且有效友好达 ' + gate;
    refs += ' batch';
  }
  if (branch !== '护卫替代死亡') steps += '｜' + replayChecks(ability, gate);
  const program = {
    id,
    timing: ph,
    threshold: gate,
    loopLimit: ability.loopLimit,
    condition: ability.condition,
    steps: ability.steps,
  };
  row(both, special ? '角色特殊发动' : '角色能力', name, branch, ex, route, steps, end, refs, {
    text,
    program,
  });
}
let programCount = 0;
for (const e of characters) {
  const def = pack.characters[e.name],
    facts = e.fields;
  assert.deepEqual(def.abilities, packs.BTX.characters[e.name].abilities);
  const regular = def.abilities.filter((a) => a.threshold !== undefined);
  assert.equal(regular.length, (facts.友好能力 ?? []).length);
  if (facts.特性) assert.ok(traits[e.name], e.name);
  for (const a of def.abilities.filter((a) => a.timing === phase)) {
    const i = regular.indexOf(a),
      t = facts.友好能力?.[i]?.text ?? facts.特性;
    assert.ok(abilityExamples[a.id], a.id);
    programCount++;
    for (const [branch, ex, end] of abilityExamples[a.id]) {
      abilityRow(e.name, a, t, branch, ex, end);
      if (['doctor-counter', 'higher-being'].includes(a.id))
        abilityRow(
          e.name,
          a,
          t,
          '剧作家 · ' + branch,
          cn('mastermind-abilities') + '，' + ex,
          end + ' 仅凭这一条变化不能确认发动者具有无视友好。',
          true,
        );
    }
    if (a.loopLimit !== undefined)
      row(
        both,
        '角色次数',
        e.name,
        abilityExamples[a.id][0][0] + ' · 每轮限 ' + a.loopLimit + ' 次',
        '同一轮先完整使用 ' + a.id + '，次日再请求使用；对照新一轮首次请求。',
        '次数／回放',
        '记录第一次实际使用的轮号、拥有者和能力编号｜枚举本次发动时先查阶段和本轮已用次数｜达到上限即排除第二次作为该能力的执行路径；新轮使用新的次数记录',
        '同名角色的另一项能力使用独立的能力编号；只有声明时还须看是否实际使用。',
        'avail batch hist',
        { text: t },
      );
  }
  const initial = def.initial.map(cn).join('／'),
    forbidden = def.forbidden.map(cn).join('、');
  row(
    both,
    '角色基础',
    e.name,
    '初始区域',
    e.name === '临时工？'
      ? '原临时工死亡后出现替身，报告位置为都市。'
      : e.name === '手下'
        ? '尝试让手下从远方开局。'
        : '检查开局区域 ' + initial + '。',
    '建域／开局',
    e.name === '临时工？'
      ? '区分剧本登场者与原卡的替身｜拒绝将替身直接列入配置｜由原卡派生待登场替身'
      : e.name === '手下'
        ? '识别自选起始区域｜检查指定区域属于四版图｜每轮选择由历史比对'
        : '按角色名取允许的初始区域 ' +
          initial +
          '｜多区卡须声明合法选项；单区卡核对给定值｜用该选择初始化位置，登场日／轮另查',
    '起始位置约束用于开局；角色移动后要读取当时的位置。',
    'init domain hist',
  );
  if (forbidden)
    row(
      both,
      '角色基础',
      e.name,
      '禁行区域',
      '从合法起点尝试进入' + cn(def.forbidden[0]) + '，未设置解禁标志。',
      '移动结算',
      '从移动意图取角色及目的区域｜核对本轮是否解除禁行｜否则按该卡的禁行表（' +
        forbidden +
        '）检查｜比对实际移动报告',
      '通常不能由这次移动进入禁行区；若已有解禁标志则重算。',
      'move hist',
    );
  row(
    both,
    '角色基础',
    e.name,
    '事件不安限度',
    e.name === '仙人'
      ? '仙人不安 2，私有 X 取 2 或 3。'
      : e.name === 'AI'
        ? 'AI 不安 0，实物总计为 4 或 3。'
        : '以存活的' +
          e.name +
          '为普通不安事件当事人，' +
          (def.paranoia ? '输入不安 ' + (def.paranoia - 1) + ' 或 ' + def.paranoia : '输入不安 0') +
          '。',
    '事件发生',
    e.name === '仙人'
      ? '识别私有 X｜公开筛选保留未知｜历史在具体 X 下核对发生记录'
      : '先识别角色的事件特例，再看存活｜' +
          (e.name === 'AI' ? '汇总全部实际指示物' : '取有效不安（不安＋绝望）') +
          '｜与卡面限度 ' +
          def.paranoia +
          ' 比较，核对发生标志',
    e.name === '仙人'
      ? '同样的 2 不能直接排除该角色。'
      : e.name === '临时工？'
        ? '代理路径先保留未知，再由回放按替身实际限度检查。'
        : e.name === '黑猫'
          ? '零不安已达标；事件仍可能没有现象。'
          : '此项筛的是事件当事人；抑制、替身与私有条件另按对应特性处理。',
    'happen incident hist',
  );
}
row(
  both,
  '角色特性',
  '仙人',
  '指定非负 X',
  '给仙人填写 X=0 与 X=−1。',
  '开局',
  '检查剧本参数是否存在｜检验安全整数且 ≥0｜无效配置不进入合法回放',
  'X=0 合法，负数不合法；不能凭未枚举到大 X 排除它。',
  'init hist',
);
row(
  both,
  '角色特性',
  '临时工？',
  '禁止直接配置',
  '尝试把临时工？作为独立卡列在剧本名册。',
  '开局',
  '检查角色名｜validateSetup 拒绝直接使用替身｜运行中只能由原卡派生',
  '单独配置替身的剧本无效。',
  'init',
);
for (const id of ['亲友', '传谣人'])
  row(
    both,
    '身份',
    id,
    '普通配置上限',
    '两条规则都要求配置' + id + '，检查累加后的数量。',
    '建域',
    '读各规则名额｜累加并取身份上限 ' +
      pack.identities[id].max +
      '｜按截断后的名额传播普通角色赋值',
    '超过上限的普通配置被排除；模仿犯复制不消耗该名额。',
    'domain init',
  );
loc.deck = ['setup', 'export function createCards'];
loc.target = ['expressions', 'export function destination'];
const cardNames = {
  horizontal: '横向移动',
  vertical: '纵向移动',
  diagonal: '斜向移动',
  'block-movement': '禁止移动',
  'block-paranoia': '禁止不安',
  'block-goodwill': '禁止友好',
  'block-intrigue': '禁止密谋',
  'paranoia+1': '不安 +1',
  'paranoia-1': '不安 −1',
  'goodwill+1': '友好 +1',
  'goodwill+2': '友好 +2',
  'intrigue+1': '密谋 +1',
  'intrigue+2': '密谋 +2',
};
const { createCards } = await get(runtime + 'setup.ts');
for (const owner of ['mastermind', 'p0']) {
  const deck = createCards().filter((c) => c.owner === owner);
  for (const kind of uniq(deck.map((c) => c.kind))) {
    const card = deck.find((c) => c.kind === kind),
      who = owner === 'mastermind' ? '剧作家' : '每名主人公',
      count = deck.filter((c) => c.kind === kind).length;
    const target = ['horizontal', 'vertical', 'diagonal'].includes(kind)
      ? '移动'
      : kind.startsWith('block-')
        ? '禁止'
        : '增减';
    const ex =
      target === '移动'
        ? '目标在学校且没有禁行，只有此方向的一张移动牌。'
        : target === '禁止'
          ? '同一目标上同时翻出本禁止牌和一张对应效果牌。'
          : '目标原有 1 枚对应指示物，本次只有这张牌改变它。';
    row(
      both,
      '行动牌',
      who,
      cardNames[kind],
      ex,
      '行动结算',
      '根据所有者及手牌状态检查能否出牌（初始 ' +
        count +
        ' 张' +
        (card.once ? '，每轮限一次' : '') +
        '）｜翻牌后按目标归组｜' +
        (target === '移动'
          ? '取同目标上的方向与禁止移动，按起点求目的地｜和实际移动比对，缺报时保留禁行或替代待核'
          : target === '禁止'
            ? '检查对应类别、禁止牌数和目标；有效禁止抵消该类别｜观察到绕过时才检索相应身份或其他来源'
            : '识别指示物种类和正负方向，再按目标的禁止情况累计｜分放置及移除阶段比对变化，检查下限 0 与版图上限 3'),
      target === '移动'
        ? '移动轨迹限制可行行动；单张移动牌不直接公开身份。'
        : target === '禁止'
          ? '该牌本身不会放置或移除指示物。'
          : '已知翻牌能解释的变化优先按牌结算；孤立的数值变化不能确定出牌者身份。',
      'deck cards bypass move hist',
    );
  }
}
for (const e of characters) {
  const at = e.fields.属性,
    def = pack.characters[e.name];
  assert.deepEqual(new Set(at), new Set(def.attributes));
  row(
    both,
    '角色基础',
    e.name,
    '目标属性',
    e.name + '的卡面属性为' + at.join('、') + '。以教师选择“学生”为例。',
    '选择目标',
    '读能力选择器所需属性（本例为学生）｜从已知角色卡读取属性；即时条件能确定为真／假时用于筛来源｜回放在当前状态重新枚举合法目标，再核对同区等其他条件',
    at.includes('学生')
      ? '通过学生这一项，还须同区。'
      : '以本卡固有属性，不能满足教师的学生条件；若有效身份另授属性则须看该配置。',
    'condition avail hist',
  );
}
loc.consume = ['knowledge-scope', '  consume(o:'];
row(
  both,
  '身份',
  '关键人物',
  '事件死亡后正常换队长',
  'b 在事件阶段死亡，接下来正常进入队长交换。',
  '窗口关闭',
  '确认同轮同日事件窗口内记录了 b 的死亡｜确认下一边界为队长交换｜普通 b 的域中删除无条件死亡即失败的身份｜传播缩小后的身份域',
  '可以从 b 身上直接排除关键人物；没有后续边界时暂不能用此反证。',
  'consume domain',
);
for (const [dead, other] of [
  ['心上人', '求爱者'],
  ['求爱者', '心上人'],
])
  row(
    'BTX',
    '身份',
    other,
    '事件死亡后未见不安增加',
    '普通 b 死亡，普通 a 从事件入口到队长交换一直存活、不安未增加。',
    '窗口关闭',
    '确认事件后正常换队长，记录死者及各角色不安增加情况｜排除新登场和替身等特例｜若允许静态判断，向 b、a 的身份域添加禁止配对；否则转历史核对',
    '排除 b＝' + dead + ' 且 a＝' + other + ' 的共同赋值；不能单独删除 a 的这一身份。',
    'consume trait hist',
  );
row(
  both,
  '角色能力',
  '刑警',
  '场上已有护卫时的放置限制',
  '刑警友好 5、尚未用过该能力，但异区 c 已经有 1 护卫。',
  '发动条件／回放',
  '次数检查通过｜能力程序统计所有卡牌上实际护卫 ≥1 的张数｜数量必须为 0 才继续检查友好与首步目标｜已有护卫则本次不能发动',
  '这是机器程序额外检查的条件。公开条件求值器不能精确统计 cards 选择器，这种输入要在回放核对；请对照原文复核。',
  'condition avail hist',
);
row(
  both,
  '模组',
  '事件日程',
  '相同日期',
  '在第 2 日同时配置谋杀和自杀。',
  '开局',
  '核对日期为正整数且不超过总天数｜检查日期在本剧本中尚未占用｜重复日拒绝该配置',
  '同日不能配置两个事件。',
  'init domain',
);
row(
  both,
  '模组',
  '事件日程',
  '重复当事人',
  '第 1 日自杀和第 2 日谋杀都配置 a 作为当事人。',
  '建域／开局',
  '按事件日建立当事人变量｜检查普通事件当事人为名册内角色｜对跨日期的普通当事人施加互异约束并传播',
  '固定第 1 日为 a 后，第 2 日排除 a。',
  'domain init',
);
const idx = (k, n, u) => rows.find((r) => r.kind === k && r.name === n && r.unit === u);
for (const r of [...rows].filter((r) => r.kind === '事件' && r.unit === '发生／未发生')) {
  r.unit = '已发生';
  r.example = '当天公布“' + r.name + '已发生”。普通 a 达到不安限度，普通 b 还差一枚。';
  r.end = '排除 b。a 通过发生门槛，后续另查事件效果及用于解释它的当事人。';
  row(
    r.mod,
    '事件',
    r.name,
    '未发生',
    '当天公布“' + r.name + '未发生”。普通 a 达到限度，普通 b 还差一枚。',
    r.route,
    r.steps.join('｜'),
    '排除普通 a，保留 b。未获得发生标志、或事件已发生但无现象，均不能作为此输入。',
    r.refs.join(' '),
  );
}
idx('身份', '传谣人', '任意 · 不安 +1').steps = [
  '对比角色报告与前一盘面，得到 b 的不安 0→1',
  '以剧作家阶段、指示物变化、不安、增加查效果索引',
  '取同区身份来源，对 b 所在学校筛发动者，留下 a、b',
  '依次核对目标可达、增量正好 +1、公开条件、发动者存活及目标选择条件',
  '在每个组合中加入“a 或 b 能解释本次变化”的约束，传播名额和次数',
];
for (const e of records.filter((e) => e.kind === 'identities'))
  assert.ok(
    rows.some((r) => r.kind === '身份' && r.name === e.name),
    e.name,
  );
for (const e of records.filter((e) => e.kind === 'rules'))
  assert.ok(
    rows.some((r) => r.mod === e.module && r.kind.startsWith('规则') && r.name === e.name),
    e.name,
  );
const dest = path.join(root, 'products/engine/pruning-order.html'),
  audit = path.join(path.dirname(dest), 'single-rule-audit.html');
assert.ok(fs.existsSync(audit));
const git = (...args) => execFileSync('git', ['-C', solver, ...args], { encoding: 'utf8' }).trim();
const version = git('rev-parse', 'HEAD');
const fingerprint = createHash('sha256');
for (const file of uniq(Object.values(loc).map(([f]) => runtime + f + '.ts')).sort())
  fingerprint.update(file).update(fs.readFileSync(path.join(solver, file)));
const kinds = uniq(rows.map((r) => r.kind));
function evidence(r) {
  const wanted = r.kind.startsWith('规则')
    ? 'rules'
    : r.kind === '事件'
      ? 'incidents'
      : r.kind === '身份'
        ? 'identities'
        : r.kind === '模组'
          ? 'modules'
          : r.kind.startsWith('角色')
            ? 'characters'
            : '';
  const src = records.find(
    (e) =>
      e.kind === wanted &&
      (e.name === r.name || (wanted === 'modules' && e.module === r.mod)) &&
      (!e.module || r.mod.includes(e.module)),
  );
  const url = src ? '<a href="../../' + esc(src.source) + '">规则原文</a> · ' : '';
  return (
    '<details><summary>依据与代码</summary>' +
    url +
    '<a href="single-rule-audit.html?q=' +
    encodeURIComponent(r.name) +
    '">检索相关实测</a><div class="refs">' +
    uniq(r.refs).map(source).join(' ') +
    '</div>' +
    (r.raw?.text ? '<p>' + esc(r.raw.text) + '</p>' : '') +
    (r.raw?.program
      ? '<details><summary>执行程序</summary><pre>' +
        esc(JSON.stringify(r.raw.program, null, 2)) +
        '</pre></details>'
      : '') +
    '</details>'
  );
}
const dataRow = (r) =>
  '<tr data-mod="' +
  esc(r.mod) +
  '" data-kind="' +
  esc(r.kind) +
  '"><th scope="row"><small>' +
  esc(r.mod) +
  ' · ' +
  esc(r.kind) +
  '</small>' +
  esc(r.name) +
  '<span>' +
  esc(r.unit) +
  '</span></th><td>' +
  esc(r.example) +
  '</td><td><small>' +
  esc(r.route) +
  '</small><ol>' +
  r.steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
  '</ol></td><td>' +
  esc(r.end) +
  evidence(r) +
  '</td></tr>';
const css =
  '*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#fbfaf7;color:#202d2b;font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1550px;margin:auto;padding:28px clamp(15px,4vw,56px) 60px}h1,h2{line-height:1.27;color:#163e38}h1{font-size:clamp(27px,4vw,42px);margin:.3em 0}h2{font-size:22px}p{max-width:95ch}a{color:#09615c}section.demo{border-left:4px solid #27756b;background:#ecf4ef;padding:4px 20px 12px;margin:22px 0}section.demo li{margin:4px 0}small{font-size:12px;color:#47665f;display:block;font-weight:500}nav{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:20px 0}label{font-size:13px;color:#45615b}input,select{display:block;background:white;color:#183b35;border:1px solid #9daea5;border-radius:4px;padding:8px 10px;font:inherit}input{width:min(320px,86vw)}output{font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;background:white}thead{background:#21483f;color:white}thead th{padding:10px;text-align:left}tbody th,td{padding:11px 12px;border:1px solid #d2ddd7;text-align:left;vertical-align:top}tbody th{width:17%;background:#f0f5f0}tbody th span{display:block;font-weight:500}td:nth-child(2){width:20%}td:nth-child(3){width:39%}td ol{margin:.2em 0;padding-left:1.5em}td li+li{margin-top:.18em}details{margin-top:7px;font-size:13px}summary{cursor:pointer;color:#146358}.refs a{display:inline-block;margin-right:5px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}footer{margin:28px 0;overflow-wrap:anywhere}.scroll{overflow-x:auto}table{min-width:810px}tr[hidden]{display:none}@media print{main{padding:0}nav,footer,td details{display:none}table{min-width:0;font-size:9pt}tr{break-inside:avoid}thead{display:table-header-group}h1{font-size:21pt}.scroll{overflow:visible}}';
const rum = idx('身份', '传谣人', '任意 · 不安 +1');
for (const m of ['FS', 'BTX']) {
  assert.equal(runs[m].remote, false);
  assert.deepEqual(new Set(runs[m].skipped), new Set(['c', 'd']));
}
const header =
  '<h1>FS 与 BTX 单条规则剪枝顺序</h1><p>人工复核表 · 基础模组，关闭周年追加。每行从一个具体输入出发，按实际处理路径列出检查顺序、淘汰对象和仍待核验的条件。共 ' +
  rows.length +
  ' 行，含 ' +
  characters.length +
  ' 张角色卡。待人类验收。</p>';
const demo =
  '<section class="demo"><h2>传谣人 ｜ 剧作家阶段，学校的 b 增加 1 不安</h2><p>局部测试盘面：a 男学生、b 女学生在学校，c 职员在都市，d 巫女在神社。四人存活，指示物起始为零。反例也逐级调用生产函数验证：改为主人公阶段、密谋增加或不安减少，都查不到传谣人；保留正确类型，将 0→1 改为 0→2，则通过区域筛选后在数值检查被排除。向 LiveKnowledge 连续输入阶段边界和 b 的公开角色报告。</p><ol>' +
  rum.steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
  '</ol><p><strong>实测。</strong>两个模组的本次来源都只剩 a、b，跳过 c、d。存活的 Y/X 组合数：FS ' +
  runs.FS.before +
  ' → ' +
  runs.FS.after +
  '，BTX ' +
  runs.BTX.before +
  ' → ' +
  runs.BTX.after +
  '。<strong>修复后的名额传播：</strong>本例只有 a 或 b 的能力能解释变化，且两人都占普通角色名额。所有原因都要求同一个唯一身份，所以两个模组的即时矩阵都删除了外区普通角色 c 的该身份。</p></section>';
const guide =
  '<p><b>读表时区分三个时点。</b>建域检查剧本赋值。即时剪枝接收主人公看见的报告，检查的是本次变化的解释。历史回放在具体剧本和行动选择下重演过程；与观察冲突的路径才被淘汰，搜索用尽预算仍可未决。步骤中“回放”与“即时”分属两次求值，先后描述不代表每收到一条报告就立即跑完整回放。</p><p>独立友好请求先检查有效友好门槛。合法开局的男学生独立发动并成功结算时，两模组的即时矩阵都已排除必定拒绝的邪教徒。妹妹代为发动等情况单独处理。表中每行是源码走读的复核例；自动运行的输入、输出与未决项见<a href="single-rule-audit.html">单条规则实测记录</a>。</p>';
const controls =
  '<nav aria-label="筛选"><label>查找规则、角色或判定词<input id="query" type="search" placeholder="例如：传谣人、同区、未发生"></label><label>模组<select id="mod"><option value="">全部模组</option><option>FS</option><option>BTX</option></select></label><label>条目<select id="kind"><option value="">全部条目</option>' +
  kinds.map((k) => '<option>' + esc(k) + '</option>').join('') +
  '</select></label><output id="total" aria-live="polite">显示 ' +
  rows.length +
  ' 行</output></nav>';
const script =
  "const q=document.querySelector('#query'),m=document.querySelector('#mod'),k=document.querySelector('#kind'),total=document.querySelector('#total');const rows=[...document.querySelectorAll('tbody tr')].map(r=>[r,[...r.cells].map(c=>c.innerText).join(' ').toLowerCase()]);function filter(){let n=0;for(const [r,t] of rows){r.hidden=!(t.includes(q.value.trim().toLowerCase())&&r.dataset.mod.includes(m.value)&&(!k.value||r.dataset.kind===k.value));if(!r.hidden)n++}total.textContent='显示 '+n+' 行'}q.oninput=m.onchange=k.onchange=filter;";
const markup =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FS 与 BTX 单条规则剪枝顺序</title><style>' +
  css +
  '</style></head><body><main>' +
  header +
  demo +
  guide +
  controls +
  '<div class="scroll"><table aria-label="逐条剪枝顺序"><thead><tr><th>规则与触发分支</th><th>输入样例</th><th>代码判定顺序</th><th>剪枝结果与依据</th></tr></thead><tbody>' +
  rows.map(dataRow).join('') +
  '</tbody></table></div><footer>运算器版本 <code>' +
  esc(version) +
  '</code>。所链接运行时源文件内容指纹 SHA-256 <code>' +
  fingerprint.digest('hex') +
  '</code>。代码链接指向本次运行的本地工作树，链接文字给出函数所在行。<br>复现：<code>pnpm exec tsx scripts/engine/pruning-order.mjs "&lt;运算器工作树&gt;"</code></footer></main><script>' +
  script +
  '</script></body></html>';
fs.writeFileSync(dest, markup);
console.log(
  JSON.stringify({ rows: rows.length, characters: characters.length, programCount, runs }),
);
