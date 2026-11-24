import assert from 'node:assert/strict';
import type {
  Choice,
  GameSetup,
  Observation,
  PlayerView,
} from '../../packages/contracts/src/game.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import {
  canonical,
  type EngineState,
  type RulePack,
} from '../../packages/engine/src/runtime/model.js';
import { enumerateChoices, type RecordedChoice } from '../../packages/engine/src/runtime/replay.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';

/** Finite domain: FS/BTX/MC/MZ, ordinary always-present characters, no anniversary.
 * Deliberately uses a Cartesian product and the trusted engine validator, with no
 * solver allocation, quota, candidate-generation or inference functions.
 */
export function independentCandidates(pack: RulePack, opening: PlayerView): GameSetup[] {
  assert.ok(['FS', 'BTX', 'MC', 'MZ'].includes(pack.module));
  assert.ok(Object.values(pack.plots).every((plot) => plot.supported && !plot.pair));
  assert.equal(opening.anniversary, false);
  const roster = opening.characters;
  assert.equal(opening.roster?.length ?? roster.length, roster.length);
  assert.ok(
    roster.every(
      (c) => !['局外人', '模仿犯', '仙人', '转校生', '神灵', '大人物'].includes(c.character),
    ),
  );
  assert.ok(roster.every((c) => c.status === 'alive'));
  const ys = Object.values(pack.plots).filter((p) => p.type === 'Y');
  const xs = Object.values(pack.plots).filter((p) => p.type === 'X');
  const xSets =
    pack.setupRules.xSlots === 1
      ? xs.map((x) => [x.name])
      : xs.flatMap((x, i) => xs.slice(i + 1).map((z) => [x.name, z.name]));
  const identities = Object.keys(pack.identities);
  const candidates: GameSetup[] = [];
  const setup: GameSetup = {
    module: opening.module,
    anniversary: false,
    loops: opening.loops,
    days: opening.days,
    captain: opening.captain,
    discussion: 'allowed',
    y: '',
    x: [],
    characters: roster.map((c) => ({
      id: c.id,
      character: c.character,
      initialArea: c.area,
      identity: '平民',
    })),
    incidents: [],
  };
  function incidents(index: number) {
    if (index === opening.incidents.length) {
      if (!validateSetup(pack, setup).length) candidates.push(structuredClone(setup));
      return;
    }
    const event = opening.incidents[index]!;
    // Publicly disguised event support is delegated to the engine validator.
    for (const name of Object.keys(pack.incidents))
      for (const culprit of [...roster.map((c) => c.id), 'hospital', 'shrine', 'city', 'school']) {
        setup.incidents[index] = { day: event.day, name, publicName: event.name, culprit };
        incidents(index + 1);
      }
  }
  function assign(index: number) {
    if (index === setup.characters.length) {
      setup.incidents = [];
      // The trusted validator checks the full role assignment first. Only its
      // missing-event diagnostics can be resolved by the event product below.
      if (
        validateSetup(pack, setup).some(
          (d) => !['required-culprit', 'required-incident'].includes(d.code),
        )
      )
        return;
      incidents(0);
      return;
    }
    for (const identity of identities) {
      setup.characters[index]!.identity = identity;
      assign(index + 1);
    }
  }
  for (const y of ys)
    for (const x of xSets) {
      setup.y = y.name;
      setup.x = x;
      assign(0);
    }
  return candidates;
}

export function candidateKey(setup: GameSetup): string {
  return canonical({
    y: setup.y,
    x: [...setup.x].sort(),
    characters: setup.characters.map((c) => [c.id, c.identity]).sort(),
    incidents: setup.incidents.map((e) => [e.day, e.name, e.culprit]).sort(),
  });
}

/** Independent wire comparison for current, framed engine output.
 * No solver normalization or semantic matcher is used. Group boundaries and
 * multiplicity are preserved; order inside one simultaneous group is immaterial.
 */
export function publicGroups(history: Observation[]): string[] {
  const groups: string[] = [];
  for (let offset = 0; offset < history.length; ) {
    const first = history[offset]!;
    const size = first.simultaneousSize ?? 1;
    if (offset + size > history.length) break;
    const rows = history.slice(offset, offset + size);
    if (size > 1)
      assert.ok(
        rows.every((o) => o.simultaneousGroup === first.sequence && o.simultaneousSize === size),
      );
    groups.push(
      canonical(
        rows
          .map(
            ({ sequence: _sequence, simultaneousGroup: _group, simultaneousSize: _size, ...row }) =>
              canonical(row),
          )
          .sort(),
      ),
    );
    offset += size;
  }
  return groups;
}

