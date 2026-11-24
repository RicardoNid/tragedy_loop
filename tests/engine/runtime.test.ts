import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import {
  advance,
  drive,
  initialize,
  initializeDiscussion,
  legalCardTargets,
  resume,
} from '../../packages/engine/src/runtime/engine.js';
import { project, createSession } from '../../packages/engine/src/runtime/ports.js';
import { settle } from '../../packages/engine/src/runtime/settlement.js';
import { clone, type EngineState } from '../../packages/engine/src/runtime/model.js';
import { effective } from '../../packages/engine/src/runtime/expressions.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';

const pack = compileOfficial('FS');
export function fixture(): GameSetup {
  return {
    module: 'FS',
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'between-loops',
    y: '复仇的火种',
    x: ['流言四起'],
    characters: [
      { id: 'boy', character: '男学生', identity: '主谋' },
      { id: 'girl', character: '女学生', identity: '传谣人' },
      { id: 'patient', character: '住院患者', identity: '平民' },
      { id: 'rich', character: '大小姐', identity: '平民' },
      { id: 'servant', character: '从者', identity: '平民', initialArea: 'school' },
    ],
    incidents: [],
  };
}
export function stateOf(rules = pack, setup = fixture()): EngineState {
  const result = initializeDiscussion(rules, setup);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.state);
  return result.state;
}
function act(state: EngineState, choice: Choice, rules = pack): EngineState {
  assert.ok(state.pending);
  const result = advance(rules, state, state.pending.actor, {
    id: `c-${state.revision}`,
    expectedRevision: state.revision,
    decisionId: state.pending.id,
    choice,
  });
  assert.equal(result.status, 'ok', result.reason);
  return result.state;
}
function neutral(state: EngineState): Choice {
  const p = state.pending!;
  if (p.kind === 'cards') {
    const targets = legalCardTargets(state, p.actor).filter((t) =>
      ['hospital', 'shrine', 'city', 'school'].includes(t),
    );
    const cards = state.cards.filter(
      (c) =>
        c.owner === p.actor &&
        c.status === 'hand' &&
        ['horizontal', 'vertical', 'paranoia-1'].includes(c.kind),
    );
    return {
      kind: 'cards',
      placements: cards
        .slice(0, p.actor === 'mastermind' ? 3 : 1)
        .map((c, i) => ({ card: c.id, target: targets[i]! })),
    };
  }
  return p.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ?? p.options[0]!;
}
test('briefing and delayed arrivals expose only the public sheet until the pieces enter play', () => {
  const setup = fixture();
  setup.characters[2] = { id: 'transfer', character: '转校生', identity: '平民', enterDay: 2 };
  setup.characters[3] = { id: 'divinity', character: '神灵', identity: '平民', enterLoop: 2 };
  setup.incidents = [{ day: 2, name: '谋杀', culprit: 'boy' }];
  setup.publicSpecialRules = ['公开测试说明'];
  const initial = initialize(pack, setup);
  assert.deepEqual(initial.diagnostics, []);
  let state = initial.state!;
  const visible = () => project(state, 'protagonists').characters.map((c) => c.id);
  for (const seat of ['p0', 'p1', 'p2', 'protagonists'] as const) {
    const v = project(state, seat);
    assert.deepEqual(v.incidents, [{ day: 2, name: '谋杀' }]);
    assert.deepEqual(v.publicSpecialRules, setup.publicSpecialRules);
    assert.deepEqual(v.characters, []);
    assert.deepEqual(v.observations, []);
    assert.equal(v.personalRole, undefined);
    assert.deepEqual(v.hands, {});
  }
  const master = project(state, 'mastermind');
  assert.ok('secret' in master);
  assert.deepEqual(master.secret.characters, setup.characters);
  assert.deepEqual(master.secret.incidents, setup.incidents);

  state = act(state, { kind: 'start' });
  for (const seat of ['p0', 'p1', 'p2', 'protagonists'] as const) {
    assert.deepEqual(project(state, seat).characters, []);
    assert.equal(project(state, seat).territory, undefined);
  }
  state = act(state, { kind: 'continue' });
  assert.deepEqual(visible(), ['boy', 'girl', 'servant']);
  while (state.day === 1 && !state.winner) state = act(state, neutral(state));
  assert.equal(state.day, 2);
  assert.ok(visible().includes('transfer'));
  assert.ok(!JSON.stringify(project(state, 'p0')).includes('divinity'));

  // Take a failed-loop boundary to exercise the ordinary second-loop setup path.
  state.pending = null;
  state.phase = 'loop-end';
  state.phaseEntered = true;
  state.failed = true;
  drive(pack, state, 100);
  assert.equal(state.loop, 2);
  assert.ok(!visible().includes('divinity'));
  state = act(state, { kind: 'continue' });
  assert.ok(visible().includes('divinity'));
});

