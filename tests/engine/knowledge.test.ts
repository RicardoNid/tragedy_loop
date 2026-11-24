import { startSession, solverOpening } from './start-session.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { createSession } from '../../packages/engine/src/runtime/ports.js';
// Retain the independent exhaustive implementation as a finite-domain regression oracle.
import {
  generateDomain,
  EnumeratedKnowledge,
} from '../../packages/engine/src/runtime/knowledge.js';
import {
  createReferenceKnowledge,
  queryReference,
} from '../../packages/engine/src/runtime/reference.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import type { GameSetup, Observation, PlayerView } from '../../packages/contracts/src/game.js';

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
    { id: 'b', character: '女学生', identity: '传谣人' },
  ],
  incidents: [],
};
const pack = compileOfficial('FS');
function session(config = setup) {
  const s = createSession(compileOfficial(config.module, config.anniversary), config);
  startSession(s);
  return s;
}
function finish(k: EnumeratedKnowledge) {
  const deadline = Date.now() + 30000;
  while (!k.paused && Date.now() < deadline) k.tick(10, Infinity);
  return k.snapshot();
}
function observation(
  view: PlayerView,
  type: Observation['type'],
  data: Record<string, unknown>,
): Observation {
  return {
    sequence: view.observations.length + 1,
    loop: 1,
    day: 1,
    phase: 'protagonist-abilities',
    type,
    data,
  };
}

test('complete rule-generated domain includes unlisted scripts; only public roster is used', () => {
  const opening = solverOpening(session());
  const domain = [...generateDomain(pack, opening)].filter((s) => s !== null);
  // Two-character roster: mastermind + rumormonger or key person + cultist cannot coexist
  // with a third required identity. Exactly the two permutations of the former survive.
  assert.equal(domain.length, 2);
  for (const config of domain) {
    assert.deepEqual(validateSetup(pack, config), []);
    assert.deepEqual(
      config.characters.map((c) => c.id),
      ['a', 'b'],
    );
  }
  assert.equal(new Set(domain.map(canonical)).size, domain.length);
  const k = new EnumeratedKnowledge(pack, opening);
  k.update(opening.observations, opening.revision);
  const result = finish(k);
  assert.equal(result.status, 'exact');
  assert.equal(result.possible, 2);
  assert.deepEqual(new Set(result.identities.a), new Set(['主谋', '传谣人']));
  const oracle = queryReference(
    pack,
    createReferenceKnowledge(
      pack,
      domain.map((s, i) => ({ id: String(i), setup: s })),
      opening.observations,
    ),
    { expansions: 100, choicesPerNode: 100, depth: 10, engineSteps: 1000 },
  );
  assert.equal(result.possible, oracle.retained.length);
});

test('global assignment propagation, provenance, contradiction and no rewriting history', () => {
  const opening = solverOpening(session());
  const k = new EnumeratedKnowledge(pack, opening);
  k.update(opening.observations, 1);
  finish(k);
  const reveal = observation(opening, 'identity', { character: 'a', identity: '主谋' });
  k.update([...opening.observations, reveal], 2);
  let result = k.snapshot();
  assert.equal(result.excluded, 1);
  assert.deepEqual(result.identities.b, ['传谣人']);
  assert.equal(result.deductions?.[0]?.observation, 2);
  // A propagated candidate is still unproved until a full legal witness is found.
  assert.equal(result.status, 'incomplete');
  k.update(
    [
      ...opening.observations,
      reveal,
      { ...reveal, sequence: 3, data: { character: 'b', identity: '主谋' } },
    ],
    3,
  );
  result = k.snapshot();
  assert.equal(result.status, 'contradiction');
  assert.deepEqual(result.identities, {});
  assert.throws(() => k.update(opening.observations, 4), /追加/);
});

test('secret identity permutation and discussion policy cannot change initial knowledge', () => {
  const a = solverOpening(session());
  const b = solverOpening(session({
    ...setup,
    discussion: 'between-loops',
    characters: setup.characters.map((c, i) => ({ ...c, identity: i ? '主谋' : '传谣人' })),
  }));
  assert.deepEqual(a.observations, b.observations);
  const ka = new EnumeratedKnowledge(pack, a),
    kb = new EnumeratedKnowledge(pack, b);
  ka.update(a.observations, a.revision);
  kb.update(b.observations, b.revision);
  assert.deepEqual(finish(ka).identities, finish(kb).identities);
});

test('budget exhaustion retains candidates and new known actions resume coherent histories', () => {
  const s = session(),
    opening = solverOpening(s);
  const k = new EnumeratedKnowledge(pack, opening);
  k.update(opening.observations, opening.revision);
  finish(k);
  s.protagonists.p0.submit({
    id: 'continue',
    expectedRevision: opening.revision,
    decisionId: opening.decision!.id,
    choice: { kind: 'continue' },
  });
  const next = s.protagonists.p0.view();
  k.update(next.observations, next.revision);
  k.tick(10, 0);
  assert.equal(k.snapshot().status, 'incomplete');
  assert.equal(k.snapshot().excluded, 0);
  const resumed = new EnumeratedKnowledge(pack, opening);
  resumed.update(next.observations, next.revision);
  const result = finish(resumed);
  assert.equal(result.possible, 2);
  assert.equal(result.excluded, 0);
  assert.equal(result.revision, next.revision);
});

