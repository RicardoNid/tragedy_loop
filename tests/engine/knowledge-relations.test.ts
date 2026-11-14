import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { buildProfiles } from '../../packages/engine/src/runtime/knowledge-domain.js';
import { CausalScope } from '../../packages/engine/src/runtime/knowledge-scope.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import officialBTX from '../../apps/server/src/fixtures/btx-01g.json' with { type: 'json' };
import {
  publicCondition,
  type PublicContext,
} from '../../packages/engine/src/runtime/knowledge-conditions.js';
import type { Observation, GameSetup, Choice } from '../../packages/contracts/src/game.js';
import {
  CauseNetwork,
  counterCauses,
  type Cause,
} from '../../packages/engine/src/runtime/knowledge-causes.js';
import {
  ConstraintStore,
  relation,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';
import type { Ability, Effect } from '../../packages/engine/src/runtime/model.js';

function playBtxFirstDay(useGossip: boolean, intrigueBoard: 'city' | 'shrine') {
  const pack = compileOfficial('BTX');
  let state = initializeDiscussion(pack, officialBTX.setup as GameSetup).state!;
  const solver = new LiveKnowledge(pack, project(state, 'protagonists'));
  const placements: Record<string, [string, string][]> = {
    mastermind: [
      ['horizontal', 'boyStudent'],
      ['block-goodwill', intrigueBoard === 'city' ? 'shrine' : 'city'],
      ['intrigue+2', intrigueBoard],
    ],
    p0: [['goodwill+1', 'popIdol']], p1: [['goodwill+2', 'patient']], p2: [['goodwill+2', 'school']],
  };
  let used = false;
  for (let n = 0; n < 24 && state.loop === 1; n++) {
    const d = state.pending!;
    let choice: Choice = d.options.find(c => c.kind === 'pass') ?? d.options[0]!;
    if (d.kind === 'cards') choice = { kind: 'cards', placements: placements[d.actor]!.map(([kind, target]) => ({
      card: state.cards.find(c => c.owner === d.actor && c.kind === kind)!.id, target,
    })) };
    if (useGossip && !used && d.options.some(c => c.kind === 'ability' && c.ability === 'gossip')) {
      choice = { kind: 'ability', owner: 'doctor', ability: 'gossip', choices: { target: 'doctor' } };
      used = true;
    }
    const next = advance(pack, state, d.actor, { choice, id: 'btx-' + n, expectedRevision: state.revision, decisionId: d.id });
    assert.equal(next.status, 'ok');
    state = next.state;
    const v = project(state, 'protagonists');
    solver.append(v.observations.slice(solver.observationCount), solver.observationCount, v.revision);
    if (choice.kind === 'ability') {
      const result = solver.snapshot();
      assert.equal(result.historySearchDeferred, true);
      assert.equal(result.generated, 0);
      assert.deepEqual(new Set(result.scope?.alternatives), new Set(['医生（doctor）是传谣人（gossip）', '住院患者（patient）是传谣人（gossip）']));
    }
  }
  assert.equal(state.loop, 2);
  assert.equal(used, useGossip);
  return { state, result: solver.snapshot() };
}

test('BTX day one: local gossip disjunction and a lone death before immediate failure', () => {
  const { state, result } = playBtxFirstDay(true, 'shrine');
  assert.deepEqual(result.identities.popIdol, ['关键人物']);
  assert.equal(result.impliedIdentities?.popIdol?.identity, '关键人物');
  assert.equal(state.observations.protagonists[result.impliedIdentities!.popIdol!.observation - 1]!.type, 'failure');
});

test('BTX day one: two city intrigue preserves the unstable-factor death explanation', () => {
  const { result } = playBtxFirstDay(false, 'city');
  assert.deepEqual(new Set(result.identities.popIdol), new Set(['关键人物', '不安定因子']));
  assert.equal(result.impliedIdentities?.popIdol, undefined);
});

function fixture() {
  const pack = structuredClone(compileOfficial('FS'));
  const setup: GameSetup = {
    module: 'FS',
    anniversary: false,
    loops: 2,
    days: 3,
    captain: 'p0',
    discussion: 'allowed',
    y: '复仇的火种',
    x: ['流言四起'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '住院患者', identity: '传谣人' },
      { id: 'c', character: '巫女', identity: '平民' },
    ],
    incidents: [],
  };
  const opening = project(initializeDiscussion(pack, setup).state!, 'protagonists');
  const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 }).filter(
    (p) => p.y === setup.y && p.x.includes('流言四起'),
  );
  return { pack, opening, profiles };
}
const increase = (sequence: number, board: string, day = 1, loop = 1, amount = 1): Observation => ({
  sequence,
  loop,
  day,
  phase: 'mastermind-abilities',
  type: 'board',
  data: { board, intrigue: amount },
});
const add: Effect = { op: 'counter', target: 'city', counter: 'intrigue', amount: 1 };
const ability = (effects: Effect[], extra: Partial<Ability> = {}): Ability => ({
  id: 'test',
  source: '',
  timing: 'mastermind-abilities',
  steps: [{ effects }],
  ...extra,
});

