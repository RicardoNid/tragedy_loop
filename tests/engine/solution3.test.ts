import assert from 'node:assert/strict';
import test from 'node:test';
import { admits } from '../../scripts/engine/solution3-offline-sat.js';
import type {
  Module,
  Observation,
  PlayerView,
  PublicCharacter,
} from '../../packages/contracts/src/game.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import { matchDeaths } from '../../packages/engine/src/solution3/death.js';
import { matchCounterSteps } from '../../packages/engine/src/solution3/counter-incident.js';
import { newWork, Relations } from '../../packages/engine/src/solution3/relations.js';

const counters = { paranoia: 0, goodwill: 0, intrigue: 0, guard: 0, hope: 0, despair: 0 };
function opening(module: Module = 'FS'): PlayerView {
  const names = ['男学生', '女学生', '巫女', '职员', '刑警', '偶像'];
  const cast: PublicCharacter[] = names.map((character, i) => ({
    id: 'c' + i,
    character,
    status: 'alive',
    area: i < 2 ? 'school' : 'city',
    counters: { ...counters },
  }));
  return {
    module,
    anniversary: false,
    loops: 2,
    days: 3,
    phase: 'discussion',
    revision: 0,
    loop: 1,
    day: 1,
    captain: 'p0',
    discussionAllowed: true,
    boards: { school: 0, city: 0, hospital: 0, shrine: 0 },
    incidents: [{ day: 1, name: '自杀' }],
    observations: [],
    characters: cast,
    placements: [],
    hands: {},
  };
}
const event = (
  sequence: number,
  type: Observation['type'],
  data: Observation['data'],
  phase: Observation['phase'] = 'incident',
  day = 1,
  loop = 1,
): Observation => ({ sequence, type, data, phase, day, loop });
test('MC 猎奇杀人及银色子弹在发生后按 EX 区分黑猫，闭合前保留两种来源', () => {
  for (const [name, ordinary] of [
    ['猎奇杀人', 2],
    ['银色子弹', 0],
  ] as const) {
    for (const gain of [1, ordinary, undefined]) {
      const v = opening('MC');
      v.ex = 2;
      v.incidents = [{ day: 1, name }];
      v.characters[0]!.character = '黑猫';
      v.characters.forEach((c) => (c.counters.paranoia = 6));
      const s = new SolutionSpace3(v),
        g = s.model.graph;
      const cat = s.model.culprits.get(1)!['黑猫']!;
      s.append([
        event(1, 'boundary', {}, 'incident'),
        event(2, 'incident', { day: 1, name, occurred: true }),
      ]);
      assert.equal(g.truth(cat), undefined);
      assert(!s.conflict);
      if (gain !== undefined) {
        s.append([event(3, 'board', { ex: v.ex + gain })]);
        assert.equal(g.truth(cat), gain === 1);
      } else {
        s.append([event(3, 'boundary', {}, ordinary === 0 ? 'loop-end' : 'captain-change')]);
        if (ordinary !== 0) {
          assert.match(s.conflict!, /#3/);
          continue;
        }
        assert.equal(g.truth(cat), false);
      }
      assert(!s.conflict);
    }
  }
});
function marks(s: SolutionSpace3) {
  return s.model.rows.map((r) => Object.values(r.cells).map((a) => s.model.graph.mark(a)));
}
test('LL 遗言在下一轮发希望；黑猫替换事件文本，尚未闭合时不根据缺失发牌排除', () => {
  for (const received of [false, true]) {
    const v = opening('LL');
    v.loops = 3;
    v.characters[0]!.character = '黑猫';
    v.incidents = [{ day: 1, name: '遗言' }];
    v.characters[1]!.counters.paranoia = 6;
    const s = new SolutionSpace3(v),
      cat = s.model.culprits.get(1)!['黑猫']!;
    s.append([
      event(1, 'incident', { occurred: true, day: 1, name: '遗言' }),
      event(2, 'boundary', {}, 'discussion', 1, 2),
      event(3, 'boundary', {}, 'loop-start', 1, 2),
    ]);
    assert.equal(s.model.graph.truth(cat), undefined);
    if (received)
      s.append([event(4, 'card-grant', { owner: 'p0', kind: 'hope+1' }, 'loop-start', 1, 2)]);
    s.append([event(s.through + 1, 'boundary', {}, 'day-start', 1, 2)]);
    assert(!s.conflict);
    assert.equal(s.model.graph.truth(cat), !received);
  }
});
test('HSA 古墓活尸视版图密谋为丧尸尸体，平局不触发，严格占优时必须处理', () => {
  for (const tokens of [1, 2]) {
    const v = opening('HSA');
    v.incidents = [];
    v.boards.school = tokens;
    v.characters.forEach((c, i) => {
      c.area = i === 0 ? 'school' : 'city';
    });
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'rule', { rule: '古墓活尸' }, 'protagonist-abilities'),
      event(2, 'identity', { character: 'c0', identity: '平民' }, 'protagonist-abilities'),
      event(3, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict);
    s.append([event(4, 'boundary', {}, 'day-start', 2)]);
    assert.equal(Boolean(s.conflict), tokens === 2);
  }
});
test('FS 单独增加不安限定传谣人的区域；符合资格的医生保留独立替代解释', () => {
  for (const goodwill of [0, 2]) {
    const v = opening();
    v.characters[0]!.character = '医生';
    v.characters[0]!.counters.goodwill = goodwill;
    const s = new SolutionSpace3(v);
    s.append([
      event(
        1,
        'character',
        {
          character: 'c1',
          area: 'school',
          status: 'alive',
          counters: { ...counters, paranoia: 1 },
        },
        'mastermind-abilities',
      ),
    ]);
    assert(!s.conflict);
    assert.equal(s.model.graph.mark(s.model.ids.get('刑警')!['传谣人']!), goodwill ? '' : '×');
    assert.equal(s.model.graph.mark(s.model.ids.get('女学生')!['传谣人']!), goodwill ? '' : '？');
  }
});
test('转校生按实际密谋替换友好，允许零密谋目标；缺失变化仅在已接受且闭合时构成矛盾', () => {
  for (const [intrigue, reported] of [
    [0, false],
    [1, false],
    [1, true],
  ] as const) {
    const v = opening();
    v.characters[0]!.character = '转校生';
    v.characters[0]!.counters.goodwill = 2;
    v.characters[1]!.counters.intrigue = intrigue;
    v.characters[1]!.counters.despair = 1;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, 'protagonist-abilities'),
      event(
        2,
        'declaration',
        { character: 'c0', ability: 'transfer-student', choices: { target: 'c1' } },
        'protagonist-abilities',
      ),
    ]);
    if (reported)
      s.append([
        event(
          3,
          'character',
          {
            character: 'c1',
            area: 'school',
            status: 'alive',
            counters: { ...counters, goodwill: 1, despair: 1 },
          },
          'protagonist-abilities',
        ),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident')]);
    assert.equal(Boolean(s.conflict), intrigue === 1 && !reported);
  }
});
test('HSA 已附身的两张诅咒共同结算，返回版图后才约束不死与护卫，不把返回解释为新放置', () => {
  for (const [spent, dead, valid] of [
    [0, false, true],
    [1, true, true],
    [1, false, false],
  ] as const) {
    const v = opening('HSA');
    v.incidents = [];
    v.characters[0]!.counters.guard = 1;
    const s = new SolutionSpace3(v),
      cards = (target: string) => ['a', 'b'].map((id) => ({ id, target }));
    s.append([
      event(1, 'board', { curses: cards('c0') }, 'incident'),
      event(2, 'boundary', {}, 'day-end'),
    ]);
    if (spent)
      s.append([
        event(
          3,
          'character',
          {
            character: 'c0',
            area: 'school',
            status: dead ? 'dead' : 'alive',
            counters: { ...counters, guard: 0 },
          },
          'day-end',
        ),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'board', { curses: cards('school') }, 'day-end')]);
    assert.equal(!s.conflict, valid);
    if (valid && !dead)
      assert.equal(s.model.graph.truth(s.model.ids.get('男学生')!['平民']!), false);
  }
});
test('HSA 诅咒先杀死第三人，之后杀人狂读取剩余两人的区域', () => {
  for (const curse of [true, false]) {
    const v = opening('HSA');
    v.incidents = [];
    v.characters[2]!.area = 'school';
    const s = new SolutionSpace3(v);
    const h = [
      event(1, 'identity', { character: 'c0', identity: '杀人狂' }, 'protagonist-abilities'),
      event(2, 'identity', { character: 'c1', identity: '平民' }, 'protagonist-abilities'),
    ];
    if (curse) h.push(event(3, 'board', { curses: [{ id: 'A', target: 'c2' }] }));
    h.push(event(h.length + 1, 'boundary', {}, 'day-end'));
    if (curse)
      h.push(
        event(
          h.length + 1,
          'character',
          { character: 'c2', area: 'school', status: 'dead', counters },
          'day-end',
        ),
        event(h.length + 2, 'board', { curses: [{ id: 'A', target: 'school' }] }, 'day-end'),
      );
    s.append(h);
    assert(!s.conflict);
    s.append([event(h.length + 1, 'boundary', {}, 'day-start', 2)]);
    assert.equal(Boolean(s.conflict), curse);
  }
});
test('周年事件希望之光用有效友好触发，黑猫取消、普通一次与教主两次在闭合时区分', () => {
  for (const amount of [0, 1, 2]) {
    const v = opening('BTX');
    v.anniversary = true;
    v.incidents = [{ day: 1, name: '希望之光' }];
    v.characters[0]!.character = '教主';
    v.characters[1]!.character = '黑猫';
    v.characters.forEach((p) => (p.counters.goodwill = 8));
    const s = new SolutionSpace3(v);
    s.append([event(1, 'incident', { day: 1, name: '希望之光', occurred: true })]);
    if (amount)
      s.append([
        event(2, 'character', {
          character: 'c3',
          area: 'city',
          status: 'alive',
          counters: { ...v.characters[3]!.counters, hope: amount },
        }),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert(!s.conflict);
    const row = s.model.culprits.get(1)!;
    assert.equal(s.model.graph.truth(row['教主']!), amount === 2);
    assert.equal(s.model.graph.truth(row['黑猫']!), amount === 0);
  }
});
test('医院事故中从者承受直接与替死两项请求，一枚护卫只挡一项', () => {
  for (const servantDies of [false, true]) {
    const v = opening('FS');
    v.incidents = [{ day: 1, name: '医院事故' }];
    v.boards.hospital = 1;
    Object.assign(v.characters[0]!, { character: '大小姐', area: 'hospital' });
    Object.assign(v.characters[1]!, {
      character: '从者',
      area: 'hospital',
      counters: { ...counters, guard: 1 },
    });
    v.characters[2]!.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c2' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '医院事故', occurred: true }),
      event(3, 'character', {
        character: 'c1',
        status: servantDies ? 'dead' : 'alive',
        area: 'hospital',
        counters,
      }),
    ]);
    assert(!s.conflict);
    s.append([event(4, 'boundary', {}, 'captain-change')]);
    assert.equal(Boolean(s.conflict), !servantDies);
  }
});
test('HSA 日末诅咒按卡号独立选择，同版图两张可以附身同一人，缺失只在闭合时矛盾', () => {
  for (const target of ['c0', 'c2', 'missing']) {
    const v = opening('HSA');
    v.incidents = [];
    const s = new SolutionSpace3(v);
    const curses = (dest: string) => ['A', 'B'].map((id) => ({ id, target: dest }));
    s.append([
      event(1, 'board', { curses: curses('school') }, 'incident'),
      event(2, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict);
    if (target !== 'missing') s.append([event(3, 'board', { curses: curses(target) }, 'day-end')]);
    if (target === 'missing') assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'day-start', 2)]);
    assert.equal(Boolean(s.conflict), target !== 'c0', target);
  }
});
test('MZ 阴谋活动单次结算不能同时移动当事人并杀害同区角色', () => {
  for (const moved of [false, true]) {
    const v = opening('MZ');
    v.incidents = [{ day: 1, name: '阴谋活动' }];
    v.characters[0]!.counters.intrigue = 5;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '阴谋活动', occurred: true }),
      event(3, 'character', { character: 'c1', area: 'school', status: 'dead', counters }),
    ]);
    if (moved)
      s.append([
        event(4, 'character', {
          character: 'c0',
          area: 'city',
          status: 'alive',
          counters: v.characters[0]!.counters,
        }),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(Boolean(s.conflict), moved);
  }
});
test('教主两次阴谋活动按顺序读取移动后的区域与版图密谋上限', () => {
  for (const [prior, increment, early, ok] of [
    [0, 1, false, true],
    [3, 0, false, true],
    [0, 0, false, false],
    [0, 2, false, false],
    [0, 1, true, false],
  ] as const) {
    const v = opening('MZ');
    v.characters[0]!.character = '教主';
    v.characters[0]!.counters.intrigue = 5;
    v.incidents = [{ day: 1, name: '阴谋活动' }];
    v.boards.city = prior;
    const s = new SolutionSpace3(v);
    const history = [
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '阴谋活动', occurred: true }),
    ];
    const addDeath = () =>
      history.push(
        event(history.length + 1, 'character', {
          character: 'c2',
          area: 'city',
          status: 'dead',
          counters,
        }),
      );
    if (early) addDeath();
    history.push(
      event(history.length + 1, 'character', {
        character: 'c0',
        area: 'city',
        status: 'alive',
        counters: v.characters[0]!.counters,
      }),
    );
    if (increment)
      history.push(
        event(history.length + 1, 'board', { board: 'city', intrigue: prior + increment }),
      );
    if (!early) addDeath();
    s.append(history);
    assert(!s.conflict);
    s.append([event(history.length + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(
      !s.conflict,
      ok,
      JSON.stringify({ prior, increment, early, conflict: s.conflict }),
    );
  }
});
test('MZ 伪造事件读取初始区域，两枚密谋的强制死亡可被先前接受的军人保护阻止', () => {
  for (const protectedHero of [false, true]) {
    for (const dies of [false, true]) {
      const v = opening('MZ');
      v.incidents = [{ day: 1, name: '校庆' }];
      v.boards.school = 2;
      v.characters[0]!.counters.paranoia = 4;
      v.characters[1]!.character = '军人';
      v.characters[1]!.counters.goodwill = 5;
      const s = new SolutionSpace3(v);
      const input: Observation[] = [];
      const add = (
        type: Observation['type'],
        data: Observation['data'],
        phase: Observation['phase'],
      ) => input.push(event(input.length + 1, type, data, phase));
      add('boundary', {}, 'protagonist-abilities');
      add('culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities');
      if (protectedHero)
        add(
          'declaration',
          { character: 'c1', ability: 'soldier-protect' },
          'protagonist-abilities',
        );
      add('boundary', {}, 'incident');
      add('incident', { day: 1, name: '校庆', occurred: true }, 'incident');
      if (dies) add('failure', { result: 'protagonist-death' }, 'incident');
      s.append(input);
      assert(!s.conflict);
      s.append([event(input.length + 1, 'boundary', {}, dies ? 'loop-end' : 'captain-change')]);
      assert.equal(!!s.conflict, dies === protectedHero);
    }
  }
});
test('手下已达发生门槛时，只有本轮已获接受的友好声明才能抑制自己的事件', () => {
  for (const declared of [false, true]) {
    for (const occurred of [true, false]) {
      const v = opening();
      v.characters[0]!.character = '手下';
      v.characters[0]!.counters = { ...counters, paranoia: 1, goodwill: 3 };
      const s = new SolutionSpace3(v);
      const history = [
        event(1, 'boundary', {}, 'protagonist-abilities'),
        event(2, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      ];
      if (declared)
        history.push(
          event(
            3,
            'declaration',
            { character: 'c0', ability: 'henchman' },
            'protagonist-abilities',
          ),
        );
      s.append(history);
      assert(!s.conflict);
      s.append([
        event(history.length + 1, 'boundary', {}, 'incident'),
        event(history.length + 2, 'incident', { day: 1, name: '自杀', occurred }),
      ]);
      assert.equal(!!s.conflict, occurred === declared);
    }
  }
});
test('七个官方模组与适用周年追加以命题开局，完整配置验证为零', () => {
  for (const m of ['BTX', 'FS', 'MZ', 'HSA', 'LL', 'WM', 'MC'] as const)
    for (const ann of m === 'LL' ? [false] : [false, true]) {
      const v = opening(m);
      v.anniversary = ann;
      v.incidents = [
        {
          day: 1,
          name: m === 'HSA' ? '疯狂之夜' : m === 'WM' ? '发现' : m === 'LL' ? '遗言' : '自杀',
        },
      ];
      const s = new SolutionSpace3(v);
      assert.equal(s.conflict, undefined, m + ' ' + ann);
      assert.equal(s.model.graph.work.configurations, 0);
      assert(!s.seen.has('转校生'));
      if (ann) assert(s.model.fragments.size >= 6);
    }
  assert.throws(() => new SolutionSpace3(opening('AHR')), /AHR/);
});
test('伪造事件自由命名、灭亡讴歌与真实自杀形成跨日关系', () => {
  const v = opening('MZ');
  v.incidents.push({ day: 2, name: '他乡' }, { day: 3, name: '连续杀人' });
  const s = new SolutionSpace3(v),
    m = s.model,
    g = m.graph;
  assert.equal(g.mark(m.events.get(2)!['伪造事件']!), '√');
  assert.equal(g.mark(m.events.get(1)!['自杀']!), '？');
  s.append([event(1, 'rule', { rule: '灭亡讴歌' }, 'protagonist-abilities')]);
  assert.equal(g.mark(m.events.get(1)!['自杀']!), '√');
  assert.equal(g.mark(m.events.get(1)!['伪造事件']!), '×');
  assert.equal(g.mark(m.events.get(3)!['伪造事件']!), '？');
});
test('WM 的 X1 公告、主线、预设失败条件和读取 EX 的轮回独立', () => {
  const v = opening('WM');
  v.incidents = [{ day: 1, name: '发现' }];
  v.characters[0]!.character = '情报商';
  v.ex = 1;
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'rule', { rule: '疯狂的真相' }, 'loop-end'),
    event(2, 'boundary', {}, 'loop-start'),
    event(3, 'rule', { rule: '黄衣之王' }, 'protagonist-abilities'),
  ]);
  assert.equal(m.graph.mark(m.x1['疯狂的真相']!), '√');
  assert.equal(m.graph.mark(m.x2!['疯狂的真相']!), '×');
  assert.equal(m.graph.mark(m.alt['黄衣之王']!), '×');
  assert.deepEqual(s.failureSources, ['黄衣之王']);
  s.append([event(4, 'board', { ex: 2 }, 'day-end'), event(5, 'boundary', {}, 'loop-start', 1, 2)]);
  assert(!s.failureSources.includes('黄衣之王'));
  assert(s.failureSources.length > 0);
});
test('发生门槛和联合证据在每个前缀与独立小穷举一致，重复提交零工作', () => {
  const v = opening();
  v.incidents.push({ day: 2, name: '谋杀' });
  v.characters[0]!.counters.paranoia = 4;
  v.characters[1]!.counters.paranoia = 4;
  const s = new SolutionSpace3(v),
    m = s.model;
  const first = m.culprits.get(1)!,
    second = m.culprits.get(2)!;
  const a = v.characters[0]!.character,
    b = v.characters[1]!.character;
  const names = Object.keys(first);
  let pairs = names.flatMap((x) => names.filter((y) => x !== y).map((y) => [x, y]));
  const history = [
    event(1, 'incident', { day: 1, name: '自杀', occurred: true }),
    event(2, 'culprit', { day: 2, culprit: 'c1' }, 'protagonist-abilities'),
  ];
  for (let i = 0; i < 2; i++) {
    pairs = i === 0 ? pairs.filter(([x]) => x === a || x === b) : pairs.filter(([, y]) => y === b);
    s.append([history[i]!]);
    for (const [j, map] of [first, second].entries())
      for (const name of names) {
        const n = pairs.filter((p) => p[j] === name).length;
        assert.equal(
          m.graph.truth(map[name]!),
          n === 0 ? false : n === pairs.length ? true : undefined,
        );
      }
    assert.equal(m.graph.mark(first[a]!), i === 0 ? '？' : '√');
    const replay = new SolutionSpace3(v);
    replay.append(history.slice(0, i + 1));
    assert.deepEqual(marks(replay), marks(s));
    assert.deepEqual(replay.model.graph.rules, m.graph.rules);
  }
  const prior = marks(s),
    length = m.graph.rules.length;
  s.append(history);
  assert.deepEqual(m.graph.work, { sources: [], combinations: 0, configurations: 0, checks: 0 });
  assert.deepEqual(marks(s), prior);
  assert.equal(m.graph.rules.length, length);
});
test('延迟登场仅排除已闭合日期，缺口和同批分段保留原有行', () => {
  const s = new SolutionSpace3(opening()),
    m = s.model;
  const slot = m.arrival.get('转校生')!;
  s.append([event(1, 'boundary', {}, 'day-start'), event(2, 'boundary', {}, 'mastermind-cards')]);
  assert.equal(m.graph.truth(slot[0]!), false);
  assert.equal(m.graph.truth(slot[1]!), undefined);
  const group = [
    event(3, 'boundary', {}, 'day-start', 2, 2),
    event(
      4,
      'character',
      { character: 'transfer', area: 'school', status: 'alive', counters },
      'day-start',
      2,
      2,
    ),
  ].map((o) => ({ ...o, simultaneousGroup: 3, simultaneousSize: 2 }));
  const roster = [{ id: 'transfer', character: '转校生' }];
  s.append([group[1]!], roster);
  assert.equal(s.through, 2);
  assert(s.partial);
  s.append([group[0]!], roster);
  assert(!s.partial);
  assert.equal(m.graph.truth(slot[1]!), true);
  assert(s.seen.has('转校生'));
  assert.equal(m.graph.truth(m.absent.get('转校生')!), false);
});
test('预算暂停及冲突定位，冲突批次不产生后续单格结论', () => {
  const s = new SolutionSpace3(opening()),
    m = s.model;
  const history = [
    event(1, 'culprit', { day: 1, culprit: 'c0' }),
    event(2, 'culprit', { day: 1, culprit: 'c1' }),
  ];
  s.append(history, [], 1);
  assert(s.budgetStopped);
  assert(!s.conflict);
  const old = marks(s);
  s.append([]);
  assert.match(s.conflict!, /#2/);
  assert.deepEqual(marks(s), old);
  s.append([event(3, 'rule', { rule: '流言四起' })]);
  assert.equal(s.through, 2);
  assert.equal(m.graph.work.checks, 0);
});
test('强制击杀读取三枚有效不安，闭合和未闭合窗口分别测试', () => {
  for (const [paranoia, died] of [
    [2, true],
    [3, true],
    [3, false],
  ] as const) {
    const v = opening('BTX');
    v.characters[0]!.counters.paranoia = paranoia;
    const s = new SolutionSpace3(v),
      m = s.model;
    s.append([
      event(1, 'rule', { rule: '妄想扩大病毒' }, 'protagonist-abilities'),
      event(2, 'identity', { character: 'c0', guess: '平民', correct: true }, 'final-guess'),
      event(3, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict);
    if (died)
      s.append([
        event(
          4,
          'character',
          { character: 'c1', area: 'school', status: 'dead', counters },
          'day-end',
        ),
      ]);
    else s.append([event(4, 'boundary', {}, 'day-start', 2)]);
    assert.equal(!!s.conflict, paranoia === 2 && died);
    if (!died) assert.equal(m.graph.mark(m.ids.get('女学生')!['时间旅者']!), '√');
    assert.equal(m.graph.work.configurations, 0);
  }
});
test('窗口推进与新的无关角色不增加本地来源和组合尝试', () => {
  const work = (extra: boolean) => {
    const v = opening();
    if (extra) v.characters.push({ ...v.characters[3]!, id: 'extra', character: '大小姐' });
    const s = new SolutionSpace3(v);
    s.append([event(1, 'board', { board: 'school', intrigue: 1 }, 'mastermind-abilities')]);
    assert(!s.conflict);
    return s.model.graph.work;
  };
  const a = work(false),
    b = work(true);
  assert.deepEqual(a.sources, b.sources);
  assert.equal(a.combinations, b.combinations);
});
test('后台替代关系在排除其他解释以后投影到限定集合', () => {
  const g = new Relations(),
    a = g.atom('甲'),
    b = g.atom('乙'),
    other = g.atom('另一来源');
  g.add('来源析取', [a, b, other], 1);
  g.add('限定身份集合', [a, b], 1, 2, -other, true);
  g.propagate();
  assert.equal(g.mark(a), '');
  g.add('后一公告', [-other], 1);
  g.propagate();
  assert.equal(g.mark(a), '？');
  assert.equal(g.mark(b), '？');
});
test('FS 两席剧本完整小穷举：闭合登场窗口后的每个前缀及联合身份', () => {
  const v = opening();
  v.days = 1;
  v.loops = 1;
  v.incidents = [];
  v.characters = v.characters.slice(0, 2);
  const history = [
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
    event(4, 'identity', { character: 'c0', identity: '主谋' }, 'protagonist-abilities'),
  ];
  // 独立列出全部制作选择和名额，再按座位排列。两席均已公开，两个延迟角色的合法窗口均闭合。
  const main = [['关键人物', '杀手', '主谋'], ['主谋'], ['关键人物', '邪教徒']];
  const side = [['传谣人', '杀人狂'], ['传谣人'], ['传谣人', '亲友']];
  const allowed = main.flatMap((a) =>
    side.flatMap((b) => {
      const roles = [...a, ...b];
      return roles.length === 2 ? [roles, [...roles].reverse()] : [];
    }),
  );
  assert.equal(allowed.length, 2);
  for (const limit of [3, 4]) {
    const expected = allowed.filter((r) => limit === 3 || r[0] === '主谋');
    const s = new SolutionSpace3(v);
    s.append(history.slice(0, limit));
    const m = s.model;
    assert.equal(s.conflict, undefined);
    assert.equal(m.graph.mark(m.plots['复仇的火种']!), '√');
    assert.equal(m.graph.mark(m.plots['流言四起']!), '√');
    const roles = Object.keys(m.ids.get('男学生')!);
    for (const [i, n] of ['男学生', '女学生'].entries())
      for (const role of roles) {
        const count = expected.filter((r) => r[i] === role).length;
        assert.equal(
          m.graph.truth(m.ids.get(n)![role]!),
          count === 0 ? false : count === expected.length ? true : undefined,
          n + role,
        );
      }
    for (const a of roles)
      for (const b of roles) {
        const trial = new SolutionSpace3(v);
        trial.append(history.slice(0, limit));
        const t = trial.model;
        t.graph.add('离线验证指定两席', [t.ids.get('男学生')![a]!, t.ids.get('女学生')![b]!], 2, 2);
        t.graph.propagate();
        assert.equal(
          t.graph.conflict === undefined,
          expected.some((r) => r[0] === a && r[1] === b),
        );
      }
  }
});
test('FS 两席及两名后台角色从开局到登场窗口闭合逐前缀核对独立完整穷举', () => {
  const v = opening();
  v.days = v.loops = 1;
  v.incidents = [];
  v.characters = v.characters.slice(0, 2);
  const main = {
    谋杀计划: ['关键人物', '杀手', '主谋'],
    复仇的火种: ['主谋'],
    守护此地: ['关键人物', '邪教徒'],
  };
  const side = {
    开膛者的魔影: ['传谣人', '杀人狂'],
    流言四起: ['传谣人'],
    最黑暗的剧本: ['传谣人', '亲友'],
  };
  const worlds: { y: string; x: string; seats: string[] }[] = [];
  for (const [y, base] of Object.entries(main))
    for (const [x, extra] of Object.entries(side)) {
      for (const deity of [false, true])
        for (const student of [false, true]) {
          const active = [true, true, deity, student];
          const size = active.filter(Boolean).length;
          for (let thugs = 0; thugs <= (x === '最黑暗的剧本' ? 2 : 0); thugs++) {
            const roles = base.concat(extra, Array<string>(thugs).fill('暴徒'));
            if (roles.length > size) continue;
            roles.push(...Array<string>(size - roles.length).fill('平民'));
            function place(seats: string[], remaining: string[]) {
              if (seats.length === 4) {
                worlds.push({ y, x, seats });
                return;
              }
              if (!active[seats.length]) {
                place([...seats, '未配置'], remaining);
                return;
              }
              for (const role of new Set(remaining)) {
                const next = remaining.slice();
                next.splice(next.indexOf(role), 1);
                place([...seats, role], next);
              }
            }
            place([], roles);
          }
        }
    }
  const s = new SolutionSpace3(v),
    m = s.model;
  const phases = ['loop-start', 'day-start', 'mastermind-cards'] as const;
  for (let prefix = 0; prefix <= 3; prefix++) {
    if (prefix) s.append([event(prefix, 'boundary', {}, phases[prefix - 1]!)]);
    const live = worlds.filter(
      (w) => (prefix < 2 || w.seats[2] === '未配置') && (prefix < 3 || w.seats[3] === '未配置'),
    );
    const check = (atom: number, accepted: number, text: string) =>
      assert.equal(
        m.graph.truth(atom),
        accepted === 0 ? false : accepted === live.length ? true : undefined,
        '前缀 ' + prefix + ' ' + text,
      );
    for (const [i, name] of ['男学生', '女学生', '神灵', '转校生'].entries()) {
      for (const [role, atom] of Object.entries(m.ids.get(name)!))
        check(atom, live.filter((w) => w.seats[i] === role).length, name + ' ' + role);
    }
    for (const [name, atom] of Object.entries(m.plots))
      check(atom, live.filter((w) => w.x === name || w.y === name).length, name);
  }
});
test('HSA 群众门槛同时读取版图密谋和角色尸体', () => {
  const v = opening('HSA');
  v.incidents = [{ day: 1, name: '污秽溢出' }];
  v.boards.city = 1;
  v.characters[2]!.status = 'dead';
  const s = new SolutionSpace3(v);
  s.append([event(1, 'incident', { day: 1, name: '污秽溢出', occurred: true })]);
  assert(!s.conflict);
  assert.equal(s.model.graph.mark(s.model.culprits.get(1)!.city!), '√');
});
test('HSA 轮回开始诅咒是任意能力，两个不同牌号要求两个来源，相同牌号只计算一次', () => {
  const v = opening('HSA');
  v.incidents = [];
  const s = new SolutionSpace3(v),
    m = s.model,
    g = m.graph;
  const ghost = m.plots['被诅咒的土地']!,
    witch = m.plots['魔女遗咒']!;
  const c1 = { id: 'curse-1', target: 'school' },
    c2 = { id: 'curse-2', target: 'city' };
  s.append([event(1, 'boundary', {}, 'loop-start')]);
  assert.equal(g.mark(ghost), '');
  s.append([event(2, 'board', { curses: [c1] }, 'loop-start')]);
  assert.equal(g.mark(ghost), '？');
  assert.equal(g.mark(witch), '？');
  s.append([event(3, 'board', { curses: [c1] }, 'loop-start')]);
  assert.equal(g.work.sources.length, 0);
  s.append([event(4, 'board', { curses: [c1, c2] }, 'loop-start')]);
  assert(!s.conflict);
  assert.equal(g.mark(ghost), '√');
  assert.equal(g.mark(witch), '√');
  s.append([
    event(5, 'board', { curses: [c1, c2, { id: 'curse-3', target: 'city' }] }, 'loop-start'),
  ]);
  assert.match(s.conflict!, /#5/);
  const absent = new SolutionSpace3(v);
  absent.append([event(1, 'boundary', {}, 'loop-start'), event(2, 'boundary', {}, 'day-start')]);
  assert.equal(absent.model.graph.mark(absent.model.plots['魔女遗咒']!), '');
});
test('MC 低于不安限度的发生可以由同区侦探解释，EX 改变后保留强迫症', () => {
  const v = opening('MC');
  v.ex = 1;
  v.incidents = [{ day: 1, name: '连续杀人' }];
  const s = new SolutionSpace3(v);
  s.append([
    event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
    event(2, 'incident', { day: 1, name: '连续杀人', occurred: true }),
  ]);
  assert(!s.conflict);
  assert.equal(s.model.graph.mark(s.model.ids.get('男学生')!['强迫症']!), '√');
  v.ex = 0;
  const t = new SolutionSpace3(v);
  t.append([
    event(1, 'culprit', { day: 1, culprit: 'c0' }),
    event(2, 'incident', { day: 1, name: '连续杀人', occurred: true }),
  ]);
  assert(!t.conflict);
  assert.notEqual(t.model.graph.mark(t.model.ids.get('男学生')!['强迫症']!), '√');
});
test('闭合自杀与死者绑定同一当事人，尚未闭合时保留另一候选', () => {
  const v = opening();
  for (const c of v.characters.slice(0, 2)) c.counters.paranoia = 5;
  const s = new SolutionSpace3(v),
    g = s.model.graph,
    cu = s.model.culprits.get(1)!;
  s.append([
    event(1, 'boundary', {}, 'incident'),
    event(2, 'incident', { day: 1, name: '自杀', occurred: true }),
    event(3, 'character', { character: 'c0', area: 'school', status: 'dead', counters }),
  ]);
  assert.equal(g.mark(cu['女学生']!), '？');
  s.append([event(4, 'boundary', {}, 'captain-change')]);
  assert.equal(g.mark(cu['男学生']!), '√');
  assert(!s.conflict);
});
test('BTX 自杀先判断不死，再逐次消费护卫；教主第二次执行仍使用前一步的结果', () => {
  for (const [actor, guard, spent, died, expected] of [
    ['男学生', 0, 0, false, '√'],
    ['男学生', 0, 0, true, '×'],
    ['男学生', 1, 0, false, '√'],
    ['男学生', 1, 1, false, '×'],
    ['教主', 1, 1, true, '×'],
    ['教主', 1, 1, false, '矛盾'],
  ] as const) {
    const v = opening('BTX');
    v.characters[0]!.character = actor;
    v.characters[0]!.counters = { ...counters, paranoia: 6, guard };
    const s = new SolutionSpace3(v),
      a = s.model.ids.get(actor)!['时间旅者']!;
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'boundary', {}, 'incident'),
      event(3, 'incident', { day: 1, name: '自杀', occurred: true }),
    ]);
    if (died || spent)
      s.append([
        event(4, 'character', {
          character: 'c0',
          area: 'school',
          status: died ? 'dead' : 'alive',
          counters: { ...counters, paranoia: 6, guard: guard - spent },
        }),
      ]);
    assert.equal(s.model.graph.truth(a), undefined);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    if (expected === '矛盾') assert(s.conflict);
    else {
      assert(!s.conflict);
      assert.equal(s.model.graph.mark(a), expected);
    }
  }
});
test('闭合禁止友好结算对出现和缺失分别判断，其他阶段无单格变化', () => {
  for (const delta of [0, 1]) {
    const v = opening('BTX'),
      s = new SolutionSpace3(v),
      m = s.model;
    const role = m.ids.get('男学生')!['时间旅者']!;
    s.append([
      event(1, 'boundary', {}, 'mastermind-cards'),
      event(2, 'boundary', {}, 'protagonist-cards'),
      event(3, 'boundary', {}, 'card-resolution'),
      event(
        4,
        'cards',
        {
          placements: [
            { owner: 'mastermind', target: 'c0', kind: 'block-goodwill' },
            { owner: 'p0', target: 'c0', kind: 'goodwill+1' },
          ],
        },
        'card-resolution',
      ),
    ]);
    assert.equal(m.graph.mark(role), '');
    if (delta)
      s.append([
        event(
          5,
          'character',
          {
            character: 'c0',
            area: 'school',
            status: 'alive',
            counters: { ...counters, goodwill: 1 },
          },
          'card-resolution',
        ),
      ]);
    s.append([event(5 + delta, 'boundary', {}, 'mastermind-abilities')]);
    assert(!s.conflict);
    assert.equal(m.graph.mark(role), delta ? '√' : '×');
  }
});
test('已知无强制结果的阶段按每个边界推进，闭合记录不凭空产生证据', () => {
  const phases: Observation['phase'][] = [
    'briefing',
    'discussion',
    'loop-start',
    'day-start',
    'mastermind-cards',
    'protagonist-cards',
    'card-resolution',
    'mastermind-abilities',
    'protagonist-abilities',
    'incident',
    'captain-change',
    'day-end',
    'loop-end',
    'finished',
  ];
  const v = opening();
  v.characters.forEach((c) => (c.area = 'city'));
  v.incidents = [];
  const s = new SolutionSpace3(v);
  for (const [i, phase] of phases.entries()) {
    s.append([event(i + 1, 'boundary', {}, phase)]);
    assert.equal(s.through, i + 1);
    assert(!s.conflict, phase);
    assert.equal(s.model.graph.mark(s.model.ids.get('男学生')!['传谣人']!), '');
  }
});

test('两步不安扩散在同一解释中选择不同目标，完整公告才排除错误组合', () => {
  for (const second of ['c0', 'c1']) {
    const v = opening();
    v.incidents = [{ day: 1, name: '不安扩散' }];
    v.characters[0]!.counters.paranoia = 4;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, 'incident'),
      event(2, 'incident', { day: 1, name: '不安扩散', occurred: true }),
      event(3, 'character', {
        character: 'c0',
        area: 'school',
        status: 'alive',
        counters: { ...counters, paranoia: 6 },
      }),
      event(4, 'character', {
        character: second,
        area: 'school',
        status: 'alive',
        counters: { ...counters, paranoia: second === 'c0' ? 6 : 0, intrigue: 1 },
      }),
    ]);
    assert(!s.conflict);
    s.append([event(5, 'boundary', {}, 'captain-change')]);
    assert.equal(!!s.conflict, second === 'c0');
  }
});
test('未登场当事人的编号绑定在首次登场后传播，前缀重算一致', () => {
  const v = opening(),
    roster = [{ id: 'late', character: '转校生' }];
  const h = [
    event(1, 'culprit', { day: 1, culprit: 'late' }, 'protagonist-abilities'),
    event(
      2,
      'character',
      { character: 'late', area: 'school', status: 'alive', counters },
      'day-start',
      2,
    ),
  ];
  const s = new SolutionSpace3(v);
  s.append([h[0]!]);
  assert(!s.seen.has('转校生'));
  s.append([h[1]!], roster);
  const fresh = new SolutionSpace3(v);
  fresh.append(h, roster);
  assert.deepEqual(marks(s), marks(fresh));
  assert.deepEqual(s.model.graph.rules, fresh.model.graph.rules);
  assert.equal(s.model.graph.mark(s.model.culprits.get(1)!['转校生']!), '√');
});
test('重复的剧作家版图密谋绑定同一轮流言使用，不能拼接两个一次来源', () => {
  const v = opening(),
    s = new SolutionSpace3(v),
    m = s.model;
  s.append([event(1, 'board', { board: 'hospital', intrigue: 1 }, 'mastermind-abilities')]);
  assert.equal(m.graph.truth(m.plots['流言四起']!), true);
  s.append([event(2, 'board', { board: 'hospital', intrigue: 2 }, 'mastermind-abilities', 2)]);
  assert.match(s.conflict!, /#2/);
});
test('MC 完整轮回缺失失败可排除黑暗学园，未闭合与已提前失败均保留', () => {
  for (const early of [false, true]) {
    const v = opening('MC');
    v.ex = 0;
    const s = new SolutionSpace3(v),
      m = s.model;
    const h = early ? [event(1, 'failure', { result: 'protagonist-failure' }, 'incident')] : [];
    h.push(event(h.length + 1, 'boundary', {}, 'loop-end'));
    s.append(h);
    assert.equal(m.graph.truth(m.plots['黑暗学园']!), undefined);
    s.append([event(h.length + 1, 'boundary', {}, 'finished')]);
    assert.equal(m.graph.truth(m.plots['黑暗学园']!), early ? undefined : false);
  }
});
test('友好声明的必定拒绝与可选拒绝分离到窗口闭合', () => {
  const v = opening('BTX'),
    s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'boundary', {}, 'protagonist-abilities'),
    event(
      2,
      'declaration',
      { character: 'c0', ability: 'student-counter' },
      'protagonist-abilities',
    ),
  ]);
  assert.equal(m.graph.mark(m.ids.get('男学生')!['邪教徒']!), '');
  s.append([event(3, 'boundary', {}, 'incident')]);
  assert.equal(m.graph.mark(m.ids.get('男学生')!['邪教徒']!), '×');
  assert.equal(m.graph.mark(m.ids.get('男学生')!['主谋']!), '');
});
test('LL 私人 EX 牌与公开单独胜利同时绑定，并校验标志门槛', () => {
  for (const count of [4, 5]) {
    const v = opening('LL');
    v.incidents = [{ day: 1, name: '谋杀' }];
    const s = new SolutionSpace3(v),
      m = s.model;
    const h = [event(1, 'boundary', {}, 'day-end')];
    for (let i = 0; i < count; i++)
      h.push(event(h.length + 1, 'board', { diedMarker: 'c' + i }, 'day-end'));
    h.push(
      event(h.length + 1, 'boundary', {}, 'finished'),
      event(h.length + 2, 'victory', { winner: 'p1' }, 'finished'),
    );
    s.append(h);
    if (count === 5) {
      assert(!s.conflict);
      assert.equal(m.graph.mark(m.plots['真正的怪物']!), '√');
      assert.equal(m.graph.mark(m.seats.get('p1')!.A!), '√');
    } else assert.match(s.conflict!, /标志数量不足/);
  }
});
test('MZ 活着的忍者可宣称另一配置身份，死亡时读取实际身份', () => {
  const v = opening('MZ');
  v.characters[3]!.counters.paranoia = 5;
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([event(1, 'identity', { character: 'c3', identity: '亲友' }, 'protagonist-abilities')]);
  assert.equal(m.graph.mark(m.ids.get('职员')!['忍者']!), '？');
  assert.equal(m.graph.mark(m.ids.get('职员')!['亲友']!), '？');
  s.append([
    event(2, 'incident', { day: 1, name: '自杀', occurred: true }),
    event(
      3,
      'character',
      { character: 'c3', area: 'city', status: 'dead', counters: v.characters[3]!.counters },
      'incident',
    ),
    event(4, 'identity', { character: 'c3', identity: '亲友' }, 'loop-end'),
  ]);
  assert(!s.conflict);
  assert.equal(m.graph.mark(m.ids.get('职员')!['亲友']!), '√');
});

