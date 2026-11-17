import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clone, canonical } from '../../packages/engine/src/runtime/model.js';
import { findWinningPolicy } from '../../packages/engine/src/decision/game-policy.js';
import {
  nextPolicyStep,
  type PolicyNode,
} from '../../packages/engine/src/decision/policy-search.js';
import { adviseWinningPolicy } from '../../scripts/engine/game-policy.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.js';
import { replayCandidates } from '../../scripts/engine/candidate-replays.js';
import { adviseObservedGame, exportObservation } from '../../scripts/engine/observed-game.js';
import { act, character, lab, phase, type Lab } from '../comprehensive/harness.js';

test('720 个暗置世界共同的学校防守在有限预算内得到完整终局证明', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/game-policy-example.json', import.meta.url),
      'utf8',
    ),
  );
  const result = adviseObservedGame({
    evidence: exportObservation(q.candidates[0]),
    setups: [q.candidates[0].setup],
    exhaustiveSetups: true,
    worldLimit: 720,
    workLimit: 30000,
  });
  assert.equal(result.history.worlds, 720);
  assert.equal(result.advice.status, 'guaranteed');
  assert.deepEqual(result.advice.policy?.choice, {
    kind: 'cards',
    placements: [{ card: 'p2-7', target: 'school' }],
  });
  assert.ok((result.advice.reusedProofs ?? 0) > 500);
});

test('结算后盘面一致但后续仍需医生选择，保留两种翻牌观察和各自可执行的后续行动', () => {
  const boards = ['hospital', 'school'];
  const worlds = boards.map((_, i) => {
    const l = lab('FS');
    l.state.setup.days = l.state.setup.loops = 1;
    const b = character(l, 'b', '住院患者', '平民', 'hospital');
    b.counters.paranoia = b.paranoiaLimit;
    character(l, 'c', '医生', '平民', 'hospital').counters.goodwill = 2;
    l.state.boards.hospital = 2;
    l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'b' }];
    phase(l, 'mastermind-cards');
    act(l, {
      kind: 'cards',
      placements: [
        { card: 'mastermind-0', target: boards[i]! },
        { card: 'mastermind-1', target: boards[1 - i]! },
        { card: 'mastermind-3', target: 'city' },
      ],
    });
    act(l, { kind: 'cards', placements: [{ card: 'p0-3', target: 'shrine' }] });
    act(l, { kind: 'cards', placements: [{ card: 'p1-3', target: 'school' }] });
    return l;
  });
  const candidates = { states: worlds.map((w) => w.state), exhaustive: true };
  for (const cap of [0, 1, 100]) {
    const r = findWinningPolicy(worlds[0]!.pack, candidates, 10000, 512, undefined, cap);
    assert.equal(r.status, 'guaranteed');
    assert.equal(r.policy?.responses.length, 2);
    for (const l of worlds) replayWin(l, r.policy!);
  }
});

test('相同角色和当前区域下，未来延迟败北不可使用另一世界的获胜证明', () => {
  const l = lastCard('school', true, false);
  const losing = clone(l.state);
  losing.delayed = [{ day: 1, loop: 1, timing: 'day-end', effects: [{ op: 'fail' }], env: {} }];
  for (const states of [[l.state], [losing], [l.state, losing], [losing, l.state]]) {
    const expected = states.includes(losing) ? 'no-guaranteed-policy' : 'guaranteed';
    for (const cap of [0, 1, 512])
      assert.equal(
        findWinningPolicy(l.pack, { exhaustive: true, states }, 15000, 512, undefined, cap).status,
        expected,
      );
  }
});

