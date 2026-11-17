import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import type { SetupDomain } from '../../packages/contracts/src/setup-domain.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import { initialize } from '../../packages/engine/src/runtime/engine.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import { adviseObservedGame } from '../../scripts/engine/observed-game.js';

const fixtures: { id: string; setup: GameSetup }[] = JSON.parse(
  readFileSync(new URL('./fixtures/official-scenarios.json', import.meta.url), 'utf8'),
);
function known(s: GameSetup): SetupDomain {
  return {
    characters: s.characters.map(({ identity, reverseIdentity, ...c }) => ({
      ...c,
      roles: [reverseIdentity ? ([identity, reverseIdentity] as [string, string]) : identity],
    })),
    plots: [{ y: s.y, x: s.x, alternateY: s.alternateY, secretAddition: s.secretAddition }],
    incidents: s.incidents.map((i) => ({ day: i.day, names: [i.name], culprits: [i.culprit] })),
    privateRoles: s.privateRoles,
    anniversaryFragments: s.anniversaryFragment ? [s.anniversaryFragment] : undefined,
  };
}
function question(s: GameSetup) {
  const pack = compileOfficial(s.module, s.anniversary);
  const r = initialize(pack, s);
  assert.ok(r.state, JSON.stringify(r.diagnostics));
  return { pack, evidence: observeQuestion(r.state) };
}

test('首次说明只给剧本公开表，尚未放置的两个不同角色名单都留在解空间', () => {
  const a = fixtures[0]!.setup;
  const b = {
    ...a,
    characters: a.characters.map((c) =>
      c.identity === '平民' ? { ...c, id: 'replacement', character: '大小姐' } : c,
    ),
  };
  const x = question(a),
    y = question(b);
  assert.deepEqual(x.evidence, y.evidence);
  assert.deepEqual(x.evidence.view.ownCards, []);
  assert.deepEqual(x.evidence.view.characters, []);
  const res = adviseObservedGame({
    setups: [a, b],
    exhaustiveSetups: true,
    evidence: x.evidence,
    workLimit: 1,
  });
  assert.equal(res.history.worlds, 2);
});

test('HSA 群体事件可在两天重复同一地区；MZ 同一事件表保留真事件及伪造事件', () => {
  const base = fixtures.find((f) => f.setup.module === 'HSA')!.setup;
  const s = {
    ...base,
    days: base.days + 2,
    incidents: [
      ...base.incidents,
      { day: base.days + 1, name: '疯狂之夜', culprit: 'city' },
      { day: base.days + 2, name: '疯狂之夜', culprit: 'city' },
    ],
  };
  const { pack, evidence } = question(s);
  assert.equal([...generateSetups(pack, evidence, [known(s)], 20000).setups].length, 1);
  const m = fixtures.find((f) => f.setup.module === 'MZ')!.setup,
    mq = question(m),
    d = known(m);
  const i = d.incidents![0]!;
  i.names = [m.incidents[0]!.name, '伪造事件'];
  const rs = [...generateSetups(mq.pack, mq.evidence, [d], 5000).setups];
  assert.deepEqual(
    new Set(rs.map((s) => s.incidents.find((e) => e.day === i.day)!.name)),
    new Set(i.names),
  );
});

test('局外人使用池外身份，模仿犯复制完整身份；转校生和神灵的有限登场日与轮次', () => {
  const base = fixtures.find((f) => f.setup.module === 'FS')!.setup;
  const setup = {
    ...base,
    characters: [
      ...base.characters,
      { id: 'outside', character: '局外人', identity: '亲友' },
      { id: 'copy', character: '模仿犯', identity: '亲友', copiedFrom: 'outside' },
      { id: 'transfer', character: '转校生', identity: '平民', enterDay: 1 },
      { id: 'divine', character: '神灵', identity: '平民', enterLoop: 1 },
    ],
  };
  const { pack, evidence } = question(setup),
    d = known(setup);
  const outside = d.characters.find((c) => c.id === 'outside')!;
  outside.roles = ['亲友', '关键人物', '平民'];
  delete d.characters.find((c) => c.id === 'copy')!.roles;
  delete d.characters.find((c) => c.id === 'transfer')!.enterDay;
  delete d.characters.find((c) => c.id === 'divine')!.enterLoop;
  const rows = [...generateSetups(pack, evidence, [d], 10000).setups];
  assert.equal(rows.length, setup.days * setup.loops);
  assert.ok(rows.every((s) => s.characters.find((c) => c.id === 'copy')!.identity === '亲友'));
});
for (const { id, setup } of fixtures)
  test(id + ' 逐字段还原固定域的合法剧本', () => {
    const { pack, evidence } = question(setup);
    const g = generateSetups(pack, evidence, [known(setup)], 5000);
    const rows = [...g.setups];
    assert.equal(g.stats.complete, true);
    assert.equal(rows.length, 1);
    const normalized = (s: GameSetup) =>
      canonical({ ...s, incidents: [...s.incidents].sort((a, b) => a.day - b.day) });
    assert.equal(normalized(rows[0]!), normalized(setup));
  });

