import type { Step, ChoiceSpec, Effect } from '../runtime/model.js';
import type { Counters, PublicCharacter } from '../../../contracts/src/game.js';
import type { Work } from './relations.js';

const first: ChoiceSpec = { key: 'first', options: { kind: 'alive' } };
const second: ChoiceSpec = {
  key: 'second',
  options: { kind: 'alive', where: { cmp: 'ne', left: { ref: '$it' }, right: { ref: '$first' } } },
};
const counter = (target: string, kind: keyof Counters, amount: number): Effect => ({
  op: 'counter',
  target,
  counter: kind,
  amount,
});
const programs: Record<string, Step[]> = {
  不安扩散: [
    { choices: [first], effects: [counter('$first', 'paranoia', 2)] },
    { choices: [second], effects: [counter('$second', 'intrigue', 1)] },
  ],
  散播: [
    { choices: [first], effects: [counter('$first', 'goodwill', -2)] },
    { choices: [second], effects: [counter('$second', 'goodwill', 2)] },
  ],
};
export type CounterReport = { name: string; before: Counters; after: Counters };
export function matchCounterSteps(
  event: string,
  actor: string,
  pieces: Map<string, Pick<PublicCharacter, 'status' | 'area' | 'counters'>>,
  reports: CounterReport[],
  work: Work,
  limit = 2048,
): boolean | undefined {
  const steps = programs[event] ?? [];
  if (!steps.length || actor === '临时工') return undefined;
  if (actor === '黑猫') return reports.length === 0;
  const times = actor === '教主' ? 2 : 1;
  const live = [...pieces].filter(([, p]) => p.status === 'alive').map(([name]) => name);
  let attempts = 0;
  function visit(
    i: number,
    offset: number,
    bindings: Record<string, string>,
    state: Map<string, Counters>,
  ): boolean | undefined {
    if (i === steps.length * times) return offset === reports.length;
    const step = steps[i % steps.length]!,
      choice = step.choices?.[0],
      effect = step.effects[0];
    if (
      !choice ||
      typeof choice.options !== 'object' ||
      Array.isArray(choice.options) ||
      choice.options.kind !== 'alive' ||
      effect?.op !== 'counter' ||
      typeof effect.amount !== 'number' ||
      effect.counter === '$counter' ||
      effect.target !== '$' + choice.key
    )
      return undefined;
    let targets = live;
    const where = choice.options.where;
    if (where !== undefined) {
      if (
        typeof where !== 'object' ||
        !('cmp' in where) ||
        where.cmp !== 'ne' ||
        typeof where.right !== 'object' ||
        where.right === null ||
        !('ref' in where.right)
      )
        return undefined;
      const excluded = bindings[where.right.ref.slice(1)];
      targets = live.filter((n) => n !== excluded);
    }
    if (!targets.length) return visit(i + 1, offset, bindings, state);
    const report = reports[offset];
    // Positive placements on a character always publish its new count.
    // Removals can be silent on an empty card, so retain those earlier choices.
    const kind = effect.counter;
    if (effect.amount > 0) {
      if (!report || !targets.includes(report.name)) return false;
      targets = [report.name];
    } else {
      targets = targets.filter((n) => n === report?.name || state.get(n)![kind] === 0);
    }
    for (const n of targets) {
      if (attempts++ >= limit) return undefined;
      work.combinations++;
      const before = state.get(n)!,
        after = { ...before, [kind]: Math.max(0, before[kind] + effect.amount) };
      const visible = after[kind] !== before[kind];
      if (
        visible &&
        (!report ||
          report.name !== n ||
          Object.keys(before).some(
            (k) => report.after[k as keyof Counters] !== after[k as keyof Counters],
          ))
      )
        continue;
      const next = new Map(state);
      next.set(n, after);
      const match = visit(i + 1, offset + Number(visible), { ...bindings, [choice.key]: n }, next);
      if (match !== false) return match;
    }
    return false;
  }
  return visit(0, 0, {}, new Map([...pieces].map(([n, p]) => [n, p.counters])));
}
