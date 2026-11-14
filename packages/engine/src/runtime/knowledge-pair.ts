import type { Counter, PlayerView } from '../../../contracts/src/game.js';
import type { Step } from './model.js';
import type { VisibleChange } from './knowledge-effects.js';

interface Part {
  counter: Counter;
  amount: number;
}
type Pair = readonly [Part, Part];

// Recognise the actual selectors, including their named reference. Other
// programs keep their ordinary cause clauses and history verifier.
export function distinctCounterPair(steps: Step[]): Pair | undefined {
  if (steps.length !== 2) return;
  const parts: Part[] = [];
  const choices = steps.map((s) => s.choices?.[0]);
  for (const [i, step] of steps.entries()) {
    const c = choices[i],
      e = step.effects[0];
    if (
      !c ||
      c.optional ||
      step.moveOthersFromEffectiveArea ||
      step.condition !== undefined ||
      step.choices?.length !== 1 ||
      Array.isArray(c.options) ||
      c.options.kind !== 'alive' ||
      step.effects.length !== 1 ||
      e?.op !== 'counter' ||
      e.target !== '$' + c.key ||
      e.counter === '$counter' ||
      typeof e.amount !== 'number' ||
      !Number.isSafeInteger(e.amount)
    )
      return;
    const condition = c.options.where;
    if (i === 0) {
      if (condition !== undefined && condition !== true) return;
    } else {
      if (
        c.key === choices[0]!.key ||
        !condition ||
        typeof condition !== 'object' ||
        !('cmp' in condition) ||
        condition.cmp !== 'ne'
      )
        return;
      const refs = [condition.left, condition.right].map((v) =>
        v && typeof v === 'object' && 'ref' in v ? v.ref : undefined,
      );
      if (!refs.includes('$it') || !refs.includes('$' + choices[0]!.key)) return;
    }
    parts.push({ counter: e.counter, amount: e.amount });
  }
  return [parts[0]!, parts[1]!];
}
export type PairMode = 'ordinary' | 'repeated' | 'parallel';
type Report = { target: string; counter: Counter; before: number; after: number };
type Position = { step: number; first: string[]; pending: Report[] };

export class PairExecution {
  private positions: Position[] = [{ step: 0, first: [], pending: [] }];
  private ordinaryStep = 0;
  private firstTarget?: string;
  branches = 0;
  uncertain = false;
  constructor(
    private pair: Pair,
    private mode: PairMode,
    private budget = 4096,
  ) {}

  // For distinguishable steps, a visible change gives its target directly.
  // A silent first subtraction needs only one different living witness.
  private advanceOrdinary(
    actors: ReadonlyMap<string, PlayerView['characters'][number]>,
    change?: VisibleChange,
  ) {
    const [first, second] = this.pair;
    const actor = change && actors.get(change.target);
    const matches = (part: Part) =>
      actor?.status === 'alive' &&
      change?.kind === 'counter' &&
      change.counter === part.counter &&
      change.before === actor.counters[part.counter] &&
      change.after !== change.before &&
      change.after === Math.max(0, change.before + part.amount);
    const silent = (a: PlayerView['characters'][number]) =>
      Math.max(0, a.counters[first.counter] + first.amount) === a.counters[first.counter];
    if (!change) {
      const alive = [...actors.values()].filter((a) => a.status === 'alive');
      return (
        this.ordinaryStep === 2 ||
        (this.ordinaryStep === 1 && alive.every((a) => a.id === this.firstTarget)) ||
        (this.ordinaryStep === 0 &&
          (alive.length === 0 || (alive.length === 1 && silent(alive[0]!))))
      );
    }
    if (this.ordinaryStep === 0 && matches(first)) {
      this.firstTarget = change.target;
      this.ordinaryStep = 1;
      return true;
    }
    if (
      matches(second) &&
      ((this.ordinaryStep === 1 && this.firstTarget !== change.target) ||
        (this.ordinaryStep === 0 &&
          [...actors.values()].some(
            (a) => a.status === 'alive' && a.id !== change.target && silent(a),
          )))
    ) {
      this.ordinaryStep = 2;
      return true;
    }
    this.ordinaryStep = -1;
    return false;
  }