test('巫女与医生的声明分别读取版图上限、方向和目标实际指示物', () => {
  for (const [ability, hasEffect, send, valid] of [
    ['shrine-maiden-remove', true, true, true],
    ['shrine-maiden-remove', true, false, false],
    ['shrine-maiden-remove', false, false, true],
    ['doctor-counter', true, true, true],
    ['doctor-counter', true, false, false],
    ['doctor-counter', false, false, true],
  ] as const) {
    const v = opening();
    v.boards.shrine = hasEffect ? 1 : 0;
    Object.assign(v.characters[0]!, {
      character: ability === 'doctor-counter' ? '医生' : '巫女',
      area: ability === 'doctor-counter' ? 'school' : 'shrine',
    });
    if (ability === 'shrine-maiden-remove') v.characters[2]!.character = '大小姐';
    v.characters[0]!.counters.goodwill = 4;
    v.characters[1]!.counters.paranoia = hasEffect ? 1 : 0;
    const s = new SolutionSpace3(v),
      phase = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, phase),
      event(
        2,
        'declaration',
        { character: 'c0', ability, choices: { target: 'c1', direction: 'remove' } },
        phase,
      ),
    ]);
    if (send)
      s.append([
        ability === 'doctor-counter'
          ? event(
              3,
              'character',
              { character: 'c1', area: 'school', status: 'alive', counters },
              phase,
            )
          : event(3, 'board', { board: 'shrine', intrigue: 0 }, phase),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, valid);
  }
});
test('模仿犯的声明以同身份名单履行，明示目标与空名单也可区分', () => {
  const v = opening();
  v.characters[0]!.character = '模仿犯';
  v.characters[0]!.counters.goodwill = 3;
  const phase = 'protagonist-abilities';
  for (const received of [false, true]) {
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, phase, 1, 2),
      event(2, 'declaration', { character: 'c0', ability: 'copycat-reveal' }, phase, 1, 2),
    ]);
    if (received)
      s.append([event(3, 'identity', { sameIdentityAs: 'c0', characters: ['c1'] }, phase, 1, 2)]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident', 1, 2)]);
    assert.equal(!s.conflict, received);
  }
});
test('FS 邪教徒必定拒绝普通友好，收到希望后仍可接受', () => {
  for (const hope of [0, 1]) {
    const v = opening();
    v.characters[0]!.counters.goodwill = 3;
    v.characters[0]!.counters.hope = hope;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'c0', identity: '邪教徒' }, 'protagonist-abilities'),
      event(2, 'boundary', {}, 'protagonist-abilities'),
      event(
        3,
        'declaration',
        { character: 'c0', ability: 'student', choices: { target: 'c1' } },
        'protagonist-abilities',
      ),
    ]);
    assert(!s.conflict);
    s.append([event(4, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, Boolean(hope));
  }
});
test('刑警选择此前日期，缺失、正确日期与其他日期的公开结果分别核对', () => {
  for (const disclosed of [1, 2, undefined]) {
    const v = opening();
    v.incidents = [
      { day: 1, name: '自杀' },
      { day: 2, name: '谋杀' },
    ];
    v.characters[4]!.counters.goodwill = 4;
    const s = new SolutionSpace3(v),
      phase = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, phase, 3),
      event(
        2,
        'declaration',
        { character: 'c4', ability: 'detective-incident', choices: { day: '1' } },
        phase,
        3,
      ),
    ]);
    if (disclosed) s.append([event(3, 'culprit', { day: disclosed, culprit: 'c2' }, phase, 3)]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident', 3)]);
    assert.equal(!s.conflict, disclosed === 1);
  }
});
test('FS 已挡下的强制死亡请求不能在下一结算批重复使用', () => {
  const v = opening();
  v.characters[1]!.counters.guard = 1;
  const s = new SolutionSpace3(v);
  s.append([
    event(1, 'identity', { character: 'c0', identity: '杀人狂' }, 'protagonist-abilities'),
    event(2, 'boundary', {}, 'day-end'),
  ]);
  const hit = (seq: number, died: boolean) => ({
    ...event(
      seq,
      'character',
      { character: 'c1', area: 'school', status: died ? 'dead' : 'alive', counters },
      'day-end',
    ),
    simultaneousSize: 1,
  });
  s.append([hit(3, false)]);
  assert(!s.conflict);
  s.append([hit(4, true)]);
  assert.match(s.conflict!, /#4/);
});
test('FS 两个杀人狂同时互杀，分段送达与完整批次保留相同解释', () => {
  const v = opening();
  v.characters[1]!.character = '模仿犯';
  const pre = [
    event(1, 'identity', { character: 'c0', identity: '杀人狂' }, 'protagonist-abilities'),
    event(2, 'identity', { character: 'c1', identity: '杀人狂' }, 'protagonist-abilities'),
    event(3, 'boundary', {}, 'day-end'),
  ];
  const deaths = [0, 1].map((i) => ({
    ...event(
      4 + i,
      'character',
      { character: 'c' + i, area: 'school', status: 'dead', counters },
      'day-end',
    ),
    simultaneousGroup: 4,
    simultaneousSize: 2,
  }));
  const full = new SolutionSpace3(v),
    split = new SolutionSpace3(v);
  full.append([...pre, ...deaths]);
  split.append([...pre, deaths[0]!]);
  assert.equal(split.through, 3);
  split.append([deaths[1]!]);
  assert(!full.conflict);
  assert(!split.conflict);
  assert.deepEqual(marks(split), marks(full));
  assert.deepEqual(split.model.graph.rules, full.model.graph.rules);
});
test('FS 周年无平民时可以不转换；有一名原平民时必须指定且平民答案正确', () => {
  for (const size of [2, 3]) {
    const v = opening();
    v.anniversary = true;
    v.loops = v.days = 1;
    v.incidents = [];
    v.characters = v.characters.slice(0, size);
    const s = new SolutionSpace3(v),
      m = s.model;
    s.append([
      event(1, 'rule', { rule: '复仇的火种' }, 'discussion'),
      event(2, 'rule', { rule: '流言四起' }, 'discussion'),
      event(3, 'boundary', {}, 'loop-start'),
      event(4, 'boundary', {}, 'day-start'),
      event(5, 'boundary', {}, 'mastermind-cards'),
      event(6, 'identity', { character: 'c0', identity: '主谋' }, 'protagonist-abilities'),
      event(7, 'identity', { character: 'c1', identity: '传谣人' }, 'protagonist-abilities'),
    ]);
    assert(!s.conflict);
    if (size === 3) {
      assert.equal(m.graph.mark(m.ids.get('巫女')!['因果残片']!), '√');
      s.append([
        event(8, 'identity', { character: 'c2', guess: '平民', correct: true }, 'final-guess'),
      ]);
      assert(!s.conflict);
    } else for (const a of m.fragments.values()) assert.equal(m.graph.mark(a), '×');
  }
});
test('周年 FAQ 83、84：模仿犯先复制平民，仅自己被指定时才取得周年追加的因果残片', () => {
  for (const [first, second] of [
    ['c0', 'c1'],
    ['c1', 'c0'],
  ] as const) {
    const v = opening();
    v.anniversary = true;
    v.characters[0]!.character = '模仿犯';
    v.characters[2]!.character = '局外人';
    const s = new SolutionSpace3(v),
      m = s.model;
    const designated = first === 'c0' ? '模仿犯' : '女学生';
    const other = first === 'c0' ? '女学生' : '模仿犯';
    assert.equal(m.graph.mark(m.ids.get('局外人')!['因果残片']!), '×');
    s.append([
      event(1, 'identity', { character: first, identity: '因果残片' }, 'protagonist-abilities'),
    ]);
    assert(!s.conflict, s.conflict);
    assert.equal(m.graph.truth(m.fragments.get(designated)!), true);
    assert.equal(m.graph.mark(m.ids.get(other)!['因果残片']!), '×');
    assert.notEqual(m.graph.mark(m.ids.get(other)!['平民']!), '×');
    s.append([
      event(2, 'identity', { character: second, identity: '因果残片' }, 'protagonist-abilities'),
    ]);
    assert.match(s.conflict!, /#2/);
  }
});
test('HSA 言灵诅咒按新增牌号绑定当事人，重复快照与黑猫无现象均合法', () => {
  for (const added of [false, true]) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '言灵诅咒' }];
    v.characters[0]!.character = '黑猫';
    v.characters.forEach((p) => (p.counters.paranoia = 6));
    const s = new SolutionSpace3(v),
      day = s.model.culprits.get(1)!;
    s.append([
      event(1, 'board', { curses: [{ id: 'old', target: 'school' }] }),
      event(2, 'incident', { day: 1, name: '言灵诅咒', occurred: true }),
    ]);
    if (added) {
      const cards = [
        { id: 'old', target: 'school' },
        { id: 'new', target: 'c2' },
      ];
      s.append([event(3, 'board', { curses: cards }), event(4, 'board', { curses: cards })]);
    }
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert(!s.conflict);
    assert.equal(s.model.graph.truth(day['黑猫']!), !added);
    assert.equal(s.model.graph.truth(day['巫女']!), added);
  }
});
test('HSA 孤守允许巫女尝试禁区后留下，从者必须跟随同区大小姐所选的去向', () => {
  for (const destination of ['shrine', 'city']) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '孤守' }];
    v.characters[1]!.character = '大小姐';
    v.characters[2]!.area = 'school';
    v.characters[3]!.area = 'school';
    v.characters[3]!.character = '从者';
    v.characters[0]!.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '孤守', occurred: true }),
      event(3, 'character', { character: 'c1', area: 'shrine', status: 'alive', counters }),
      event(4, 'character', { character: 'c3', area: destination, status: 'alive', counters }),
    ]);
    assert(!s.conflict);
    s.append([event(5, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, destination === 'shrine');
  }
});
test('重复及相反命题按同一布尔值计数，局部数量可达性与枚举逐格相等', () => {
  for (const weights of [
    [2, 2],
    [3, -2, 1],
    [2, -3, 2],
    [-2, 2, 1],
  ]) {
    for (let n = 0; n <= weights.reduce((x, y) => x + Math.abs(y), 0); n++) {
      const g = new Relations(),
        atoms = weights.map((_, i) => g.atom('量' + i)),
        guard = g.atom('采用');
      const terms = weights.flatMap((w, i) =>
        w < 0
          ? [...Array<number>(-w + 1).fill(-atoms[i]!), atoms[i]!]
          : Array<number>(w).fill(atoms[i]!),
      );
      g.add('同一命题重复出现', terms, n, n, guard);
      g.propagate();
      const accepted = Array.from({ length: 2 ** atoms.length }, (_, i) => i).filter(
        (i) =>
          terms.filter((t) => Boolean(i & (1 << atoms.indexOf(Math.abs(t)))) === t > 0).length ===
          n,
      );
      assert.equal(g.truth(guard) === false, !accepted.length);
      if (!accepted.length) continue;
      g.add('公开采用', [guard], 1);
      g.propagate();
      assert.equal(g.conflict, undefined);
      atoms.forEach((a, k) => {
        const bits = new Set(accepted.map((i) => Boolean(i & (1 << k))));
        assert.equal(g.truth(a), bits.size === 1 ? [...bits][0] : undefined);
      });
    }
  }
});
test('妹妹调用成人友好时不能拒绝，调用结束后的独立声明恢复正常规则', () => {
  for (const independent of [false, true]) {
    const v = opening();
    Object.assign(v.characters[0]!, { character: '妹妹' });
    Object.assign(v.characters[1]!, { character: '医生' });
    v.characters[0]!.counters.goodwill = 5;
    const s = new SolutionSpace3(v),
      phase = 'protagonist-abilities';
    const child = {
      character: 'c1',
      ability: 'doctor-counter',
      choices: { target: 'c0', direction: 'remove' },
    };
    s.append([
      event(1, 'identity', { character: 'c1', identity: '邪教徒' }, phase),
      event(2, 'boundary', {}, phase),
      event(
        3,
        'declaration',
        {
          character: 'c0',
          ability: 'little-sister',
          choices: { target: 'c1', ability: 'doctor-counter' },
        },
        phase,
      ),
      event(4, 'declaration', child, phase),
    ]);
    if (independent)
      s.append([
        event(5, 'boundary', {}, 'incident'),
        event(6, 'boundary', {}, phase, 2),
        event(
          7,
          'own-choice',
          { choice: { kind: 'ability', owner: 'c1', ability: 'doctor-counter' } },
          phase,
          2,
        ),
        event(8, 'declaration', child, phase, 2),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident', independent ? 2 : 1)]);
    assert.equal(!s.conflict, !independent);
  }
});
test('HSA 鉴别员公开牺牲者的有效身份约束古墓活尸；异界人复活牺牲者须移除一枚版图密谋', () => {
  for (const identity of ['丧尸', '平民']) {
    const v = opening('HSA');
    v.incidents = [];
    v.boards.city = 2;
    v.characters[4]!.character = '鉴别员';
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'victim:city:1', identity }, 'protagonist-abilities'),
    ]);
    assert(!s.conflict);
    assert.equal(s.model.graph.truth(s.model.plots['古墓活尸']!), identity === '丧尸');
  }
  for (const removed of [false, true]) {
    const v = opening('HSA');
    v.incidents = [];
    v.boards.city = 1;
    v.characters[4]!.character = '异界人';
    v.characters[4]!.counters.goodwill = 5;
    const s = new SolutionSpace3(v),
      phase = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, phase),
      event(
        2,
        'declaration',
        { character: 'c4', ability: 'alien-revive', choices: { target: 'victim:city:0' } },
        phase,
      ),
    ]);
    if (removed) s.append([event(3, 'board', { board: 'city', intrigue: 0 }, phase)]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, removed);
  }
});
test('已送齐的自杀死亡批次可立即绑定当事人，分段送达不能提前约束', () => {
  const v = opening();
  v.characters[0]!.counters.paranoia = v.characters[1]!.counters.paranoia = 5;
  const s = new SolutionSpace3(v),
    row = s.model.culprits.get(1)!;
  s.append([event(1, 'incident', { day: 1, name: '自杀', occurred: true })]);
  const first = {
    ...event(2, 'character', {
      character: 'c0',
      area: 'school',
      status: 'dead',
      counters: v.characters[0]!.counters,
    }),
    simultaneousGroup: 2,
    simultaneousSize: 2,
  };
  s.append([first]);
  assert.equal(s.through, 1);
  assert.equal(s.model.graph.truth(row['男学生']!), undefined);
  s.append([
    {
      ...event(3, 'failure', { result: 'protagonist-failure' }),
      simultaneousGroup: 2,
      simultaneousSize: 2,
    },
  ]);
  assert(!s.conflict);
  assert.equal(s.model.graph.truth(row['男学生']!), true);
});
test('HSA 死者默示录先共同处理死亡，再读版图上的尸体和牺牲者；中断保留未执行后续', () => {
  for (const [intrigue, interrupted, valid] of [
    [2, false, true],
    [3, false, false],
    [3, true, true],
  ] as const) {
    const v = opening('HSA');
    v.boards.school = intrigue;
    v.incidents = [{ day: 1, name: '死者默示录' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'school' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '死者默示录', occurred: true }),
      ...['c0', 'c1'].map((character, i) => ({
        ...event(3 + i, 'character', { character, area: 'school', status: 'dead', counters }),
        simultaneousGroup: 3,
        simultaneousSize: 2,
      })),
    ]);
    assert(!s.conflict);
    if (interrupted) s.append([event(5, 'failure', { result: 'protagonist-failure' })]);
    s.append([event(s.through + 1, 'boundary', {}, interrupted ? 'loop-end' : 'captain-change')]);
    assert.equal(!s.conflict, valid);
  }
});
test('HSA 两个不同结算批次不能复用同一梦魇的本阶段击杀', () => {
  const v = opening('HSA');
  v.incidents = [];
  v.characters.forEach((c) => (c.area = 'city'));
  const s = new SolutionSpace3(v);
  s.append([
    event(1, 'rule', { rule: '雾中夜惊梦' }, 'protagonist-abilities'),
    event(2, 'identity', { character: 'c0', identity: '梦魇' }, 'protagonist-abilities'),
    event(3, 'boundary', {}, 'day-end'),
  ]);
  const death = (seq: number, id: string) => ({
    ...event(
      seq,
      'character',
      { character: id, status: 'dead', area: 'city', counters },
      'day-end',
    ),
    simultaneousSize: 1,
  });
  s.append([death(4, 'c1')]);
  assert(!s.conflict);
  s.append([death(5, 'c2')]);
  assert.match(s.conflict!, /#5/);
});
test('HSA 黑猫替换孤守的事件文本，替换后没有强制的他人移动', () => {
  for (const moved of [false, true]) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '孤守' }];
    v.characters[0]!.character = '黑猫';
    v.characters[0]!.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '孤守', occurred: true }),
    ]);
    if (moved)
      s.append([
        event(3, 'character', { character: 'c1', area: 'city', status: 'alive', counters }),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, !moved);
  }
});
test('周年最终轮希望牌先保留超越世界线替代；公开另一条 FS 副线才投影上轮达标者', () => {
  const v = opening();
  v.anniversary = true;
  v.loops = 3;
  v.incidents = [];
  v.characters[0]!.counters.goodwill = 2;
  v.characters[1]!.counters.goodwill = 1;
  v.characters[1]!.counters.hope = 1;
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'boundary', {}, 'loop-end', 3, 2),
    event(2, 'boundary', {}, 'discussion', 1, 3),
    event(3, 'boundary', {}, 'loop-start', 1, 3),
    event(4, 'card-grant', { owner: 'p0', kind: 'hope+1' }, 'loop-start', 1, 3),
    event(5, 'boundary', {}, 'day-start', 1, 3),
  ]);
  assert(!s.conflict);
  const mark = (name: string) => m.graph.mark(m.ids.get(name)!['因果残片']!);
  assert.equal(mark('男学生'), '');
  assert.equal(mark('巫女'), '');
  s.append([event(6, 'rule', { rule: '流言四起' }, 'protagonist-abilities', 1, 3)]);
  assert(!s.conflict);
  assert.equal(mark('男学生'), '？');
  assert.equal(mark('女学生'), '？');
  assert.equal(mark('巫女'), '×');
});
test('FS 两席在不同版图，角色密谋锁定主谋；同阶段再增版图密谋须改用流言', () => {
  const v = opening();
  v.incidents = [];
  v.days = v.loops = 1;
  v.characters = v.characters.slice(0, 2);
  v.characters[1]!.area = 'city';
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
  ]);
  assert.equal(m.graph.truth(m.ids.get('男学生')!['主谋']!), undefined);
  s.append([
    event(
      4,
      'character',
      { character: 'c0', status: 'alive', area: 'school', counters: { ...counters, intrigue: 1 } },
      'mastermind-abilities',
    ),
  ]);
  assert(!s.conflict);
  assert.equal(m.graph.truth(m.ids.get('男学生')!['主谋']!), true);
  assert.equal(m.graph.truth(m.ids.get('女学生')!['传谣人']!), true);
  s.append([event(5, 'board', { board: 'school', intrigue: 1 }, 'mastermind-abilities')]);
  assert(!s.conflict);
  s.append([event(6, 'board', { board: 'school', intrigue: 2 }, 'mastermind-abilities')]);
  assert.match(s.conflict!, /#6/);
});
test('BTX 不安定因子在学校两枚密谋时可以提供传谣能力，门槛以下不能', () => {
  for (const intrigue of [1, 2]) {
    const v = opening('BTX');
    v.boards.school = intrigue;
    v.characters[1]!.area = 'city';
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'c0', identity: '不安定因子' }, 'protagonist-abilities'),
      event(
        2,
        'character',
        {
          character: 'c0',
          area: 'school',
          status: 'alive',
          counters: { ...counters, paranoia: 1 },
        },
        'mastermind-abilities',
      ),
    ]);
    assert.equal(!s.conflict, intrigue === 2);
  }
});
test('WM 黄衣之王读取本轮曾经增加的 EX；学者随后减少不会取消失败条件', () => {
  for (const failed of [false, true]) {
    const v = opening('WM');
    v.ex = 1;
    v.incidents = [
      { day: 1, name: '发现' },
      { day: 2, name: '发现' },
    ];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, 'loop-start'),
      event(2, 'rule', { rule: '黄衣之王' }, 'protagonist-abilities'),
      event(3, 'board', { ex: 2 }, 'protagonist-abilities'),
      event(4, 'board', { ex: 1 }, 'protagonist-abilities'),
      event(5, 'boundary', {}, 'loop-end'),
    ]);
    if (failed) s.append([event(6, 'failure', { result: 'protagonist-failure' }, 'loop-end')]);
    assert(!s.conflict, s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'discussion', 1, 2)]);
    assert.equal(!s.conflict, failed);
  }
});
test('WM 拒绝友好会增加 EX，未闭合时等待，闭合时检查增量', () => {
  for (const amount of [0, 1, 2]) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [];
    const s = new SolutionSpace3(v),
      phase = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, phase),
      event(2, 'declaration', { character: 'c0', ability: 'student' }, phase),
      event(3, 'refused', { character: 'c0', ability: 'student' }, phase),
    ]);
    if (amount) s.append([event(4, 'board', { ex: amount }, phase)]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, Boolean(amount));
    if (amount > 1) assert([...s.unresolved].some((t) => t.includes('拒绝以外')));
  }
});

