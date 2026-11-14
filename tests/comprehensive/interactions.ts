import assert from 'node:assert/strict';
import { check, effects, cards } from './cases.js';
import { lab, character, phase, act, ability, drain, type Lab } from './harness.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { legalCardTargets, drive } from '../../packages/engine/src/runtime/engine.js';
function go(l: Lab, name: string, choices: Record<string, string> = {}) {
  const c = l.state.pending?.options.find((c) => c.kind === 'ability' && c.ability === name);
  assert.ok(c?.kind === 'ability', name);
  act(l, { ...c, choices });
}
function incident(l: Lab, name: string) {
  l.state.setup.incidents = [{ day: l.state.day, name, culprit: 'a' }];
  phase(l, 'incident');
}
check(
  'virtual-world',
  [1, 442, 443, 444],
  '虚幻世界只统计规则分配的在场强迫症，含尸体不含移除',
  () => {
    for (const [who, status, marked, ex, intrigue, hope, fail] of [
      ['模仿犯', 'alive', false, 1, 2, 0, false],
      ['男学生', 'alive', true, 3, 0, 1, true],
      ['幻想', 'removed', true, 0, 4, 1, false],
    ] as const) {
      const l = lab('AHR');
      l.state.setup.y = '虚幻世界';
      const c = character(l, 'a', who, '强迫症');
      c.status = status;
      c.counters.intrigue = intrigue;
      c.counters.hope = hope;
      if (marked) c.flags['y-obsessive'] = 'yes';
      l.state.ex = ex;
      phase(l, 'loop-end');
      assert.equal(l.state.failed, fail);
    }
  },
);
check('boss-ghost', [138, 261], '尸体大人物鬼魂不能把领地视作当前区域', () => {
  const l = lab('HSA');
  character(l, 'a', '大人物', '鬼魂', 'city').status = 'dead';
  l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
  character(l, 'b', '男学生', '平民', 'school');
  character(l, 'c', '医生', '平民', 'hospital');
  character(l, 'd', '女学生', '平民', 'hospital');
  phase(l, 'mastermind-abilities');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'territory'));
  assert.equal(l.state.characters.b!.counters.paranoia, 0);
});
check('living-zombie', [129, 266], '独处的局外人丧尸也计为丧尸，优势杀害自己', () => {
  const l = lab('HSA');
  character(l, 'a', '局外人', '丧尸', 'shrine');
  for (const c of ['b', 'c', 'd']) l.state.characters[c]!.area = 'hospital';
  phase(l, 'day-end');
  drain(l);
  assert.equal(l.state.characters.a!.status, 'dead');
});
check(
  'boss-killer-target',
  [133, 134, 224, 225],
  '大人物可从领地发动杀手，但不能被外部视作身处领地',
  () => {
    const l = lab();
    character(l, 'a', '大人物', '杀手', 'city');
    l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
    character(l, 'b', '女学生', '关键人物').counters.intrigue = 2;
    phase(l, 'day-end');
    act(l, { kind: 'select', value: 'territory' });
    go(l, 'killer-character', { target: 'b' });
    assert.equal(l.state.characters.b!.status, 'dead');
    const x = lab();
    character(x, 'a', '大人物', '关键人物', 'city').counters.intrigue = 2;
    x.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
    character(x, 'b', '男学生', '杀手');
    phase(x, 'day-end');
    assert.ok(
      !x.state.pending?.options.some(
        (c) => c.kind === 'ability' && c.owner === 'b' && c.ability === 'killer-character',
      ),
    );
  },
);
check('boss-incident', [136, 137, 231, 300, 301], '大人物事件作用于实际所在地而非领地', () => {
  const l = lab();
  character(l, 'a', '大人物', '强迫症', 'city');
  l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
  character(l, 'b', '男学生');
  character(l, 'c', '医生', '平民', 'hospital');
  character(l, 'd', '女学生', '平民', 'hospital');
  incident(l, '谋杀');
  assert.equal(l.state.characters.b!.status, 'alive');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'b'));
});
check(
  'ninja-setup-reveal',
  [334, 335],
  '活忍者可声明剧本的未登场身份，不可声明运行期派生身份',
  () => {
    const l = lab('MZ');
    character(l, 'a', '男学生', '忍者');
    character(l, 'b', '神灵', '主谋').status = 'absent';
    l.state.characters.c!.identity = '关键人物';
    const r = effects(l, { op: 'reveal-identity', target: 'a' });
    assert.ok(r.followChoices?.[0]!.options.includes('主谋'));
    assert.ok(!r.followChoices?.[0]!.options.includes('关键人物'));
  },
);
check(
  'forged-threshold',
  [346, 348],
  '伪造事件按实际事件的不安条件；公开阴谋不改成密谋条件',
  () => {
    const l = lab('MZ');
    character(l, 'a', '男学生').counters.intrigue = 5;
    l.state.setup.incidents = [{ day: 1, name: '伪造事件', publicName: '阴谋活动', culprit: 'a' }];
    phase(l, 'incident');
    assert.equal(l.state.incidents.length, 0);
    l.state.day = 1;
    l.state.characters.a!.counters.paranoia = 2;
    phase(l, 'incident');
    assert.equal(l.state.incidents.length, 1);
    assert.equal(l.state.protagonistDead, false);
  },
);
check(
  'ai-forged',
  [111, 112, 113, 115, 297, 350, 351, 460],
  'AI只调用公开事件效果；不存在的事件无效果，调用不记事件发生',
  () => {
    for (const [module, event] of [
      ['MZ', '不存在的事件'],
      ['MC', '封锁'],
      ['WM', '灭绝之火'],
      ['AHR', '奇点'],
    ] as const) {
      const l = lab(module);
      character(l, 'a', 'AI', '主谋').counters.goodwill = 3;
      l.state.characters.a!.counters.hope = 1;
      l.state.setup.incidents = [{ day: 3, name: '伪造事件', publicName: event, culprit: 'b' }];
      ability(l, 'a', 'ai', { incident: event });
      drain(l);
      assert.equal(l.state.incidents.length, 0);
      assert.equal(l.state.protagonistDead, false);
      assert.equal(l.state.flags['lockdown-area'], undefined);
    }
  },
);
check('event-no-self-murder', [232, 406], '谋杀可以指向不死角色，疯狂杀人也可以指向自己', () => {
  const l = lab();
  character(l, 'a', '男学生').counters.paranoia = 2;
  character(l, 'b', '女学生', '时间旅者');
  incident(l, '谋杀');
  drain(l, ['b']);
  assert.equal(l.state.characters.b!.status, 'alive');
  const x = lab('WM');
  character(x, 'a', '男学生').counters.paranoia = 2;
  incident(x, '疯狂杀人');
  assert.ok(x.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'a'));
});
check('broadcast-clamp', [233], '散播可从零友好角色移除，仍放置固定2友好', () => {
  const l = lab();
  character(l, 'a', '男学生').counters.paranoia = 2;
  incident(l, '散播');
  drain(l, ['b', 'c']);
  assert.equal(l.state.characters.b!.counters.goodwill, 0);
  assert.equal(l.state.characters.c!.counters.goodwill, 2);
});
check('break-incident', [342, 343], '破局排除尸体，允许零密谋活人', () => {
  const l = lab('MZ');
  character(l, 'a', '男学生').counters.paranoia = 2;
  l.state.characters.b!.status = 'dead';
  incident(l, '破局');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'b'));
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'c'));
  drain(l, ['c']);
  assert.equal(l.state.characters.c!.counters.intrigue, 0);
});
check('confession', [341], '自白公开角色及身份', () => {
  const l = lab('MZ');
  character(l, 'a', '男学生', '主谋').counters.paranoia = 2;
  incident(l, '自白');
  assert.ok(
    l.state.observations.protagonists.some(
      (o) => o.type === 'identity' && o.data.character === 'a' && o.data.identity === '主谋',
    ),
  );
});
check('classify-report', [312, 314], '绝密报告根据公开身份名判定，而不是角色真实身份', () => {
  const l = lab('MZ');
  l.state.setup.y = '绝密报告';
  character(l, 'a', '局外人', '忍者');
  l.state.revealedIdentities.push({ character: 'a', identity: '主谋', loop: 1 });
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
});
check('factor-corpse', [327, 328], 'X异因子不选尸体，不借大人物领地放密谋', () => {
  const l = lab('MZ');
  l.state.setup.x = ['X异因子'];
  character(l, 'a', '大人物', '不安定因子', 'city');
  l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
  phase(l, 'mastermind-abilities');
  go(l, 'factor-intrigue', { target: 'a' });
  assert.equal(l.state.boards.city, 1);
  assert.equal(l.state.boards.school, 0);
  const x = lab('MZ');
  x.state.setup.x = ['X异因子'];
  character(x, 'a', '男学生', '不安定因子').status = 'dead';
  phase(x, 'mastermind-abilities');
  assert.ok(
    !x.state.pending?.options.some((c) => c.kind === 'ability' && c.ability === 'factor-intrigue'),
  );
});
check('initial-position', [210, 211, 285, 470], '炸弹读取初始区域，未登场神灵魔女仍计数', () => {
  const l = lab('BTX');
  l.state.setup.y = '巨大定时炸弹X';
  character(l, 'a', '神灵', '魔女').status = 'absent';
  l.state.boards.shrine = 2;
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
  const x = lab();
  character(x, 'a', '手下', '魔女');
  effects(x, { op: 'place', target: 'a', area: 'city' });
  assert.equal(x.state.characters.a!.initialArea, 'city');
  effects(x, { op: 'move', target: 'a', area: 'school' });
  assert.equal(x.state.characters.a!.initialArea, 'city');
});
check('loss-timing', [35, 385, 386], '达贡和染血按轮回末判断，零EX也满足阈值', () => {
  const l = lab('WM');
  l.state.setup.y = '达贡的福音书';
  l.state.setup.x = ['染血的仪式'];
  l.state.boards.shrine = 3;
  l.state.ex = 1;
  phase(l, 'mastermind-abilities');
  assert.equal(l.state.failed, false);
  l.state.ex = 0;
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
});
check('scholar-start', [162, 163, 164], '学者每轮由剧作家选择普通三种指示物', () => {
  const l = lab();
  character(l, 'a', '学者');
  phase(l, 'loop-start');
  assert.equal(l.state.pending!.actor, 'mastermind');
  assert.deepEqual(
    l.state.pending!.options.map((c) => (c.kind === 'select' ? c.value : '')),
    ['goodwill', 'paranoia', 'intrigue'],
  );
});
check(
  'friend-revival',
  [161, 219, 322],
  '公开过的亲友复活后跨轮有友好，EX与亲友友好同时存在',
  () => {
    const l = lab('MZ');
    character(l, 'a', '职员', '亲友').revealed = true;
    l.state.setup.y = '因果之绊';
    l.state.previousLoop = {
      characters: clone(l.state.characters),
      boards: clone(l.state.boards),
      ex: 0,
    };
    l.state.previousLoop.characters.a!.status = 'dead';
    l.state.loop = 2;
    phase(l, 'discussion');
    act(l, { kind: 'continue' });
    drain(l);
    assert.equal(l.state.characters.a!.counters.goodwill, 1);
    assert.equal(l.state.characters.a!.flags['causal-ex'], 'yes');
  },
);
check(
  'parttimer-replacement',
  [196, 199, 425],
  '临时工死亡次日只登场一张替代牌，临时工尸体为平民',
  () => {
    const l = lab();
    character(l, 'a', '临时工', '平民', 'city').status = 'dead';
    character(l, 'replacement', '临时工？', '杀手', 'city').status = 'absent';
    phase(l, 'day-start');
    assert.equal(l.state.characters.replacement!.status, 'alive');
    l.state.day = 3;
    phase(l, 'day-start');
    assert.equal(
      Object.values(l.state.characters).filter((c) => c.character === '临时工？').length,
      1,
    );
    effects(l, { op: 'reveal-identity', target: 'a' });
    assert.equal(l.state.observations.protagonists.at(-1)!.data.identity, '平民');
  },
);
check(
  'far-ability-targets',
  [367, 368, 372, 378],
  '失踪不能选择远方但可离开远方；媒体人无限射程',
  () => {
    const l = lab();
    character(l, 'a', 'UP主').counters.paranoia = 2;
    incident(l, '失踪');
    assert.ok(!l.state.pending!.options.some((c) => c.kind === 'select' && c.value === 'far'));
    drain(l, ['city']);
    assert.equal(l.state.characters.a!.area, 'city');
    const x = lab();
    character(x, 'a', '媒体人').counters.goodwill = 2;
    character(x, 'b', 'UP主');
    ability(x, 'a', 'media-paranoia', { target: 'b' });
    assert.equal(x.state.characters.b!.counters.paranoia, 1);
    assert.equal(x.pack.characters['UP主']!.initial[0], 'far');
  },
);
check('fool-intrigue', [292], '士的宁愚者事件后清不安但不清密谋', () => {
  const l = lab('MC');
  l.state.setup.y = '士的宁毒液';
  character(l, 'a', '男学生', '愚者').counters.intrigue = 2;
  l.state.characters.a!.counters.paranoia = 1;
  character(l, 'b', '女学生');
  incident(l, '连续杀人');
  drain(l, ['b']);
  assert.equal(l.state.characters.a!.counters.intrigue, 2);
  assert.equal(l.state.characters.a!.counters.paranoia, 0);
});
check(
  'twins-area',
  [293, 294, 295, 370],
  '双胞胎改变事件计算位置，但尸体留在实际位置；远方不取对角',
  () => {
    const l = lab('MC');
    character(l, 'a', '男学生', '双胞胎', 'school').counters.paranoia = 2;
    l.state.boards.hospital = 1;
    incident(l, '医院事故');
    assert.equal(l.state.characters.a!.status, 'dead');
    assert.equal(l.state.characters.a!.area, 'school');
  },
);
check('lockdown-moves', [303, 311], '封锁公开版图并禁止能力进出', () => {
  const l = lab('MC');
  character(l, 'a', '男学生').counters.paranoia = 2;
  incident(l, '封锁');
  drain(l, ['school']);
  assert.equal(l.state.flags['lockdown-area'], 'school');
  assert.ok(
    l.state.observations.protagonists.some((o) => JSON.stringify(o.data).includes('school')),
  );
  effects(l, { op: 'move', target: 'a', area: 'city' });
  assert.equal(l.state.characters.a!.area, 'school');
});
check('wm-witness', [401], '目击者和杀人狂同批死亡仍加EX', () => {
  const l = lab('WM');
  character(l, 'a', '男学生', '目击者', 'school').counters.paranoia = 4;
  character(l, 'b', '女学生', '杀人狂', 'school');
  phase(l, 'day-end');
  assert.equal(l.state.characters.a!.status, 'dead');
  assert.equal(l.state.ex, 1);
});
check('wizard-death', [394, 395], '死亡巫师不公开身份；深潜者公开角色和身份', () => {
  const l = lab('WM');
  character(l, 'a', '男学生', '巫师').status = 'dead';
  phase(l, 'loop-end');
  assert.ok(
    !l.state.observations.protagonists.some(
      (o) => o.type === 'identity' && o.data.character === 'a',
    ),
  );
  const x = lab('WM');
  character(x, 'a', '男学生', '深潜者').counters.paranoia = 2;
  incident(x, '疯狂杀人');
  drain(x, ['a']);
  assert.ok(
    x.state.observations.protagonists.some(
      (o) => o.type === 'identity' && o.data.character === 'a' && o.data.identity === '深潜者',
    ),
  );
});
check(
  'no-negative-incident-threshold',
  [331, 333],
  '灭亡讴歌降低平民阈值但不能绕过事件的禁止条件',
  () => {
    const l = lab('MZ');
    l.state.setup.x = ['灭亡讴歌'];
    character(l, 'a', '男学生', '平民').counters.intrigue = 1;
    character(l, 'b', '女学生', '预言家', 'city');
    incident(l, '阴谋活动');
    assert.equal(l.state.incidents.length, 1);
    const x = lab('MZ');
    x.state.setup.x = ['灭亡讴歌'];
    character(x, 'a', '大小姐');
    character(x, 'b', '女学生', '预言家', 'school');
    incident(x, '自杀');
    assert.equal(x.state.incidents.length, 0);
  },
);
check('butterfly-counters', [86, 421], '蝴蝶效应只提供友好不安密谋，不提供希望绝望', () => {
  const l = lab();
  character(l, 'a', '男学生').counters.paranoia = 2;
  incident(l, '蝴蝶效应');
  drain(l, ['a']);
  const steps = l.pack.incidents['蝴蝶效应']!.steps;
  assert.ok(JSON.stringify(steps).includes('goodwill'));
  assert.ok(!JSON.stringify(steps).includes('despair'));
  assert.ok(!JSON.stringify(steps).includes('hope'));
});
check('wm-madness', [384], 'EX4即使提前死亡也不继续剩余轮回', () => {
  const l = lab('WM');
  l.state.setup.x = ['染血的仪式'];
  l.state.ex = 4;
  effects(l, { op: 'protagonist-death' });
  phase(l, 'loop-end');
  assert.equal(l.state.phase, 'final-guess');
  assert.equal(l.state.loop, 1);
});
check('psychologist-empty', [302], '心理医生减少零不安不产生角色变化公开通知', () => {
  const l = lab('MC');
  character(l, 'a', '男学生', '心理医生');
  l.state.ex = 1;
  phase(l, 'mastermind-abilities');
  const before = l.state.observations.protagonists.length;
  drain(l, ['b']);
  assert.ok(!l.state.observations.protagonists.slice(before).some((o) => o.type === 'character'));
});
