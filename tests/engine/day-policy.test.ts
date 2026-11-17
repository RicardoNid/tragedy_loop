import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Choice } from '../../packages/contracts/src/game.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import {
  findDayPolicy,
  nextDayPolicy,
  type DayPolicy,
} from '../../packages/engine/src/decision/day-policy.js';
import { solveDaySurvival } from '../../packages/engine/src/decision/day-survival.js';
import { adviseDayPolicy } from '../../scripts/engine/day-policy.js';
import { lab, character, phase, act, type Lab } from '../comprehensive/harness.js';

function hospital(culprit: string, role: string) {
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
function play(l: Lab, policy: DayPolicy) {
  const copy = { pack: l.pack, state: clone(l.state) };
  let node: DayPolicy | undefined = policy;
  const choices: Choice[] = [];
  while (copy.state.day === 1 && copy.state.phase !== 'loop-end' && !copy.state.winner) {
    const d = copy.state.pending!;
    if (d.actor === copy.state.captain && copy.state.phase === 'protagonist-abilities') {
      assert.ok(node);
      choices.push(node.choice);
      act(copy, node.choice);
      node = nextDayPolicy(node, copy.state);
    } else {
      act(copy, d.options[0]!);
    }
  }
  assert.equal(copy.state.characters.c!.status, 'alive');
  return choices;
}

test('医院事故的四种身份与当事人组合：所有非空子集在零、一次、两次发动上限下均符合手算', () => {
  const worlds = ['平民', '时间旅者'].flatMap((role) =>
    ['a', 'b'].map((culprit) => ({
      role,
      culprit,
      lab: hospital(culprit, role),
    })),
  );
  for (let mask = 1; mask < 16; mask++) {
    const set = worlds.filter((_, i) => mask & (1 << i));
    const pack = set[0]!.lab.pack;
    const candidates = { exhaustive: true, states: set.map((w) => w.lab.state) };
    const same = new Set(set.map((w) => w.culprit)).size === 1;
    const identifiable = set.every((w) =>
      set.every((v) => v.role !== w.role || v.culprit === w.culprit),
    );
    for (const max of [0, 1, 2]) {
      const canSave = max > 0 && (same || (max === 2 && identifiable));
      const advice = findDayPolicy(pack, candidates, 'c', max, 30000);
      assert.equal(
        advice.status,
        canSave ? 'guaranteed' : 'no-guaranteed-policy',
        mask + '/' + max,
      );
      if (advice.policy)
        for (const w of set) {
          const line = play(w.lab, advice.policy);
          assert.ok(line.some((c) => c.kind === 'select' && c.value === w.culprit));
          if (!same) {
            assert.deepEqual(line[0], { kind: 'ability', owner: 'd', ability: 'office-worker' });
            assert.ok(
              solveDaySurvival(pack, candidates, 'c', [line], 1500)[0]?.status === 'counterexample',
            );
          }
        }
    }
  }
});

test('保留不可区分的私有上下文，覆盖拒绝、预算和未知规则', () => {
  const l = hospital('a', '平民');
  const other = hospital('b', '平民');
  other.state.serial += 9;
  other.state.pending!.id = 'unrelated-id';
  other.state.audit.push({ kind: 'private', data: 'b' });
  other.state.observations.mastermind.push({
    sequence: 1,
    loop: 1,
    day: 1,
    phase: 'incident',
    type: 'culprit',
    data: { culprit: 'b' },
  });
  const both = { exhaustive: true, states: [l.state, other.state] };
  const before = canonical(both);
  assert.equal(findDayPolicy(l.pack, both, 'c', 2, 10000).status, 'no-guaranteed-policy');
  assert.equal(canonical(both), before);
  assert.equal(findDayPolicy(l.pack, both, 'c', 2, 1).reason, 'limit');
  assert.equal(
    findDayPolicy(l.pack, { ...both, exhaustive: false }, 'c', 2, 500).reason,
    'incomplete',
  );
  assert.equal(findDayPolicy(l.pack, { ...both, states: [] }, 'c', 2, 500).status, 'no-candidates');
  l.state.characters.c!.counters.despair = 1;
  assert.equal(
    findDayPolicy(l.pack, { ...both, states: [l.state] }, 'c', 2, 20000).status,
    'no-guaranteed-policy',
  );
  l.state.setup.publicSpecialRules = ['特规'];
  assert.equal(
    findDayPolicy(l.pack, { ...both, states: [l.state] }, 'c', 2, 500).reason,
    'unsupported',
  );
});

test('合法重放经策略 CLI 入口得到医生方案', () => {
  const input = JSON.parse(
    readFileSync(
      new URL('../../products/engine/day-survival-example.json', import.meta.url),
      'utf8',
    ),
  );
  const advice = adviseDayPolicy(input);
  assert.equal(advice.status, 'guaranteed');
  assert.deepEqual(advice.policy?.choice, {
    kind: 'ability',
    owner: 'doctor',
    ability: 'doctor-counter',
  });
  assert.equal(adviseDayPolicy({ ...input, maxAbilities: 0 }).status, 'no-guaranteed-policy');
});