test('FS 四个普通角色、两个不同当事人：与 4096 个未经剪枝的独立候选逐一比较，再复核每个角色域子集', () => {
  const setup: GameSetup = {
    module: 'FS',
    anniversary: false,
    loops: 1,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '守护此地',
    x: ['流言四起'],
    characters: ['男学生', '女学生', '医生', '巫女'].map((character, i) => ({
      character,
      id: 'c' + i,
      identity: ['关键人物', '邪教徒', '传谣人', '平民'][i]!,
    })),
    incidents: [
      { day: 1, name: '自杀', culprit: 'c0' },
      { day: 2, name: '谋杀', culprit: 'c1' },
    ],
  };
  const { pack, evidence } = question(setup);
  const roles = setup.characters.map((c) => c.identity);
  const expected: GameSetup[] = [];
  for (const a of roles)
    for (const b of roles)
      for (const c of roles)
        for (const d of roles)
          for (const first of setup.characters)
            for (const second of setup.characters) {
              const s = {
                ...setup,
                characters: setup.characters.map((t, i) => ({ ...t, identity: [a, b, c, d][i]! })),
                incidents: setup.incidents.map((t, i) => ({
                  ...t,
                  culprit: i ? second.id : first.id,
                })),
              };
              if (!validateSetup(pack, s).length) expected.push(s);
            }
  assert.equal(expected.length, 288);
  for (let mask = 0; mask < 16; mask++) {
    const allowed = roles.filter((_, i) => mask & (1 << i));
    const domain: SetupDomain = {
      characters: setup.characters.map(({ id, character }, i) => ({
        id,
        character,
        ...(!i && { roles: allowed }),
      })),
      plots: [{ y: setup.y, x: setup.x }],
    };
    const g = generateSetups(pack, evidence, [domain], 30000);
    assert.deepEqual(
      new Set([...g.setups].map(canonical)),
      new Set(expected.filter((s) => allowed.includes(s.characters[0]!.identity)).map(canonical)),
    );
    assert.equal(g.stats.complete, true);
    assert.ok(g.stats.validated <= 288);
  }
});

test('周年残片放在平民上，LL 的六种隐匿座位顺序，AHR 的正反身份对保持完整', () => {
  const basic = fixtures.find((f) => f.setup.module === 'BTX')!.setup;
  const setup = {
    ...basic,
    anniversary: true,
    anniversaryFragment: basic.characters.find((c) => c.identity === '平民')!.id,
  };
  const { pack, evidence } = question(setup),
    d = known(setup);
  delete d.anniversaryFragments;
  assert.deepEqual(
    [...generateSetups(pack, evidence, [d], 5000).setups].map((s) => s.anniversaryFragment).sort(),
    basic.characters
      .filter((c) => c.identity === '平民')
      .map((c) => c.id)
      .sort(),
  );
  const ll = fixtures.find((f) => f.setup.module === 'LL')!.setup,
    llq = question(ll),
    ld = known(ll);
  delete ld.privateRoles;
  assert.equal(
    new Set(
      [...generateSetups(llq.pack, llq.evidence, [ld], 10000).setups].map((s) =>
        canonical(s.privateRoles),
      ),
    ).size,
    6,
  );
  const ahr = fixtures.find((f) => f.setup.module === 'AHR')!.setup,
    aq = question(ahr),
    ad = known(ahr);
  const pairSlots = ad.characters.filter((c) => Array.isArray(c.roles![0]));
  for (const slot of pairSlots) delete slot.roles;
  const rows = [...generateSetups(aq.pack, aq.evidence, [ad], 5000).setups];
  assert.ok(rows.length >= 1);
  for (const row of rows)
    assert.deepEqual(
      row.characters
        .filter((c) => c.reverseIdentity)
        .map((c) => [c.identity, c.reverseIdentity].join('/'))
        .sort(),
      ahr.characters
        .filter((c) => c.reverseIdentity)
        .map((c) => [c.identity, c.reverseIdentity].join('/'))
        .sort(),
    );
});

test('从受限制角色表直接构建完整医院问题，生成预算和无界参数都不能给出保证', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/observed-game-example.json', import.meta.url),
      'utf8',
    ),
  );
  const d: SetupDomain = q.setupDomains[0];
  const result = adviseObservedGame(q);
  assert.equal(result.generation?.legal, 2);
  assert.equal(result.history.worlds, 4);
  assert.equal(result.advice.status, 'guaranteed');
  const cut = adviseObservedGame({ ...q, setupDomains: [d], generationWorkLimit: 1 });
  assert.equal(cut.generation?.limited, true);
  assert.equal(cut.advice.status, 'unknown');
  const unbounded = adviseObservedGame({
    ...q,
    setupDomains: [{ ...d, characters: [...d.characters, { id: 'sage', character: '仙人' }] }],
  });
  assert.equal(unbounded.generation?.unsupported, true);
  assert.equal(unbounded.advice.status, 'unknown');
});
