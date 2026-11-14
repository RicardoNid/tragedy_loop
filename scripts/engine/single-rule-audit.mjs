// Run with pnpm exec tsx scripts/engine/single-rule-audit.mjs <solver checkout>.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { abilityWindows, legalHistory } from './single-rule-live.mjs';
import { goodwillCases, traitCases, extraCases } from './single-rule-characters.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const solver = path.resolve(process.argv[2] || root);
const get = (relative) => import(pathToFileURL(path.join(solver, relative)).href);
const { compileOfficial } = await get('packages/content/src/official/compile.ts');
const runtime = (name) => get('packages/engine/src/runtime/' + name + '.ts');
const { HistorySearch } = await runtime('knowledge-history');
const { LiveKnowledge } = await runtime('knowledge-live');
const { buildProfiles, configurations } = await runtime('knowledge-domain');
const { normalizeHistory, queryReference, createReferenceKnowledge } = await runtime('reference');
const { project } = await runtime('ports');
const { advance, drive, initializeDiscussion: initialize } = await runtime('engine');
const { initialState } = await runtime('setup');
const { settle } = await runtime('settlement');
const catalog = JSON.parse(
  fs.readFileSync(path.join(solver, 'packages/content/src/official/source-catalog.json')),
).entries;
for (const e of catalog.filter((e) => ['FS', 'BTX'].includes(e.module) || e.kind === 'characters'))
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, e.source))).fields,
    e.fields,
    '规则内容快照不一致：' + e.name,
  );
const rows = [];
let module, pack;
const row = (group, name, clause, example, fn) => {
  try {
    const result = fn();
    rows.push({ module, group, name, clause, example, ...result });
  } catch (error) {
    rows.push({ module, group, name, clause, example, status: '未通过', detail: error.message });
  }
};
const base = () => ({
  module,
  anniversary: false,
  loops: 2,
  days: 2,
  captain: 'p0',
  discussion: 'allowed',
  y: '',
  x: [],
  incidents: [],
  characters: ['男学生', '女学生', '医生', '巫女'].map((character, i) => ({
    id: 'abcd'[i],
    character,
    identity: '平民',
  })),
});
function state(phase, config = {}) {
  const setup = Object.assign(base(), config);
  const s = initialState(pack, setup);
  s.phase = phase;
  return s;
}
const role = (s, id, name) => {
  s.characters[id].identity = s.characters[id].initialIdentity = name;
  s.setup.characters.find((c) => c.id === id).identity = name;
};
const card = (s, id, name) => {
  const setup = structuredClone(s.setup);
  setup.characters.find((c) => c.id === id).character = name;
  const fresh = initialState(pack, setup);
  s.setup = setup;
  s.characters[id] = fresh.characters[id];
  if (fresh.characters[id + '_replacement'])
    s.characters[id + '_replacement'] = fresh.characters[id + '_replacement'];
};
function placements(s, items) {
  s.placements = items.map(([owner, kind, target]) => {
    const c = s.cards.find((c) => c.owner === owner && c.kind === kind && c.status === 'hand');
    c.status = 'set';
    return { card: c.id, target };
  });
}
// Start at a phase checkpoint. Stop at the first boundary so later rules cannot explain the evidence.
function play(input, select, stop) {
  let s = structuredClone(input);
  const initialPhase = s.phase;
  for (let i = 0; i < 150; i++) {
    if (stop?.(s) || s.phase !== initialPhase || s.winner) return s;
    if (!s.pending) {
      drive(pack, s, 1);
      continue;
    }
    const d = s.pending;
    const choice = select?.(s, d) ?? d.options.find((o) => o.kind === 'pass') ?? d.options[0];
    assert.ok(choice, '阶段内缺少可执行选择');
    const r = advance(
      pack,
      s,
      d.actor,
      { id: 'case-' + i, expectedRevision: s.revision, decisionId: d.id, choice },
      0,
    );
    assert.notEqual(r.status, 'rejected');
    s = r.state;
  }
  throw Error('样例未在步数上限内结束');
}
const action =
  (ability, owner = 'a', choices = {}) =>
  (s, d) => {
    if (d.kind === 'ability')
      return d.options.find((c) => c.ability === ability && c.owner === owner) ?? { kind: 'pass' };
    if (d.kind === 'refusal') return { kind: 'refuse', refuse: false };
    if (s.flags['pending-binding']?.startsWith('flag:ability-area:') && choices.areaMode)
      return d.options.find((c) => c.kind === 'select' && c.value === choices.areaMode);
    const key = s.flags['pending-binding']?.split(':').at(-1);
    return d.options.find((c) => c.kind === 'select' && c.value === choices[key]);
  };
