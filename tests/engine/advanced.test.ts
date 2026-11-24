import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial, contentCoverage } from '../../packages/content/src/official/compile.js';
import type { Choice, GameSetup, Module } from '../../packages/contracts/src/game.js';
import { advance, drive, initializeDiscussion, resume } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { settle } from '../../packages/engine/src/runtime/settlement.js';
import { clone, type EngineState, type RulePack } from '../../packages/engine/src/runtime/model.js';
import { recompute, traitors } from '../../packages/engine/src/runtime/expressions.js';
import {
  createReferenceKnowledge,
  queryReference,
  checkWitness,
} from '../../packages/engine/src/runtime/reference.js';
import { replay, runBatch, replayFingerprint } from '../../packages/engine/src/runtime/replay.js';

function base(module: Module = 'BTX'): { pack: RulePack; state: EngineState; setup: GameSetup } {
  const pack = compileOfficial(module);
  const setup: GameSetup = {
    module,
    anniversary: false,
    days: 2,
    loops: 2,
    captain: 'p0',
    discussion: 'between-loops',
    y: module === 'FS' ? '复仇的火种' : '谋杀计划',
    x: module === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
    characters: [
      { id: 'boy', character: '男学生', identity: module === 'FS' ? '主谋' : '关键人物' },
      { id: 'girl', character: '女学生', identity: '传谣人' },
      { id: 'doctor', character: '医生', identity: module === 'FS' ? '平民' : '杀手' },
      { id: 'maiden', character: '巫女', identity: module === 'FS' ? '平民' : '主谋' },
    ],
    incidents: [],
  };
  const started = initializeDiscussion(pack, setup);
  assert.deepEqual(started.diagnostics, []);
  assert.ok(started.state);
  return { pack, state: started.state, setup };
}
function submit(pack: RulePack, state: EngineState, choice: Choice): EngineState {
  assert.ok(state.pending);
  const r = advance(pack, state, state.pending.actor, {
    id: `test-${state.revision}`,
    expectedRevision: state.revision,
    decisionId: state.pending.id,
    choice,
  });
  assert.notEqual(r.status, 'rejected', r.reason);
  return r.state;
}
function phase(pack: RulePack, state: EngineState, next: EngineState['phase']): EngineState {
  state.pending = null;
  state.frames = [];
  state.batch = null;
  state.phase = next;
  state.phaseEntered = false;
  drive(pack, state, 100);
  return state;
}
test('all current official profiles and 37 character cards have explicit translations', () => {
  for (const module of ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM', 'AHR', 'LL'] as Module[]) {
    const pack = compileOfficial(module);
    assert.equal(Object.keys(pack.characters).length, 37);
    for (const row of contentCoverage(pack))
      assert.deepEqual(row.pending, [], `${module}/${row.kind}`);
  }
  for (const module of ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM'] as Module[]) {
    const pack = compileOfficial(module, true);
    assert.ok(pack.plots['超越世界线']);
    assert.ok(pack.incidents['希望之光']);
    assert.ok(pack.identities['因果残片']);
  }
});
test('optional refusal consumes no use; an accepted no-op consumes the ability once', () => {
  const { pack, state } = base();
  state.characters.boy!.identity = '杀手';
  state.characters.boy!.counters.goodwill = 2;
  let s = phase(pack, state, 'protagonist-abilities');
  s = submit(pack, s, {
    kind: 'ability',
    owner: 'boy',
    ability: 'student',
    choices: { target: 'girl' },
  });
  assert.equal(s.pending!.kind, 'refusal');
  for (const refuse of [true, false]) {
    const answer: Choice = { kind: 'refuse', refuse };
    const restored = submit(pack, JSON.parse(JSON.stringify(s)), answer);
    assert.notEqual(restored.pending?.kind, 'refusal');
    assert.equal(replayFingerprint(restored), replayFingerprint(submit(pack, s, answer)));
  }
  s = submit(pack, s, { kind: 'refuse', refuse: true });
  assert.equal(Object.keys(s.uses).length, 0);
  s = submit(pack, s, {
    kind: 'ability',
    owner: 'boy',
    ability: 'student',
    choices: { target: 'girl' },
  });
  s = submit(pack, s, { kind: 'refuse', refuse: false });
  assert.equal(s.characters.girl!.counters.paranoia, 0);
  assert.ok(Object.values(s.uses).some((n) => n === 1));
  assert.ok(!s.pending?.options.some((c) => c.kind === 'ability' && c.owner === 'boy'));
});
test('goodwill menu cannot reveal optional versus mandatory hidden refusal traits', () => {
  const { pack, state } = base();
  state.characters.boy!.counters.goodwill = 2;
  const a = clone(state),
    b = clone(state);
  a.characters.boy!.identity = '杀手';
  b.characters.boy!.identity = '邪教徒';
  const x = project(phase(pack, a, 'protagonist-abilities'), 'p0');
  const y = project(phase(pack, b, 'protagonist-abilities'), 'p0');
  assert.deepEqual(x, y);
});
test('AHR: paired identities switch without changing initial identities; repeated world movements add one EX at day end', () => {
  const { state } = base();
  const pack = compileOfficial('AHR');
  state.ruleDigest = pack.digest;
  state.setup.module = 'AHR';
  state.setup.y = '童话里的杀人鬼';
  state.setup.x = ['化身博士', '傀儡之线'];
  state.setup.characters[0]!.reverseIdentity = '主谋';
  state.characters.boy!.initialIdentity = '关键人物';
  settle(pack, state, [
    { effect: { op: 'world-move' }, env: {} },
    { effect: { op: 'world-move' }, env: {} },
  ]);
  assert.equal(state.ex, 0);
  phase(pack, state, 'day-end');
  assert.equal(state.ex, 1);
  assert.equal(state.characters.boy!.identity, '主谋');
  assert.equal(state.characters.boy!.initialIdentity, '关键人物');
});
test('AHR: zero-EX Alice does not gain an EX>=1 completion effect from a later world-move marker', () => {
  const { state } = base();
  const pack = compileOfficial('AHR');
  state.ruleDigest = pack.digest;
  state.setup.module = 'AHR';
  state.characters.boy!.identity = state.characters.boy!.initialIdentity = '爱丽丝';
  state.frames = [
    {
      id: 'alice',
      source: 'test',
      owner: 'boy',
      actor: 'p0',
      kind: 'ability',
      ability: {
        id: 'test-goodwill',
        source: 'test',
        timing: 'protagonist-abilities',
        threshold: 0,
        loopLimit: 1,
        steps: [{ effects: [] }],
      },
      steps: [{ effects: [] }],
      step: 0,
      choices: {},
      bound: { refusalChecked: 'yes' },
      cleanup: false,
    },
  ];
  state.pending = null;
  state.phase = 'protagonist-abilities';
  state.phaseEntered = true;
  drive(pack, state, 6);
  assert.equal(state.characters.girl!.counters.hope, 0);
  assert.equal(state.flags['world-moved'], 'yes');
  assert.equal(state.ex, 0);
});
test('AHR: paired setup validates exact whole pairs and exempts their compulsory culprit constraint', () => {
  const pack = compileOfficial('AHR');
  const setup: GameSetup = {
    module: 'AHR',
    anniversary: false,
    days: 1,
    loops: 1,
    captain: 'p0',
    discussion: 'allowed',
    y: '闭锁的未来',
    x: ['超越世界线', '傀儡之线'],
    incidents: [],
    characters: [
      { id: 'a', character: '男学生', identity: '强迫症', reverseIdentity: '关键人物' },
      { id: 'b', character: '女学生', identity: '提线木偶' },
      { id: 'c', character: '医生', identity: '叙述者' },
      { id: 'd', character: '巫女', identity: '传谣人' },
      { id: 'e', character: '住院患者', identity: '因果残片' },
      { id: 'f', character: '偶像', identity: '布道者' },
      { id: 'g', character: 'AI', identity: '平民', reverseIdentity: '杀人狂' },
    ],
  };
  assert.deepEqual(initializeDiscussion(pack, setup).diagnostics, []);
  setup.characters[0]!.reverseIdentity = '主谋';
  assert.ok(initializeDiscussion(pack, setup).diagnostics.some((d) => d.code === 'identity-pairs'));
});
test('WM: EX persists between loops and cumulative knowledge does not get cleared', () => {
  const { state } = base();
  const pack = compileOfficial('WM');
  state.ruleDigest = pack.digest;
  state.setup.module = 'WM';
  state.setup.y = '黄衣之王';
  state.setup.x = ['流言四起', '见证恐惧'];
  state.ex = 2;
  state.failed = true;
  state.endRequested = true;
  state.phase = 'loop-end';
  state.phaseEntered = false;
  state.pending = null;
  drive(pack, state, 100);
  assert.equal(state.phase, 'discussion');
  assert.equal(state.previousLoop!.ex, 2);
  const next = submit(pack, state, { kind: 'continue' });
  assert.equal(next.ex, 2);
  assert.ok(
    next.observations.protagonists.some((o) => o.type === 'rule' && o.data.rule === '流言四起'),
  );
});
test('HSA: victims count as corpses and reviving one removes exactly one intrigue', () => {
  const { state } = base();
  const pack = compileOfficial('HSA');
  state.ruleDigest = pack.digest;
  state.setup.module = 'HSA';
  state.boards.school = 2;
  settle(pack, state, [{ effect: { op: 'revive', target: 'victim:school:0' }, env: {} }]);
  assert.equal(state.boards.school, 1);
});
test('HSA: two attached curses generate two requests and return to the board', () => {
  const { state } = base();
  const pack = compileOfficial('HSA');
  state.ruleDigest = pack.digest;
  state.setup.module = 'HSA';
  state.characters.girl!.counters.guard = 1;
  state.curses = [
    { id: 'a', target: 'girl' },
    { id: 'b', target: 'girl' },
  ];
  state.pending = null;
  state.phase = 'day-end';
  state.phaseEntered = false;
  drive(pack, state, 7);
  assert.equal(state.characters.girl!.status, 'dead');
  assert.equal(state.characters.girl!.counters.guard, 0);
  assert.deepEqual(
    state.curses.map((c) => c.target),
    ['school', 'school'],
  );
});
test('MZ: magician death cleanup survives an already latched key-person failure', () => {
  const { state } = base();
  const pack = compileOfficial('MZ');
  state.ruleDigest = pack.digest;
  state.setup.module = 'MZ';
  state.characters.girl!.identity = '魔术师';
  state.characters.girl!.counters.paranoia = 5;
  state.pending = null;
  state.phase = 'incident';
  state.phaseEntered = true;
  state.frames = [
    {
      id: 'test-batch',
      source: 'test',
      owner: '',
      actor: 'mastermind',
      kind: 'mandatory',
      steps: [
        {
          effects: [
            { op: 'kill', target: 'boy' },
            { op: 'kill', target: 'girl' },
          ],
        },
      ],
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    },
  ];
  drive(pack, state, 5);
  assert.equal(state.endRequested, true);
  assert.equal(state.characters.girl!.counters.paranoia, 0);
});
test('AI invocation does not register an incident or trigger WM first-occurrence extermination', () => {
  const { state } = base();
  const pack = compileOfficial('WM');
  state.ruleDigest = pack.digest;
  state.setup.module = 'WM';
  state.pending = null;
  state.phase = 'protagonist-abilities';
  state.phaseEntered = true;
  state.frames = [
    {
      id: 'ai-call',
      source: 'test',
      owner: 'boy',
      actor: 'p0',
      kind: 'ability',
      steps: [{ effects: [{ op: 'invoke-incident', name: '灭绝之火', culprit: 'boy' }] }],
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    },
  ];
  drive(pack, state, 8);
  assert.equal(state.protagonistDead, false);
  assert.equal(state.incidents.length, 0);
  assert.ok(
    state.audit.some(
      (e) => e.kind === 'source-completed' && (e.data as { id: string }).id === 'ai-call',
    ),
  );
});
test('reference search keeps correlated setups, returns unknown for unsearched branches, and replays its witness', () => {
  const { pack, setup, state } = base('FS');
  const switched = clone(setup);
  [switched.characters[0]!.identity, switched.characters[1]!.identity] = [
    switched.characters[1]!.identity,
    switched.characters[0]!.identity,
  ];
  const domain = [
    { id: 'a', setup },
    { id: 'b', setup: switched },
  ];
  const knowledge = createReferenceKnowledge(pack, domain, state.observations.protagonists);
  const budget = { expansions: 4, choicesPerNode: 2, depth: 3, engineSteps: 100 };
  const result = queryReference(pack, knowledge, budget);
  assert.deepEqual(result.retained, ['a', 'b']);
  assert.ok(checkWitness(pack, domain[0]!, result.witnesses[0]!, knowledge.history));
  const after = submit(pack, state, { kind: 'continue' });
  const later = createReferenceKnowledge(pack, domain, after.observations.protagonists);
  assert.equal(queryReference(pack, later, { ...budget, expansions: 0 }).status, 'unknown');
});
test('replay and batch calls reproduce the same state and do not mutate the source', () => {
  const { pack, setup, state } = base('FS');
  const request = {
    setup,
    choices: [{ actor: 'p0' as const, choice: { kind: 'continue' as const } }],
  };
  const single = replay(pack, request);
  assert.equal(single.status, 'replayed');
  const batch = runBatch(pack, [request, request]);
  if (single.status === 'replayed')
    for (const entry of batch) {
      assert.equal(entry.status, 'replayed');
      if (entry.status === 'replayed')
        assert.equal(replayFingerprint(entry.state), replayFingerprint(single.state));
    }
  assert.equal(state.phase, 'discussion');
});
function llState(): { pack: RulePack; state: EngineState } {
  const { state } = base();
  const pack = compileOfficial('LL');
  state.ruleDigest = pack.digest;
  state.setup.module = 'LL';
  state.setup.y = '最终计划';
  state.setup.x = ['真正的怪物', '神话收集者'];
  state.ll = {
    roles: { p0: 'B', p1: 'A', p2: 'C' },
    communicated: [],
    died: [],
    finalTraitorsDisabled: false,
  };
  return { pack, state };
}
test('LL private roles are visible only to their owner', () => {
  const { state } = llState();
  state.phase = 'day-start';
  assert.equal(project(state, 'p0').personalRole, 'B');
  assert.equal(project(state, 'p1').personalRole, 'A');
  assert.equal(project(state, 'mastermind').personalRole, undefined);
  assert.equal(project(state, 'protagonists').personalRole, undefined);
  assert.ok(!JSON.stringify(project(state, 'mastermind')).includes('privateRoles'));
});
test('LL sixth communication wins before ability effects; refusal never registers communication', () => {
  const { pack, state } = llState();
  state.ll!.communicated = ['old1', 'old2', 'old3', 'old4', 'old5'];
  state.characters.boy!.identity = '平民';
  state.characters.boy!.counters.goodwill = 2;
  state.characters.girl!.counters.paranoia = 1;
  let s = phase(pack, state, 'protagonist-abilities');
  s = submit(pack, s, {
    kind: 'ability',
    owner: 'boy',
    ability: 'student',
    choices: { target: 'girl' },
  });
  assert.equal(s.winner, 'p0');
  assert.deepEqual(s.winners, ['p0']);
  assert.equal(s.characters.girl!.counters.paranoia, 1);
});
test('LL fifth death is checked only in day-end, and final-plan hope disables traitors', () => {
  const { pack, state } = llState();
  state.ll!.died = ['a', 'b', 'c', 'd'];
  state.phase = 'incident';
  settle(pack, state, [{ effect: { op: 'kill', target: 'girl' }, env: {} }]);
  assert.equal(state.latchedWinner, undefined);
  state.characters.boy!.counters.hope = 1;
  assert.deepEqual(traitors(state), []);
  phase(pack, state, 'day-end');
  assert.equal(state.winner, undefined);
  state.phase = 'day-end';
  state.phaseEntered = true;
  state.characters.boy!.counters.hope = 0;
  recompute(state);
  state.pending = null;
  drive(pack, state, 5);
  assert.equal(state.winner, 'p1');
});
test('LL delegate decisions remain personal even in no-discussion mode', () => {
  const { pack, state } = llState();
  state.pending = null;
  state.phase = 'incident';
  state.phaseEntered = true;
  state.frames = [
    {
      id: 'delegate',
      source: 'test',
      owner: 'girl',
      actor: 'mastermind',
      kind: 'incident',
      steps: clone(pack.incidents['代行者']!.steps),
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    },
  ];
  drive(pack, state, 10);
  let s = submit(pack, state, { kind: 'select', value: 'p2' });
  assert.equal(s.pending!.actor, 'p2');
  assert.equal(s.pending!.kind, 'choice');
  assert.equal(project(s, 'p0').decision, undefined);
});
test('LL key reveal on the final day schedules same-day mandatory death, not next-loop restrictions', () => {
  const { pack, state } = llState();
  state.characters.girl!.identity = '密钥';
  state.day = state.setup.days;
  state.phase = 'day-end';
  state.phaseEntered = true;
  state.pending = null;
  state.frames = [
    {
      id: 'reveal-key',
      source: 'test',
      owner: 'girl',
      actor: 'mastermind',
      kind: 'mandatory',
      steps: [{ effects: [{ op: 'reveal-identity', target: 'girl' }] }],
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    },
  ];
  drive(pack, state, 6);
  assert.equal(state.protagonistDead, true);
});
test('two or more intrigue prohibitions cancel globally; additions precede subtraction', () => {
  const { pack, state } = base();
  state.pending = null;
  state.phase = 'card-resolution';
  state.phaseEntered = false;
  const placements = [
    { card: 'mastermind-8', target: 'boy' },
    { card: 'p0-7', target: 'boy' },
    { card: 'p1-7', target: 'girl' },
    { card: 'mastermind-4', target: 'doctor' },
    { card: 'p2-6', target: 'doctor' },
  ];
  state.placements = placements;
  for (const p of placements) state.cards.find((c) => c.id === p.card)!.status = 'set';
  drive(pack, state, 100);
  assert.equal(state.characters.boy!.counters.intrigue, 1);
  assert.equal(state.characters.doctor!.counters.paranoia, 0);
});
test('hope is not blocked by goodwill prohibition and one played hope removes all hope cards', () => {
  const { pack, state } = base();
  state.pending = null;
  state.phase = 'card-resolution';
  state.phaseEntered = false;
  for (const owner of ['p0', 'p1', 'p2'] as const)
    state.cards.push({
      id: `${owner}-hope`,
      owner,
      kind: 'hope+1',
      once: true,
      status: owner === 'p0' ? 'set' : 'hand',
    });
  state.placements = [
    { card: 'p0-hope', target: 'boy' },
    { card: 'mastermind-3', target: 'boy' },
  ];
  state.cards.find((c) => c.id === 'mastermind-3')!.status = 'set';
  drive(pack, state, 100);
  assert.equal(state.characters.boy!.counters.hope, 1);
  assert.ok(state.cards.filter((c) => c.kind === 'hope+1').every((c) => c.status === 'removed'));
});
test('multiple hope cards become goodwill and return to their owners', () => {
  const { pack, state } = base();
  state.pending = null;
  state.phase = 'card-resolution';
  state.phaseEntered = false;
  for (const owner of ['p0', 'p1'] as const)
    state.cards.push({ id: `${owner}-hope`, owner, kind: 'hope+1', once: true, status: 'set' });
  state.placements = [
    { card: 'p0-hope', target: 'boy' },
    { card: 'p1-hope', target: 'girl' },
    { card: 'mastermind-3', target: 'boy' },
  ];
  state.cards.find((c) => c.id === 'mastermind-3')!.status = 'set';
  drive(pack, state, 100);
  assert.equal(state.characters.boy!.counters.goodwill, 0);
  assert.equal(state.characters.girl!.counters.goodwill, 1);
  assert.ok(state.cards.filter((c) => c.kind === 'hope+1').every((c) => c.status === 'hand'));
});
test('surrendering remaining loops requires an explicit vote from all three protagonists', () => {
  const { pack, state } = base();
  let s = submit(pack, state, { kind: 'request-final-guess' });
  for (const actor of ['p0', 'p1', 'p2']) {
    assert.equal(s.pending!.actor, actor);
    s = submit(pack, s, { kind: 'vote-final-guess', agree: true });
  }
  assert.equal(s.phase, 'final-guess');
});
test('an early final-guess veto discards every prior vote and leaves the loop playable', () => {
  // Local rules article 156717aa7f6b1574, unanimous surrender of remaining loops.
  const { pack, state } = base();
  for (const vetoAt of [0, 1, 2]) {
    let s = submit(pack, state, { kind: 'request-final-guess' });
    for (let i = 0; i <= vetoAt; i++)
      s = submit(pack, s, { kind: 'vote-final-guess', agree: i !== vetoAt });
    assert.equal(s.phase, 'discussion');
    assert.equal(s.loop, state.loop);
    assert.equal(submit(pack, s, { kind: 'continue' }).phase, 'mastermind-cards');

    s = submit(pack, s, { kind: 'request-final-guess' });
    const voters = new Set();
    for (let i = 0; i < 3; i++) {
      voters.add(s.pending!.actor);
      s = submit(pack, s, { kind: 'vote-final-guess', agree: true });
    }
    assert.equal(voters.size, 3);
    assert.equal(s.phase, 'final-guess');
  }
});
test('both legal discussion modes produce the same finite-domain reference result', () => {
  const { pack, setup, state } = base('FS');
  const different = { ...setup, discussion: 'allowed' as const };
  const knowledge = createReferenceKnowledge(
    pack,
    [
      { id: 'restricted', setup },
      { id: 'open', setup: different },
    ],
    state.observations.protagonists,
  );
  assert.deepEqual(
    queryReference(pack, knowledge, {
      expansions: 0,
      choicesPerNode: 0,
      depth: 0,
      engineSteps: 100,
    }).retained,
    ['restricted', 'open'],
  );
});

