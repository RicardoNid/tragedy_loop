import { startSession } from './start-session.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, character, lab, phase, type Lab } from '../comprehensive/harness.js';
import { advance } from '../../packages/engine/src/runtime/engine.js';
import { createSession, project } from '../../packages/engine/src/runtime/ports.js';
import { settle } from '../../packages/engine/src/runtime/settlement.js';
import type { Actor, CardKind, Choice } from '../../packages/contracts/src/game.js';

const values = (l: Lab) =>
  l.state.pending?.options.flatMap((c) => (c.kind === 'select' ? [c.value] : [])) ?? [];
const pick = (l: Lab, value: string) => act(l, { kind: 'select', value });
const config = (l: Lab, id: string) => l.state.setup.characters.find((c) => c.id === id)!;
function incident(l: Lab, name: string) {
  l.state.setup.incidents = [{ day: 1, name, culprit: 'a' }];
  phase(l, 'incident');
}
function reject(l: Lab, choice: Choice) {
  const pending = l.state.pending!;
  const r = advance(l.pack, l.state, pending.actor, {
    id: 'invalid',
    expectedRevision: l.state.revision,
    decisionId: pending.id,
    choice,
  });
  assert.equal(r.status, 'rejected');
  assert.deepEqual(r.state, l.state);
}

test('仙人兼双胞胎在学校只能选择医院或神社，所选版图决定事件目标', () => {
  for (const mode of ['diagonal', 'clockwise']) {
    const l = lab('MC');
    character(l, 'a', '仙人', '双胞胎', 'school').counters.paranoia = 5;
    character(l, 'b', '女学生', '平民', 'hospital');
    character(l, 'c', '医生', '平民', 'shrine');
    character(l, 'd', '职员', '平民', 'school');
    incident(l, '连续杀人');
    assert.equal(l.state.pending?.actor, 'mastermind');
    assert.deepEqual(values(l), ['diagonal', 'clockwise']);
    assert.deepEqual(project(l.state, 'mastermind').decision?.areas, {
      diagonal: 'hospital',
      clockwise: 'shrine',
    });
    reject(l, { kind: 'select', value: 'actual' });
    pick(l, mode);
    const { a, b, c, d } = l.state.characters;
    assert.deepEqual(
      [a!.area, b!.status, c!.status, d!.status],
      [
        'school',
        mode === 'diagonal' ? 'dead' : 'alive',
        mode === 'clockwise' ? 'dead' : 'alive',
        'alive',
      ],
    );
  }
});

test('事件版图取决于各自的编译字段，变更其中一项即可改变组合', () => {
  for (const alternative of ['clockwise', 'diagonal'] as const) {
    const l = lab('MC');
    l.pack = structuredClone(l.pack);
    l.pack.characters['女学生']!.incidentAreaFromBase = alternative;
    l.pack.identities['平民']!.baseIncidentArea = 'diagonal';
    character(l, 'a', '女学生', '平民', 'school').counters.paranoia = 5;
    character(l, 'b', '男学生', '平民', 'hospital');
    character(l, 'c', '医生', '平民', 'shrine');
    character(l, 'd', '职员', '平民', 'school');
    incident(l, '连续杀人');
    if (alternative === 'clockwise') {
      assert.deepEqual(l.state.pending?.areas, { diagonal: 'hospital', clockwise: 'shrine' });
      pick(l, 'clockwise');
      assert.equal(l.state.characters.c!.status, 'dead');
    } else {
      assert.deepEqual(l.state.pending?.areas, { base: 'hospital', diagonal: 'school' });
      pick(l, 'base');
      assert.equal(l.state.characters.b!.status, 'dead');
      assert.equal(l.state.characters.c!.status, 'alive');
    }
  }
});

test('四个起点都先取对角，再从基准顺时针计算仙人的备选', () => {
  for (const [origin, base, alternative] of [
    ['school', 'hospital', 'shrine'],
    ['hospital', 'school', 'city'],
    ['city', 'shrine', 'school'],
    ['shrine', 'city', 'hospital'],
  ] as const) {
    const l = lab('MC');
    character(l, 'a', '仙人', '双胞胎', origin).counters.paranoia = 5;
    incident(l, '医院事故');
    assert.deepEqual(l.state.pending?.areas, { diagonal: base, clockwise: alternative });
  }
});

