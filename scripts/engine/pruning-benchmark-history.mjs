import assert from 'node:assert/strict';
import { cases, casePlayer } from '../../tests/engine/knowledge-fsbtx-cases.ts';
import { compileOfficial } from '../../packages/content/src/official/compile.ts';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.ts';
import {
  LiveKnowledge,
  EnumeratedKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.ts';
import { canonical } from '../../packages/engine/src/runtime/model.ts';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.ts';

function finish(solver) {
  while (!solver.paused) solver.tick(25, Infinity);
  const view = solver.snapshot();
  assert.equal(view.status, 'exact', JSON.stringify(view.reasons));
  assert.ok(view.domainComplete);
  return view;
}

export function jointCases() {
  return cases.flatMap((fixture) => {
    const pack = compileOfficial(fixture.setup.module);
    let state = initializeDiscussion(pack, fixture.setup).state;
    const opening = initialPlacementView(state),
      play = casePlayer(fixture);
    for (let i = 0; i < 70; i++) {
      const d = state.pending;
      const next = advance(pack, state, d.actor, {
        id: 'case-' + i,
        expectedRevision: state.revision,
        decisionId: d.id,
        choice: play(state),
      });
      assert.notEqual(next.status, 'rejected');
      state = next.state;
      if (
        state.winner ||
        state.phase === 'loop-end' ||
        (state.loop > 1 && state.phase === 'discussion')
      )
        break;
    }
    fixture.verify(state);
    const full = project(state, 'protagonists');
    const middle = full.observations.findIndex(
      (o, i) => i >= full.observations.length / 2 && o.type === 'boundary',
    );
    assert.ok(middle > 0 && middle + 1 < full.observations.length);
    return [full.observations.slice(0, middle + 1), full.observations].map((observations) => {
      const history = {
        observations,
        revision:
          observations.length === full.observations.length ? full.revision : observations.length,
      };
      const exhaustive = new EnumeratedKnowledge(pack, opening, 5000, true);
      exhaustive.update(history.observations, history.revision);
      const base = finish(exhaustive);
      const live = new LiveKnowledge(pack, opening);
      live.append(history.observations, 0, history.revision);
      live.verifyCombinations();
      const result = finish(live);
      const key = (s) =>
        canonical({
          ...s,
          x: [...s.x].sort(),
          characters: s.characters.map((c) => ({
            ...c,
            initialArea: c.initialArea ?? pack.characters[c.character].initial[0],
          })),
          incidents: s.incidents.map((e) => ({ ...e, publicName: e.publicName ?? e.name })),
        });
      const expected = new Set();
      let domainSize = 0;
      for (const s of generateDomain(pack, opening))
        if (s) {
          domainSize++;
          const verdict = exhaustive.queryConfiguration(s);
          assert.notEqual(verdict, 'unknown');
          if (verdict === 'possible') expected.add(key(s));
        }
      assert.equal(base.possible, expected.size);
      assert.ok(expected.has(key(fixture.setup)));
      assert.deepEqual(new Set(live.jointSolutions().map(key)), expected, fixture.name);
      console.log(fixture.name, base.expansions, result.expansions);
      return {
        scenario: fixture.name,
        checkpoint: observations === full.observations ? '完整样本' : '中段边界',
        module: pack.module,
        rules: [fixture.setup.y, ...fixture.setup.x],
        observations: history.observations.length,
        domainSize,
        endPhase: observations.at(-1).phase,
        solutions: expected.size,
        exhaustive: base.expansions,
        pruned: result.expansions,
      };
    });
  });
}
