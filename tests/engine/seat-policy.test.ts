import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { findWinningPolicy } from '../../packages/engine/src/decision/game-policy.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import {
  nextPolicyStep,
  type PolicyNode,
} from '../../packages/engine/src/decision/policy-search.js';
import { inferObservedWorlds } from '../../packages/engine/src/decision/observed-worlds.js';
import { adviseObservedGame, exportObservation } from '../../scripts/engine/observed-game.js';
import { initialize } from '../../packages/engine/src/runtime/engine.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { act, character, lab, phase, type Lab } from '../comprehensive/harness.js';

type Shuffle = NonNullable<GameSetup['privateRoles']>;
const shuffles: Shuffle[] = [];

test('合法 LL 终局只披露本人的 C，相同视野保留另外两席的两种排列，并以事件当事人答案单独获胜', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/seat-policy-example.json', import.meta.url),
      'utf8',
    ),
  );
  const evidence = exportObservation(q.candidates[0], 'p0');
  assert.equal(evidence.view.personalRole, 'C');
  const setups = shuffles.map((privateRoles) => ({ ...q.candidates[0].setup, privateRoles }));
  const query = {
    setups,
    evidence,
    exhaustiveSetups: true,
    goal: { kind: 'seat-win' as const, seat: 'p0' as const },
  };
  const r = adviseObservedGame(query);
  assert.equal(r.advice.status, 'guaranteed');
  assert.deepEqual(r.advice.policy?.choice, { kind: 'guess-culprits', answers: { 1: 'worker' } });
  const pack = compileOfficial('LL');
  const found = inferObservedWorlds(pack, setups, true, evidence, 10000, 100);
  assert.equal(found.exhaustive, true);
  assert.deepEqual(new Set(found.states.map((s) => s.ll!.roles.p1)), new Set(['A', 'B']));
  for (const state of found.states) finish({ pack, state }, r.advice.policy!);
  const legacy = { ...evidence, view: { ...evidence.view } };
  delete legacy.view.markers;
  assert.equal(adviseObservedGame({ ...query, evidence: legacy }).advice.status, 'guaranteed');
});
for (const p0 of ['A', 'B', 'C'] as const)
  for (const p1 of ['A', 'B', 'C'] as const)
    if (p1 !== p0)
      shuffles.push({ p0, p1, p2: (['A', 'B', 'C'] as const).find((r) => r !== p0 && r !== p1)! });

function marked(
  roles: Shuffle,
  activeA: boolean,
  activeB: boolean,
  deathReady: boolean,
  commReady: boolean,
  hope: boolean,
) {
  const l = lab('LL'),
    s = l.state;
  s.loop = s.setup.loops = 2;
  s.setup.days = 1;
  s.setup.y = '最终计划';
  s.setup.x = [...(activeA ? ['真正的怪物'] : []), ...(activeB ? ['神话收集者'] : [])];
  character(l, 'a', '职员', '平民', 'city').counters.goodwill = 3;
  character(l, 'b', '女学生', '关键人物', 'school').counters.hope = Number(hope);
  character(l, 'e', '男学生');
  character(l, 'f', '情报商');
  const rest = ['b', 'c', 'd', 'e', 'f'];
  s.ll = {
    roles,
    finalTraitorsDisabled: false,
    died: rest.slice(0, deathReady ? 5 : 4),
    communicated: rest.slice(0, commReady ? 5 : 4),
  };
  phase(l, 'protagonist-abilities');
  return l;
}
function finish(l: Lab, policy: PolicyNode) {
  const copy = { pack: l.pack, state: clone(l.state) };
  let last: PolicyNode | undefined;
  for (let i = 0; !copy.state.winner; i++) {
    assert.ok(i < 30);
    const s = copy.state;
    if (s.pending!.actor === 'p0') {
      const next = last ? nextPolicyStep(last, s) : policy;
      assert.ok(next);
      last = next;
      act(copy, next.choice);
    } else act(copy, s.pending!.options[0]!);
  }
  assert.ok(copy.state.winners?.includes('p0'));
}
test('A、B 两种个人胜利、标志门槛和希望：96 个私人信息集合，逐一核对是否可以保证本人获胜', () => {
  for (const a of [false, true])
    for (const b of [false, true])
      for (const killed of [false, true])
        for (const comm of [false, true])
          for (const hope of [false, true])
            for (const my of ['A', 'B', 'C']) {
              const options = shuffles
                .filter((r) => r.p0 === my)
                .map((r) => marked(r, a, b, killed, comm, hope));
              const [one, two] = options;
              assert.deepEqual(
                observeQuestion(one!.state, 'p0'),
                observeQuestion(two!.state, 'p0'),
              );
              const canPass =
                hope || (a && killed ? my === 'A' : !((my === 'A' && a) || (my === 'B' && b)));
              const canWin = canPass || (my === 'B' && b && comm);
              const advice = findWinningPolicy(
                one!.pack,
                { exhaustive: true, states: options.map((l) => l.state) },
                1500,
                100,
                'p0',
              );
              assert.equal(
                advice.status,
                canWin ? 'guaranteed' : 'no-guaranteed-policy',
                JSON.stringify([my, a, b, killed, comm, hope]),
              );
              if (advice.policy) for (const l of options) finish(l, advice.policy);
            }
});