test('鉴别员双向移动读取两名对象，两份公告只可在本次主动窗口内履行', () => {
  const phase = 'protagonist-abilities';
  for (const [left, right, reports, valid] of [
    [1, 0, 2, true],
    [0, 2, 2, true],
    [1, 0, 1, false],
    [0, 0, 0, true],
  ] as const) {
    const v = opening();
    v.characters[0]!.character = '鉴别员';
    v.characters[0]!.counters.goodwill = 2;
    v.characters[1]!.counters.guard = left;
    v.characters[2]!.area = 'school';
    v.characters[2]!.counters.guard = right;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, phase),
      event(
        2,
        'declaration',
        {
          character: 'c0',
          ability: 'forensic-transfer',
          choices: { from: 'c1', to: 'c2', counter: 'guard' },
        },
        phase,
      ),
    ]);
    const by = left > 0 ? 1 : -1;
    for (let i = 1; i <= reports; i++)
      s.append([
        event(
          2 + i,
          'character',
          {
            character: 'c' + i,
            status: 'alive',
            area: 'school',
            counters: { ...counters, guard: i === 1 ? left - by : right + by },
          },
          phase,
        ),
      ]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'own-choice', { choice: { kind: 'pass' } }, phase)]);
    assert.equal(!s.conflict, valid);
  }
});