function checkpointSearch(s, history) {
  // The production search normally seeds its stack from initialize(). Isolated mid-game
  // states have no preceding history. Replace ONLY its root stack in this test adapter.
  const evidence = { observations: history, normalized: normalizeHistory(history), version: 1 };
  const search = new HistorySearch(pack, s.setup, evidence, project(s, 'protagonists'));
  const start = structuredClone(s);
  if (!start.pending && !start.winner) drive(pack, start, 10000);
  assert.ok(Array.isArray(search.active), 'HistorySearch 检查点接口已变更');
  search.active = [
    { state: start, normalized: normalizeHistory(start.observations.protagonists), matched: 0 },
  ];
  for (let i = 0; i < 1500 && search.result === 'unknown' && !search.blocked; i++) search.step();
  return search.result;
}
function compare(a, b, select, verify, expected = 'excluded', stop) {
  const played = play(a, select, stop);
  verify(played);
  const history = played.observations.protagonists;
  assert.ok(history.length, '没有公开观察');
  const kept = checkpointSearch(a, history),
    other = checkpointSearch(b, history);
  return {
    status:
      kept === 'possible' && other === expected
        ? '通过'
        : kept === 'unknown' || other === 'unknown'
          ? '未决'
          : '未通过',
    detail: 'A ' + kept + '，B ' + other + '。预期 A possible，B ' + expected + '。',
    history,
  };
}
function pair(group, name, clause, example, phase, prepare, choose, verify, expected, stop) {
  row(group, name, clause, example, () => {
    const a = state(phase),
      b = state(phase);
    prepare(a, true);
    prepare(b, false);
    return compare(a, b, choose, verify, expected, stop);
  });
}
const cnt = (s, id, k) => s.characters[id].counters[k];
const eq = (actual, expected) => assert.deepEqual(actual, expected);
const has = (s, type) => s.observations.protagonists.some((o) => o.type === type);
function death(s, target) {
  s.frames.push({
    id: 'stimulus',
    source: '测试死亡输入',
    owner: '',
    actor: 'mastermind',
    kind: 'mandatory',
    steps: [{ effects: [{ op: 'kill', target }] }],
    step: 0,
    choices: {},
    bound: {},
    cleanup: false,
  });
}
const apply = (s, ...effects) =>
  settle(
    pack,
    s,
    effects.map((effect) => ({ effect, env: {} })),
  );
const sourceEntry = (kind, name) =>
  catalog.find((e) => e.kind === kind && e.name === name && (e.module === module || !e.module));