test('recursive cause network preserves ambiguous sources, then proves three-area contradiction with zero full assignments', () => {
  const { pack, opening, profiles } = fixture();
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  assert.ok(profiles.every((p) => p.active));
  c.consume(increase(3, 'hospital'), profiles);
  assert.ok(
    profiles.every((p) => p.active),
    'do not prematurely spend the rumor use on the first observation',
  );
  c.consume(increase(4, 'city'), profiles);
  assert.ok(
    profiles.every((p) => !p.active),
    'only one mastermind and one rumor use cannot explain three regions',
  );
  assert.equal(profiles[0]!.store.stats.branches, 0);
});
test('a forced rumor use propagates back to earlier identity alternatives; per-loop budgets reset', () => {
  const { pack, opening, profiles } = fixture();
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  c.consume(increase(3, 'city', 2), profiles);
  assert.deepEqual([...profiles[0]!.store.values('identity:a')], ['主谋']);
  c.consume({ ...increase(4, 'city', 1, 2, 0), phase: 'loop-start' }, profiles);
  c.consume(increase(5, 'city', 1, 2), profiles);
  assert.ok(profiles[0]!.active);
});
test('daily phase use and loop use are separate; repeating a direct source in the same phase is impossible', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['流言四起']!.abilities = [];
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  c.consume(increase(3, 'school', 2, 1, 2), profiles);
  assert.ok(profiles[0]!.active);
  c.consume(increase(4, 'school', 2, 1, 3), profiles);
  assert.equal(profiles[0]!.active, false);
});
test('one activation affecting multiple boards is not counted as four uses; changed conditions do not use a later snapshot', () => {
  const { pack, opening, profiles } = fixture();
  pack.identities['主谋']!.abilities = [];
  pack.plots['流言四起']!.abilities = [
    ability([{ op: 'each', selector: { kind: 'boards' }, effects: [{ ...add, target: '$it' }] }], {
      loopLimit: 1,
      condition: { cmp: 'eq', left: { counter: 'intrigue', target: 'school' }, right: 0 },
    }),
  ];
  const c = new CausalScope(pack, opening);
  ['school', 'hospital', 'city', 'shrine'].forEach((board, i) =>
    c.consume(increase(i + 2, board), profiles),
  );
  assert.ok(profiles[0]!.active);
  c.consume(increase(6, 'city', 1, 1, 2), profiles);
  assert.equal(profiles[0]!.active, false);
});
test('public activation and step predicates prune only false; unknown NOT/OR branches stay possible', () => {
  for (const condition of [false, { all: [true, false] }, { not: { flag: 'hidden' } }] as const) {
    const { pack, opening, profiles } = fixture();
    pack.plots['流言四起']!.abilities = [
      ability([add], { condition: structuredClone(condition) as Ability['condition'] }),
    ];
    const scope = new CausalScope(pack, opening).consume(increase(2, 'city'), profiles)!;
    assert.equal(
      scope.rules.includes('流言四起'),
      typeof condition === 'object' && 'not' in condition,
    );
  }
  const { pack, opening } = fixture();
  const context: PublicContext = {
    pack,
    clock: { loop: 1, day: 1, phase: 'mastermind-abilities' },
    days: 3,
    loops: 2,
    boards: opening.boards,
    characters: new Map(),
  };
  assert.equal(publicCondition({ any: [false, { flag: 'private' }] }, context), undefined);
  assert.equal(publicCondition({ all: [false, { flag: 'private' }] }, context), false);
  assert.equal(publicCondition({ not: { flag: 'private' } }, context), undefined);
});
test('goodwill threshold uses hope, and virtual areas do not become false physical-location predicates', () => {
  for (const hope of [0, 2]) {
    const { pack, opening, profiles } = fixture();
    pack.plots['流言四起']!.abilities = [];
    opening.characters.find((c) => c.id === 'b')!.counters.hope = hope;
    pack.characters['住院患者']!.abilities = [ability([add], { threshold: 2 })];
    const c = new CausalScope(pack, opening);
    const scope = c.consume(increase(2, 'city'), profiles)!;
    assert.equal(scope.characters.includes('b'), hope === 2);
  }
  const { pack, opening, profiles } = fixture();
  (opening.roster ?? opening.characters).find((c) => c.id === 'b')!.character = '大人物';
  opening.characters.find((c) => c.id === 'b')!.character = '大人物';
  pack.plots['流言四起']!.abilities = [];
  pack.characters['大人物']!.abilities = [
    ability([add], {
      condition: { cmp: 'eq', left: { field: 'area', target: '$self' }, right: 'city' },
    }),
  ];
  assert.ok(
    new CausalScope(pack, opening).consume(increase(2, 'city'), profiles)!.characters.includes('b'),
  );
});
test('fixed, relative and cross-loop delay dates are checked without replaying history', () => {
  for (const [day, loop, dueDay, dueLoop, expected] of [
    [2, undefined, 1, 1, false],
    [2, undefined, 2, 1, true],
    [2, undefined, 3, 1, false],
    [{ op: 'add', args: [{ game: 'day' }, 1] }, undefined, 1, 1, false],
    [{ op: 'add', args: [{ game: 'day' }, 1] }, undefined, 2, 1, true],
    [1, { op: 'add', args: [{ game: 'loop' }, 1] }, 1, 1, false],
    [1, { op: 'add', args: [{ game: 'loop' }, 1] }, 1, 2, true],
  ] as const) {
    const { pack, opening, profiles } = fixture();
    pack.plots['流言四起']!.abilities = [
      ability(
        [{ op: 'schedule', timing: 'mastermind-abilities', day, loop, effects: [add] } as Effect],
        { timing: 'day-end' },
      ),
    ];
    const scope = new CausalScope(pack, opening).consume(
      increase(2, 'city', dueDay, dueLoop),
      profiles,
    )!;
    assert.equal(
      scope.rules.includes('流言四起'),
      expected,
      JSON.stringify({ day, loop, dueDay, dueLoop }),
    );
  }
});

