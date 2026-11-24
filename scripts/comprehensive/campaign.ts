import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import {
  advance,
  initialize,
  resume,
} from '../../packages/engine/src/runtime/engine.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { replay, type RecordedChoice } from '../../packages/engine/src/runtime/replay.js';
import { fixtures, observers } from '../../tests/engine/official-harness.js';

// Uniform draws without replacement, including character targets and once-per-loop cards.
import { generator, choose } from './random-choices.js';
const count = Number(process.argv[2] ?? 12);
const first = Number(process.argv[3] ?? 1);
assert.ok(
  Number.isSafeInteger(count) &&
    count > 0 &&
    Number.isSafeInteger(first) &&
    first >= 0 &&
    first + count <= 2 ** 32,
  'usage: campaign.ts [seed count] [first seed]',
);
const totals = { games: 0, decisions: 0, resumes: 0 };
const decisions = new Map<string, number>();
const actions: Record<string, number> = {};
const winners: Record<string, number> = {};
const abilities = new Set<string>();
const incidents = new Set<string>();
const failures: string[] = [];
const wire = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s));
function run(setup: GameSetup, seed: number) {
  const pack = compileOfficial(setup.module, setup.anniversary);
  const initial = initialize(pack, setup);
  assert.deepEqual(initial.diagnostics, []);
  let live = initial.state!;
  let restored = wire(live);
  const history: RecordedChoice[] = [];
  const draw = generator(seed);
  while (!live.winner) {
    const p = live.pending;
    const where = `step=${history.length} loop=${live.loop} day=${live.day} ${live.phase}/${p?.kind}`;
    assert.ok(p && history.length < 1500, where + ' stalled');
    const choice = choose(live, draw);
    const command = {
      id: 'replay-' + history.length,
      expectedRevision: live.revision,
      decisionId: p.id,
      choice,
    };
    history.push({ actor: p.actor, choice });
    const direct = advance(pack, live, p.actor, command);
    assert.equal(
      direct.status,
      'ok',
      where + ' ' + JSON.stringify(choice) + ' ' + (direct.reason ?? direct.state.diagnostic),
    );
    let other = advance(pack, restored, p.actor, command, 1);
    for (let n = 0; other.status === 'paused'; n++) {
      assert.ok(n < 1000, where + ' resume limit');
      other = resume(pack, wire(other.state), 7);
      totals.resumes++;
    }
    assert.equal(other.status, 'ok', where);
    live = direct.state;
    restored = wire(other.state);
    const persisted = wire(live);
    assert.deepEqual(persisted.observations, restored.observations, where + ' announcement replay diverged');
    assert.ok(isDeepStrictEqual(persisted, restored), where + ' persisted state diverged');
    for (const observer of observers) {
      assert.ok(
        JSON.stringify(project(live, observer)) === JSON.stringify(project(restored, observer)),
        where + ' view ' + observer,
      );
    }
    decisions.set(p.kind, (decisions.get(p.kind) ?? 0) + 1);
    const action = choice.kind === 'refuse' ? 'refuse:' + choice.refuse
      : choice.kind === 'vote-final-guess' ? 'vote-final-guess:' + choice.agree : choice.kind;
    actions[action] = (actions[action] ?? 0) + 1;
    if (choice.kind === 'ability') abilities.add(choice.ability);
    totals.decisions++;
  }
  assert.equal(live.phase, 'finished');
  const again = replay(pack, { setup, choices: history, expectedObservations: live.observations });
  assert.equal(again.status, 'replayed');
  assert.ok(isDeepStrictEqual(again.state, live), 'public replay differs at terminal state');
  winners[live.winner] = (winners[live.winner] ?? 0) + 1;
  for (const incident of live.incidents) incidents.add(incident.name);
  totals.games++;
}
for (const f of fixtures) {
  for (const anniversary of [false, true]) {
    if (anniversary && ['AHR', 'LL'].includes(f.setup.module)) continue;
    const setup = structuredClone(f.setup);
    if (anniversary) {
      setup.anniversary = true;
      if (!setup.characters.some((c) => c.identity === '平民'))
        setup.characters.push({ id: 'extraCivilian', character: '女学生', identity: '平民' });
      setup.anniversaryFragment = setup.characters.find((c) => c.identity === '平民')!.id;
    }
    for (let seed = first; seed < first + count; seed++) {
      try {
        run(setup, seed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `${f.id}${anniversary ? '+' : ''} seed=${seed} ${detail}`;
        failures.push(message);
        console.error(message);
      }
    }
    console.log(f.id, { anniversary, ...totals, failures: failures.length });
  }
}
console.log(
  JSON.stringify(
    { first, count, ...totals, decisionsByKind: Object.fromEntries(decisions), actions, winners,
      abilities: [...abilities].sort(), incidents: [...incidents].sort(), failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
