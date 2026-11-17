import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clone } from '../../packages/engine/src/runtime/model.js';
import {
  maximizeCoverage,
  verifyCoverage,
  compareCoverage,
} from '../../packages/engine/src/decision/coverage.js';
import { coverageQuestion } from '../../scripts/engine/script-coverage.js';
import {
  resolveReplayQuestion,
  type ReplayQuestion,
} from '../../scripts/engine/candidate-replays.js';
import { lab, character, phase } from '../comprehensive/harness.js';
const fixture = (name: string): ReplayQuestion =>
  JSON.parse(
    readFileSync(
      new URL('../../products/engine/' + name + '-example.json', import.meta.url),
      'utf8',
    ),
  );
const game = { kind: 'game' } as const;

test('两个合法剧本在最终决战只能保证其中一个；重复重放及调换剧本书写顺序不增加票数', () => {
  const q = fixture('final-decision'),
    first = q.candidates[0]!;
  const variant = clone(first);
  variant.setup.x.reverse();
  variant.setup.characters.reverse();
  variant.setup.incidents.reverse();
  for (const c of variant.setup.characters) c.enterLoop ??= 1;
  q.candidates.push(variant, first, first, first);
  const r = coverageQuestion(q).coverage!;
  assert.equal(r.scripts, 2);
  assert.equal(r.status, 'optimal');
  assert.equal(r.lower, 1);
  assert.equal(r.upper, 1);
  assert.equal(r.evaluations, 1);
  const check = coverageQuestion(q, r.policy!).verification!;
  assert.deepEqual([check.verified, check.refuted, check.unresolved], [1, 1, 0]);
  const pool = resolveReplayQuestion(q);
  assert.equal(maximizeCoverage(pool.pack, pool.candidates, game, 0).upper, 1);
});

test('周年平民答案同时覆盖平民与因果残片，选择人数最多的联合答案类', () => {
  const counts = [
    ['平民', 'a'],
    ['平民', 'b'],
    ['平民', 'c'],
    ['因果残片', 'a'],
    ['因果残片', 'b'],
    ['时间旅者', 'd'],
  ] as const;
  const states = counts.map(([role, culprit]) => {
    const l = lab('BTX', true);
    character(l, 'a', '男学生', role);
    l.state.setup.incidents = [{ day: 1, name: '自杀', culprit }];
    phase(l, 'final-guess');
    return l.state;
  });
  const pack = lab('BTX', true).pack;
  for (const order of [states, [...states].reverse()]) {
    const pool = { exhaustive: true, states: order };
    const a = maximizeCoverage(pack, pool, game, 10000);
    assert.deepEqual([a.lower, a.upper, a.scripts, a.evaluations], [5, 5, 6, 1]);
    const v = verifyCoverage(pack, pool, game, a.policy!, 10000);
    assert.deepEqual([v.verified, v.refuted, v.unresolved], [5, 1, 0]);
  }
});

function hospital(role: string, culprit: string) {
  const l = lab();
  for (const [id, name] of [
    ['a', '男学生'],
    ['b', '女学生'],
  ] as const) {
    const c = character(l, id, name, '平民', 'hospital');
    c.counters.paranoia = c.paranoiaLimit;
  }
  character(l, 'c', '医生', '平民', 'hospital').counters.goodwill = 2;
  character(l, 'd', '职员', role, 'city').counters.goodwill = 3;
  l.state.boards.hospital = 1;
  l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit }];
  phase(l, 'protagonist-abilities');
  return l;
}
test('医院复合规则的 45 个问题：一次能力选择救一方，两次可依据身份公告再选择，对照最优覆盖数', () => {
  const worlds = ['平民', '时间旅者'].flatMap((role) =>
    ['a', 'b'].map((culprit) => ({ role, culprit, l: hospital(role, culprit) })),
  );
  let questions = 0;
  for (let mask = 1; mask < 16; mask++) {
    const chosen = worlds.filter((_, i) => mask & (1 << i));
    const best = (rows: typeof chosen) =>
      Math.max(...['a', 'b'].map((id) => rows.filter((w) => w.culprit === id).length));
    const pool = { exhaustive: true, states: chosen.map((w) => w.l.state) };
    for (const maxAbilities of [0, 1, 2]) {
      const expected =
        maxAbilities === 0
          ? 0
          : maxAbilities === 1
            ? best(chosen)
            : best(chosen.filter((w) => w.role === '平民')) +
              best(chosen.filter((w) => w.role === '时间旅者'));
      const goal = { kind: 'survival', target: 'c', maxAbilities } as const;
      const a = maximizeCoverage(worlds[0]!.l.pack, pool, goal, 200000);
      assert.deepEqual(
        [a.status, a.lower, a.upper],
        ['optimal', expected, expected],
        mask + '/' + maxAbilities,
      );
      if (a.policy) {
        const v = verifyCoverage(worlds[0]!.l.pack, pool, goal, a.policy, 200000);
        assert.deepEqual(
          [v.verified, v.refuted, v.unresolved],
          [expected, chosen.length - expected, 0],
        );
      }
      questions++;
    }
  }
  assert.equal(questions, 45);
});