test('a delay scheduled for the current day and phase may settle immediately', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['流言四起']!.abilities = [
    ability([
      {
        op: 'schedule',
        day: { game: 'day' },
        timing: 'mastermind-abilities',
        effects: [add],
      },
    ]),
  ];
  const scope = new CausalScope(pack, opening).consume(increase(2, 'city'), profiles)!;
  assert.ok(scope.rules.includes('流言四起'));
  assert.ok(profiles.every((p) => p.active));
});

test('conditions bind only the observed effect target; other choice objects remain unknown', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['流言四起']!.abilities = [
    ability([{ ...add, target: '$board' }], {
      steps: [
        {
          choices: [
            { key: 'board', options: { kind: 'boards' } },
            { key: 'target', options: { kind: 'alive' } },
          ],
          condition: { cmp: 'eq', left: { field: 'area', target: '$target' }, right: 'school' },
          effects: [{ ...add, target: '$board' }],
        },
      ],
    }),
  ];
  const scope = new CausalScope(pack, opening).consume(increase(2, 'city'), profiles)!;
  assert.ok(
    scope.rules.includes('流言四起'),
    'the separately chosen school character is not the city board',
  );
  assert.ok(profiles.every((p) => p.active));
});
test('event delay uses its incident date; unknown date expressions and indirect special characters remain possible', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['流言四起']!.abilities = [];
  pack.incidents['谋杀']!.steps = [
    {
      effects: [
        {
          op: 'schedule',
          day: { op: 'add', args: [{ game: 'day' }, 1] },
          timing: 'mastermind-abilities',
          effects: [add],
        },
      ],
    },
  ];
  for (const p of profiles) p.store.domains.set('event:2', new Set(['谋杀']));
  const c = new CausalScope(pack, opening);
  assert.deepEqual(c.consume(increase(2, 'city', 2), profiles)!.events, []);
  const second = fixture();
  second.pack.plots['流言四起']!.abilities = [
    ability(
      [
        {
          op: 'schedule',
          day: { ref: '$unknown' },
          timing: 'mastermind-abilities',
          effects: [add],
        },
      ],
      { timing: 'day-start' },
    ),
  ];
  assert.ok(
    new CausalScope(second.pack, second.opening)
      .consume(increase(2, 'city'), second.profiles)!
      .rules.includes('流言四起'),
  );
});
test('conditional relations survive later disclosures and duplicate deliveries; tables are not the complete state', () => {
  const { pack, opening } = fixture();
  const k = new LiveKnowledge(pack, opening);
  k.append(opening.observations, 0, opening.revision);
  const move: Observation = {
    sequence: 2,
    day: 1,
    loop: 1,
    phase: 'card-resolution',
    type: 'character',
    data: {
      character: 'b',
      area: 'school',
      status: 'alive',
      counters: opening.characters.find((c) => c.id === 'b')!.counters,
    },
  };
  k.append([move, increase(3, 'school')], opening.observations.length, 2);
  assert.ok(
    k
      .snapshot()
      .relations?.some((r) =>
        r.implications.some(
          (s) => s.includes('流言四起') && s.includes('男学生') && s.includes('住院患者'),
        ),
      ),
  );
  const before = k.snapshot().relations;
  const reveal: Observation = {
    sequence: 4,
    day: 1,
    loop: 1,
    phase: 'protagonist-abilities',
    type: 'identity',
    data: { character: 'c', identity: '平民' },
  };
  k.append([reveal], opening.observations.length + 2, 3);
  assert.ok(k.snapshot().relations!.some((r) => r.observation === 3));
  const after = k.snapshot();
  k.append([reveal], opening.observations.length + 2, 3);
  assert.deepEqual(k.snapshot().relations, after.relations);
  assert.deepEqual(k.snapshot().propagation, after.propagation);
  assert.ok(before!.length > 0);
  assert.equal(k.snapshot().generated, 0);
});
test('independent observation components do not re-evaluate old unrelated identity constraints', () => {
  const { pack, opening, profiles } = fixture();
  pack.plots['流言四起']!.abilities = [];
  // Two fixed character abilities have independent owners and budgets, no hidden identity link.
  pack.identities['主谋']!.abilities = [];
  pack.characters['男学生']!.abilities = [ability([{ ...add, target: 'school' }])];
  pack.characters['住院患者']!.abilities = [ability([{ ...add, target: 'hospital' }])];
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  const checks = profiles[0]!.store.stats.checks;
  c.consume(increase(3, 'hospital'), profiles);
  assert.equal(profiles[0]!.store.stats.checks - checks, 1);
});

