import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Choice } from '../../packages/contracts/src/game.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.js';
import { evaluateActionQuestion } from '../../scripts/engine/evaluate-action.js';
import {
  resolveReplayQuestion,
  type ReplayQuestion,
} from '../../scripts/engine/candidate-replays.js';
import { verifyPolicyQuestion } from '../../scripts/engine/verify-policy.js';
import { exportObservation } from '../../scripts/engine/observed-game.js';
import { act } from '../comprehensive/harness.js';
import { solveGoal } from '../../packages/engine/src/decision/goal.js';
import type { MastermindQuestion } from '../../scripts/engine/mastermind-policy.js';

const fixture = <T = ReplayQuestion>(name: string): T =>
  JSON.parse(
    readFileSync(
      new URL('../../products/engine/' + name + '-example.json', import.meta.url),
      'utf8',
    ),
  );
const school: Choice = { kind: 'cards', placements: [{ card: 'p2-7', target: 'school' }] };
test('FS 逐一指定全部 40 种出牌，在两个暗置世界独立穷举剧作家的每种合法回复', () => {
  const input = fixture('game-policy'),
    { pack, candidates, goal } = resolveReplayQuestion(input);
  let tested = 0,
    winning = 0,
    leaves = 0;
  for (const move of enumerateChoices(candidates.states[0]!)) {
    const advice = solveGoal(pack, candidates, goal, 10000, 512, move);
    let worst = true;
    for (const state of candidates.states) {
      const stack = [act({ pack, state: clone(state) }, move)];
      while (stack.length) {
        const s = stack.pop()!;
        if (s.winner) {
          worst &&= s.winner === 'protagonists';
          leaves++;
          continue;
        }
        assert.equal(s.pending?.actor, 'mastermind');
        for (const response of enumerateChoices(s)) stack.push(act({ pack, state: s }, response));
      }
    }
    assert.equal(advice.status, worst ? 'guaranteed' : 'no-guaranteed-policy', canonical(move));
    if (advice.policy) {
      assert.deepEqual(advice.policy.choice, move);
      assert.equal(verifyPolicyQuestion(input, advice.policy).verification.status, 'verified');
      winning++;
    }
    tested++;
  }
  assert.equal(tested, 40);
  assert.equal(winning, 1);
  assert.ok(leaves >= 80);
  console.log(`chosenOpenings=${tested} checkedLeaves=${leaves}`);
});
test('同一公开问题重建 720 种未翻牌状态；指定学校、医院、非法出牌和预算分别返回不同结论', () => {
  const q = fixture('game-policy'),
    c = q.candidates[0]!;
  const input = {
    setups: [c.setup],
    exhaustiveSetups: true,
    evidence: exportObservation(c),
    worldLimit: 720,
    workLimit: 30000,
  };
  const win = evaluateActionQuestion(input, school);
  assert.equal(win.advice.status, 'guaranteed');
  assert.equal(
    evaluateActionQuestion(input, {
      kind: 'cards',
      placements: [{ card: 'p2-7', target: 'hospital' }],
    }).advice.status,
    'no-guaranteed-policy',
  );
  assert.equal(
    evaluateActionQuestion(q, { kind: 'cards', placements: [{ card: 'p1-7', target: 'school' }] })
      .advice.status,
    'illegal-opening',
  );
  assert.equal(
    evaluateActionQuestion({ ...q, exhaustive: false }, school).advice.reason,
    'incomplete',
  );
  assert.equal(evaluateActionQuestion({ ...q, workLimit: 1 }, school).advice.reason, 'limit');
  assert.throws(() => evaluateActionQuestion(q, { kind: 'cards', placements: 'bad' }), /有效/);
});
test('指定普通最终答案绕过推荐顺序；真答案、假答案与不存在的身份分别结算', () => {
  const q = fixture('final-decision');
  q.candidates = q.candidates.slice(0, 1);
  const c = q.candidates[0]!.setup.characters.at(-1)!;
  const guess = { kind: 'guess', character: c.id, identity: c.identity } as const;
  const good = evaluateActionQuestion(q, guess).advice;
  assert.equal(good.status, 'guaranteed');
  assert.deepEqual(good.policy!.choice, guess);
  assert.equal(verifyPolicyQuestion(q, good.policy!).verification.status, 'verified');
  const wrong = c.identity === '平民' ? '杀人狂' : '平民';
  assert.equal(
    evaluateActionQuestion(q, { ...guess, identity: wrong }).advice.status,
    'no-guaranteed-policy',
  );
  assert.equal(
    evaluateActionQuestion(q, { ...guess, identity: '未定义身份' }).advice.status,
    'illegal-opening',
  );
});
test('LL 的个人当事人联合回答与剧作家起手均受各自视野约束', () => {
  const q = fixture('seat-policy');
  for (const [id, expected] of [
    ['worker', 'guaranteed'],
    ['maiden', 'no-guaranteed-policy'],
    ['missing', 'illegal-opening'],
  ] as const) {
    const result = evaluateActionQuestion(q, {
      kind: 'guess-culprits',
      answers: { '1': id },
    }).advice;
    assert.equal(result.status, expected);
    if (result.policy)
      assert.equal(verifyPolicyQuestion(q, result.policy).verification.status, 'verified');
  }
  const m = fixture<MastermindQuestion>('mastermind-policy');
  const move = { kind: 'ability', owner: 'plot:流言四起', ability: 'rumor-intrigue' };
  const guaranteed = evaluateActionQuestion(m, move).advice;
  assert.equal(guaranteed.status, 'guaranteed');
  assert.deepEqual(guaranteed.policy!.choice, move);
  assert.equal(verifyPolicyQuestion(m, guaranteed.policy!).verification.status, 'verified');
  assert.equal(evaluateActionQuestion(m, { kind: 'pass' }).advice.status, 'no-guaranteed-policy');
});
test('当日保护中允许带选项的发动；固定起手照常消耗发动次数', () => {
  const q = fixture('day-survival');
  const move = {
    kind: 'ability',
    owner: 'doctor',
    ability: 'doctor-counter',
    choices: { target: 'patient', direction: 'remove' },
  };
  const result = evaluateActionQuestion(q, move).advice;
  assert.equal(result.status, 'guaranteed');
  assert.equal(verifyPolicyQuestion(q, result.policy!).verification.status, 'verified');
  assert.equal(
    evaluateActionQuestion({ ...q, maxAbilities: 0 }, move).advice.status,
    'no-guaranteed-policy',
  );
  assert.equal(evaluateActionQuestion(q, { kind: 'pass' }).advice.status, 'no-guaranteed-policy');
  assert.equal(
    evaluateActionQuestion(q, { ...move, choices: { target: 'missing' } }).advice.status,
    'illegal-opening',
  );
});
