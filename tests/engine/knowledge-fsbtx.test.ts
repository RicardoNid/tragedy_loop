import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import {
  EnumeratedKnowledge,
  LiveKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.js';
import { completeObservationGroups, type GameSetup } from '../../packages/contracts/src/game.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';

import { cases, casePlayer } from './knowledge-fsbtx-cases.js';

function complete(k: EnumeratedKnowledge | LiveKnowledge) {
  if (k instanceof LiveKnowledge && k.historySearchDeferred) k.verifyAll();
  const deadline = Date.now() + 120000;
  while (!k.paused && Date.now() < deadline) k.tick(25, Infinity);
  const result = k.snapshot();
  assert.equal(result.domainComplete, true, JSON.stringify(result.reasons));
  assert.equal(result.status, 'exact', JSON.stringify({ ...result, identities: undefined }));
  return result;
}
for (const fixture of cases)
  test(fixture.name, { timeout: 180000 }, () => {
    const pack = compileOfficial(fixture.setup.module, fixture.setup.anniversary);
    const initialized = initializeDiscussion(pack, fixture.setup);
    assert.ok(initialized.state, JSON.stringify(initialized.diagnostics));
    let state = initialized.state;
    const opening = initialPlacementView(state);
    // Keep the comparison domain explicit and bypass static disclosure pruning.
    const k = new EnumeratedKnowledge(pack, opening, 5000, true);
    const symbolic = new LiveKnowledge(pack, opening);
    symbolic.append(opening.observations, 0, opening.revision);
    let through = opening.observations.length;
    assert.equal(
      symbolic.snapshot().generated,
      0,
      'initial domains do not enumerate complete setups',
    );
    complete(symbolic);
    k.update(opening.observations, opening.revision);
    const initial = complete(k);
    const domain = [...generateDomain(pack, opening)].filter((s): s is GameSetup => !!s);
    const key = (s: GameSetup) =>
      canonical({
        ...s,
        x: [...s.x].sort(),
        characters: s.characters
          .map((c) => ({
            ...c,
            initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        incidents: s.incidents
          .map((i) => ({ ...i, publicName: i.publicName ?? i.name }))
          .sort((a, b) => a.day - b.day),
      });
    let checkpoints = 0;
    let previousSolutions: Set<string> | undefined;
    const compareJoint = () => {
      const result = complete(k);
      symbolic.verifyCombinations();
      const exact = complete(symbolic);
      const expected = new Set(
        domain.filter((s) => k.queryConfiguration(s) === 'possible').map(key),
      );
      assert.equal(
        expected.size,
        result.possible,
        'every oracle witness belongs to a unique full assignment',
      );
      const actual = new Set(symbolic.jointSolutions()!.map(key));
      assert.equal(exact.jointCount, expected.size);
      assert.deepEqual(
        actual,
        expected,
        'full assignments differ at observation ' + symbolic.observationCount,
      );
      if (previousSolutions)
        for (const s of actual) assert.ok(previousSolutions.has(s), 'a removed script returned');
      previousSolutions = actual;
      checkpoints++;
    };
    assert.equal(
      initial.possible,
      [...generateDomain(pack, opening)].filter(Boolean).length,
      'factored initial count must equal explicit complete enumeration',
    );
    const play = casePlayer(fixture);
    for (let step = 0; step < 70; step++) {
      const pending = state.pending!;
      const choice = play(state);
      const next = advance(pack, state, pending.actor, {
        id: `case-${step}`,
        expectedRevision: state.revision,
        decisionId: pending.id,
        choice,
      });
      assert.notEqual(next.status, 'rejected', JSON.stringify({ step, pending, choice }));
      state = next.state;
      const view = project(state, 'protagonists');
      const suffix = view.observations.slice(through);
      for (let i = 0; i < suffix.length; i++) {
        const o = suffix[i]!;
        symbolic.append([o], through + i, view.revision);
        // Compare each partial publication during an actual settlement, including
        // the interval between simultaneous deaths and their later triggers.
        if (
          ['incident', 'day-end', 'protagonist-abilities'].includes(o.phase) &&
          [
            'character',
            'board',
            'declaration',
            'refused',
            'failure',
            'incident',
            'no-effect',
          ].includes(o.type)
        ) {
          k.update(view.observations.slice(0, through + i + 1), view.revision);
          compareJoint();
        }
      }
      k.update(view.observations, view.revision);
      through = view.observations.length;
      symbolic.tick(1, Infinity);
      // Allow ordinary play to advance while the solver retains its work; solve at the checkpoint.
      k.tick(1, Infinity);
      if (
        state.winner ||
        state.phase === 'loop-end' ||
        (state.loop > 1 && state.phase === 'discussion')
      )
        break;
    }
    fixture.verify(state);
    compareJoint();
    const oneShot = new LiveKnowledge(pack, opening);
    const reordered = completeObservationGroups(state.observations.protagonists).flatMap(group =>
      [...group].reverse().map((o, i) => ({ ...o, sequence: group[0]!.sequence + i })));
    oneShot.append(reordered, 0, state.revision);
    oneShot.verifyCombinations();
    complete(oneShot);
    assert.deepEqual(
      new Set(oneShot.jointSolutions()!.map(key)),
      previousSolutions,
      'reversing reports inside simultaneous settlements changed a joint solution',
    );
    const result = complete(k);
    const constrained = complete(symbolic);
    const normalize = (r: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(r).map(([key, values]) => [key, [...values].sort()]));
    assert.deepEqual(
      normalize(constrained.identities),
      normalize(result.identities),
      'symbolic identity projections equal exhaustive historical search',
    );
    assert.deepEqual(normalize(constrained.culprits), normalize(result.culprits));
    assert.deepEqual([...constrained.rules].sort(), [...result.rules].sort());
    assert.equal(symbolic.queryConfiguration(fixture.setup), 'possible');
    assert.equal(
      k.queryConfiguration(fixture.setup),
      'possible',
      'the complete true configuration must have a legal witness',
    );
    assert.ok(result.possible > 0, 'the real legal script must retain an explanation');
    assert.ok(
      result.possible < initial.possible,
      'observed effects must reduce the full constructed domain',
    );
    for (const c of fixture.setup.characters)
      assert.ok(
        result.identities[c.id]?.includes(c.identity),
        `${c.id} lost true initial identity`,
      );
    const fresh = new EnumeratedKnowledge(pack, opening, 0);
    const view = project(state, 'protagonists');
    fresh.update(view.observations, view.revision);
    const reference = complete(fresh);
    assert.equal(result.possible, reference.possible);
    assert.equal(result.excluded, reference.excluded);
    if (fixture.setup.incidents.length) {
      assert.equal(state.phase, 'discussion');
      assert.equal(state.loop, 2);
      const pending = state.pending!;
      const restarted = advance(pack, state, pending.actor, {
        id: 'next-loop',
        expectedRevision: state.revision,
        decisionId: pending.id,
        choice: { kind: 'continue' },
      });
      assert.notEqual(restarted.status, 'rejected');
      const reset = project(restarted.state, 'protagonists');
      assert.ok(reset.characters.every((c) => c.status === 'alive'));
      k.update(reset.observations, reset.revision);
      symbolic.append(reset.observations.slice(through), through, reset.revision);
      const continued = complete(symbolic);
      for (const [id, values] of Object.entries(continued.identities))
        assert.ok(values.every((v) => constrained.identities[id]?.includes(v)));
      assert.equal(symbolic.queryConfiguration(fixture.setup), 'possible');
      const secondLoop = complete(k);
      compareJoint();
      assert.ok(
        secondLoop.possible <= result.possible,
        'resetting the board cannot erase prior knowledge',
      );
      assert.equal(k.queryConfiguration(fixture.setup), 'possible');
    }
    console.log(
      JSON.stringify({
        scenario: fixture.name,
        initial: initial.possible,
        jointCheckpoints: checkpoints,
        remaining: result.possible,
        excluded: result.excluded,
        expansions: result.expansions,
        symbolicExpansions: constrained.expansions,
        symbolicWitnesses: constrained.generated,
      }),
    );
  });
