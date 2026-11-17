import type {
  Actor,
  CardKind,
  Choice,
  GameSetup,
  Observation,
} from '../../../contracts/src/game.js';
import { commandSchema } from '../../../contracts/src/validation.js';
import { drive, initialize, initializeDiscussion } from '../runtime/engine.js';
import { canonical, type EngineState, type RulePack } from '../runtime/model.js';
import { cardsAtTargets, enumerateChoices } from '../runtime/replay.js';
import { hasUnsupportedDiagnostic } from '../runtime/setup.js';
import {
  observeQuestion,
  publicQuestion,
  publicSheet,
  submitChoice,
  visibleReport,
} from './position.js';

export type DecisionEvidence = ReturnType<typeof observeQuestion>;
type MarkedCard = { owner: Actor; target: string; kind?: CardKind };
type Reason = 'setup-coverage' | 'work-limit' | 'world-limit' | 'unsupported';
export interface InferredWorlds {
  /** Host-only states with the full correlation between script, cards and private choices. */
  states: EngineState[];
  exhaustive: boolean;
  work: number;
  commands: number;
  reason?: Reason;
}

function placements(o: Observation | undefined): MarkedCard[] | undefined {
  if (o?.type !== 'cards' || !Array.isArray(o.data.placements)) return;
  const cards = o.data.placements;
  if (
    !cards.every(
      (p) =>
        p && ['mastermind', 'p0', 'p1', 'p2'].includes(p.owner) && typeof p.target === 'string',
    )
  )
    throw Error('Invalid observed placements');
  return cards;
}

/** Enumerate every compatible hidden completion within the supplied setup pool. A
 * public observation, including the absence of another report before this prompt,
 * must match on one continuous forward trace. A first witness cannot certify a policy. */
