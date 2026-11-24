import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import type { KnowledgeView } from '../../packages/contracts/src/knowledge.js';
import { initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { officialScenarioSetup } from './official-harness.js';

function fixture(module: 'FS' | 'BTX' = 'BTX', name = '邪气污染') {
  const pack = structuredClone(compileOfficial(module));
  const setup: GameSetup = {
    module,
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: module === 'FS' ? '复仇的火种' : '被封印的邪灵',
    x: module === 'FS' ? ['开膛者的魔影'] : ['妄想扩大病毒', '因果线'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '住院患者', identity: module === 'FS' ? '杀人狂' : '邪教徒' },
      { id: 'c', character: '巫女', identity: '传谣人' },
    ],
    incidents: [],
  };
  const init = initializeDiscussion(pack, setup);
  assert.ok(init.state, JSON.stringify(init.diagnostics));
  const opening = initialPlacementView(init.state);
  opening.incidents = [{ day: 1, name }];
  for (const c of opening.characters) c.counters.paranoia = 8;
  return { pack, opening };
}
function stream(k: LiveKnowledge) {
  let sequence = 0;
  return (
    type: Observation['type'],
    data: Observation['data'],
    phase: Observation['phase'] = 'incident',
  ) => {
    k.append(
      [{ sequence: ++sequence, loop: 1, day: 1, phase, type, data }],
      sequence - 1,
      sequence,
    );
    return k.snapshot();
  };
}
function noWork(before: KnowledgeView, after: KnowledgeView) {
  for (const field of ['checks', 'branches', 'causeBranches', 'constraintVersion'] as const)
    assert.equal(after.propagation?.[field], before.propagation?.[field], field);
  assert.deepEqual(after.identities, before.identities);
  assert.deepEqual(after.culprits, before.culprits);
  assert.deepEqual(after.ruleCombinations, before.ruleCombinations);
  assert.deepEqual(after.transition?.historyCandidates, []);
}

for (const module of ['FS', 'BTX'] as const)
  for (const occurred of [false, true])
    test(`${module}: identical public incident trigger outcomes add no constraints (${occurred})`, () => {
      const { pack, opening } = fixture(module, '医院事故');
      for (const c of opening.characters) c.counters.paranoia = occurred ? 8 : 0;
      const k = new LiveKnowledge(pack, opening),
        send = stream(k),
        before = k.snapshot();
      send('boundary', {});
      const after = send('incident', { day: 1, occurred });
      noWork(before, after);
      assert.equal(after.scope?.publicSettlement, true);
    });

for (const module of ['FS', 'BTX'] as const)
  test(`${module}: a public quiet hospital requires no hidden search or propagation`, () => {
    const { pack, opening } = fixture(module, '医院事故');
    opening.boards.hospital = 0;
    const k = new LiveKnowledge(pack, opening),
      send = stream(k),
      before = k.snapshot();
    send('boundary', {});
    send('incident', { day: 1, occurred: true });
    noWork(before, send('no-effect', { day: 1 }));
    noWork(before, send('boundary', {}, 'captain-change'));
  });

for (const mode of ['ordinary', 'saturated', 'missing', 'wrong-amount', 'duplicate'] as const)
  test(`fixed public incident checks its exact output and consumes it once: ${mode}`, () => {
    const { pack, opening } = fixture();
    if (mode === 'saturated') opening.boards.shrine = 3;
    const k = new LiveKnowledge(pack, opening),
      send = stream(k),
      before = k.snapshot();
    send('boundary', {});
    send('incident', { day: 1, occurred: true });
    if (mode === 'missing') {
      assert.deepEqual(send('boundary', {}, 'captain-change').transition?.historyCandidates, [3]);
      return;
    }
    if (mode === 'wrong-amount') {
      assert.deepEqual(
        send('board', { board: 'shrine', intrigue: 1 }).transition?.historyCandidates,
        [3],
      );
      return;
    }
    const changed =
      mode === 'saturated'
        ? send('no-effect', { day: 1 })
        : send('board', { board: 'shrine', intrigue: 2 });
    noWork(before, changed);
    assert.equal(changed.scope?.publicSettlement, true);
    if (mode === 'duplicate') {
      assert.deepEqual(
        send('board', { board: 'shrine', intrigue: 3 }).transition?.historyCandidates,
        [4],
      );
    } else noWork(before, send('boundary', {}, 'captain-change'));
  });

