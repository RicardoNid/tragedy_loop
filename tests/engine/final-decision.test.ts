import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { Choice, Module } from '../../packages/contracts/src/game.js';
import { advance, drive } from '../../packages/engine/src/runtime/engine.js';
import { replay, type ReplayRequest } from '../../packages/engine/src/runtime/replay.js';
import {
  canonical,
  clone,
  type EngineState,
  type RulePack,
} from '../../packages/engine/src/runtime/model.js';
import { solveAbsence } from '../../packages/engine/src/absence/solve.js';
import { solveFinalDecision } from '../../packages/engine/src/decision/final.js';
import { adviseReplays } from '../../scripts/engine/final-decision.js';
import { lab } from '../comprehensive/harness.js';

function question(module: Module, anniversary = false) {
  const l = lab(module, anniversary);
  Object.assign(l.state, {
    phase: 'final-guess',
    phaseEntered: true,
    pending: null,
    day: 1,
    loop: 2,
  });
  l.state.characters.c!.status = 'absent';
  l.state.flags.guessed = JSON.stringify(['d']);
  drive(l.pack, l.state, 20);
  assert.equal(l.state.pending?.kind, 'guess');
  return l;
}
function apply(pack: RulePack, s: EngineState, choice: Choice) {
  const pending = s.pending!;
  const r = advance(pack, s, pending.actor, {
    id: 'final-' + s.revision,
    expectedRevision: s.revision,
    decisionId: pending.id,
    choice,
  });
  assert.equal(r.status, 'ok', r.reason);
  return r.state;
}
type GuessPair = readonly [string, string?];
for (const module of ['BTX', 'AHR'] as const) {
  test(module + ' 六个候选世界的全部 63 个非空子集逐行动对照正向裁判', () => {
    const anniversary = module === 'BTX';
    const l = question(module, anniversary);
    const values: GuessPair[] = anniversary
      ? [['平民'], ['因果残片'], ['杀人狂']]
      : [['平民', '强迫症'], ['平民', '次元旅者'], ['杀人狂']];
    const actions: Choice[] = ['a', 'b'].flatMap((character) =>
      values.map(([identity, reverseIdentity]) => ({
        kind: 'guess' as const,
        character,
        identity,
        ...(reverseIdentity && { reverseIdentity }),
      })),
    );
    const candidates = values.flatMap((a, i) =>
      values
        .filter((_, j) => i !== j)
        .map((b) => {
          const s = clone(l.state);
          for (const [id, [identity, reverse]] of [
            ['a', a],
            ['b', b],
          ] as const) {
            const c = s.characters[id]!;
            c.initialIdentity = identity;
            // Giving a different effective identity must not alter the final answer.
            c.identity = '主谋';
            s.setup.characters.find((c) => c.id === id)!.reverseIdentity = reverse;
          }
          const correct = actions
            .filter((action) => apply(l.pack, s, action).winner !== 'mastermind')
            .map(canonical);
          const byText = actions.filter((action) => {
            if (action.kind !== 'guess') return false;
            const [initial, reverse] = action.character === 'a' ? a : b;
            return (
              (initial === action.identity ||
                (anniversary && initial === '因果残片' && action.identity === '平民')) &&
              reverse === action.reverseIdentity
            );
          });
          assert.deepEqual(correct, byText.map(canonical));
          return { s, correct };
        }),
    );
    for (let mask = 1; mask < 64; mask++) {
      const selected = candidates.filter((_, i) => mask & (1 << i));
      const expected = actions.filter((a) =>
        selected.every((w) => w.correct.includes(canonical(a))),
      );
      const ids = new Set(expected.map((a) => a.kind === 'guess' && a.character));
      const advice = solveFinalDecision(l.pack, {
        exhaustive: true,
        states: selected.map((w) => w.s),
      });
      assert.deepEqual(
        advice.safeChoices.map(canonical).sort(),
        expected.map(canonical).sort(),
        'subset ' + mask,
      );
      assert.equal(
        advice.status,
        ids.size === 2 ? 'guaranteed' : ids.size ? 'partial' : 'no-guarantee',
      );
      if (ids.size === 2)
        for (const w of selected) {
          const end = advice.plan.reduce((s, a) => apply(l.pack, s, a), w.s);
          assert.equal(end.winner, 'protagonists');
        }
      else assert.deepEqual(advice.plan, []);
    }
  });
}

test('LL 主人公 C 必须一次答对全部当事人，跨日关联不能拆开', () => {
  const l = question('LL');
  const states: EngineState[] = [];
  for (const first of ['a', 'b'])
    for (const second of ['c', 'd']) {
      const s = clone(l.state);
      s.ll = {
        roles: { p0: 'C', p1: 'A', p2: 'B' },
        communicated: [],
        died: [],
        finalTraitorsDisabled: false,
      };
      s.setup.x = ['我才是名侦探'];
      s.flags['c-guess'] = 'yes';
      s.setup.incidents = [
        { day: 1, name: '谋杀', culprit: first },
        { day: 2, name: '自白', culprit: second },
      ];
      states.push(s);
    }
  for (let mask = 1; mask < 16; mask++) {
    const subset = states.filter((_, i) => mask & (1 << i));
    const advice = solveFinalDecision(l.pack, { exhaustive: true, states: subset });
    const safe: Choice[] = states
      .map((s) => ({
        kind: 'guess-culprits' as const,
        answers: Object.fromEntries(s.setup.incidents.map((i) => [i.day, i.culprit])),
      }))
      .filter((a) => subset.every((s) => apply(l.pack, s, a).winner === 'p0'));
    assert.deepEqual(advice.safeChoices, safe);
    assert.deepEqual(advice.plan, safe);
    assert.equal(advice.status, safe.length ? 'guaranteed' : 'no-guarantee');
  }
});

