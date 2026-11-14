import type { Board, CounterRule, ModuleId } from './rule-definition.js';

export interface EffectContext {
  readonly module: ModuleId;
  readonly edition: 'base';
  readonly anniversaryOverlay: boolean;
  readonly timing: CounterRule['timing'];
  readonly ownerId?: string;
  readonly characters: readonly { readonly id: string; readonly alive: boolean; readonly area: Board | 'faraway' | null }[];
}
export type EffectChoice = { readonly kind: 'use'; readonly targetId?: string } | { readonly kind: 'decline' };
export type CounterIntent = { readonly kind: 'add-counter'; readonly target: { readonly kind: 'board' | 'character'; readonly id: string }; readonly counter: 'intrigue' | 'paranoia'; readonly amount: number };
export type PreviewResult = { readonly status: 'intent'; readonly intent: CounterIntent } | { readonly status: 'declined' } | { readonly status: 'rejected'; readonly reason: string };
const boards: readonly Board[] = ['hospital', 'shrine', 'city', 'school'];

/** Pure effect preview only: no occurrence, usage, observation, modifier or completion events.
 * The caller must implement those lifecycle gates before using this in a game.
 * Hidden-source diagnostics are for internal asset validation, never a player API.
 */
export function previewCounterEffect(rule: CounterRule, context: EffectContext, choice: EffectChoice): PreviewResult {
  const reject = (reason: string): PreviewResult => ({ status: 'rejected', reason });
  if (context.module !== rule.scope.module || context.edition !== rule.scope.edition || context.anniversaryOverlay !== rule.scope.anniversaryOverlay) return reject('unsupported-profile');
  if (context.timing !== rule.timing) return reject('wrong-timing');
  if (new Set(context.characters.map(c => c.id)).size !== context.characters.length) return reject('duplicate-character-id');
  const owner = context.characters.find(c => c.id === context.ownerId);
  if (rule.guard === 'owner-alive-and-present' && (!owner?.alive || owner.area === null)) return reject('invalid-owner');
  if (choice.kind === 'decline') return rule.activation === 'optional-mastermind-ability' ? { status: 'declined' } : reject('effect-not-optional');
  let target: CounterIntent['target'];
  switch (rule.choice.target) {
    case 'fixed-shrine':
      if (choice.targetId !== undefined) return reject('unexpected-target-choice');
      target = { kind: 'board', id: 'shrine' };
      break;
    case 'any-board':
      if (!boards.some(b => b === choice.targetId)) return reject('invalid-board');
      target = { kind: 'board', id: choice.targetId! };
      break;
    case 'alive-character-in-owner-area': {
      const character = context.characters.find(c => c.id === choice.targetId);
      if (!owner?.alive || owner.area === null || !character?.alive || character.area === null || character.area !== owner.area) return reject('invalid-character-target');
      if (!rule.choice.includesSelf && character.id === owner.id) return reject('self-excluded');
      target = { kind: 'character', id: character.id };
      break;
    }
  }
  return { status: 'intent', intent: { kind: 'add-counter', target, counter: rule.transition.write.counter, amount: rule.transition.nextValue.constant } };
}