function setupPair(name, clause, example, a, b, expected = 'excluded') {
  row('剧本配置', name, clause, example, () => {
    const domain = [
      { id: 'A', setup: a },
      { id: 'B', setup: b },
    ];
    const r = queryReference(pack, createReferenceKnowledge(pack, domain), {
      expansions: 10,
      choicesPerNode: 4,
      depth: 1,
      engineSteps: 1000,
    });
    const ok =
      r.retained.includes('A') && (expected === 'possible' ? r.retained : r.excluded).includes('B');
    return {
      status: ok ? '通过' : '未通过',
      detail:
        '预期 A 保留，B ' +
        (expected === 'possible' ? '保留' : '排除') +
        '。实际保留 ' +
        r.retained.join('、') +
        '；排除 ' +
        r.excluded.join('、') +
        '；未决 ' +
        r.unresolved.join('、'),
      input: structuredClone(domain),
    };
  });
}
function configs(y, x, extra = []) {
  const setup = base();
  Object.assign(setup, { y, x });
  const pool = {};
  for (const name of [y, ...x])
    for (const [r, n] of Object.entries(sourceEntry('rules', name).fields.identityCounts)) {
      const count = { '①': 1, '②': 2, '③': 3 }[n];
      pool[r] = Math.min((pool[r] || 0) + count, { 传谣人: 1, 亲友: 2 }[r] ?? Infinity);
    }
  const roles = Object.entries(pool)
    .flatMap(([r, n]) => (r === '暴徒' ? [] : Array(n).fill(r)))
    .concat(extra, '平民');
  const names = [
    '女学生',
    '男学生',
    '医生',
    '巫女',
    '教师',
    '媒体人',
    '偶像',
    '职员',
    '刑警',
    '住院患者',
  ];
  if (y === '和我签订契约吧！') roles.unshift(...roles.splice(roles.indexOf('关键人物'), 1));
  setup.characters = roles.map((identity, i) => ({ id: 'p' + i, character: names[i], identity }));
  return setup;
}
function plots() {
  for (const e of catalog.filter((e) => e.kind === 'rules' && e.module === module)) {
    const isY = e.fields.ruleType === 'Y';
    const y = isY ? e.name : module === 'BTX' ? '巨大定时炸弹X' : '复仇的火种';
    const x = isY
      ? module === 'BTX'
        ? ['流言四起', '因果线']
        : ['流言四起']
      : module === 'FS'
        ? [e.name]
        : [e.name, e.name === '因果线' ? '流言四起' : '因果线'];
    for (const [r, n] of Object.entries(e.fields.identityCounts)) {
      const a = configs(y, x),
        b = structuredClone(a);
      if (r === '暴徒') {
        for (const k of [0, 1, 2])
          setupPair(
            e.name,
            '暴徒名额 ' + k,
            'A 有 ' + k + ' 名暴徒，B 有 3 名',
            configs(y, x, Array(k).fill(r)),
            configs(y, x, Array(3).fill(r)),
          );
      } else {
        b.characters.find((c) => c.identity === r).identity = '平民';
        setupPair(
          e.name,
          '配置 ' + r + ' ' + n,
          'B 将 A 的一名' + r + '改为平民，其余配置相同',
          a,
          b,
        );
      }
    }
    if (e.name === '因果线') {
      const a = configs(y, x),
        b = structuredClone(a);
      b.characters.at(-1).identity = '杀手';
      setupPair(e.name, '不追加身份', 'B 给平民追加未配置的杀手身份', a, b);
    }
  }
  const a = configs(
    module === 'FS' ? '复仇的火种' : '巨大定时炸弹X',
    module === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
  );
  const b = structuredClone(a);
  b.x = module === 'FS' ? [...b.x, '开膛者的魔影'] : ['流言四起'];
  setupPair(module, '规则 X 数量', '同一配置，A 有规定数量的 X，B 多一条或少一条', a, b);
  pair(
    '模组',
    module,
    '末轮失败后最终决战',
    'A 末轮失败；B 末轮成功。观察最终决战阶段或胜者。',
    'loop-end',
    (s, on) => {
      s.loop = 2;
      s.failed = on;
    },
    null,
    (s) => eq(module === 'FS' ? s.winner : s.phase, module === 'FS' ? 'mastermind' : 'final-guess'),
  );
  for (const [name, board, id] of module === 'FS'
    ? [
        ['守护此地', 'school'],
        ['复仇的火种', 'school', '主谋'],
      ]
    : [
        ['被封印的邪灵', 'shrine'],
        ['巨大定时炸弹X', 'school', '魔女'],
        ['和我签订契约吧！', null, '关键人物'],
      ]) {
    pair(
      '规则效果',
      name,
      '轮回结束失败条件',
      'A 密谋 2，B 密谋 1；身份依赖项固定同一角色。',
      'loop-end',
      (s, on) => {
        s.setup.y = name;
        if (id) role(s, 'b', id);
        if (board) s.boards[board] = on ? 2 : 1;
        else s.characters.b.counters.intrigue = on ? 2 : 1;
      },
      null,
      (s) => eq(s.failed, true),
    );
  }
  pair(
    '规则效果',
    '流言四起',
    '任意版图密谋 +1，每轮限一次',
    '在神社放置密谋。A 本轮尚未使用，B 本轮次数已耗尽。',
    'mastermind-abilities',
    (s, on) => {
      s.setup.x = ['流言四起'];
      if (!on) s.uses['loop:1:plot:流言四起:rumor-intrigue'] = 1;
    },
    action('rumor-intrigue', 'plot:流言四起', { target: 'shrine' }),
    (s) => eq(s.boards.shrine, 1),
  );
  if (module === 'FS') return;
  const contract = configs('和我签订契约吧！', ['流言四起', '因果线']),
    wrong = structuredClone(contract);
  [wrong.characters[0].character, wrong.characters[1].character] = [
    wrong.characters[1].character,
    wrong.characters[0].character,
  ];
  setupPair(
    '和我签订契约吧！',
    '关键人物必须具有少女属性',
    '交换女学生和男学生所持身份',
    contract,
    wrong,
  );
  pair(
    '规则效果',
    '改变未来',
    '本轮蝴蝶效应已发生',
    'A 本轮已发生，B 没有发生记录',
    'loop-end',
    (s, on) => {
      s.setup.y = '改变未来';
      if (on) s.incidents.push({ name: '蝴蝶效应', loop: 1, day: 1, culprit: 'a' });
    },
    null,
    (s) => eq(s.failed, true),
  );
  pair(
    '规则效果',
    '因果线',
    '上轮保有友好',
    'A 上轮末有 1 友好，B 为 0，本轮开始观察不安',
    'loop-start',
    (s, on) => {
      s.loop = 2;
      s.setup.x = ['因果线'];
      s.previousLoop = {
        characters: structuredClone(s.characters),
        boards: { ...s.boards },
        ex: 0,
      };
      s.previousLoop.characters.a.counters.goodwill = on ? 1 : 0;
    },
    null,
    (s) => eq(cnt(s, 'a', 'paranoia'), 2),
  );
  pair(
    '规则效果',
    '妄想扩大病毒',
    '平民在不安 3 时转为杀人狂',
    'A 不安 3，B 为 2；同区只有一名其他角色，观察其死亡',
    'day-end',
    (s, on) => {
      s.setup.x = ['妄想扩大病毒'];
      apply(s, { op: 'counter', target: 'a', counter: 'paranoia', amount: on ? 3 : 2 });
      s.observations.protagonists = [];
    },
    null,
    (s) => {
      eq(s.characters.a.identity, '杀人狂');
      eq(s.characters.b.status, 'dead');
    },
  );
}