test('MZ 仙人发动阴谋活动可在实际及顺时针版图执行连续杀人，不能在第三块版图执行', () => {
  for (const [area, legal] of [
    ['shrine', true],
    ['school', true],
    ['city', false],
  ] as const) {
    const v = opening('MZ');
    Object.assign(v.characters[0]!, { character: '仙人', area: 'shrine' });
    v.characters[0]!.counters.intrigue = 5;
    v.characters[1]!.area = area;
    v.incidents = [{ day: 1, name: '阴谋活动' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '阴谋活动', occurred: true }),
      event(3, 'character', { character: 'c1', area, status: 'dead', counters }),
    ]);
    assert(!s.conflict);
    s.append([event(4, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, legal);
  }
});

test('HSA 邪气污染读取神社上限，区分教主、黑猫、普通当事人与未闭合窗口', () => {
  for (const [actor, before, after, valid] of [
    ['男学生', 0, 2, true],
    ['男学生', 0, 1, false],
    ['教主', 0, 3, true],
    ['教主', 0, 2, false],
    ['男学生', 2, 3, true],
    ['男学生', 3, 3, true],
    ['黑猫', 0, 0, true],
    ['黑猫', 0, 1, false],
  ] as const) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '邪气污染' }];
    v.boards.shrine = before;
    v.characters[0]!.character = actor;
    v.characters[0]!.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '邪气污染', occurred: true }),
    ]);
    if (before !== after) s.append([event(3, 'board', { board: 'shrine', intrigue: after })]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, valid, actor + ' ' + before + '→' + after);
  }
});

test('大人物与 UP 主分别读取领地与有 EX 的角色位置，同一区域替代不会移走实际卡', () => {
  for (const actor of ['大人物', 'UP主'])
    for (const legal of [true, false]) {
      const v = opening();
      v.characters[0]!.character = actor;
      v.characters[0]!.area = 'school';
      v.characters[1]!.area = 'shrine';
      for (const c of v.characters.slice(2)) c.area = 'city';
      const s = new SolutionSpace3(v);
      s.append([
        event(1, 'identity', { character: 'c0', identity: '杀人狂' }, 'mastermind-abilities'),
        event(
          2,
          'board',
          actor === '大人物'
            ? { territory: legal ? 'shrine' : 'hospital' }
            : { attachment: 'streamer-target', target: legal ? 'c1' : 'c2' },
          'mastermind-abilities',
        ),
        event(3, 'boundary', {}, 'day-end'),
        {
          ...event(
            4,
            'character',
            { character: 'c1', status: 'dead', area: 'shrine', counters },
            'day-end',
          ),
          simultaneousSize: 1,
        },
      ]);
      assert.equal(!s.conflict, legal, actor + ' ' + legal);
      assert.equal(s.board.get(actor)?.area, 'school');
    }
});

test('WM 巫师友好完成需公告身份，拒绝不占次数，重复已完成的能力在首次新声明处冲突', () => {
  const phase = 'protagonist-abilities';
  for (const [announce, repeat] of [
    [true, false],
    [false, false],
    [true, true],
  ] as const) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [];
    v.characters[0]!.counters.goodwill = 2;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'c0', identity: '巫师' }, phase),
      event(2, 'boundary', {}, phase),
      event(
        3,
        'declaration',
        { character: 'c0', ability: 'student', choices: { target: 'c1' } },
        phase,
      ),
    ]);
    if (announce) s.append([event(4, 'identity', { character: 'c0', identity: '巫师' }, phase)]);
    assert(!s.conflict);
    s.append([
      event(s.through + 1, 'own-choice', { choice: { kind: repeat ? 'ability' : 'pass' } }, phase),
    ]);
    assert.equal(!s.conflict, announce);
    if (repeat) {
      s.append([
        event(
          s.through + 1,
          'declaration',
          { character: 'c0', ability: 'student', choices: { target: 'c1' } },
          phase,
        ),
      ]);
      assert.match(s.conflict!, /次数耗尽/);
    }
  }
  const v = opening();
  v.characters[0]!.counters.goodwill = 2;
  const s = new SolutionSpace3(v);
  const request = { character: 'c0', ability: 'student', choices: { target: 'c1' } };
  s.append([
    event(1, 'boundary', {}, phase),
    event(2, 'declaration', request, phase),
    event(3, 'refused', request, phase),
    event(4, 'own-choice', { choice: { kind: 'ability' } }, phase),
    event(5, 'declaration', request, phase),
    event(6, 'refused', request, phase),
    event(7, 'boundary', {}, 'incident'),
  ]);
  assert(!s.conflict);
});

test('仙人的剧本 X 在跨轮事件中保持同一非负整数，无需枚举或预设上限', () => {
  for (const [second, occurred, valid] of [
    [1, true, true],
    [4, false, false],
    [0, false, true],
  ] as const) {
    const v = opening();
    v.characters[0]!.character = '仙人';
    v.characters[0]!.counters.paranoia = 1;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '自杀', occurred: true }),
      event(
        3,
        'character',
        {
          character: 'c0',
          status: 'alive',
          area: 'shrine',
          counters: { ...counters, paranoia: second },
        },
        'day-start',
        1,
        2,
      ),
      event(4, 'incident', { day: 1, name: '自杀', occurred }, 'incident', 1, 2),
    ]);
    assert.equal(!s.conflict, valid);
    assert.equal(s.model.graph.work.configurations, 0);
  }
});