test('valid setup creates an independent mutable state with an immutable reusable pack', () => {
  const s = stateOf(),
    branch = clone(s);
  branch.characters.boy!.counters.goodwill = 5;
  assert.equal(s.characters.boy!.counters.goodwill, 0);
  assert.ok(Object.isFrozen(pack));
  assert.ok(validateSetup(pack, { ...fixture(), x: [] }).some((d) => d.code === 'invalid-x-slots'));
});
test('full FS loop can reach a real win, with ordered facedown cards and captain rotation', () => {
  let s = stateOf();
  const actors: string[] = [];
  for (let n = 0; n < 60 && !s.winner; n++) {
    if (s.pending?.kind === 'cards') actors.push(s.pending.actor);
    s = act(s, neutral(s));
  }
  assert.equal(s.winner, 'protagonists');
  assert.deepEqual(actors, ['mastermind', 'p0', 'p1', 'p2', 'mastermind', 'p1', 'p2', 'p0']);
});
test('Q1: two substitute requests plus one direct request consume one guard and kill once', () => {
  const s = stateOf();
  s.characters.servant!.counters.guard = 1;
  s.characters.servant!.flags.protect = 'girl';
  const r = settle(
    pack,
    s,
    ['rich', 'girl', 'servant'].map((target) => ({
      effect: { op: 'kill' as const, target },
      env: {},
    })),
  );
  assert.deepEqual(r.died, ['servant']);
  assert.equal(s.characters.servant!.counters.guard, 0);
  assert.equal(s.characters.rich!.status, 'alive');
  assert.equal(s.characters.girl!.status, 'alive');
  assert.equal(s.audit.filter((e) => e.kind === 'replacement-request').length, 2);
});
test('immortality prevents guard consumption and actual death triggers', () => {
  const s = stateOf();
  s.characters.servant!.identity = '时间旅者';
  s.characters.servant!.counters.guard = 1;
  const btx = compileOfficial('BTX');
  const r = settle(btx, s, [{ effect: { op: 'kill', target: 'servant' }, env: {} }]);
  assert.deepEqual(r.died, []);
  assert.equal(s.characters.servant!.counters.guard, 1);
});