test('学校的仙人双胞胎遇医院事故，按选区判定，尸体留在实际位置', () => {
  for (const mode of ['diagonal', 'clockwise']) {
    const l = lab('MC');
    character(l, 'a', '仙人', '双胞胎', 'school').counters.paranoia = 5;
    l.state.boards.hospital = 1;
    incident(l, '医院事故');
    pick(l, mode);
    assert.equal(l.state.characters.a!.status, mode === 'diagonal' ? 'dead' : 'alive');
    assert.equal(l.state.characters.a!.area, 'school');
  }
});

test('仙人孤守先选版图，同区存活者各选目的地后才同时移动', () => {
  for (const mode of ['actual', 'clockwise']) {
    const l = lab('HSA');
    character(l, 'a', '仙人', '平民', 'school').counters.paranoia = 5;
    const area = mode === 'actual' ? 'school' : 'city';
    character(l, 'b', '女学生', '平民', area);
    character(l, 'c', '职员', '平民', area);
    character(l, 'd', '医生', '平民', mode === 'actual' ? 'city' : 'school');
    incident(l, '孤守');
    assert.deepEqual(values(l), ['actual', 'clockwise']);
    pick(l, mode);
    pick(l, 'hospital');
    assert.deepEqual([l.state.characters.b!.area, l.state.characters.c!.area], [area, area]);
    pick(l, 'shrine');
    assert.deepEqual(
      Object.values(l.state.characters).map((c) => c.area),
      ['school', 'hospital', 'shrine', mode === 'actual' ? 'city' : 'school'],
    );
  }
});

test('仙人向有两具尸体的版图移动，声明目标后才可拒绝', () => {
  for (const refuse of [false, true]) {
    const l = lab('AHR');
    character(l, 'a', '仙人', '童谣', 'school').counters.goodwill = 5;
    config(l, 'a').x = 3;
    character(l, 'b', '女学生', '平民', 'city').status = 'dead';
    character(l, 'c', '医生', '平民', 'city').status = 'dead';
    phase(l, 'protagonist-abilities');
    act(l, { kind: 'ability', owner: 'a', ability: 'immortal-revive', choices: { area: 'city' } });
    assert.equal(l.state.pending?.actor, l.state.captain);
    assert.deepEqual(values(l), ['b', 'c']);
    pick(l, 'c');
    assert.equal(l.state.pending?.kind, 'refusal');
    assert.deepEqual(
      l.state.observations.mastermind.filter((o) => o.type === 'declaration').at(-1)?.data.choices,
      { area: 'city', target: 'c' },
    );
    assert.equal(l.state.characters.a!.area, 'school');
    act(l, { kind: 'refuse', refuse });
    const { a, b, c } = l.state.characters;
    assert.deepEqual(
      [a!.area, b!.status, c!.status, c!.counters.goodwill],
      refuse ? ['school', 'dead', 'dead', 0] : ['city', 'dead', 'alive', 3],
    );
  }
});

test('大人物领地公开给三个主人公，杀手从所选区域检查声明资格', () => {
  for (const territory of ['school', 'hospital'] as const) {
    const l = lab();
    const setup = {
      ...l.state.setup,
      y: '谋杀计划',
      x: ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '大人物', identity: '关键人物', territory },
        { id: 'b', character: '女学生', identity: '传谣人' },
        { id: 'c', character: '医生', identity: '杀手' },
        { id: 'd', character: '巫女', identity: '主谋' },
      ],
    };
    const session = createSession(l.pack, setup);
    startSession(session);
    for (const seat of ['p0', 'p1', 'p2'] as const)
      assert.equal(session.protagonists![seat].view().territory, territory);
  }
  for (const mode of ['actual', 'territory']) {
    const l = lab();
    character(l, 'a', '大人物', '杀手', 'city');
    config(l, 'a').territory = 'school';
    character(l, 'b', '女学生', '关键人物', 'school').counters.intrigue = 2;
    phase(l, 'day-end');
    assert.deepEqual(values(l), ['actual', 'territory']);
    reject(l, { kind: 'ability', owner: 'a', ability: 'killer-character' });
    pick(l, mode);
    if (mode === 'territory')
      act(l, {
        kind: 'ability',
        owner: 'a',
        ability: 'killer-character',
        choices: { target: 'b' },
      });
    else
      assert.ok(
        !l.state.pending?.options.some(
          (c) => c.kind === 'ability' && c.ability === 'killer-character',
        ),
      );
    assert.equal(l.state.characters.b!.status, mode === 'territory' ? 'dead' : 'alive');
  }
});