test('仙人复活的实际友好增量绑定制作 X，与同局早先发生门槛共用关系', () => {
  for (const [gain, valid] of [
    [0, true],
    [1, true],
    [2, false],
  ] as const) {
    const v = opening();
    v.characters[0]!.character = '仙人';
    v.characters[0]!.counters = { ...counters, goodwill: 5, paranoia: 1 };
    v.characters[1]!.status = 'dead';
    const s = new SolutionSpace3(v);
    const phase = 'protagonist-abilities';
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, phase),
      event(2, 'incident', { day: 1, name: '自杀', occurred: true }),
      event(3, 'boundary', {}, phase, 1, 2),
      event(
        4,
        'declaration',
        { character: 'c0', ability: 'immortal-revive', choices: { area: 'school', target: 'c1' } },
        phase,
        1,
        2,
      ),
    ]);
    assert(!s.conflict);
    s.append([
      {
        ...event(
          5,
          'character',
          {
            character: 'c1',
            area: 'school',
            status: 'alive',
            counters: { ...counters, goodwill: gain },
          },
          phase,
          1,
          2,
        ),
        simultaneousSize: 1,
      },
    ]);
    assert.equal(!s.conflict, valid);
  }
});

test('限定集合至少两项时一项确定仍投影问号；互补项本身已满足下限时保持空白', () => {
  const g = new Relations();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n) => g.atom(n)) as [
    number,
    number,
    number,
    number,
  ];
  g.add('公开证据指向至少两项', [a, b, c], 2, 3, undefined, true);
  g.add('已证实第一项', [a], 1);
  g.add('互补项必有其一', [b, -b, d], 1, 3, undefined, true);
  g.propagate();
  assert.deepEqual(
    [a, b, c, d].map((x) => g.mark(x)),
    ['√', '？', '？', ''],
  );
  assert.deepEqual(g.reasons(d), []);
  g.add('已证实第二项', [b], 1);
  g.propagate();
  assert.equal(g.mark(c), '');
});

test('MC 猎奇杀人先结算死亡，后结算不安扩散，愚者只在整项完成后清除不安', () => {
  for (const mode of ['完成', '错序', '同一目标', '缺少清除', '提前结束'] as const) {
    const v = opening('MC');
    v.ex = 0;
    v.incidents = [{ day: 1, name: '猎奇杀人' }];
    v.characters[0]!.counters.paranoia = 6;
    const s = new SolutionSpace3(v);
    const history = [
      event(1, 'identity', { character: 'c0', identity: '愚者' }, 'protagonist-abilities'),
      event(2, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(3, 'incident', { day: 1, name: '猎奇杀人', occurred: true }),
      event(4, 'board', { ex: 2 }),
    ];
    const add = (id: number, status: string, values: typeof counters) => {
      const seq = history.length + 1;
      history.push({
        ...event(seq, 'character', {
          character: 'c' + id,
          area: v.characters[id]!.area,
          status,
          counters: values,
        }),
        simultaneousSize: 1,
      });
    };
    if (mode === '错序') add(2, 'alive', { ...counters, paranoia: 2 });
    add(1, 'dead', counters);
    if (mode === '提前结束')
      history.push(event(history.length + 1, 'failure', { result: 'protagonist-failure' }));
    else {
      if (mode !== '错序') add(2, 'alive', { ...counters, paranoia: 2 });
      add(mode === '同一目标' ? 2 : 3, 'alive', {
        ...counters,
        intrigue: 1,
        paranoia: mode === '同一目标' ? 2 : 0,
      });
      if (mode !== '缺少清除') add(0, 'alive', counters);
    }
    s.append(history);
    assert(!s.conflict);
    s.append([
      event(
        history.length + 1,
        'boundary',
        {},
        mode === '提前结束' ? 'loop-end' : 'captain-change',
      ),
    ]);
    assert.equal(!s.conflict, mode === '完成' || mode === '提前结束', mode);
  }
});

test('从者同批直接请求与替死的完整局部真值表，与独立两卡穷举逐项相符', () => {
  for (const immune of ['无人', '大小姐', '从者']) {
    const v = opening('BTX');
    v.characters[0]!.character = '大小姐';
    v.characters[1]!.character = '从者';
    const s = new SolutionSpace3(v),
      m = s.model,
      g = m.graph;
    for (const n of ['大小姐', '从者'])
      g.add('固定小用例身份', [m.ids.get(n)![n === immune ? '时间旅者' : '平民']!], 1);
    g.propagate();
    assert.equal(g.conflict, undefined);
    for (const a of [0, 1])
      for (const b of [0, 1])
        for (const directA of [0, 1, 2])
          for (const directB of [0, 1]) {
            const expectedA = immune === '大小姐' ? 0 : Math.min(a, directA);
            const incoming = directB + (immune === '大小姐' ? 0 : Math.max(0, directA - a));
            const expectedB = immune === '从者' ? 0 : Math.min(b, incoming);
            const deadB = immune !== '从者' && incoming > b;
            const pieces = new Map([
              ['大小姐', { ...v.characters[0]!, counters: { ...counters, guard: a } }],
              ['从者', { ...v.characters[1]!, counters: { ...counters, guard: b } }],
            ]);
            for (let spentA = 0; spentA <= a; spentA++)
              for (let spentB = 0; spentB <= b; spentB++)
                for (let mask = 0; mask < 4; mask++) {
                  const reported = new Set(['大小姐', '从者'].filter((_, i) => mask & (1 << i)));
                  const signature = [immune, a, b, directA, directB, spentA, spentB, mask].join(
                    '/',
                  );
                  const match = matchDeaths(
                    m,
                    pieces,
                    new Map([
                      ['大小姐', directA],
                      ['从者', directB],
                    ]),
                    reported,
                    new Map([
                      ['大小姐', { ...counters, guard: a - spentA }],
                      ['从者', { ...counters, guard: b - spentB }],
                    ]),
                    new Set(),
                    signature,
                    undefined,
                  );
                  g.propagate();
                  assert.equal(g.conflict, undefined, signature);
                  const feasible = typeof match === 'number' ? g.truth(match) : match;
                  assert.equal(
                    feasible,
                    spentA === expectedA && spentB === expectedB && mask === (deadB ? 2 : 0),
                    signature,
                  );
                }
          }
  }
});

test('WM 发狂在日末与轮末各自读取 EX，学者降至三、军人保护和提前结束分别处理', () => {
  for (const [ex, protectedHero, report, valid] of [
    [3, false, false, true],
    [4, false, false, false],
    [4, false, true, true],
    [4, true, false, true],
  ] as const) {
    const v = opening('WM');
    v.incidents = [];
    v.ex = 4;
    v.characters[0]!.character = '军人';
    v.characters[0]!.counters.goodwill = 5;
    const s = new SolutionSpace3(v);
    const phase = 'protagonist-abilities';
    s.append([event(1, 'boundary', {}, phase)]);
    if (protectedHero)
      s.append([
        event(s.through + 1, 'declaration', { character: 'c0', ability: 'soldier-protect' }, phase),
      ]);
    s.append([
      event(s.through + 1, 'boundary', {}, 'incident'),
      event(s.through + 2, 'board', { ex }, 'incident'),
      event(s.through + 3, 'boundary', {}, 'day-end'),
    ]);
    if (report)
      s.append([event(s.through + 1, 'failure', { result: 'protagonist-death' }, 'day-end')]);
    assert(!s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'loop-end')]);
    assert.equal(!s.conflict, valid);
  }
  for (const ex of [3, 4]) {
    const v = opening('WM');
    v.incidents = [];
    v.ex = ex;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'failure', { result: 'protagonist-death' }, 'incident'),
      event(2, 'boundary', {}, 'loop-end'),
      event(3, 'boundary', {}, 'discussion', 1, 2),
    ]);
    assert.equal(!s.conflict, ex === 3);
  }
});

test('HSA 疯狂之夜只读取事件发生时的丧尸尸体数，五具与六具以及事后变化分别验证', () => {
  for (const [atOccurrence, atEnd, expected] of [
    [5, 6, true],
    [6, 5, false],
    [6, 6, false],
    [5, 5, true],
  ] as const) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '疯狂之夜' }];
    v.boards.hospital = 3;
    v.boards.city = atOccurrence - 3;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'rule', { rule: '古墓活尸' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '疯狂之夜', occurred: true }),
      event(3, 'board', { board: 'city', intrigue: atEnd - 3 }, 'captain-change'),
      event(4, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict);
    s.append([event(5, 'boundary', {}, 'day-start', 2)]);
    assert.equal(!s.conflict, expected);
  }
});
test('HSA 日末空版图诅咒能解释主人公死亡，闭合时允许剧作家放弃可选能力', () => {
  for (const [kill, stranded] of [
    [true, true],
    [false, true],
    [true, false],
  ] as const) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '诅咒活化' }];
    v.boards.hospital = 1;
    const s = new SolutionSpace3(v);
    if (stranded)
      s.append([event(1, 'board', { curses: [{ id: 'curse', target: 'hospital' }] }, 'incident')]);
    s.append([event(s.through + 1, 'boundary', {}, 'day-end')]);
    if (kill)
      s.append([event(s.through + 1, 'failure', { result: 'protagonist-death' }, 'day-end')]);
    assert.equal(!s.conflict, !kill || stranded);
    if (kill && stranded) assert.equal(s.model.graph.mark(s.model.plots['被诅咒的土地']!), '√');
    if (!kill) {
      s.append([event(s.through + 1, 'boundary', {}, 'day-start', 2)]);
      assert(!s.conflict);
      assert.notEqual(s.model.graph.mark(s.model.plots['被诅咒的土地']!), '×');
    }
  }
});

test('HSA 手下为鬼魂时轮初诅咒读取当轮刚选的初始区域，跨轮改选后不沿用旧区域', () => {
  for (const second of ['shrine', 'hospital']) {
    const v = opening('HSA');
    v.incidents = [];
    v.characters[0]!.character = '手下';
    const s = new SolutionSpace3(v);
    const phase = 'loop-start';
    s.append([
      event(1, 'rule', { rule: '恐慌与妄想' }, phase),
      event(2, 'rule', { rule: '少女大危机' }, phase),
      event(3, 'identity', { character: 'c0', identity: '鬼魂' }, phase),
      event(4, 'boundary', {}, phase),
      event(
        5,
        'character',
        { character: 'c0', status: 'alive', area: 'hospital', counters },
        phase,
      ),
      event(6, 'board', { curses: [{ id: 'one', target: 'hospital' }] }, phase),
      event(7, 'boundary', {}, 'day-start'),
      event(8, 'boundary', {}, phase, 1, 2),
      event(
        9,
        'character',
        { character: 'c0', status: 'alive', area: 'shrine', counters },
        phase,
        1,
        2,
      ),
      event(10, 'board', { curses: [{ id: 'two', target: second }] }, phase, 1, 2),
    ]);
    assert.equal(!s.conflict, second === 'shrine');
  }
});

test('WM 送葬绑定队长所选角色，未闭合时不因尚未送达的死亡公告排除', () => {
  for (const selected of ['c1', 'c2']) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [{ day: 1, name: '送葬' }];
    v.characters[0]!.counters.paranoia = 4;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '送葬', occurred: true }),
      event(3, 'own-choice', { choice: { kind: 'select', value: selected } }),
    ]);
    assert(!s.conflict);
    s.append([
      event(4, 'character', { character: 'c1', area: 'school', status: 'dead', counters }),
      event(5, 'boundary', {}, 'captain-change'),
    ]);
    assert.equal(!s.conflict, selected === 'c1', s.conflict);
  }
});

test('BTX 医院事故允许仙人在都市视为医院死亡，其他角色仍按实体区域一起结算', () => {
  for (const victim of ['c0', 'c1', '无人']) {
    const v = opening('BTX');
    v.incidents = [{ day: 1, name: '医院事故' }];
    const hermit = v.characters[0]!;
    hermit.character = '仙人';
    hermit.area = 'city';
    hermit.counters.paranoia = 5;
    v.characters[2]!.area = 'hospital';
    v.boards.hospital = 1;
    const s = new SolutionSpace3(v);
    const history = [
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '医院事故', occurred: true }),
      event(3, 'character', { character: 'c2', area: 'hospital', status: 'dead', counters }),
    ];
    if (victim !== '无人') {
      const card = v.characters.find((c) => c.id === victim)!;
      history.push(
        event(4, 'character', {
          character: victim,
          area: card.area,
          status: 'dead',
          counters: card.counters,
        }),
      );
    }
    s.append(history);
    assert(!s.conflict);
    s.append([event(history.length + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, victim !== 'c1', s.conflict);
  }
});

test('大人物未绑定领地时保留异地传谣来源，随后公示的领地重新传播旧证据', () => {
  for (const area of ['hospital', 'city']) {
    const v = opening();
    v.characters[0]!.character = '大人物';
    v.characters[1]!.area = 'hospital';
    const s = new SolutionSpace3(v);
    const phase = 'mastermind-abilities';
    s.append([
      event(1, 'identity', { character: 'c1', identity: '平民' }, phase),
      {
        ...event(
          2,
          'character',
          {
            character: 'c1',
            area: 'hospital',
            status: 'alive',
            counters: { ...counters, paranoia: 1 },
          },
          phase,
        ),
        simultaneousSize: 1,
      },
    ]);
    assert(!s.conflict);
    assert.equal(s.model.graph.mark(s.model.ids.get('大人物')!['传谣人']!), '√');
    s.append([event(3, 'board', { territory: area }, phase)]);
    assert.equal(!s.conflict, area === 'hospital', s.conflict);
  }
});

test('仙人失踪先移动实体卡，随后只在新的所在版图或其顺时针版图放置密谋', () => {
  for (const board of ['school', 'city', 'shrine', 'hospital']) {
    const v = opening('HSA');
    v.characters[0]!.character = '仙人';
    v.characters[0]!.area = 'hospital';
    v.characters[0]!.counters.paranoia = 3;
    v.incidents = [{ day: 1, name: '失踪' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '失踪', occurred: true }),
      event(3, 'character', {
        character: 'c0',
        area: 'school',
        status: 'alive',
        counters: v.characters[0]!.counters,
      }),
      event(4, 'board', { board, intrigue: 1 }),
    ]);
    assert(!s.conflict);
    s.append([event(5, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, board === 'school' || board === 'city', board);
  }
});

test('医生解除住院患者禁行后影响同日失踪，拒绝或没有使用时保留原禁行', () => {
  for (const use of ['接受', '拒绝', '未使用']) {
    const v = opening('BTX');
    v.incidents = [{ day: 1, name: '失踪' }];
    v.characters[0]!.character = '医生';
    v.characters[0]!.area = 'hospital';
    v.characters[0]!.counters.goodwill = 3;
    v.characters[1]!.character = '住院患者';
    v.characters[1]!.area = 'hospital';
    v.characters[1]!.counters.paranoia = 4;
    const s = new SolutionSpace3(v);
    const phase = 'protagonist-abilities';
    const declaration = { character: 'c0', ability: 'doctor-release', choices: {} };
    const history = [
      event(1, 'boundary', {}, phase),
      event(2, 'culprit', { day: 1, culprit: 'c1' }, phase),
    ];
    if (use !== '未使用')
      history.push(event(history.length + 1, 'declaration', declaration, phase));
    if (use === '拒绝') history.push(event(history.length + 1, 'refused', declaration, phase));
    history.push(event(history.length + 1, 'boundary', {}, 'incident'));
    history.push(event(history.length + 1, 'incident', { day: 1, name: '失踪', occurred: true }));
    history.push(
      event(history.length + 1, 'character', {
        character: 'c1',
        area: 'city',
        status: 'alive',
        counters: v.characters[1]!.counters,
      }),
    );
    history.push(event(history.length + 1, 'board', { board: 'city', intrigue: 1 }));
    s.append(history);
    assert(!s.conflict, s.conflict);
    s.append([event(history.length + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, use === '接受', use);
  }
});

test('闭合的不安扩散只尝试公开指向的两个目标，增加其他存活角色不增加局部组合', () => {
  const v = opening();
  for (const size of [2, 6]) {
    const pieces = new Map(v.characters.slice(0, size).map((c) => [c.character, c]));
    const reports = [
      { name: '女学生', before: counters, after: { ...counters, paranoia: 2 } },
      { name: '男学生', before: counters, after: { ...counters, intrigue: 1 } },
    ];
    const work = newWork();
    assert.equal(matchCounterSteps('不安扩散', '男学生', pieces, reports, work), true);
    assert.equal(work.combinations, 2);
    const invalid = [{ ...reports[0]!, name: '男学生' }, reports[1]!];
    assert.equal(matchCounterSteps('不安扩散', '男学生', pieces, invalid, newWork()), false);
  }
});

test('WM 灭绝之火按预定日跨轮记忆首次发生，重复名称的不同日期仍各有首次', () => {
  for (const nextDay of [1, 2]) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [
      { day: 1, name: '灭绝之火' },
      { day: 2, name: '灭绝之火' },
    ];
    for (const c of v.characters) c.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    const h: Observation[] = [];
    const add = (
      t: Observation['type'],
      data: Observation['data'],
      ph: Observation['phase'],
      day = 1,
      loop = 1,
    ) => h.push(event(h.length + 1, t, data, ph, day, loop));
    add('culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities');
    add('culprit', { day: 2, culprit: 'c1' }, 'protagonist-abilities');
    add('incident', { day: 1, name: '灭绝之火', occurred: true }, 'incident');
    for (const c of v.characters)
      add(
        'character',
        { character: c.id, status: 'dead', area: c.area, counters: c.counters },
        'incident',
      );
    add('failure', { result: 'protagonist-death' }, 'incident');
    add('boundary', {}, 'loop-end');
    s.append(h);
    assert(!s.conflict, s.conflict);
    add('boundary', {}, 'loop-start', 1, 2);
    for (const c of v.characters)
      add(
        'character',
        { character: c.id, status: 'alive', area: c.area, counters: c.counters },
        'loop-start',
        1,
        2,
      );
    add('incident', { day: nextDay, name: '灭绝之火', occurred: true }, 'incident', nextDay, 2);
    s.append(h);
    assert(!s.conflict, s.conflict);
    add('boundary', {}, 'captain-change', nextDay, 2);
    s.append(h);
    assert.equal(!s.conflict, nextDay === 1, s.conflict);
  }
});

test('WM 廷达罗斯之嗅在后续事件的阶段结束检查，黑猫或未发生的后续事件不产生死亡要求', () => {
  for (const mode of ['缺失', '出现', '未发生', '提前闭合']) {
    const v = opening('WM');
    v.ex = 1;
    v.incidents = [
      { day: 1, name: '廷达罗斯之嗅' },
      { day: 2, name: '发现' },
    ];
    v.characters[0]!.character = '黑猫';
    for (const c of v.characters) {
      c.counters.intrigue = 5;
      c.counters.paranoia = 5;
    }
    if (mode === '未发生') v.characters[1]!.counters.paranoia = 0;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'culprit', { day: 2, culprit: 'c1' }, 'protagonist-abilities'),
      event(2, 'incident', { day: 1, name: '廷达罗斯之嗅', occurred: true }),
      event(3, 'boundary', {}, 'captain-change'),
      event(4, 'incident', { day: 2, name: '发现', occurred: mode !== '未发生' }, 'incident', 2),
    ]);
    const cat = s.model.culprits.get(1)!['黑猫']!;
    assert.equal(s.model.graph.truth(cat), undefined);
    if (mode !== '未发生') s.append([event(5, 'board', { ex: 2 }, 'incident', 2)]);
    if (mode === '出现')
      s.append([event(6, 'failure', { result: 'protagonist-death' }, 'incident', 2)]);
    s.append([
      event(
        s.through + 1,
        'boundary',
        {},
        mode === '提前闭合' || mode === '出现' ? 'loop-end' : 'captain-change',
        2,
      ),
    ]);
    assert(!s.conflict, s.conflict);
    assert.equal(
      s.model.graph.truth(cat),
      mode === '缺失' ? true : mode === '出现' ? false : undefined,
      mode,
    );
  }
});