test('FS and BTX exhaust simultaneous servant substitutions, immunity and shared guards', () => {
  const ids = ['rich', 'girl', 'servant'] as const;
  type Target = (typeof ids)[number];
  // Enumerate every nonempty subset and every presentation order of its requests.
  function* orders(prefix: Target[]): Generator<Target[]> {
    if (prefix.length) yield prefix;
    for (const id of ids) if (!prefix.includes(id)) yield* orders([...prefix, id]);
  }
  let checked = 0;
  for (const module of ['FS', 'BTX'] as const) {
    const rules = compileOfficial(module);
    const base = stateOf();
    base.setup.module = module;
    base.ruleDigest = rules.digest;
    base.characters.servant!.flags.protect = 'girl';
    for (const requests of orders([]))
      for (const immune of module === 'BTX' ? [undefined, ...ids] : [undefined])
        for (const richGuard of [0, 1])
          for (const girlGuard of [0, 1])
            for (const servantGuard of [0, 1, 2]) {
              const s = structuredClone(base);
              const guards = { rich: richGuard, girl: girlGuard, servant: servantGuard };
              for (const id of ids) {
                s.characters[id]!.area = 'school';
                s.characters[id]!.counters.guard = guards[id];
                if (id === immune) s.characters[id]!.identity = '时间旅者';
              }
              // Independent count oracle: deduct guards on original targets first,
              // then combine the uncovered requests received by their one substitute.
              let received = Number(requests.includes('servant'));
              for (const id of ['rich', 'girl'] as const) {
                if (!requests.includes(id) || id === immune) continue;
                if (guards[id]) guards[id]--;
                else received++;
              }
              const dies = immune !== 'servant' && received > servantGuard;
              if (immune !== 'servant') guards.servant = Math.max(0, servantGuard - received);
              const result = settle(
                rules,
                s,
                requests.map((target) => ({ effect: { op: 'kill', target }, env: {} })),
              );
              const description = JSON.stringify({
                module,
                requests,
                immune,
                richGuard,
                girlGuard,
                servantGuard,
              });
              assert.deepEqual(result.died, dies ? ['servant'] : [], description);
              for (const id of ids) {
                assert.equal(
                  s.characters[id]!.status,
                  id === 'servant' && dies ? 'dead' : 'alive',
                  description,
                );
                assert.equal(s.characters[id]!.counters.guard, guards[id], description);
              }
              checked++;
            }
  }
  assert.equal(checked, 900);
});
test('Q2: established hospital batch kills everyone before loop interruption, fool completion still fires', () => {
  const mc = compileOfficial('MC'),
    s = stateOf();
  s.ruleDigest = mc.digest;
  s.setup.module = 'MC';
  s.phase = 'incident';
  s.phaseEntered = true;
  s.pending = null;
  s.characters.boy!.identity = '关键人物';
  s.characters.girl!.identity = '愚者';
  s.characters.boy!.area = s.characters.girl!.area = 'hospital';
  s.characters.girl!.counters.paranoia = 4;
  s.boards.hospital = 2;
  s.frames = [
    {
      id: 'hospital',
      source: 'test',
      owner: 'girl',
      actor: 'mastermind',
      kind: 'incident',
      steps: clone(mc.incidents['医院事故']!.steps),
      step: 0,
      choices: {},
      bound: {},
      incident: '医院事故',
      cleanup: false,
    },
  ];
  drive(mc, s, 10);
  assert.equal(s.characters.boy!.status, 'dead');
  assert.equal(s.characters.girl!.status, 'dead');
  assert.equal(s.protagonistDead, true);
  assert.equal(s.characters.girl!.counters.paranoia, 0);
  assert.ok(
    s.audit.some(
      (a) => a.kind === 'source-completed' && (a.data as { id: string }).id === 'hospital',
    ),
  );
});
test('Q2: interrupted horrific murder does not run spread or fool completion', () => {
  const mc = compileOfficial('MC'),
    s = stateOf();
  s.ruleDigest = mc.digest;
  s.setup.module = 'MC';
  s.phase = 'incident';
  s.phaseEntered = true;
  s.pending = null;
  s.characters.boy!.identity = '关键人物';
  s.characters.girl!.identity = '愚者';
  s.characters.boy!.area = s.characters.girl!.area = 'hospital';
  s.characters.patient!.area = 'city';
  s.characters.girl!.counters.paranoia = 4;
  s.frames = [
    {
      id: 'horrific',
      source: 'test',
      owner: 'girl',
      actor: 'mastermind',
      kind: 'incident',
      steps: clone(mc.incidents['猎奇杀人']!.steps),
      step: 0,
      choices: {},
      bound: {},
      incident: '猎奇杀人',
      cleanup: false,
    },
  ];
  drive(mc, s, 10);
  assert.equal(s.characters.boy!.status, 'dead');
  assert.equal(s.characters.girl!.counters.paranoia, 4);
  assert.ok(
    !s.audit.some(
      (a) => a.kind === 'source-completed' && (a.data as { id: string }).id === 'horrific',
    ),
  );
});
test('simultaneous serial killers cannot cancel one another by execution order', () => {
  const s = stateOf();
  s.pending = null;
  s.phase = 'day-end';
  s.phaseEntered = false;
  s.characters.boy!.identity = s.characters.girl!.identity = '杀人狂';
  s.characters.boy!.area = s.characters.girl!.area = 'city';
  drive(pack, s, 3);
  assert.equal(s.characters.boy!.status, 'dead');
  assert.equal(s.characters.girl!.status, 'dead');
});
test('Q3: post-loop-end snapshot includes changes; causal link does not invent a loop zero', () => {
  const s = stateOf();
  s.setup.x = ['因果线'];
  s.pending = null;
  s.phase = 'loop-start';
  drive(pack, s, 1);
  assert.equal(s.characters.boy!.counters.paranoia, 0);
  s.pending = null;
  s.phase = 'loop-end';
  s.phaseEntered = true;
  s.failed = true;
  s.characters.boy!.counters.hope = 1;
  drive(pack, s, 5);
  assert.equal(s.phase, 'discussion');
  assert.equal(s.previousLoop!.characters.boy!.counters.hope, 1);
  const next = act(s, { kind: 'continue' });
  assert.equal(next.characters.boy!.counters.paranoia, 2);
  assert.equal(next.characters.boy!.counters.hope, 0);
});
test('raw counters differ from effective counts; board intrigue is capped at three', () => {
  const s = stateOf();
  s.characters.boy!.counters.hope = 2;
  s.characters.boy!.counters.despair = 1;
  assert.equal(effective(s, 'boy', 'intrigue'), 0);
  assert.equal(effective(s, 'boy', 'goodwill'), 2);
  assert.equal(effective(s, 'boy', 'paranoia'), 1);
  settle(pack, s, [
    { effect: { op: 'counter', target: 'hospital', counter: 'intrigue', amount: 5 }, env: {} },
  ]);
  assert.equal(s.boards.hospital, 3);
});
test('budget exhaustion is resumable, rejected commands leave input unchanged, retries are idempotent', () => {
  const s = stateOf();
  const command = {
    id: 'one',
    expectedRevision: 0,
    decisionId: s.pending!.id,
    choice: { kind: 'continue' as const },
  };
  const r = advance(pack, s, 'p0', command, 0);
  assert.equal(r.status, 'paused');
  assert.equal(s.phase, 'discussion');
  assert.equal(resume(pack, r.state, 100).state.pending?.actor, 'mastermind');
  assert.deepEqual(advance(pack, r.state, 'p0', command).state, r.state);
  assert.equal(advance(pack, s, 'p1', command).status, 'rejected');
});
test('ports hide initial identities, selected rules and opposing facedown cards', () => {
  let s = stateOf();
  s = act(s, { kind: 'continue' });
  s = act(s, neutral(s));
  const p = project(s, 'p0'),
    m = project(s, 'mastermind');
  assert.ok(!('secret' in p));
  assert.ok('secret' in m);
  assert.ok(p.placements.every((c) => !c.kind && !c.card));
  assert.ok(m.placements.every((c) => c.kind));
  assert.ok(!JSON.stringify(p).includes('复仇的火种'));
  assert.ok(!JSON.stringify(p).includes('主谋'));
  s = act(s, neutral(s));
  assert.ok(project(s, 'p1').placements.find((p) => p.owner === 'p0')?.kind);
  assert.equal(project(s, 'mastermind').placements.find((p) => p.owner === 'p0')?.kind, undefined);
});
test('actor-bound port rejects spoofed actor fields and uses only visible revision tokens', () => {
  const session = createSession(pack, fixture());
  assert.equal(session.status, 'ready');
  if (session.status !== 'ready') return;
  const view = session.protagonists.p0.view();
  const command = {
    id: 'start',
    expectedRevision: view.revision,
    decisionId: view.decision!.id,
    choice: { kind: 'start' as const },
  };
  assert.equal(session.protagonists.p1.submit(command).status, 'rejected');
  assert.equal(session.protagonists.p0.submit(command).status, 'ok');
  assert.equal(session.protagonists.p0.submit(command).status, 'ok');
});
test('discussion policy changes communication permission but not game observations', () => {
  const a = stateOf(),
    b = stateOf(pack, { ...fixture(), discussion: 'allowed' });
  const x = act(a, { kind: 'continue' }),
    y = act(b, { kind: 'continue' });
  assert.deepEqual(
    project(x, 'protagonists').observations,
    project(y, 'protagonists').observations,
  );
  assert.equal(project(x, 'p0').discussionAllowed, false);
  assert.equal(project(y, 'p0').discussionAllowed, true);
});