test('simultaneous mandatory sources do not test mutable predicates against partially published board changes', () => {
  const { pack, opening, profiles } = fixture();
  pack.identities['主谋']!.abilities = [];
  pack.plots['流言四起']!.abilities = [
    ability([{ ...add, target: 'school' }], {
      id: 'first',
      mandatory: true,
      condition: { cmp: 'eq', left: { counter: 'intrigue', target: 'school' }, right: 0 },
    }),
    ability([{ ...add, target: 'city' }], {
      id: 'second',
      mandatory: true,
      condition: { cmp: 'eq', left: { counter: 'intrigue', target: 'school' }, right: 0 },
    }),
  ];
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  c.consume(increase(3, 'city'), profiles);
  assert.ok(profiles[0]!.active);
});
test('bounded cause propagation never removes a model retained by an independent small exhaustive oracle', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const store = new ConstraintStore(
      new Map(['a', 'b'].map((k) => [k, new Set(['brain', 'civilian'])])),
    );
    const profile = { id: 'test', y: 'Y', x: [], identityCounts: {}, store, active: true };
    const network = new CauseNetwork(new Map([['brain', 1]]), new Set(['a', 'b']));
    const records: Cause[][] = [];
    let random = seed;
    for (let seq = 1; seq <= 4; seq++) {
      const alternatives: Cause[] = [];
      for (const name of ['a', 'b', 'rule']) {
        random = (random * 1664525 + 1013904223) >>> 0;
        if (random % 3 === 0) continue;
        alternatives.push({
          category: name === 'rule' ? 'rule' : 'character',
          label: name,
          requires: name === 'rule' ? [] : [{ key: name, value: 'brain' }],
          resources: name === 'rule' ? [{ key: 'loop:rule', limit: 1, label: 'once' }] : [],
          notes: [],
        });
      }
      records.push(alternatives);
      const oracle: { a: string; b: string }[] = [];
      for (const a of ['brain', 'civilian'])
        for (const b of ['brain', 'civilian']) {
          if (a === 'brain' && b === 'brain') continue;
          const values: Record<string, string> = { a, b };
          const select = (i: number, uses: number): boolean =>
            i === records.length ||
            records[i]!.some(
              (c) =>
                c.requires.every((g) => values[g.key] === g.value) &&
                uses + c.resources.length <= 1 &&
                select(i + 1, uses + c.resources.length),
            );
          if (select(0, 0)) oracle.push({ a, b });
        }
      network.add(profile, {
        observation: seq,
        phase: 'mastermind-abilities',
        alternatives,
      });
      if (oracle.length) {
        assert.ok(profile.active, `seed ${seed}, prefix ${seq}`);
        for (const values of oracle)
          for (const key of ['a', 'b'] as const) assert.ok(store.values(key).has(values[key]));
      }
      if (!profile.active) break;
    }
  }
});
test('copycat brain does not consume a second ordinary identity slot in the cause network', () => {
  const pack = compileOfficial('FS');
  const setup: GameSetup = {
    module: 'FS',
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '复仇的火种',
    x: ['流言四起'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '模仿犯', identity: '主谋', copiedFrom: 'a' },
      { id: 'c', character: '巫女', identity: '传谣人' },
      { id: 'd', character: '医生', identity: '平民' },
    ],
    incidents: [],
  };
  const state = initializeDiscussion(pack, setup);
  assert.ok(state.state, JSON.stringify(state.diagnostics));
  const opening = project(state.state, 'protagonists');
  const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 }).filter(
    (p) => p.y === setup.y && p.x.includes('流言四起'),
  );
  for (const p of profiles) {
    for (const c of setup.characters) p.store.narrow(`identity:${c.id}`, [c.identity]);
    assert.ok(p.store.propagate());
  }
  const causal = new CausalScope(pack, opening);
  causal.consume(
    {
      sequence: 2,
      loop: 1,
      day: 1,
      phase: 'card-resolution',
      type: 'character',
      data: {
        character: 'b',
        area: 'hospital',
        status: 'alive',
        counters: opening.characters.find((c) => c.id === 'b')!.counters,
      },
    },
    profiles,
  );
  causal.consume(increase(3, 'school'), profiles);
  causal.consume(increase(4, 'hospital'), profiles);
  causal.consume(increase(5, 'city'), profiles);
  assert.ok(profiles.every((p) => p.active));
});
test('legal play reuses mastermind ability each day and rumor each loop without losing the true joint setup', () => {
  const pack = compileOfficial('FS');
  const setup: GameSetup = {
    module: 'FS',
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '复仇的火种',
    x: ['流言四起'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '住院患者', identity: '传谣人' },
      { id: 'c', character: '巫女', identity: '平民' },
    ],
    incidents: [],
  };
  let state = initializeDiscussion(pack, setup).state!;
  const opening = project(state, 'protagonists'),
    k = new LiveKnowledge(pack, opening);
  let through = 0;
  const used = new Set<string>();
  let target = '';
  let reachedSecondLoop = false;
  for (let step = 0; step < 100; step++) {
    const view = project(state, 'protagonists');
    k.append(view.observations.slice(through), through, view.revision);
    through = view.observations.length;
    assert.notEqual(k.snapshot().status, 'contradiction');
    if (state.loop === 2) reachedSecondLoop = true;
    if (state.loop === 2 && state.boards.city === 1) break;
    const d = state.pending;
    if (!d || state.winner) break;
    let choice: Choice;
    if (d.kind === 'cards') {
      const hand = state.cards.filter(
        (c) =>
          c.owner === d.actor &&
          c.status === 'hand' &&
          !['horizontal', 'vertical', 'diagonal'].includes(c.kind),
      );
      choice = {
        kind: 'cards',
        placements: hand.slice(0, d.actor === 'mastermind' ? 3 : 1).map((c, i) => ({
          card: c.id,
          target: ['a', 'b', 'c'][d.actor === 'mastermind' ? i : Number(d.actor.slice(1))]!,
        })),
      };
    } else {
      const candidate = d.options.find(
        (c) =>
          c.kind === 'ability' &&
          ['brain', 'rumor-intrigue'].includes(c.ability) &&
          !used.has(
            c.ability === 'brain' ? `${state.loop}:${state.day}:brain` : `${state.loop}:rumor`,
          ),
      );
      if (candidate?.kind === 'ability') {
        used.add(
          candidate.ability === 'brain'
            ? `${state.loop}:${state.day}:brain`
            : `${state.loop}:rumor`,
        );
        target = candidate.ability === 'brain' ? 'school' : 'city';
        choice = candidate;
      } else
        choice =
          d.options.find((c) => c.kind === 'select' && c.value === target) ??
          d.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
          d.options[0]!;
    }
    const next = advance(pack, state, d.actor, {
      id: `relation-${step}`,
      expectedRevision: state.revision,
      decisionId: d.id,
      choice,
    });
    assert.notEqual(next.status, 'rejected', JSON.stringify({ d, choice }));
    state = next.state;
  }
  assert.ok(reachedSecondLoop);
  assert.equal(k.queryConfiguration(setup), 'possible');
  assert.ok(k.snapshot().relations!.filter((r) => r.observation > 0).length >= 3);
});

