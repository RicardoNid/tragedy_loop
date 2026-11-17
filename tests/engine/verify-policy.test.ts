import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { replay } from '../../packages/engine/src/runtime/replay.js';
import { verifyPolicy } from '../../packages/engine/src/decision/verify-policy.js';
import { adviseDayPolicy } from '../../scripts/engine/day-policy.js';
import { adviseWinningPolicy } from '../../scripts/engine/game-policy.js';
import { adviseObservedGame } from '../../scripts/engine/observed-game.js';
import { verifyPolicyQuestion } from '../../scripts/engine/verify-policy.js';
import { replayCandidates } from '../../scripts/engine/candidate-replays.js';

const example = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL('../../products/engine/' + name + '-example.json', import.meta.url),
      'utf8',
    ),
  );
test('逐叶复核 FS 获胜行动；错误防守的实际败局可从宿主记录重播，公开证据不泄漏暗牌', () => {
  const q = example('game-policy');
  const pack = compileOfficial('FS');
  const policy = adviseWinningPolicy(q).policy!;
  const good = verifyPolicyQuestion(q, policy).verification;
  assert.equal(good.status, 'verified');
  assert.ok(good.winningLeaves > q.candidates.length);
  assert.equal(
    verifyPolicyQuestion({ ...q, workLimit: good.work }, policy).verification.status,
    'verified',
  );
  assert.equal(
    verifyPolicyQuestion({ ...q, workLimit: good.work - 1 }, policy).verification.reason,
    'limit',
  );
  assert.equal(
    verifyPolicyQuestion({ ...q, exhaustive: false }, policy).verification.reason,
    'incomplete',
  );
  const bad = {
    ...policy,
    choice: { kind: 'cards' as const, placements: [{ card: 'p2-7', target: 'hospital' }] },
  };
  const hidden = verifyPolicyQuestion({ ...q, exhaustive: false }, bad).verification;
  assert.equal(hidden.status, 'counterexample');
  assert.equal(hidden.reason, 'lost');
  assert.ok(!hidden.hostWitness);
  assert.doesNotMatch(JSON.stringify(hidden.counterexample), /"mastermind-\d+"/);
  const full = verifyPolicyQuestion(q, bad, true).verification;
  const witness = full.hostWitness!;
  assert.deepEqual(
    witness.choices.slice(0, witness.rootCommands),
    q.candidates[witness.candidate].choices,
  );
  const replayed = replay(pack, witness);
  assert.equal(replayed.status, 'replayed');
  assert.equal(replayed.state?.winner, 'mastermind');
  assert.deepEqual(full.counterexample, hidden.counterexample);
});

test('策略文件中缺失、重复、非法及观察游标错误的应对得到各自诊断', () => {
  const q = example('day-survival');
  const policy = adviseDayPolicy(q).policy!;
  const source = canonical(policy);
  assert.equal(verifyPolicyQuestion(q, policy).verification.status, 'verified');
  assert.ok(policy.responses.length > 0);
  const check = (p: typeof policy) => verifyPolicyQuestion(q, p).verification.reason;
  assert.equal(check({ ...policy, responses: [] }), 'missing-response');
  assert.equal(
    check({ ...policy, responses: [...policy.responses, ...policy.responses] }),
    'ambiguous-response',
  );
  assert.equal(
    check({ ...policy, choice: { kind: 'guess', character: 'doctor', identity: '平民' } }),
    'illegal-choice',
  );
  assert.equal(check({ ...policy, reportsBefore: policy.reportsBefore + 1 }), 'invalid-node');
  assert.equal(
    verifyPolicyQuestion({ ...q, maxAbilities: 0 }, policy).verification.reason,
    'ability-limit',
  );
  assert.equal(check({ ...policy, choice: { kind: 'pass' }, responses: [] }), 'death');
  assert.equal(canonical(policy), source);
});

test('从有限域和观察重建后独立检查；截断历史不可确认安全，所见反例仍可确认', () => {
  const q = example('observed-game');
  const original = adviseObservedGame(q);
  const policy = original.advice.policy!;
  const check = verifyPolicyQuestion(q, policy);
  assert.ok('history' in check);
  assert.deepEqual(check.history, original.history);
  assert.equal(check.verification.status, 'verified');
  assert.equal(
    verifyPolicyQuestion({ ...q, worldLimit: 1 }, policy).verification.reason,
    'incomplete',
  );
  const wrong = { ...policy, choice: { kind: 'pass' as const }, responses: [] };
  assert.equal(
    verifyPolicyQuestion({ ...q, worldLimit: 1 }, wrong).verification.status,
    'counterexample',
  );
});

test('LL 的 C 回答须保证本人获胜；跨座位策略和同题以外的局面无法混用', () => {
  const q = example('seat-policy');
  const policy = adviseWinningPolicy(q).policy!;
  const pack = compileOfficial('LL');
  const states = [...replayCandidates(pack, q.candidates)];
  const original = canonical(states);
  assert.equal(verifyPolicyQuestion(q, policy).verification.status, 'verified');
  assert.equal(
    verifyPolicyQuestion(q, { ...policy, seat: 'p1' }).verification.reason,
    'invalid-node',
  );
  const bad = {
    ...policy,
    choice: { kind: 'guess-culprits' as const, answers: { '1': 'unavailable' } },
  };
  assert.equal(verifyPolicyQuestion(q, bad).verification.reason, 'illegal-choice');
  const changed = clone(states[0]!);
  changed.boards.school++;
  assert.throws(
    () =>
      verifyPolicy(
        pack,
        { states: [...states, changed], exhaustive: true },
        policy,
        { kind: 'seat-win', seat: 'p0' },
        50,
      ),
    /Different observed/,
  );
  assert.equal(canonical(states), original);
  assert.equal(
    verifyPolicy(pack, { states: [], exhaustive: false }, policy, { kind: 'game' }, 0).status,
    'unknown',
  );
  assert.equal(
    verifyPolicy(pack, { states: [], exhaustive: true }, policy, { kind: 'game' }, 0).status,
    'no-candidates',
  );
});