for (const fragmented of [false, true])
  test(`fixed multistep incident keeps simultaneous reports public; fragmented ${fragmented}`, () => {
    const { pack, opening } = fixture();
    pack.incidents['邪气污染']!.steps = [
      {
        effects: [
          {
            op: 'each',
            selector: { kind: 'alive' },
            effects: [
              { op: 'counter', target: '$it', counter: 'hope', amount: 1 },
              { op: 'counter', target: '$it', counter: 'goodwill', amount: 1 },
            ],
          },
        ],
      },
      { effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: 2 }] },
    ];
    const k = new LiveKnowledge(pack, opening),
      before = k.snapshot();
    const reports: Observation[] = [
      { sequence: 1, loop: 1, day: 1, phase: 'incident', type: 'boundary', data: {} },
      {
        sequence: 2,
        loop: 1,
        day: 1,
        phase: 'incident',
        type: 'incident',
        data: { day: 1, occurred: true },
      },
      ...opening.characters.map(
        (c, i): Observation => ({
          sequence: 3 + i,
          loop: 1,
          day: 1,
          phase: 'incident',
          type: 'character',
          simultaneousGroup: 3,
          simultaneousSize: opening.characters.length,
          data: {
            character: c.id,
            area: c.area,
            status: c.status,
            counters: { ...c.counters, hope: 1, goodwill: 1 },
          },
        }),
      ),
      {
        sequence: 6,
        loop: 1,
        day: 1,
        phase: 'incident',
        type: 'board',
        data: { board: 'school', intrigue: 2 },
      },
      { sequence: 7, loop: 1, day: 1, phase: 'captain-change', type: 'boundary', data: {} },
    ];
    if (fragmented) {
      for (const o of reports) {
        k.append([o], o.sequence - 1, o.sequence);
        noWork(before, k.snapshot());
      }
    } else {
      k.append(reports, 0, reports.length);
      noWork(before, k.snapshot());
    }
  });

test('ordinary trigger differences still narrow the culprit', () => {
  const { pack, opening } = fixture('BTX', '医院事故');
  opening.characters.find((c) => c.id === 'b')!.counters.paranoia = 0;
  const k = new LiveKnowledge(pack, opening),
    send = stream(k),
    before = k.snapshot();
  send('boundary', {});
  const after = send('incident', { day: 1, occurred: true });
  assert.ok(!after.culprits['1']?.includes('b'));
  assert.ok(after.propagation!.checks > before.propagation!.checks);
  assert.notEqual(after.scope?.publicSettlement, true);
});

test('a cancelling culprit remains a relevant distinction for a normal visible effect', () => {
  const { pack, opening } = fixture();
  opening.characters.find((c) => c.id === 'b')!.character = '黑猫';
  if (opening.roster) opening.roster.find((c) => c.id === 'b')!.character = '黑猫';
  const k = new LiveKnowledge(pack, opening),
    send = stream(k);
  send('boundary', {});
  const triggered = send('incident', { day: 1, occurred: true });
  assert.ok(triggered.culprits['1']?.includes('b'));
  const after = send('board', { board: 'shrine', intrigue: 2 });
  assert.ok(!after.culprits['1']?.includes('b'));
  assert.notEqual(after.scope?.publicSettlement, true);
});

for (const module of ['MC', 'WM'] as const)
  test(`${module}: multiple identity candidates with the same trigger result do not require search`, () => {
    const pack = compileOfficial(module),
      init = initializeDiscussion(pack, officialScenarioSetup(module));
    assert.ok(init.state);
    const opening = initialPlacementView(init.state);
    opening.incidents = [{ day: 1, name: '医院事故' }];
    for (const actor of opening.characters) actor.counters.paranoia = 100;
    const k = new LiveKnowledge(pack, opening),
      send = stream(k),
      before = k.snapshot();
    send('boundary', {});
    noWork(before, send('incident', { day: 1, occurred: true }));
  });

