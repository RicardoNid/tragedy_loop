import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { GameSetup, Protagonist } from '../../packages/contracts/src/game.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { replay, type RecordedChoice } from '../../packages/engine/src/runtime/replay.js';
import { fixtures } from './official-harness.js';

test('LL culprit guesses from briefing replay across all six private seat assignments', () => {
  const base = fixtures.find((f) => f.id === 'LL-01G')!.setup;
  const pack = compileOfficial('LL');
  const seats: Protagonist[] = ['p0', 'p1', 'p2'];
  for (const c of seats) {
    for (const a of seats.filter((seat) => seat !== c)) {
      const setup: GameSetup = structuredClone(base);
      setup.privateRoles = { p0: 'B', p1: 'B', p2: 'B', [c]: 'C', [a]: 'A' };
      // The C plot has the same quotas as the B plot except for this identity.
      setup.x = ['我才是名侦探', '捏造的秘密'];
      setup.characters.find((person) => person.identity === '网络名流')!.identity = '监视者';
      const opening: RecordedChoice[] = [
        { actor: setup.captain, choice: { kind: 'start' } },
        { actor: setup.captain, choice: { kind: 'request-final-guess' } },
        ...seats.map((actor) => ({
          actor,
          choice: { kind: 'vote-final-guess' as const, agree: true },
        })),
      ];
      const run = (choices: RecordedChoice[]) => {
        const result = replay(pack, { setup, choices });
        assert.equal(result.status, 'replayed');
        return result.state;
      };
      const before = run(opening);
      assert.equal(before.pending?.actor, c);
      assert.equal(project(before, c).decision?.answerKind, 'culprits');
      const answers = Object.fromEntries(setup.incidents.map((i) => [String(i.day), i.culprit]));
      for (const correct of [false, true]) {
        const history: RecordedChoice[] = [
          ...opening,
          {
            actor: c,
            choice: {
              kind: 'guess-culprits',
              answers: correct
                ? answers
                : {
                    ...answers,
                    [setup.incidents[0]!.day]: setup.incidents[1]!.culprit,
                  },
            },
          },
        ];
        const after = run(history);
        if (!correct) {
          assert.equal(after.winner, undefined);
          const actor = after.pending!.actor;
          assert.notEqual(actor, c);
          assert.equal(project(after, actor).decision?.answerKind, 'identities');
          history.push({
            actor,
            choice: { kind: 'guess', character: 'teacher', identity: '平民' },
          });
        }
        const end = run(history);
        assert.equal(end.phase, 'finished');
        assert.equal(end.winner, correct ? c : 'mastermind');
        assert.deepEqual(run(JSON.parse(JSON.stringify(history))), end);
      }
    }
  }
});