function identities() {
  function test(name, clause, example, phase, prepare, choose, verify, expected) {
    pair(
      '身份',
      name,
      clause,
      example,
      phase,
      (s, on) => {
        role(s, 'a', name);
        prepare(s, on);
      },
      choose,
      verify,
      expected,
    );
  }
  for (const [name, def] of Object.entries(pack.identities)) {
    if (!def.ignore) continue;
    for (const refuse of [true, false]) {
      const mode = def.ignore;
      if (!refuse && mode === 'mandatory') continue;
      test(
        name,
        refuse ? '无视友好：拒绝' : '无视友好：接受',
        'A 为' + name + '，B 为' + (refuse ? '平民' : '邪教徒') + '。男学生声明移除女学生 1 不安。',
        'protagonist-abilities',
        (s, on) => {
          role(s, 'a', on ? name : refuse ? '平民' : '邪教徒');
          s.characters.a.counters.goodwill = 2;
          s.characters.b.counters.paranoia = 1;
        },
        (s, d) =>
          d.kind === 'refusal'
            ? { kind: 'refuse', refuse }
            : has(s, 'refused') && d.kind === 'ability'
              ? { kind: 'pass' }
              : action('student')(s, d),
        (s) => {
          eq(has(s, 'refused'), refuse);
          eq(cnt(s, 'b', 'paranoia'), refuse ? 1 : 0);
        },
      );
    }
  }
  test(
    '关键人物',
    '死亡时立即失败',
    'A 关键人物死亡，B 平民死亡',
    'day-end',
    (s, on) => {
      if (!on) role(s, 'a', '平民');
      death(s, 'a');
    },
    null,
    (s) => eq(s.failed, true),
  );
  for (const target of ['a', 'school'])
    test(
      '主谋',
      '同区' + (target === 'a' ? '角色' : '版图') + '密谋 +1',
      'A 有主谋，B 为平民。选择 ' + target,
      'mastermind-abilities',
      (s, on) => {
        if (!on) role(s, 'a', '平民');
      },
      action('brain', 'a', { target }),
      (s) => eq(target === 'a' ? cnt(s, 'a', 'intrigue') : s.boards.school, 1),
    );
  test(
    '传谣人',
    '同区角色不安 +1',
    '同样选择女学生 b，A 同区，B 异区',
    'mastermind-abilities',
    (s, on) => {
      if (!on) s.characters.a.area = 'city';
    },
    action('gossip', 'a', { target: 'b' }),
    (s) => eq(cnt(s, 'b', 'paranoia'), 1),
  );
  for (const [ability, clause] of [
    ['killer-character', '同区关键人物密谋 ≥2'],
    ['killer-protagonists', '自身密谋 ≥4'],
  ]) {
    const character = ability === 'killer-character';
    const prep = (s, on) => {
      if (character) role(s, 'b', '关键人物');
      s.characters[character ? 'b' : 'a'].counters.intrigue = (character ? 2 : 4) - (on ? 0 : 1);
    };
    test('杀手', clause, 'A 刚好达标，B 差一枚；A 发动', 'day-end', prep, action(ability), (s) =>
      character ? eq(s.characters.b.status, 'dead') : eq(s.protagonistDead, true),
    );
    test(
      '杀手',
      clause + '：放弃发动',
      '相同边界，双方均放弃，两个候选都应保留',
      'day-end',
      prep,
      null,
      (s) => {
        eq(s.protagonistDead, false);
        eq(s.characters.b.status, 'alive');
      },
      'possible',
    );
  }
  test(
    '邪教徒',
    '无效化同区禁止密谋',
    '学校版图密谋 +1 与禁止密谋同在，A 邪教徒在学校，B 在都市',
    'card-resolution',
    (s, on) => {
      if (!on) s.characters.a.area = 'city';
      placements(s, [
        ['mastermind', 'intrigue+1', 'school'],
        ['p0', 'block-intrigue', 'school'],
      ]);
    },
    action('cultist'),
    (s) => eq(s.boards.school, 1),
  );
  test(
    '亲友',
    '死亡状态在轮末公开并失败',
    'A 亲友已死亡，B 存活',
    'loop-end',
    (s, on) => {
      s.characters.a.status = on ? 'dead' : 'alive';
    },
    null,
    (s) => {
      eq(s.failed, true);
      eq(has(s, 'identity'), true);
    },
  );
  test(
    '亲友',
    '曾公开则轮初获得友好',
    'A 亲友曾正式公开，B 未公开',
    'loop-start',
    (s, on) => {
      s.loop = 2;
      s.characters.a.revealed = on;
    },
    null,
    (s) => eq(cnt(s, 'a', 'goodwill'), 1),
  );
  for (const count of [0, 2])
    test(
      '杀人狂',
      '同区恰有一人（对照 ' + count + ' 人）',
      'A 只有 b 同区，B 同区另外角色数为 ' + count,
      'day-end',
      (s, on) => {
        if (!on) {
          if (!count) s.characters.b.area = 'city';
          else s.characters.c.area = 'school';
        }
      },
      null,
      (s) => eq(s.characters.b.status, 'dead'),
    );
  if (module === 'FS') return;
  for (const [name, partner] of [
    ['心上人', '求爱者'],
    ['求爱者', '心上人'],
  ])
    test(
      name,
      '对应身份死亡，不安 +6',
      'A 死者为' + partner + '，B 死者为平民',
      'day-end',
      (s, on) => {
        role(s, 'b', on ? partner : '平民');
        death(s, 'b');
      },
      null,
      (s) => eq(cnt(s, 'a', 'paranoia'), 6),
    );
  for (const kind of ['intrigue', 'paranoia'])
    test(
      '求爱者',
      '密谋 ≥1 且不安 ≥3：' + kind + ' 边界',
      'A 密谋 1、不安 3；B 在被测条件上少一枚',
      'day-end',
      (s, on) => {
        Object.assign(s.characters.a.counters, { intrigue: 1, paranoia: 3 });
        if (!on) s.characters.a.counters[kind]--;
      },
      action('lover-kill'),
      (s) => eq(s.protagonistDead, true),
    );
  test(
    '时间旅者',
    '不死',
    'A 时间旅者，B 平民，收到同一死亡请求',
    'day-end',
    (s, on) => {
      if (!on) role(s, 'a', '平民');
      death(s, 'a');
    },
    null,
    (s) => eq(s.characters.a.status, 'alive'),
  );
  test(
    '时间旅者',
    '无视禁止友好',
    'A 时间旅者，B 平民；同时结算友好 +1 和禁止友好',
    'card-resolution',
    (s, on) => {
      if (!on) role(s, 'a', '平民');
      placements(s, [
        ['p0', 'goodwill+1', 'a'],
        ['mastermind', 'block-goodwill', 'a'],
      ]);
    },
    null,
    (s) => eq(cnt(s, 'a', 'goodwill'), 1),
  );
  for (const final of [true, false])
    test(
      '时间旅者',
      final ? '最终日限制' : '友好 ≤2',
      'A 最终日且友好 2；B ' + (final ? '仍在前一日' : '友好 3'),
      'day-end',
      (s, on) => {
        s.day = on || !final ? 2 : 1;
        s.characters.a.counters.goodwill = on || final ? 2 : 3;
      },
      action('time-traveler'),
      (s) => eq(s.failed, true),
    );
  for (const [board, ability] of [
    ['school', '传谣人'],
    ['city', '关键人物'],
  ])
    test(
      '不安定因子',
      board + ' 密谋 ≥2 获得' + ability + '能力',
      'A 版图密谋 2，B 为 1，配置身份均为不安定因子',
      board === 'city' ? 'day-end' : 'mastermind-abilities',
      (s, on) => {
        s.boards[board] = on ? 2 : 1;
        if (board === 'city') death(s, 'a');
      },
      action('gossip', 'a', { target: 'b' }),
      (s) => {
        eq(s.characters.a.identity, '不安定因子');
        board === 'city' ? eq(s.failed, true) : eq(cnt(s, 'b', 'paranoia'), 1);
      },
    );
}
function incidents() {
  const tests = {
    自杀: [['当事人死亡', {}, (s) => eq(s.characters.a.status, 'dead')]],
    谋杀: [['同区另一人死亡', { target: 'b' }, (s) => eq(s.characters.b.status, 'dead')]],
    不安扩散: [
      [
        '先加 2 不安，再给另一人加 1 密谋',
        { first: 'a', target: 'b' },
        (s) => {
          eq(cnt(s, 'a', 'paranoia'), 4);
          eq(cnt(s, 'b', 'intrigue'), 1);
        },
      ],
    ],
    散播: [
      [
        '先移除 2 友好，再给另一人加 2 友好',
        { first: 'a', target: 'b' },
        (s) => {
          eq(cnt(s, 'a', 'goodwill'), 0);
          eq(cnt(s, 'b', 'goodwill'), 2);
        },
      ],
    ],
    失踪: [
      [
        '移动当事人，再给目的版图加 1 密谋',
        { area: 'city' },
        (s) => {
          eq(s.characters.a.area, 'city');
          eq(s.boards.city, 1);
        },
      ],
    ],
    邪气污染: [['神社密谋 +2', {}, (s) => eq(s.boards.shrine, 2)]],
    蝴蝶效应: ['goodwill', 'paranoia', 'intrigue'].map((k) => [
      '同区放置 ' + k,
      { target: 'b', counter: k },
      (s) => eq(cnt(s, 'b', k), 1),
    ]),
    医院事故: [
      [
        1,
        {},
        (s) => {
          eq(s.characters.c.status, 'dead');
          eq(s.protagonistDead, false);
        },
      ],
      [
        2,
        {},
        (s) => {
          eq(s.characters.c.status, 'dead');
          eq(s.protagonistDead, true);
        },
      ],
    ],
    远距离杀人: [['目标密谋 ≥2', {}, (s) => eq(s.characters.c.status, 'dead')]],
  };
  for (const name of Object.keys(pack.incidents))
    for (const [clause, choices, verify] of tests[name]) {
      const board = name === '医院事故',
        remote = name === '远距离杀人';
      pair(
        '事件',
        name,
        board ? '医院密谋 ≥' + clause : clause,
        board
          ? 'A 医院密谋 ' + clause + '，B 少一枚；两者事件都发生'
          : remote
            ? '两者事件都发生。A 异区目标密谋 2，B 为 1'
            : '当事人 a 的不安 A=2、B=1（限度 2），选择 ' + JSON.stringify(choices),
        'incident',
        (s, on) => {
          s.setup.incidents = [{ day: 1, name, culprit: 'a' }];
          s.characters.a.counters.paranoia = on || board || remote ? 2 : 1;
          if (board) s.boards.hospital = clause - (on ? 0 : 1);
          if (remote) s.characters.c.counters.intrigue = on ? 2 : 1;
          if (name === '散播') s.characters.a.counters.goodwill = 2;
        },
        action('', '', choices),
        verify,
      );
      // Keep occurrence identical and vary only the possible culprit. Global effects have no owner information.
      if (board || remote) continue;
      const global = ['不安扩散', '散播', '邪气污染'].includes(name);
      pair(
        '事件归因',
        name,
        '同一次发生的当事人候选 · ' + clause,
        'a 在学校，c 在医院，两人均达限度，固定公开效果。候选 A=a、B=c。',
        'incident',
        (s, on) => {
          s.setup.incidents = [{ day: 1, name, culprit: on ? 'a' : 'c' }];
          s.characters.a.counters.paranoia = 2;
          s.characters.c.counters.paranoia = 2;
          if (name === '散播') s.characters.a.counters.goodwill = 2;
        },
        action('', '', choices),
        verify,
        global ? 'possible' : 'excluded',
      );
    }
}

