import assert from 'node:assert/strict';
import { character, lab, phase, act, ability, drain, type Lab } from './harness.js';
import { settle, grantCard } from '../../packages/engine/src/runtime/settlement.js';
import {
  effective,
  refusal,
  destination,
  recompute,
  select,
  traitors,
} from '../../packages/engine/src/runtime/expressions.js';
import { legalCardTargets, drive } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { clone, type Effect } from '../../packages/engine/src/runtime/model.js';
import type { CardKind } from '../../packages/contracts/src/game.js';
export interface Case {
  id: string;
  faq: number[];
  title: string;
  run: () => void;
}
export const cases: Case[] = [];
export function check(id: string, faq: number[], title: string, run: () => void) {
  cases.push({ id, faq, title, run });
}
export const effects = (l: Lab, ...effects: Effect[]) =>
  settle(
    l.pack,
    l.state,
    effects.map((effect) => ({ effect, env: {} })),
  );
export function cards(l: Lab, entries: [string, CardKind][], picks: string[] = []) {
  l.state.placements = entries.map(([target, kind], i) => {
    const id = `test-card-${i}`;
    l.state.cards.push({
      id,
      owner: i === 0 ? 'mastermind' : 'p0',
      kind,
      once: false,
      status: 'set',
    });
    return { card: id, target };
  });
  phase(l, 'card-resolution');
  drain(l, picks);
}

