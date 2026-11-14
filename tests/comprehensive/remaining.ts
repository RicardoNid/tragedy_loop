import assert from 'node:assert/strict';
import { check, effects, cards } from './cases.js';
import { lab, character, phase, act, ability, drain, type Lab } from './harness.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { legalCardTargets } from '../../packages/engine/src/runtime/engine.js';
import { recompute } from '../../packages/engine/src/runtime/expressions.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
const event = (l: Lab, name: string, culprit = 'a') => {
  l.state.setup.incidents = [{ day: l.state.day, name, culprit }];
  phase(l, 'incident');
};
function go(l: Lab, owner: string, name: string, choices: Record<string, string> = {}) {
  act(l, { kind: 'ability', owner, ability: name, choices });
}
check('sister-fairytale', [14, 451], '妹妹调用童谣媒体人：指定目标随后死亡', () => {
  const l = lab('AHR');
  character(l, 'a', '妹妹', '平民', 'school').counters.goodwill = 5;
  character(l, 'b', '媒体人', '童谣', 'school');
  character(l, 'c', '职员', '平民', 'school');
  ability(l, 'a', 'little-sister', { target: 'b', ability: 'media-paranoia' });
  drain(l, ['c']);
  assert.equal(l.state.characters.c!.status, 'dead');
});
check(
  'boss-evangelist',
  [16, 140, 453],
  '布道者大人物死后可选择领地放绝望，但领地从者不替死',
  () => {
    const l = lab('AHR');
    character(l, 'a', '大人物', '布道者', 'hospital').counters.paranoia = 3;
    l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'city';
    character(l, 'b', '从者', '平民', 'city');
    l.state.characters.c!.counters.paranoia = 3;
    event(l, '冲动杀人', 'c');
    drain(l, ['territory', 'no']);
    assert.equal(l.state.characters.a!.status, 'dead');
    assert.equal(l.state.characters.b!.status, 'alive');
    assert.equal(l.state.characters.b!.counters.despair, 1);
  },
);
check('alice-noop', [17, 454], '爱丽丝无目标仍消耗每轮一次，次日新增同区角色不再给希望', () => {
  const l = lab('AHR');
  character(l, 'a', '职员', '爱丽丝', 'city').counters.goodwill = 3;
  l.state.ex = 2;
  ability(l, 'a', 'office-worker');
  drain(l);
  l.state.day = 2;
  character(l, 'b', '男学生', '平民', 'city');
  ability(l, 'a', 'office-worker');
  drain(l);
  assert.equal(l.state.characters.b!.counters.hope, 0);
});
check('singularity-once', [20, 21], '奇点跨表里世界仍只首次死亡；AI只移动世界', () => {
  for (const invocation of [false, true]) {
    const l = lab('AHR');
    character(l, 'a', invocation ? 'AI' : '男学生').counters.goodwill = 3;
    l.state.characters.a!.counters.paranoia = 3;
    l.state.ex = 0;
    l.state.loop = 2;
    l.state.incidents = [{ loop: 1, day: 1, name: '奇点', publicName: '奇点', culprit: 'a' }];
    if (invocation) {
      l.state.setup.incidents = [{ day: 1, name: '奇点', culprit: 'a' }];
      ability(l, 'a', 'ai', { incident: '奇点' });
    } else event(l, '奇点');
    drain(l);
    assert.equal(l.state.protagonistDead, false);
    assert.ok(l.state.flags['world-moved'] || l.state.ex === 1);
  }
});
check('cult-thresholds', [18, 177, 178, 457], '教主两次偏移阈值，猎奇杀人仍仅增加2EX', () => {
  for (const [module, name, count, ex] of [
    ['AHR', '冲动杀人', 1, 0],
    ['MC', '前兆', 1, 1],
    ['MC', '猎奇杀人', 5, 2],
  ] as const) {
    const l = lab(module);
    character(l, 'a', '教主').counters.paranoia = count;
    event(l, name);
    assert.equal(l.state.incidents.length, 1);
    assert.equal(l.state.ex, ex);
  }
});
check(
  'mastermind-doctor-independent',
  [47, 53, 55, 56],
  '医生双方使用次数独立；主谋计数能力不被行动牌禁止',
  () => {
    const l = lab();
    character(l, 'a', '医生', '主谋', 'school').counters.goodwill = 3;
    phase(l, 'mastermind-abilities');
    go(l, 'a', 'doctor-counter', { target: 'b', direction: 'add' });
    drain(l);
    phase(l, 'protagonist-abilities');
    assert.ok(
      l.state.pending?.options.some((c) => c.kind === 'ability' && c.ability === 'doctor-counter'),
    );
    assert.ok(!l.state.pending?.options.some((c) => c.kind === 'ability' && c.ability === 'brain'));
  },
);
check('two-goodwill', [59, 62, 63], '同一角色不同友好能力各可用；当阶段新增友好即时开放', () => {
  const l = lab();
  character(l, 'a', '偶像', '平民', 'school').counters.goodwill = 4;
  ability(l, 'a', 'idol-paranoia', { target: 'b' });
  go(l, 'a', 'idol-goodwill', { target: 'b' });
  assert.equal(l.state.characters.b!.counters.goodwill, 1);
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
  const x = lab();
  character(x, 'a', '大小姐').counters.goodwill = 3;
  x.state.characters.b!.counters.goodwill = 1;
  ability(x, 'a', 'rich-girl', { target: 'b' });
  assert.ok(x.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'b'));
});
check('wm-despair-refusal', [87], 'WM由绝望产生友好无视，拒绝仍增加EX', () => {
  const l = lab('WM');
  character(l, 'a', '职员').counters.goodwill = 3;
  l.state.characters.a!.counters.despair = 1;
  ability(l, 'a', 'office-worker');
  assert.equal(l.state.ex, 1);
});
check('informant-plus', [91, 109, 433], '扩展情报商选项包含超越世界线', () => {
  const l = lab('BTX', true);
  character(l, 'a', '情报商').counters.goodwill = 5;
  ability(l, 'a', 'informant');
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'select' && c.value === '超越世界线'));
});
check('ai-crowd', [114, 263], 'AI调用群众事件以都市为当事人区域', () => {
  const l = lab('HSA');
  character(l, 'a', 'AI').counters.goodwill = 3;
  character(l, 'b', '男学生', '平民', 'city');
  l.state.setup.incidents = [{ day: 1, name: '死者默示录', culprit: 'school' }];
  ability(l, 'a', 'ai', { incident: '死者默示录' });
  drain(l);
  assert.equal(l.state.characters.b!.status, 'dead');
  assert.equal(l.state.incidents.length, 0);
});
check('boss-serial', [132, 223], '大人物杀人狂可选择领地单独角色', () => {
  const l = lab();
  character(l, 'a', '大人物', '杀人狂', 'city');
  l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
  phase(l, 'day-end');
  drain(l, ['territory']);
  assert.equal(l.state.characters.b!.status, 'dead');
});
check('boss-coward-servant', [139, 192, 262], '大人物胆小鬼从领地移动，领地从者跟随', () => {
  const l = lab('HSA');
  character(l, 'a', '大人物', '胆小鬼', 'city').counters.paranoia = 2;
  l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
  character(l, 'b', '从者', '平民', 'school');
  phase(l, 'mastermind-abilities');
  drain(l, ['territory', 'shrine']);
  assert.equal(l.state.characters.a!.area, 'shrine');
  assert.equal(l.state.characters.b!.area, 'shrine');
});
check(
  'absent-loop-memory',
  [151, 152, 202, 204, 205],
  '转校生和替代临时工轮初不在场，不授予因果牌或EX牌',
  () => {
    for (const name of ['转校生', '临时工？'])
      for (const status of ['alive', 'dead'] as const) {
        const l = lab('MZ');
        character(l, 'a', name, '因果残片').counters.goodwill = 2;
        if (name === '转校生') l.state.setup.characters.find((c) => c.id === 'a')!.enterDay = 3;
        l.state.characters.a!.status = status;
        l.state.previousLoop = {
          characters: clone(l.state.characters),
          boards: clone(l.state.boards),
          ex: 0,
        };
        l.state.setup.y = '因果之绊';
        l.state.loop = 2;
        phase(l, 'discussion');
        act(l, { kind: 'continue' });
        drain(l);
        assert.equal(l.state.characters.a!.status, 'absent');
        assert.ok(!l.state.cards.some((c) => c.kind === 'hope+1' || c.kind === 'despair+1'));
        assert.ok(!l.state.characters.a!.flags['causal-ex']);
      }
  },
);
check('scholar-ex-choice', [165], '学者清空后在EX模组必须选择加减', () => {
  const l = lab('MC');
  character(l, 'a', '学者').counters.goodwill = 5;
  ability(l, 'a', 'scholar-clear');
  assert.deepEqual(
    l.state.pending?.options.map((c) => (c.kind === 'select' ? c.value : '')),
    ['up', 'down'],
  );
  act(l, { kind: 'select', value: 'up' });
  assert.equal(l.state.ex, 1);
});
check('removed-reset', [170], '移除幻想下一轮重新登场', () => {
  const l = lab();
  character(l, 'a', '幻想').status = 'removed';
  l.state.loop = 2;
  phase(l, 'discussion');
  act(l, { kind: 'continue' });
  assert.equal(l.state.characters.a!.status, 'alive');
});
check('higher-being-shared', [206, 207, 208, 432], '上位存在轮限双方共享，拒绝不消耗', () => {
  for (const first of ['mastermind', 'protagonists', 'refuse']) {
    const l = lab();
    character(l, 'a', '上位存在', '主谋').counters.goodwill = 3;
    phase(l, first === 'mastermind' ? 'mastermind-abilities' : 'protagonist-abilities');
    go(l, 'a', 'higher-being', { target: 'a', counter: 'hope' });
    if (l.state.pending?.kind === 'refusal') act(l, { kind: 'refuse', refuse: first === 'refuse' });
    phase(l, first === 'mastermind' ? 'protagonist-abilities' : 'mastermind-abilities');
    assert.equal(
      Boolean(
        l.state.pending?.options.some(
          (c) => c.kind === 'ability' && c.owner === 'a' && c.ability === 'higher-being',
        ),
      ),
      first === 'refuse',
    );
  }
});
check('contract-factor', [209, 227], '契约不安定因子不因都市2密谋变关键人物；死亡后不转化', () => {
  for (const dead of [false, true]) {
    const l = lab();
    l.state.setup.y = '和我签订契约吧！';
    l.state.setup.x = ['恋爱风景'];
    character(l, 'a', '男学生', '不安定因子').status = dead ? 'dead' : 'alive';
    l.state.characters.a!.counters.intrigue = 2;
    l.state.boards.city = 2;
    phase(l, 'mastermind-abilities');
    assert.equal(l.state.failed, false);
  }
});
check('black-cat-butterfly', [214], '黑猫抑制事件效果但仍触发改变未来失败', () => {
  const l = lab();
  l.state.setup.y = '改变未来';
  character(l, 'a', '黑猫').counters.paranoia = 1;
  event(l, '蝴蝶效应');
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
});
check('gossip-self', [216], '传谣人允许给自己放不安', () => {
  const l = lab();
  character(l, 'a', '男学生', '传谣人');
  phase(l, 'mastermind-abilities');
  const c = l.state.pending?.options.find((c) => c.kind === 'ability' && c.owner === 'a');
  assert.ok(c?.kind === 'ability');
  act(l, { ...c, choices: { target: 'a' } });
  assert.equal(l.state.characters.a!.counters.paranoia, 1);
});
check('curse-empty', [238], '空版图诅咒不附着角色，被诅咒土地仍判失败', () => {
  const l = lab('HSA');
  l.state.setup.y = '被诅咒的土地';
  for (const c of Object.values(l.state.characters)) c.area = 'school';
  l.state.curses = [{ id: 'q', target: 'shrine' }];
  phase(l, 'day-end');
  assert.equal(l.state.curses[0]!.target, 'shrine');
  go(l, 'plot:被诅咒的土地', 'curse-no-target');
  assert.equal(l.state.failed, true);
});
check(
  'ghost-order',
  [251, 254, 255, 256, 260],
  '鬼魂强制优先；胆小鬼与鬼魂同批按入口位置加不安移动',
  () => {
    const l = lab('HSA');
    character(l, 'a', '男学生', '鬼魂', 'school').status = 'dead';
    character(l, 'b', '女学生', '胆小鬼', 'school').counters.paranoia = 2;
    phase(l, 'mastermind-abilities');
    drain(l, ['b', 'city']);
    assert.equal(l.state.characters.b!.counters.paranoia, 3);
    assert.equal(l.state.characters.b!.area, 'city');
    const x = lab('HSA');
    character(x, 'a', '男学生', '鬼魂', 'city').status = 'dead';
    phase(x, 'mastermind-abilities');
    assert.ok(!x.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'a'));
  },
);
check('desecration-no-target', [274], '亵渎杀人无杀害对象必须放版图密谋', () => {
  const l = lab('HSA');
  character(l, 'a', '男学生', '平民', 'city').counters.paranoia = 2;
  event(l, '亵渎杀人');
  assert.ok(!l.state.pending?.options.some((c) => c.kind === 'select' && c.value === 'murder'));
  drain(l, ['intrigue']);
  assert.equal(l.state.boards.city, 1);
});
check('celebrity-independent', [286, 471], '两位网络名流轮限独立', () => {
  const l = lab('LL');
  character(l, 'a', '女学生', '网络名流', 'school').counters.goodwill = 3;
  character(l, 'b', '男学生', '网络名流', 'school').counters.goodwill = 2;
  ability(l, 'a', 'student', { target: 'b' });
  go(l, 'b', 'student', { target: 'a' });
  assert.equal(l.state.characters.a!.counters.goodwill, 4);
  assert.equal(l.state.characters.b!.counters.goodwill, 3);
});
check('sealed-effective', [291, 476], '封印终末与爆裂用有效密谋计数', () => {
  const l = lab('LL');
  l.state.setup.y = '封印的终末';
  character(l, 'a', '男学生', '平民', 'school').counters.paranoia = 2;
  l.state.characters.a!.counters.despair = 2;
  event(l, '骤变');
  drain(l);
  assert.equal(l.state.protagonistDead, true);
});
check('twins-detective', [296], '侦探按实际位置触发双胞胎事件', () => {
  for (const area of ['school', 'hospital'] as const) {
    const l = lab('MC');
    character(l, 'a', '男学生', '双胞胎', 'school');
    character(l, 'b', '女学生', '侦探', area);
    event(l, '封锁');
    assert.equal(l.state.incidents.length, area === 'school' ? 1 : 0);
  }
});
check('poisoner-self', [305], 'EX2独处投毒者必须选择自己死亡', () => {
  const l = lab('MC');
  character(l, 'a', '男学生', '投毒者', 'city');
  l.state.ex = 2;
  phase(l, 'day-end');
  drain(l);
  assert.equal(l.state.characters.a!.status, 'dead');
});
check('removed-count', [329], '死亡真人秀排除已移除幻想', () => {
  const l = lab('MZ');
  l.state.setup.y = '死亡真人秀';
  for (let i = 0; i < 4; i++) character(l, 'extra' + i, '男学生');
  l.state.characters.a!.status = 'removed';
  l.state.characters.b!.status = 'dead';
  phase(l, 'loop-end');
  assert.equal(l.state.failed, true);
});
check('absent-prophet', [332], '未登场移除和EX预言家不降低平民事件阈值', () => {
  for (const status of ['absent', 'removed', 'ex'] as const) {
    const l = lab('MZ');
    l.state.setup.x = ['灭亡讴歌'];
    l.state.setup.y = '因果之绊';
    character(l, 'a', '男学生').counters.paranoia = 1;
    character(l, 'b', '女学生', '预言家', 'city');
    if (status === 'ex') l.state.characters.b!.flags['causal-ex'] = 'yes';
    else l.state.characters.b!.status = status;
    recompute(l.state);
    event(l, '自杀');
    assert.equal(l.state.incidents.length, 0);
  }
});
check('fake-suicide-ex', [344, 345], '伪装自杀使所有EX牌角色禁止主人公行动，仍可友好', () => {
  const l = lab('MZ');
  character(l, 'a', '男学生').counters.paranoia = 2;
  character(l, 'b', '女学生').flags['causal-ex'] = 'yes';
  l.state.characters.b!.counters.goodwill = 2;
  event(l, '伪装自杀');
  assert.ok(!legalCardTargets(l.state, 'p0').includes('b'));
  phase(l, 'protagonist-abilities');
  assert.ok(l.state.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'b'));
});
check('streamer-virtual', [377, 379], 'UP主可在关注区域对无EX目标用能力', () => {
  const l = lab();
  character(l, 'a', 'UP主').counters.goodwill = 3;
  l.state.flags['streamer-target'] = 'b';
  ability(l, 'a', 'streamer', { areaMode: 'streamer', target: 'b' });
  drain(l, ['no', 'b']);
  assert.equal(l.state.characters.b!.counters.goodwill, 1);
});
check('paranoid-refusal', [388], '私语获得友好能力仍保留偏执狂强制拒绝', () => {
  const l = lab('WM');
  l.state.setup.y = '深渊之都的私语';
  character(l, 'a', '职员', '偏执狂').counters.goodwill = 3;
  ability(l, 'a', 'office-worker');
  drain(l);
  assert.ok(l.state.observations.protagonists.some((o) => o.type === 'refused'));
  assert.ok(!l.state.observations.protagonists.some((o) => o.type === 'identity'));
});
check(
  'mad-truth',
  [389, 390, 391],
  '疯狂真相仅轮初EX决定替换失败条件，不改变身份，无魔女炸弹不失败',
  () => {
    const l = lab('WM');
    l.state.setup.x = ['疯狂的真相'];
    l.state.setup.y = '达贡的福音书';
    l.state.setup.alternateY = '巨大定时炸弹X';
    l.state.ex = 2;
    phase(l, 'loop-start');
    assert.equal(l.state.flags['alternate-y'], '巨大定时炸弹X');
    assert.equal(l.state.characters.a!.identity, '平民');
    l.state.boards.shrine = 3;
    phase(l, 'loop-end');
    assert.equal(l.state.failed, false);
    const x = lab('WM');
    x.state.setup.x = ['疯狂的真相'];
    x.state.setup.alternateY = '巨大定时炸弹X';
    phase(x, 'loop-start');
    x.state.ex = 2;
    assert.equal(x.state.flags['alternate-y'], undefined);
  },
);
check('sacrifice-intrigue-event', [393], '祭品不能用不安替代廷达罗斯密谋阈值', () => {
  const l = lab('WM');
  character(l, 'a', '男学生', '祭品').counters.paranoia = 9;
  event(l, '廷达罗斯之嗅');
  assert.equal(l.state.incidents.length, 0);
});
check(
  'wizard-completion',
  [396, 398, 399, 400],
  '巫师友好完成先公开，队长选EX；死亡巫师不公开',
  () => {
    for (const self of [false, true]) {
      const l = lab('WM');
      character(l, 'a', 'AI', '巫师').counters.goodwill = 3;
      character(l, 'b', '男学生', '关键人物', 'city');
      l.state.setup.incidents = [{ day: 1, name: '疯狂杀人', culprit: 'a' }];
      ability(l, 'a', 'ai', { incident: '疯狂杀人' });
      drain(l, [self ? 'a' : 'b', 'no']);
      assert.equal(
        l.state.observations.protagonists.some(
          (o) => o.type === 'identity' && o.data.identity === '巫师',
        ),
        !self,
      );
    }
  },
);
check('hound-prior', [405], '廷达罗斯只在之后发生事件时杀主人公', () => {
  const l = lab('WM');
  character(l, 'a', '男学生').counters.intrigue = 2;
  l.state.incidents = [{ loop: 1, day: 2, name: '疯狂杀人', publicName: '疯狂杀人', culprit: 'a' }];
  l.state.day = 3;
  event(l, '廷达罗斯之嗅');
  drain(l);
  assert.equal(l.state.protagonistDead, false);
});