test('only actual serial murders may reuse a character culprit', () => {
  const { pack, setup } = base();
  setup.incidents = [
    { day: 1, name: '谋杀', culprit: 'girl' },
    { day: 2, name: '自杀', culprit: 'girl' },
  ];
  assert.ok(initializeDiscussion(pack, setup).diagnostics.some((d) => d.code === 'repeated-culprit'));
  setup.incidents = setup.incidents.map((i) => ({ ...i, name: '连续杀人' }));
  assert.ok(!initializeDiscussion(pack, setup).diagnostics.some((d) => d.code === 'repeated-culprit'));
  setup.incidents = setup.incidents.map((i) => ({
    ...i,
    name: '伪造事件',
    publicName: '连续杀人',
  }));
  assert.ok(initializeDiscussion(pack, setup).diagnostics.some((d) => d.code === 'repeated-culprit'));
});
test('cult leader doubles threshold offsets and compound effects exactly once', () => {
  const { state } = base();
  const pack = compileOfficial('MC');
  state.ruleDigest = pack.digest;
  state.setup.module = 'MC';
  state.characters.girl!.character = '教主';
  state.characters.girl!.paranoiaLimit = 3;
  state.characters.girl!.counters.paranoia = 1;
  state.setup.incidents = [{ day: 1, name: '前兆', culprit: 'girl' }];
  let s = phase(pack, state, 'incident');
  assert.equal(s.incidents.length, 1);
  s = submit(pack, s, { kind: 'select', value: 'boy' });
  s = submit(pack, s, { kind: 'select', value: 'boy' });
  assert.equal(s.characters.boy!.counters.paranoia, 2);
  const conspiracyPack = compileOfficial('MZ');
  s.ruleDigest = conspiracyPack.digest;
  s.setup.module = 'MZ';
  s.day = 1;
  s.characters.girl!.counters.intrigue = 3;
  s.setup.incidents = [{ day: 1, name: '阴谋活动', culprit: 'girl' }];
  s = phase(conspiracyPack, s, 'incident');
  for (let n = 0; n < 2; n++) {
    assert.equal(s.pending!.kind, 'choice');
    s = submit(conspiracyPack, s, { kind: 'select', value: '失踪' });
    s = submit(conspiracyPack, s, { kind: 'select', value: n === 0 ? 'hospital' : 'school' });
  }
  assert.equal(
    s.audit.filter(
      (a) => a.kind === 'source-completed' && (a.data as { incident?: string }).incident === '失踪',
    ).length,
    2,
  );
  assert.equal(s.characters.girl!.area, 'school');
});
test('explicit goodwill incident thresholds override AI total-counter substitution', () => {
  const { state } = base();
  const pack = compileOfficial('BTX', true);
  state.ruleDigest = pack.digest;
  state.characters.girl!.character = 'AI';
  state.characters.girl!.paranoiaLimit = 4;
  state.characters.girl!.counters.intrigue = 8;
  state.setup.incidents = [{ day: 1, name: '希望之光', culprit: 'girl' }];
  phase(pack, state, 'incident');
  assert.equal(state.incidents.length, 0);
  state.day = 1;
  state.characters.girl!.counters.goodwill = 4;
  phase(pack, state, 'incident');
  assert.equal(state.incidents.length, 1);
});
test('sacrifice incident counting does not count despair twice', () => {
  const { state } = base();
  const pack = compileOfficial('MZ');
  state.ruleDigest = pack.digest;
  state.characters.girl!.identity = '祭品';
  state.characters.girl!.paranoiaLimit = 3;
  state.characters.girl!.counters.despair = 1;
  state.characters.girl!.counters.intrigue = 1;
  state.setup.incidents = [{ day: 1, name: '自杀', culprit: 'girl' }];
  phase(pack, state, 'incident');
  assert.equal(state.incidents.length, 0);
});
test('a truncated repeated compound incident cannot trigger fool completion from its completed child', () => {
  const { state } = base();
  const pack = compileOfficial('MZ');
  state.ruleDigest = pack.digest;
  state.setup.module = 'MZ';
  state.characters.girl!.character = '教主';
  state.characters.girl!.identity = '愚者';
  state.characters.girl!.counters.intrigue = 3;
  state.characters.girl!.counters.paranoia = 3;
  state.setup.incidents = [{ day: 1, name: '阴谋活动', culprit: 'girl' }];
  let s = phase(pack, state, 'incident');
  s = submit(pack, s, { kind: 'select', value: '连续杀人' });
  // The only other character in school is the key person: automatic target choice.
  assert.equal(s.failed, true);
  assert.equal(s.characters.girl!.counters.paranoia, 3);
  assert.ok(
    !s.audit.some(
      (a) =>
        a.kind === 'source-completed' && (a.data as { incident?: string }).incident === '阴谋活动',
    ),
  );
});
test('LL private C final guesses precede ordinary final guesses and have their own winner', () => {
  const { pack, state } = llState();
  state.setup.x = ['我才是名侦探', 'SNS恐慌'];
  state.characters.boy!.counters.hope = 0;
  state.setup.incidents = [
    { day: 1, name: '自杀', culprit: 'girl' },
    { day: 2, name: '谋杀', culprit: 'boy' },
  ];
  let s = phase(pack, state, 'final-guess');
  assert.equal(s.pending!.actor, 'p2');
  assert.equal(project(s, 'p2').decision!.answerKind, 'culprits');
  const checkpoint = clone(s);
  s = submit(pack, s, { kind: 'guess-culprits', answers: { '1': 'girl', '2': 'boy' } });
  assert.equal(s.winner, 'p2');
  s = submit(pack, checkpoint, { kind: 'guess-culprits', answers: { '1': 'boy', '2': 'girl' } });
  assert.equal(s.winner, undefined);
  assert.equal(project(s, s.pending!.actor).decision!.answerKind, 'identities');
});
test('JSON boundaries reject malformed commands and unknown setup rules without changing the game', () => {
  const { pack, setup, state } = base();
  assert.ok(
    initializeDiscussion(pack, { ...setup, specialRules: ['ignored?'] } as GameSetup).diagnostics.some(
      (d) => d.code === 'invalid-setup',
    ),
  );
  assert.ok(
    initializeDiscussion(pack, null as unknown as GameSetup).diagnostics.some(
      (d) => d.code === 'invalid-setup',
    ),
  );
  const r = advance(pack, state, state.pending!.actor, {
    id: 'malformed',
    expectedRevision: state.revision,
    decisionId: state.pending!.id,
    choice: { kind: 'cards' },
  } as never);
  assert.equal(r.status, 'rejected');
  assert.equal(r.state, state);
  assert.equal(resume(compileOfficial('FS'), state, 1).status, 'rejected');
});
