import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import { initializeDiscussion, advance, drive } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import { buildProfiles } from '../../packages/engine/src/runtime/knowledge-domain.js';
import { CausalScope } from '../../packages/engine/src/runtime/knowledge-scope.js';
import { CardReports } from '../../packages/engine/src/runtime/knowledge-cards.js';
import { cardDestination } from '../../packages/engine/src/runtime/card-settlement.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import {
  ConstraintStore,
  relation,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';
import type {
  GameSetup,
  Observation,
  PlayerView,
  Choice,
} from '../../packages/contracts/src/game.js';

const setup: GameSetup = {
  module: 'FS',
  anniversary: false,
  loops: 2,
  days: 2,
  captain: 'p0',
  discussion: 'allowed',
  y: '复仇的火种',
  x: ['开膛者的魔影'],
  characters: [
    { id: 'a', character: '男学生', identity: '主谋' },
    { id: 'b', character: '住院患者', identity: '杀人狂' },
    { id: 'c', character: '巫女', identity: '传谣人' },
  ],
  incidents: [],
};
function fixture(module: 'FS' | 'BTX' = 'FS') {
  const pack = structuredClone(compileOfficial(module));
  const config = {
    ...setup,
    module,
    ...(module === 'BTX'
      ? {
          y: '被封印的邪灵',
          x: ['妄想扩大病毒', '因果线'],
          characters: setup.characters.map((c) =>
            c.id === 'b' ? { ...c, identity: '邪教徒' } : c,
          ),
        }
      : {}),
  };
  const initialized = initializeDiscussion(pack, config);
  assert.ok(initialized.state, JSON.stringify(initialized));
  const opening = initialPlacementView(initialized.state);
  const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 }).filter(
    (p) =>
      p.y === config.y && JSON.stringify([...p.x].sort()) === JSON.stringify([...config.x].sort()),
  );
  assert.ok(profiles.length);
  return { pack, opening, profiles, config };
}
function observation(
  type: Observation['type'],
  data: Observation['data'],
  phase: Observation['phase'] = 'mastermind-abilities',
  sequence = 2,
): Observation {
  return { sequence, loop: 1, day: 1, phase, type, data };
}
const increase = () => observation('board', { board: 'school', intrigue: 1 });

for (const module of ['FS', 'BTX'] as const)
  test(module + ': a cultist boss can bypass a blocked board in their territory', () => {
    const pack = compileOfficial(module);
    const config: GameSetup = {
      ...setup, module, y: module === 'FS' ? '守护此地' : '被封印的邪灵',
      x: module === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '大人物', identity: '邪教徒', territory: 'school' },
        { id: 'b', character: '住院患者', identity: module === 'FS' ? '关键人物' : '主谋' },
        { id: 'c', character: '巫女', identity: '传谣人' },
      ],
    };
    const opening = initialPlacementView(initializeDiscussion(pack, config).state!);
    const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 })
      .filter((p) => p.y === config.y && config.x.every((name) => p.x.includes(name)));
    assert.ok(profiles.length);
    const scope = new CausalScope(pack, opening);
    for (const [blocked, mode, expected] of [
      [false, 'pass', 1], [true, 'pass', 0], [true, 'actual', 0], [true, 'territory', 1],
    ] as const) {
      let state = initializeDiscussion(pack, config).state!;
      let resolved = false;
      for (let i = 0; i < 40 && state.phase !== 'mastermind-abilities'; i++) {
        const pending = state.pending!;
        let choice: Choice = pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ?? pending.options[0]!;
        if (pending.kind === 'cards') {
          const entries = pending.actor === 'mastermind' ?
            [['intrigue+1', 'school'], ['paranoia+1', 'b'], ['paranoia-1', 'c']] :
            pending.actor === 'p0' ? [[blocked ? 'block-intrigue' : 'block-movement', 'school']] :
            [['block-movement', pending.actor === 'p1' ? 'b' : 'c']];
          choice = { kind: 'cards', placements: entries.map(([kind, target]) => ({
            card: state.cards.find((c) => c.status === 'hand' && c.owner === pending.actor && c.kind === kind)!.id,
            target: target!,
          })) };
        } else if (state.flags['pending-binding'] === 'flag:ability-area:a') {
          choice = { kind: 'select', value: mode === 'pass' ? 'actual' : mode };
        } else if (state.phase === 'card-resolution' && pending.kind === 'ability' && mode !== 'pass') {
          choice = { kind: 'ability', ability: 'cultist', owner: 'a' };
          resolved = true;
        }
        const next = advance(pack, state, pending.actor, { id: 'faq-' + i, decisionId: pending.id, expectedRevision: state.revision, choice });
        assert.notEqual(next.status, 'rejected', JSON.stringify(choice));
        state = next.state;
      }
      assert.equal(state.phase, 'mastermind-abilities');
      assert.equal(resolved, mode !== 'pass');
      assert.equal(state.boards.school, expected);
      if (mode === 'territory') {
        let retainedOwner = false;
        for (const o of project(state, 'protagonists').observations) {
          const result = scope.consume(o, profiles);
          if (o.phase === 'card-resolution' && o.type === 'board' && o.data.board === 'school')
            retainedOwner ||= !!result?.characters.includes('a');
        }
        assert.ok(retainedOwner);
        assert.ok(profiles.some((p) => p.active && p.store.values('identity:a').has('邪教徒')));
      }
    }
  });
const domains = (p: ReturnType<typeof fixture>['profiles'][number]) =>
  Object.fromEntries([...p.store.domains].map(([key, values]) => [key, [...values].sort()]));

for (const module of ['FS', 'BTX'] as const)
  test(`${module}: local cause reads only in-area identities and preserves unrelated rules`, () => {
    const { pack, opening, profiles } = fixture(module);
    const scope = new CausalScope(pack, opening).consume(increase(), profiles)!;
    assert.deepEqual(scope.characters, ['a']);
    assert.deepEqual(scope.skippedCharacters, ['b', 'c']);
    assert.deepEqual(scope.rules, []);
    assert.ok(scope.skippedRules.includes(module === 'FS' ? '开膛者的魔影' : '妄想扩大病毒'));
    assert.ok(profiles.every((p) => p.active));
    for (const p of profiles) {
      assert.deepEqual(p.store.constraints.find((c) => c.name === 'cause:2')?.reads, [
        'identity:a',
      ]);
      assert.deepEqual([...p.store.values('identity:a')], ['主谋']);
      assert.ok(p.store.domains.has('identity:b'));
      assert.equal(p.store.stats.branches, 0);
      assert.ok(p.x.includes(module === 'FS' ? '开膛者的魔影' : '妄想扩大病毒'));
    }
  });

test('global rumor rule is an independent explanation, without requiring an in-area mastermind', () => {
  const { pack, opening } = fixture();
  const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 }).filter(
    (p) => p.x.includes('流言四起'),
  );
  const before = profiles.map(domains);
  const scope = new CausalScope(pack, opening).consume(
    observation('board', { board: 'city', intrigue: 1 }),
    profiles,
  )!;
  assert.ok(scope.rules.includes('流言四起'));
  assert.deepEqual(scope.characters, []);
  assert.deepEqual(profiles.map(domains), before);
  assert.ok(profiles.every((p) => p.active));
});

test('effect, time and object filters reject paranoia, day-end and character-only causes', () => {
  const { pack, opening, profiles } = fixture();
  pack.identities['传谣人']!.abilities = [
    {
      id: 'wrong-time',
      source: '',
      timing: 'day-end',
      steps: [{ effects: [{ op: 'counter', counter: 'intrigue', target: 'school', amount: 1 }] }],
    },
    {
      id: 'wrong-object',
      source: '',
      timing: 'mastermind-abilities',
      steps: [
        {
          choices: [{ key: 'target', options: { kind: 'alive' } }],
          effects: [{ op: 'counter', counter: 'intrigue', target: '$target', amount: 1 }],
        },
      ],
    },
  ];
  const scope = new CausalScope(pack, opening).consume(increase(), profiles)!;
  assert.deepEqual(scope.characters, ['a']);
  assert.deepEqual([...profiles[0]!.store.values('identity:a')], ['主谋']);
});

