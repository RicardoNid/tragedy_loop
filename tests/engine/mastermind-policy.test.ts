import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import { BOARDS, canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { findMastermindPolicy } from '../../packages/engine/src/decision/mastermind-policy.js';
import { nextPolicyStep } from '../../packages/engine/src/decision/policy-search.js';
import {
  mastermindQuestion,
  observedBoard,
  observedMenu,
} from '../../packages/engine/src/decision/position.js';
import { verifyPolicy } from '../../packages/engine/src/decision/verify-policy.js';
import {
  adviseMastermind,
  type MastermindQuestion,
} from '../../scripts/engine/mastermind-policy.js';
import { verifyPolicyQuestion } from '../../scripts/engine/verify-policy.js';
import { replayCandidates } from '../../scripts/engine/candidate-replays.js';
import { act, character, lab, phase, type Lab } from '../comprehensive/harness.js';

const game = { kind: 'mastermind-win' } as const,
  failure = { kind: 'loop-failure' } as const;
function scenario(): MastermindQuestion {
  return JSON.parse(
    readFileSync(
      new URL('../../products/engine/mastermind-policy-example.json', import.meta.url),
      'utf8',
    ),
  );
}
test('四个私有延迟条件的十五个子集分别前向结算；共同策略只能依赖观察得到的条件', () => {
  const l = conflict('FS', 0, 0, -1, false);
  const states = BOARDS.map((board) => {
    const s = clone(l.state);
    s.delayed = [
      {
        day: 1,
        loop: 1,
        timing: 'day-end',
        env: {},
        effects: [
          {
            op: 'when',
            condition: { cmp: 'ge', left: { counter: 'intrigue', target: board }, right: 1 },
            effects: [{ op: 'fail' }],
          },
        ],
      },
    ];
    return s;
  });
  assert.equal(new Set(states.map(mastermindQuestion)).size, 1);
  for (let mask = 1; mask < 16; mask++) {
    const pool = { exhaustive: true, states: states.filter((_, i) => mask & (1 << i)) };
    const r = findMastermindPolicy(l.pack, pool, game, 10000);
    assert.equal(r.status, pool.states.length === 1 ? 'guaranteed' : 'no-guaranteed-policy');
    if (r.policy) {
      assert.equal(verifyPolicy(l.pack, pool, r.policy, game, 10000).status, 'verified');
      assert.equal(
        verifyPolicy(l.pack, { ...pool, states }, r.policy, game, 10000).status,
        'counterexample',
      );
    }
  }
});

test('同一官方 LL 剧本六种实际发牌，剧作家在首次出牌时看到同一视野', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('./fixtures/official-scenarios.json', import.meta.url), 'utf8'),
  ) as { setup: GameSetup }[];
  const setup = fixtures.find((s) => s.setup.module === 'LL')!.setup;
  const pack = compileOfficial('LL');
  const roles = ['A', 'B', 'C'] as const;
  const deals = roles.flatMap((p0) =>
    roles
      .filter((v) => v !== p0)
      .map((p1) => ({
        ...setup,
        privateRoles: { p0, p1, p2: roles.find((r) => r !== p0 && r !== p1)! },
      })),
  );
  const states = [
    ...replayCandidates(
      pack,
      deals.map((setup) => ({ setup, choices: [{ actor: 'p0', choice: { kind: 'continue' } }] })),
    ),
  ];
  assert.equal(new Set(states.map(mastermindQuestion)).size, 1);
  assert.equal(findMastermindPolicy(pack, { exhaustive: true, states }, game, 0).reason, 'limit');
  for (const s of states) {
    assert.ok(s.ll);
    assert.equal(observedMenu(s, 0, 'mastermind').personalRole, undefined);
    assert.throws(() => observedMenu(s, 0, 'p1'), /owned/);
    assert.equal(observedBoard(s, 0, 'p1').personalRole, s.ll.roles.p1);
  }
});
test('合法 FS 从实际菜单行动，学校一枚密谋增至两枚赢得整局；同一入口复核错误的跳过', () => {
  const q = scenario(),
    pack = compileOfficial('FS');
  const [root] = replayCandidates(pack, q.candidates);
  for (const goal of [game, failure]) {
    const a = adviseMastermind({ ...q, goal });
    assert.equal(a.status, 'guaranteed');
    assert.equal(verifyPolicyQuestion({ ...q, goal }, a.policy!).verification.status, 'verified');
    const l = { pack, state: clone(root!) };
    let step = a.policy!;
    const choices: Choice[] = [];
    while (!l.state.winner && !(goal.kind === 'loop-failure' && l.state.failed)) {
      assert.equal(l.state.pending!.actor, 'mastermind');
      assert.equal(step.seat, 'mastermind');
      choices.push(step.choice);
      act(l, step.choice);
      if (l.state.pending?.actor === 'mastermind') {
        const next = nextPolicyStep(step, l.state);
        assert.ok(next);
        step = next;
      }
    }
    assert.ok(choices.some((c) => c.kind === 'select' && c.value === 'school'));
    assert.equal(l.state.boards.school, 2);
    assert.equal(l.state.winner, 'mastermind');
    const wrong = { ...a.policy!, choice: { kind: 'pass' } as const };
    const v = verifyPolicyQuestion({ ...q, goal }, wrong, true).verification;
    assert.equal(v.status, 'counterexample');
    assert.equal(v.reason, 'lost');
    assert.ok(v.hostWitness);
  }
});

