import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import {
  LiveKnowledge,
  EnumeratedKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.js';
import { HistorySearch } from '../../packages/engine/src/runtime/knowledge-history.js';
import { initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';

test('direct, delegated and pending goodwill requests narrow different hypotheses', () => {
  const pack = compileOfficial('BTX');
  const opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
  opening.characters[0]!.character = '男学生';
  (opening.roster ?? opening.characters).find((c) => c.id === opening.characters[0]!.id)!.character = '男学生';
  const actor = opening.characters[0]!;
  const obs = (
    type: Observation['type'],
    data: Observation['data'],
    sequence: number,
  ): Observation => ({ sequence, loop: 1, day: 1, phase: 'protagonist-abilities', type, data });
  for (const [hope, independent, refused] of [
    [0, true, false],
    [0, false, false],
    [1, true, false],
    [0, true, true],
  ] as const) {
    actor.counters.goodwill = 2 - hope;
    actor.counters.hope = hope;
    const k = new LiveKnowledge(pack, opening);
    const log: Observation[] = [];
    if (independent) {
      log.push(
        obs(
          'own-choice',
          { actor: 'p0', choice: { kind: 'ability', owner: actor.id, ability: 'student' } },
          1,
        ),
      );
      log.push(
        obs(
          'own-choice',
          { actor: 'p0', choice: { kind: 'select', key: 'target', value: 'b' } },
          2,
        ),
      );
    }
    log.push(
      obs(
        'declaration',
        { character: actor.id, ability: 'student', choices: { target: 'b' } },
        log.length + 1,
      ),
    );
    k.append(log, 0, 1);
    assert.ok(
      k.snapshot().identities[actor.id]!.includes('邪教徒'),
      'request alone does not prove acceptance',
    );
    const next = refused
      ? obs('refused', { character: actor.id, ability: 'student' }, log.length + 1)
      : obs('boundary', { phase: 'protagonist-abilities' }, log.length + 1);
    k.append([next], log.length, 2);
    assert.equal(
      k.snapshot().identities[actor.id]!.includes('邪教徒'),
      !!hope || !independent || refused,
    );
  }
});

const setup: GameSetup = {
  module: 'BTX',
  anniversary: false,
  loops: 2,
  days: 2,
  y: '改变未来',
  x: ['流言四起', '因果线'],
  captain: 'p0',
  discussion: 'allowed',
  characters: [
    { id: 'a', character: '男学生', identity: '时间旅者' },
    { id: 'b', character: '住院患者', identity: '传谣人' },
    { id: 'c', character: '黑猫', identity: '邪教徒' },
  ],
  incidents: [],
};

for (const module of ['FS', 'BTX'] as const)
  test(
    module + ' partial translations keep joint queries unresolved through new observations',
    () => {
      const config: GameSetup =
        module === 'BTX'
          ? structuredClone(setup)
          : {
              ...setup,
              module,
              y: '复仇的火种',
              x: ['流言四起'],
              characters: setup.characters.map((c, i) => ({
                ...c,
                identity: ['主谋', '传谣人', '平民'][i]!,
              })),
            };
      config.incidents = [{ day: 1, name: '医院事故', culprit: 'b' }];
      const full = compileOfficial(module);
      const opening = initialPlacementView(initializeDiscussion(full, config).state!);
      for (const Solver of [LiveKnowledge, EnumeratedKnowledge]) {
        const solver = new Solver(full, opening);
        assert.equal(solver.queryConfiguration(config), 'possible');
        assert.equal(solver.queryConfiguration({ ...config, days: 0 }), 'excluded');
      }
      const otherEvent = structuredClone(full);
      otherEvent.incidents['散播']!.supported = false;
      assert.equal(new LiveKnowledge(otherEvent, opening).queryConfiguration(config), 'possible');
      otherEvent.incidents['医院事故']!.steps = [
        {
          effects: [
            {
              op: 'when',
              condition: true,
              effects: [{ op: 'invoke-incident', name: '散播', culprit: '$self' }],
            },
          ],
        },
      ];
      assert.equal(new LiveKnowledge(otherEvent, opening).queryConfiguration(config), 'unknown');
      for (const kind of ['identities', 'characters', 'incidents'] as const) {
        const partial = structuredClone(full);
        const name =
          kind === 'identities'
            ? config.characters[0]!.identity
            : kind === 'characters'
              ? '男学生'
              : '医院事故';
        partial[kind][name]!.supported = false;
        for (const Solver of [LiveKnowledge, EnumeratedKnowledge]) {
          const solver = new Solver(partial, opening);
          solver.update(opening.observations, opening.revision);
          solver.tick();
          assert.equal(solver.queryConfiguration(config), 'unknown');
          const snapshot = solver.snapshot();
          assert.equal(snapshot.status, 'unsupported');
          assert.equal(snapshot.domainComplete, false);
          assert.equal(snapshot.excluded, 0);
          assert.ok(snapshot.reasons.some((r) => r.includes(name)));
        }
        const search = new HistorySearch(
          partial,
          config,
          { observations: [], normalized: [], version: 0 },
          opening,
        );
        search.step();
        assert.equal(search.result, 'unknown');
        assert.ok(search.blocked);
      }
    },
  );

test('closed loop-start window requires public effects; open windows and positive reports preserve alternatives', () => {
  for (const reported of [false, true]) {
    const pack = compileOfficial('BTX'),
      opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
    const k = new LiveKnowledge(pack, opening);
    let n = 0;
    function receive(
      loop: number,
      phase: Observation['phase'],
      type: Observation['type'],
      data: Observation['data'],
    ) {
      const o = { sequence: n + 1, loop, day: 1, phase, type, data };
      k.append([o], n++, n);
      const first = k.snapshot();
      k.append([o], n, n);
      assert.deepEqual(k.snapshot().propagation, first.propagation);
      assert.equal(k.snapshot().evidenceThrough, n);
    }
    receive(1, 'discussion', 'boundary', { phase: 'discussion' });
    const c = opening.characters.find((c) => c.id === 'a')!;
    const data = {
      character: 'a',
      area: c.area,
      status: c.status,
      counters: { ...c.counters, goodwill: 1 },
    };
    receive(1, 'loop-end', 'character', data);
    receive(2, 'discussion', 'boundary', { phase: 'discussion' });
    receive(2, 'discussion', 'character', { ...data, counters: c.counters });
    receive(2, 'loop-start', 'boundary', { phase: 'loop-start' });
    receive(2, 'loop-start', 'board', { board: 'shrine', intrigue: 1 });
    assert.ok(k.snapshot().rules.includes('因果线'));
    if (reported)
      receive(2, 'loop-start', 'character', { ...data, counters: { ...c.counters, paranoia: 2 } });
    receive(2, 'day-start', 'boundary', { phase: 'day-start' });
    assert.equal(k.snapshot().rules.includes('因果线'), reported);
    assert.notEqual(k.snapshot().status, 'contradiction');
    if (!reported) assert.equal(k.snapshot().scope?.kind, 'mandatory-absence');
  }
});

test('anniversary requires a civilian overlay in validation and both solver domains', () => {
  const config: GameSetup = {
    ...setup,
    module: 'FS',
    anniversary: true,
    y: '复仇的火种',
    x: ['开膛者的魔影'],
    characters: setup.characters.map((c, i) => ({
      ...c,
      identity: ['主谋', '杀人狂', '传谣人'][i]!,
    })),
  };
  const pack = compileOfficial('FS', true);
  const initial = initializeDiscussion(pack, config);
  assert.ok(initial.diagnostics.some((d) => d.code === 'missing-anniversary-fragment'));
  const legal = { ...config, y: '复仇的火种', x: ['流言四起'], anniversaryFragment: 'c',
    characters: config.characters.map((c,i) => ({ ...c, identity: ['主谋','传谣人','平民'][i]! })) };
  const opening = initialPlacementView(initializeDiscussion(pack, legal).state!),
    k = new LiveKnowledge(pack, opening);
  k.update(opening.observations, 1);
  assert.equal(k.snapshot().generated, 0);
  assert.ok([...generateDomain(pack, opening)].every((c) => !c || c.anniversaryFragment));
  assert.equal(k.queryConfiguration(config), 'excluded');
  assert.equal(k.queryConfiguration(legal), 'possible');
});

test('simple observations stop alone and in mixed public packets; hidden outcomes still wake search', () => {
  const pack = compileOfficial('BTX'),
    opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
  const k = new LiveKnowledge(pack, opening);
  const actor = opening.characters[0]!;
  const observe = (
    sequence: number,
    type: Observation['type'],
    phase: Observation['phase'],
    data: Observation['data'],
  ): Observation => ({ sequence, loop: 1, day: 1, type, phase, data });
  const observations = [
    ...opening.observations,
    observe(2, 'cards', 'card-resolution', {
      placements: [{ target: actor.id, kind: 'paranoia+1' }],
    }),
    observe(3, 'character', 'card-resolution', {
      ...actor,
      character: actor.id,
      counters: { ...actor.counters, paranoia: 1 },
    }),
    observe(4, 'boundary', 'mastermind-abilities', { phase: 'mastermind-abilities' }),
    observe(5, 'board', 'mastermind-abilities', { board: 'city', intrigue: 1 }),
    observe(6, 'boundary', 'protagonist-abilities', { phase: 'protagonist-abilities' }),
    observe(7, 'rule', 'protagonist-abilities', { rule: '流言四起' }),
    observe(8, 'identity', 'protagonist-abilities', { character: 'a', identity: '时间旅者' }),
  ];
  k.append(observations, 0, 1);
  k.tick(50, Infinity);
  const v = k.snapshot();
  assert.equal(v.historySearchDeferred, true);
  assert.deepEqual(v.transition?.historyCandidates, []);
  assert.equal(v.generated, 0);
  assert.equal(v.expansions, 0);
  assert.equal(v.propagation?.branches, 0);
  assert.equal(v.status, 'incomplete');
  assert.ok(
    v.relations!.some((r) => r.implications.some((i) => i.includes('都要求剧本含有“流言四起”'))),
  );
  assert.deepEqual(v.identities.a, ['时间旅者']);
  assert.deepEqual(v.verified?.identities.a, undefined);
  const single = new LiveKnowledge(pack, opening);
  for (const [i, o] of observations.entries()) {
    single.append([o], i, i + 1);
    single.tick(20);
  }
  assert.deepEqual(single.snapshot().relations, v.relations);
  assert.equal(single.snapshot().generated, 0);
  k.append(
    [
      observe(9, 'no-effect', 'incident', { day: 1 }),
      observe(10, 'boundary', 'day-end', { phase: 'day-end' }),
    ],
    8,
    2,
  );
  assert.deepEqual(k.snapshot().transition?.historyCandidates, [9]);
  assert.equal(k.historySearchDeferred, false);
  k.tick(100);
  assert.ok(k.snapshot().generated > 0);
});

test('conflicting cards, a second unexplained increment and closed mandatory windows keep their history checks', () => {
  const pack = compileOfficial('BTX'),
    opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
  const actor = opening.characters[0]!;
  for (const blocked of [true, false]) {
    const k = new LiveKnowledge(pack, opening);
    let n = 0;
    const append = (
      type: Observation['type'],
      phase: Observation['phase'],
      data: Observation['data'],
    ) => {
      const o = { sequence: n + 1, loop: 1, day: 1, type, phase, data };
      k.append([o], n++, n);
    };
    append('cards', 'card-resolution', {
      placements: [
        { target: actor.id, kind: 'goodwill+1' },
        ...(blocked ? [{ target: actor.id, kind: 'block-goodwill' }] : []),
      ],
    });
    for (const goodwill of [1, 2]) {
      append('character', 'card-resolution', {
        ...actor,
        character: actor.id,
        counters: { ...actor.counters, goodwill },
      });
      assert.equal(k.historySearchDeferred, !blocked && goodwill === 1);
    }
    append('boundary', 'day-end', { phase: 'day-end' });
    append('boundary', 'loop-end', { phase: 'loop-end' });
    assert.deepEqual(k.snapshot().transition?.historyCandidates, [5]);
  }
});

test('a known black-cat culprit explains its own no-effect report exactly once', () => {
  const pack = compileOfficial('BTX');
  const opening = initialPlacementView(
    initializeDiscussion(pack, {
      ...setup,
      incidents: [{ day: 1, name: '医院事故', culprit: 'c' }],
    }).state!,
  );
  const k = new LiveKnowledge(pack, opening);
  const cat = opening.characters.find((c) => c.id === 'c')!;
  const reports: Pick<Observation, 'type' | 'data'>[] = [
    { type: 'culprit', data: { day: 1, culprit: 'c' } },
    {
      type: 'character',
      data: { ...cat, character: 'c', counters: { ...cat.counters, paranoia: 5 } },
    },
    { type: 'incident', data: { day: 1, name: '医院事故', occurred: true } },
    { type: 'no-effect', data: { day: 1 } },
    { type: 'no-effect', data: { day: 1 } },
  ];
  for (const [i, report] of reports.entries()) {
    k.append([{ ...report, loop: 1, day: 1, phase: 'incident', sequence: i + 1 }], i, i + 1);
    if (i === 3) {
      assert.notEqual(k.snapshot().status, 'contradiction');
      assert.equal(k.historySearchDeferred, true);
      assert.deepEqual(k.snapshot().culprits['1'], ['c']);
    }
  }
  assert.deepEqual(k.snapshot().transition?.historyCandidates, [5]);
});