test('a later fixed step cannot consume an extra report in the preceding simultaneous group', () => {
  const { pack, opening } = fixture();
  pack.incidents['邪气污染']!.steps = [
    { effects: [{ op: 'counter', target: 'shrine', counter: 'intrigue', amount: 1 }] },
    { effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: 1 }] },
  ];
  const k = new LiveKnowledge(pack, opening),
    send = stream(k);
  send('boundary', {});
  send('incident', { day: 1, occurred: true });
  k.append(
    ['shrine', 'school'].map(
      (board, i): Observation => ({
        sequence: 3 + i,
        loop: 1,
        day: 1,
        phase: 'incident',
        type: 'board',
        simultaneousGroup: 3,
        simultaneousSize: 2,
        data: { board, intrigue: 1 },
      }),
    ),
    2,
    4,
  );
  const result = k.snapshot();
  assert.notEqual(result.scope?.publicSettlement, true);
  assert.ok(
    result.status === 'contradiction' || result.transition?.historyCandidates?.includes(4),
    JSON.stringify({ status: result.status, scope: result.scope, transition: result.transition }),
  );
});

test('a public fixed effect still checks mandatory incident-completion work', () => {
  const { pack, opening } = fixture();
  pack.characters['住院患者']!.abilities.push({
    id: 'completion',
    source: 'fixture',
    timing: 'incident-completed',
    mandatory: true,
    steps: [{ effects: [{ op: 'flag', target: '$self', key: 'private-completion' }] }],
  });
  const k = new LiveKnowledge(pack, opening),
    send = stream(k),
    before = k.snapshot();
  send('boundary', {});
  send('incident', { day: 1, occurred: true });
  noWork(before, send('board', { board: 'shrine', intrigue: 2 }));
  assert.deepEqual(send('boundary', {}, 'captain-change').transition?.historyCandidates, [4]);
});

test('private incident step conditions retain history verification', () => {
  const { pack, opening } = fixture();
  pack.incidents['邪气污染']!.steps[0]!.condition = { flag: 'private-condition', target: '$self' };
  const k = new LiveKnowledge(pack, opening),
    send = stream(k);
  send('boundary', {});
  send('incident', { day: 1, occurred: true });
  assert.deepEqual(send('no-effect', { day: 1 }).transition?.historyCandidates, [3]);
});

test('an effect on the culprit still distinguishes candidate owners without extra modifiers', () => {
  const { pack, opening } = fixture();
  pack.incidents['邪气污染']!.steps = [
    { effects: [{ op: 'counter', target: '$self', counter: 'hope', amount: 1 }] },
  ];
  const k = new LiveKnowledge(pack, opening),
    send = stream(k);
  send('boundary', {});
  send('incident', { day: 1, occurred: true });
  const actor = opening.characters[0]!;
  const result = send('character', {
    character: actor.id,
    area: actor.area,
    status: actor.status,
    counters: { ...actor.counters, hope: 1 },
  });
  assert.deepEqual(result.culprits['1'], [actor.id]);
  assert.notEqual(result.scope?.publicSettlement, true);
});

test('a completed public first step does not hide a missing later step', () => {
  const { pack, opening } = fixture();
  pack.incidents['邪气污染']!.steps = [
    { effects: [{ op: 'counter', target: 'shrine', counter: 'intrigue', amount: 2 }] },
    { effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: 1 }] },
  ];
  const k = new LiveKnowledge(pack, opening),
    send = stream(k),
    before = k.snapshot();
  send('boundary', {});
  send('incident', { day: 1, occurred: true });
  noWork(before, send('board', { board: 'shrine', intrigue: 2 }));
  assert.deepEqual(send('boundary', {}, 'captain-change').transition?.historyCandidates, [4]);
});
