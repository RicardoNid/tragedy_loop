import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fixtures from './fixtures/official-scenarios.json' with { type: 'json' };
import type { Actor, Choice, GameSetup, Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import {
  advance,
  cardCount,
  drive,
  initializeDiscussion,
  legalCardTargets,
} from '../../packages/engine/src/runtime/engine.js';
import { clone, type EngineState } from '../../packages/engine/src/runtime/model.js';
import { observeDayEnd } from '../../packages/engine/src/absence/day-end-history.js';
import { buildAbsenceSpace, absenceSolutions } from '../../packages/engine/src/absence/index.js';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';
import { DayEndIntersection } from '../../packages/engine/src/decision/day-end-intersection.js';
import {
  IncidentEvidence,
  incidentEvidence,
} from '../../packages/engine/src/decision/incident-evidence.js';

let totalWindows = 0,
  multipleLoops = 0,
  games = 0,
  dayEndWindows = 0,
  applicableBatches = 0,
  incidentWindows = 0;
after(() =>
  console.log(
    `games=${games} multipleLoops=${multipleLoops} closedPhases=${totalWindows} dayEndWindows=${dayEndWindows} applicableBatches=${applicableBatches} incidentWindows=${incidentWindows}`,
  ),
);
function finalGuess(s: EngineState): Choice {
  if (s.flags['c-guess'])
    return {
      kind: 'guess-culprits',
      answers: Object.fromEntries(s.setup.incidents.map((i) => [String(i.day), i.culprit])),
    };
  const guessed: string[] = JSON.parse(s.flags.guessed ?? '[]');
  const c = Object.values(s.characters).find(
    (c) => c.status !== 'absent' && !guessed.includes(c.id),
  )!;
  return {
    kind: 'guess',
    character: c.id,
    identity: c.initialIdentity,
    reverseIdentity: s.setup.characters.find((p) => p.id === c.id)?.reverseIdentity,
  };
}
for (const { id, setup } of fixtures as unknown as { id: string; setup: GameSetup }[]) {
  for (const initialSeed of [
    1709, 2039, 2441, 3253, 4027, 5107, 6421, 7919, 8731, 9341, 10243, 12269,
  ])
    test(id + '/' + initialSeed + ' 合法开局逐阶段核验', () => {
      const pack = compileOfficial(setup.module, setup.anniversary);
      const init = initializeDiscussion(pack, setup, 0);
      assert.ok(init.state, JSON.stringify(init.diagnostics));
      let state = init.state,
        root = clone(state),
        seed = initialSeed,
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
      for (let i = 0; i < 16000 && !state.winner; i++) {
        if (!state.pending) drive(pack, state, 1);
        else {
          const d = state.pending;
          const draw = (n: number) => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return Math.floor((seed / 4294967296) * n);
          };
          let choice: Choice | undefined;
          if (d.kind === 'cards') {
            const hand = state.cards.filter((c) => c.owner === d.actor && c.status === 'hand');
            const targets = legalCardTargets(state, d.actor);
            const placements = Array.from({ length: cardCount(state, d.actor) }, () => ({
              card: hand.splice(draw(hand.length), 1)[0]!.id,
              target: targets.splice(draw(targets.length), 1)[0]!,
            }));
            choice = { kind: 'cards', placements };
          } else if (d.kind === 'guess') choice = finalGuess(state);
          else {
            const pass = d.options.find((c) => c.kind === 'continue' || c.kind === 'pass');
            choice =
              (d.kind === 'continue' || draw(3) === 0 ? pass : undefined) ??
              d.options[draw(d.options.length)];
          }
          assert.ok(choice, id + '/' + state.phase);
          decisions.push({ actor: d.actor, choice });
          const next = advance(
            pack,
            state,
            d.actor,
            {
              id: 'seed-' + initialSeed + '-' + i,
              decisionId: d.id,
              expectedRevision: state.revision,
              choice,
            },
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
          rules: state.winner ? [{ kind: 'winner' as const, winner: state.winner }] : [],
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
          const batch = clone(root);
          drive(pack, batch, 1);
          const intersection = new DayEndIntersection(pack, state.observations.protagonists);
          assert.equal(
            intersection.excludes(batch, batch.observations.protagonists.length),
            false,
            id + '/must retain actual history',
          );
          dayEndWindows++;
          applicableBatches += intersection.stats.checked;
          const entry = { ...root, ...setup, characters: Object.values(root.characters) };
          const w = observeDayEnd(entry, [
            root.observations.public[cursor - 1]!,
            ...during,
            closed,
          ]);
          const truth = Object.fromEntries(entry.characters.map((c) => [c.id, [c.identity]]));
          assert.equal([...absenceSolutions(buildAbsenceSpace(pack, w, truth))].length, 1);
        }
        root = clone(state);
        decisions.length = 0;
        windows++;
      }
      assert.ok(windows >= 5 && state.winner, id + '/finished campaign');
      const observations = incidentEvidence(
        state.observations.protagonists,
        setup.incidents.map((i) => ({ day: i.day, name: i.publicName ?? i.name })),
      );
      const evidence = new IncidentEvidence(observations);
      for (const i of setup.incidents)
        assert.ok(evidence.allows(pack, setup.characters, i), id + '/' + i.day + '/real incident');
      incidentWindows += observations.length;
      games++;
      totalWindows += windows;
      multipleLoops += Number(state.loop > 1);
    });
}