test('大人物杀人狂可以选择空区；MC 的 EX 为零时，侦探从选定区域判断同区', () => {
  const l = lab();
  character(l, 'a', '大人物', '杀人狂', 'city');
  config(l, 'a').territory = 'school';
  phase(l, 'day-end');
  assert.deepEqual(values(l), ['actual', 'territory']);
  pick(l, 'actual');
  assert.equal(l.state.characters.b!.status, 'alive');
  for (const culprit of ['city', 'school'] as const)
    for (const mode of ['actual', 'territory']) {
      const x = lab('MC');
      character(x, 'b', '大人物', '侦探', 'city');
      config(x, 'b').territory = 'school';
      character(x, 'a', '男学生', '平民', culprit);
      incident(x, '封锁');
      pick(x, mode);
      assert.equal(
        x.state.incidents.length,
        Number(culprit === (mode === 'actual' ? 'city' : 'school')),
      );
    }
});

test('巫女胆小鬼选禁区则留在原地，丧尸尸体可实际进入同一禁区', () => {
  const l = lab('HSA');
  character(l, 'a', '巫女', '胆小鬼', 'school').counters.paranoia = 2;
  phase(l, 'mastermind-abilities');
  pick(l, 'city');
  assert.equal(l.state.characters.a!.area, 'school');
  const x = lab('HSA');
  x.state.setup.y = '古墓活尸';
  character(x, 'a', '巫女', '平民', 'school');
  settle(x.pack, x.state, [{ effect: { op: 'kill', target: 'a' }, env: {} }]);
  phase(x, 'day-end');
  act(x, {
    kind: 'ability',
    owner: 'module:zombies',
    ability: 'zombie-move',
    choices: { target: 'a' },
  });
  pick(x, 'city');
  assert.equal(x.state.characters.a!.area, 'city');
});

test('从者被可疑信件移动后，次日受禁移不能跟随大小姐', () => {
  const l = lab('MC');
  character(l, 'a', '医生', '平民', 'hospital').counters.paranoia = 4;
  character(l, 'b', '大小姐', '平民', 'school');
  character(l, 'c', '从者', '平民', 'hospital');
  character(l, 'd', '职员', '平民', 'city');
  incident(l, '可疑信件');
  pick(l, 'c');
  pick(l, 'school');
  assert.equal(l.state.day, 2);
  assert.equal(l.state.characters.c!.flags.immobile, 'yes');
  const cards: [Actor, string, CardKind][] = [
    ['mastermind', 'b', 'horizontal'],
    ['mastermind', 'hospital', 'block-goodwill'],
    ['mastermind', 'city', 'block-paranoia'],
    ['p0', 'c', 'horizontal'],
    ['p1', 'school', 'paranoia+1'],
    ['p2', 'shrine', 'paranoia+1'],
  ];
  while (l.state.pending?.kind === 'cards') {
    const actor = l.state.pending.actor;
    const placements = cards
      .filter(([owner]) => actor === owner)
      .map(([, target, kind]) => {
        const card = l.state.cards.find(
          (c) => c.owner === actor && c.kind === kind && c.status === 'hand',
        );
        assert.ok(card);
        return { target, card: card.id };
      });
    act(l, { kind: 'cards', placements });
  }
  assert.deepEqual([l.state.characters.b!.area, l.state.characters.c!.area], ['city', 'school']);
});