test('an exhausted local relation budget retains unknown values and never creates a contradiction', () => {
  const store = new ConstraintStore(new Map([['a', new Set(['brain', 'civilian'])]]));
  const profile = { id: 'test', y: 'Y', x: [], identityCounts: {}, store, active: true };
  const network = new CauseNetwork(new Map([['brain', 1]]), new Set(['a']), 1);
  network.add(profile, {
    observation: 2,
    phase: 'mastermind-abilities',
    alternatives: [
      {
        category: 'character',
        label: 'a',
        requires: [{ key: 'a', value: 'brain' }],
        resources: [],
        notes: [],
      },
      { category: 'rule', label: 'rule', requires: [], resources: [], notes: [] },
    ],
  });
  assert.ok(profile.active);
  network.add(profile, { ...network.byObservation.get(2)!, observation: 3 });
  assert.ok(network.uncertain);
  assert.equal(store.values('a').size, 2);
});
test('shared ability keys constrain uses across character and rule causes', () => {
  const { pack, opening, profiles } = fixture();
  pack.identities['主谋']!.abilities = [];
  pack.plots['流言四起']!.abilities = [
    ability([{ ...add, target: 'school' }], { sharedKey: 'shared', loopLimit: 1 }),
  ];
  pack.characters['住院患者']!.abilities = [
    ability([{ ...add, target: 'hospital' }], { sharedKey: 'shared', loopLimit: 1 }),
  ];
  const c = new CausalScope(pack, opening);
  c.consume(increase(2, 'school'), profiles);
  assert.ok(profiles[0]!.active);
  c.consume(increase(3, 'hospital', 2), profiles);
  assert.equal(profiles[0]!.active, false);
});