test('合法 FS 示例，遍历剧作家全部后续选择，逐叶复核获胜和另一种出牌的败局', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/game-policy-example.json', import.meta.url),
      'utf8',
    ),
  );
  const pack = compileOfficial('FS');
  const advice = adviseWinningPolicy(q);
  assert.deepEqual(advice.policy?.choice, {
    kind: 'cards',
    placements: [{ card: 'p2-7', target: 'school' }],
  });
  for (const s of replayCandidates(pack, q.candidates)) {
    for (const protect of [false, true]) {
      const root = { pack, state: clone(s) };
      act(
        root,
        protect
          ? advice.policy!.choice
          : { kind: 'cards', placements: [{ card: 'p2-7', target: 'hospital' }] },
      );
      const stack = [root.state];
      let victories = 0,
        losses = 0;
      while (stack.length) {
        const state = stack.pop()!;
        if (state.winner) {
          if (state.winner === 'protagonists') victories++;
          else losses++;
        } else {
          assert.equal(state.pending!.actor, 'mastermind');
          for (const c of enumerateChoices(state)) stack.push(act({ pack, state }, c));
        }
      }
      assert.ok(victories + losses > 4);
      assert.equal(losses === 0, protect);
    }
  }
});

test('相同诅咒标记的私有流水号不能区分最终身份，其他主人公可用的手牌属于共享视野', () => {
  const l = lab('HSA');
  phase(l, 'final-guess');
  const other = clone(l.state);
  other.characters.a!.initialIdentity = '关键人物';
  for (const [i, s] of [l.state, other].entries()) {
    s.curses = [{ id: 'curse-' + (80 + i), target: 'b' }];
    s.observations.protagonists.push({
      sequence: s.observations.protagonists.length + 1,
      loop: s.loop,
      day: s.day,
      phase: 'day-end',
      type: 'board',
      data: { curses: clone(s.curses) },
    });
  }
  const group = { states: [l.state, other], exhaustive: true };
  assert.equal(findWinningPolicy(l.pack, group, 400).status, 'no-guaranteed-policy');
  other.cards.find((c) => c.owner === 'p2')!.status = 'used';
  assert.throws(() => findWinningPolicy(l.pack, group, 400), /Different observed/);
});

function replayWin(l: Lab, policy: PolicyNode) {
  const board = { pack: l.pack, state: clone(l.state) };
  let last: PolicyNode | undefined;
  const phases: string[] = [];
  for (let i = 0; !board.state.winner; i++) {
    assert.ok(i < 128);
    const s = board.state;
    phases.push([s.loop, s.day, s.phase].join('/'));
    if (s.pending!.actor === 'mastermind') act(board, s.pending!.options[0]!);
    else {
      const step = last ? nextPolicyStep(last, s) : policy;
      assert.ok(step, 'missing response at ' + s.phase);
      last = step;
      act(board, step.choice);
    }
  }
  assert.equal(board.state.winner, 'protagonists');
  return { state: board.state, phases };
}

function lastCard(target: string, strong: boolean, secondBlock: boolean) {
  const l = lab('FS');
  const s = l.state;
  s.setup.days = s.setup.loops = 1;
  s.setup.y = '守护此地';
  s.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'b' }];
  s.characters.b!.counters.paranoia = s.characters.b!.paranoiaLimit + 2;
  phase(l, 'mastermind-cards');
  act(l, {
    kind: 'cards',
    placements: [
      { card: strong ? 'mastermind-9' : 'mastermind-8', target },
      { card: 'mastermind-0', target: target === 'hospital' ? 'school' : 'hospital' },
      { card: 'mastermind-6', target: 'city' },
    ],
  });
  act(l, { kind: 'cards', placements: [{ card: secondBlock ? 'p0-7' : 'p0-3', target: 'city' }] });
  act(l, { kind: 'cards', placements: [{ card: 'p1-3', target: 'shrine' }] });
  assert.equal(l.state.pending?.actor, 'p2');
  return l;
}
test('同样的暗置目标，医院与学校的复合败北条件；四种牌面全部候选子集，对照单张和双张禁止密谋', () => {
  for (const secondBlock of [false, true]) {
    const worlds = ['school', 'hospital'].flatMap((target) =>
      [false, true].map((strong) => ({
        target,
        strong,
        l: lastCard(target, strong, secondBlock),
      })),
    );
    for (let mask = 1; mask < 16; mask++) {
      const set = worlds.filter((_, i) => mask & (1 << i));
      const threats = new Set(set.filter((w) => w.strong).map((w) => w.target));
      const possible = threats.size === 0 || (threats.size === 1 && !secondBlock);
      const candidates = { exhaustive: true, states: set.map((w) => w.l.state) };
      const advice = findWinningPolicy(set[0]!.l.pack, candidates, 20000);
      assert.equal(
        advice.status,
        possible ? 'guaranteed' : 'no-guaranteed-policy',
        mask + '/' + secondBlock,
      );
      if (advice.policy) {
        if (threats.size)
          assert.deepEqual(advice.policy.choice, {
            kind: 'cards',
            placements: [{ card: 'p2-7', target: [...threats][0] }],
          });
        for (const w of set) replayWin(w.l, advice.policy);
      }
    }
  }
});