test('nested composite and simultaneous changes do not infer an exact +1 source from a net delta', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['开膛者的魔影']!.abilities.push({
    id: 'composite',
    source: '',
    timing: 'mastermind-abilities',
    steps: [
      {
        effects: [
          {
            op: 'when',
            condition: true,
            effects: [
              {
                op: 'each',
                selector: { kind: 'boards' },
                effects: [
                  { op: 'counter', counter: 'intrigue', target: '$it', amount: 2 },
                  { op: 'counter', counter: 'intrigue', target: '$it', amount: -1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const before = profiles.map(domains);
  const scope = new CausalScope(pack, opening).consume(increase(), profiles)!;
  assert.ok(scope.rules.includes('开膛者的魔影'));
  assert.deepEqual(profiles.map(domains), before);
});

test('delayed rule and real-event effects keep their own timing without applying current actor area', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['开膛者的魔影']!.abilities.push({
    id: 'delayed',
    source: '',
    timing: 'day-end',
    steps: [
      {
        effects: [
          {
            op: 'schedule',
            day: 2,
            timing: 'mastermind-abilities',
            effects: [{ op: 'counter', counter: 'intrigue', target: '$self.area', amount: 1 }],
          },
        ],
      },
    ],
  });
  const scope = new CausalScope(pack, opening).consume(
    { ...observation('board', { board: 'city', intrigue: 1 }), day: 2 },
    profiles,
  )!;
  assert.ok(scope.rules.includes('开膛者的魔影'));
  assert.ok(profiles.every((p) => p.active));
  // Use a separate pack: a configured event can schedule effects in a later ability stage.
  const second = fixture();
  second.pack.incidents['谋杀']!.steps = [
    {
      effects: [
        {
          op: 'schedule',
          day: 2,
          timing: 'mastermind-abilities',
          effects: [{ op: 'counter', counter: 'intrigue', target: '$self.area', amount: 1 }],
        },
      ],
    },
  ];
  for (const p of second.profiles) p.store.domains.set('event:1', new Set(['谋杀']));
  const eventScope = new CausalScope(second.pack, second.opening).consume(
    { ...observation('board', { board: 'city', intrigue: 1 }), day: 2 },
    second.profiles,
  )!;
  assert.deepEqual(eventScope.events, ['1:谋杀']);
  assert.ok(second.profiles.every((p) => p.active));
  assert.deepEqual(second.profiles[0]!.store.constraints.at(-1)?.reads, ['event:1']);
});

test('territory, streamer and unknown invoked effects retain remote explanations', () => {
  for (const character of ['大人物', 'UP主', '临时工']) {
    const { pack, opening, profiles } = fixture();
    (opening.roster ?? opening.characters).find((c) => c.id === 'b')!.character = character;
    opening.characters.find((c) => c.id === 'b')!.character = character;
    const scope = new CausalScope(pack, opening).consume(increase(), profiles)!;
    assert.ok(scope.characters.includes('b'), character);
    assert.ok(profiles.every((p) => p.active));
  }
  const { pack, opening, profiles } = fixture();
  pack.characters['住院患者']!.abilities.push({
    id: 'indirect',
    source: '',
    timing: 'mastermind-abilities',
    steps: [{ effects: [{ op: 'invoke-incident', name: '邪气污染', culprit: '$self' }] }],
  });
  const before = profiles.map(domains);
  new CausalScope(pack, opening).consume(
    observation('board', { board: 'city', intrigue: 1 }),
    profiles,
  );
  assert.deepEqual(profiles.map(domains), before);
});

test('incremental public movement changes the next observation area, and repeated appends do no work', () => {
  const { pack, opening, profiles } = fixture();
  const causal = new CausalScope(pack, opening);
  causal.consume(
    observation('character', {
      character: 'b',
      area: 'school',
      status: 'alive',
      counters: opening.characters.find((c) => c.id === 'b')!.counters,
    }),
    profiles,
  );
  assert.deepEqual(new Set(causal.consume(increase(), profiles)!.characters), new Set(['a', 'b']));
  const k = new LiveKnowledge(pack, opening);
  k.append(opening.observations, 0, opening.revision);
  k.append([increase()], opening.observations.length, opening.revision + 1);
  const snapshot = k.snapshot();
  for (let i = 0; i < 20; i++) {
    k.append([increase()], opening.observations.length, opening.revision + 1);
    k.tick(1);
  }
  assert.deepEqual(k.snapshot().propagation, snapshot.propagation);
  assert.equal(k.snapshot().generated, 0);
  assert.equal(k.snapshot().scope?.deferred, true);
  assert.equal(k.snapshot().status, 'incomplete');
  assert.equal(k.snapshot().propagation?.branches, 0);
});

function eventFixture(
  character: string,
  occurred: boolean,
  counters?: Partial<PlayerView['characters'][number]['counters']>,
) {
  const { pack, opening, profiles } = fixture();
  const c = opening.characters.find((c) => c.id === 'b')!;
  c.character = character;
  (opening.roster ?? opening.characters).find((c) => c.id === 'b')!.character = character;
  Object.assign(c.counters, counters);
  for (const p of profiles) {
    p.store.domains.set('event:1', new Set(['谋杀']));
    p.store.domains.set('culprit:1', new Set(['a', 'b', 'c']));
  }
  const scope = new CausalScope(pack, opening).consume(
    observation('incident', { day: 1, occurred, name: '谋杀' }, 'incident'),
    profiles,
  )!;
  return { scope, profiles, pack };
}
test('incident constraints read only real event and culprit; black cat occurrence differs from no effect', () => {
  const { profiles, scope } = eventFixture('黑猫', true);
  assert.deepEqual([...profiles[0]!.store.values('culprit:1')], ['b']);
  assert.deepEqual(profiles[0]!.store.constraints.at(-1)?.reads, ['event:1', 'culprit:1']);
  assert.equal(scope.kind, 'incident-occurrence');
  const { pack, opening, profiles: p } = fixture();
  const before = p.map(domains);
  assert.equal(
    new CausalScope(pack, opening).consume(observation('no-effect', { day: 1 }, 'incident'), p),
    undefined,
  );
  assert.deepEqual(p.map(domains), before);
});
test('AI total counters, henchman suppression, and temporary replacement are conservative', () => {
  assert.ok(
    eventFixture('AI', true, { intrigue: 6 }).profiles[0]!.store.values('culprit:1').has('b'),
  );
  assert.ok(
    eventFixture('手下', false, { paranoia: 6 }).profiles[0]!.store.values('culprit:1').has('b'),
  );
  assert.ok(eventFixture('临时工', true).profiles[0]!.store.values('culprit:1').has('b'));
});
test('cult leader doubles event threshold offsets; true-event candidates stay conditional on culprit', () => {
  const { pack, opening, profiles } = fixture();
  const c = opening.characters.find((c) => c.id === 'b')!;
  c.character = '教主';
  c.counters.paranoia = pack.characters['教主']!.paranoia + 1;
  (opening.roster ?? opening.characters).find((c) => c.id === 'b')!.character = '教主';
  pack.incidents['谋杀']!.thresholdOffset = 1;
  pack.incidents['伪造事件'] = {
    ...pack.incidents['谋杀']!,
    name: '伪造事件',
    thresholdOffset: 0,
    steps: [],
  };
  for (const p of profiles) {
    p.store.domains.set('event:1', new Set(['谋杀', '伪造事件']));
    p.store.domains.set('culprit:1', new Set(['b']));
  }
  new CausalScope(pack, opening).consume(
    observation('incident', { day: 1, occurred: true }, 'incident'),
    profiles,
  );
  assert.ok(profiles.every((p) => p.active));
  assert.deepEqual([...profiles[0]!.store.values('event:1')], ['伪造事件']);
});
test('multiple simultaneous local clauses retain alternatives and propagate only when one loses support', () => {
  const { pack, opening, profiles } = fixture();
  opening.characters.find((c) => c.id === 'b')!.area = 'school';
  const causal = new CausalScope(pack, opening);
  const before = profiles.map(domains);
  causal.consume(increase(), profiles);
  for (const expected of before)
    expected['identity:c'] = expected['identity:c']!.filter((v) => v !== '主谋');
  assert.deepEqual(
    profiles.map(domains),
    before,
    'the only slot belongs to one of the two local sources',
  );
  const [relation] = causal.candidateClauses(profiles);
  assert.deepEqual(relation?.alternatives, [
    [{key:'identity:a',value:'主谋'}], [{key:'identity:b',value:'主谋'}],
  ]);
  const p = profiles[0]!;
  p.store.narrow(
    'identity:a',
    [...p.store.values('identity:a')].filter((i) => i !== '主谋'),
  );
  assert.equal(p.store.propagate(), true);
  assert.deepEqual([...p.store.values('identity:b')], ['主谋']);
});
test('new source constraints cannot mutate suspended search dependency indices', () => {
  const store = new ConstraintStore(
    new Map([
      ['a', new Set(['0', '1'])],
      ['b', new Set(['0', '1'])],
    ]),
  );
  store.add(relation('old', 'a', 'b', (a, b) => a === b));
  store.propagate();
  const oldBranch = store.clone();
  store.add(relation('new', 'a', 'b', (a, b) => a !== b));
  oldBranch.narrow('a', ['0']);
  assert.equal(oldBranch.propagate(), true);
});

test('real legal mastermind ability retains true configuration with zero global work in the local batch', () => {
  const pack = compileOfficial('FS');
  let state = initializeDiscussion(pack, setup).state!;
  const opening = initialPlacementView(state);
  const k = new LiveKnowledge(pack, opening);
  let through = 0,
    used = false,
    observed = false;
  for (let step = 0; step < 30 && !observed; step++) {
    const view = project(state, 'protagonists');
    const fresh = view.observations.slice(through);
    k.append(fresh, through, view.revision);
    through = view.observations.length;
    if (fresh.some((o) => o.type === 'board' && o.phase === 'mastermind-abilities')) {
      observed = true;
      assert.equal(
        k.snapshot().scope?.deferred,
        true,
        'the compound card batch leaves whole-script replay deferred',
      );
      assert.equal(k.snapshot().generated, 0);
      assert.equal(k.snapshot().propagation?.branches, 0);
      assert.equal(k.queryConfiguration(setup), 'possible');
      k.verifyAll();
      assert.equal(k.snapshot().scope?.deferred, false);
      break;
    }
    const pending = state.pending!;
    let choice: Choice;
    if (pending.kind === 'cards') {
      const hand = state.cards.filter(
        (c) =>
          c.owner === pending.actor &&
          c.status === 'hand' &&
          !['horizontal', 'vertical', 'diagonal'].includes(c.kind),
      );
      choice = {
        kind: 'cards',
        placements: hand.slice(0, pending.actor === 'mastermind' ? 3 : 1).map((c, i) => ({
          card: c.id,
          target: ['a', 'b', 'c'][
            pending.actor === 'mastermind' ? i : Number(pending.actor.slice(1))
          ]!,
        })),
      };
    } else if (
      !used &&
      pending.options.some((c) => c.kind === 'ability' && c.ability === 'brain')
    ) {
      choice = pending.options.find((c) => c.kind === 'ability' && c.ability === 'brain')!;
      used = true;
    } else if (
      pending.kind === 'choice' &&
      pending.options.some((c) => c.kind === 'select' && c.value === 'school')
    )
      choice = { kind: 'select', value: 'school' };
    else
      choice =
        pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
        pending.options[0]!;
    const next = advance(pack, state, pending.actor, {
      id: `scope-${step}`,
      expectedRevision: state.revision,
      decisionId: pending.id,
      choice,
    });
    assert.notEqual(next.status, 'rejected', JSON.stringify({ pending, choice }));
    state = next.state;
  }
  assert.ok(observed);
});

test('one activation transfers two reports, cannot repeat on another day in the loop, and resets in a new loop', () => {
  const { pack, opening, profiles } = fixture();
  const char = pack.characters['男学生']!;
  char.abilities = [
    {
      id: 'transfer-once',
      source: 'fixture',
      timing: 'mastermind-abilities',
      loopLimit: 1,
      steps: [{ effects: [{ op: 'transfer', from: 'a', to: 'b', counter: 'guard' }] }],
    },
  ];
  opening.characters.find((c) => c.id === 'a')!.counters.guard = 3;
  const scope = new CausalScope(pack, opening);
  let seq = 0;
  function receive(
    loop: number,
    day: number,
    type: Observation['type'],
    data: Observation['data'],
  ) {
    return scope.consume(
      { sequence: ++seq, loop, day, phase: 'mastermind-abilities', type, data },
      profiles,
    );
  }
  const report = (id: string, guard: number) => {
    const c = opening.characters.find((c) => c.id === id)!;
    return { character: id, area: c.area, status: c.status, counters: { ...c.counters, guard } };
  };
  receive(1, 1, 'boundary', {});
  receive(1, 1, 'character', report('a', 2));
  receive(1, 1, 'character', report('b', 1));
  assert.ok(profiles.every((p) => p.active));
  receive(2, 1, 'boundary', {});
  receive(2, 1, 'character', report('a', 1));
  receive(2, 1, 'character', report('b', 2));
  assert.ok(profiles.every((p) => p.active));
  receive(2, 2, 'boundary', {});
  receive(2, 2, 'character', report('a', 0));
  assert.ok(profiles.every((p) => !p.active));
});
test('mandatory day-end absence uses the entry snapshot and retains immunity as a conditional explanation', () => {
  const { pack, opening, profiles } = fixture();
  opening.characters.find((c) => c.id === 'b')!.area = 'school';
  const scope = new CausalScope(pack, opening);
  scope.consume(
    { sequence: 1, loop: 1, day: 1, phase: 'day-end', type: 'boundary', data: {} },
    profiles,
  );
  const close = scope.consume(
    { sequence: 2, loop: 1, day: 2, phase: 'day-start', type: 'boundary', data: {} },
    profiles,
  );
  assert.equal(close?.kind, 'mandatory-absence');
  for (const p of profiles) {
    assert.ok(p.active);
    assert.ok(!p.store.values('identity:b').has('杀人狂'));
    assert.ok(!p.store.values('identity:a').has('杀人狂'));
  }
});
test('publicly declared simple ability explains its own target without choosing between other nearby abilities', () => {
  const { pack, opening, profiles } = fixture();
  for (const id of ['a', 'b']) {
    const c = opening.characters.find((c) => c.id === id)!;
    c.area = 'school';
    c.counters.goodwill = 5;
    pack.characters[c.character]!.abilities = [
      {
        id: 'raise',
        source: 'fixture',
        timing: 'protagonist-abilities',
        threshold: 1,
        steps: [
          {
            choices: [{ key: 'target', options: { kind: 'alive' } }],
            effects: [{ op: 'counter', target: '$target', counter: 'hope', amount: 1 }],
          },
        ],
      },
    ];
  }
  const scope = new CausalScope(pack, opening);
  const actor = opening.characters[0]!;
  const phase = 'protagonist-abilities',
    receive = (sequence: number, type: Observation['type'], data: Observation['data']) =>
      scope.consume({ sequence, loop: 1, day: 1, phase, type, data }, profiles);
  receive(1, 'boundary', {});
  receive(2, 'declaration', { character: 'a', ability: 'raise', choices: { target: actor.id } });
  const changed = receive(3, 'character', {
    character: actor.id,
    status: actor.status,
    area: actor.area,
    counters: { ...actor.counters, hope: 1 },
  });
  assert.deepEqual(changed?.alternatives, ['男学生（a）的raise']);
});
test('multi-step independent goodwill uses only the named activation; refusal closes it and a retry can resolve', () => {
  const { pack, opening, profiles } = fixture();
  for (const c of opening.characters.slice(0, 2)) {
    c.counters.goodwill = 3;
    pack.characters[c.character]!.abilities = ['cast', 'other'].map((id) => ({
      id,
      source: 'test',
      timing: 'protagonist-abilities',
      threshold: 3,
      loopLimit: 1,
      steps: [
        {
          choices: [{ key: 'target', options: { kind: 'alive' } }],
          effects: [{ op: 'counter', target: '$target', counter: 'hope', amount: 1 }],
        },
        { effects: [{ op: 'counter', target: '$self', counter: 'despair', amount: 1 }] },
      ],
    }));
  }
  const scope = new CausalScope(pack, opening);
  let n = 0;
  const receive = (type: Observation['type'], data: Observation['data']) =>
    scope.consume(observation(type, data, 'protagonist-abilities', ++n), profiles);
  const cast = () => {
    receive('own-choice', {
      actor: 'p0',
      choice: { kind: 'ability', owner: 'a', ability: 'cast' },
    });
    receive('declaration', { character: 'a', ability: 'cast', choices: { target: 'b' } });
  };
  const [a, b] = opening.characters;
  receive('boundary', {});
  cast();
  receive('refused', { character: 'a', ability: 'cast' });
  cast();
  const first = receive('character', {
    character: 'b',
    status: 'alive',
    area: b!.area,
    counters: { ...b!.counters, hope: 1 },
  });
  assert.deepEqual(first?.alternatives, ['男学生（a）的cast']);
  const second = receive('character', {
    character: 'a',
    status: 'alive',
    area: a!.area,
    counters: { ...a!.counters, despair: 1 },
  });
  assert.deepEqual(second?.alternatives, ['男学生（a）的cast']);
  assert.ok(second?.skippedCharacters.includes('b'));
});

test('declared alien kill skips the cause search; actual death, failure, and missing reports remain evidence', () => {
  for (const outcome of ['failure', 'normal-close', 'no-death'] as const) {
    const { pack, opening } = fixture('BTX');
    const caster = opening.characters[0]!,
      victim = opening.characters[1]!;
    caster.character = '异界人';
    victim.character = '女学生';
    for (const c of [caster, victim])
      if (opening.roster) opening.roster.find((r) => r.id === c.id)!.character = c.character;
    caster.area = victim.area = 'shrine';
    caster.counters.goodwill = 4;
    const k = new LiveKnowledge(pack, opening);
    const phase = 'protagonist-abilities';
    let n = 0;
    const send = (
      type: Observation['type'],
      data: Observation['data'],
      timing: Observation['phase'] = phase,
    ) => {
      k.append([observation(type, data, timing, n + 1)], n, n + 1);
      n++;
      return k.snapshot();
    };
    send('boundary', {});
    send('own-choice', {
      actor: 'p0',
      choice: { kind: 'ability', owner: caster.id, ability: 'alien-kill' },
    });
    assert.deepEqual(
      send('own-choice', { actor: 'p0', choice: { kind: 'select', value: victim.id } }).transition
        ?.historyCandidates,
      [],
    );
    const declaration = send('declaration', {
      character: caster.id,
      ability: 'alien-kill',
      choices: { target: victim.id },
    });
    assert.ok(declaration.identities[victim.id]?.includes('时间旅者'));
    if (outcome === 'no-death') {
      assert.equal(send('boundary', {}, 'incident').scope?.needsHistory, true);
      continue;
    }
    const death = send('character', {
      character: victim.id,
      area: victim.area,
      status: 'dead',
      counters: victim.counters,
    });
    assert.equal(death.scope?.locallyExplained, true);
    assert.notEqual(death.scope?.publicSettlement, true);
    assert.deepEqual(death.transition?.historyCandidates, []);
    assert.equal(death.generated, 0);
    assert.equal(
      death.relations?.some((r) => r.observation === n),
      false,
    );
    assert.ok(!death.identities[victim.id]?.includes('时间旅者'));
    assert.ok(death.identities[victim.id]?.includes('关键人物'));
    if (outcome === 'failure') {
      const failure = send('failure', { result: 'protagonist-failure' });
      assert.ok(failure.scope?.alternatives?.some((reason) => reason.includes('关键人物')));
      assert.ok(!failure.scope?.alternatives?.some((reason) => reason.includes('alien-kill')));
    } else {
      assert.ok(!send('boundary', {}, 'incident').identities[victim.id]?.includes('关键人物'));
    }
  }
});

test('a declared counter swap consumes one whole public report and preserves the use limit', () => {
  const { pack, opening, profiles } = fixture();
  const [caster, victim] = opening.characters;
  assert.ok(caster && victim);
  caster.character = '转校生';
  if (opening.roster) opening.roster.find((c) => c.id === caster.id)!.character = caster.character;
  caster.area = victim.area = 'school';
  caster.counters.goodwill = 5;
  victim.counters.intrigue = 2;
  const scope = new CausalScope(pack, opening);
  let n = 0;
  const send = (type: Observation['type'], data: Observation['data']) =>
    scope.consume(observation(type, data, 'protagonist-abilities', ++n), profiles);
  const request = {
    actor: 'p0',
    choice: { kind: 'ability', owner: caster.id, ability: 'transfer-student' },
  };
  send('boundary', {});
  send('own-choice', request);
  send('declaration', {
    character: caster.id,
    ability: 'transfer-student',
    choices: { target: victim.id },
  });
  const changed = send('character', {
    character: victim.id,
    area: 'school',
    status: 'alive',
    counters: { ...victim.counters, intrigue: 1, goodwill: 1 },
  });
  assert.equal(changed?.locallyExplained, true);
  assert.deepEqual(changed?.characters, []);
  assert.equal(changed?.publicSettlement, true);
  assert.equal(scope.causeBranches, 0);
  send('own-choice', request);
  assert.ok(profiles.every((p) => !p.active));
});

for (const laterChoice of [false,true])
test('public goodwill with a silent flag performs no propagation; later choice '+laterChoice, () => {
  const {pack,opening}=fixture();
  const [a,b]=opening.characters;
  assert.ok(a && b);
  a.counters.goodwill=3;
  pack.characters[a.character]!.abilities=[{
    id:'public-two-steps',source:'fixture',timing:'protagonist-abilities',threshold:2,cannotRefuse:true,
    steps:[
      {choices:[{key:'target',options:{kind:'alive'}}],effects:[
        {op:'flag',target:'$target',key:'free-movement'},
        {op:'counter',target:'$target',counter:'goodwill',amount:1},
      ]},
      {...(laterChoice?{choices:[{key:'target',options:{kind:'alive' as const}}]}:{}),
        effects:[{op:'counter',target:laterChoice?'$target':'$self',counter:'paranoia',amount:1}]},
    ],
  }];
  const k=new LiveKnowledge(pack,opening);
  const before=k.snapshot();
  let n=0;
  const send=(type:Observation['type'],data:Observation['data'])=>{
    k.append([observation(type,data,'protagonist-abilities',n+1)],n,n+1); n++;
    const now=k.snapshot();
    assert.deepEqual(now.transition?.historyCandidates,[]);
    assert.equal(now.propagation?.checks,before.propagation?.checks);
    assert.equal(now.propagation?.branches,before.propagation?.branches);
    assert.equal(now.propagation?.causeBranches,before.propagation?.causeBranches);
    assert.equal(now.propagation?.constraintVersion,before.propagation?.constraintVersion);
    assert.deepEqual(now.identities,before.identities);
    return now;
  };
  send('boundary',{});
  send('own-choice',{actor:'p0',choice:{kind:'ability',owner:a.id,ability:'public-two-steps'}});
  send('declaration',{character:a.id,ability:'public-two-steps',choices:{target:b.id}});
  assert.equal(send('character',{character:b.id,status:b.status,area:b.area,
    counters:{...b.counters,goodwill:1}}).scope?.publicSettlement,true);
  if (laterChoice) send('own-choice',{actor:'p0',choice:{kind:'select',value:a.id}});
  assert.equal(send('character',{character:a.id,status:a.status,area:a.area,
    counters:{...a.counters,paranoia:1}}).scope?.publicSettlement,true);
  // Once the declared outputs are consumed, a duplicate cannot use that explanation again.
  k.append([observation('character',{character:a.id,status:a.status,area:a.area,
    counters:{...a.counters,paranoia:2}},'protagonist-abilities',n+1)],n,n+1);
  assert.ok(k.snapshot().transition?.historyCandidates?.length);
});

for (const visibleFirst of [false, true])
test('silent goodwill tail closes without search and records its use; visible first '+visibleFirst, () => {
  const { pack, opening } = fixture();
  const a = opening.characters[0]!;
  a.counters.goodwill = 3;
  pack.characters[a.character]!.abilities = [{
    id: 'silent-tail', source: 'fixture', timing: 'protagonist-abilities',
    threshold: 2, cannotRefuse: true, loopLimit: 1,
    steps: [
      { effects: visibleFirst
        ? [{ op: 'counter', target: '$self', counter: 'hope', amount: 1 }]
        : [{ op: 'protect-protagonists' }] },
      { effects: [{ op: 'flag', target: '$self', key: 'free-movement' }] },
    ],
  }];
  const k = new LiveKnowledge(pack, opening);
  const before = k.snapshot();
  const request = { actor: 'p0', choice: { kind: 'ability', owner: a.id, ability: 'silent-tail' } };
  let n = 0;
  const send = (type: Observation['type'], data: Observation['data'], phase: Observation['phase'] = 'protagonist-abilities') => {
    k.append([observation(type, data, phase, n + 1)], n, n + 1);
    n++;
    return k.snapshot();
  };
  send('boundary', {});
  send('own-choice', request);
  send('declaration', { character: a.id, ability: 'silent-tail', choices: {} });
  if (visibleFirst) send('character', { character: a.id, status: a.status, area: a.area,
    counters: { ...a.counters, hope: 1 } });
  const result = send('boundary', {}, 'incident');
  assert.deepEqual(result.transition?.historyCandidates, []);
  assert.deepEqual(result.identities, before.identities);
  for (const field of ['checks', 'branches', 'causeBranches', 'constraintVersion'] as const)
    assert.equal(result.propagation?.[field], before.propagation?.[field]);
  const repeated = send('own-choice', request);
  assert.ok(repeated.relations?.some(r => r.fact.includes('达到使用上限')));
  assert.ok(Object.values(repeated.identities).every(domain => domain.length === 0));
});

test('a goodwill request with a private activation condition still requests history', () => {
  const {pack,opening}=fixture();
  const a=opening.characters[0]!;
  a.counters.goodwill=3;
  pack.characters[a.character]!.abilities=[{
    id:'private-request',source:'fixture',timing:'protagonist-abilities',threshold:2,
    condition:{flag:'hidden-condition',target:'$self'},
    steps:[{effects:[{op:'protect-protagonists'}]}],
  }];
  const k=new LiveKnowledge(pack,opening);
  k.append([observation('own-choice',{actor:'p0',
    choice:{kind:'ability',owner:a.id,ability:'private-request'}},'protagonist-abilities',1)],0,1);
  assert.deepEqual(k.snapshot().transition?.historyCandidates,[1]);
});

test('public group goodwill updates every target without building hidden causes', () => {
  const {pack,opening}=fixture();
  const a=opening.characters[0]!;
  a.counters.goodwill=3;
  pack.characters[a.character]!.abilities=[{
    id:'group-public',source:'fixture',timing:'protagonist-abilities',threshold:2,cannotRefuse:true,
    steps:[{effects:[{op:'each',selector:{kind:'alive'},
      effects:[{op:'counter',target:'$it',counter:'hope',amount:1}]}]}],
  }];
  const k=new LiveKnowledge(pack,opening);
  const before=k.snapshot().propagation!;
  const reports=[
    observation('boundary',{},'protagonist-abilities',1),
    observation('own-choice',{actor:'p0',choice:{kind:'ability',owner:a.id,ability:'group-public'}},'protagonist-abilities',2),
    observation('declaration',{character:a.id,ability:'group-public',choices:{}},'protagonist-abilities',3),
    ...opening.characters.map((c,i)=>({...observation('character',{
      character:c.id,status:c.status,area:c.area,counters:{...c.counters,hope:1}},
      'protagonist-abilities',4+i),simultaneousGroup:4,simultaneousSize:opening.characters.length})),
  ];
  k.append(reports,0,reports.length);
  const result=k.snapshot();
  assert.deepEqual(result.transition?.historyCandidates,[]);
  assert.equal(result.propagation?.checks,before.checks);
  assert.equal(result.propagation?.causeBranches,before.causeBranches);
  assert.equal(result.propagation?.constraintVersion,before.constraintVersion);
});

test('a public refusal is incompatible with an explicitly unrefusable goodwill ability', () => {
  const { pack, opening, profiles } = fixture();
  const actor = opening.characters[0]!;
  const ability = pack.characters[actor.character]!.abilities.find(
    (a) => a.threshold !== undefined,
  )!;
  ability.cannotRefuse = true;
  const ordinary = { ...ability, id: 'ordinary', cannotRefuse: false };
  pack.characters[actor.character]!.abilities.push(ordinary);
  actor.counters.despair = 1;
  const solver = new CausalScope(pack, opening);
  solver.consume(
    observation('refused', { character: actor.id, ability: ability.id }, 'protagonist-abilities'),
    profiles,
  );
  assert.ok(profiles.length > 0 && profiles.every((p) => !p.active));
  solver.consume(
    observation('refused', { character: actor.id, ability: ordinary.id }, 'protagonist-abilities', 2),
    profiles,
  );
  assert.ok(profiles.every((p) => !p.active));
});

test('wide hidden disjunctions retain their tenth and later possible source', () => {
  const { pack, opening, profiles } = fixture();
  const c = opening.characters[0]!;
  pack.characters[c.character]!.abilities = Array.from({ length: 12 }, (_, i) => ({
    id: 'alternative-' + i,
    source: 'fixture',
    timing: 'mastermind-abilities',
    steps: [{ effects: [{ op: 'counter', target: '$self', counter: 'hope', amount: 1 }] }],
  }));
  const scope = new CausalScope(pack, opening);
  scope.consume(
    { sequence: 1, loop: 1, day: 1, phase: 'mastermind-abilities', type: 'boundary', data: {} },
    profiles,
  );
  const changed = scope.consume(
    {
      sequence: 2,
      loop: 1,
      day: 1,
      phase: 'mastermind-abilities',
      type: 'character',
      data: {
        character: c.id,
        area: c.area,
        status: c.status,
        counters: { ...c.counters, hope: 1 },
      },
    },
    profiles,
  );
  assert.equal(changed?.alternatives?.length, 12);
  assert.equal(scope.causeBranches, 0);
});

test('a revealed blocked goodwill gain requires a time traveller, with both cards included only once', () => {
  const pack = compileOfficial('BTX'),
    config: GameSetup = {
      ...setup,
      module: 'BTX',
      y: '改变未来',
      x: ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '男学生', identity: '传谣人' },
        { id: 'b', character: '住院患者', identity: '时间旅者' },
        { id: 'c', character: '医生', identity: '邪教徒' },
      ],
    };
  const opening = initialPlacementView(initializeDiscussion(pack, config).state!),
    k = new LiveKnowledge(pack, opening);
  const actor = opening.characters.find((c) => c.id === 'b')!;
  const reports: Observation[] = [
    {
      sequence: 1,
      phase: 'card-resolution',
      loop: 1,
      day: 1,
      type: 'cards',
      data: {
        placements: [
          { owner: 'mastermind', target: 'b', kind: 'block-goodwill' },
          { owner: 'p0', target: 'b', kind: 'goodwill+2' },
          { owner: 'p1', target: 'a', kind: 'block-movement' },
          { owner: 'p2', target: 'c', kind: 'block-movement' },
        ],
      },
    },
    {
      sequence: 2,
      phase: 'card-resolution',
      loop: 1,
      day: 1,
      type: 'character',
      data: {
        character: 'b',
        area: actor.area,
        status: 'alive',
        counters: { ...actor.counters, goodwill: 2 },
      },
    },
  ];
  k.append(reports, 0, 1);
  assert.deepEqual(k.snapshot().identities.b, ['时间旅者']);
  assert.equal(k.snapshot().scope?.alternatives?.length, 1);
  assert.ok(k.historySearchDeferred);
  const stats = k.snapshot().propagation;
  k.append(reports, 0, 1);
  assert.deepEqual(k.snapshot().propagation, stats);
});
test('ordinary single counter amounts distinguish +1 and +2, a capped board still permits both', () => {
  const { pack, opening, profiles } = fixture();
  for (const n of [1, 2])
    pack.characters['男学生']!.abilities.push({
      id: 'gain' + n,
      source: 'fixture',
      timing: 'mastermind-abilities',
      steps: [{ effects: [{ op: 'counter', target: 'a', counter: 'hope', amount: n }] }],
    });
  const scope = new CausalScope(pack, opening),
    actor = opening.characters.find((c) => c.id === 'a')!;
  scope.consume(
    { sequence: 1, loop: 1, day: 1, phase: 'mastermind-abilities', type: 'boundary', data: {} },
    profiles,
  );
  const changed = scope.consume(
    {
      sequence: 2,
      loop: 1,
      day: 1,
      phase: 'mastermind-abilities',
      type: 'character',
      data: {
        character: 'a',
        area: actor.area,
        status: 'alive',
        counters: { ...actor.counters, hope: 2 },
      },
    },
    profiles,
  );
  assert.deepEqual(changed?.alternatives, ['男学生（a）的gain2']);
  const second = fixture();
  second.opening.boards.school = 2;
  for (const n of [1, 2])
    second.pack.plots['开膛者的魔影']!.abilities.push({
      id: 'board' + n,
      source: 'fixture',
      timing: 'mastermind-abilities',
      steps: [{ effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: n }] }],
    });
  const again = new CausalScope(second.pack, second.opening);
  again.consume({ ...increase(), data: { board: 'school', intrigue: 3 } }, second.profiles);
  assert.ok(second.profiles.every((p) => p.active));
});

test('loop-end friend loss can originate only from a dead friend', () => {
  const { pack, opening, profiles } = fixture();
  const p = profiles[0]!;
  for (const c of opening.characters) p.store.domains.get('identity:' + c.id)?.add('亲友');
  const victim = opening.characters[0]!;
  victim.status = 'dead';
  const scope = new CausalScope(pack, opening),
    phase = 'loop-end';
  scope.consume({ sequence: 1, loop: 1, day: 2, phase, type: 'boundary', data: {} }, profiles);
  const result = scope.consume(
    {
      sequence: 2,
      loop: 1,
      day: 2,
      phase,
      type: 'failure',
      data: { result: 'protagonist-failure' },
    },
    profiles,
  );
  assert.deepEqual(result?.characters, [victim.id]);
  assert.ok(result?.alternatives?.some((s) => s.includes('亲友')));
});

test('fixed hospital victims retain remote culprits, murder and disappearance bind the culprit differently', () => {
  for (const name of ['医院事故', '谋杀', '失踪']) {
    const { pack, opening } = fixture('BTX');
    opening.incidents = [{ day: 1, name }];
    opening.boards.hospital = 1;
    for (const c of opening.characters) {
      c.area = c.id === 'a' ? 'school' : 'hospital';
      c.counters.paranoia = 6;
    }
    const k = new LiveKnowledge(pack, opening);
    const victim = opening.characters.find((c) => c.id === 'b')!;
    const reports = [
      observation('boundary', { phase: 'incident' }, 'incident', 1),
      observation('incident', { day: 1, name, occurred: true }, 'incident', 2),
      observation(
        'character',
        {
          character: victim.id,
          area: name === '失踪' ? 'shrine' : victim.area,
          status: name === '失踪' ? 'alive' : 'dead',
          counters: victim.counters,
        },
        'incident',
        3,
      ),
    ];
    k.append(reports, 0, 1);
    const v = k.snapshot();
    assert.deepEqual(
      v.culprits['1']?.slice().sort(),
      name === '医院事故' ? ['a', 'b', 'c'] : [name === '失踪' ? 'b' : 'c'],
      name,
    );
    assert.equal(v.scope?.alternatives?.length, 1, name);
    assert.equal(v.scope?.alternatives?.[0]?.includes('当事人'), name !== '医院事故', name);
    assert.ok(k.historySearchDeferred);
  }
});

test('ordinary card reports only advance the board; a closed blocked goodwill window can exclude a time traveller', () => {
  for (const blocked of [true, false]) {
    const { pack, opening } = fixture('BTX');
    const k = new LiveKnowledge(pack, opening);
    const actor = opening.characters[0]!;
    const cards = [
      {
        owner: 'mastermind',
        target: actor.id,
        kind: blocked ? 'block-goodwill' : 'block-movement',
      },
      { owner: 'p0', target: actor.id, kind: 'goodwill+2' },
      { owner: 'p1', target: actor.id, kind: 'paranoia+1' },
      { owner: 'p2', target: 'school', kind: 'block-movement' },
    ];
    const start = k.snapshot();
    assert.ok(start.identities[actor.id]?.includes('时间旅者'));
    k.append(
      [
        observation('cards', { placements: cards }, 'card-resolution', 1),
        observation(
          'character',
          {
            character: actor.id,
            area: actor.area,
            status: 'alive',
            counters: {
              ...actor.counters,
              paranoia: 1,
              goodwill: blocked ? 0 : 2,
            },
          },
          'card-resolution',
          2,
        ),
      ],
      0,
      1,
    );
    const v = k.snapshot();
    assert.ok(k.historySearchDeferred);
    assert.deepEqual(v.relations, start.relations);
    assert.deepEqual(v.identities, start.identities);
    assert.equal(v.propagation?.constraintVersion, start.propagation?.constraintVersion);
    const boundary = observation(
      'boundary',
      { phase: 'mastermind-abilities' },
      'mastermind-abilities',
      3,
    );
    k.append([boundary], 2, 2);
    const closed = k.snapshot();
    assert.equal(closed.identities[actor.id]?.includes('时间旅者'), !blocked);
    assert.equal(
      closed.relations?.some((r) => r.id === 'blocked-goodwill:3'),
      blocked,
    );
    k.append([boundary], 2, 2);
    assert.deepEqual(k.snapshot().propagation, closed.propagation);
  }
});

test('card settlement only requests modifiers for the affected target and effective card type', () => {
  const { pack, opening } = fixture('BTX');
  const characters = new Map(opening.characters.map((c) => [c.id, c]));
  const cards = new CardReports(characters, opening.boards, pack);
  const queried: string[] = [];
  let plotChecks = 0;
  function flip(entries: string[][]) {
    queried.length = 0;
    plotChecks = 0;
    cards.collect(
      observation(
        'cards',
        {
          placements: entries.map(([target, kind], i) => ({
            target,
            kind,
            owner: ['mastermind', 'p0', 'p1', 'p2'][i % 4],
          })),
        },
        'card-resolution',
      ),
      (key, id) => {
        queried.push(key + ':' + id);
        return false;
      },
      () => {
        plotChecks++;
        return true;
      },
    );
  }
  flip([
    ['a', 'block-goodwill'],
    ['a', 'paranoia+1'],
    ['b', 'goodwill+1'],
    ['c', 'block-intrigue'],
  ]);
  assert.deepEqual(queried, []);
  assert.equal(plotChecks, 0);
  assert.deepEqual(cards.targets.get('a')?.kinds.plus, ['paranoia+1']);
  flip([
    ['a', 'block-goodwill'],
    ['a', 'hope+1'],
    ['b', 'hope+1'],
    ['a', 'horizontal'],
  ]);
  assert.deepEqual(queried, ['goodwill:a']);
  assert.equal(plotChecks, 1);
  assert.equal(cards.targets.get('b')?.plus?.goodwill, 1);
  assert.equal(cards.pendingGoodwill.size, 0);
  flip([
    ['school', 'block-intrigue'],
    ['school', 'intrigue+1'],
    ['b', 'block-intrigue'],
    ['a', 'hope+1'],
  ]);
  assert.deepEqual(queried, []);
  assert.equal(cards.targets.get('school')?.plus?.intrigue, 1);
  assert.equal(cards.targets.get('a')?.plus?.hope, 1);
});

test('a moved illusion reads counter cards from its new board and cannot bypass a board goodwill block', () => {
  const { pack, opening, profiles } = fixture('BTX');
  const actor = opening.characters[0]!;
  actor.character = '幻想';
  actor.area = 'school';
  const scope = new CausalScope(pack, opening);
  const receive = (n: number, type: Observation['type'], data: Observation['data']) =>
    scope.consume(observation(type, data, 'card-resolution', n), profiles);
  const area = cardDestination('school', ['horizontal'], false);
  receive(1, 'cards', {
    placements: [
      { owner: 'mastermind', target: 'school', kind: 'horizontal' },
      { owner: 'p0', target: area, kind: 'paranoia+1' },
      { owner: 'p1', target: area, kind: 'block-goodwill' },
      { owner: 'p2', target: area, kind: 'goodwill+2' },
    ],
  });
  const move = receive(2, 'character', { ...actor, character: actor.id, area });
  assert.equal(move?.locallyExplained, true);
  const gain = receive(3, 'character', {
    ...actor,
    character: actor.id,
    area,
    counters: { ...actor.counters, paranoia: 1 },
  });
  assert.equal(gain?.locallyExplained, true);
  assert.deepEqual(gain?.skippedCharacters.sort(), opening.characters.map((c) => c.id).sort());
  assert.ok(gain?.alternatives?.[0]?.startsWith('paranoia+1 ·'));
  assert.equal(
    scope.consume(observation('boundary', {}, 'mastermind-abilities', 4), profiles)?.needsHistory,
    undefined,
  );
});

test('a missing follow matters only when a living protected character in the same area actually moved', () => {
  for (const didMove of [true, false]) {
    const { pack, opening } = fixture();
    const characters = new Map(opening.characters.map((c) => [c.id, c]));
    const leader = characters.get('a')!,
      guardian = characters.get('b')!;
    guardian.character = '从者';
    leader.character = '大小姐';
    guardian.area = leader.area = 'school';
    const cards = new CardReports(characters, opening.boards, pack);
    cards.collect(
      observation(
        'cards',
        {
          placements: [
            { owner: 'mastermind', target: 'a', kind: 'horizontal' },
            { owner: 'p0', target: 'a', kind: didMove ? 'paranoia+1' : 'block-movement' },
            { owner: 'p1', target: 'hospital', kind: 'block-goodwill' },
            { owner: 'p2', target: 'city', kind: 'block-movement' },
          ],
        },
        'card-resolution',
      ),
      () => false,
      () => false,
    );
    assert.equal(cards.possibleFollowers.has('b'), didMove);
    if (didMove) leader.area = cardDestination(leader.area, ['horizontal'], false);
    const { unresolved } = cards.close(observation('boundary', {}, 'mastermind-abilities'));
    assert.equal(
      unresolved.some((reason) => reason.includes('随行')),
      didMove,
    );
  }
});

test('an unchanged global incident after a public zero-intrigue trigger adds no culprit evidence', () => {
  for (const hospital of [0, 1]) {
    const { pack, opening } = fixture('BTX');
    opening.boards.hospital = hospital;
    opening.incidents = [{ day: 1, name: '医院事故' }];
    for (const c of opening.characters) c.counters.paranoia = 6;
    const k = new LiveKnowledge(pack, opening);
    k.append(
      [
        observation('boundary', { phase: 'incident' }, 'incident', 1),
        observation('incident', { day: 1, name: '医院事故', occurred: true }, 'incident', 2),
      ],
      0,
      1,
    );
    const before = k.snapshot();
    k.append([observation('no-effect', { day: 1 }, 'incident', 3)], 2, 2);
    assert.ok(k.historySearchDeferred);
    assert.deepEqual(k.snapshot().culprits, before.culprits);
    if (hospital === 0)
      assert.equal(
        k.snapshot().propagation?.constraintVersion,
        before.propagation?.constraintVersion,
      );
    else assert.deepEqual(k.snapshot().identities.b, ['时间旅者']);
  }
});

test('an unreconciled public move requests history when card resolution closes; a blocked move does not', () => {
  for (const block of ['block-movement', 'block-paranoia']) {
    const { pack, opening } = fixture('BTX'),
      k = new LiveKnowledge(pack, opening);
    k.append(
      [
        observation(
          'cards',
          {
            placements: [
              { owner: 'mastermind', target: 'a', kind: 'horizontal' },
              { owner: 'p0', target: 'a', kind: block },
              { owner: 'p1', target: 'b', kind: 'block-movement' },
              { owner: 'p2', target: 'c', kind: 'block-movement' },
            ],
          },
          'card-resolution',
          1,
        ),
        observation('boundary', { phase: 'mastermind-abilities' }, 'mastermind-abilities', 2),
      ],
      0,
      1,
    );
    assert.deepEqual(
      k.snapshot().transition?.historyCandidates,
      block === 'block-movement' ? [] : [2],
    );
  }
});

test('a single fixed global counter effect leaves the culprit free until a second settlement is observed', () => {
  const { pack, opening } = fixture('BTX');
  (opening.roster ?? opening.characters).find((c) => c.id === 'b')!.character = '教主';
  opening.characters.find((c) => c.id === 'b')!.character = '教主';
  opening.incidents = [{ day: 1, name: '邪气污染' }];
  for (const c of opening.characters) c.counters.paranoia = 8;
  const k = new LiveKnowledge(pack, opening);
  k.append(
    [
      observation('boundary', { phase: 'incident' }, 'incident', 1),
      observation('incident', { day: 1, name: '邪气污染', occurred: true }, 'incident', 2),
      observation('board', { board: 'shrine', intrigue: 2 }, 'incident', 3),
    ],
    0,
    1,
  );
  assert.deepEqual(k.snapshot().culprits['1']?.slice().sort(), ['a', 'b', 'c']);
  const repeated = observation('board', { board: 'shrine', intrigue: 3 }, 'incident', 4);
  k.append([repeated], 3, 2);
  assert.deepEqual(k.snapshot().culprits['1'], ['b']);
  assert.ok(k.historySearchDeferred);
  assert.ok(k.snapshot().scope?.alternatives?.[0]?.includes('教主'));
  k.append([repeated], 3, 2);
  assert.deepEqual(k.snapshot().culprits['1'], ['b']);
});

test('quiet hospital keeps the black-cat or immortal-patient relation until the culprit is disclosed', () => {
  const { pack, opening } = fixture('BTX');
  opening.incidents = [{ day: 1, name: '医院事故' }];
  opening.boards.hospital = 1;
  for (const c of opening.characters) {
    c.area = c.id === 'b' ? 'hospital' : 'school';
    c.counters.paranoia = 8;
    if (c.id === 'c') c.character = '黑猫';
  }
  (opening.roster ?? opening.characters).find((c) => c.id === 'c')!.character = '黑猫';
  const k = new LiveKnowledge(pack, opening);
  const os = [
    observation('boundary', { phase: 'incident' }, 'incident', 1),
    observation('incident', { day: 1, occurred: true }, 'incident', 2),
    observation('no-effect', { day: 1 }, 'incident', 3),
  ];
  k.append(os, 0, 1);
  const v = k.snapshot();
  assert.ok(v.identities.b!.length > 1 && v.culprits['1']!.includes('c'));
  const relation = v.relations!.find((r) => r.observation === 3)!;
  assert.ok(relation.cases.some((row) => row.alternatives.some((a) => a.includes('黑猫'))));
  assert.ok(relation.cases.some((row) => row.alternatives.some((a) => a.includes('不死'))));
  k.append(os, 0, 1);
  assert.deepEqual(k.snapshot().propagation, v.propagation);
  k.append([observation('culprit', { day: 1, culprit: 'a' }, 'incident', 4)], 3, 2);
  assert.deepEqual(k.snapshot().identities.b, ['时间旅者']);
});

test('a spent guard distinguishes immune identities only when a death request explains the loss', () => {
  for (const other of [false, true]) {
    const { pack, opening } = fixture('BTX');
    opening.incidents = [{ day: 1, name: '医院事故' }];
    opening.boards.hospital = 1;
    if (other)
      pack.characters['住院患者']!.abilities.push({
        id: 'remove-guard',
        source: 'test',
        timing: 'incident',
        mandatory: true,
        steps: [{ effects: [{ op: 'counter', target: '$self', counter: 'guard', amount: -1 }] }],
      });
    const b = opening.characters.find((c) => c.id === 'b')!;
    b.counters.guard = 1;
    for (const c of opening.characters) c.counters.paranoia = 8;
    const k = new LiveKnowledge(pack, opening);
    k.append(
      [
        observation('boundary', { phase: 'incident' }, 'incident', 1),
        observation('incident', { day: 1, occurred: true }, 'incident', 2),
        observation(
          'character',
          { character: 'b', area: b.area, status: 'alive', counters: { ...b.counters, guard: 0 } },
          'incident',
          3,
        ),
      ],
      0,
      1,
    );
    assert.equal(k.snapshot().identities.b!.includes('时间旅者'), other);
    assert.notEqual(k.snapshot().status, 'contradiction');
  }
});

test('real hospital settlements account for the untouched survivor at phase close', () => {
  const { pack, config } = fixture('BTX');
  const setup: GameSetup = {
    ...config,
    y: '改变未来',
    x: ['流言四起', '因果线'],
    characters: [
      { id: 'a', character: '男学生', identity: '传谣人' },
      { id: 'b', character: '住院患者', identity: '时间旅者' },
      { id: 'c', character: '医生', identity: '邪教徒' },
    ],
    incidents: [{ day: 1, name: '医院事故', culprit: 'c' }],
  };
  const state = initializeDiscussion(pack, setup).state!;
  for (const guard of [0, 1]) {
    const s = structuredClone(state);
    s.boards.hospital = 1;
    for (const c of Object.values(s.characters)) {
      c.area = c.id === 'a' ? 'school' : 'hospital';
      c.counters.paranoia = 8;
    }
    s.characters.c!.counters.guard = guard;
    const opening = initialPlacementView(s),
      offset = opening.observations.length;
    s.pending = null;
    s.batch = null;
    s.frames = [];
    s.phase = 'incident';
    s.phaseEntered = false;
    announce(s, 'boundary', { phase: 'incident', captain: s.captain });
    drive(pack, s, 100);
    const records = project(s, 'protagonists').observations.slice(offset);
    const close = records.findIndex((o) => o.phase === 'captain-change');
    assert.ok(close >= 0);
    const k = new LiveKnowledge(pack, opening);
    records.slice(0, close).forEach((o, i) => k.append([{ ...o, sequence: i + 1 }], i, i + 1));
    assert.deepEqual(k.snapshot().identities.b, ['时间旅者'], 'the entire death batch establishes the untouched survivor before phase close');
    assert.deepEqual(new Set(k.snapshot().scope?.compound?.participants), new Set(['b', 'c']));
    k.append([{ ...records[close]!, sequence: close + 1 }], close, close + 1);
    assert.deepEqual(k.snapshot().identities.b, ['时间旅者']);
    assert.ok(!k.snapshot().identities.c!.includes('时间旅者'));
    assert.equal(
      k.historySearchDeferred,
      true,
      'no complete script enumeration is scheduled for hospital settlement',
    );
    assert.equal(k.snapshot().generated, 0);
    assert.equal(s.characters.c!.status, guard ? 'alive' : 'dead');
  }
});

test('event death retains partner identity linkage and checks missing failure only at normal phase close', () => {
  for (const rise of [false, true]) {
    const { pack, opening } = fixture('BTX');
    opening.incidents = [{ day: 1, name: '谋杀' }];
    opening.characters.push({
      ...structuredClone(opening.characters[0]!),
      id: 'd',
      character: '医生',
    });
    opening.roster?.push({ id: 'd', character: '医生' });
    for (const c of opening.characters) {
      c.counters.paranoia = 8;
      c.area = 'school';
    }
    const k = new LiveKnowledge(pack, opening);
    const who = opening.characters.find((c) => c.id === 'a')!,
      other = opening.characters.find((c) => c.id === 'b')!;
    const stream = [
      observation('boundary', { phase: 'incident' }, 'incident', 1),
      observation('incident', { day: 1, occurred: true }, 'incident', 2),
      observation(
        'character',
        { character: who.id, area: who.area, status: 'dead', counters: who.counters },
        'incident',
        3,
      ),
    ];
    k.append(stream, 0, 1);
    assert.ok(k.snapshot().identities.a!.includes('关键人物'));
    if (rise)
      k.append(
        [
          observation(
            'character',
            {
              character: 'b',
              area: other.area,
              status: 'alive',
              counters: { ...other.counters, paranoia: 14 },
            },
            'incident',
            4,
          ),
        ],
        3,
        2,
      );
    let next = rise ? 5 : 4;
    k.append(
      [observation('boundary', { phase: 'captain-change' }, 'captain-change', next)],
      next - 1,
      3,
    );
    assert.ok(!k.snapshot().identities.a!.includes('关键人物'));
    k.append(
      [observation('identity', { character: 'a', identity: '求爱者' }, 'captain-change', ++next)],
      next - 1,
      4,
    );
    assert.equal(k.snapshot().identities.b?.includes('心上人') ?? false, rise);
  }
});

test('quiet disappearance distinguishes capped areas; an unmodelled culprit protects its branch', () => {
  const { pack, opening } = fixture('BTX');
  opening.incidents = [{ day: 1, name: '失踪' }];
  opening.boards.school = 3;
  for (const c of opening.characters) {
    c.area = c.id === 'a' ? 'school' : 'hospital';
    c.counters.paranoia = 8;
  }
  opening.characters.find((c) => c.id === 'c')!.character = '临时工';
  (opening.roster ?? opening.characters).find((c) => c.id === 'c')!.character = '临时工';
  const k = new LiveKnowledge(pack, opening);
  k.append(
    [
      observation('boundary', { phase: 'incident' }, 'incident', 1),
      observation('incident', { day: 1, occurred: true }, 'incident', 2),
      observation('no-effect', { day: 1 }, 'incident', 3),
    ],
    0,
    1,
  );
  assert.deepEqual(new Set(k.snapshot().culprits['1']), new Set(['a', 'c']));
  assert.equal(k.historySearchDeferred, false);
});

test('quiet completion checks only a possible acting culprit for mandatory follow-up abilities', () => {
  for (const culprit of ['a', 'b']) {
    const { pack, opening } = fixture('BTX');
    opening.incidents = [{ day: 1, name: '医院事故' }];
    pack.characters['住院患者']!.abilities.push({
      id: 'later',
      source: 'fixture',
      mandatory: true,
      timing: 'incident-completed',
      steps: [
        {
          effects: [
            {
              op: 'schedule',
              timing: 'day-end',
              day: 1,
              effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: 1 }],
            },
          ],
        },
      ],
    });
    for (const c of opening.characters) c.counters.paranoia = 8;
    const k = new LiveKnowledge(pack, opening);
    k.append(
      [
        observation('culprit', { day: 1, culprit }, 'incident', 1),
        observation('boundary', { phase: 'incident' }, 'incident', 2),
        observation('incident', { day: 1, occurred: true }, 'incident', 3),
        observation('no-effect', { day: 1 }, 'incident', 4),
      ],
      0,
      1,
    );
    k.append([observation('boundary', { phase: 'captain-change' }, 'captain-change', 5)], 4, 2);
    assert.equal(
      k.historySearchDeferred,
      culprit !== 'b',
      'only the possible acting owner of the completion ability needs further history',
    );
    if (culprit === 'b') assert.deepEqual(k.snapshot().scope?.characters, ['b']);
  }
});

test('hospital paranoia gain projects the eligible doctor identities alongside local gossip sources', () => {
  const {pack,opening}=fixture('BTX');
  const doctor=opening.characters.find(c=>c.id==='a')!;
  doctor.character='医生'; doctor.area='hospital'; doctor.counters.goodwill=2;
  if(opening.roster) opening.roster.find(c=>c.id==='a')!.character='医生';
  const patient=opening.characters.find(c=>c.id==='b')!;
  const profiles=buildProfiles(pack,opening,{checks:0,removed:0,branches:0});
  const causal=new CausalScope(pack,opening);
  causal.consume(observation('boundary',{phase:'mastermind-abilities'},'mastermind-abilities',1),profiles);
  causal.consume(observation('character',{character:patient.id,status:'alive',area:patient.area,
    counters:{...patient.counters,paranoia:1}}),profiles);
  const values=causal.candidateClauses(profiles.filter(p=>p.active))[0]?.alternatives.flat() ?? [];
  assert.ok(values?.some(g=>g.key==='identity:a' && g.value==='主谋'), JSON.stringify(values));
  for(const id of ['a','b']) assert.ok(values.some(g=>g.key==='identity:'+id && g.value==='传谣人'));
  assert.ok(!values.some(g=>g.key==='identity:a' && g.value==='平民'));
});
