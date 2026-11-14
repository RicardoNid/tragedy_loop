/** Finite domains with declared dependencies. No Cartesian product is built at initialization. */
export type Domains = Map<string, Set<string>>;
export interface Constraint {
  cause?: boolean;
  name: string;
  reads: string[];
  revise: (store: ConstraintStore) => void;
}
export interface PropagationStats {
  checks: number;
  removed: number;
  branches: number;
}
export class ConstraintStore {
  readonly domains: Domains;
  readonly constraints: Constraint[] = [];
  private dependencies = new Map<string, Set<number>>();
  private queue = new Set<number>();
  private invalid = false;
  constructor(
    domains: Domains,
    readonly stats: PropagationStats = { checks: 0, removed: 0, branches: 0 },
  ) {
    this.domains = new Map([...domains].map(([key, values]) => [key, new Set(values)]));
  }
  add(constraint: Constraint) {
    const index = this.constraints.push(constraint) - 1;
    for (const key of constraint.reads) {
      const readers = this.dependencies.get(key) ?? new Set<number>();
      readers.add(index);
      this.dependencies.set(key, readers);
    }
    this.queue.add(index);
  }
  upsert(constraint: Constraint) {
    const index = this.constraints.findIndex((c) => c.name === constraint.name);
    if (index < 0) {
      this.add(constraint);
      return;
    }
    for (const key of this.constraints[index]!.reads) this.dependencies.get(key)?.delete(index);
    this.constraints[index] = constraint;
    for (const key of constraint.reads) {
      const readers = this.dependencies.get(key) ?? new Set<number>();
      readers.add(index);
      this.dependencies.set(key, readers);
    }
    this.queue.add(index);
  }
  invalidate() {
    this.invalid = true;
  }
  values(key: string) {
    return this.domains.get(key)!;
  }
  narrow(key: string, allowed: Iterable<string>) {
    const keep = new Set(allowed),
      values = this.values(key);
    let changed = false;
    for (const value of values)
      if (!keep.has(value)) {
        values.delete(value);
        this.stats.removed++;
        changed = true;
      }
    if (changed) for (const reader of this.dependencies.get(key) ?? []) this.queue.add(reader);
    return changed;
  }
  get consistent() {
    return !this.invalid && [...this.domains.values()].every((values) => values.size > 0);
  }
  related(keys: Iterable<string>) {
    const result = new Set(keys),
      visited = new Set<number>();
    for (const key of result) {
      if (this.values(key).size <= 1) continue;
      for (const index of this.dependencies.get(key) ?? []) {
        const constraint = this.constraints[index]!;
        if (constraint.cause || visited.has(index)) continue;
        visited.add(index);
        for (const other of constraint.reads) if (this.values(other).size > 1) result.add(other);
      }
    }
    return result;
  }
  propagate(all = false, skipCauses = false) {
    if (all) this.constraints.forEach((_, index) => this.queue.add(index));
    while (this.queue.size && this.consistent) {
      const index = this.queue.values().next().value!;
      this.queue.delete(index);
      if (skipCauses && this.constraints[index]!.cause) continue;
      this.stats.checks++;
      this.constraints[index]!.revise(this);
    }
    return this.consistent;
  }
  // Test a local conjunction against quotas, event/culprit pairs and other
  // ordinary constraints without feeding a speculative cause back into itself.
  probe(selected: ReadonlyMap<string, string>) {
    if ([...selected.keys()].every((k) => this.values(k).size === 1)) return this;
    const copy = this.clone({ checks: 0, removed: 0, branches: 0 });
    copy.queue = new Set(this.queue);
    for (const [key, value] of selected) copy.narrow(key, [value]);
    return copy.propagate(false, true) ? copy : undefined;
  }
  clone(stats = this.stats) {
    const copy = new ConstraintStore(this.domains, stats);
    copy.invalid = this.invalid;
    // Source is at a fixed point. A branch wakes only dependencies of its assignment.
    copy.constraints.push(...this.constraints);
    // New observations can add constraints to the source while a search branch is suspended.
    copy.dependencies = new Map(
      [...this.dependencies].map(([key, readers]) => [key, new Set(readers)]),
    );
    return copy;
  }
}

export function relation(
  name: string,
  a: string,
  b: string,
  allows: (a: string, b: string) => boolean,
): Constraint {
  return {
    name,
    reads: [a, b],
    revise(s) {
      s.narrow(
        a,
        [...s.values(a)].filter((x) => [...s.values(b)].some((y) => allows(x, y))),
      );
      s.narrow(
        b,
        [...s.values(b)].filter((y) => [...s.values(a)].some((x) => allows(x, y))),
      );
    },
  };
}

/** Matching against identity slots handles Hall conflicts as well as ordinary quota propagation. */
export function allocation(
  keys: string[],
  slots: string[],
  identity = (value: string) => value,
  exact = true,
): Constraint {
  function feasible(s: ConstraintStore, forcedKey?: string, forcedValue?: string) {
    if (exact ? keys.length !== slots.length : keys.length > slots.length) return false;
    const owner = new Array<number>(slots.length).fill(-1);
    function place(index: number, visited: Set<number>): boolean {
      const key = keys[index]!;
      const allowed =
        key === forcedKey
          ? new Set([identity(forcedValue!)])
          : new Set([...s.values(key)].map(identity));
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot) || !allowed.has(slots[slot]!)) continue;
        visited.add(slot);
        if (owner[slot] === -1 || place(owner[slot]!, visited)) {
          owner[slot] = index;
          return true;
        }
      }
      return false;
    }
    return keys.every((_, index) => place(index, new Set()));
  }
  return {
    name: 'identity-allocation',
    reads: keys,
    revise(s) {
      if (!keys.length) return;
      if (!feasible(s)) {
        s.narrow(keys[0]!, []);
        return;
      }
      for (const key of keys)
        s.narrow(
          key,
          [...s.values(key)].filter((value) => feasible(s, key, value)),
        );
    },
  };
}

export function exactlyOne(keys: string[], value: string): Constraint {
  return {
    name: 'exactly-one',
    reads: keys,
    revise(s) {
      const possible = keys.filter((key) => s.values(key).has(value));
      const fixed = possible.filter((key) => s.values(key).size === 1);
      if (!possible.length || fixed.length > 1) {
        if (keys[0]) s.narrow(keys[0], []);
        return;
      }
      if (possible.length === 1) s.narrow(possible[0]!, [value]);
      if (fixed.length === 1)
        for (const key of keys)
          if (key !== fixed[0])
            s.narrow(
              key,
              [...s.values(key)].filter((v) => v !== value),
            );
    },
  };
}

/** Suspend at every branch; callers control CPU time and do not need a complete assignment list. */
export function* assignments(
  store: ConstraintStore,
  current?: () => Domains | undefined,
): Generator<Domains | null> {
  if (current) {
    const latest = current();
    if (!latest) return;
    for (const [key, values] of latest) store.narrow(key, values);
  }
  if (!store.propagate()) return;
  const unsettled = [...store.domains]
    .filter(([, values]) => values.size > 1)
    .sort((a, b) => a[1].size - b[1].size);
  if (!unsettled.length) {
    yield store.domains;
    return;
  }
  const [key, values] = unsettled[0]!;
  for (const value of values) {
    store.stats.branches++;
    yield null;
    const next = store.clone();
    next.narrow(key, [value]);
    yield* assignments(next, current);
  }
}