export function inferObservedWorlds(
  pack: RulePack,
  setups: Iterable<GameSetup>,
  exhaustiveSetups: boolean,
  evidence: DecisionEvidence,
  workLimit: number,
  worldLimit: number,
): InferredWorlds {
  if (![workLimit, worldLimit].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw Error('Invalid reconstruction limits');
  if (
    typeof exhaustiveSetups !== 'boolean' ||
    evidence?.version !== 1 ||
    evidence.coverage !== 'complete' ||
    evidence.sheet?.module !== pack.module ||
    evidence.sheet.anniversary !== pack.anniversary ||
    !Array.isArray(evidence.view?.reports) ||
    !['p0', 'p1', 'p2'].includes(evidence.view.menu?.actor) ||
    (evidence.seat !== undefined && evidence.seat !== evidence.view.menu.actor)
  )
    throw Error('Expected a complete protagonist observation for this rule pack');
  const reports = evidence.view.reports;
  const own = new Map<number, { actor: Actor; choice: Choice }>();
  const revealed = new Map<string, MarkedCard[]>();
  let nextOwn: { actor: Actor; choice: Choice } | undefined;
  for (let i = reports.length - 1; i >= 0; i--) {
    const o = reports[i]!;
    if (o.sequence !== i + 1 || !o.data) throw Error('Incomplete observation sequence');
    if (o.type === 'own-choice') {
      const parsed = commandSchema.safeParse({
        id: 'observed',
        expectedRevision: 0,
        decisionId: 'observed',
        choice: o.data.choice,
      });
      if (!parsed.success || !['p0', 'p1', 'p2'].includes(String(o.data.actor)))
        throw Error('Invalid observed choice');
      nextOwn = { actor: o.data.actor as Actor, choice: parsed.data.choice };
    }
    if (nextOwn) own.set(i, nextOwn);
    if (o.phase === 'card-resolution') {
      const shown = placements(o);
      if (shown?.every((p) => p.kind !== undefined)) revealed.set(o.loop + '/' + o.day, shown);
    }
  }
  const reportKeys = reports.map(canonical);
  const view = { ...evidence.view };
  // Early version-1 exports omitted the LL marker summary. Its content is
  // derivable from the complete log. Briefing exports used to show setup pieces.
  if (evidence.sheet.module === 'LL' && !view.markers) {
    const ids = (field: string) =>
      [
        ...new Set(
          reports.flatMap((o) =>
            o.type === 'board' && typeof o.data[field] === 'string'
              ? [o.data[field] as string]
              : [],
          ),
        ),
      ].sort();
    view.markers = { communicated: ids('communicatedMarker'), died: ids('diedMarker') };
  }
  if (view.phase === 'briefing') {
    view.characters = [];
    view.ownCards = [];
    view.territory = undefined;
  }
  const expected = canonical({ ...evidence, view }),
    sheet = canonical(evidence.sheet);

  const states: EngineState[] = [];
  let work = 0,
    commands = 0;
  let reason: Reason | undefined = exhaustiveSetups ? undefined : 'setup-coverage';
  const result = (why = reason): InferredWorlds => ({
    states,
    work,
    commands,
    exhaustive: !why,
    ...(why && { reason: why }),
  });

  function* choices(s: EngineState, cursor: number): Generator<Choice> {
    const d = s.pending!;
    if (d.actor !== 'mastermind') {
      // Some commands publish an announcement before the submitter's confirmation.
      const recorded = own.get(cursor);
      if (recorded?.actor === d.actor) yield recorded.choice;
      return;
    }
    if (d.kind === 'cards') {
      const next = reports[cursor];
      if (next?.phase !== s.phase || next.loop !== s.loop || next.day !== s.day) return;
      const shown = placements(next);
      if (!shown || shown.some((p) => p.owner !== 'mastermind')) return;
      const flipped = revealed.get(s.loop + '/' + s.day);
      yield* cardsAtTargets(s, flipped ?? shown);
      return;
    }
    yield* enumerateChoices(s);
  }

  type Branch = { state: EngineState; cursor: number };
  function* children(s: EngineState, cursor: number): Generator<Branch | 'limit'> {
    for (const choice of choices(s, cursor)) {
      if (work >= workLimit) {
        yield 'limit';
        return;
      }
      work++;
      commands++;
      const next = submitChoice(pack, s, choice);
      if (next.status !== 'rejected') yield { state: next.state, cursor };
    }
  }
  const seenSetups = new Set<string>();
  for (const setup of setups) {
    if (work >= workLimit) return result('work-limit');
    work++;
    if (canonical(publicSheet(setup)) !== sheet) continue;
    if (
      evidence.seat &&
      evidence.view.personalRole &&
      setup.privateRoles?.[evidence.seat] !== evidence.view.personalRole
    )
      continue;
    const key = canonical(setup);
    if (seenSetups.has(key)) continue;
    seenSetups.add(key);
    if (setup.publicSpecialRules?.length) {
      reason = 'unsupported';
      continue;
    }
    const start = evidence.view.phase === 'briefing' ? initialize : initializeDiscussion;
    const init = start(pack, setup, 0);
    if (!init.state) {
      if (hasUnsupportedDiagnostic(init.diagnostics)) reason = 'unsupported';
      continue;
    }
    const stack: Iterator<Branch | 'limit'>[] = [
      [{ state: init.state, cursor: 0 }][Symbol.iterator](),
    ];
    while (stack.length) {
      const it = stack.at(-1)!.next();
      if (it.done) {
        stack.pop();
        continue;
      }
      if (it.value === 'limit') return result('work-limit');
      const s = it.value.state;
      let cursor = it.value.cursor;
      for (;;) {
        const log = s.observations.protagonists;
        while (
          cursor < log.length &&
          cursor < reports.length &&
          canonical(visibleReport(log[cursor]!)) === reportKeys[cursor]
        )
          cursor++;
        if (cursor < log.length) break;
        if (s.diagnostic) {
          reason = 'unsupported';
          break;
        }
        if (s.winner) break;
        if (s.pending) {
          if (cursor === reports.length && s.pending.actor !== 'mastermind') {
            if (
              s.phase === evidence.view.phase &&
              (!evidence.seat || s.pending.actor === evidence.seat) &&
              publicQuestion(s, evidence.seat) === expected
            ) {
              if (states.length === worldLimit) return result('world-limit');
              states.push(s);
            }
            break;
          }
          stack.push(children(s, cursor));
          break;
        }
        if (work >= workLimit) return result('work-limit');
        work++;
        drive(pack, s, 1);
      }
    }
  }
  return result();
}
