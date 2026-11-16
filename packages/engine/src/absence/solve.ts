import { BOARDS, COUNTERS, type EngineState, type RulePack } from '../runtime/model.js';
import { buildAbsenceSpace, type AbsenceWindow } from './index.js';
import { propagateSolutions, type SearchCounts } from './propagation.js';
import { prepareAbsenceHistory, type PhaseEvidence, type OutcomeRule } from './phase-search.js';

export interface HiddenCompletions {
  /** Complete only when the supplied possibilities exhaust this row's hidden state. */
  exhaustive: boolean;
  states: Iterable<EngineState>;
}
export interface SearchOptions {
  evidence: PhaseEvidence;
  /** Contiguous later phases on the same hidden history. */
  following?: readonly PhaseEvidence[];
  worlds: (identities: Readonly<Record<string, string>>) => HiddenCompletions;
  workPerRow: number;
}
export interface AssignmentResult {
  identities: Record<string, string>;
  status: 'possible' | 'unknown' | 'excluded';
  work: number;
}

function matchesEntry(entry: AbsenceWindow['entry'], s: EngineState): boolean {
  return (
    s.setup.module === entry.module &&
    s.setup.anniversary === entry.anniversary &&
    s.setup.days === entry.days &&
    s.setup.loops === entry.loops &&
    (entry.ex === undefined || entry.ex === s.ex) &&
    BOARDS.every((b) => s.boards[b] === entry.boards[b]) &&
    Object.keys(s.characters).length === entry.characters.length &&
    entry.characters.every((p) => {
      const c = s.characters[p.id];
      return (
        c &&
        c.character === p.character &&
        c.area === p.area &&
        c.status === p.status &&
        COUNTERS.every((k) => c.counters[k] === p.counters[k])
      );
    })
  );
}

/** Streaming join between symbolic local constraints and concrete hidden completions.
 * Both windows must refer to the same instant, with effective identities at entry. */
export function* solveAbsence(
  pack: RulePack,
  window: AbsenceWindow,
  candidates: Readonly<Record<string, readonly string[]>>,
  options: SearchOptions,
  stats?: SearchCounts,
): Generator<AssignmentResult> {
  const { evidence, workPerRow } = options;
  if (!Number.isSafeInteger(workPerRow) || workPerRow < 0) throw Error('Invalid per-row budget');
  if (
    window.entry.phase !== evidence.start.phase ||
    window.entry.loop !== evidence.start.loop ||
    window.entry.day !== evidence.start.day
  )
    throw Error('Mismatched evidence windows');
  const rules: OutcomeRule[] = [...(evidence.rules ?? [])];
  if (window.coverage === 'complete' && window.extent === 'phase') {
    for (const { phenomenon, character } of window.absent) {
      if (phenomenon === 'identity-reveal')
        rules.push({ kind: 'report', type: 'identity', fields: { character }, max: 0 });
      else rules.push({ kind: 'no-death', character });
    }
  }
  const verify = prepareAbsenceHistory(pack, [
    { ...evidence, rules },
    ...(options.following ?? []),
  ]);
  const space = buildAbsenceSpace(pack, window, candidates);
  for (const identities of propagateSolutions(space, stats)) {
    let work = 0,
      status: AssignmentResult['status'] = 'excluded';
    if (window.entry.publicSpecialRules?.length) {
      yield { identities, status: 'unknown', work };
      continue;
    }
    const group = options.worlds(identities);
    if (!group.exhaustive) status = 'unknown';
    for (const state of group.states) {
      if (work >= workPerRow) {
        status = 'unknown';
        break;
      }
      if (Object.entries(identities).some(([id, role]) => state.characters[id]?.identity !== role))
        throw Error('Hidden completion has different effective identities');
      work++;
      if (!matchesEntry(window.entry, state)) continue;
      const checked = verify(state, workPerRow - work);
      work += checked.work;
      if (checked.status === 'possible') {
        status = 'possible';
        break;
      }
      if (checked.status === 'unknown') status = 'unknown';
    }
    yield { identities, status, work };
  }
}
