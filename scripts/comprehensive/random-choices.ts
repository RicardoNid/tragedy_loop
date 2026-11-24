import assert from 'node:assert/strict';
import type { Choice } from '../../packages/contracts/src/game.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';
import { cardCount, legalCardTargets } from '../../packages/engine/src/runtime/engine.js';

export function generator(seed: number) {
  let state = seed;
  return (limit: number) => {
    assert.ok(limit > 0, 'empty candidate set');
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 2 ** 32) * limit);
  };
}
export function optionalBranchKey(s: EngineState, choice: Choice) {
  const p = s.pending;
  if (!p || !p.options.some(option => option.kind === 'continue') || p.options.length < 2) return;
  return JSON.stringify([s.phase,p.actor,p.kind,choice]);
}

export function choose(s: EngineState, draw: (n: number) => number, visits?: ReadonlyMap<string,number>): Choice {
  const p = s.pending!;
  if (p.kind === 'cards') {
    const hand = s.cards.filter((c) => c.owner === p.actor && c.status === 'hand');
    const targets = legalCardTargets(s, p.actor);
    return {
      kind: 'cards',
      placements: Array.from({ length: cardCount(s, p.actor) }, () => ({
        card: hand.splice(draw(hand.length), 1)[0]!.id,
        target: targets.splice(draw(targets.length), 1)[0]!,
      })),
    };
  }
  if (p.kind === 'guess') {
    if (s.flags['c-guess'])
      return {
        kind: 'guess-culprits',
        answers: Object.fromEntries(s.setup.incidents.map((i) => [String(i.day), i.culprit])),
      };
    const guessed = JSON.parse(s.flags.guessed ?? '[]') as string[];
    const available = Object.values(s.characters).filter(
      (c) => c.status !== 'absent' && !guessed.includes(c.id),
    );
    const c = available[draw(available.length)]!;
    const config = s.setup.characters.find((x) => x.id === c.id);
    return {
      kind: 'guess',
      character: c.id,
      identity: draw(4) === 0 ? '平民' : c.initialIdentity,
      ...(config?.reverseIdentity && { reverseIdentity: config.reverseIdentity }),
    };
  }
  const proceed = p.options.find((c) => c.kind === 'continue');
  if (proceed && visits && p.options.length > 1) {
    const counts = p.options.map(option => visits.get(optionalBranchKey(s,option)!) ?? 0);
    const lowest = Math.min(...counts);
    const choices = p.options.filter((_,index) => counts[index] === lowest);
    return choices[draw(choices.length)]!;
  }
  if (proceed && draw(12) !== 0) return proceed;
  return p.options[draw(p.options.length)]!;
}
