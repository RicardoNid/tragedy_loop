import assert from 'node:assert/strict';
import { check, effects, cards } from './cases.js';
import { lab, character, phase, act, ability, drain, type Lab } from './harness.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { clone, type Effect } from '../../packages/engine/src/runtime/model.js';
import { drive, legalCardTargets, cardCount } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { effective, recompute } from '../../packages/engine/src/runtime/expressions.js';
function good(l: Lab, id: string, threshold: number, choices?: Record<string, string>) {
  const c = l.state.characters[id]!;
  const a = l.pack.characters[c.character]!.abilities.find((a) => a.threshold === threshold);
  assert.ok(a);
  return ability(l, id, a.id, choices);
}
function incident(l: Lab, name: string, culprit = 'a') {
  l.state.setup.incidents = [{ day: l.state.day, name, culprit }];
  phase(l, 'incident');
}
function batch(l: Lab, effects: Effect[]) {
  const s = l.state;
  s.pending = null;
  s.phase = 'incident';
  s.phaseEntered = true;
  s.frames = [
    {
      id: 'faq-batch',
      source: 'faq',
      owner: '',
      actor: 'mastermind',
      kind: 'mandatory',
      steps: [{ effects }],
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    },
  ];
  s.batch = null;
  drive(l.pack, s, 10000);
}

