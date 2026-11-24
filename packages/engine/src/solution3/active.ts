import type { Counters } from '../../../contracts/src/game.js';
import type { Ability, Effect } from '../runtime/model.js';
// Printed 1L1 restrictions are additional to the ordinary once-per-phase completion rule.
const loopLimits: Pick<Ability, 'id' | 'loopLimit'>[] = [
  'parttimer-reveal',
  'boss-reveal',
  'informant',
  'soldier-paranoia',
  'soldier-protect',
  'shrine-maiden-reveal',
  'alien-kill',
  'alien-revive',
  'servant',
  'teacher-reveal',
  'girl-move',
  'illusion-move',
  'detective-incident',
  'detective-guard',
  'divinity-incident',
  'leader-reveal',
  'ai',
  'forensic-transfer',
  'forensic-reveal',
  'immortal-revive',
  'higher-being',
].map((id) => ({ id, loopLimit: 1 }));
const oncePerLoop = new Set(loopLimits.filter((a) => a.loopLimit === 1).map((a) => a.id));
export function useKey(actor: string, ability: string, loop: number, day: number) {
  return JSON.stringify([actor, ability, loop, oncePerLoop.has(ability) ? 'loop' : day]);
}

const effects: Record<string, Effect> = {
  'transfer-student': { op: 'replace', target: '$target', from: 'intrigue', to: 'goodwill' },
  student: { op: 'counter', target: '$target', counter: 'paranoia', amount: -1 },
  'idol-paranoia': { op: 'counter', target: '$target', counter: 'paranoia', amount: -1 },
  'idol-goodwill': { op: 'counter', target: '$target', counter: 'goodwill', amount: 1 },
  'rich-girl': { op: 'counter', target: '$target', counter: 'goodwill', amount: 1 },
  'media-paranoia': { op: 'counter', target: '$target', counter: 'paranoia', amount: 1 },
  'soldier-paranoia': { op: 'counter', target: '$target', counter: 'paranoia', amount: 2 },
  nurse: { op: 'counter', target: '$target', counter: 'paranoia', amount: -1 },
  'media-intrigue': { op: 'counter', target: '$target', counter: 'intrigue', amount: 1 },
  'divinity-intrigue': { op: 'counter', target: '$target', counter: 'intrigue', amount: -1 },
  'leader-goodwill': { op: 'counter', target: '$target', counter: 'goodwill', amount: 1 },
  'detective-guard': { op: 'counter', target: '$target', counter: 'guard', amount: 1 },
};
export function expectedCounters(
  ability: string,
  before: Counters,
  choices?: Record<string, unknown>,
): Partial<Counters> | undefined {
  let effect = effects[ability];
  if (
    (ability === 'teacher-counter' || ability === 'doctor-counter') &&
    (choices?.direction === 'add' || choices?.direction === 'remove')
  )
    effect = {
      op: 'counter',
      target: '$target',
      counter: 'paranoia',
      amount: choices.direction === 'add' ? 1 : -1,
    };
  if (ability === 'higher-being' && (choices?.counter === 'hope' || choices?.counter === 'despair'))
    effect = { op: 'counter', target: '$target', counter: choices.counter, amount: 1 };
  if (effect?.op === 'replace' && before[effect.from] > 0)
    return { [effect.from]: before[effect.from] - 1, [effect.to]: before[effect.to] + 1 };
  if (
    effect?.op === 'counter' &&
    typeof effect.amount === 'number' &&
    effect.counter !== '$counter'
  ) {
    const after = Math.max(0, before[effect.counter] + effect.amount);
    if (after !== before[effect.counter]) return { [effect.counter]: after };
  }
  return undefined;
}
