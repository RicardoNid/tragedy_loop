import type { Choice, Observation } from '../../../contracts/src/game.js';
import { advance, drive } from '../runtime/engine.js';
import { canonical, clone, type EngineState, type RulePack } from '../runtime/model.js';
import { enumerateChoices } from '../runtime/replay.js';

type Clock = Pick<Observation, 'loop' | 'day' | 'phase'>;
/** Patterns match the observation envelope and any supplied top-level data fields.
 * Omitted fields are wildcards. A missing matching public report is the evidence. */
export interface MissingReport {
  type: Observation['type'];
  fields?: Readonly<Record<string, unknown>>;
}
export interface PhaseEvidence {
  start: Clock;
  end: Clock;
  coverage: 'complete' | 'partial' | 'interrupted';
  absent: readonly MissingReport[];
}
export interface PhaseResult {
  status: 'possible' | 'excluded' | 'unknown';
  work: number;
  choices: number;
  reason: string;
  witness?: Choice[];
}
const sameClock = (a: Clock, b: Clock) =>
  a.day === b.day && a.loop === b.loop && a.phase === b.phase;

function* permutations<T>(items: T[]): Generator<T[]> {
  if (!items.length) {
    yield [];
    return;
  }
  for (const [i, item] of items.entries())
    for (const rest of permutations(items.filter((_, j) => i !== j))) yield [item, ...rest];
}
function* actions(pack: RulePack, state: EngineState): Generator<Choice> {
  if (state.pending?.kind === 'guess') {
    if (state.flags['c-guess']) {
      const days = state.setup.incidents.map((i) => String(i.day));
      const ids = Object.keys(state.characters);
      function* answers(i: number, row: Record<string, string>): Generator<Choice> {
        if (i === days.length) {
          yield { kind: 'guess-culprits', answers: { ...row } };
          return;
        }
        for (const id of ids) {
          row[days[i]!] = id;
          yield* answers(i + 1, row);
        }
      }
      yield* answers(0, {});
      return;
    }
    const guessed = new Set<string>(JSON.parse(state.flags.guessed ?? '[]'));
    const roles = Object.keys(pack.identities);
    for (const c of Object.values(state.characters))
      if (c.status !== 'absent' && !guessed.has(c.id))
        for (const identity of roles)
          for (const reverseIdentity of [undefined, ...roles])
            yield { kind: 'guess', character: c.id, identity, reverseIdentity };
    return;
  }
  for (const c of enumerateChoices(state)) {
    if (c.kind !== 'cards') yield c;
    else for (const placements of permutations(c.placements)) yield { kind: 'cards', placements };
  }
}

/** Trusted-host phase verifier. All mandatory frames, static traits, incidents,
 * replacements, delayed tasks and optional decisions go through the execution engine.
 * One concrete hidden state per call. An assignment is excluded only if all its
 * possible hidden completions are excluded. */
export function verifyAbsencePhase(
  pack: RulePack,
  root: EngineState,
  evidence: PhaseEvidence,
  limit: number,
): PhaseResult {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid work limit');
  if (
    !sameClock(root, evidence.start) ||
    root.ruleDigest !== pack.digest ||
    sameClock(evidence.start, evidence.end)
  )
    throw Error('Wrong phase window or rule pack');
  let work = 0,
    choices = 0;
  const result = (status: PhaseResult['status'], reason: string): PhaseResult => ({
    status,
    reason,
    work,
    choices,
  });
  if (evidence.coverage !== 'complete' || root.setup.publicSpecialRules?.length)
    return result('unknown', 'open-window-or-special-rule');
  const selected = [
    ...Object.values(root.characters).flatMap((c) => [
      pack.characters[c.character],
      pack.identities[c.identity],
    ]),
    ...[root.setup.y, ...root.setup.x, root.setup.alternateY]
      .filter(Boolean)
      .map((n) => pack.plots[n!]),
    ...root.setup.incidents.map((i) => pack.incidents[i.name]),
  ];
  if (selected.some((d) => !d?.supported)) return result('unknown', 'untranslated-rule');
  // Index observations by type. Unrelated public changes do not invalidate silence.
  const byType = new Map<Observation['type'], MissingReport[]>();
  for (const p of evidence.absent) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
  type Branch = { state: EngineState; cursor: number; trace: Choice[] };
  function* children(b: Branch): Generator<Branch> {
    const d = b.state.pending!;
    for (const choice of actions(pack, b.state)) {
      if (work >= limit) {
        unresolved = 'budget';
        return;
      }
      work++;
      choices++;
      let id = 'absence-' + b.state.revision;
      while (Object.hasOwn(b.state.receipts, id)) id += '-';
      const next = advance(
        pack,
        b.state,
        d.actor,
        { id, expectedRevision: b.state.revision, decisionId: d.id, choice },
        0,
      );
      if (next.status === 'rejected') {
        unresolved = 'unresolved-choice';
        continue;
      }
      yield { state: next.state, cursor: b.cursor, trace: [...b.trace, choice] };
    }
  }
  let unresolved = '';
  const stack: Iterator<Branch>[] = [
    [{ state: clone(root), cursor: root.observations.public.length, trace: [] }][Symbol.iterator](),
  ];
  while (stack.length) {
    const item = stack.at(-1)!.next();
    if (item.done) {
      stack.pop();
      continue;
    }
    const b = item.value;
    while (true) {
      const reports = b.state.observations.public;
      let conflict = false;
      for (; b.cursor < reports.length; b.cursor++) {
        const o = reports[b.cursor]!;
        if (o.type === 'boundary' && !sameClock(o, evidence.start)) {
          if (sameClock(o, evidence.end))
            return { ...result('possible', 'closed-witness'), witness: b.trace };
          conflict = true;
          break;
        }
        if (
          byType
            .get(o.type)
            ?.some((p) =>
              Object.entries(p.fields ?? {}).every(
                ([k, v]) => Object.hasOwn(o.data, k) && canonical(o.data[k]) === canonical(v),
              ),
            )
        ) {
          conflict = true;
          break;
        }
      }
      if (conflict || b.state.winner) break;
      if (b.state.diagnostic) {
        unresolved = 'engine-diagnostic';
        break;
      }
      if (work >= limit) return result('unknown', 'budget');
      if (b.state.pending) {
        stack.push(children(b));
        break;
      }
      // Move one interpreter tick, preserving simultaneous settlements and their observations.
      work++;
      drive(pack, b.state, 1);
    }
  }
  return unresolved
    ? result('unknown', unresolved)
    : result('excluded', 'all-completions-conflict');
}