test('三席 FS 连续两次密谋的替代来源共同排除远处主谋和不相容的主线', () => {
  const v = opening();
  v.characters = v.characters.slice(0, 3);
  v.characters[2]!.area = 'shrine';
  v.days = v.loops = 1;
  v.incidents = [{ day: 1, name: '不安扩散' }];
  const s = new SolutionSpace3(v);
  const ph = 'mastermind-abilities';
  s.append([
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
    event(4, 'boundary', {}, ph),
  ]);
  s.append([event(5, 'board', { board: 'shrine', intrigue: 1 }, ph)]);
  const row = s.model.ids.get('巫女')!;
  assert.equal(s.model.graph.truth(row['主谋']!), undefined);
  s.append([
    {
      ...event(
        6,
        'character',
        {
          character: 'c0',
          area: 'school',
          status: 'alive',
          counters: { ...counters, intrigue: 1 },
        },
        ph,
      ),
      simultaneousSize: 1,
    },
  ]);
  assert(!s.conflict);
  assert.equal(s.model.graph.mark(row['主谋']!), '×');
  assert.equal(s.model.graph.mark(s.model.plots['守护此地']!), '×');
  assert.equal(s.model.graph.mark(s.model.plots['复仇的火种']!), '√');
  assert.equal(s.model.graph.mark(s.model.plots['流言四起']!), '√');
});

test('两处版图密谋与一次传谣共同限制角色和次数，逐条追加后排除不可能的主线', () => {
  const v = opening();
  v.characters = v.characters.slice(0, 3);
  v.characters[2]!.area = 'shrine';
  v.days = v.loops = 1;
  v.incidents = [{ day: 1, name: '不安扩散' }];
  const s = new SolutionSpace3(v);
  const ph = 'mastermind-abilities';
  s.append([
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
    event(4, 'boundary', {}, ph),
    event(5, 'board', { board: 'school', intrigue: 1 }, ph),
  ]);
  s.append([
    {
      ...event(
        6,
        'character',
        {
          character: 'c1',
          area: 'school',
          status: 'alive',
          counters: { ...counters, paranoia: 1 },
        },
        ph,
      ),
      simultaneousSize: 1,
    },
  ]);
  for (const n of ['男学生', '女学生'])
    for (const r of ['亲友', '杀人狂'])
      assert.equal(s.model.graph.mark(s.model.ids.get(n)![r]!), '×');
  assert.equal(s.model.graph.truth(s.model.plots['守护此地']!), undefined);
  s.append([event(7, 'board', { board: 'shrine', intrigue: 1 }, ph)]);
  assert(!s.conflict);
  for (const c of v.characters)
    for (const r of ['关键人物', '邪教徒'])
      assert.equal(s.model.graph.mark(s.model.ids.get(c.character)![r]!), '×');
  assert.equal(s.model.graph.mark(s.model.plots['复仇的火种']!), '√');
  assert.equal(s.model.graph.mark(s.model.plots['流言四起']!), '√');
});

test('BTX 自杀后的恋人六不安使用实际死者，正面证据立即生效、缺失只在闭合后排除', () => {
  for (const mode of ['出现', '缺失', '中断']) {
    const v = opening('BTX');
    v.characters[0]!.counters.paranoia = 4;
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    const h = [
      event(1, 'identity', { character: 'c0', identity: '求爱者' }, ph),
      event(2, 'culprit', { day: 1, culprit: 'c0' }, ph),
      event(3, 'incident', { day: 1, name: '自杀', occurred: true }),
      {
        ...event(4, 'character', {
          character: 'c0',
          area: 'school',
          status: 'dead',
          counters: v.characters[0]!.counters,
        }),
        simultaneousSize: 1,
      },
    ];
    s.append(h);
    const heart = s.model.ids.get('女学生')!['心上人']!;
    assert.equal(s.model.graph.truth(heart), undefined);
    if (mode === '出现')
      s.append([
        {
          ...event(5, 'character', {
            character: 'c1',
            area: 'school',
            status: 'alive',
            counters: { ...counters, paranoia: 6 },
          }),
          simultaneousSize: 1,
        },
      ]);
    if (mode === '出现') assert.equal(s.model.graph.truth(heart), true);
    s.append([
      event(s.through + 1, 'boundary', {}, mode === '中断' ? 'loop-end' : 'captain-change'),
    ]);
    if (mode === '缺失') {
      assert(!s.conflict, s.conflict);
      assert.equal(s.model.graph.truth(heart), false);
    } else {
      assert(!s.conflict, s.conflict);
      assert.equal(s.model.graph.truth(heart), mode === '出现' ? true : undefined);
    }
  }
});

test('HSA 诅咒死亡后两名求爱者分别获得六不安，从者替死时只读取从者的身份', () => {
  for (const substitute of [false, true]) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '言灵诅咒' }];
    if (substitute) v.characters[0]!.character = '大小姐';
    v.characters[2]!.character = '模仿犯';
    if (substitute) {
      v.characters[3]!.character = '从者';
      v.characters[3]!.area = 'school';
    }
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    const h = [
      event(1, 'identity', { character: 'c0', identity: '心上人' }, ph),
      event(2, 'identity', { character: 'c1', identity: '求爱者' }, ph),
    ];
    if (substitute)
      h.push(event(h.length + 1, 'identity', { character: 'c3', identity: '平民' }, ph));
    h.push(event(h.length + 1, 'board', { curses: [{ id: 'one', target: 'c0' }] }, 'incident'));
    h.push(event(h.length + 1, 'boundary', {}, 'day-end'));
    h.push({
      ...event(
        h.length + 1,
        'character',
        { character: substitute ? 'c3' : 'c0', area: 'school', status: 'dead', counters },
        'day-end',
      ),
      simultaneousSize: 1,
    });
    s.append(h);
    assert(!s.conflict, s.conflict);
    for (const id of ['c1', 'c2']) {
      s.append([
        {
          ...event(
            s.through + 1,
            'character',
            {
              character: id,
              area: v.characters[id === 'c1' ? 1 : 2]!.area,
              status: 'alive',
              counters: { ...counters, paranoia: 6 },
            },
            'day-end',
          ),
          simultaneousSize: 1,
        },
      ]);
      if (s.conflict) break;
    }
    assert.equal(Boolean(s.conflict), substitute, s.conflict);
    if (!substitute) assert.equal(s.model.graph.mark(s.model.ids.get('模仿犯')!['求爱者']!), '√');
  }
});

test('异界人已接受的杀害声明按目标当时的护卫、不死门槛及从者实际替死结算', () => {
  for (const mode of ['低不安', '高不安', '护卫', '替死', '中断', '拒绝']) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '失踪' }];
    v.characters[0]!.character = '异界人';
    v.characters[0]!.counters.goodwill = 4;
    v.characters[1]!.counters.paranoia = mode === '高不安' ? 2 : 0;
    if (mode === '护卫') v.characters[1]!.counters.guard = 1;
    if (mode === '替死') {
      v.characters[1]!.character = '大小姐';
      v.characters[2]!.character = '从者';
      v.characters[2]!.area = 'school';
    }
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    const h = [
      event(1, 'boundary', {}, ph),
      event(
        2,
        'declaration',
        { character: 'c0', ability: 'alien-kill', choices: { target: 'c1' } },
        ph,
      ),
    ];
    if (mode === '拒绝')
      h.push(event(3, 'refused', { character: 'c0', ability: 'alien-kill' }, ph));
    if (mode === '护卫' || mode === '替死')
      h.push({
        ...event(
          3,
          'character',
          {
            character: mode === '护卫' ? 'c1' : 'c2',
            area: 'school',
            status: mode === '护卫' ? 'alive' : 'dead',
            counters,
          },
          ph,
        ),
        simultaneousSize: 1,
      });
    s.append(h);
    assert(!s.conflict, s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, mode === '中断' ? 'loop-end' : 'incident')]);
    assert(!s.conflict, s.conflict);
    const row = s.model.ids.get(v.characters[1]!.character)!;
    if (mode === '低不安' || mode === '高不安') assert.equal(s.model.graph.mark(row['平民']!), '×');
    if (mode === '高不安') assert.equal(s.model.graph.mark(row['纸老虎']!), '×');
    if (mode === '护卫' || mode === '替死') assert.equal(s.model.graph.mark(row['吸血鬼']!), '×');
    if (mode === '中断' || mode === '拒绝')
      assert.equal(s.model.graph.truth(row['平民']!), undefined);
  }
});

test('HSA 丧尸移尸读取有效尸体身份，实体尸体与版图牺牲者合计每日一次', () => {
  for (const mode of ['实体', '牺牲者', '第二次', '对角']) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '言灵诅咒' }];
    v.characters[0]!.character = '住院患者';

    v.characters[0]!.area = 'hospital';
    v.boards.hospital = 1;
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'c0', identity: '平民' }, 'protagonist-abilities'),
      event(
        2,
        'character',
        { character: 'c0', status: 'dead', area: 'hospital', counters },
        'incident',
      ),
      event(3, 'boundary', {}, 'day-end'),
    ]);
    const cemetery = s.model.plots['古墓活尸']!;
    if (mode === '牺牲者' || mode === '第二次') {
      const first = {
        ...event(4, 'board', { board: 'hospital', intrigue: 0 }, 'day-end'),
        simultaneousGroup: 4,
        simultaneousSize: 2,
      };
      const last = {
        ...event(5, 'board', { board: 'shrine', intrigue: 1 }, 'day-end'),
        simultaneousGroup: 4,
        simultaneousSize: 2,
      };
      s.append([last]);
      assert.equal(s.model.graph.truth(cemetery), undefined);
      s.append([first]);
      assert.equal(s.model.graph.truth(cemetery), true);
    }
    if (mode !== '牺牲者')
      s.append([
        {
          ...event(
            s.through + 1,
            'character',
            {
              character: 'c0',
              status: 'dead',
              area: mode === '对角' ? 'school' : 'city',
              counters,
            },
            'day-end',
          ),
          simultaneousSize: 1,
        },
      ]);
    assert.equal(Boolean(s.conflict), mode === '第二次' || mode === '对角', s.conflict);
    if (!s.conflict) assert.equal(s.model.graph.truth(cemetery), true);
  }
});

test('获得关键人物能力只限死亡当时，都市门槛及深渊之都不会把配置身份改成关键人物', () => {
  for (const mode of ['都市一', '都市二', '深渊', '中断']) {
    const wm = mode === '深渊';
    const v = opening(wm ? 'WM' : 'BTX');
    v.incidents = [{ day: 1, name: wm ? '疯狂杀人' : '自杀' }];
    if (wm) v.ex = 1;
    v.boards.city = mode === '都市一' ? 1 : 2;
    v.characters[0]!.counters.paranoia = 5;
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c0', identity: wm ? '偏执狂' : '不安定因子' }, ph),
      event(2, 'culprit', { day: 1, culprit: 'c0' }, ph),
      event(3, 'incident', { day: 1, name: v.incidents[0]!.name, occurred: true }),
      {
        ...event(4, 'character', {
          character: 'c0',
          area: 'school',
          status: 'dead',
          counters: v.characters[0]!.counters,
        }),
        simultaneousSize: 1,
      },
    ]);
    assert(!s.conflict, s.conflict);
    if (wm) assert.equal(s.model.graph.truth(s.model.plots['深渊之都的私语']!), true);
    s.append([event(5, 'boundary', {}, mode === '中断' ? 'loop-end' : 'captain-change')]);
    assert.equal(Boolean(s.conflict), mode === '都市二' || wm, s.conflict);
    assert.equal(s.model.graph.truth(s.model.ids.get('男学生')!['关键人物']!), false);
  }
});

test('幻想声明移动或离场后检查实际结果，禁行的移动与已解除禁行的移动分别结算', () => {
  for (const mode of ['禁行', '解除', '漏移', '离场', '漏离场']) {
    const v = opening('BTX'),
      ph = 'protagonist-abilities';
    v.characters[0]!.character = '幻想';
    v.characters[0]!.area = 'hospital';
    v.characters[0]!.counters.goodwill = 5;
    v.characters[1]!.character = '住院患者';
    v.characters[1]!.area = 'hospital';
    v.characters[2]!.character = '医生';
    v.characters[2]!.area = 'hospital';
    v.characters[2]!.counters.goodwill = 3;
    const s = new SolutionSpace3(v);
    const h = [event(1, 'boundary', {}, ph)];
    if (mode === '解除' || mode === '漏移') {
      h.push(event(2, 'declaration', { character: 'c2', ability: 'doctor-release' }, ph));
      h.push(
        event(
          3,
          'own-choice',
          { choice: { kind: 'ability', owner: 'c0', ability: 'illusion-move' } },
          ph,
        ),
      );
    }
    h.push(
      event(
        h.length + 1,
        'declaration',
        {
          character: 'c0',
          ability: mode.includes('离场') ? 'illusion-remove' : 'illusion-move',
          choices: { target: 'c1', area: 'city' },
        },
        ph,
      ),
    );
    if (mode === '解除')
      h.push(
        event(
          h.length + 1,
          'character',
          { character: 'c1', area: 'city', status: 'alive', counters: v.characters[1]!.counters },
          ph,
        ),
      );
    if (mode === '离场')
      h.push(
        event(
          h.length + 1,
          'character',
          {
            character: 'c0',
            area: 'hospital',
            status: 'removed',
            counters: v.characters[0]!.counters,
          },
          ph,
        ),
      );
    s.append(h);
    assert(!s.conflict, s.conflict);
    s.append([event(h.length + 1, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, !mode.startsWith('漏'), mode);
  }
});

test('MZ 日末忍者可以杀害符合密谋门槛的平民，两批击杀不能从同一个忍者重复取用', () => {
  for (const value of [1, 2]) {
    const v = opening('MZ');
    v.incidents = [{ day: 1, name: '自杀' }];
    for (const c of v.characters) c.area = 'city';
    v.characters[0]!.counters.intrigue = value;
    v.characters[1]!.counters.intrigue = 2;
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c3', identity: '忍者' }, ph),
      event(2, 'identity', { character: 'c0', identity: '平民' }, ph),
      event(3, 'identity', { character: 'c1', identity: '平民' }, ph),
      event(4, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict, s.conflict);
    s.append([
      {
        ...event(
          5,
          'character',
          { character: 'c0', area: 'city', status: 'dead', counters: v.characters[0]!.counters },
          'day-end',
        ),
        simultaneousSize: 1,
      },
    ]);
    assert.equal(!s.conflict, value === 2, s.conflict);
    if (value === 2) {
      s.append([
        {
          ...event(
            6,
            'character',
            { character: 'c1', area: 'city', status: 'dead', counters: v.characters[1]!.counters },
            'day-end',
          ),
          simultaneousSize: 1,
        },
      ]);
      assert(s.conflict);
    }
  }
});

test('LL 怪杰的第三日强制击杀读取结算日，不把获得的杀人狂能力当成配置身份', () => {
  for (const day of [2, 3]) {
    const v = opening('LL');
    v.incidents = [{ day: 1, name: '失踪' }];
    const s = new SolutionSpace3(v);
    const ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c0', identity: '怪杰' }, ph, day),
      event(2, 'identity', { character: 'c1', identity: '平民' }, ph, day),
      event(3, 'boundary', {}, 'day-end', day),
    ]);
    assert(!s.conflict, s.conflict);
    s.append([
      {
        ...event(
          4,
          'character',
          { character: 'c1', area: 'school', status: 'dead', counters },
          'day-end',
          day,
        ),
        simultaneousSize: 1,
      },
    ]);
    assert.equal(!s.conflict, day === 3, s.conflict);
    assert.equal(s.model.graph.truth(s.model.ids.get('男学生')!['杀人狂']!), false);
  }
});