test('movement, death and counters from one report are pruned before joining a shared activation', () => {
  const { pack, opening, profiles } = fixture();
  const move: Effect = { op: 'move', target: 'a', area: 'shrine' };
  const kill: Effect = { op: 'kill', target: 'a' };
  const gain: Effect = { op: 'counter', target: 'a', counter: 'hope', amount: 1 };
  pack.plots['流言四起']!.abilities = [
    ...[move, kill, gain].map((e, i) => ability([e], { id: 'only' + i, sharedKey: 'one' })),
    ability([move, kill, gain], { id: 'all-three', sharedKey: 'one', loopLimit: 1 }),
  ];
  const k = new CausalScope(pack, opening);
  const phase = 'mastermind-abilities';
  k.consume({ sequence: 1, day: 1, loop: 1, phase, type: 'boundary', data: { phase } }, profiles);
  const a = opening.characters.find((c) => c.id === 'a')!;
  const scope = k.consume(
    {
      sequence: 2,
      day: 1,
      loop: 1,
      phase,
      type: 'character',
      data: {
        character: 'a',
        area: 'shrine',
        status: 'dead',
        counters: { ...a.counters, hope: 1 },
      },
    },
    profiles,
  )!;
  assert.equal(scope.fields?.length, 3);
  for (const field of scope.fields!)
    assert.deepEqual(field.alternatives, ['规则“流言四起”的all-three效果']);
  assert.ok(profiles.every((p) => p.active));
  assert.ok(k.causeBranches > 0);
});

