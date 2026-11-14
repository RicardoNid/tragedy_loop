import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import { initializeDiscussion, advance, drive } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { buildProfiles } from '../../packages/engine/src/runtime/knowledge-domain.js';
import { CausalScope } from '../../packages/engine/src/runtime/knowledge-scope.js';
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
  const opening = project(initialized.state, 'protagonists');
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
    const opening = project(initializeDiscussion(pack, config).state!, 'protagonists');
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
  const opening = project(state, 'protagonists');
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
        false,
        'the earlier compound card batch still needs joint replay',
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
  const opening = project(initializeDiscussion(pack, config).state!, 'protagonists'),
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
    const opening = project(s, 'protagonists'),
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
    records.slice(0, close + 1).forEach((o, i) => k.append([{ ...o, sequence: i + 1 }], i, i + 1));
    assert.deepEqual(k.snapshot().identities.b, ['时间旅者']);
    assert.ok(!k.snapshot().identities.c!.includes('时间旅者'));
    assert.equal(
      k.historySearchDeferred,
      false,
      'the hospital batch schedules joint replay after local victim pruning',
    );
    assert.equal(s.characters.c!.status, guard ? 'alive' : 'dead');
    assert.ok(k.snapshot().relations!.some((r) => r.fact.includes('部分应受死亡请求')));
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
      false,
      'both windows have multiple observations, so their remaining assignments are replayed',
    );
    if (culprit === 'b') assert.deepEqual(k.snapshot().scope?.characters, ['b']);
  }
});