test('anniversary domain allocates exactly one civilian fragment without reading the real one', () => {
  const config = {
    ...setup,
    anniversary: true,
    anniversaryFragment: 'c',
    characters: [...setup.characters, { id: 'c', character: '住院患者', identity: '平民' }],
  };
  const opening = solverOpening(session(config));
  const anniversary = compileOfficial('FS', true);
  const domain = [...generateDomain(anniversary, opening)].filter((s) => s !== null);
  assert.ok(domain.length > 1);
  assert.ok(domain.some((s) => s.anniversaryFragment !== 'c'));
  for (const s of domain) assert.deepEqual(validateSetup(anniversary, s), []);
});

test('unbounded setup variables report unsupported instead of an empty exact space', () => {
  const opening = solverOpening(session());
  opening.characters[0]!.character = '仙人';
  const k = new EnumeratedKnowledge(pack, opening);
  k.update(opening.observations, 1);
  k.tick();
  assert.equal(k.snapshot().status, 'unsupported');
  assert.equal(k.snapshot().domainComplete, false);
});

test('real engine disclosure shrinks the space and matches independent finite reference search', () => {
  // Synthetic disclosure fixture: isolates knowledge correctness from goodwill setup mechanics.
  const rules = structuredClone(pack);
  rules.characters['男学生']!.abilities.push({
    id: 'fixture-reveal',
    source: 'test',
    timing: 'day-start',
    mandatory: true,
    steps: [{ effects: [{ op: 'reveal-identity', target: 'a' }] }],
  });
  const s = createSession(rules, setup);
  startSession(s);
  const opening = solverOpening(s);
  const k = new EnumeratedKnowledge(rules, opening);
  k.update(opening.observations, opening.revision);
  assert.equal(finish(k).possible, 2);
  s.protagonists.p0.submit({
    id: 'disclose',
    expectedRevision: opening.revision,
    decisionId: opening.decision!.id,
    choice: { kind: 'continue' },
  });
  const view = s.protagonists.p0.view();
  assert.ok(view.observations.some((o) => o.type === 'identity' && o.data.identity === '主谋'));
  k.update(view.observations, view.revision);
  const result = finish(k);
  assert.equal(result.status, 'exact');
  assert.equal(result.possible, 1);
  assert.equal(result.excluded, 1);
  const domain = [...generateDomain(rules, opening)]
    .filter((s) => s !== null)
    .map((setup, i) => ({ id: String(i), setup }));
  const oracle = queryReference(rules, createReferenceKnowledge(rules, domain, view.observations), {
    expansions: 100,
    choicesPerNode: 100,
    depth: 5,
    engineSteps: 1000,
  });
  assert.equal(result.possible, oracle.retained.length);
  assert.equal(result.excluded, oracle.excluded.length);
});

test('multiple unknown mastermind card branches stay compatible without using the real cards', () => {
  const s = session(),
    opening = solverOpening(s);
  s.protagonists.p0.submit({
    id: 'go',
    expectedRevision: opening.revision,
    decisionId: opening.decision!.id,
    choice: { kind: 'continue' },
  });
  const mm = s.mastermind.view();
  const choice = {
    kind: 'cards' as const,
    placements: (
      [
        ['paranoia+1', 'a'],
        ['intrigue+2', 'b'],
        ['horizontal', 'hospital'],
      ] as const
    ).map(([kind, target]) => ({
      card: mm.hands.mastermind!.find((c) => c.kind === kind)!.id,
      target,
    })),
  };
  s.mastermind.submit({
    id: 'secret',
    expectedRevision: mm.revision,
    decisionId: mm.decision!.id,
    choice,
  });
  const view = s.protagonists.p0.view();
  assert.ok(view.placements.every((p) => !p.kind));
  const k = new EnumeratedKnowledge(pack, opening);
  k.update(view.observations, view.revision);
  const result = finish(k);
  assert.equal(result.possible, 2);
  assert.equal(result.excluded, 0);
  assert.ok(result.expansions > 2, 'must explore alternative secret card choices');
  // The first hidden explanation need not be the real one. Revealing cards later must revisit
  // alternatives rather than excluding a script merely because that first witness fails.
  for (const [seat, kind, target] of [
    ['p0', 'horizontal', 'hospital'],
    ['p1', 'vertical', 'shrine'],
    ['p2', 'block-movement', 'city'],
  ] as const) {
    const v = s.protagonists[seat].view();
    const card = v.hands[seat]!.find((c) => c.kind === kind)!;
    const submitted = s.protagonists[seat].submit({
      id: `reveal-${seat}`,
      expectedRevision: v.revision,
      decisionId: v.decision!.id,
      choice: { kind: 'cards', placements: [{ card: card.id, target }] },
    });
    assert.notEqual(submitted.status, 'rejected');
  }
  const revealed = s.protagonists.p0.view();
  k.update(revealed.observations, revealed.revision);
  const afterReveal = finish(k);
  assert.equal(afterReveal.status, 'exact');
  assert.equal(k.queryConfiguration(setup), 'possible');
});
