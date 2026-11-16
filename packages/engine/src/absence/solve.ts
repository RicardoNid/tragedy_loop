import type { EngineState, RulePack } from '../runtime/model.js';
import { buildAbsenceSpace, type AbsenceWindow } from './index.js';
import { propagateSolutions, type SearchCounts } from './propagation.js';
import { verifyAbsencePhase, type PhaseEvidence } from './phase-search.js';

export interface HiddenCompletions {
  /** Complete only when the supplied possibilities exhaust this row's hidden state. */
  exhaustive: boolean;
  states: Iterable<EngineState>;
}
export interface SearchOptions {
  evidence: PhaseEvidence;
  worlds: (identities: Readonly<Record<string, string>>) => HiddenCompletions;
  workPerRow: number;
}
export interface AssignmentResult {
  identities: Record<string, string>;
  status: 'possible' | 'unknown' | 'excluded';
  work: number;
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
  const space = buildAbsenceSpace(pack, window, candidates);
  for (const identities of propagateSolutions(space, stats)) {
    let work = 0,
      status: AssignmentResult['status'] = 'excluded';
    const group = options.worlds(identities);
    if (!group.exhaustive) status = 'unknown';
    for (const state of group.states) {
      if (work >= workPerRow) {
        status = 'unknown';
        break;
      }
      if (Object.entries(identities).some(([id, role]) => state.characters[id]?.identity !== role))
        throw Error('Hidden completion has different effective identities');
      const checked = verifyAbsencePhase(pack, state, evidence, workPerRow - work - 1);
      work += 1 + checked.work;
      if (checked.status === 'possible') {
        status = 'possible';
        break;
      }
      if (checked.status === 'unknown') status = 'unknown';
    }
    yield { identities, status, work };
  }
}