function realtime() {
  for (const event of Object.keys(pack.incidents))
    for (const happened of [false, true]) {
      row(
        '即时剪枝',
        event,
        '发生判定 · ' + (happened ? '已发生' : '未发生'),
        '男学生 a 不安 2 达到限度，女学生 b 不安 0，其他角色均未达标。',
        () => {
          const s = state('discussion');
          s.characters.a.counters.paranoia = 2;
          s.setup.incidents = [{ day: 1, name: event, culprit: 'a' }];
          const k = new LiveKnowledge(pack, project(s, 'protagonists'));
          const before = k.snapshot().culprits['1'];
          k.append(
            [
              {
                sequence: 1,
                phase: 'incident',
                loop: 1,
                day: 1,
                type: 'incident',
                data: { name: event, day: 1, occurred: happened },
              },
            ],
            0,
            1,
          );
          const after = k.snapshot().culprits['1'] ?? [];
          const expected = happened ? ['a'] : ['b', 'c', 'd'];
          return {
            status:
              before.length === 4 && JSON.stringify([...after].sort()) === JSON.stringify(expected)
                ? '通过'
                : '未通过',
            detail: '初始 ' + before + '；预期 ' + expected + '；实际 ' + after,
          };
        },
      );
    }
}
for (module of ['FS', 'BTX']) {
  pack = compileOfficial(module, false);
  plots();
  identities();
  incidents();
  realtime();
  if (module === 'FS')
    row(
      '剧本配置',
      '暴徒',
      '剧本制作时，自选 0 至 2 名',
      'FS 选择「最黑暗的剧本」。固定其他必需身份，最后三个普通位各在平民、暴徒中选择，逐一比较八种赋值。',
      () => {
        const setup = configs('复仇的火种', ['最黑暗的剧本'], ['平民', '平民']);
        const opening = project(initialState(pack, setup), 'protagonists');
        const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 })
          .filter((p) => p.y === setup.y && p.x.includes(setup.x[0]));
        const generated = new Set();
        for (const candidate of configurations(pack, opening, profiles))
          if (candidate) generated.add(candidate.characters.map((c) => c.identity).join('|'));
        const cases = [];
        for (let mask = 0; mask < 8; mask++) {
          const candidate = structuredClone(setup);
          candidate.characters.slice(-3).forEach((c, i) => {
            if (mask & (1 << i)) c.identity = '暴徒';
          });
          const roles = candidate.characters.map((c) => c.identity);
          const legal = !!initialize(pack, candidate).state;
          const retained = generated.has(roles.join('|'));
          assert.equal(legal, mask !== 7, roles.join('、'));
          assert.equal(retained, legal, roles.join('、'));
          cases.push({ 三个普通位: roles.slice(-3), 剧本制作合法: legal, 求解器保留: retained });
        }
        return { status: '通过', detail: '0 名保留 1 种，1 名保留 3 种，2 名保留 3 种；3 名的唯一赋值在剧本校验及求解器建域均被排除。', input: { setup, cases } };
      },
    );
  const helpers = {
    pack,
    row,
    pair,
    sourceEntry,
    role,
    card,
    cnt,
    eq,
    action,
    apply,
    placements,
    death,
    configs,
    setupPair,
  };
  goodwillCases(helpers);
  traitCases(helpers);
  extraCases(helpers);
  abilityWindows({ ...helpers, row, LiveKnowledge, project, state });
  legalHistory({
    ...helpers,
    row,
    initialize,
    advance,
    LiveKnowledge,
    project,
    HistorySearch,
    normalizeHistory,
  });
}
const dest = path.join(root, 'products/engine/single-rule-audit.html');
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
const totals = Object.fromEntries(
  ['通过', '未通过', '未决', '未即时排除', '待校对'].map((k) => [
    k,
    rows.filter((r) => r.status === k).length,
  ]),
);
const git = (...args) => execFileSync('git', ['-C', solver, ...args], { encoding: 'utf8' }).trim();
const version = git('rev-parse', 'HEAD');
const digest = createHash('sha256');
for (const dir of ['packages/engine/src', 'packages/content/src', 'packages/contracts/src']) {
  const files = fs.readdirSync(path.join(solver, dir), { recursive: true })
    .filter((name) => /\.(?:ts|json)$/.test(name)).map((name) => name.replaceAll('\\', '/')).sort();
  for (const name of files)
    digest.update(dir + '/' + name + '\0').update(fs.readFileSync(path.join(solver, dir, name))).update('\0');
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
const groups = [
  '合法开局端到端',
  ...new Set(rows.map((r) => r.group).filter((g) => g !== '合法开局端到端')),
];
fs.writeFileSync(
  dest,
  `<!doctype html><html lang="zh-CN"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>FS、BTX 单条规则验收</title><style>body{max-width:1200px;margin:auto;padding:2rem;font:16px/1.65 system-ui;color:#203132}h2{border-bottom:2px solid #26766a}article{padding:.7rem 1rem;background:#f4f7f5;margin:.6rem 0;border-left:4px solid #377968}article.bad{border-color:#a63b34;background:#fff4ec}summary{cursor:pointer}pre{overflow:auto;white-space:pre-wrap}input{padding:.6rem;width:min(90%,28rem)}select{padding:.6rem} small{color:#42605a}a{color:#136055}</style><h1>FS、BTX 单条规则验收</h1><p>基础版，关闭周年追加。共 ${rows.length} 个判定项：${Object.entries(
    totals,
  )
    .map(([k, v]) => k + ' ' + v)
    .join(
      '，',
    )}。同一条目的多项能力、触发门槛和次数分别判定。通过表示列出的样例满足预期。低友好请求是刻意提交的非法输入，用来检查实时层能否发现矛盾。合法开局端到端样例另测正常游戏中成功结算后应当消失的身份。</p><p>剧本配置使用参考运算器 queryReference；即时剪枝使用 LiveKnowledge 的公开输入。阶段样例只保留被测机制，用固定的 A、B 检查点及主人公可见的观察运行生产 HistorySearch，搜索全部兼容选择至见证、穷尽或 1500 步。测试适配器替换其初始栈；检查点可以是局部构造的盘面。此项检查历史层的剪枝，不能据此断言同一结果会在实时矩阵立刻出现。完整前缀包括阶段边界，保留允许同一公开历史的替代解释。</p><p>版本 ${version}。内核、规则内容及契约源码 SHA-256：${digest.digest('hex')}。运行：<code>pnpm exec tsx scripts/engine/single-rule-audit.mjs</code>。自动结果，待人类验收。</p><label>搜索 <input id=q placeholder="角色、规则、事件"></label> <select id=f><option>全部结果</option>${Object.keys(
    totals,
  )
    .map((k) => '<option>' + k + '</option>')
    .join('')}</select>
${groups
  .map(
    (g) =>
      '<section><h2>' +
      g +
      '</h2>' +
      rows
        .filter((r) => r.group === g)
        .map((r) => {
          const entry =
            catalog.find((e) => e.name === r.name && (e.module === r.module || !e.module)) ??
            catalog.find(
              (e) => e.kind === 'modules' && e.module === r.module && r.name === r.module,
            );
          return (
            '<article data-status="' +
            r.status +
            '" class="' +
            (r.status === '通过' ? '' : 'bad') +
            '"><small>' +
            r.module +
            ' · ' +
            r.status +
            '</small><h3>' +
            esc(r.name) +
            ' · ' +
            esc(r.clause) +
            '</h3><p>' +
            esc(r.example) +
            '</p><p>' +
            esc(r.detail) +
            '</p>' +
            (r.history || r.input
              ? '<details><summary>' +
                (r.history ? '主人公公开观察' : '候选配置') +
                '</summary><pre>' +
                esc(JSON.stringify(r.history ?? r.input, null, 2)) +
                '</pre></details>'
              : '') +
            (r.history && r.input
              ? '<details><summary>两份候选剧本</summary><pre>' +
                esc(JSON.stringify(r.input, null, 2)) +
                '</pre></details>'
              : '') +
            (entry ? ' <a href="../../' + esc(entry.source) + '">本地规则依据</a>' : '') +
            '</article>'
          );
        })
        .join('') +
      '</section>',
  )
  .join(
    '',
  )}<script>function filter(){for(const a of document.querySelectorAll('article'))a.hidden=!a.textContent.includes(q.value)||(f.selectedIndex>0&&a.dataset.status!==f.value);for(const s of document.querySelectorAll('section'))s.hidden=!s.querySelector('article:not([hidden])')}q.oninput=f.onchange=filter;q.value=new URLSearchParams(location.search).get('q')||'';filter()</script></html>`,
);
console.log(JSON.stringify(totals));
for (const r of rows.filter((r) => r.status !== '通过'))
  console.log(r.module, r.name, r.clause, r.detail);
process.exitCode =
  totals['未通过'] || totals['未决'] || totals['未即时排除'] || totals['待校对'] ? 1 : 0;