  advance(actors: ReadonlyMap<string, PlayerView['characters'][number]>, change?: VisibleChange) {
    if (
      this.mode === 'ordinary' &&
      this.pair[1].amount > 0 &&
      (this.pair[0].counter !== this.pair[1].counter || this.pair[0].amount < 0)
    )
      return this.advanceOrdinary(actors, change);
    if (this.uncertain) return true;
    const found = new Map<string, Position>();
    const alive = [...actors.values()].filter((a) => a.status === 'alive');
    let remaining = this.budget;
    const visit = (pos: Position) => {
      if (this.uncertain) return;
      if (pos.pending.length) {
        // A simultaneous step publishes each changed character once. Keep its
        // remaining reports across deliveries, independent of roster insertion order.
        const match = pos.pending.find(
          (r) =>
            change?.kind === 'counter' &&
            r.target === change.target &&
            r.counter === change.counter &&
            r.before === change.before &&
            r.after === change.after,
        );
        if (match) {
          const next = { ...pos, pending: pos.pending.filter((r) => r !== match) };
          found.set(JSON.stringify(next), next);
        }
        return;
      }
      if (pos.step === (this.mode === 'repeated' ? 4 : 2)) {
        if (!change) found.set('end', pos);
        return;
      }
      const second = pos.step % 2 === 1,
        part = this.pair[second ? 1 : 0];
      const choices = (lane: number) => {
        const targets = alive.map((a) => a.id).filter((id) => !second || id !== pos.first[lane]);
        if (!targets.length) return [''];
        // A single lane can advance only through an invisible choice or one
        // explaining this exact report. Parallel lanes may combine their deltas.
        if (this.mode === 'parallel') return targets;
        return targets.filter((id) => {
          const before = actors.get(id)!.counters[part.counter];
          const after = Math.max(0, before + part.amount);
          return (
            before === after ||
            (change?.kind === 'counter' &&
              change.target === id &&
              change.counter === part.counter &&
              change.before === before &&
              change.after === after)
          );
        });
      };
      const resolve = (targets: string[]) => {
        if (--remaining < 0) {
          this.uncertain = true;
          return;
        }
        this.branches++;
        const pending: Report[] = [];
        for (const target of new Set(targets)) {
          const actor = actors.get(target);
          if (!actor) continue;
          const before = actor.counters[part.counter];
          const amount = part.amount * targets.filter((id) => id === target).length;
          const after = Math.max(0, before + amount);
          if (before !== after) pending.push({ target, counter: part.counter, before, after });
        }
        visit({ step: pos.step + 1, first: second ? [] : targets, pending });
      };
      const firstLane = choices(0);
      if (this.mode !== 'parallel') {
        for (const first of firstLane) {
          if (this.uncertain) return;
          resolve([first]);
        }
        return;
      }
      const secondLane = choices(1);
      // Both lanes apply the same signed amount. With no report from this
      // step, both choices must be silent even if they hit the same actor.
      const silent = (id: string) => {
        const actor = actors.get(id);
        if (!actor) return true;
        const before = actor.counters[part.counter];
        return Math.max(0, before + part.amount) === before;
      };
      const silentSecond = secondLane.filter(silent);
      for (const first of firstLane.filter(silent))
        for (const other of silentSecond) {
          if (this.uncertain) return;
          resolve([first, other]);
        }
      if (this.uncertain || change?.kind !== 'counter' || change.counter !== part.counter) return;
      const target = change.target;
      const before = actors.get(target)?.counters[part.counter];
      if (before === undefined || before !== change.before || change.after === before) return;
      const inFirst = firstLane.includes(target),
        inSecond = secondLane.includes(target);
      // A visible step must account for this report now. A different target
      // in the other lane may have its own report pending in the same batch.
      if (change.after === Math.max(0, before + part.amount)) {
        if (inFirst)
          for (const other of secondLane) {
            if (this.uncertain) return;
            if (other !== target) resolve([target, other]);
          }
        if (inSecond)
          for (const first of firstLane) {
            if (this.uncertain) return;
            if (first !== target) resolve([first, target]);
          }
      }
      if (
        !this.uncertain &&
        inFirst &&
        inSecond &&
        change.after === Math.max(0, before + 2 * part.amount)
      )
        resolve([target, target]);
    };
    for (const pos of this.positions) visit(pos);
    this.positions = [...found.values()];
    return this.uncertain || this.positions.length > 0;
  }
}