test('队友可作普通错误回答，竞争的 C 可独胜：均足以推翻当前玩家的保证', () => {
  for (const traitor of [false, true]) {
    const l = marked({ p0: 'A', p1: 'B', p2: 'C' }, false, false, false, false, false);
    l.state.failed = true;
    if (traitor) l.state.setup.x = ['我才是名侦探'];
    const advice = findWinningPolicy(
      l.pack,
      { states: [l.state], exhaustive: true },
      1500,
      100,
      'p0',
    );
    assert.equal(advice.status, 'no-guaranteed-policy');
    act(l, { kind: 'pass' });
    if (traitor) {
      assert.equal(l.state.pending?.actor, 'p2');
      act(l, { kind: 'guess-culprits', answers: {} });
      assert.deepEqual(l.state.winners, ['p2']);
    } else {
      assert.equal(l.state.pending?.actor, 'p1');
      act(l, { kind: 'guess', character: 'a', identity: '主谋' });
      assert.deepEqual(l.state.winners, ['mastermind']);
    }
  }
});

test('C 的完整答案相同才可保证个人胜利；本人已获知的 Ex 不能和其他取值混为同一问题', () => {
  const ls = ['a', 'b'].map((culprit) => {
    const l = marked({ p0: 'C', p1: 'A', p2: 'B' }, false, false, false, false, false);
    l.state.setup.x = ['我才是名侦探'];
    l.state.setup.incidents = [{ day: 1, name: '骤变', culprit }];
    phase(l, 'final-guess');
    return l;
  });
  for (const l of ls) {
    const advice = findWinningPolicy(l.pack, { states: [l.state], exhaustive: true }, 50, 10, 'p0');
    assert.equal(advice.status, 'guaranteed');
    finish(l, advice.policy!);
  }
  assert.equal(
    findWinningPolicy(
      ls[0]!.pack,
      { states: ls.map((l) => l.state), exhaustive: true },
      50,
      10,
      'p0',
    ).status,
    'no-guaranteed-policy',
  );
  const a = marked(shuffles[0]!, false, false, false, false, false),
    b = marked(shuffles[5]!, false, false, false, false, false);
  assert.throws(
    () => findWinningPolicy(a.pack, { states: [a.state, b.state], exhaustive: true }, 50, 10, 'p0'),
    /Different observed/,
  );
});

test('最终计划的希望只从已完成的最终轮回延续到最终决战，轮间讨论不能沿用上一轮希望', () => {
  for (const finalLoop of [false, true]) {
    const l = marked({ p0: 'C', p1: 'A', p2: 'B' }, false, false, false, false, true);
    l.state.setup.x = ['我才是名侦探'];
    l.state.failed = true;
    if (finalLoop) {
      act(l, { kind: 'pass' });
    } else {
      l.state.loop = 1;
      act(l, { kind: 'pass' });
      assert.equal(l.state.phase, 'discussion');
      assert.equal(l.state.loop, 2);
      act(l, { kind: 'request-final-guess' });
      for (let i = 0; i < 3; i++) act(l, { kind: 'vote-final-guess', agree: true });
    }
    assert.equal(l.state.phase, 'final-guess');
    assert.equal(l.state.ll!.finalEligible!.includes('p0'), finalLoop);
    assert.equal(!!l.state.flags['c-guess'], !finalLoop);
    if (!finalLoop) {
      // A wrong C answer returns to the eligible loyal players.
      l.state.setup.incidents = [{ day: 1, name: '骤变', culprit: 'a' }];
      act(l, { kind: 'guess-culprits', answers: { 1: 'b' } });
      assert.notEqual(l.state.pending?.actor, 'p0');
    }
  }
});

test('首次说明时本人也看不到未分发的 Ex，六种合法洗牌仍可行', () => {
  const fixtures: { setup: GameSetup }[] = JSON.parse(
    readFileSync(new URL('./fixtures/official-scenarios.json', import.meta.url), 'utf8'),
  );
  const setup = fixtures.find((f) => f.setup.module === 'LL')!.setup,
    pack = compileOfficial('LL');
  const setups = shuffles.map((privateRoles) => ({ ...setup, privateRoles }));
  const evidence = observeQuestion(initialize(pack, setups[0]!).state!, 'p0');
  assert.equal(evidence.view.personalRole, undefined);
  const found = inferObservedWorlds(pack, setups, true, evidence, 100, 6);
  assert.equal(found.exhaustive, true);
  assert.equal(found.states.length, 6);
});
