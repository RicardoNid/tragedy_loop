import type { Actor, Choice, GameSetup } from '../../../contracts/src/game.js';
import { advance, cardCount, initialize, initializeDiscussion, legalCardTargets } from './engine.js';
import { canonical, type EngineState, type RulePack } from './model.js';

import { normalizeHistory, matchesObservation } from './observation-history.js';

export interface RecordedChoice {
  actor: Actor;
  choice: Choice;
}
export interface ReplayRequest {
  setup: GameSetup;
  choices: RecordedChoice[];
  stepBudget?: number;
  /** Complete recorded streams for the audiences the caller wants to verify. */
  expectedObservations?: Partial<EngineState['observations']>;
}
export function replay(pack: RulePack, request: ReplayRequest) {
  // Older histories begin with the first discussion after the initial pieces were placed.
  const first = request.choices[0]?.choice.kind;
  const start = first === 'start' ? initialize : initializeDiscussion;
  const started = start(pack, request.setup, request.stepBudget);
  if (!started.state) return { status: 'invalid' as const, diagnostics: started.diagnostics };
  let state = started.state;
  const checked = { public: 0, protagonists: 0, mastermind: 0 };
  function checkAnnouncements(index: number, finished = false) {
    if (!request.expectedObservations) return;
    for (const audience of ['public', 'protagonists', 'mastermind'] as const) {
      const expected = request.expectedObservations[audience];
      if (!expected) continue;
      const actual = state.observations[audience];
      while (checked[audience] < actual.length) {
        const n = checked[audience];
        const size = actual[n]!.simultaneousSize ?? 1;
        const recorded = expected.slice(n, n + size);
        if (recorded.length !== size || recorded.some((o, j) => o.sequence !== n + j + 1)) break;
        let keys: string[];
        try {
          keys = normalizeHistory(recorded);
        } catch {
          break; // Malformed or interleaved batch in an imported replay.
        }
        const emitted = actual.slice(n, n + size);
        if (keys.length !== size || normalizeHistory(emitted).some((key, j) =>
          !matchesObservation(key, keys[j]!, emitted[j]!))) break;
        checked[audience] += size;
      }
      if (checked[audience] < actual.length || (finished && expected.length !== actual.length))
        return { status: 'mismatch' as const, reason: 'announcement-mismatch', index,
          audience, sequence: checked[audience] + 1, state };
    }
  }
  const initialMismatch = checkAnnouncements(-1);
  if (initialMismatch) return initialMismatch;
  for (let i = 0; i < request.choices.length; i++) {
    const input = request.choices[i]!;
    if (!state.pending)
      return {
        status: 'mismatch' as const,
        index: i,
        reason: state.winner ? 'game-ended' : 'execution-paused',
        state,
      };
    const result = advance(
      pack,
      state,
      input.actor,
      {
        id: `replay-${i}`,
        expectedRevision: state.revision,
        decisionId: state.pending.id,
        choice: input.choice,
      },
      request.stepBudget,
    );
    if (result.status === 'rejected')
      return { status: 'mismatch' as const, index: i, reason: result.reason, state };
    state = result.state;
    const mismatch = checkAnnouncements(i);
    if (mismatch) return mismatch;
    if (result.status === 'paused') return { status: 'paused' as const, index: i, state };
  }
  return checkAnnouncements(request.choices.length, true) ?? { status: 'replayed' as const, state };
}
export function runBatch(pack: RulePack, requests: ReplayRequest[]) {
  return requests.map((request) => replay(pack, request));
}
/** Internal exhaustive choices, not a player-facing menu. Lazy to avoid allocating huge card products. */
export function* enumerateChoices(state: EngineState): Generator<Choice> {
  const pending = state.pending;
  if (!pending) return;
  if (pending.kind === 'cards') {
    const cards = state.cards.filter((c) => c.owner === pending.actor && c.status === 'hand');
    const targets = legalCardTargets(state, pending.actor);
    const count = cardCount(state, pending.actor);
    function* visit(
      start: number,
      placements: { card: string; target: string }[],
    ): Generator<Choice> {
      if (placements.length === count) {
        yield { kind: 'cards', placements };
        return;
      }
      for (let i = start; i < cards.length; i++)
        for (const target of targets)
          if (!placements.some((p) => p.target === target))
            yield* visit(i + 1, [...placements, { card: cards[i]!.id, target }]);
    }
    yield* visit(0, []);
    return;
  }
  if (pending.kind === 'guess') {
    // Guesses are user input, not hidden explanations. Supply them as known actions in a query.
    return;
  }
  yield* pending.options;
}
export function replayFingerprint(state: EngineState): string {
  return canonical(state);
}