test('两份合法剧本从讨论开始投票：共同安全的五项可以连续执行，单一候选可答完整场', () => {
  const input = JSON.parse(
    readFileSync(
      new URL('../../products/engine/final-decision-example.json', import.meta.url),
      'utf8',
    ),
  ) as { exhaustive: boolean; candidates: ReplayRequest[] };
  const partial = adviseReplays(input);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.safeChoices.length, 5);
  const pack = compileOfficial('BTX');
  for (const candidate of input.candidates) {
    const r = replay(pack, candidate);
    assert.equal(r.status, 'replayed');
    const s = partial.safeChoices.reduce((s, choice) => apply(pack, s, choice), r.state);
    assert.equal(s.phase, 'final-guess');
    assert.equal(s.winner, undefined);
    const full = adviseReplays({ ...input, candidates: [candidate] });
    assert.equal(full.status, 'guaranteed');
    assert.equal(full.plan.reduce((s, c) => apply(pack, s, c), r.state).winner, 'protagonists');
  }
  assert.equal(adviseReplays({ ...input, worldLimit: 1 }).status, 'unknown');
  assert.throws(
    () => adviseReplays({ ...input, candidates: [{ ...input.candidates[0]!, choices: [] }] }),
    /pending final/,
  );
});

test('候选覆盖、预算、结束状态和公开题目一致性', () => {
  const l = question('BTX');
  const solve = (states: EngineState[], exhaustive = true, limit = 100) =>
    solveFinalDecision(l.pack, { states, exhaustive }, limit);
  assert.equal(solve([]).status, 'no-candidates');
  assert.equal(solve([], false).status, 'unknown');
  assert.equal(solve([l.state], false).safeChoices.length, 0);
  assert.equal(solve([l.state, l.state], true, 1).reason, 'limit');
  assert.equal(solve([l.state], true, 1).status, 'guaranteed');
  assert.throws(() => solve([], true, -1));
  const other = clone(l.state);
  other.flags.guessed = '[]';
  assert.throws(() => solve([l.state, other]), /different final questions/);
  other.setup.publicSpecialRules = ['特殊裁定'];
  assert.equal(solve([other]).reason, 'special-rule');
  other.setup.publicSpecialRules = [];
  other.phase = 'day-end';
  assert.throws(() => solve([other]), /pending final/);
});
test('日末无人死亡且守护耗尽，从九组身份缩到一组，再提交整场最终决战', () => {
  const l = lab('BTX');
  l.state.pending = null;
  l.state.phase = 'day-end';
  l.state.phaseEntered = false;
  l.state.setup.days = 1;
  l.state.setup.loops = 1;
  l.state.setup.y = '被封印的邪灵';
  l.state.boards.shrine = 2;
  l.state.characters.b!.counters.guard = 1;
  const roles = ['平民', '杀人狂', '时间旅者'];
  const domains = { a: roles, b: roles, c: ['平民'], d: ['平民'] };
  function world(row: Readonly<Record<string, string>>) {
    const s = clone(l.state);
    for (const [id, role] of Object.entries(row)) {
      s.characters[id]!.identity = s.characters[id]!.initialIdentity = role;
      s.setup.characters.find((c) => c.id === id)!.identity = role;
    }
    return s;
  }
  const rows = [
    ...solveAbsence(
      l.pack,
      {
        entry: { ...l.state, ...l.state.setup, characters: Object.values(l.state.characters) },
        timing: { kind: 'day-end' },
        coverage: 'complete',
        extent: 'phase',
        absent: ['a', 'b'].map((character) => ({ phenomenon: 'death', character })),
      },
      domains,
      {
        evidence: {
          start: { phase: 'day-end', day: 1, loop: 1 },
          end: { phase: 'loop-end', day: 1, loop: 1 },
          coverage: 'complete',
          absent: [],
          rules: [{ kind: 'character', character: 'b', counters: { guard: 0 } }],
        },
        workPerRow: 200,
        worlds: (row) => ({ exhaustive: true, states: [world(row)] }),
      },
    ),
  ];
  assert.ok(rows.every((r) => r.status !== 'unknown'));
  const survivors = rows.filter((r) => r.status === 'possible');
  assert.deepEqual(
    survivors.map((r) => [r.identities.a, r.identities.b]),
    [['杀人狂', '平民']],
  );
  const states = survivors.map((r) => world(r.identities));
  for (const s of states) drive(l.pack, s, 1000);
  const advice = solveFinalDecision(l.pack, { exhaustive: true, states });
  assert.equal(advice.status, 'guaranteed');
  assert.equal(
    advice.plan.reduce((s, c) => apply(l.pack, s, c), states[0]!).winner,
    'protagonists',
  );
});
