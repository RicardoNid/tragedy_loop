import { BOARDS, COUNTERS, type Ability, type Effect } from './model.js';
import {
  publicCondition,
  publicNumber,
  publicValue,
  type PublicContext,
} from './knowledge-conditions.js';
import type { VisibleChange } from './knowledge-effects.js';
import type { Counter } from '../../../contracts/src/game.js';
import { destination } from './expressions.js';

/** Predict only public reports of the declared first settlement. An unknown
 * branch stays with the ordinary causal/history checks. No script is inspected. */
export function firstGoodwillReports(ability: Ability, ctx: PublicContext) {
  const step = ability.steps[0];
  if (
    !step ||
    step.moveOthersFromEffectiveArea ||
    !ctx.owner ||
    ability.mandatory ||
    ability.timing !== 'protagonist-abilities' ||
    ability.threshold === undefined ||
    publicCondition(ability.condition, ctx) !== true ||
    publicCondition(step.condition, ctx) !== true
  )
    return;
  const resolve = (ref: string) => publicValue({ ref }, ctx);
  for (const choice of step.choices ?? []) {
    const value = ctx.bindings?.[choice.key];
    if (!value) return;
    if (Array.isArray(choice.options)) {
      if (!choice.options.includes(value)) {
        const owner = ctx.characters.get(ctx.owner);
        if (
          !owner ||
          owner.area === 'far' ||
          ctx.virtualArea ||
          !choice.options.includes('$adjacent-self') ||
          !['horizontal', 'vertical'].some((dir) => destination(owner.area, [dir]) === value)
        )
          return;
      }
    } else {
      const actor = ctx.characters.get(value);
      const board = BOARDS.some((b) => b === value);
      const kind = choice.options.kind;
      if (
        !(kind === 'boards'
          ? board
          : kind === 'cards'
            ? !!actor
            : kind === 'dead'
              ? actor?.status === 'dead'
              : actor?.status === 'alive' || (kind === 'alive-or-boards' && board))
      )
        return;
      if (
        publicCondition(choice.options.where, {
          ...ctx,
          bindings: { ...ctx.bindings, it: value },
        }) !== true
      )
        return;
    }
  }
  const reports = new Map<string, VisibleChange[]>();
  const add = (change: VisibleChange) => {
    const group = reports.get(change.target) ?? [];
    group.push(change);
    reports.set(change.target, group);
  };
  const deltas = new Map<string, Map<Counter, number>>();
  const counterDelta = (target: string, counter: Counter, amount: number) => {
    const fields = deltas.get(target) ?? new Map<Counter, number>();
    fields.set(counter, (fields.get(counter) ?? 0) + amount);
    deltas.set(target, fields);
  };
  function compile(e: Effect): boolean {
    if (e.op === 'when') {
      const yes = publicCondition(e.condition, ctx);
      return yes === false || (yes === true && e.effects.every(compile));
    }
    if (e.op === 'transfer') {
      const from = resolve(e.from),
        to = resolve(e.to),
        key = resolve(e.counter);
      if (typeof from !== 'string' || typeof to !== 'string' || !COUNTERS.some((k) => k === key))
        return false;
      const a = ctx.characters.get(from),
        b = ctx.characters.get(to),
        k = key as Counter;
      if (!a || !b || a.counters[k] <= 0) return false;
      counterDelta(from, k, -1);
      counterDelta(to, k, 1);
      return true;
    }
    if (!('target' in e) || !e.target) return false;
    const target = resolve(e.target);
    if (typeof target !== 'string') return false;
    const actor = ctx.characters.get(target);
    const board = BOARDS.find((b) => b === target);
    if (!actor && !board) return false;
    switch (e.op) {
      case 'counter': {
        const k = resolve(e.counter),
          n = publicNumber(e.amount, ctx);
        if (!COUNTERS.some((c) => c === k) || n === undefined || !Number.isSafeInteger(n))
          return false;
        if (actor || k === 'intrigue') counterDelta(target, k as Counter, n);
        return true;
      }
      case 'clear':
        for (const k of e.counter ? [e.counter] : COUNTERS) {
          if (actor || k === 'intrigue')
            counterDelta(target, k, -(actor ? actor.counters[k] : ctx.boards[board!]));
        }
        return true;
      case 'replace':
        if (!actor) return false;
        if (actor.counters[e.from] > 0) {
          counterDelta(target, e.from, -1);
          counterDelta(target, e.to, 1);
        }
        return true;
      case 'kill':
      case 'revive':
      case 'remove':
        if (!actor || actor.status !== (e.op === 'revive' ? 'dead' : 'alive')) return false;
        // A guard or a replacement can change the recipient and the type of report.
        if (
          e.op === 'kill' &&
          (actor.counters.guard > 0 ||
            [...ctx.characters.values()].some(
              (c) =>
                c.id !== target &&
                c.area === actor.area &&
                c.status === 'alive' &&
                ctx.pack.characters[c.character]?.protects,
            ))
        )
          return false;
        add({ kind: e.op, target });
        return true;
      case 'move': {
        const dest = resolve(e.area);
        if (
          !actor ||
          actor.status !== 'alive' ||
          !BOARDS.some((b) => b === dest) ||
          ctx.pack.characters[actor.character]?.forbidden.some((b) => b === dest)
        )
          return false;
        if (actor.area !== dest) add({ kind: 'move', target, destination: String(dest) });
        return true;
      }
      default:
        return false;
    }
  }
  if (!step.effects.every(compile)) return;
  for (const [target, fields] of deltas) {
    const actor = ctx.characters.get(target);
    for (const [counter, n] of fields) {
      const before = actor
        ? actor.counters[counter]
        : ctx.boards[target as keyof typeof ctx.boards];
      const after = Math.min(actor ? Infinity : 3, Math.max(0, before + n));
      if (after !== before) add({ kind: 'counter', target, counter, before, after });
    }
  }
  return reports;
}

export function matchesGoodwillReport(expected: VisibleChange[], actual: VisibleChange[]) {
  return (
    expected.length === actual.length &&
    expected.every((e) =>
      actual.some(
        (a) =>
          a.kind === e.kind &&
          a.target === e.target &&
          a.counter === e.counter &&
          a.before === e.before &&
          a.after === e.after &&
          a.destination === e.destination,
      ),
    )
  );
}
