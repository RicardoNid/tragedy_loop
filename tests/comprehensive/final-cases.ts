import assert from 'node:assert/strict';
import { check, effects, cards } from './cases.js';
import { lab, character, phase, act, ability, drain } from './harness.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import { cardCount } from '../../packages/engine/src/runtime/engine.js';
check(
  'll-hospital-special-timing',
  [276, 462],
  '医院事故达第五死亡后主人公死亡：有次轮才可在下轮日末胜利',
  () => {
    for (const final of [false, true]) {
      const l = lab('LL');
      l.state.setup.x = ['真正的怪物'];
      l.state.ll = {
        roles: { p0: 'A', p1: 'B', p2: 'C' },
        communicated: [],
        died: ['old1', 'old2', 'old3', 'old4'],
        finalTraitorsDisabled: false,
      };
      character(l, 'a', '男学生', '平民', 'hospital').counters.paranoia = 2;
      l.state.boards.hospital = 2;
      l.state.loop = final ? l.state.setup.loops : 1;
      l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'a' }];
      phase(l, 'incident');
      assert.equal(l.state.protagonistDead, true);
      assert.equal(l.state.winner, undefined);
      assert.equal(l.state.latchedWinner, undefined);
      if (final) {
        assert.equal(l.state.phase, 'final-guess');
      } else {
        assert.equal(l.state.phase, 'discussion');
        act(l, { kind: 'continue' });
        phase(l, 'day-end');
        assert.equal(l.state.winner, 'p0');
      }
    }
  },
);
check('ll-key-next-loop', [288, 473], '最后一天密钥触发后次轮恢复三张剧作家牌', () => {
  const l = lab('LL');
  character(l, 'a', '职员', '密钥').counters.goodwill = 3;
  l.state.day = l.state.setup.days;
  ability(l, 'a', 'office-worker');
  phase(l, 'day-end');
  assert.equal(l.state.protagonistDead, true);
  assert.equal(l.state.phase, 'discussion');
  act(l, { kind: 'continue' });
  assert.equal(cardCount(l.state, 'mastermind'), 3);
  assert.equal(l.state.day, 1);
});
check('unsupported-custom-contract', [], '任意文本特殊规则被契约明确拒绝，不能误当作已实现', () => {
  const l = lab();
  l.state.setup.y = '谋杀计划';
  assert.equal(setupSchema.safeParse(l.state.setup).success, true);
  for (const specialRules of ['所有区域视为学校', '与塔同区域的平民变成杀人狂', '第三天你就知道了'])
    assert.equal(setupSchema.safeParse({ ...l.state.setup, specialRules }).success, false);
});
check(
  'henchman-fool-completion',
  [118, 119, 309, 310],
  '手下愚者：连续杀人完成清不安，猎奇杀人中断不清',
  () => {
    for (const horrific of [false, true]) {
      const l = lab('MC');
      character(l, 'a', '手下', '愚者', 'school').counters.paranoia = 5;
      character(l, 'b', '男学生', '关键人物', 'school');
      l.state.setup.incidents = [
        { day: 1, name: horrific ? '猎奇杀人' : '连续杀人', culprit: 'a' },
      ];
      phase(l, 'incident');
      drain(l, ['b']);
      assert.equal(l.state.characters.b!.status, 'dead');
      assert.equal(l.state.characters.a!.counters.paranoia, horrific ? 5 : 0);
    }
  },
);
check('ll-communication-order', [89, 423], 'LL异界人先已沟通再死亡标记，再关键人物失败', () => {
  const l = lab('LL');
  l.state.ll = {
    roles: { p0: 'A', p1: 'B', p2: 'C' },
    communicated: [],
    died: [],
    finalTraitorsDisabled: false,
  };
  character(l, 'a', '异界人', '平民', 'school').counters.goodwill = 5;
  character(l, 'b', '男学生', '关键人物', 'school');
  ability(l, 'a', 'alien-kill', { target: 'b' });
  const o = l.state.observations.protagonists;
  const comm = o.findIndex((x) => JSON.stringify(x.data).includes('communicated'));
  const death = o.findIndex((x) => JSON.stringify(x.data).includes('died'));
  const fail = o.findIndex((x) => x.type === 'failure');
  assert.ok(comm >= 0 && death > comm && fail > death);
});
check('ll-hope-final', [281, 466], '最终计划希望禁用C，最终轮失败进入普通决战', () => {
  const l = lab('LL');
  l.state.setup.y = '最终计划';
  l.state.setup.x = ['我才是名侦探'];
  l.state.ll = {
    roles: { p0: 'A', p1: 'B', p2: 'C' },
    communicated: [],
    died: [],
    finalTraitorsDisabled: false,
  };
  character(l, 'a', '男学生', '关键人物').counters.hope = 1;
  l.state.loop = l.state.setup.loops;
  l.state.failed = true;
  phase(l, 'loop-end');
  assert.equal(l.state.phase, 'final-guess');
  assert.ok(!l.state.flags['c-guess']);
  assert.equal(l.state.ll.finalTraitorsDisabled, true);
});
check('zombie-before-optional', [259], '丧尸优势杀害先于可选的尸体移动', () => {
  const l = lab('HSA');
  character(l, 'a', '男学生', '丧尸', 'school').status = 'dead';
  character(l, 'b', '女学生', '丧尸', 'school').status = 'dead';
  character(l, 'c', '医生', '平民', 'school');
  phase(l, 'day-end');
  assert.equal(l.state.characters.c!.status, 'dead');
});
check('identity-pool-cap', [29], '身份上限裁剪规则追加数量，游戏中变更不重新验证分配', () => {
  const l = lab();
  l.state.setup.y = '谋杀计划';
  l.state.setup.x = ['流言四起', '因果线'];
  character(l, 'a', '男学生', '关键人物');
  character(l, 'b', '女学生', '传谣人');
  character(l, 'c', '医生', '杀手');
  character(l, 'd', '巫女', '主谋');
  assert.deepEqual(validateSetup(l.pack, l.state.setup), []);
  character(l, 'extra', '职员', '关键人物');
  assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'identity-pool'));
});
check('failure-disclosure', [36, 38, 39, 226], '失败不泄露隐藏原因；主人公死亡单独声明', () => {
  for (const dead of [false, true]) {
    const l = lab();
    effects(l, { op: dead ? 'protagonist-death' : 'fail' });
    const v = project(l.state, 'p0');
    assert.equal(l.state.failed, true);
    assert.equal(
      v.observations.some((o) => o.type === 'failure' && o.data.result === 'protagonist-death'),
      dead,
    );
    assert.ok(!JSON.stringify(v).includes('谋杀计划'));
  }
});
check(
  'refusal-notification',
  [64, 65, 66, 68, 69, 79, 414],
  '拒绝公开通知且不消耗轮限；接受空发消耗次数',
  () => {
    const l = lab();
    character(l, 'a', '情报商', '杀手').counters.goodwill = 5;
    l.state.setup.x = ['流言四起', '因果线'];
    ability(l, 'a', 'informant', { excluded: '流言四起' });
    act(l, { kind: 'refuse', refuse: true });
    assert.ok(
      l.state.observations.protagonists.some(
        (o) => o.type === 'refused' && o.data.character === 'a',
      ),
    );
    l.state.characters.a!.counters.hope = 1;
    ability(l, 'a', 'informant', { excluded: '流言四起' });
    drain(l);
    assert.ok(!l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
  },
);
check('outsider-guess', [126], '局外人也在最终决战猜测角色中', () => {
  const l = lab();
  character(l, 'a', '局外人', '杀人狂');
  phase(l, 'loop-start');
  phase(l, 'final-guess');
  assert.ok(l.state.pending?.kind === 'guess');
  assert.ok(l.state.appeared.includes('a'));
});
check('parttimer-simultaneous', [201], '临时工与替代同时触发，两份效果同批', () => {
  const l = lab();
  character(l, 'a', '临时工', '平民', 'school').counters.paranoia = 5;
  character(l, 'r', '临时工？', '杀手', 'city').counters.paranoia = 5;
  l.state.setup.incidents = [{ day: 1, name: '自杀', culprit: 'a' }];
  phase(l, 'incident');
  assert.equal(l.state.characters.a!.status, 'dead');
  assert.equal(l.state.characters.r!.status, 'dead');
  assert.equal(l.state.incidents.length, 1);
});
check('cult-compound', [175, 176], '教主第二次效果使用第一次移动后的区域', () => {
  for (const nested of [false, true]) {
    const l = lab(nested ? 'MZ' : 'MC');
    character(l, 'a', '教主', '平民', 'school').counters.paranoia = 5;
    l.state.characters.a!.counters.intrigue = 3;
    character(l, 'b', '男学生', '平民', 'city');
    l.state.setup.incidents = [{ day: 1, name: nested ? '阴谋活动' : '可疑信件', culprit: 'a' }];
    phase(l, 'incident');
    drain(l, nested ? ['失踪', 'city', '连续杀人', 'b'] : ['city', 'b', 'school']);
    assert.equal(l.state.characters.a!.area, 'city');
    assert.equal(l.state.characters.b!.status, nested ? 'dead' : 'alive');
    if (!nested) assert.equal(l.state.characters.b!.area, 'school');
  }
});
check('curses-choice', [241], '两张诅咒可选同一人或不同人', () => {
  for (const second of ['a', 'b']) {
    const l = lab('HSA');
    l.state.curses = [
      { id: 'q1', target: 'school' },
      { id: 'q2', target: 'school' },
    ];
    phase(l, 'day-end');
    drain(l, ['a', second]);
    assert.deepEqual(
      l.state.curses.map((c) => c.target),
      ['a', second],
    );
  }
});
check('curses-before-killer', [243], '诅咒先杀第三人，杀人狂再按两人独处杀害', () => {
  const l = lab('HSA');
  character(l, 'a', '男学生', '杀人狂', 'school');
  character(l, 'b', '女学生', '平民', 'school');
  character(l, 'c', '医生', '平民', 'school');
  l.state.curses = [{ id: 'q', target: 'c' }];
  phase(l, 'day-end');
  drain(l);
  assert.equal(l.state.characters.c!.status, 'dead');
  assert.equal(l.state.characters.b!.status, 'dead');
});
check('two-curse-plots', [250], '魔女遗咒与被诅咒土地各放一张诅咒', () => {
  const l = lab('HSA');
  l.state.setup.y = '被诅咒的土地';
  l.state.setup.x = ['魔女遗咒'];
  character(l, 'a', '男学生', '鬼魂');
  character(l, 'b', '女学生', '魔女');
  phase(l, 'loop-start');
  drain(l, ['school']);
  for (let i = 0; i < 3 && l.state.pending?.kind === 'ability'; i++) {
    const a = l.state.pending.options.find((c) => c.kind === 'ability');
    if (!a) break;
    act(l, a);
    drain(l, ['a', 'school']);
  }
  assert.equal(l.state.curses?.length, 2);
});
check(
  'crowd-area-and-interruption',
  [269, 271, 272],
  '群众事件使用群众版图；关键人物死亡中断后续主人公死亡',
  () => {
    const l = lab('HSA');
    character(l, 'a', '男学生', '关键人物', 'school');
    l.state.boards.school = 2;
    l.state.setup.incidents = [{ day: 1, name: '死者默示录', culprit: 'school' }];
    phase(l, 'incident');
    assert.equal(l.state.characters.a!.status, 'dead');
    assert.equal(l.state.protagonistDead, false);
    assert.equal(l.state.characters.c!.status, 'alive');
  },
);
check('solitude-batch', [270], '孤守为每人分别选版图后同时移动', () => {
  const l = lab('HSA');
  character(l, 'a', '男学生').counters.paranoia = 2;
  character(l, 'c', '医生', '平民', 'school');
  l.state.setup.incidents = [{ day: 1, name: '孤守', culprit: 'a' }];
  phase(l, 'incident');
  drain(l, ['city', 'hospital']);
  assert.equal(l.state.characters.b!.area, 'city');
  assert.equal(l.state.characters.c!.area, 'hospital');
});
check('wizard-outsider', [398], '异界人巫师杀关键人物后仍公开活巫师', () => {
  const l = lab('WM');
  character(l, 'a', '异界人', '巫师', 'school').counters.goodwill = 5;
  character(l, 'b', '男学生', '关键人物', 'school');
  ability(l, 'a', 'alien-kill', { target: 'b' });
  drain(l, ['no']);
  assert.equal(l.state.characters.b!.status, 'dead');
  assert.ok(
    l.state.observations.protagonists.some(
      (o) => o.type === 'identity' && o.data.character === 'a',
    ),
  );
});
check('immortal-clockwise', [374], '仙人事件可选顺时针区域并在该区域选目标', () => {
  const l = lab();
  character(l, 'a', '仙人', '平民', 'school').counters.paranoia = 5;
  character(l, 'b', '男学生', '平民', 'city');
  l.state.setup.incidents = [{ day: 1, name: '谋杀', culprit: 'a' }];
  phase(l, 'incident');
  drain(l, ['clockwise', 'b']);
  assert.equal(l.state.characters.b!.status, 'dead');
  assert.equal(l.state.characters.a!.area, 'school');
});
check('empathy-captain', [381], '禁止讨论下感应咒文由队长放友好', () => {
  const l = lab('WM');
  l.state.ex = 1;
  phase(l, 'day-start');
  assert.equal(l.state.pending?.actor, l.state.captain);
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'a'));
});
check(
  'cultist-virtual-area',
  [141, 397, 402],
  'EX3邪教徒能同时取消所选区域的禁止密谋，不能覆盖两个区域',
  () => {
    for (const boss of [false, true]) {
      const l = lab('WM');
      l.state.ex = 3;
      character(l, 'a', boss ? '大人物' : '男学生', '邪教徒', 'school');
      if (boss) l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'city';
      character(l, 'b', '女学生', '平民', 'city');
      cards(
        l,
        [
          ['school', 'block-intrigue'],
          [boss ? 'city' : 'a', 'block-intrigue'],
          ['school', 'intrigue+1'],
          [boss ? 'city' : 'a', 'intrigue+1'],
        ],
        boss ? ['territory'] : [],
      );
      act(l, {
        kind: 'ability',
        owner: 'a',
        ability: 'cultist',
      });
      drain(l);
      assert.equal(l.state.boards.school, boss ? 0 : 1);
      if (boss) assert.equal(l.state.boards.city, 1);
      else assert.equal(l.state.characters.a!.counters.intrigue, 1);
    }
  },
);
check('boss-detective', [135, 299], 'EX0大人物侦探可以选择领地是否触发事件', () => {
  for (const choice of ['actual', 'territory']) {
    const l = lab('MC');
    character(l, 'a', '男学生', '平民', 'school');
    character(l, 'b', '大人物', '侦探', 'city');
    l.state.setup.characters.find((c) => c.id === 'b')!.territory = 'school';
    l.state.setup.incidents = [{ day: 1, name: '封锁', culprit: 'a' }];
    phase(l, 'incident');
    assert.ok(l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'territory'));
    act(l, { kind: 'select', value: choice });
    assert.equal(l.state.incidents.length, choice === 'territory' ? 1 : 0);
  }
});
