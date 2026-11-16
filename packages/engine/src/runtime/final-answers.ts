import type { Choice } from '../../../contracts/src/game.js';
import type { EngineState, RulePack } from './model.js';

export type FinalGuess = Extract<Choice, { kind: 'guess' | 'guess-culprits' }>;

/** The ordinary answer always refers to the initial identity, including in a later world. */
export function acceptedIdentities(pack: RulePack, initialIdentity: string): string[] {
  return pack.anniversary && initialIdentity === '因果残片'
    ? [initialIdentity, '平民']
    : [initialIdentity];
}
export function culpritAnswer(state: EngineState): Record<string, string> {
  return Object.fromEntries(state.setup.incidents.map((i) => [String(i.day), i.culprit]));
}
