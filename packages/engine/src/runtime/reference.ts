import type { GameSetup, Observation } from '../../../contracts/src/game.js';
import { advance, initializeDiscussion } from './engine.js';
import { hasUnsupportedDiagnostic } from './setup.js';
import { canonical, clone, type EngineState, type RulePack } from './model.js';
import { enumerateChoices, replay, type RecordedChoice } from './replay.js';

export interface Hypothesis {
  id: string;
  setup: GameSetup;
}
export interface Witness {
  hypothesis: string;
  choices: RecordedChoice[];
  observations: Observation[];
}
export interface Knowledge {
  ruleDigest: string;
  version: number;
  /** Declared finite test domain; never misrepresented as all legal scripts. */
  domain: Hypothesis[];
  history: Observation[];
  scope: 'provided-finite-domain';
}
export function normalizeHistory(history: Observation[]): string[] {
  return history.map(({ sequence: _sequence, ...observation }) => canonical(observation));
}
export function createReferenceKnowledge(
  pack: RulePack,
  domain: Hypothesis[],
  history: Observation[] = [],
): Knowledge {
  if (new Set(domain.map((h) => h.id)).size !== domain.length)
    throw new Error('Hypothesis IDs must be unique.');
  return {
    ruleDigest: pack.digest,
    version: 0,
    domain: clone(domain),
    history: clone(history),
    scope: 'provided-finite-domain',
  };
}
export function appendKnowledge(
  knowledge: Knowledge,
  observations: Observation[],
  expectedVersion: number,
): Knowledge {
  if (expectedVersion !== knowledge.version) throw new Error('Stale knowledge version.');
  const next = clone(knowledge);
  next.version++;
  next.history.push(...clone(observations));
  return next;
}
export function withAssumptions(knowledge: Knowledge, retainedIds: string[]): Knowledge {
  const next = clone(knowledge);
  next.domain = next.domain.filter((h) => retainedIds.includes(h.id));
  return next;
}
function compatible(observed: string[], expected: string[]): boolean {
  return observed.slice(0, expected.length).every((o, i) => o === expected[i]);
}
export interface ReferenceBudget {
  expansions: number;
  choicesPerNode: number;
  depth: number;
  engineSteps: number;
}
export type ReferenceResult = {
  status: 'possible' | 'impossible' | 'unknown';
  scope: 'provided-finite-domain';
  version: number;
  witnesses: Witness[];
  retained: string[];
  unresolved: string[];
  excluded: string[];
  expansions: number;
  reasons: string[];
};
/** Exhaustive reference search, using exactly the execution transition and observation projection.
 * A witness proves possibility. Every omitted/unexplored branch remains unknown.
 * A finite domain is explicit: exclusions never claim completeness beyond the supplied setups.
 */
export function queryReference(
  pack: RulePack,
  knowledge: Knowledge,
  budget: ReferenceBudget,
): ReferenceResult {
  if (pack.digest !== knowledge.ruleDigest) throw new Error('Knowledge rule version mismatch.');
  for (const n of Object.values(budget))
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid search budget.');
  const expected = normalizeHistory(knowledge.history);
  const result: ReferenceResult = {
    status: 'impossible',
    scope: knowledge.scope,
    version: knowledge.version,
    witnesses: [],
    retained: [],
    unresolved: [],
    excluded: [],
    expansions: 0,
    reasons: [],
  };
  for (const hypothesis of knowledge.domain) {
    const started = initializeDiscussion(pack, hypothesis.setup, budget.engineSteps);
    if (!started.state) {
      // Invalid configurations and unsupported semantics are different conclusions.
      if (hasUnsupportedDiagnostic(started.diagnostics)) {
        result.unresolved.push(hypothesis.id);
        result.reasons.push('unsupported-rules');
      } else result.excluded.push(hypothesis.id);
      continue;
    }
    const queue: { state: EngineState; trace: RecordedChoice[] }[] = [
      { state: started.state, trace: [] },
    ];
    let unknown = false,
      found = false,
      cursor = 0;
    while (cursor < queue.length) {
      const node = queue[cursor++]!;
      const observations = node.state.observations.protagonists;
      const normalized = normalizeHistory(observations);
      if (!compatible(normalized, expected)) continue;
      // Prefix evidence only: no inference from the absence of a future announcement.
      if (normalized.length >= expected.length) {
        result.witnesses.push({
          hypothesis: hypothesis.id,
          choices: node.trace,
          observations: clone(observations),
        });
        found = true;
        break;
      }
      if (node.state.winner) continue;
      if (
        !node.state.pending ||
        node.trace.length >= budget.depth ||
        result.expansions >= budget.expansions
      ) {
        unknown = true;
        continue;
      }
      let count = 0;
      for (const choice of enumerateChoices(node.state)) {
        if (count++ >= budget.choicesPerNode || result.expansions >= budget.expansions) {
          unknown = true;
          break;
        }
        result.expansions++;
        const actor = node.state.pending.actor;
        const next = advance(
          pack,
          node.state,
          actor,
          {
            id: `reference-${node.trace.length}`,
            expectedRevision: node.state.revision,
            decisionId: node.state.pending.id,
            choice,
          },
          budget.engineSteps,
        );
        if (next.status === 'rejected')
          throw new Error('Internal choice enumerator produced an illegal action.');
        if (next.status === 'paused') unknown = true;
        queue.push({ state: next.state, trace: [...node.trace, { actor, choice }] });
      }
      if (node.state.pending.kind === 'guess') unknown = true;
    }
    if (found) result.retained.push(hypothesis.id);
    else if (unknown) {
      result.unresolved.push(hypothesis.id);
      result.reasons.push('search-not-complete');
    } else result.excluded.push(hypothesis.id);
  }
  result.status = result.retained.length
    ? 'possible'
    : result.unresolved.length
      ? 'unknown'
      : 'impossible';
  result.reasons = [...new Set(result.reasons)];
  return result;
}
export function checkWitness(
  pack: RulePack,
  hypothesis: Hypothesis,
  witness: Witness,
  history: Observation[],
): boolean {
  if (hypothesis.id !== witness.hypothesis) return false;
  const result = replay(pack, { setup: hypothesis.setup, choices: witness.choices });
  if (result.status !== 'replayed') return false;
  const observed = normalizeHistory(result.state.observations.protagonists),
    expected = normalizeHistory(history);
  return (
    observed.length >= expected.length &&
    compatible(observed, expected) &&
    canonical(result.state.observations.protagonists) === canonical(witness.observations)
  );
}
