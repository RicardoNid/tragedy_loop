/** Finite domains with declared dependencies. No Cartesian product is built at initialization. */
export type Domains = Map<string, Set<string>>;
export interface Constraint {
  cause?: boolean;
  /** Actual hidden inputs. reads may also contain variables that merely wake propagation. */
  inputs?: string[];
  neighbors?: (store: ConstraintStore, key: string) => string[];
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
  private setupCount = 0;
  private settlementInputs?: Set<string>;
  private propagating = false;

  finishSetup() {
    this.setupCount = this.constraints.length;
  }
  beginSettlement() {
    this.settlementInputs = new Set();
  }
  /** Enumerate evidence inputs only. Allocation, copying and legal event pairs propagate on each branch. */
  finishSettlement(compound: boolean, budget: number) {
    const inputs = this.settlementInputs;
    this.settlementInputs = undefined;
    const keys = new Set<string>();
    let branches = 0, complete = true;
    if (!compound || !inputs?.size || !this.consistent) return { keys, branches, complete };
    const evidence = new Set(inputs);
    for (const factor of this.constraints.slice(this.setupCount))
      for (const key of factor.inputs ?? factor.reads) evidence.add(key);
    for (const seed of inputs) {
      if (!this.consistent || keys.has(seed) || this.values(seed).size <= 1) continue;
      const connected = this.related([seed], true);
      // Setup-only slots transmit quotas or copy constraints but stay symbolic.
      const component = [...connected].filter(k => evidence.has(k) && this.values(k).size > 1);
      for (const k of component) keys.add(k);
      if (component.length < 2) continue;
      const result = this.projectComponent(component, budget - branches);
      branches += result.branches;
      complete &&= result.complete;
    }
    return { keys, branches, complete };
  }
  private projectComponent(component: string[], budget: number) {
    let branches = 0, complete = true;
    const ordered = component.sort((a,b) => this.values(a).size - this.values(b).size);
    const support: Domains = new Map(ordered.map(k => [k, new Set<string>()]));
    const covered = () => ordered.every(k => support.get(k)!.size === this.values(k).size);
    const visit = (s: ConstraintStore, index: number) => {
      while (index < ordered.length && s.values(ordered[index]!).size === 1) index++;
      if (index === ordered.length) {
        for (const key of ordered) support.get(key)!.add(s.values(key).values().next().value!);
        return;
      }
      const key = ordered[index]!;
      for (const value of s.values(key)) {
        if (branches >= budget) { complete = false; return; }
        branches++;
        const next = s.clone({ checks: 0, removed: 0, branches: 0 });
        next.narrow(key, [value]);
        if (next.propagate()) visit(next, index + 1);
        if (!complete || covered()) return;
      }
    };
    visit(this, 0);
    if (complete) {
      for (const [key, values] of support) this.narrow(key, values);
      this.propagate();
    }
    return { branches, complete };
  }
  constructor(
    domains: Domains,
    readonly stats: PropagationStats = { checks: 0, removed: 0, branches: 0 },
  ) {
    this.domains = new Map([...domains].map(([key, values]) => [key, new Set(values)]));
  }
  add(constraint: Constraint) {
    for (const k of constraint.inputs ?? constraint.reads) this.settlementInputs?.add(k);
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
    for (const k of constraint.inputs ?? constraint.reads) this.settlementInputs?.add(k);
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
    if (changed && !this.propagating) this.settlementInputs?.add(key);
    if (changed) for (const reader of this.dependencies.get(key) ?? []) this.queue.add(reader);
    return changed;
  }
  get consistent() {
    return !this.invalid && [...this.domains.values()].every((values) => values.size > 0);
  }
  related(keys: Iterable<string>, includeCauses = false) {
    const result = new Set(keys),
      visited = new Set<number>();
    for (const key of result) {
      if (this.values(key).size <= 1) continue;
      for (const index of this.dependencies.get(key) ?? []) {
        const constraint = this.constraints[index]!;
        if ((!includeCauses && constraint.cause) || visited.has(index)) continue;
        const inputs = constraint.inputs ?? constraint.reads;
        if (!inputs.includes(key)) continue;
        if (!constraint.neighbors) visited.add(index);
        for (const other of constraint.neighbors?.(this, key) ?? inputs)
          if (this.values(other).size > 1) result.add(other);
      }
    }
    return result;
  }
  propagate(all = false, skipCauses = false) {
    if (all) this.constraints.forEach((_, index) => this.queue.add(index));
    this.propagating = true;
    while (this.queue.size && this.consistent) {
      const index = this.queue.values().next().value!;
      this.queue.delete(index);
      if (skipCauses && this.constraints[index]!.cause) continue;
      this.stats.checks++;
      this.constraints[index]!.revise(this);
    }
    this.propagating = false;
    return this.consistent;
  }
  // Test a local conjunction against quotas, event/culprit pairs and other
  // ordinary constraints without feeding a speculative cause back into itself.
  probe(selected: ReadonlyMap<string, string>) {
    if ([...selected].some(([k,v]) => !this.values(k).has(v))) return;
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
    neighbors(store, key) {
      const roles = new Set([...store.values(key)].map(identity));
      return keys.filter(k => [...store.values(k)].some(v => roles.has(identity(v))));
    },
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

export function atLeastOne(keys: string[], value: string): Constraint {
  return {
    name: 'at-least-one-' + value,
    reads: keys,
    revise(s) {
      const possible = keys.filter((key) => s.values(key).has(value));
      if (!possible.length) s.invalidate();
      else if (possible.length === 1) s.narrow(possible[0]!, [value]);
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