function* compatibleChoices(state: EngineState, evidence: Observation[]): Generator<Choice> {
  const pending = state.pending!;
  const suffix = evidence.slice(state.observations.protagonists.length);
  if (pending.actor !== 'mastermind') {
    const known = suffix.find((o) => o.type === 'own-choice');
    if (known) {
      if (known.data.actor === pending.actor) yield known.data.choice as Choice;
      return;
    }
  }
  if (pending.kind === 'cards' && pending.actor === 'mastermind') {
    const cardReports = suffix.filter(
      (o) => o.type === 'cards' && o.loop === state.loop && o.day === state.day,
    );
    const revealed = cardReports.find((o) => o.phase === 'card-resolution');
    type Placement = { owner: string; target: string; card?: string; kind?: string };
    const faces = (revealed?.data.placements ?? []) as Placement[];
    const report = cardReports.find((o) =>
      (o.data.placements as Placement[]).every((p) => p.owner === 'mastermind'),
    );
    if (report) {
      const targets = (report.data.placements as Placement[]).map((p) => p.target);
      const hand = state.cards.filter((c) => c.owner === 'mastermind' && c.status === 'hand');
      function* place(
        index: number,
        placements: { card: string; target: string }[],
      ): Generator<Choice> {
        if (index === targets.length) {
          yield { kind: 'cards', placements };
          return;
        }
        const target = targets[index]!;
        const face = faces.find((p) => p.owner === 'mastermind' && p.target === target);
        for (const card of hand) {
          if (placements.some((p) => p.card === card.id)) continue;
          if (face?.card && face.card !== card.id) continue;
          if (face?.kind && face.kind !== card.kind) continue;
          yield* place(index + 1, [...placements, { card: card.id, target }]);
        }
      }
      yield* place(0, []);
      return;
    }
  }
  yield* enumerateChoices(state);
}

export interface OracleResult {
  verdict: 'possible' | 'excluded' | 'unknown';
  expansions: number;
  witness?: RecordedChoice[];
}

export function engineOracle(
  pack: RulePack,
  setup: GameSetup,
  evidence: Observation[],
  budget = 20000,
  milliseconds = 3000,
): OracleResult {
  const start = initializeDiscussion(pack, setup, 10000);
  assert.ok(start.state, JSON.stringify(start.diagnostics));
  const expected = publicGroups(evidence);
  const deadline = performance.now() + milliseconds;
  let expansions = 0;
  let incomplete = false;
  type Node = { state: EngineState; trace: RecordedChoice[]; iterator?: Generator<Choice> };
  const stack: Node[] = [{ state: start.state, trace: [] }];
  while (stack.length) {
    if (expansions >= budget || performance.now() >= deadline)
      return { verdict: 'unknown', expansions };
    const node = stack.at(-1)!;
    if (!node.iterator) {
      const actual = publicGroups(node.state.observations.protagonists);
      if (actual.slice(0, expected.length).some((value, i) => value !== expected[i])) {
        stack.pop();
        continue;
      }
      if (actual.length >= expected.length)
        return { verdict: 'possible', expansions, witness: node.trace };
      if (node.state.winner) {
        stack.pop();
        continue;
      }
      if (!node.state.pending || node.trace.length >= 250) {
        incomplete = true;
        stack.pop();
        continue;
      }
      if (
        node.state.pending.kind === 'guess' &&
        !evidence
          .slice(node.state.observations.protagonists.length)
          .some((o) => o.type === 'own-choice')
      )
        incomplete = true;
      node.iterator = compatibleChoices(node.state, evidence);
    }
    const nextChoice = node.iterator.next();
    if (nextChoice.done) {
      stack.pop();
      continue;
    }
    const actor = node.state.pending!.actor;
    const choice = nextChoice.value;
    const next = advance(
      pack,
      node.state,
      actor,
      {
        id: 'oracle-' + node.trace.length,
        expectedRevision: node.state.revision,
        decisionId: node.state.pending!.id,
        choice,
      },
      10000,
    );
    expansions++;
    // Recorded protagonist actions can be illegal under another candidate.
    if (next.status === 'rejected') continue;
    if (next.status === 'paused') {
      incomplete = true;
      continue;
    }
    stack.push({ state: next.state, trace: [...node.trace, { actor, choice }] });
  }
  return { verdict: incomplete ? 'unknown' : 'excluded', expansions };
}