test('同一剧本中有一个隐蔽结算始终无法保护即不计入覆盖；搜索截断只能给上下界', () => {
  const a = hospital('平民', 'a'),
    b = hospital('时间旅者', 'b');
  const doomed = clone(a.state);
  doomed.delayed = [
    { loop: 1, day: 1, timing: 'day-end', effects: [{ op: 'kill', target: 'c' }], env: {} },
  ];
  const full = { exhaustive: true, states: [a.state, doomed, b.state] };
  const goal = { kind: 'survival', target: 'c', maxAbilities: 2 } as const;
  for (const cap of [0, 1, 2, 3, 6, 256]) {
    const r = maximizeCoverage(a.pack, full, goal, 50000, cap);
    assert.ok(r.lower <= 1 && r.upper! >= 1);
    assert.equal(r.scripts, 2);
    if (r.status === 'optimal') assert.deepEqual([r.lower, r.upper], [1, 1]);
    if (cap === 256) assert.equal(r.status, 'optimal');
  }
  const partial = maximizeCoverage(a.pack, { ...full, exhaustive: false }, goal, 1000);
  assert.equal(partial.status, 'unknown');
  assert.equal(partial.upper, undefined);
  assert.equal(
    maximizeCoverage(a.pack, { exhaustive: true, states: [] }, goal, 0).status,
    'no-candidates',
  );
});

test('LL 旁座的未公开洗牌不会将一个剧本计成两个，个人目标照常进行独立复核', () => {
  const q = fixture('seat-policy'),
    c = clone(q.candidates[0]!);
  const roles = c.setup.privateRoles!;
  [roles.p1, roles.p2] = [roles.p2, roles.p1];
  q.candidates.push(c);
  const r = coverageQuestion(q).coverage!;
  assert.deepEqual([r.status, r.lower, r.scripts], ['optimal', 1, 1]);
  assert.equal(coverageQuestion(q, r.policy!).verification?.verified, 1);
});

test('两个最终剧本、三种回答策略、全部非空候选子集的 27 组覆盖关系', () => {
  const q = fixture('final-decision');
  const pool = resolveReplayQuestion(q);
  const plans = q.candidates.map(
    (c) => coverageQuestion({ ...q, candidates: [c] }).coverage!.policy!,
  );
  const wrong = clone(plans[0]!);
  wrong.choice = { kind: 'guess', character: 'doctor', identity: '主谋' };
  plans.push(wrong);
  for (const mask of [1, 2, 3]) {
    const states = pool.candidates.states.filter((_, i) => mask & (1 << i));
    for (const [i, left] of plans.entries())
      for (const [j, right] of plans.entries()) {
        const l = mask & [1, 2, 0][i]!,
          r = mask & [1, 2, 0][j]!;
        const expected =
          l === r
            ? 'equivalent'
            : (l & r) === r
              ? 'left-superset'
              : (l & r) === l
                ? 'right-superset'
                : 'incomparable';
        const result = compareCoverage(
          pool.pack,
          { exhaustive: true, states },
          game,
          left,
          right,
          10000,
        );
        assert.equal(result.relation, expected, [mask, i, j].join('/'));
        assert.equal(result.scripts.length, states.length);
        assert.ok(result.work <= 10000);
        assert.deepEqual(
          result.scripts,
          compareCoverage(
            pool.pack,
            { exhaustive: true, states: [...states].reverse() },
            game,
            left,
            right,
            10000,
          ).scripts,
        );
      }
  }
  const both = coverageQuestion(q, plans[0], plans[1]).comparison!;
  assert.equal(both.relation, 'incomparable');
  assert.equal(
    both.scripts.filter((s) => s.left === 'verified' && s.right === 'refuted').length,
    1,
  );
  assert.equal(
    both.scripts.filter((s) => s.right === 'verified' && s.left === 'refuted').length,
    1,
  );
  for (const budget of [0, 1, 2, 4, 16, 64, 512]) {
    const result = compareCoverage(pool.pack, pool.candidates, game, plans[0]!, plans[1]!, budget);
    assert.ok(result.work <= budget);
    assert.ok(['unknown', 'incomparable'].includes(result.relation));
    if (!budget)
      assert.ok(result.scripts.every((s) => s.left === 'unresolved' && s.right === 'unresolved'));
  }
  assert.equal(
    coverageQuestion({ ...q, exhaustive: false }, plans[0], wrong).comparison!.relation,
    'unknown',
  );
  assert.equal(
    coverageQuestion({ ...q, candidates: [] }, plans[0], wrong).comparison!.relation,
    'no-candidates',
  );
});
test('同一剧本含必死的隐藏延迟结算时，两种保人策略都不能覆盖此剧本', () => {
  const l = hospital('平民', 'a'),
    other = hospital('时间旅者', 'b');
  const doomed = clone(l.state);
  doomed.delayed = [
    { loop: 1, day: 1, timing: 'day-end', effects: [{ op: 'kill', target: 'c' }], env: {} },
  ];
  const goal = { kind: 'survival', target: 'c', maxAbilities: 1 } as const;
  const [left, right] = [l, other].map(
    (w) => maximizeCoverage(w.pack, { exhaustive: true, states: [w.state] }, goal, 50000).policy!,
  );
  const r = compareCoverage(
    l.pack,
    { exhaustive: true, states: [doomed, other.state, l.state] },
    goal,
    left!,
    right!,
    50000,
  );
  assert.equal(r.relation, 'right-superset');
  assert.equal(r.scripts.filter((s) => s.left === 'refuted' && s.right === 'refuted').length, 1);
  assert.equal(r.scripts.filter((s) => s.left === 'refuted' && s.right === 'verified').length, 1);
});