check('death-counters', [40], '死亡保留所有指示物', () => {
  const l = lab();
  const c = l.state.characters.a!;
  c.counters.paranoia = 2;
  c.counters.hope = 1;
  effects(l, { op: 'kill', target: 'a' });
  assert.equal(c.status, 'dead');
  assert.equal(c.counters.paranoia, 2);
  assert.equal(c.counters.hope, 1);
});
check('dead-targets', [41, 57, 61], '尸体不接受普通行动与活人选择', () => {
  const l = lab();
  l.state.characters.a!.status = 'dead';
  for (const actor of ['mastermind', 'p0'] as const)
    assert.ok(!legalCardTargets(l.state, actor).includes('a'));
  assert.ok(!select(l.pack, l.state, { kind: 'alive' }, {}).includes('a'));
});
check('board-cards', [42, 371], '可对四版图盖普通牌；远方不是版图', () => {
  const l = lab();
  for (const actor of ['mastermind', 'p0'] as const) {
    const targets = legalCardTargets(l.state, actor);
    for (const b of ['hospital', 'shrine', 'city', 'school']) assert.ok(targets.includes(b));
    assert.ok(!targets.includes('far'));
  }
});
check(
  'effective-hope-despair',
  [83, 85, 217, 284, 417, 420, 467],
  '希望绝望按用途计数，密谋不为负',
  () => {
    const l = lab('LL');
    const c = l.state.characters.a!;
    c.counters.paranoia = 2;
    c.counters.despair = 1;
    assert.equal(effective(l.state, 'a', 'paranoia'), 3);
    assert.equal(effective(l.state, 'a', 'intrigue'), 1);
    c.counters.hope = 2;
    assert.equal(effective(l.state, 'a', 'intrigue'), 0);
    assert.equal(effective(l.state, 'a', 'goodwill'), 2);
  },
);
check('no-board-special-counters', [71, 407], '版图不存放希望绝望', () => {
  const l = lab();
  for (const counter of ['hope', 'despair'] as const)
    effects(l, { op: 'counter', target: 'school', counter, amount: 1 });
  assert.equal(l.state.boards.school, 0);
});
check(
  'raw-ai-counters',
  [76, 77, 411, 412],
  'AI 事件只按实体指示物总数，不重复计算希望绝望',
  () => {
    for (const [counter, n, special, expected] of [
      ['intrigue', 3, 'hope', true],
      ['paranoia', 2, 'hope', false],
      ['paranoia', 2, 'despair', false],
    ] as const) {
      const l = lab();
      const c = character(l, 'a', 'AI', '主谋', 'city');
      c.counters[counter] = n;
      c.counters[special] = 1;
      l.state.setup.incidents = [{ day: 1, name: '自杀', culprit: 'a' }];
      phase(l, 'incident');
      assert.equal(l.state.incidents.length > 0, expected);
    }
  },
);
check(
  'refusal-modes',
  [32, 33, 34, 43, 78, 413],
  '拒绝只控制友好请求，不妨碍放友好；绝望可改变妹妹',
  () => {
    const l = lab();
    for (const [identity, mode] of [
      ['平民', 'none'],
      ['杀手', 'optional'],
      ['邪教徒', 'mandatory'],
    ] as const) {
      l.state.characters.a!.identity = identity;
      assert.equal(refusal(l.pack, l.state, 'a'), mode);
      effects(l, { op: 'counter', target: 'a', counter: 'goodwill', amount: 1 });
    }
    assert.equal(l.state.characters.a!.counters.goodwill, 3);
    character(l, 'a', '妹妹');
    l.state.characters.a!.counters.despair = 1;
    assert.equal(refusal(l.pack, l.state, 'a'), 'mandatory');
  },
);
check('puppet-refusal', [2, 3], '傀儡之线将必拒绝改为可选拒绝，含绝望', () => {
  const l = lab('AHR');
  l.state.setup.x = ['傀儡之线'];
  l.state.characters.a!.identity = '强迫症';
  assert.equal(refusal(l.pack, l.state, 'a'), 'optional');
  l.state.characters.a!.counters.despair = 1;
  assert.equal(refusal(l.pack, l.state, 'a'), 'optional');
});
check('immortal-guard', [31, 107], '不死先于护卫，不消耗护卫', () => {
  const l = lab();
  l.state.characters.a!.identity = '时间旅者';
  l.state.characters.a!.counters.guard = 1;
  effects(l, { op: 'kill', target: 'a' });
  assert.equal(l.state.characters.a!.status, 'alive');
  assert.equal(l.state.characters.a!.counters.guard, 1);
});
check('servant-multikill', [108, 189, 190], '从者同批替代与自身死亡请求分别消耗护卫', () => {
  for (const guard of [0, 1, 2]) {
    const l = lab();
    character(l, 'a', '从者', '平民', 'school').counters.guard = guard;
    character(l, 'b', '大小姐', '平民', 'school');
    effects(l, { op: 'kill', target: 'a' }, { op: 'kill', target: 'b' });
    assert.equal(l.state.characters.b!.status, 'alive');
    assert.equal(l.state.characters.a!.status, guard < 2 ? 'dead' : 'alive');
    assert.equal(l.state.characters.a!.counters.guard, 0);
  }
});
check('servant-immortal-target', [187, 430], '不死大小姐不产生替代死亡', () => {
  for (const immortal of [false, true]) {
    const l = lab();
    character(l, 'a', '从者', '杀人狂', 'school');
    character(l, 'b', '大小姐', immortal ? '时间旅者' : '平民', 'school');
    effects(l, { op: 'kill', target: 'b' });
    assert.equal(l.state.characters.a!.status, immortal ? 'alive' : 'dead');
    assert.equal(l.state.characters.b!.status, 'alive');
  }
});
check('servant-follow', [188, 191, 431], '从者跟随特性对象，忽略自身禁止移动牌', () => {
  const l = lab();
  character(l, 'a', '从者', '平民', 'school');
  character(l, 'b', '大小姐', '平民', 'school');
  cards(l, [
    ['a', 'block-movement'],
    ['b', 'horizontal'],
  ]);
  assert.equal(l.state.characters.a!.area, 'city');
  assert.equal(l.state.characters.b!.area, 'city');
});
check('servant-batch-move', [193, 273], '同时移动从者忽略自己的目的地，跟随大小姐', () => {
  const l = lab();
  character(l, 'a', '从者', '平民', 'school');
  character(l, 'b', '大小姐', '平民', 'school');
  effects(
    l,
    { op: 'move', target: 'a', area: 'hospital' },
    { op: 'move', target: 'b', area: 'city' },
  );
  assert.equal(l.state.characters.a!.area, 'city');
});
check('remove-not-move', [194, 264], '移除幻想不会带走从者，附着诅咒一起移除', () => {
  const l = lab('HSA');
  character(l, 'a', '从者', '平民', 'shrine').flags.protect = 'b';
  character(l, 'b', '幻想');
  l.state.curses = [{ id: 'q', target: 'b' }];
  effects(l, { op: 'remove', target: 'b' });
  assert.equal(l.state.characters.a!.area, 'shrine');
  assert.equal(l.state.characters.a!.status, 'alive');
  assert.deepEqual(l.state.curses, []);
});
check(
  'move-restrictions',
  [58, 67, 234, 235, 258, 268],
  '移动不能进入禁行区域，可选择原地或禁止目的地并停留',
  () => {
    const l = lab();
    character(l, 'a', '巫女');
    effects(l, { op: 'move', target: 'a', area: 'city' });
    assert.equal(l.state.characters.a!.area, 'shrine');
    effects(l, { op: 'move', target: 'a', area: 'shrine' });
    assert.equal(l.state.characters.a!.area, 'shrine');
  },
);
check('move-composition', [44, 45, 46, 102], '移动先于计数，巫女两张移动组合为禁行斜向', () => {
  const l = lab();
  character(l, 'a', '巫女');
  cards(l, [
    ['a', 'horizontal'],
    ['a', 'vertical'],
  ]);
  assert.equal(l.state.characters.a!.area, 'shrine');
  const p = lab();
  character(p, 'a', '住院患者');
  character(p, 'b', '医生').counters.goodwill = 1;
  cards(p, [
    ['a', 'horizontal'],
    ['b', 'goodwill+2'],
  ]);
  assert.equal(p.state.characters.a!.area, 'hospital');
  assert.equal(p.state.characters.b!.counters.goodwill, 3);
});
check('far-movement', [366], '远方普通移动牌无效，同在远方可互相选择', () => {
  const l = lab();
  character(l, 'a', 'UP主');
  character(l, 'b', '男学生', '平民', 'far');
  cards(l, [['a', 'horizontal']]);
  assert.equal(l.state.characters.a!.area, 'far');
  assert.equal(destination('far', ['horizontal', 'vertical']), 'far');
  assert.deepEqual(
    select(
      l.pack,
      l.state,
      { kind: 'alive', where: { cmp: 'eq', left: { field: 'area', target: '$it' }, right: 'far' } },
      {},
    ),
    ['a', 'b'],
  );
});
check('illusion-move-counters', [167, 168], '幻想先移动再承受移动后版图的计数牌', () => {
  for (const destinationCounter of [false, true]) {
    const l = lab();
    character(l, 'a', '幻想', '平民', 'shrine');
    cards(l, [
      ['shrine', 'vertical'],
      [destinationCounter ? 'school' : 'shrine', 'goodwill+1'],
    ]);
    assert.equal(l.state.characters.a!.area, 'school');
    assert.equal(l.state.characters.a!.counters.goodwill, destinationCounter ? 1 : 0);
  }
});
check('illusion-board-block', [169], '时间旅者幻想不能无视版图上的友好禁止', () => {
  const l = lab();
  character(l, 'a', '幻想', '时间旅者', 'shrine');
  cards(l, [
    ['shrine', 'block-goodwill'],
    ['shrine', 'goodwill+1'],
  ]);
  assert.equal(l.state.characters.a!.counters.goodwill, 0);
});
check('illusion-opponent-card', [173], '预言家幻想仍受版图行动牌作用', () => {
  const l = lab('MZ');
  character(l, 'a', '幻想', '预言家');
  cards(l, [['shrine', 'goodwill+1']]);
  assert.equal(l.state.characters.a!.counters.goodwill, 1);
});
check('no-special-block', [72, 73, 408], '禁止友好和禁止密谋不能禁止希望绝望', () => {
  for (const [special, block, counter] of [
    ['hope+1', 'block-goodwill', 'hope'],
    ['despair+1', 'block-intrigue', 'despair'],
  ] as const) {
    const l = lab();
    cards(l, [
      ['a', special],
      ['a', block],
    ]);
    assert.equal(l.state.characters.a!.counters[counter], 1);
  }
});
check('addition-before-subtraction', [48], '行动牌加减顺序在零值仍正确', () => {
  const l = lab();
  cards(l, [
    ['a', 'paranoia-1'],
    ['a', 'paranoia+1'],
  ]);
  assert.equal(l.state.characters.a!.counters.paranoia, 0);
});
check('death-reveal-ninja', [160, 339], '尸体忍者不能谎报身份', () => {
  const l = lab('MZ');
  character(l, 'a', '男学生', '忍者').status = 'dead';
  const r = effects(l, { op: 'reveal-identity', target: 'a' });
  assert.ok(!r.followChoices?.length);
  assert.equal(l.state.observations.protagonists.at(-1)!.data.identity, '忍者');
});
check(
  'copycat-reveal',
  [7, 181, 182, 183, 184, 437, 469],
  '模仿犯报告其他所有同身份存活角色，排除自己、尸体和未登场',
  () => {
    for (const alive of [false, true]) {
      const l = lab();
      character(l, 'a', '模仿犯', '主谋');
      character(l, 'b', '男学生', '主谋').status = alive ? 'alive' : 'dead';
      character(l, 'c', '神灵', '主谋').status = 'absent';
      character(l, 'd', '职员', '主谋');
      effects(l, { op: 'same-identity', target: 'a' });
      assert.deepEqual(
        l.state.observations.protagonists.at(-1)!.data.characters,
        alive ? ['b', 'd'] : ['d'],
      );
      l.state.characters.d!.status = 'removed';
      l.state.characters.b!.status = 'dead';
      effects(l, { op: 'same-identity', target: 'a' });
      assert.deepEqual(l.state.observations.protagonists.at(-1)!.data.characters, []);
    }
  },
);
check('attributes', [110, 120, 142, 376], 'AI黑猫无性别、神灵双性别、UP主学生男性', () => {
  const l = lab();
  for (const who of ['AI', '黑猫']) {
    const a = l.pack.characters[who]!.attributes;
    assert.ok(
      !a.includes('男性') && !a.includes('女性') && !a.includes('少年') && !a.includes('少女'),
    );
  }
  assert.ok(l.pack.characters['神灵']!.attributes.includes('男性'));
  assert.ok(l.pack.characters['神灵']!.attributes.includes('女性'));
  assert.ok(l.pack.characters['UP主']!.attributes.includes('学生'));
  assert.ok(l.pack.characters['UP主']!.attributes.includes('男性'));
});
check('nurse-unrefusable', [74, 116, 409], '护士绝望/必定无视不能拒绝自身能力', () => {
  const l = lab();
  character(l, 'a', '护士', '邪教徒', 'school').counters.goodwill = 2;
  l.state.characters.a!.counters.despair = 1;
  character(l, 'b', '男学生', '平民', 'school').counters.paranoia = 2;
  ability(l, 'a', 'nurse', { target: 'b' });
  assert.equal(l.state.characters.b!.counters.paranoia, 1);
  assert.ok(!l.state.observations.protagonists.some((o) => o.type === 'refused'));
});
check(
  'scholar-clear',
  [80, 166, 415, 447],
  '学者移除包括希望绝望护卫全部计数，木偶不再触发',
  () => {
    const l = lab('AHR');
    character(l, 'a', '学者', '提线木偶');
    Object.assign(l.state.characters.a!.counters, { goodwill: 3, hope: 1, despair: 1, guard: 1 });
    ability(l, 'a', 'scholar-clear');
    drain(l, ['up']);
    assert.ok(Object.values(l.state.characters.a!.counters).every((n) => n === 0));
    assert.equal(l.state.characters.a!.status, 'alive');
  },
);
check('counter-transfer', [81, 82, 159, 174, 416, 418], '鉴别员与御神木可转移希望绝望护卫', () => {
  for (const counter of ['hope', 'despair', 'guard'] as const) {
    const l = lab();
    l.state.characters.a!.counters[counter] = 1;
    effects(l, { op: 'transfer', from: 'a', to: 'b', counter });
    assert.equal(l.state.characters.a!.counters[counter], 0);
    assert.equal(l.state.characters.b!.counters[counter], 1);
  }
});
check('transfer-no-intrigue', [155], '转校生没有密谋时不会凭空增加友好', () => {
  const l = lab();
  character(l, 'a', '转校生').counters.goodwill = 2;
  character(l, 'b', '男学生', '平民', 'school');
  ability(l, 'a', 'transfer-student', { target: 'b' });
  assert.equal(l.state.characters.b!.counters.goodwill, 0);
});
check('reveal-absent-culprit', [156], '神灵事件揭示读取剧本中的未登场当事人', () => {
  const l = lab();
  l.state.characters.b!.status = 'absent';
  l.state.setup.incidents = [{ day: 3, name: '自杀', culprit: 'b' }];
  effects(l, { op: 'reveal-culprit', day: '3' });
  assert.equal(l.state.observations.protagonists.at(-1)!.data.culprit, 'b');
});
check('grant-dedup', [88], '多个希望绝望获得条件不重复发牌', () => {
  const l = lab();
  for (let i = 0; i < 5; i++) {
    grantCard(l.state, 'p0', 'hope+1');
    grantCard(l.state, 'mastermind', 'despair+1');
  }
  assert.equal(l.state.cards.filter((c) => c.owner === 'p0' && c.kind === 'hope+1').length, 1);
  assert.equal(
    l.state.cards.filter((c) => c.owner === 'mastermind' && c.kind === 'despair+1').length,
    1,
  );
});
check('hsa-victims', [248, 249, 252, 253, 265], 'HSA版图密谋作为尸体可移动复活和揭示', () => {
  const l = lab('HSA');
  l.state.boards.hospital = 2;
  assert.equal(select(l.pack, l.state, { kind: 'dead' }, {}).length, 2);
  effects(l, { op: 'reveal-identity', target: 'victim:hospital:0' });
  assert.equal(l.state.observations.protagonists.at(-1)!.data.identity, '平民');
  effects(l, { op: 'move-corpse', target: 'victim:hospital:0', area: 'school' });
  assert.equal(l.state.boards.hospital, 1);
  assert.equal(l.state.boards.school, 1);
  effects(l, { op: 'revive', target: 'victim:school:0' });
  assert.equal(l.state.boards.school, 0);
});
check('curse-removal', [237, 239, 240, 242], '附身诅咒跟随角色；尸体/不死的诅咒归还版图', () => {
  for (const status of ['alive', 'dead', 'immortal'] as const) {
    const l = lab('HSA');
    character(l, 'a', '男学生', status === 'immortal' ? '吸血鬼' : '平民', 'city').status =
      status === 'dead' ? 'dead' : 'alive';
    l.state.curses = [
      { id: 'c1', target: 'a' },
      { id: 'c2', target: 'a' },
    ];
    phase(l, 'day-end');
    drain(l);
    assert.ok(l.state.curses!.every((c) => c.target === 'city'));
    assert.equal(l.state.characters.a!.status, status === 'immortal' ? 'alive' : 'dead');
  }
});
check('curse-unlimited', [244, 245], '新增诅咒不挪用旧牌，无五张上限', () => {
  const l = lab('HSA');
  for (let i = 0; i < 7; i++) effects(l, { op: 'curse', target: 'school' });
  assert.equal(l.state.curses!.length, 7);
  assert.equal(new Set(l.state.curses!.map((c) => c.id)).size, 7);
});
check('virus-reversible', [30, 213], '妄想扩大病毒是动态身份，不安下降恢复平民', () => {
  const l = lab('MZ');
  l.state.setup.x = ['妄想扩大病毒'];
  l.state.characters.a!.counters.paranoia = 3;
  recompute(l.state);
  assert.equal(l.state.characters.a!.identity, '杀人狂');
  l.state.characters.a!.counters.paranoia = 2;
  recompute(l.state);
  assert.equal(l.state.characters.a!.identity, '平民');
});
check(
  'causal-identity',
  [198, 317, 318, 319, 320, 321, 428],
  '因果之绊EX覆盖运行身份及拒绝，不保留亲友身份',
  () => {
    for (const identity of ['平民', '传谣人', '魔女', '亲友']) {
      const l = lab('MZ');
      l.state.setup.y = '因果之绊';
      character(l, 'a', '职员', identity).flags['causal-ex'] = 'yes';
      recompute(l.state);
      assert.equal(l.state.characters.a!.identity, '关键人物');
      assert.equal(refusal(l.pack, l.state, 'a'), 'none');
      effects(l, { op: 'reveal-identity', target: 'a' });
      assert.equal(l.state.observations.protagonists.at(-1)!.data.identity, '关键人物');
    }
  },
);
check('world-current-reveal', [8, 439], '表里身份公开按当前世界，而非死亡时世界', () => {
  const l = lab('AHR');
  character(l, 'a', '职员', '关键人物').status = 'dead';
  l.state.setup.characters.find((c) => c.id === 'a')!.reverseIdentity = '主谋';
  l.state.ex = 1;
  recompute(l.state);
  assert.equal(l.state.characters.a!.identity, '主谋');
  l.state.ex = 0;
  recompute(l.state);
  effects(l, { op: 'reveal-identity', target: 'a' });
  assert.equal(l.state.observations.protagonists.at(-1)!.data.identity, '关键人物');
});
check('world-ex-independent', [9, 440], '学者EX修改与一天多次世界移动分别累计', () => {
  const l = lab('AHR');
  effects(l, { op: 'ex', amount: 1 }, { op: 'world-move' }, { op: 'world-move' });
  assert.equal(l.state.ex, 1);
  phase(l, 'day-end');
  drain(l);
  assert.equal(l.state.ex, 2);
});
check(
  'death-absence',
  [123, 124, 298],
  '未登场强迫症不能发生事件，时间旅者和侦探不能用能力',
  () => {
    const l = lab('MC');
    character(l, 'a', '神灵', '强迫症').status = 'absent';
    l.state.setup.incidents = [{ day: 1, name: '自杀', culprit: 'a' }];
    phase(l, 'incident');
    assert.equal(l.state.incidents.length, 0);
    for (const identity of ['时间旅者', '侦探']) {
      const x = lab('MC');
      character(x, 'a', '神灵', identity).status = 'absent';
      phase(x, 'mastermind-abilities');
      assert.ok(!x.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
    }
  },
);
check('projection-arrival', [121], '未登场神灵与转校生不泄露给主人公', () => {
  const l = lab();
  character(l, 'a', '神灵').status = 'absent';
  character(l, 'b', '转校生').status = 'absent';
  assert.ok(!project(l.state, 'p0').characters.some((c) => ['a', 'b'].includes(c.id)));
  assert.ok(project(l.state, 'mastermind').characters.some((c) => c.id === 'a'));
});
check('traitor-hope', [278, 279, 280, 464], '最终计划希望暂时禁用背叛者，移除希望恢复', () => {
  const l = lab('LL');
  l.state.setup.y = '最终计划';
  l.state.setup.x = ['真正的怪物', '神话收集者'];
  l.state.ll = {
    roles: { p0: 'A', p1: 'B', p2: 'C' },
    communicated: [],
    died: [],
    cAnswered: false,
    finalTraitorsDisabled: false,
  };
  l.state.characters.a!.identity = '关键人物';
  l.state.characters.a!.counters.hope = 1;
  assert.deepEqual(traitors(l.state), []);
  l.state.characters.a!.counters.hope = 0;
  assert.deepEqual(traitors(l.state), ['p0', 'p1']);
});
