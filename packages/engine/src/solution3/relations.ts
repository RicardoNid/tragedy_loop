/** Signed integers are literals. A relation bounds the count of true literals when its guard holds. */
export type Literal = number;
export interface CountRelation {
  reason: string;
  dependencies?: readonly number[];
  terms: Literal[];
  min: number;
  max: number;
  guard?: Literal;
  project?: boolean;
  weighted?: { base: number; terms: { literal: number; weight: number }[] };
}
export interface Work {
  checks: number;
  sources: string[];
  combinations: number;
  configurations: number;
}
export const newWork = (): Work => ({ checks: 0, sources: [], combinations: 0, configurations: 0 });
function infer(rule: CountRelation, truth: (lit: number) => boolean | undefined): number[] | false {
  const { guard, terms, min, max } = rule;
  if (guard && truth(guard) === false) return [];
  if (rule.weighted) {
    let fixed = rule.weighted.base;
    const open = rule.weighted.terms.filter(({ literal, weight }) => {
      const v = truth(literal);
      if (v === true) fixed += weight;
      return v === undefined;
    });
    // Bit k is reachable iff some assignment of the remaining distinct atoms has sum k.
    const mask = (lo: number, hi: number) => {
      lo = Math.max(0, lo);
      return hi < lo ? 0n : ((1n << BigInt(hi - lo + 1)) - 1n) << BigInt(lo);
    };
    const allowed = mask(min - fixed, Math.min(terms.length, max - fixed));
    const sums = (omit = -1) => {
      let bits = 1n;
      for (let i = 0; i < open.length; i++) if (i !== omit) bits |= bits << BigInt(open[i]!.weight);
      return bits;
    };
    if (!(sums() & allowed)) return guard ? [-guard] : false;
    if (guard && truth(guard) !== true) return [];
    const forced: number[] = [];
    for (const [i, t] of open.entries()) {
      const bits = sums(i);
      if (!(bits & allowed)) forced.push(t.literal);
      else if (!((bits << BigInt(t.weight)) & allowed)) forced.push(-t.literal);
    }
    return forced;
  }
  let yes = 0;
  const open: number[] = [];
  for (const lit of terms) {
    const v = truth(lit);
    if (v === true) yes++;
    else if (v === undefined) open.push(lit);
  }
  if (yes > max || yes + open.length < min) return guard ? [-guard] : false;
  if (guard && !truth(guard)) return [];
  if (yes === max) return open.map((x) => -x);
  return yes + open.length === min ? open : [];
}
export class Relations {
  readonly names = [''];
  private readonly ids = new Map<string, number>();
  readonly values = new Map<number, { value: boolean; relation: number; premises: number[] }>();
  readonly rules: CountRelation[] = [];
  private readonly watchers = new Map<number, number[]>();
  private readonly queue = new Set<number>();
  readonly projections = new Map<number, number[]>();
  readonly unsupported = new Set<string>();
  readonly touched = new Set<number>();
  conflict?: number;
  private accepted = 0;
  work = newWork();
  atom(name: string) {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.ids.set(name, id);
      this.names.push(name);
    }
    return id;
  }
  truth(literal: number) {
    const entry = this.values.get(Math.abs(literal));
    return entry && (literal > 0 ? entry.value : !entry.value);
  }
  add(
    reason: string,
    terms: number[],
    min: number,
    max = terms.length,
    guard?: number,
    project = false,
    dependencies?: readonly number[],
  ) {
    if (
      [...terms, ...(guard === undefined ? [] : [guard])].some(
        (a) => !Number.isSafeInteger(a) || a === 0 || Math.abs(a) >= this.names.length,
      ) ||
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max)
    ) {
      this.unsupported.add(reason + ' · 命题或数量未绑定');
      return;
    }
    const id = this.rules.length;
    const rule: CountRelation = { reason, terms, min, max, guard, project, dependencies };
    if (new Set(terms.map(Math.abs)).size !== terms.length) {
      const weights = new Map<number, number>();
      let base = 0;
      for (const lit of terms) {
        if (lit < 0) base++;
        weights.set(Math.abs(lit), (weights.get(Math.abs(lit)) ?? 0) + Math.sign(lit));
      }
      const distinct = [];
      for (const [a, n] of weights) {
        if (n < 0) base += n;
        if (n) distinct.push({ literal: Math.sign(n) * a, weight: Math.abs(n) });
      }
      rule.weighted = { base, terms: distinct };
    }
    this.rules.push(rule);
    for (const key of new Set([...terms, ...(guard ? [guard] : [])].map(Math.abs))) {
      const watching = this.watchers.get(key) ?? [];
      watching.push(id);
      this.watchers.set(key, watching);
    }
    if (project)
      for (const lit of terms.filter((x) => x > 0)) {
        this.projections.set(lit, [...(this.projections.get(lit) ?? []), id]);
      }
    this.queue.add(id);
  }
  private assign(literal: number, relation: number) {
    if (this.truth(literal) === false) {
      this.conflict = relation;
      return;
    }
    if (this.truth(literal)) return;
    const rule = this.rules[relation]!;
    const premises = [
      ...new Set([...(rule.guard ? [rule.guard] : []), ...rule.terms].map(Math.abs)),
    ].filter((x) => this.values.has(x));
    this.values.set(Math.abs(literal), { value: literal > 0, relation, premises });
    for (const r of this.watchers.get(Math.abs(literal)) ?? []) this.queue.add(r);
  }
  propagate() {
    const added: number[] = [];
    while (this.queue.size && this.conflict === undefined) {
      const id = this.queue.values().next().value!;
      this.queue.delete(id);
      this.work.checks++;
      this.touched.add(id);
      const force = infer(this.rules[id]!, (lit) => this.truth(lit));
      if (force === false) {
        this.conflict = id;
        break;
      }
      for (const literal of force) {
        if (this.truth(literal) === undefined) added.push(Math.abs(literal));
        this.assign(literal, id);
      }
    }
    if (this.conflict !== undefined) for (const id of added) this.values.delete(id);
    else this.accepted = this.rules.length;
  }
  private probe(
    reason: string,
    cause: number,
    proof: Set<number>,
  ): Map<number, boolean> | false | undefined {
    this.work.combinations++;
    const overlay = new Map<number, boolean>([[Math.abs(cause), cause > 0]]);
    const truth = (lit: number) =>
      overlay.has(Math.abs(lit)) ? overlay.get(Math.abs(lit)) === lit > 0 : this.truth(lit);
    const pending = new Set([...this.queue, ...(this.watchers.get(Math.abs(cause)) ?? [])]);
    let viable = true,
      budget = 10000;
    while (pending.size && viable) {
      if (--budget < 0) {
        this.unsupported.add(reason + ' · 局部来源传播预算');
        return;
      }
      const id = pending.values().next().value!;
      pending.delete(id);
      this.work.checks++;
      this.touched.add(id);
      const rule = this.rules[id]!;
      const deductions = infer(rule, truth);
      if (deductions === false || deductions.some((d) => truth(d) !== true)) {
        proof.add(id);
        for (const lit of rule.guard ? [...rule.terms, rule.guard] : rule.terms) {
          const fixed = this.values.get(Math.abs(lit));
          if (fixed) proof.add(fixed.relation);
        }
      }
      if (deductions === false) {
        viable = false;
        break;
      }
      for (const d of deductions) {
        if (truth(d) === false) {
          viable = false;
          break;
        }
        if (truth(d) === true) continue;
        overlay.set(Math.abs(d), d > 0);
        for (const r of this.watchers.get(Math.abs(d)) ?? []) pending.add(r);
      }
    }
    return viable ? overlay : false;
  }
  refute(reason: string, atoms: Iterable<number>) {
    for (const atom of atoms) {
      if (this.truth(atom) !== undefined) continue;
      const proof = new Set<number>();
      if (this.probe(reason, atom, proof) === false)
        this.add(
          reason + ' · 假设' + this.names[atom] + '将违反已成立的关系',
          [-atom],
          1,
          1,
          undefined,
          false,
          [...proof],
        );
    }
  }
  /** Try each local cause once. Only conclusions common to every surviving cause are installed. */
  resolveCauses(reason: string, causes: number[], project?: readonly number[]) {
    if (causes.length < 2) return;
    let common: Set<number> | undefined;
    const jointProof = new Set<number>();
    for (const cause of causes) {
      if (this.truth(cause) === false) continue;
      const proof = new Set<number>();
      const overlay = this.probe(reason, cause, proof);
      for (const id of proof) jointProof.add(id);
      if (overlay === undefined) return;
      if (overlay === false) {
        this.add(reason + ' · 此来源与制作或历史约束冲突', [-cause], 1, 1, undefined, false, [
          ...proof,
        ]);
        continue;
      }
      const candidates = project ?? overlay.keys();
      const implied = Array.from(candidates).flatMap((a) =>
        this.truth(a) === undefined && overlay.has(a) ? [overlay.get(a) ? a : -a] : [],
      );
      common = new Set(implied.filter((a) => common === undefined || common.has(a)));
    }
    const dependencies = [...jointProof];
    for (const lit of common ?? [])
      this.add(reason + ' · 各来源与身份名额共同要求', [lit], 1, 1, undefined, false, dependencies);
  }
  private projects(id: number, atom: number) {
    const rule = this.rules[id]!;
    if (id >= this.accepted || (rule.guard && this.truth(rule.guard) !== true)) return false;
    if (rule.weighted) {
      const { base, terms } = rule.weighted;
      if (!terms.some((t) => t.literal === atom)) return false;
      return terms.reduce((n, t) => n + (this.truth(t.literal) ? t.weight : 0), base) < rule.min;
    }
    let established = 0;
    for (const term of rule.terms) if (this.truth(term) && ++established >= rule.min) return false;
    return established < rule.min;
  }
  reasons(atom: number) {
    const reasons = new Set<string>();
    const seenRules = new Set<number>();
    const includeRule = (id: number) => {
      const stack = [id];
      while (stack.length) {
        const i = stack.pop()!;
        if (seenRules.has(i)) continue;
        seenRules.add(i);
        const rule = this.rules[i]!;
        reasons.add(rule.reason);
        if (rule.dependencies) stack.push(...rule.dependencies);
      }
    };
    const visited = new Set<number>(),
      queue = [atom];
    while (queue.length) {
      const a = queue.pop()!;
      if (visited.has(a)) continue;
      visited.add(a);
      const proof = this.values.get(a);
      if (proof) {
        includeRule(proof.relation);
        queue.push(...proof.premises);
      } else
        for (const i of this.projections.get(a) ?? []) {
          const r = this.rules[i]!;
          if (this.projects(i, a)) {
            includeRule(i);
            if (r.guard) queue.push(Math.abs(r.guard));
          }
        }
    }
    return [...reasons];
  }
  mark(atom: number): '' | '√' | '×' | '？' {
    const truth = this.truth(atom);
    if (truth !== undefined) return truth ? '√' : '×';
    if (this.projections.get(atom)?.some((i) => this.projects(i, atom))) return '？';
    return '';
  }
}
