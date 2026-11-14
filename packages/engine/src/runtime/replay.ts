import type { Actor, Choice, GameSetup } from '../../../contracts/src/game.js';
import { advance, cardCount, initialize, initializeDiscussion, legalCardTargets } from './engine.js';
import { canonical, type EngineState, type RulePack } from './model.js';

export interface RecordedChoice {
  actor: Actor;
  choice: Choice;
}
export interface ReplayRequest {
  setup: GameSetup;
  choices: RecordedChoice[];
  stepBudget?: number;
}
export function replay(pack: RulePack, request: ReplayRequest) {
  // Older histories begin with the first discussion after the initial pieces were placed.
  const first = request.choices[0]?.choice.kind;
  const start = first === 'start' ? initialize : initializeDiscussion;
  const started = start(pack, request.setup, request.stepBudget);
  if (!started.state) return { status: 'invalid' as const, diagnostics: started.diagnostics };
  let state = started.state;
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
    if (result.status === 'paused') return { status: 'paused' as const, index: i, state };
  }
  return { status: 'replayed' as const, state };
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
