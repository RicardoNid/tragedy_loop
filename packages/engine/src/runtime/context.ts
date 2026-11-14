import type { EngineState } from './model.js';

export function getDecisionContext(state: EngineState) {
  return {
    discussionMode: state.setup.discussion,
    discussionAllowed:
      state.setup.discussion === 'allowed' ||
      state.phase === 'discussion' ||
      state.phase === 'final-guess',
    captain: state.captain,
    choiceActor: state.pending?.actor ?? null,
    confirmer: state.pending?.actor ?? null,
  };
}
