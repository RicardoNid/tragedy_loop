import assert from 'node:assert/strict';
import test from 'node:test';
import fixtures from './fixtures/official-scenarios.json' with { type: 'json' };
import type { Actor, Choice, GameSetup, Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, drive, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.js';
import { observeDayEnd } from '../../packages/engine/src/absence/day-end-history.js';
import { buildAbsenceSpace, absenceSolutions } from '../../packages/engine/src/absence/index.js';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';

for (const { id, setup } of fixtures as unknown as { id: string; setup: GameSetup }[]) {
  test(id + ' 从合法开局运行首轮，逐阶段复核缺席证据保留真实剧本', () => {
    const pack = compileOfficial(setup.module, setup.anniversary);
    const init = initializeDiscussion(pack, setup, 0);
    assert.ok(init.state, JSON.stringify(init.diagnostics));
    let state = init.state,
      root = clone(state),
      seed = 1709,
      windows = 0;
    const decisions: { actor: Actor; choice: Choice }[] = [];
    const types: Observation['type'][] = [
      'character',
      'failure',
      'identity',
      'board',
      'incident',
      'declaration',
      'refused',
      'rule',
      'culprit',
      'card-grant',
      'no-effect',
    ];
    for (
      let i = 0;
      i < 4000 && state.loop === 1 && !state.winner && state.phase !== 'final-guess';
      i++
    ) {
      if (!state.pending) drive(pack, state, 1);
      else {
        const d = state.pending;
        // Drive real actor ports with a deterministic, short prefix of legal options.
        const choices: Choice[] = [];
        for (const c of enumerateChoices(state)) {
          choices.push(c);
          if (choices.length === 4) break;
        }
        const pass = choices.find((c) => c.kind === 'pass' || c.kind === 'continue');
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const choice = pass ?? choices[seed % choices.length];
        assert.ok(choice, id + '/' + state.phase);
        decisions.push({ actor: d.actor, choice });
        const next = advance(
          pack,
          state,
          d.actor,
          { id: 'seed-1709-' + i, decisionId: d.id, expectedRevision: state.revision, choice },
          0,
        );
        assert.notEqual(next.status, 'rejected');
        state = next.state;
      }
      assert.equal(state.diagnostic, undefined);
      if (state.phase === root.phase && state.day === root.day && state.loop === root.loop)
        continue;
      const cursor = root.observations.public.length;
      const events = state.observations.public.slice(cursor);
      const stop = events.findIndex(
        (o) =>
          o.type === 'boundary' &&
          (o.phase !== root.phase || o.loop !== root.loop || o.day !== root.day),
      );
      assert.ok(stop >= 0, id + '/boundary');
      const closed = events[stop]!,
        during = events.slice(0, stop);
      const absent = types
        .filter((type) => !during.some((o) => o.type === type))
        .map((type) => ({ type }));
      const evidence = {
        start: root,
        end: closed,
        coverage: 'complete' as const,
        absent,
        decisions,
      };
      const actual = verifyAbsencePhase(pack, root, evidence, 1000);
      assert.equal(actual.status, 'possible', id + '/' + root.phase + '/' + actual.reason);
      if (during.length) {
        const occurred = during.find((o) => o.type !== 'boundary');
        if (occurred)
          assert.equal(
            verifyAbsencePhase(
              pack,
              root,
              { ...evidence, absent: [{ type: occurred.type, fields: occurred.data }] },
              1000,
            ).status,
            'excluded',
            id + '/' + root.phase,
          );
      }
      if (root.phase === 'day-end' && cursor > 0) {
        const entry = { ...root, ...setup, characters: Object.values(root.characters) };
        const w = observeDayEnd(entry, [root.observations.public[cursor - 1]!, ...during, closed]);
        const truth = Object.fromEntries(entry.characters.map((c) => [c.id, [c.identity]]));
        assert.equal([...absenceSolutions(buildAbsenceSpace(pack, w, truth))].length, 1);
      }
      root = clone(state);
      decisions.length = 0;
      windows++;
    }
    assert.ok(
      windows >= 5 && (state.loop > 1 || state.winner || state.phase === 'final-guess'),
      id + '/complete first loop',
    );
  });
}