test('周年超越世界线在制作时提供一名传谣人，不能用两个普通平民填满剩余名额', () => {
  const v = opening('BTX');
  v.anniversary = true;
  v.days = v.loops = 1;
  v.characters.push({ id: 'c6', character: '护士', status: 'alive', area: 'hospital', counters });
  const s = new SolutionSpace3(v);
  s.append([
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'card-grant', { kind: 'hope+1', owner: 'p0' }, 'loop-start'),
    event(3, 'boundary', {}, 'day-start'),
    event(4, 'boundary', {}, 'mastermind-cards'),
  ]);
  const m = s.model,
    g = m.graph;
  const role = (i: number, r: string) => m.ids.get(v.characters[i]!.character)![r]!;
  const fixed = [
    m.plots['谋杀计划']!,
    m.plots['超越世界线']!,
    m.plots['潜伏的杀人狂']!,
    role(0, '主谋'),
    role(1, '杀手'),
    role(2, '关键人物'),
    role(3, '杀人狂'),
    role(4, '亲友'),
    role(6, '因果残片'),
  ];
  for (const lit of fixed) g.add('固定制作表的已知部分', [lit], 1);
  g.propagate();
  assert.equal(g.conflict, undefined);
  assert.equal(g.mark(role(5, '传谣人')), '√');
  assert.equal(g.mark(role(5, '平民')), '×');
});

test('WM 目击者与杀人狂同批请求，目击者有守护仍须增加 EX，观察中断保留', () => {
  for (const mode of ['两项', '漏击杀', '漏EX', '中断', '不安不足']) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [{ day: 1, name: '失踪' }];
    v.characters[0]!.counters.paranoia = mode === '不安不足' ? 3 : 4;
    v.characters[0]!.counters.guard = 1;
    const s = new SolutionSpace3(v),
      ph = 'protagonist-abilities';
    const h = [
      event(1, 'identity', { character: 'c0', identity: '目击者' }, ph),
      event(2, 'identity', { character: 'c1', identity: '杀人狂' }, ph),
      event(3, 'boundary', {}, 'day-end'),
    ];
    s.append(h);
    assert(!s.conflict, s.conflict);
    const dead = mode !== '不安不足' && mode !== '漏击杀';
    s.append([
      {
        ...event(
          4,
          'character',
          {
            character: 'c0',
            area: 'school',
            status: dead ? 'dead' : 'alive',
            counters: { ...v.characters[0]!.counters, guard: 0 },
          },
          'day-end',
        ),
        simultaneousSize: 1,
      },
    ]);
    if (mode === '漏击杀') {
      assert(s.conflict);
      continue;
    }
    assert(!s.conflict, s.conflict);
    if (mode === '两项') s.append([event(5, 'board', { ex: 1 }, 'day-end')]);
    if (mode !== '中断') s.append([event(mode === '两项' ? 6 : 5, 'boundary', {}, 'day-start', 2)]);
    assert.equal(!s.conflict, mode !== '漏EX', s.conflict);
  }
});

test('WM 祭品使用全场同一批死亡请求，读两种指示物的门槛并核对其余区域的幸存者', () => {
  for (const mode of ['全场', '缺一人', '不安不足', '密谋不足']) {
    const v = opening('WM');
    v.ex = 0;
    v.incidents = [{ day: 1, name: '失踪' }];
    v.characters[0]!.counters.paranoia = mode === '不安不足' ? 1 : 2;
    v.characters[0]!.counters.intrigue = mode === '密谋不足' ? 1 : 2;
    const s = new SolutionSpace3(v),
      ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c0', identity: '祭品' }, ph),
      event(2, 'identity', { character: 'c1', identity: '平民' }, ph),
      event(3, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict, s.conflict);
    const victims = v.characters.slice(mode === '缺一人' ? 2 : 1);
    const group = victims.map((c, i) => ({
      ...event(
        4 + i,
        'character',
        { character: c.id, area: c.area, status: 'dead', counters: c.counters },
        'day-end',
      ),
      simultaneousGroup: 4,
      simultaneousSize: victims.length,
    }));
    s.append(group);
    assert.equal(!s.conflict, mode === '全场', mode + ' ' + s.conflict);
  }
});

test('AI 按公开名调用自杀，使用 AI 自己的守护与身份；日程当事人与正式发生记录相互独立', () => {
  for (const mode of ['扣除守护', '错杀别人', '闭合缺失', '未闭合', '被拒绝']) {
    const v = opening('FS'),
      ph = 'protagonist-abilities';
    v.characters[0]!.character = 'AI';
    v.characters[0]!.counters.guard = 1;
    v.characters[0]!.counters.goodwill = 3;
    const s = new SolutionSpace3(v),
      m = s.model;
    s.append([
      event(1, 'culprit', { day: 1, culprit: 'c1' }, ph),
      event(2, 'boundary', {}, ph),
      event(
        3,
        'declaration',
        { character: 'c0', ability: 'ai', choices: { incident: '自杀' } },
        ph,
      ),
    ]);
    assert(!s.conflict, s.conflict);
    let seq = 4;
    if (mode === '扣除守护')
      s.append([
        event(
          seq++,
          'character',
          {
            character: 'c0',
            area: 'school',
            status: 'alive',
            counters: { ...v.characters[0]!.counters, guard: 0 },
          },
          ph,
        ),
      ]);
    if (mode === '错杀别人')
      s.append([
        event(
          seq++,
          'character',
          { character: 'c1', area: 'school', status: 'dead', counters: v.characters[1]!.counters },
          ph,
        ),
      ]);
    if (mode === '被拒绝')
      s.append([event(seq++, 'refused', { character: 'c0', ability: 'ai' }, ph)]);
    if (mode !== '未闭合') s.append([event(seq, 'boundary', {}, 'incident')]);
    assert.equal(
      !s.conflict,
      ['扣除守护', '未闭合', '被拒绝'].includes(mode),
      mode + ' ' + s.conflict,
    );
    assert.equal(m.graph.truth(m.culprits.get(1)!['女学生']!), true);
  }
});

test('AI 以都市群众调用诅咒活化，提供的场外当事人、真实事件日期与未来正式判定各自独立', () => {
  for (const target of ['city', 'school', undefined]) {
    const v = opening('HSA'),
      ph = 'protagonist-abilities';
    v.characters[0]!.character = 'AI';
    v.characters[0]!.counters.goodwill = 5;
    v.incidents = [{ day: 2, name: '诅咒活化' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'boundary', {}, ph),
      event(
        2,
        'declaration',
        { character: 'c0', ability: 'ai', choices: { incident: '诅咒活化' } },
        ph,
      ),
    ]);
    assert(!s.conflict, s.conflict);
    if (target) s.append([event(3, 'board', { curses: [{ id: '诅咒1', target }] }, ph)]);
    assert(!s.conflict, s.conflict);
    s.append([event(target ? 4 : 3, 'boundary', {}, 'incident')]);
    assert.equal(!s.conflict, target === 'city', s.conflict);
    if (target === 'city')
      assert.equal(s.model.graph.truth(s.model.culprits.get(2)!.city!), undefined);
  }
});

test('HSA 污秽溢出让同一角色获得两枚不安，随后给一块版图增加密谋；饱和版图允许没有增量', () => {
  for (const mode of ['完整', '先加版图', '少一枚', '少版图', '版图饱和', '未闭合']) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '污秽溢出' }];
    v.boards.city = mode === '版图饱和' ? 3 : 2;
    const s = new SolutionSpace3(v);
    const data = {
      character: 'c0',
      status: 'alive',
      area: 'school',
      counters: { ...counters, paranoia: mode === '少一枚' ? 1 : 2 },
    };
    const h = [
      event(1, 'boundary', {}, 'incident'),
      event(2, 'incident', { day: 1, name: '污秽溢出', occurred: true }),
    ];
    const add = (type: Observation['type'], d: Observation['data']) =>
      h.push({ ...event(h.length + 1, type, d), simultaneousSize: 1 });
    if (mode === '先加版图') add('board', { board: 'school', intrigue: 1 });
    add('character', data);
    if (mode === '完整' || mode === '少一枚') add('board', { board: 'school', intrigue: 1 });
    s.append(h);
    assert(!s.conflict, s.conflict);
    if (mode !== '未闭合') s.append([event(h.length + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(
      !s.conflict,
      ['完整', '版图饱和', '未闭合'].includes(mode),
      mode + ' ' + s.conflict,
    );
  }
});

test('WM 发现的增量区分黑猫、普通人和教主，窗口中断时保留尚未发生的第二次调用', () => {
  for (const gain of [0, 1, 2, 3, undefined]) {
    const v = opening('WM');
    v.ex = 1;
    v.incidents = [{ day: 1, name: '发现' }];
    v.characters[0]!.character = '黑猫';
    v.characters[1]!.character = '教主';
    v.characters.forEach((c) => (c.counters.paranoia = 5));
    const s = new SolutionSpace3(v),
      g = s.model.graph,
      a = s.model.culprits.get(1)!;
    s.append([event(1, 'incident', { day: 1, name: '发现', occurred: true })]);
    if (gain) s.append([event(2, 'board', { ex: 1 + gain })]);
    if (gain !== undefined) s.append([event(s.through + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(Boolean(s.conflict), gain === 3, s.conflict);
    if (gain === 0) assert.equal(g.mark(a['黑猫']!), '√');
    if (gain === 1) for (const n of ['黑猫', '教主']) assert.equal(g.mark(a[n]!), '×');
    if (gain === 2) assert.equal(g.mark(a['教主']!), '√');
    if (gain === undefined)
      for (const n of ['黑猫', '教主']) assert.equal(g.truth(a[n]!), undefined);
  }
});

test('WM 集体自杀先读当事人有效密谋，仅向其所在区域的所有生存角色提出死亡请求', () => {
  for (const mode of ['同区', '少一人', '零密谋', '零密谋无死者']) {
    const v = opening('WM');
    v.incidents = [{ day: 1, name: '集体自杀' }];
    v.characters[0]!.counters.paranoia = 5;
    v.characters[0]!.counters.intrigue = mode.startsWith('零') ? 0 : 1;
    const s = new SolutionSpace3(v);
    const h = [
      event(1, 'culprit', { day: 1, culprit: 'c0' }, 'protagonist-abilities'),
      event(2, 'identity', { character: 'c1', identity: '平民' }, 'protagonist-abilities'),
      event(3, 'incident', { day: 1, name: '集体自杀', occurred: true }),
    ];
    if (mode !== '零密谋无死者') {
      h.push(
        event(4, 'character', {
          character: 'c0',
          status: 'dead',
          area: 'school',
          counters: v.characters[0]!.counters,
        }),
      );
      if (mode !== '少一人')
        h.push(
          event(5, 'character', {
            character: 'c1',
            status: 'dead',
            area: 'school',
            counters: v.characters[1]!.counters,
          }),
        );
    }
    s.append(h);
    s.append([event(h.length + 1, 'boundary', {}, 'captain-change')]);
    assert.equal(!s.conflict, mode === '同区' || mode === '零密谋无死者', mode + ' ' + s.conflict);
  }
});

test('HSA 死亡鬼魂在剧作家阶段向原初区域加不安；确认闭合时才用强制结果的缺失排除', () => {
  for (const mode of ['初始区域', '漏加', '未闭合', '其他区域']) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name: '送葬' }];
    v.characters[0]!.area = 'school';
    v.characters[1]!.area = 'school';
    const s = new SolutionSpace3(v);
    const h = [
      event(1, 'identity', { character: 'c0', identity: '鬼魂' }, 'protagonist-abilities'),
      event(
        2,
        'character',
        { character: 'c0', area: 'hospital', status: 'alive', counters },
        'card-resolution',
      ),
      event(
        3,
        'character',
        { character: 'c0', area: 'hospital', status: 'dead', counters },
        'incident',
      ),
      event(4, 'boundary', {}, 'mastermind-abilities', 2),
    ];
    if (mode === '初始区域' || mode === '其他区域') {
      const target = v.characters[mode === '初始区域' ? 1 : 2]!;
      h.push(
        event(
          5,
          'character',
          {
            character: target.id,
            area: target.area,
            status: 'alive',
            counters: { ...counters, paranoia: 1 },
          },
          'mastermind-abilities',
          2,
        ),
      );
    }
    s.append(h);
    assert(!s.conflict, s.conflict);
    if (mode !== '未闭合')
      s.append([event(h.length + 1, 'boundary', {}, 'protagonist-abilities', 2)]);
    assert.equal(!s.conflict, mode === '初始区域' || mode === '未闭合', mode + ' ' + s.conflict);
  }
});

test('HSA 怪物们的阴谋要求区域中有无视友好者，两席时两种魔女位置都指向同一副线', () => {
  const v = opening('HSA');
  v.characters = v.characters.slice(0, 2);
  v.days = v.loops = 1;
  v.incidents = [{ day: 1, name: '亵渎杀人' }];
  const s = new SolutionSpace3(v);
  const h = [
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
    event(4, 'boundary', {}, 'mastermind-abilities'),
    event(5, 'board', { board: 'school', intrigue: 1 }, 'mastermind-abilities'),
  ];
  s.append(h);
  assert(!s.conflict, s.conflict);
  const m = s.model;
  assert.equal(m.graph.mark(m.plots['魔女遗咒']!), '√');
  assert.equal(m.graph.mark(m.plots['少女大危机']!), '×');
  for (const c of v.characters)
    assert.equal(m.graph.truth(m.ids.get(c.character)!['魔女']!), undefined);
});

test('BTX 两席仅剩流言四起可给版图加密谋时，传播到不相容的未知因子及身份', () => {
  const v = opening('BTX');
  v.days = v.loops = 1;
  v.characters = v.characters.slice(0, 2);
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'boundary', {}, 'loop-start'),
    event(2, 'boundary', {}, 'day-start'),
    event(3, 'boundary', {}, 'mastermind-cards'),
  ]);
  assert.equal(m.graph.truth(m.plots['未知因子Χ']!), undefined);
  s.append([
    event(4, 'boundary', {}, 'mastermind-abilities'),
    event(5, 'board', { board: 'hospital', intrigue: 1 }, 'mastermind-abilities'),
  ]);
  assert(!s.conflict, s.conflict);
  assert.equal(m.graph.mark(m.plots['流言四起']!), '√');
  assert.equal(m.graph.mark(m.plots['未知因子Χ']!), '×');
  for (const c of v.characters)
    assert.equal(m.graph.mark(m.ids.get(c.character)!['不安定因子']!), '×');
});

test('HSA 群众日程开局排除每一名角色；普通日程排除全部版图群众，其余合法格保持空白', () => {
  for (const [name, crowd] of [
    ['疯狂之夜', true],
    ['亵渎杀人', false],
  ] as const) {
    const v = opening('HSA');
    v.incidents = [{ day: 1, name }];
    const s = new SolutionSpace3(v),
      m = s.model;
    assert(!s.conflict, s.conflict);
    const row = m.culprits.get(1)!;
    for (const c of v.characters) assert.equal(m.graph.mark(row[c.character]!), crowd ? '×' : '');
    for (const b of ['city', 'hospital', 'shrine', 'school'])
      assert.equal(m.graph.mark(row[b]!), crowd ? '' : '×');
  }
});

test('FS 日末主人公死亡要求至少一名四密谋杀手；两名受支持者显示问号，第三人因名额排除', () => {
  const v = opening();
  v.characters[0]!.counters.intrigue = 4;
  v.characters[1]!.counters.intrigue = 4;
  const s = new SolutionSpace3(v),
    m = s.model;
  s.append([
    event(1, 'boundary', {}, 'day-end'),
    event(2, 'failure', { result: 'protagonist-death' }, 'day-end'),
  ]);
  assert(!s.conflict, s.conflict);
  for (const n of ['男学生', '女学生']) assert.equal(m.graph.mark(m.ids.get(n)!['杀手']!), '？');
  s.append([event(3, 'identity', { character: 'c1', identity: '平民' }, 'loop-end')]);
  assert.equal(m.graph.mark(m.ids.get('男学生')!['杀手']!), '√');
  assert.equal(m.graph.mark(m.ids.get('巫女')!['杀手']!), '×');
});

test('LL 密钥在第一二轮公开，非最终日取次日、最终日取当日日末；第三轮与未闭合不提前要求结果', () => {
  for (const [loop, day, close, conflict] of [
    [1, 1, 1, false],
    [1, 1, 2, true],
    [2, 3, 3, true],
    [3, 1, 2, false],
    [1, 1, 0, false],
  ] as const) {
    const v = opening('LL');
    v.loops = 3;
    v.incidents = [{ day: 1, name: '失踪' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(
        1,
        'identity',
        { character: 'c0', identity: '密钥' },
        'protagonist-abilities',
        day,
        loop,
      ),
      event(2, 'boundary', {}, 'day-end', close || 2, loop),
    ]);
    assert(!s.conflict, s.conflict);
    if (close)
      s.append([
        event(
          3,
          'boundary',
          {},
          close === 3 ? 'loop-end' : 'day-start',
          Math.min(close + 1, 3),
          loop,
        ),
      ]);
    assert.equal(Boolean(s.conflict), conflict, s.conflict);
  }
});

test('MC 投毒者的日末主人公死亡门槛为四，不能把未闭合阶段或未知 EX 当作缺失', () => {
  for (const [ex, complete, dead] of [
    [3, true, false],
    [4, true, false],
    [4, true, true],
    [4, false, false],
    [undefined, true, false],
  ] as const) {
    const v = opening('MC');
    v.ex = ex;
    v.incidents = [{ day: 1, name: '前兆' }];
    const s = new SolutionSpace3(v);
    s.append([
      event(1, 'identity', { character: 'c0', identity: '投毒者' }, 'protagonist-abilities'),
      event(2, 'boundary', {}, 'day-end'),
    ]);
    if (dead) s.append([event(3, 'failure', { result: 'protagonist-death' }, 'day-end')]);
    if (complete) s.append([event(s.through + 1, 'boundary', {}, 'day-start', 2)]);
    assert.equal(Boolean(s.conflict), ex === 4 && complete && !dead, s.conflict);
  }
});