test('compound event target inequality applies only within one possible execution', () => {
  for (const [same, canRepeat] of [
    [false, false],
    [true, false],
    [true, true],
  ] as const) {
    const { pack, opening } = fixture();
    opening.incidents = [{ day: 1, name: '不安扩散' }];
    if (canRepeat) {
      (opening.roster ?? opening.characters).find((c) => c.id === 'c')!.character = '教主';
      opening.characters.find((c) => c.id === 'c')!.character = '教主';
    }
    for (const c of opening.characters) c.counters.paranoia = 8;
    const k = new LiveKnowledge(pack, opening);
    const phase = 'incident';
    const observed = (
      sequence: number,
      type: Observation['type'],
      data: Observation['data'],
    ): Observation => ({ sequence, type, data, phase, day: 1, loop: 1 });
    const first = opening.characters.find((c) => c.id === 'a')!;
    const second = opening.characters.find((c) => c.id === (same ? 'a' : 'b'))!;
    const observations = [
      observed(1, 'boundary', { phase }),
      observed(2, 'incident', { day: 1, occurred: true }),
      observed(3, 'character', {
        character: first.id,
        area: first.area,
        status: 'alive',
        counters: { ...first.counters, paranoia: 10 },
      }),
      observed(4, 'character', {
        character: second.id,
        area: second.area,
        status: 'alive',
        counters: { ...second.counters, paranoia: same ? 10 : 8, intrigue: 1 },
      }),
    ];
    const packet = new LiveKnowledge(pack, opening);
    packet.append(observations, 0, 1);
    for (const o of observations) k.append([o], o.sequence - 1, o.sequence);
    assert.equal(k.snapshot().status === 'contradiction', same);
    assert.deepEqual(k.snapshot().relations, packet.snapshot().relations);
    const v = k.snapshot();
    k.append(observations, 0, 4);
    assert.deepEqual(k.snapshot().propagation, v.propagation);
  }
});