function conflict(
  module: 'FS' | 'BTX',
  school: number,
  hospital: number,
  delta: number,
  doctor: boolean,
): Lab {
  const l = lab(module);
  l.state.setup.days = l.state.setup.loops = 1;
  l.state.setup.y = module === 'FS' ? '守护此地' : '';
  l.state.setup.x = ['流言四起'];
  const patient = character(l, 'b', '住院患者', '平民', 'hospital');
  patient.counters.paranoia = patient.paranoiaLimit + delta;
  character(l, 'c', '医生', '平民', 'hospital').counters.goodwill = doctor ? 2 : 0;
  l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'b' }];
  l.state.boards.school = school;
  l.state.boards.hospital = hospital;
  phase(l, 'mastermind-abilities');
  assert.equal(l.state.pending?.actor, 'mastermind');
  return l;
}
test('24 组学校与医院竞争，一次密谋选址，医生可选择降低犯人不安；胜负与手算一致', () => {
  let checked = 0;
  for (const school of [0, 1])
    for (const hospital of [0, 1])
      for (const delta of [-1, 0, 1])
        for (const doctor of [false, true]) {
          const l = conflict('FS', school, hospital, delta, doctor);
          // One intrigue can reach school 2 or hospital 2. In the latter case
          // the patient must still be at the incident threshold after any doctor move.
          const expected = school === 1 || (hospital === 1 && delta >= Number(doctor));
          const pool = { exhaustive: true, states: [l.state] };
          const a = findMastermindPolicy(l.pack, pool, game, 20000);
          assert.equal(
            a.status,
            expected ? 'guaranteed' : 'no-guaranteed-policy',
            [school, hospital, delta, doctor].join('/'),
          );
          if (a.policy)
            assert.equal(verifyPolicy(l.pack, pool, a.policy, game, 20000).status, 'verified');
          checked++;
        }
  assert.equal(checked, 24);
});

test('BTX 同样的医院事故可迫使本轮失败；普通最终猜测允许主人公答对，整局保证随之消失', () => {
  for (const loops of [1, 2]) {
    const l = conflict('BTX', 0, 1, 1, true);
    l.state.setup.loops = loops;
    const pool = { exhaustive: true, states: [l.state] };
    assert.equal(findMastermindPolicy(l.pack, pool, game, 10000).status, 'no-guaranteed-policy');
    const a = findMastermindPolicy(l.pack, pool, failure, 10000);
    assert.equal(a.status, 'guaranteed');
    assert.equal(verifyPolicy(l.pack, pool, a.policy!, failure, 10000).status, 'verified');
  }
});

test('剧作家观察只使用自有牌面和私人记录；LL 六种暗置分配归于同一可见局面', () => {
  const l = conflict('FS', 1, 0, 0, false);
  const original = l.state;
  original.setup.module = 'LL';
  original.ruleDigest = compileOfficial('LL').digest;
  const seats = ['A', 'B', 'C'] as const;
  const keys = new Set<string>();
  for (const p0 of seats)
    for (const p1 of seats.filter((r) => r !== p0)) {
      const roles = { p0, p1, p2: seats.find((r) => r !== p0 && r !== p1)! };
      const s = clone(original);
      s.setup.privateRoles = roles;
      s.ll = { roles, communicated: [], died: [], cAnswered: false, finalTraitorsDisabled: false };
      const secret = s.cards.find((c) => c.owner === 'p0')!;
      secret.status = 'set';
      s.placements = [{ card: secret.id, target: 'school' }];
      s.observations.protagonists.push({
        loop: 1,
        day: 1,
        phase: s.phase,
        type: 'own-choice',
        sequence: 1,
        data: { secret: p0 + p1 },
      });
      const view = observedMenu(s, 0, 'mastermind');
      assert.ok(view.ownCards.every((c) => c.owner === 'mastermind'));
      assert.deepEqual(view.placements, [{ owner: 'p0', target: 'school' }]);
      assert.equal(view.personalRole, undefined);
      assert.ok(!canonical(view).includes('"secret"'));
      keys.add(mastermindQuestion(s));
      const changed = clone(s);
      changed.setup.characters[0]!.identity = '关键人物';
      assert.notEqual(mastermindQuestion(s), mastermindQuestion(changed));
    }
  assert.equal(keys.size, 1);
});

test('预算、候选完备性、不同私有剧本与已发生的败北均有显式处理', () => {
  const l = conflict('FS', 1, 0, 0, false),
    s = l.state;
  const pool = { exhaustive: true, states: [s] };
  assert.equal(findMastermindPolicy(l.pack, pool, game, 0).reason, 'limit');
  assert.equal(
    findMastermindPolicy(l.pack, { ...pool, exhaustive: false }, failure, 500).reason,
    'incomplete',
  );
  assert.equal(
    findMastermindPolicy(l.pack, { ...pool, states: [] }, game, 30).status,
    'no-candidates',
  );
  const different = clone(s);
  different.setup.incidents[0]!.culprit = 'd';
  assert.throws(
    () => findMastermindPolicy(l.pack, { ...pool, states: [s, different] }, game, 500),
    /Different mastermind/,
  );
  different.failed = true;
  assert.throws(
    () => findMastermindPolicy(l.pack, { ...pool, states: [different] }, failure, 500),
    /already occurred/,
  );
});