check(
  'nurse-effective-target',
  [83, 217, 417],
  '护士可以减少1不安1绝望男学生的不安，但不移除绝望',
  () => {
    const l = lab();
    character(l, 'a', '护士', '平民', 'school').counters.goodwill = 2;
    const b = character(l, 'b', '男学生');
    b.counters.paranoia = 1;
    b.counters.despair = 1;
    good(l, 'a', 2, { target: 'b' });
    assert.equal(l.state.characters.b!.counters.paranoia, 0);
    assert.equal(l.state.characters.b!.counters.despair, 1);
  },
);
check('lover-despair', [85, 420], '求爱者2不安1绝望可杀害主人公', () => {
  const l = lab();
  character(l, 'a', '男学生', '求爱者').counters.paranoia = 2;
  l.state.characters.a!.counters.despair = 1;
  phase(l, 'day-end');
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
  act(l, l.state.pending!.options.find((c) => c.kind === 'ability' && c.owner === 'a')!);
  assert.ok(l.state.protagonistDead);
});
check('doctor-mastermind', [54, 75, 103, 410], '医生的必定无视不阻止剧作家使用2友好能力', () => {
  const l = lab();
  character(l, 'a', '医生', '邪教徒', 'school').counters.goodwill = 2;
  l.state.characters.a!.counters.despair = 1;
  character(l, 'b', '男学生');
  phase(l, 'mastermind-abilities');
  const a = l.state.pending!.options.find(
    (c) => c.kind === 'ability' && c.owner === 'a' && c.ability === 'doctor-counter',
  );
  assert.ok(a?.kind === 'ability');
  act(l, { ...a, choices: { target: 'b', direction: 'add' } });
  assert.equal(l.state.characters.b!.counters.paranoia, 1);
  phase(l, 'protagonist-abilities');
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
});
check('doctor-release-refusal', [104], '医生释放住院患者必须成功通过拒绝', () => {
  for (const refuse of [false, true]) {
    const l = lab();
    character(l, 'a', '医生', '杀手').counters.goodwill = 3;
    character(l, 'b', '住院患者');
    good(l, 'a', 3);
    act(l, { kind: 'refuse', refuse });
    effects(l, { op: 'move', target: 'b', area: 'city' });
    assert.equal(l.state.characters.b!.area, refuse ? 'hospital' : 'city');
  }
});
check('reused-after-revival', [146], '同日死亡复活不重置能力次数', () => {
  const l = lab();
  character(l, 'a', '男学生').counters.goodwill = 2;
  character(l, 'b', '女学生');
  good(l, 'a', 2, { target: 'b' });
  effects(l, { op: 'kill', target: 'a' }, { op: 'revive', target: 'a' });
  effects(l, { op: 'revive', target: 'a' });
  l.state.day = 1;
  l.state.captain = 'p0';
  phase(l, 'protagonist-abilities');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
});
check('soldier-persistent', [148], '军人保护在角色死亡后保持', () => {
  const l = lab();
  character(l, 'a', '军人').counters.goodwill = 5;
  good(l, 'a', 5);
  effects(l, { op: 'kill', target: 'a' });
  effects(l, { op: 'protagonist-death' });
  assert.equal(l.state.characters.a!.status, 'dead');
  assert.equal(l.state.protagonistDead, false);
});
check('alien-empty-revive', [147], '无同区尸体不能发动异界人复活', () => {
  const l = lab();
  character(l, 'a', '异界人').counters.goodwill = 5;
  phase(l, 'protagonist-abilities');
  assert.ok(
    !l.state.pending?.options.some((c) => c.kind === 'ability' && c.ability === 'alien-revive'),
  );
});
check('class-empty-recover', [105], '班长无已用轮限牌不能空发', () => {
  const l = lab();
  character(l, 'a', '班长').counters.goodwill = 2;
  phase(l, 'protagonist-abilities');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
});
check('class-puppet-despair', [10, 106, 441], '傀儡班长允许剧作家收回已用绝望牌', () => {
  const l = lab('AHR');
  l.state.setup.x = ['傀儡之线'];
  character(l, 'a', '班长', '强迫症').counters.goodwill = 2;
  l.state.cards.push({
    id: 'test-despair',
    owner: 'mastermind',
    kind: 'despair+1',
    once: true,
    status: 'used',
  });
  phase(l, 'mastermind-abilities');
  const a = l.state.pending?.options.find((c) => c.kind === 'ability' && c.owner === 'a');
  assert.ok(a?.kind === 'ability');
  act(l, { ...a, choices: { card: 'test-despair' } });
  drain(l);
  assert.equal(l.state.cards.find((c) => c.id === 'test-despair')!.status, 'hand');
});
check('appraiser-empty', [157, 158], '鉴别员允许无指示物目标；有指示物则必须移动', () => {
  const l = lab();
  character(l, 'a', '鉴别员', '平民', 'school').counters.goodwill = 2;
  character(l, 'b', '男学生');
  character(l, 'c', '女学生');
  good(l, 'a', 2, { from: 'b', to: 'c' });
  drain(l);
  assert.equal(l.state.characters.b!.counters.goodwill, 0);
  const x = lab();
  character(x, 'a', '鉴别员', '平民', 'school').counters.goodwill = 2;
  character(x, 'b', '男学生').counters.guard = 1;
  character(x, 'c', '女学生');
  good(x, 'a', 2, { from: 'b', to: 'c' });
  drain(x);
  assert.equal(x.state.characters.b!.counters.guard, 0);
  assert.equal(x.state.characters.c!.counters.guard, 1);
});
check('puppet-guard', [11, 446], '提线木偶刑警先得到护卫，再免死并世界移动', () => {
  const l = lab('AHR');
  character(l, 'a', '刑警', '提线木偶').counters.goodwill = 5;
  good(l, 'a', 5, { target: 'a' });
  drain(l);
  assert.equal(l.state.characters.a!.status, 'alive');
  assert.equal(l.state.characters.a!.counters.guard, 0);
  assert.ok(l.state.flags['world-moved'] === 'yes' || l.state.ex === 1);
});
check('puppet-removed', [12, 172, 448], '移除幻想后不触发提线木偶或密钥的友好后续', () => {
  for (const [module, identity] of [
    ['AHR', '提线木偶'],
    ['LL', '密钥'],
  ] as const) {
    const l = lab(module);
    character(l, 'a', '幻想', identity).counters.goodwill = 4;
    l.state.characters.a!.counters.paranoia = 1;
    good(l, 'a', 4);
    drain(l);
    assert.equal(l.state.characters.a!.status, 'removed');
    assert.equal(l.state.flags['world-moved'], undefined);
    assert.ok(!l.state.delayed?.length);
  }
});
check('fairytale-transfer', [13, 450], '童谣鉴别员杀死移动指示物的双方', () => {
  const l = lab('AHR');
  character(l, 'a', '鉴别员', '童谣', 'school').counters.goodwill = 2;
  character(l, 'b', '男学生').counters.paranoia = 1;
  character(l, 'c', '女学生');
  good(l, 'a', 2, { from: 'b', to: 'c', counter: 'paranoia' });
  drain(l);
  assert.equal(l.state.characters.b!.status, 'dead');
  assert.equal(l.state.characters.c!.status, 'dead');
});
check('fairytale-servant', [15, 452], '童谣从者保护的目标死亡由从者自己替代', () => {
  const l = lab('AHR');
  character(l, 'a', '从者', '童谣', 'school').counters.goodwill = 4;
  character(l, 'b', '男学生');
  good(l, 'a', 4, { target: 'b' });
  drain(l);
  assert.equal(l.state.characters.a!.status, 'dead');
  assert.equal(l.state.characters.b!.status, 'alive');
});
check('fairytale-no-target', [449], '无指定对象的童谣职员能力不杀害角色', () => {
  const l = lab('AHR');
  character(l, 'a', '职员', '童谣').counters.goodwill = 3;
  good(l, 'a', 3);
  drain(l);
  assert.ok(Object.values(l.state.characters).every((c) => c.status === 'alive'));
});
check(
  'henchman-no-incident',
  [19, 117, 336, 445, 458],
  '禁止事件优先强迫症、预言家与次元转换必发',
  () => {
    for (const [module, name] of [
      ['MZ', '自杀'],
      ['AHR', '次元转换'],
    ] as const) {
      const l = lab(module);
      character(l, 'a', '手下', '强迫症', 'school').flags['no-incidents'] = 'yes';
      incident(l, name);
      assert.equal(l.state.incidents.length, 0);
    }
    const l = lab('MZ');
    character(l, 'a', '手下', '强迫症', 'school');
    character(l, 'b', '女学生', '预言家');
    incident(l, '自杀');
    assert.equal(l.state.incidents.length, 0);
  },
);
check('prophet-self', [337, 338], '预言家不阻止自己的事件，也不阻止传谣人放不安', () => {
  const l = lab('MZ');
  character(l, 'a', '男学生', '预言家').counters.paranoia = 2;
  incident(l, '自杀');
  assert.equal(l.state.incidents.length, 1);
  const x = lab('MZ');
  character(x, 'a', '男学生', '传谣人');
  character(x, 'b', '女学生', '预言家');
  phase(x, 'mastermind-abilities');
  const a = x.state.pending!.options.find((c) => c.kind === 'ability' && c.owner === 'a');
  assert.ok(a?.kind === 'ability');
  act(x, { ...a, choices: { target: 'b' } });
  assert.equal(x.state.characters.b!.counters.paranoia, 1);
});
check('black-cat-events', [143, 144, 145, 304], '黑猫事件无效果，但MC事件发生和EX正常记录', () => {
  for (const [name, ex] of [
    ['银色子弹', 1],
    ['猎奇杀人', 1],
    ['封锁', 1],
  ] as const) {
    const l = lab('MC');
    character(l, 'a', '黑猫').counters.paranoia = 3;
    incident(l, name);
    assert.equal(l.state.incidents.length, 1);
    assert.equal(l.state.ex, ex);
    assert.ok(l.state.observations.protagonists.some((o) => o.type === 'no-effect'));
  }
});
check('hospital-batch', [228, 229, 230], '医院事故按密谋分级，同批死亡不公开关键人物身份', () => {
  for (const intrigue of [0, 1, 2]) {
    const l = lab();
    character(l, 'a', '男学生', '平民', 'school').counters.paranoia = 2;
    character(l, 'b', '女学生', '关键人物', 'hospital');
    l.state.boards.hospital = intrigue;
    incident(l, '医院事故');
    assert.equal(l.state.incidents.length, 1);
    assert.equal(l.state.characters.b!.status, intrigue ? 'dead' : 'alive');
    assert.equal(l.state.protagonistDead, intrigue === 2);
    assert.ok(!l.state.observations.protagonists.some((o) => o.type === 'identity'));
  }
});
check(
  'disappearance-stationary',
  [235, 236, 308],
  '失踪原地不动不公开当事人，也不创建次日定身',
  () => {
    const l = lab('MC');
    character(l, 'a', '男学生', '平民', 'school').counters.paranoia = 2;
    incident(l, '可疑信件');
    drain(l, ['a', 'school']);
    assert.equal(l.state.characters.a!.area, 'school');
    assert.ok(
      !l.state.delayed?.some((t) => t.effects.some((e) => e.op === 'flag' && e.key === 'immobile')),
    );
  },
);
check('corpse-love', [220, 257], '两恋人同时死亡不加不安；一心上人死亡为两个求爱者加6', () => {
  const l = lab();
  character(l, 'a', '男学生', '求爱者');
  character(l, 'b', '女学生', '心上人');
  batch(l, [
    { op: 'kill', target: 'a' },
    { op: 'kill', target: 'b' },
  ]);
  assert.equal(l.state.characters.a!.counters.paranoia, 0);
  assert.equal(l.state.characters.b!.counters.paranoia, 0);
  const x = lab();
  character(x, 'a', '男学生', '求爱者');
  character(x, 'b', '女学生', '心上人');
  character(x, 'c', '医生', '求爱者');
  batch(x, [{ op: 'kill', target: 'b' }]);
  assert.equal(x.state.characters.a!.counters.paranoia, 6);
  assert.equal(x.state.characters.c!.counters.paranoia, 6);
});
check('key-friend-cleanup', [37, 218, 221], '关键人物触发轮回结束仍必须公开死亡亲友', () => {
  const l = lab();
  character(l, 'a', '男学生', '关键人物');
  character(l, 'b', '女学生', '亲友');
  batch(l, [
    { op: 'kill', target: 'a' },
    { op: 'kill', target: 'b' },
  ]);
  assert.ok(l.state.failed);
  assert.ok(
    l.state.observations.protagonists.some(
      (o) => o.type === 'identity' && o.data.identity === '亲友',
    ),
  );
});
check(
  'causal-previous',
  [84, 149, 171, 203, 215, 419],
  '因果线读取跨轮有效友好；转校生和替代临时工未登场排除',
  () => {
    const l = lab();
    l.state.setup.x = ['因果线'];
    character(l, 'a', '男学生');
    character(l, 'b', '幻想');
    character(l, 'c', '转校生');
    l.state.setup.characters.find((c) => c.id === 'c')!.enterDay = 2;
    character(l, 'd', '临时工？');
    l.state.characters.a!.counters.hope = 1;
    l.state.characters.a!.status = 'dead';
    l.state.characters.b!.counters.goodwill = 1;
    l.state.characters.b!.status = 'removed';
    l.state.characters.c!.counters.goodwill = 1;
    l.state.characters.d!.counters.goodwill = 1;
    l.state.previousLoop = {
      characters: clone(l.state.characters),
      boards: clone(l.state.boards),
      ex: 0,
    };
    l.state.loop = 2;
    phase(l, 'discussion');
    act(l, { kind: 'continue' });
    drain(l);
    assert.equal(l.state.characters.a!.counters.paranoia, 2);
    assert.equal(l.state.characters.b!.counters.paranoia, 2);
    assert.equal(l.state.characters.c!.counters.paranoia, 0);
  },
);
check(
  'causal-ex-once',
  [150, 316, 323, 324],
  '因果之绊与诸神之骰同用只产生一次EX选择并排除未登场',
  () => {
    const l = lab('MZ');
    l.state.setup.y = '因果之绊';
    l.state.setup.x = ['诸神之骰'];
    character(l, 'a', '转校生');
    l.state.setup.characters.find((c) => c.id === 'a')!.enterDay = 2;
    character(l, 'b', '职员');
    l.state.characters.a!.status = l.state.characters.b!.status = 'dead';
    l.state.previousLoop = {
      characters: clone(l.state.characters),
      boards: clone(l.state.boards),
      ex: 0,
    };
    l.state.loop = 2;
    phase(l, 'discussion');
    act(l, { kind: 'continue' });
    drain(l);
    assert.equal(l.state.characters.b!.flags['causal-ex'], 'yes');
    assert.equal(l.state.characters.a!.flags['causal-ex'], undefined);
    assert.equal(Object.values(l.state.characters).filter((c) => c.flags['causal-ex']).length, 1);
  },
);
check('wm-low-ex', [382, 383], 'EX下降使当前阈值效果失效，未到日末不判4EX死亡', () => {
  const l = lab('WM');
  l.state.ex = 4;
  effects(l, { op: 'ex', amount: -1 });
  phase(l, 'day-end');
  drain(l);
  assert.equal(l.state.protagonistDead, false);
});
check('wm-ex-history', [387], '黄衣之王按曾经上升判断，不是当前EX', () => {
  const l = lab('WM');
  l.state.setup.y = '黄衣之王';
  effects(l, { op: 'ex', amount: 1 }, { op: 'ex', amount: -1 });
  assert.equal(l.state.ex, 0);
  /* use separate established batches for the witnessed increase */ effects(l, {
    op: 'ex',
    amount: 1,
  });
  effects(l, { op: 'ex', amount: -1 });
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
});
check('wm-refusal-retry', [380, 422], 'WM重复拒绝可重试，每次EX增加', () => {
  const l = lab('WM');
  character(l, 'a', '男学生', '平民').counters.goodwill = 2;
  l.state.characters.a!.counters.despair = 1;
  character(l, 'b', '女学生');
  good(l, 'a', 2, { target: 'b' });
  assert.equal(l.state.ex, 1);
  act(l, { kind: 'ability', owner: 'a', ability: 'student', choices: { target: 'b' } });
  assert.equal(l.state.ex, 2);
});
check('once-scheduled-incident', [403, 404, 459], '同名不同日事件各有本局首次发生记录', () => {
  const l = lab('WM');
  character(l, 'a', '男学生').counters.paranoia = 2;
  l.state.incidents = [{ loop: 1, day: 2, name: '灭绝之火', publicName: '灭绝之火', culprit: 'a' }];
  l.state.loop = 2;
  l.state.day = 3;
  incident(l, '灭绝之火');
  assert.equal(l.state.flags['first-occurrence'], 'yes');
  assert.equal(l.state.protagonistDead, true);
  const x = lab('WM');
  character(x, 'a', '男学生').counters.paranoia = 2;
  x.state.incidents = [{ loop: 1, day: 2, name: '灭绝之火', publicName: '灭绝之火', culprit: 'a' }];
  x.state.loop = 2;
  x.state.day = 2;
  incident(x, '灭绝之火');
  assert.equal(x.state.protagonistDead, false);
});
check('special-markers-absent', [90, 277, 424, 463], 'LL特殊胜利计入未登场与移除角色标记', () => {
  const l = lab('LL');
  l.state.setup.x = ['真正的怪物'];
  l.state.ll = {
    roles: { p0: 'A', p1: 'B', p2: 'C' },
    communicated: [],
    died: ['a', 'b', 'c', 'd', 'absent'],
    finalTraitorsDisabled: false,
  };
  l.state.characters.a!.status = 'removed';
  l.state.characters.b!.status = 'absent';
  phase(l, 'day-end');
  assert.equal(l.state.winner, 'p0');
});
check('sacrifice-batch', [392], '祭品同时杀害所有非不死角色和主人公', () => {
  const l = lab('WM');
  character(l, 'a', '男学生', '祭品').counters.paranoia = 3;
  l.state.characters.a!.counters.intrigue = 2;
  character(l, 'b', '女学生', '深潜者');
  character(l, 'c', '医生', '平民');
  phase(l, 'day-end');
  const a = l.state.pending?.options.find((c) => c.kind === 'ability' && c.owner === 'a');
  assert.ok(a);
  act(l, a);
  assert.ok(l.state.protagonistDead);
  assert.equal(l.state.characters.a!.status, 'alive');
  assert.equal(l.state.characters.c!.status, 'dead');
});