test('local cause combinations must also satisfy the external copy and culprit constraints', () => {
  const store = new ConstraintStore(
    new Map(['a', 'b', 'outside'].map((key) => [key, new Set(['1', '2'])])),
  );
  const eq = (x: string, y: string) => x === y;
  store.add(relation('copy', 'a', 'outside', eq));
  store.add(relation('culprit', 'b', 'outside', eq));
  assert.ok(store.propagate());
  const p = { id: 'p', y: 'Y', x: [], identityCounts: {}, store, active: true },
    n = new CauseNetwork(new Map(), new Set());
  const choice = (label: string, requires: Cause['requires']): Cause => ({
    category: 'event',
    label,
    requires,
    notes: [],
    resources: [],
  });
  const bad = choice('bad', [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' },
  ]);
  const free = choice('free', []);
  const row = { phase: 'incident' };
  n.addMany(p, [
    { ...row, observation: 1, alternatives: [bad, free] },
    {
      ...row,
      observation: 2,
      alternatives: ['1', '2'].map((value) => choice(value, [{ key: 'a', value }])),
    },
  ]);
  assert.ok(p.active);
  assert.ok(n.excludedCauses.has(bad));
  assert.ok(!n.excludedCauses.has(free));
  for (const domain of store.domains.values()) assert.equal(domain.size, 2);
});

test('net counter changes preserve a single larger cause and all sufficient pairs; budget exhaustion retains uncertainty', () => {
  const c = (label: string, maxContribution?: number): Cause => ({
    label,
    maxContribution,
    category: 'rule',
    requires: [],
    resources: [],
    notes: [],
  });
  const causes = [c('A', 1), c('B', 1), c('C', 1), c('D', 2), c('未知')];
  assert.deepEqual(
    counterCauses(causes, 2)
      ?.map((x) => x.label)
      .sort(),
    ['A ＋ B', 'A ＋ C', 'B ＋ C', 'D', '未知'].sort(),
  );
  assert.equal(counterCauses(causes, 2, 1), undefined);
});

test('a compound ability binds its chosen target across effects and allows separate activations on different days', () => {
  const run = (same: boolean, nextDay: boolean) => {
    const { pack, opening, profiles } = fixture();
    const a = ability([], { id: 'select-once' });
    a.steps = [
      {
        choices: [{ key: 'chosen', options: { kind: 'alive' } }],
        effects: [
          { op: 'counter', target: '$chosen', counter: 'hope', amount: 1 },
          { op: 'counter', target: '$chosen', counter: 'despair', amount: 1 },
        ],
      },
    ];
    pack.plots['流言四起']!.abilities = [a];
    const scope = new CausalScope(pack, opening);
    const phase = 'mastermind-abilities';
    let sequence = 0;
    const send = (day: number, type: Observation['type'], data: Observation['data']) =>
      scope.consume({ loop: 1, day, phase, type, data, sequence: ++sequence }, profiles);
    send(1, 'boundary', { phase });
    const first = opening.characters.find((c) => c.id === 'a')!,
      second = opening.characters.find((c) => c.id === (same ? 'a' : 'b'))!;
    send(1, 'character', {
      character: first.id,
      area: first.area,
      status: 'alive',
      counters: { ...first.counters, hope: 1 },
    });
    if (nextDay) send(2, 'boundary', { phase });
    send(nextDay ? 2 : 1, 'character', {
      character: second.id,
      area: second.area,
      status: 'alive',
      counters: { ...second.counters, hope: same ? 1 : 0, despair: 1 },
    });
    return profiles.some((p) => p.active);
  };
  assert.equal(run(true, false), true);
  assert.equal(run(false, false), false);
  assert.equal(run(false, true), true);
});
