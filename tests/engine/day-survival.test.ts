import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Choice } from '../../packages/contracts/src/game.js';
import { advance } from '../../packages/engine/src/runtime/engine.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import {
  findDaySurvival,
  solveDaySurvival,
} from '../../packages/engine/src/decision/day-survival.js';
import { adviseSurvival } from '../../scripts/engine/day-survival.js';
import { lab, character, phase } from '../comprehensive/harness.js';

const guard: Choice = { kind: 'ability', owner: 'a', ability: 'detective-guard' };
const plans: Choice[][] = [
  [{ kind: 'pass' }],
  [guard],
  [guard, { kind: 'select', value: 'a' }],
  [guard, { kind: 'select', value: 'b' }],
];
function world(killer: boolean, immortal: boolean, incident: boolean) {
  const l = lab();
  character(l, 'a', '刑警', killer ? '杀人狂' : '平民', 'school').counters.goodwill = 5;
  const b = character(l, 'b', '女学生', immortal ? '时间旅者' : '平民', 'school');
  b.counters.paranoia = b.paranoiaLimit;
  l.state.setup.incidents = [{ day: 1, name: '自杀', culprit: incident ? 'b' : 'c' }];
  phase(l, 'protagonist-abilities');
  assert.equal(l.state.pending?.kind, 'ability');
  return { s: l.state, pack: l.pack, hits: immortal ? 0 : Number(killer) + Number(incident) };
}

test('两种死亡来源和免死的八个世界，对照 255 个非空集合的四种保人方案', () => {
  const worlds = [false, true].flatMap((k) =>
    [false, true].flatMap((t) => [false, true].map((i) => world(k, t, i))),
  );
  const pack = worlds[0]!.pack;
  for (let mask = 1; mask < 256; mask++) {
    const selected = worlds.filter((_, i) => mask & (1 << i));
    const group = { exhaustive: true, states: selected.map((w) => w.s) };
    const worst = Math.max(...selected.map((w) => w.hits));
    const results = solveDaySurvival(pack, group, 'b', plans, 1000);
    // An unspecified target can always be the detective. Only explicitly guarding B absorbs one request.
    assert.deepEqual(
      results.map((r) => r.status),
      plans.map((_, i) => (worst <= Number(i === 3) ? 'guaranteed' : 'counterexample')),
      String(mask),
    );
    const found = findDaySurvival(pack, group, 'b', 1000, 20);
    assert.equal(found.status, worst <= 1 ? 'guaranteed' : 'no-guaranteed-plan', String(mask));
    if (worst === 1) assert.deepEqual(found.plan, plans[3]);
  }
});
test('拒绝分支、复活前已死亡、提前结束、观察不同和预算不足', () => {
  const { pack, s } = world(true, false, false);
  const evaluate = (state: typeof s, budget = 500) =>
    solveDaySurvival(pack, { exhaustive: true, states: [state] }, 'b', [plans[3]!], budget)[0]!;
  const original = canonical(s);
  assert.equal(evaluate(s).status, 'guaranteed');
  assert.equal(canonical(s), original);
  assert.equal(evaluate(s, 0).status, 'unknown');
  const refused = clone(s);
  refused.characters.a!.counters.despair = 1;
  assert.equal(evaluate(refused).reason, 'death');
  const early = clone(s);
  early.delayed = [
    { loop: 1, day: 1, timing: 'incident', env: {}, effects: [{ op: 'protagonist-death' }] },
  ];
  assert.equal(
    solveDaySurvival(pack, { exhaustive: true, states: [early] }, 'b', [plans[0]!], 200)[0]!.status,
    'guaranteed',
  );
  const revived = world(false, false, false).s;
  revived.delayed = [
    { loop: 1, day: 1, timing: 'incident', env: {}, effects: [{ op: 'kill', target: 'b' }] },
    {
      loop: 1,
      day: 1,
      timing: 'captain-change',
      env: {},
      effects: [{ op: 'revive', target: 'b' }],
    },
  ];
  assert.equal(
    solveDaySurvival(pack, { exhaustive: true, states: [revived] }, 'b', [plans[0]!], 200)[0]!
      .reason,
    'death',
  );
  const pass = advance(pack, revived, revived.captain, {
    id: 'verify-revival',
    decisionId: revived.pending!.id,
    expectedRevision: revived.revision,
    choice: { kind: 'pass' },
  });
  assert.equal(pass.state.day, 2);
  assert.equal(pass.state.characters.b!.status, 'alive');
  const other = clone(s);
  other.boards.city = 1;
  assert.throws(
    () => findDaySurvival(pack, { exhaustive: true, states: [s, other] }, 'b', 200, 10),
    /Different observed/,
  );
  assert.equal(
    findDaySurvival(pack, { exhaustive: true, states: [s] }, 'b', 500, 1).status,
    'unknown',
  );
  assert.equal(
    findDaySurvival(pack, { exhaustive: false, states: [s] }, 'b', 500, 20).status,
    'unknown',
  );
  assert.equal(
    findDaySurvival(pack, { exhaustive: true, states: [] }, 'b', 500, 20).status,
    'no-candidates',
  );
});
test('从合法开局重放到医院事故前，自动找出降低患者不安的方案', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/day-survival-example.json', import.meta.url),
      'utf8',
    ),
  );
  const result = adviseSurvival(q);
  assert.ok(!Array.isArray(result));
  assert.equal(result.status, 'guaranteed');
  assert.deepEqual(result.plan, [
    { kind: 'ability', owner: 'doctor', ability: 'doctor-counter' },
    { kind: 'select', value: 'remove' },
  ]);
  const explicit = adviseSurvival({ ...q, plans: [[{ kind: 'pass' }], result.plan] });
  assert.ok(Array.isArray(explicit));
  assert.deepEqual(
    explicit.map((r) => r.status),
    ['counterexample', 'guaranteed'],
  );
});
test('剧作家可任选谋杀对象，其他人被选中可以存活，有一个致死目标即不能保证', () => {
  const l = lab();
  character(l, 'a', '刑警', '平民', 'school').counters.goodwill = 5;
  character(l, 'b', '女学生', '平民', 'school');
  const c = character(l, 'c', '医生', '平民', 'school');
  c.counters.paranoia = c.paranoiaLimit;
  l.state.setup.incidents = [{ day: 1, name: '谋杀', culprit: 'c' }];
  phase(l, 'protagonist-abilities');
  const group = { exhaustive: true, states: [l.state] };
  assert.deepEqual(
    solveDaySurvival(l.pack, group, 'b', plans, 1000).map((r) => r.status),
    ['counterexample', 'counterexample', 'counterexample', 'guaranteed'],
  );
  const special = clone(l.state);
  special.setup.publicSpecialRules = ['特规'];
  assert.equal(
    findDaySurvival(l.pack, { exhaustive: true, states: [special] }, 'b', 1000, 20).status,
    'unknown',
  );
});
