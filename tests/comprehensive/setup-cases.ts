import assert from 'node:assert/strict';
import { check } from './cases.js';
import { lab as rawLab, character } from './harness.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { initialize } from '../../packages/engine/src/runtime/engine.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { fixtures } from '../engine/official-harness.js';
import type { GameSetup, Module } from '../../packages/contracts/src/game.js';
function lab(module: Module = 'BTX', anniversary = false) {
  const l = rawLab(module, anniversary);
  l.state.setup.y = Object.values(l.pack.plots).find((p) => p.type === 'Y')!.name;
  l.state.setup.x = Object.values(l.pack.plots)
    .filter((p) => p.type === 'X')
    .slice(0, module === 'FS' ? 1 : 2)
    .map((p) => p.name);
  return l;
}
const ahr = (): GameSetup => ({
  module: 'AHR',
  anniversary: false,
  days: 4,
  loops: 3,
  captain: 'p0',
  discussion: 'allowed',
  y: '闭锁的未来',
  x: ['超越世界线', '傀儡之线'],
  incidents: [],
  characters: [
    { id: 'a', character: '男学生', identity: '强迫症', reverseIdentity: '关键人物' },
    { id: 'b', character: '女学生', identity: '提线木偶' },
    { id: 'c', character: '医生', identity: '叙述者' },
    { id: 'd', character: '巫女', identity: '传谣人' },
    { id: 'e', character: '住院患者', identity: '因果残片' },
    { id: 'f', character: '偶像', identity: '布道者' },
    { id: 'g', character: 'AI', identity: '平民', reverseIdentity: '杀人狂' },
  ],
});
check(
  'setup-pairs',
  [0, 4, 5, 6, 185, 435, 436, 438],
  'AHR完整身份对：禁止混配、局外人不持成对身份、AI妹妹豁免与模仿犯复制',
  () => {
    const pack = compileOfficial('AHR');
    let s = ahr();
    assert.deepEqual(validateSetup(pack, s), []);
    s.characters[0]!.character = '妹妹';
    assert.deepEqual(validateSetup(pack, s), []);
    s.characters.push({
      id: 'copy',
      character: '模仿犯',
      identity: '强迫症',
      reverseIdentity: '关键人物',
      copiedFrom: 'a',
    });
    assert.deepEqual(validateSetup(pack, s), []);
    s.characters[0]!.reverseIdentity = '主谋';
    assert.ok(validateSetup(pack, s).some((d) => d.code === 'identity-pairs'));
    s = ahr();
    s.characters.push({ id: 'out', character: '局外人', identity: '强迫症' });
    assert.ok(validateSetup(pack, s).some((d) => d.code === 'outsider-pool'));
    s.characters.at(-1)!.reverseIdentity = '关键人物';
    assert.ok(validateSetup(pack, s).some((d) => d.code === 'outsider-pool'));
  },
);
check(
  'setup-arrival',
  [122, 153, 154],
  '登场轮日必须固定且在剧本范围内，允许更早事件由晚登场角色担当',
  () => {
    const l = lab();
    character(l, 'a', '神灵');
    l.state.setup.characters[3]!.enterLoop = 4;
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'missing-enter-loop'));
    character(l, 'a', '转校生');
    const c = l.state.setup.characters.find((c) => c.id === 'a')!;
    c.enterDay = 3;
    l.state.setup.incidents = [{ day: 2, name: '自杀', culprit: 'a' }];
    assert.ok(
      !validateSetup(l.pack, l.state.setup).some((d) =>
        ['missing-enter-day', 'invalid-culprit'].includes(d.code),
      ),
    );
    c.enterDay = 5;
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'missing-enter-day'));
    c.enterDay = 'EX+1' as never;
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'invalid-setup'));
  },
);
check(
  'setup-character-constraints',
  [186, 195, 197, 200, 315, 369, 373, 375, 426, 429],
  '从者仙人初始区域、仙人X、临时工书写、少女与男性限制',
  () => {
    const l = lab();
    character(l, 'a', '从者');
    delete l.state.setup.characters.find((c) => c.id === 'a')!.initialArea;
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'invalid-initial-area'));
    character(l, 'a', '手下', '平民', 'far');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'invalid-initial-area'));
    character(l, 'a', '仙人');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'missing-x'));
    character(l, 'a', '临时工？');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'invalid-setup-card'));
    character(l, 'a', '临时工', '强迫症');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'required-culprit'));
    character(l, 'a', '临时工', '关键人物');
    l.state.setup.y = '和我签订契约吧！';
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'required-attribute'));
    const m = lab('MZ');
    character(m, 'a', '男学生', '忍者');
    m.state.setup.y = '男子汉的战争';
    assert.ok(validateSetup(m.pack, m.state.setup).some((d) => d.code === 'required-attribute'));
  },
);
check('setup-copycat-attributes', [179], '模仿犯也应满足身份对应的剧本制作属性限制', () => {
  const l = lab();
  l.state.setup.y = '和我签订契约吧！';
  character(l, 'a', '女学生', '关键人物');
  character(l, 'b', '模仿犯', '关键人物');
  l.state.setup.characters.find((c) => c.id === 'b')!.copiedFrom = 'a';
  assert.ok(
    validateSetup(l.pack, l.state.setup).some(
      (d) => d.code === 'required-attribute' && d.path.includes('b'),
    ),
  );
});
check(
  'setup-outsider',
  [125, 127, 128, 180, 212],
  '局外人只能取当前模组且不被规则直接分配的身份，模仿犯可复制',
  () => {
    const l = lab();
    character(l, 'a', '局外人', '侦探');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'unsupported-identity'));
    l.state.setup.x = ['妄想扩大病毒'];
    character(l, 'a', '局外人', '杀人狂');
    assert.ok(!validateSetup(l.pack, l.state.setup).some((d) => d.code === 'outsider-pool'));
    character(l, 'b', '模仿犯', '杀人狂');
    l.state.setup.characters.find((c) => c.id === 'b')!.copiedFrom = 'a';
    assert.ok(!validateSetup(l.pack, l.state.setup).some((d) => d.code === 'copycat-identity'));
    const h = lab('HSA');
    h.state.setup.y = '古墓活尸';
    character(h, 'a', '局外人', '丧尸');
    assert.ok(!validateSetup(h.pack, h.state.setup).some((d) => d.code === 'outsider-pool'));
  },
);
check(
  'setup-secret-addition',
  [130, 282, 283, 468],
  '捏造秘密追加身份不应占用局外人的规则自带身份池',
  () => {
    const l = lab('LL');
    l.state.setup.y = '恶魔的剧本';
    l.state.setup.x = ['捏造的秘密'];
    l.state.setup.secretAddition = '杀手';
    l.state.setup.privateRoles = { p0: 'A', p1: 'B', p2: 'C' };
    character(l, 'a', '局外人', '杀手');
    assert.ok(!validateSetup(l.pack, l.state.setup).some((d) => d.code === 'outsider-pool'));
    character(l, 'a', '局外人', '密钥');
    character(l, 'b', '女学生', '杀手');
    assert.ok(
      validateSetup(l.pack, l.state.setup).some(
        (d) => d.code === 'identity-pool' && d.message.includes('杀手'),
      ),
    );
  },
);
check(
  'setup-true-incidents',
  [330, 340, 347, 349, 352],
  '真实连续杀人才能共用当事人；伪造命名不改变真实事件约束',
  () => {
    const l = lab('MZ');
    for (const names of [
      ['连续杀人', '连续杀人'],
      ['伪造事件', '连续杀人'],
      ['阴谋活动', '阴谋活动'],
    ]) {
      l.state.setup.incidents = names.map((name, i) => ({
        day: i + 1,
        name,
        culprit: 'a',
        ...(name === '伪造事件' ? { publicName: '连续杀人' } : {}),
      }));
      assert.equal(
        validateSetup(l.pack, l.state.setup).some((d) => d.code === 'repeated-culprit'),
        names[0] !== '连续杀人',
      );
    }
    l.state.setup.x = ['灭亡讴歌'];
    l.state.setup.incidents = [{ day: 1, name: '伪造事件', publicName: '自杀', culprit: 'a' }];
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'required-incident'));
    assert.ok(!validateSetup(l.pack, l.state.setup).some((d) => d.code === 'invalid-public-name'));
  },
);
check(
  'setup-opposite-sex',
  [246, 247, 427],
  '吸血鬼神灵可配男性或女性关键人物，AI无性别不能配',
  () => {
    const l = lab('HSA');
    l.state.setup.y = '高贵的血族';
    character(l, 'a', '神灵', '吸血鬼');
    for (const name of ['男学生', '女学生', '医生', '护士']) {
      character(l, 'b', name, '关键人物');
      assert.ok(
        !validateSetup(l.pack, l.state.setup).some((d) => d.code === 'opposite-sex-required'),
      );
    }
    character(l, 'b', 'AI', '关键人物');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'opposite-sex-required'));
  },
);
check('fs-plus-x-count', [93], 'FS+仍一个X槽，提供第四个X规则超越世界线', () => {
  const pack = compileOfficial('FS', true);
  assert.equal(Object.values(pack.plots).filter((p) => p.type === 'X').length, 4);
  assert.ok(pack.plots['超越世界线']);
});
check(
  'plus-fragment-allocation',
  [92, 94, 95, 131, 434],
  '因果残片在身份分配后覆盖平民；模仿犯先模仿平民再覆盖，局外人不可取',
  () => {
    const l = lab('BTX', true);
    character(l, 'a', '局外人', '因果残片');
    assert.ok(validateSetup(l.pack, l.state.setup).some((d) => d.code === 'outsider-pool'));
    const setup = structuredClone(fixtures.find((f) => f.setup.module === 'FS')!.setup);
    setup.anniversary = true;
    setup.characters.push({
      id: 'copy',
      character: '模仿犯',
      identity: '平民',
      copiedFrom: 'boyStudent',
    });
    setup.anniversaryFragment = 'copy';
    const r = initialize(compileOfficial('FS', true), setup);
    assert.deepEqual(r.diagnostics, []);
    assert.equal(r.state!.characters.copy!.initialIdentity, '因果残片');
    assert.equal(r.state!.characters.boyStudent!.initialIdentity, '平民');
  },
);