test('已经失去当前轮回，职员公开身份能让两个候选在最终决战分别获胜', () => {
  const worlds = ['平民', '时间旅者'].map((role) => {
    const l = lab();
    character(l, 'a', '职员', role, 'city').counters.goodwill = 3;
    l.state.failed = true;
    l.state.setup.days = l.state.setup.loops = 1;
    phase(l, 'protagonist-abilities');
    return l;
  });
  const states = worlds.map((w) => w.state);
  const advice = findWinningPolicy(worlds[0]!.pack, { states, exhaustive: true }, 5000);
  assert.equal(advice.status, 'guaranteed');
  assert.deepEqual(advice.policy?.choice, {
    kind: 'ability',
    owner: 'a',
    ability: 'office-worker',
  });
  for (const w of worlds)
    assert.ok(replayWin(w, advice.policy!).phases.includes('1/1/final-guess'));
  for (const w of worlds) act(w, { kind: 'pass' });
  assert.equal(
    findWinningPolicy(
      worlds[0]!.pack,
      { states: worlds.map((w) => w.state), exhaustive: true },
      5000,
    ).status,
    'no-guaranteed-policy',
  );
});

test('跨日触发延迟死亡，进入第二轮讨论，三票同意再逐人答题', () => {
  const l = lab();
  l.state.setup.days = l.state.setup.loops = 2;
  l.state.characters.c!.counters.goodwill = 2;
  l.state.delayed = [
    { loop: 1, day: 2, timing: 'day-start', env: {}, effects: [{ op: 'protagonist-death' }] },
  ];
  phase(l, 'protagonist-abilities');
  const before = canonical(l.state);
  const advice = findWinningPolicy(l.pack, { states: [l.state], exhaustive: true }, 2000);
  assert.equal(advice.status, 'guaranteed');
  assert.equal(canonical(l.state), before);
  const r = replayWin(l, advice.policy!);
  assert.equal(r.state.loop, 2);
  assert.equal(r.state.choices.filter((v) => v.choice.kind === 'vote-final-guess').length, 3);
  assert.equal(r.state.choices.filter((v) => v.choice.kind === 'guess').length, 4);
  assert.ok(
    r.state.observations.public.some((o) => o.loop === 1 && o.day === 2 && o.type === 'failure'),
  );
});

test('外部给定的投票、合法剧本重放、覆盖不全、预算、不同视野与 LL', () => {
  const input = JSON.parse(
    readFileSync(
      new URL('../../products/engine/final-decision-example.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(adviseWinningPolicy(input).status, 'no-guaranteed-policy');
  const one = { ...input, candidates: [{ ...input.candidates[0], choices: [] }] };
  const advice = adviseWinningPolicy(one);
  assert.equal(advice.status, 'guaranteed');
  assert.deepEqual(advice.policy?.choice, { kind: 'request-final-guess' });
  assert.equal(adviseWinningPolicy({ ...one, workLimit: 1 }).reason, 'limit');
  assert.equal(adviseWinningPolicy({ ...one, exhaustive: false }).reason, 'incomplete');
  const l = lab();
  const unknown = clone(l.state);
  unknown.boards.school = 2;
  assert.throws(
    () => findWinningPolicy(l.pack, { states: [l.state, unknown], exhaustive: true }, 50),
    /Different observed/,
  );
  const ll = lab('LL');
  assert.equal(
    findWinningPolicy(ll.pack, { states: [ll.state], exhaustive: true }, 500).reason,
    'unsupported',
  );
  act(l, { kind: 'request-final-guess' });
  const fromVote = findWinningPolicy(l.pack, { states: [l.state], exhaustive: true }, 250);
  assert.equal(fromVote.status, 'guaranteed');
  replayWin(l, fromVote.policy!);
});
