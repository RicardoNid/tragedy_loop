import type { Actor, Choice, Observation } from '../../../contracts/src/game.js';
import { advance, drive } from '../runtime/engine.js';
import { clone, type EngineState, type RulePack } from '../runtime/model.js';
import { cardsAtTargets, enumerateChoices } from '../runtime/replay.js';

import {
  compileOutcomes,
  type MissingReport,
  type OutcomeRule,
  type ShownCard,
} from './outcomes.js';
export type { MissingReport, OutcomeRule } from './outcomes.js';
type Clock = Pick<Observation, 'loop' | 'day' | 'phase'>;
export interface PhaseEvidence {
  start: Clock;
  end: Clock;
  coverage: 'complete' | 'partial' | 'interrupted';
  absent: readonly MissingReport[];
  rules?: readonly OutcomeRule[];
  /** Optional fully known decision stream for this phase (e.g. an offline replay). */
  decisions?: readonly { actor: Actor; choice: Choice }[];
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

function* actions(
  pack: RulePack,
  state: EngineState,
  shown?: readonly ShownCard[],
): Generator<Choice> {
  if (shown && state.pending?.kind === 'cards') {
    yield* cardsAtTargets(state, shown);
    return;
  }
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
  // applyChoice canonicalizes target order before publication and play. A known
  // private command is still replayed verbatim; unknown order has one representative.
  yield* enumerateChoices(state);
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
  return verifyAbsenceHistory(pack, root, [evidence], limit);
}

export function verifyAbsenceHistory(
  pack: RulePack,
  root: EngineState,
  stages: readonly PhaseEvidence[],
  limit: number,
): PhaseResult {
  return prepareAbsenceHistory(pack, stages)(root, limit);
}

/** Compile each observation index once for the entire candidate space. */
export function prepareAbsenceHistory(pack: RulePack, stages: readonly PhaseEvidence[]) {
  if (
    !stages.length ||
    stages.some(
      (e, i) => sameClock(e.start, e.end) || (i > 0 && !sameClock(e.start, stages[i - 1]!.end)),
    )
  )
    throw Error('Wrong phase window or rule pack');
  const open = stages.some((e) => e.coverage !== 'complete');
  const traceOutcomes = stages.some((e) =>
    e.rules?.some((r) => r.kind === 'no-death' || r.kind === 'ability-completed'),
  );
  const compiled = stages.map((e) => compileOutcomes(e.absent, e.rules ?? []));
  const cardHints = stages.map((stage, i) => {
    const offset =
      stage.start.phase === 'mastermind-cards'
        ? 2
        : stage.start.phase === 'protagonist-cards'
          ? 1
          : 0;
    const reveal = stages[i + offset];
    if (
      !offset ||
      !reveal ||
      reveal.start.phase !== 'card-resolution' ||
      reveal.start.day !== stage.start.day ||
      reveal.start.loop !== stage.start.loop ||
      (offset === 2 && stages[i + 1]?.start.phase !== 'protagonist-cards')
    )
      return;
    return reveal.rules?.find((r) => r.kind === 'cards')?.placements;
  });
  return function verify(root: EngineState, limit: number): PhaseResult {
    if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid work limit');
    if (!sameClock(root, stages[0]!.start) || root.ruleDigest !== pack.digest)
      throw Error('Wrong phase window or rule pack');
    let work = 0,
      choices = 0;
    const result = (status: PhaseResult['status'], reason: string): PhaseResult => ({
      status,
      reason,
      work,
      choices,
    });
    if (open || root.setup.publicSpecialRules?.length)
      return result('unknown', 'open-window-or-special-rule');
    const selected = [
      ...Object.values(root.characters).flatMap((c) => [
        pack.characters[c.character],
        pack.identities[c.identity],
      ]),
      ...root.setup.characters.flatMap((c) =>
        [c.identity, c.reverseIdentity]
          .filter((r): r is string => !!r)
          .map((r) => pack.identities[r]),
      ),
      ...[root.setup.y, ...root.setup.x, root.setup.alternateY]
        .filter(Boolean)
        .map((n) => pack.plots[n!]),
      ...root.setup.incidents.map((i) => pack.incidents[i.name]),
    ];
    if (selected.some((d) => !d?.supported)) return result('unknown', 'untranslated-rule');
    if (stages.some((stage, i) => !compiled[i]!.admits(root, stage.start.phase, stage.start.day)))
      return result('excluded', 'incompatible-schedule');
    type Branch = {
      state: EngineState;
      cursor: number;
      trace: Choice[];
      stage: number;
      decisionStart: number;
      auditStart: number;
      counts: number[];
    };
    function* children(b: Branch): Generator<Branch> {
      const d = b.state.pending!;
      const evidence = stages[b.stage]!;
      const known = evidence.decisions?.[b.trace.length - b.decisionStart];
      if (evidence.decisions && known?.actor !== d.actor) return;
      for (const choice of known ? [known.choice] : actions(pack, b.state, cardHints[b.stage])) {
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
          if (!known) unresolved = 'unresolved-choice';
          continue;
        }
        yield { ...b, counts: [...b.counts], state: next.state, trace: [...b.trace, choice] };
      }
    }
    let unresolved = '';
    const initial = clone(root);
    if (traceOutcomes) initial.traceOutcomes = true;
    const stack: Iterator<Branch>[] = [
      [
        {
          state: initial,
          cursor: root.observations.public.length,
          trace: [],
          stage: 0,
          decisionStart: 0,
          auditStart: root.audit.length,
          counts: compiled[0]!.initial(),
        },
      ][Symbol.iterator](),
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
          const evidence = stages[b.stage]!;
          const current = compiled[b.stage]!;
          if (o.type === 'boundary' && !sameClock(o, evidence.start)) {
            if (
              !sameClock(o, evidence.end) ||
              (evidence.decisions &&
                b.trace.length - b.decisionStart !== evidence.decisions.length) ||
              !current.closed(b.state, b.auditStart, b.counts)
            ) {
              conflict = true;
              break;
            }
            if (++b.stage === stages.length)
              return { ...result('possible', 'closed-witness'), witness: b.trace };
            b.counts = compiled[b.stage]!.initial();
            b.auditStart = b.state.audit.length;
            b.decisionStart = b.trace.length;
            continue;
          }
          if (!current.accept(o, b.counts)) {
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
  };
}
