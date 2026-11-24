import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeObservationGroups,
  type GameSetup,
  type Observation,
} from '../../packages/contracts/src/game.js';
import { EnumeratedKnowledge, LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { canonical, type RulePack } from '../../packages/engine/src/runtime/model.js';
import { configuredAddition } from '../../packages/engine/src/runtime/knowledge-domain.js';
import { focusedHistory, focusedTimelineCases } from './knowledge-timeline-cases.js';

function complete(solver: LiveKnowledge | EnumeratedKnowledge) {
  if (solver instanceof LiveKnowledge) solver.verifyCombinations();
  const deadline = performance.now() + 90000;
  while (!solver.paused && performance.now() < deadline) solver.tick(20, Infinity);
  const view = solver.snapshot();
  assert.ok(['exact', 'contradiction'].includes(view.status), JSON.stringify(view.reasons));
  assert.equal(view.domainComplete, true);
  const solutions = solver.jointSolutions();
  assert.ok(solutions, 'Unfinished enumeration is not an empty solution set');
  return { view, solutions };
}
function keys(pack: RulePack, setups: GameSetup[]) {
  return new Set(
    setups.map((s) =>
      canonical({
        ...s,
        discussion: 'allowed',
        secretAddition: configuredAddition(s),
        x: s.module === 'WM' ? s.x : [...s.x].sort(),
        characters: s.characters
          .map((c) => ({
            ...c,
            initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        incidents: s.incidents
          .map((e) => ({ ...e, publicName: e.publicName ?? e.name }))
          .sort((a, b) => a.day - b.day),
      }),
    ),
  );
}

for (const fixture of focusedTimelineCases)
  test(
    fixture.id + ' compares every focused settlement prefix against independent exhaustive search',
    { timeout: 120000 },
    () => {
      const { pack, opening, history } = focusedHistory(fixture);
      const original = new LiveKnowledge(pack, opening),
        batched = new LiveKnowledge(pack, opening),
        local = new LiveKnowledge(pack, opening);
      let focusChecks = 0;
      let through = 0,
        batchedThrough = 0,
        checkpoints = 0,
        shrinking = 0;
      let prior: Set<string> | undefined;
      const compare = () => {
        batched.append(history.slice(batchedThrough, through), batchedThrough, through);
        batchedThrough = through;
        const exhaustive = new EnumeratedKnowledge(pack, opening, 10000, true);
        exhaustive.update(history.slice(0, through), through);
        const oracle = complete(exhaustive),
          expected = keys(pack, oracle.solutions);
        assert.equal(expected.size, oracle.view.possible);
        assert.deepEqual(
          keys(pack, complete(original).solutions),
          expected,
          'raw delivery at #' + through,
        );
        assert.deepEqual(
          keys(pack, complete(batched).solutions),
          expected,
          'node delivery at #' + through,
        );
        assert.ok(
          expected.has([...keys(pack, [fixture.setup])][0]!),
          'independent oracle lost actual setup',
        );
        const projection = local.snapshot();
        for (const s of oracle.solutions) {
          for (const c of s.characters)
            assert.ok(
              projection.identities[c.id]?.includes(c.identity),
              'local projection lost ' + c.id + '=' + c.identity,
            );
          for (const name of [s.y, ...s.x]) assert.ok(projection.rules.includes(name));
          for (const event of s.incidents)
            assert.ok(projection.culprits[String(event.day)]?.includes(event.culprit));
        }
        if (prior) {
          assert.ok([...expected].every((k) => prior!.has(k)));
          if (expected.size < prior.size) shrinking++;
        }
        prior = expected;
        checkpoints++;
      };
      compare();
      for (const group of completeObservationGroups(history)) {
        const beforeChecks = local.snapshot().propagation?.checks ?? 0;
        for (const o of group) {
          original.append([o], through, through + 1);
          local.append([o], through, through + 1);
          through++;
        }
        if (
          group.some(
            (o) =>
              o.phase === fixture.focus ||
              (o.type === 'boundary' &&
                o.phase === (fixture.focus === 'incident' ? 'captain-change' : 'incident')),
          )
        ) {
          focusChecks += (local.snapshot().propagation?.checks ?? 0) - beforeChecks;
          compare();
        }
      }
      if (batchedThrough !== through) compare();
      assert.ok(checkpoints >= 4);
      if (fixture.id.startsWith('BTX-goodwill'))
        assert.ok(focusChecks > 0, 'acceptance must still check relevant refusal candidates');
      else assert.equal(focusChecks, 0, 'public-only settlement must skip constraint propagation');
      console.log(
        JSON.stringify({
          fixture: fixture.id,
          oracleCheckpoints: checkpoints,
          shrinking,
          remaining: prior!.size,
          localChecks: local.snapshot().propagation?.checks,
          focusChecks,
        }),
      );
    },
  );

for (const mutation of [
  'goodwill-wrong-amount',
  'incident-wrong-amount',
  'incident-missing-effect',
] as const)
  test(
    'independent exhaustive search and both deliveries reject ' + mutation,
    { timeout: 120000 },
    () => {
      const fixture = focusedTimelineCases.find(
        (c) =>
          c.id ===
          (mutation.startsWith('goodwill') ? 'FS-goodwill-effective' : 'BTX-incident-fixed'),
      )!;
      const { pack, opening, history } = focusedHistory(fixture);
      let invalid = structuredClone(history);
      const index = invalid.findIndex((o) =>
        mutation.startsWith('goodwill')
          ? o.phase === 'protagonist-abilities' &&
            o.type === 'character' &&
            o.data.character === 'b'
          : o.phase === 'incident' && o.type === 'board' && o.data.board === 'shrine',
      );
      assert.ok(index >= 0);
      if (mutation === 'incident-missing-effect') {
        const removed = invalid[index]!;
        assert.equal(removed.simultaneousSize ?? 1, 1);
        invalid.splice(index, 1);
        const sequence = new Map(invalid.map((o, i) => [o.sequence, i + 1]));
        invalid = invalid.map(
          (o, i): Observation => ({
            ...o,
            sequence: i + 1,
            ...(o.simultaneousGroup !== undefined
              ? { simultaneousGroup: sequence.get(o.simultaneousGroup)! }
              : {}),
          }),
        );
      } else if (mutation === 'goodwill-wrong-amount')
        (invalid[index]!.data.counters as Record<string, number>).paranoia = 2;
      else invalid[index]!.data.intrigue = 1;
      const exhaustive = new EnumeratedKnowledge(pack, opening, 10000, true);
      exhaustive.update(invalid, invalid.length);
      assert.equal(
        complete(exhaustive).solutions.length,
        0,
        'corrupt history must have no exhaustive witnesses',
      );
      const original = new LiveKnowledge(pack, opening),
        node = new LiveKnowledge(pack, opening);
      for (const o of invalid) original.append([o], o.sequence - 1, o.sequence);
      node.append(invalid, 0, invalid.length);
      assert.equal(complete(original).solutions.length, 0);
      assert.equal(complete(node).solutions.length, 0);
    },
  );