test('WM 疯狂的真相替换失败条件后仍须检验达贡的福音书，EX 二与神社零密谋不足以失败', () => {
  for (const [shrine, reported] of [
    [0, false],
    [0, true],
    [2, false],
    [2, true],
  ] as const) {
    const v = opening('WM');
    v.characters[0]!.character = '情报商';
    v.ex = 2;
    v.boards.shrine = shrine;
    v.incidents = [{ day: 1, name: '发现' }];
    const s = new SolutionSpace3(v),
      m = s.model;
    // A fixed prior joint branch: it is not passed through the public input contract.
    for (const a of [m.primary['黄衣之王']!, m.plots['疯狂的真相']!, m.alt['达贡的福音书']!])
      m.graph.add('此固定前缀的待核对制作分支', [a], 1);
    s.append([event(1, 'boundary', {}, 'loop-start'), event(2, 'boundary', {}, 'loop-end', 3)]);
    if (reported) s.append([event(3, 'failure', { result: 'protagonist-failure' }, 'loop-end', 3)]);
    assert(!s.conflict, s.conflict);
    s.append([event(s.through + 1, 'boundary', {}, 'finished', 3)]);
    assert.equal(!s.conflict, shrine >= 2 === reported, s.conflict);
  }
});

test('MC 投毒者每轮首次 EX 达二时选同区一人，一天的守护消耗与下一天的额度属于同一解释', () => {
  for (const start of [1, 2]) {
    const v = opening('MC');
    v.ex = start;
    v.incidents = [{ day: 1, name: '前兆' }];
    v.characters[2]!.area = 'school';
    v.characters[1]!.counters.guard = 1;
    const s = new SolutionSpace3(v),
      ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c0', identity: '投毒者' }, ph),
      event(2, 'identity', { character: 'c1', identity: '平民' }, ph),
      event(3, 'identity', { character: 'c2', identity: '平民' }, ph),
      event(4, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict, s.conflict);
    let seq = 5;
    if (start === 2)
      s.append([
        {
          ...event(
            seq++,
            'character',
            {
              character: 'c1',
              area: 'school',
              status: 'alive',
              counters: { ...v.characters[1]!.counters, guard: 0 },
            },
            'day-end',
          ),
          simultaneousSize: 1,
        },
      ]);
    s.append([
      event(seq++, 'boundary', {}, 'day-start', 2),
      event(seq++, 'board', { ex: 2 }, 'incident', 2),
      event(seq++, 'boundary', {}, 'day-end', 2),
    ]);
    assert(!s.conflict, s.conflict);
    s.append([
      {
        ...event(
          seq++,
          'character',
          { character: 'c2', area: 'school', status: 'dead', counters: v.characters[2]!.counters },
          'day-end',
          2,
        ),
        simultaneousSize: 1,
      },
    ]);
    assert.equal(!s.conflict, start === 1, s.conflict);
  }
});
test('MC 投毒者在闭合的无变化窗口必须有能静默承受的对象，侦探不死可以消耗此次强制使用', () => {
  for (const counterpart of ['侦探', '平民']) {
    const v = opening('MC');
    v.ex = 2;
    v.incidents = [{ day: 1, name: '前兆' }];
    const s = new SolutionSpace3(v),
      ph = 'protagonist-abilities';
    s.append([
      event(1, 'identity', { character: 'c0', identity: '投毒者' }, ph),
      event(2, 'identity', { character: 'c1', identity: counterpart }, ph),
      event(3, 'boundary', {}, 'day-end'),
    ]);
    assert(!s.conflict, s.conflict);
    s.append([event(4, 'boundary', {}, 'day-start', 2)]);
    assert.equal(!s.conflict, counterpart === '侦探', s.conflict);
  }
});

test('LL 第六枚沟通标志与最终计划按当时盘面共同判定特殊胜利，之后获得希望不能拼接到先前窗口', () => {
  for (const mode of ['五枚', '缺失', '已获胜', '先有希望', '后来才有希望', '未闭合']) {
    const v = opening('LL'),
      ph = 'protagonist-abilities';
    v.incidents = [{ day: 1, name: '不安扩散' }];
    v.characters[0]!.counters.hope = mode === '先有希望' ? 1 : 0;
    const s = new SolutionSpace3(v),
      m = s.model;
    const h = [
      event(1, 'rule', { rule: '最终计划' }, ph),
      event(2, 'rule', { rule: '神话收集者' }, ph),
      event(3, 'identity', { character: 'c0', identity: '关键人物' }, ph),
      event(4, 'boundary', {}, ph),
    ];
    const count = mode === '五枚' ? 5 : 6;
    for (let i = 0; i < count; i++)
      h.push(event(h.length + 1, 'board', { communicatedMarker: 'c' + i }, ph));
    s.append(h);
    assert(!s.conflict, s.conflict);
    let seq = h.length + 1;
    if (mode === '后来才有希望')
      s.append([
        event(
          seq++,
          'character',
          { character: 'c0', status: 'alive', area: 'school', counters: { ...counters, hope: 1 } },
          ph,
        ),
      ]);
    if (mode === '已获胜')
      s.append([
        event(seq++, 'boundary', {}, 'finished'),
        event(seq++, 'victory', { winner: 'p1' }, 'finished'),
      ]);
    else if (mode !== '未闭合') s.append([event(seq++, 'boundary', {}, 'incident')]);
    assert.equal(
      Boolean(s.conflict),
      mode === '缺失' || mode === '后来才有希望',
      mode + ' ' + s.conflict,
    );
    if (mode === '已获胜') assert.equal(m.graph.mark(m.seats.get('p1')!.B!), '√');
  }
});
test('从者未记录的追加保护目标整轮固定，两次死亡不能分别借用不同的选择', () => {
  for (const same of [true, false]) {
    const v = opening();
    v.characters[0]!.character = '从者';
    v.characters[0]!.counters.goodwill = 4;
    v.characters[0]!.counters.guard = 1;
    v.characters[2]!.character = '异界人';
    v.characters[2]!.counters.goodwill = 4;
    v.characters[2]!.area = v.characters[3]!.area = 'school';
    const next = same ? 1 : 3;
    v.characters[next]!.counters.paranoia = 6;
    const s = new SolutionSpace3(v),
      g = s.model.graph,
      ph = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, ph),
      event(2, 'declaration', { character: 'c0', ability: 'servant' }, ph),
      event(3, 'own-choice', { choice: { kind: 'ability' } }, ph),
      event(
        4,
        'declaration',
        { character: 'c2', ability: 'alien-kill', choices: { target: 'c1' } },
        ph,
      ),
      {
        ...event(
          5,
          'character',
          {
            character: 'c0',
            status: 'alive',
            area: 'school',
            counters: { ...v.characters[0]!.counters, guard: 0 },
          },
          ph,
        ),
        simultaneousSize: 1,
      },
      event(6, 'boundary', {}, 'incident'),
    ]);
    assert(!s.conflict, s.conflict);
    const chosen = g.names.findIndex((n) => n.endsWith('从者本轮追加保护 女学生'));
    assert(chosen > 0);
    assert.equal(g.truth(chosen), true);
    s.append([
      event(7, 'culprit', { day: 1, culprit: 'c' + next }),
      event(8, 'incident', { day: 1, name: '自杀', occurred: true }),
      {
        ...event(9, 'character', {
          character: 'c0',
          status: 'dead',
          area: 'school',
          counters: { ...v.characters[0]!.counters, guard: 0 },
        }),
        simultaneousSize: 1,
      },
      event(10, 'boundary', {}, 'captain-change'),
    ]);
    if (same) assert(!s.conflict, s.conflict);
    else assert(s.conflict);
  }
});
test('MC 封锁必须公告当事人所在版图，黑猫无现象；三天内友好能力也不能进出版图', () => {
  for (const mode of ['公告', '静默', '第三天', '第四天', '跨轮']) {
    const v = opening('MC');
    v.days = 5;
    v.ex = 0;
    v.incidents = [{ day: 1, name: '封锁' }];
    v.characters[0]!.character = '黑猫';
    v.characters.forEach((c) => (c.counters.paranoia = 6));
    const s = new SolutionSpace3(v),
      g = s.model.graph,
      actors = s.model.culprits.get(1)!;
    s.append([
      event(1, 'boundary', {}, 'incident'),
      event(2, 'incident', { occurred: true, day: 1, name: '封锁' }),
    ]);
    assert.equal(g.truth(actors['黑猫']!), undefined);
    if (mode !== '静默')
      s.append([event(3, 'board', { attachment: 'lockdown-area', target: 'school' })]);
    s.append([
      event(s.through + 1, 'board', { ex: 1 }),
      event(s.through + 2, 'boundary', {}, 'captain-change'),
    ]);
    assert(!s.conflict, s.conflict);
    assert.equal(g.truth(actors['黑猫']!), mode === '静默');
    if (mode === '静默') continue;
    assert.equal(g.truth(actors['女学生']!), true);
    if (mode === '公告') continue;
    const day = mode === '第四天' ? 4 : 3,
      loop = mode === '跨轮' ? 2 : 1;
    s.append([
      event(
        s.through + 1,
        'character',
        { ...v.characters[1], character: 'c1', area: 'city' },
        'protagonist-abilities',
        day,
        loop,
      ),
    ]);
    assert.equal(!!s.conflict, mode === '第三天', s.conflict);
  }
});
test('MC 教主可疑信件先移自己后读新区，只有实际移动的对象次日禁行', () => {
  for (const mode of ['教主', '一次', '不移动', '第三日']) {
    const v = opening('MC');
    v.ex = 0;
    v.incidents = [{ day: 1, name: '可疑信件' }];
    v.characters[0]!.character = '教主';
    v.characters.forEach((c) => (c.counters.paranoia = 6));
    const s = new SolutionSpace3(v),
      actors = s.model.culprits.get(1)!;
    s.append([
      event(1, 'boundary', {}, 'incident'),
      event(2, 'incident', { day: 1, name: '可疑信件', occurred: true }),
    ]);
    const move = (idx: number, to: string, phase: Observation['phase'] = 'incident', day = 1) => ({
      ...event(
        s.through + 1,
        'character',
        { character: 'c' + idx, status: 'alive', area: to, counters: v.characters[idx]!.counters },
        phase,
        day,
      ),
      simultaneousSize: 1,
    });
    if (mode !== '不移动') s.append([move(0, 'city')]);
    if (mode === '教主') s.append([move(2, 'shrine')]);
    s.append([
      event(s.through + 1, 'board', { ex: 1 }),
      event(s.through + 2, 'boundary', {}, 'captain-change'),
    ]);
    assert(!s.conflict, s.conflict);
    if (mode === '教主') assert.equal(s.model.graph.truth(actors['教主']!), true);
    s.append([move(0, 'hospital', 'card-resolution', mode === '第三日' ? 3 : 2)]);
    assert.equal(!!s.conflict, ['教主', '一次'].includes(mode), s.conflict);
  }
});
test('MC 双胞胎担任封锁当事人时公告对角版图，明确的牌面位置与结算位置分别保留', () => {
  const v = opening('MC');
  v.ex = 0;
  v.incidents = [{ day: 1, name: '封锁' }];
  v.characters[1]!.counters.paranoia = 6;
  const s = new SolutionSpace3(v);
  s.append([
    event(1, 'culprit', { day: 1, culprit: 'c1' }),
    event(2, 'incident', { day: 1, name: '封锁', occurred: true }),
    event(3, 'board', { ex: 1 }),
    event(4, 'board', { attachment: 'lockdown-area', target: 'hospital' }),
    event(5, 'boundary', {}, 'captain-change'),
  ]);
  assert(!s.conflict, s.conflict);
  assert.equal(s.model.graph.mark(s.model.ids.get('女学生')!['双胞胎']!), '√');
});
test('MC 偏执狂给自己放密谋与不安共用当天一次，第二个效果必须有独立来源', () => {
  const v = opening('MC');
  v.characters[0]!.area = 'hospital';
  const s = new SolutionSpace3(v),
    r = s.model.ids.get('男学生')!;
  const ph = 'mastermind-abilities';
  s.append([
    event(1, 'boundary', {}, ph),
    {
      ...event(
        2,
        'character',
        {
          character: 'c0',
          area: 'hospital',
          status: 'alive',
          counters: { ...counters, intrigue: 1 },
        },
        ph,
      ),
      simultaneousSize: 1,
    },
  ]);
  assert.notEqual(s.model.graph.truth(r['偏执狂']!), false);
  s.append([
    {
      ...event(
        3,
        'character',
        {
          character: 'c0',
          area: 'hospital',
          status: 'alive',
          counters: { ...counters, intrigue: 1, paranoia: 1 },
        },
        ph,
      ),
      simultaneousSize: 1,
    },
  ]);
  assert(s.conflict);
});
test('MC 猎奇杀人首次公开加不安时，之前的同区杀害已结算；其余事件效果仍未闭合', () => {
  const v = opening('MC');
  v.ex = 0;
  v.incidents = [{ day: 1, name: '猎奇杀人' }];
  v.characters.forEach((c) => (c.counters.paranoia = 6));
  v.characters[2]!.area = 'shrine';
  const s = new SolutionSpace3(v),
    r = s.model.culprits.get(1)!;
  s.append([
    event(1, 'incident', { day: 1, name: '猎奇杀人', occurred: true }),
    event(2, 'board', { ex: 2 }),
  ]);
  assert.equal(s.model.graph.truth(r['男学生']!), undefined);
  s.append([
    {
      ...event(3, 'character', {
        character: 'c0',
        area: 'school',
        status: 'alive',
        counters: { ...counters, paranoia: 8 },
      }),
      simultaneousSize: 1,
    },
  ]);
  // A twin can execute in the opposite area. Excluding that role fixes the scope to its physical area.
  const role = s.model.ids.get('男学生')!['双胞胎']!;
  assert.equal(
    admits(s.model.graph, [r['男学生']!, -role, -s.model.ids.get('女学生')!['侦探']!]),
    false,
  );
  assert(!s.conflict, s.conflict);
  assert.notEqual(s.model.graph.truth(r['巫女']!), false);
});
test('LL 决战前 C 的机会读取复原前最终轮的关键人物希望，两个当事人答案错误后只排除整组', () => {
  for (const mode of ['最终禁止', '提前决战', '答错后揭示', '普通提问']) {
    const v = opening('LL');
    v.loops = mode === '提前决战' ? 2 : 1;
    v.characters[0]!.counters.hope = mode === '答错后揭示' ? 0 : 1;
    v.incidents = [
      { day: 1, name: '遗言' },
      { day: 2, name: '散播' },
    ];
    const s = new SolutionSpace3(v),
      g = s.model.graph;
    for (const lit of [
      s.model.plots['最终计划']!,
      s.model.plots['我才是名侦探']!,
      s.model.ids.get('男学生')!['关键人物']!,
    ])
      g.add('固定用例制作选择', [lit], 1);
    g.propagate();
    s.append([event(1, 'boundary', {}, 'final-guess')]);
    assert(!s.conflict, s.conflict);
    if (mode === '普通提问')
      s.append([
        event(2, 'identity', { character: 'c0', guess: '关键人物', correct: true }, 'final-guess'),
      ]);
    else
      s.append([
        event(2, 'culprit', { guesses: { 1: 'c1', 2: 'c2' }, correct: false }, 'final-guess'),
      ]);
    assert.equal(!!s.conflict, mode === '最终禁止', s.conflict);
    if (mode === '答错后揭示') {
      s.append([event(3, 'culprit', { day: 1, culprit: 'c1' }, 'final-guess')]);
      assert.equal(g.truth(s.model.culprits.get(2)!['巫女']!), false);
    }
  }
});
test('MC 心理医生在 EX 一时必须减不安，可选零不安对象使结果不可见；窗口中断保留身份', () => {
  for (const mode of ['出现', '完整', '可选零', '中断', 'EX零']) {
    const v = opening('MC');
    v.ex = mode === 'EX零' ? 0 : 1;
    v.characters[1]!.counters.paranoia = mode === '可选零' ? 0 : 1;
    const s = new SolutionSpace3(v),
      role = s.model.ids.get('男学生')!['心理医生']!;
    s.append([event(1, 'boundary', {}, 'mastermind-abilities')]);
    assert.equal(s.model.graph.truth(role), undefined);
    if (mode === '出现')
      s.append([
        {
          ...event(
            2,
            'character',
            { character: 'c1', status: 'alive', area: 'school', counters },
            'mastermind-abilities',
          ),
          simultaneousSize: 1,
        },
      ]);
    s.append([
      event(s.through + 1, 'boundary', {}, mode === '中断' ? 'loop-end' : 'protagonist-abilities'),
    ]);
    assert(!s.conflict, s.conflict);
    assert.equal(
      s.model.graph.truth(role),
      mode === '出现' ? true : mode === '完整' ? false : undefined,
    );
  }
});
test('从者接受追加保护时读取声明时的对象，只允许其他存活角色', () => {
  for (const targetId of ['c0', 'c1', 'c2']) {
    const v = opening();
    v.characters[0]!.character = '从者';
    v.characters[0]!.counters.goodwill = 4;
    v.characters[1]!.status = 'dead';
    const s = new SolutionSpace3(v),
      ph = 'protagonist-abilities';
    s.append([
      event(1, 'boundary', {}, ph),
      event(
        2,
        'declaration',
        { character: 'c0', ability: 'servant', choices: { target: targetId } },
        ph,
      ),
      event(3, 'boundary', {}, 'incident'),
    ]);
    assert.equal(!!s.conflict, targetId !== 'c2', s.conflict);
  }
});
