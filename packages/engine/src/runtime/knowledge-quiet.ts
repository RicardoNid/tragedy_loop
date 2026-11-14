import type { PublicContext } from './knowledge-conditions.js';
import { publicCondition } from './knowledge-conditions.js';
import { BOARDS, COUNTERS, type Effect, type Selector, type Step } from './model.js';

// Each alternative lists the targets whose death requests must leave the board
// unchanged. An empty alternative needs no immunity; no alternatives means
// the program must publish a change. Unsupported programs retain a witness search.
export function quietTargets(steps: Step[], ctx: PublicContext): string[][] | undefined {
  if (!steps.length) return [[]];
  const alive = [...ctx.characters.values()].filter((c) => c.status === 'alive');
  function select(s: Selector) {
    if (s.kind !== 'alive') return;
    const ids: string[] = [];
    for (const a of alive) {
      const enabled = publicCondition(s.where, { ...ctx, bindings: { it: a.id } });
      if (enabled === undefined) return;
      if (enabled) ids.push(a.id);
    }
    return ids;
  }
  // A move to the current board is legal. With no movement report the
  // second step reads that same board, even if a movement restriction applied.
  if (steps.length === 2 && !ctx.virtualArea && ctx.owner) {
    const [move, add] = steps;
    const choice = move?.choices?.[0],
      first = move?.effects[0],
      second = add?.effects[0];
    if (
      move?.condition === undefined &&
      add?.condition === undefined &&
      !add?.choices?.length &&
      move?.choices?.length === 1 &&
      choice &&
      !choice.optional &&
      !Array.isArray(choice.options) &&
      choice.options.kind === 'boards' &&
      !choice.options.where &&
      move.effects.length === 1 &&
      first?.op === 'move' &&
      first.target === '$self' &&
      first.area === '$' + choice.key &&
      add?.effects.length === 1 &&
      second?.op === 'counter' &&
      second.target === '$self.area' &&
      second.counter === 'intrigue' &&
      typeof second.amount === 'number'
    ) {
      const board = BOARDS.find((b) => b === ctx.characters.get(ctx.owner!)?.area);
      if (board) {
        const n = ctx.boards[board];
        return n === Math.min(3, Math.max(0, n + second.amount)) ? [[]] : [];
      }
    }
  }
  if (steps.length !== 1) return;
  const step = steps[0]!;
  const enabled = publicCondition(step.condition, ctx);
  if (enabled === undefined) return;
  if (!enabled) return [[]];
  const choices = step.choices ?? [];
  const targetChoice = choices[0],
    counterChoice = choices[1],
    effect = step.effects[0];
  if (
    targetChoice &&
    !targetChoice.optional &&
    !Array.isArray(targetChoice.options) &&
    step.effects.length === 1 &&
    effect?.op === 'counter' &&
    effect.target === '$' + targetChoice.key &&
    typeof effect.amount === 'number' &&
    effect.amount > 0 &&
    ((choices.length === 1 && effect.counter !== '$counter') ||
      (choices.length === 2 &&
        effect.counter === '$counter' &&
        counterChoice?.key === 'counter' &&
        !counterChoice.optional &&
        Array.isArray(counterChoice.options) &&
        counterChoice.options.length &&
        counterChoice.options.every((k) => COUNTERS.some((c) => c === k))))
  ) {
    const ids = select(targetChoice.options);
    return ids ? (ids.length ? [] : [[]]) : undefined;
  }
  let targets = [''];
  if (choices.length) {
    const c = choices[0]!;
    if (
      choices.length !== 1 ||
      (c.actor && c.actor !== 'mastermind') ||
      c.optional ||
      Array.isArray(c.options)
    )
      return;
    const ids = select(c.options);
    if (!ids) return;
    targets = ids.length ? ids : [''];
  }
  function collect(
    e: Effect,
    selected: string,
    victims: string[],
  ): 'quiet' | 'changed' | 'unknown' {
    if (e.op === 'when') {
      const condition = publicCondition(e.condition, {
        ...ctx,
        bindings: { [choices[0]?.key ?? 'target']: selected },
      });
      if (condition === false) return 'quiet';
      if (condition === undefined || e.effects.length !== 1) return 'unknown';
      return collect(e.effects[0]!, selected, victims);
    }
    if (
      e.op === 'each' &&
      e.effects.length === 1 &&
      e.effects[0]?.op === 'kill' &&
      e.effects[0].target === '$it'
    ) {
      const ids = select(e.selector);
      if (!ids) return 'unknown';
      victims.push(...ids);
      return 'quiet';
    }
    if (e.op !== 'kill' && e.op !== 'counter') return 'unknown';
    const id =
      e.target === '$self'
        ? ctx.owner
        : choices[0] && e.target === '$' + choices[0].key
          ? selected
          : e.target;
    if (id === undefined || id.startsWith('$')) return 'unknown';
    if (e.op === 'kill') {
      if (ctx.characters.get(id)?.status === 'alive') victims.push(id);
      return 'quiet';
    }
    if (
      e.op !== 'counter' ||
      step.effects.length !== 1 ||
      typeof e.amount !== 'number' ||
      e.counter === '$counter'
    )
      return 'unknown';
    const board = BOARDS.find((b) => b === id);
    if (board && e.counter === 'intrigue') {
      const n = ctx.boards[board];
      return n === Math.min(3, Math.max(0, n + e.amount)) ? 'quiet' : 'changed';
    }
    const actor = ctx.characters.get(id);
    if (!actor) return id === '' ? 'quiet' : 'unknown';
    const n = actor.counters[e.counter];
    return n === Math.max(0, n + e.amount) ? 'quiet' : 'changed';
  }
  const alternatives: string[][] = [];
  for (const target of targets) {
    const victims: string[] = [];
    const effects = step.effects.map((e) => collect(e, target, victims));
    if (effects.includes('unknown')) return;
    if (!effects.includes('changed')) alternatives.push(victims);
  }
  return alternatives;
}

/** Victims of an unconditional group settlement at the public entry position.
 * A protagonist outcome in the same step has its own report. */
export function groupVictims(steps: Step[], ctx: PublicContext): string[] | undefined {
  if (steps.length !== 1 || steps[0]!.choices?.length || steps[0]!.condition !== undefined) return;
  const groups: Effect[] = [];
  for (const effect of steps[0]!.effects) {
    if (effect.op !== 'when' || effect.effects.length !== 1) return;
    const e = effect.effects[0]!;
    if (e.op === 'protagonist-death') continue;
    if (
      e.op !== 'each' ||
      e.effects.length !== 1 ||
      e.effects[0]?.op !== 'kill' ||
      e.effects[0].target !== '$it'
    )
      return;
    groups.push(effect);
  }
  return groups.length ? quietTargets([{ effects: groups }], ctx)?.[0] : undefined;
}
