import type { Constraint } from './knowledge-constraints.js';
import type { Profile } from './knowledge-domain.js';

export interface Cause {
  /** Selected plots contributed by component causes in the same branch. */
  componentPlots?: string[];
  label: string;
  category: 'character' | 'rule' | 'event' | 'joint';
  maxContribution?: number;
  rule?: string;
  owner?: string;
  ability?: string;
  requires: { key: string; value: string }[];
  choices?: { key: string; value: string; different?: boolean }[];
  resources: {
    key: string;
    limit: number;
    label: string;
    activation?: { window: string; limit: number };
  }[];
  notes: string[];
}
export interface CauseRecord {
  key?: string;
  observation: number;
  phase: string;
  alternatives: Cause[];
}
interface Component {
  name: string;
  records: CauseRecord[];
  links: Set<string>;
}
// Saturation and opposing effects can hide contributions. A visible net change
// gives a lower bound: retain every minimal set that can reach that bound.
export function counterCauses(
  causes: Cause[],
  delta: number,
  budget = 4096,
  work?: { branches: number },
): Cause[] | undefined {
  if (delta <= 1 || causes.every((c) => (c.maxContribution ?? Infinity) >= delta)) return causes;
  const result = causes.filter((c) => (c.maxContribution ?? Infinity) >= delta);
  const small = causes.filter((c) => (c.maxContribution ?? Infinity) < delta);
  const suffix = new Array<number>(small.length + 1).fill(0);
  for (let i = small.length - 1; i >= 0; i--)
    suffix[i] = suffix[i + 1]! + small[i]!.maxContribution!;
  const path: Cause[] = [];
  function visit(start: number, total: number): boolean {
    if (--budget < 0 || path.length > 256) return false;
    if (work && path.length) work.branches++;
    if (total >= delta) {
      if (path.some((c) => total - c.maxContribution! >= delta)) return true;
      const guards = new Map<string, string>();
      for (const c of path)
        for (const g of c.requires) {
          if (guards.has(g.key) && guards.get(g.key) !== g.value) return true;
          guards.set(g.key, g.value);
        }
      const choices = path.flatMap((c) => c.choices ?? []);
      if (
        choices.some(
          (a) =>
            !a.different &&
            choices.some(
              (b) => a.key === b.key && (b.different ? a.value === b.value : a.value !== b.value),
            ),
        )
      )
        return true;
      result.push({
        choices,
        componentPlots: [...new Set(path.flatMap(c => c.rule ? [c.rule] : c.componentPlots ?? []))],
        category: 'joint',
        label: path.map((c) => c.label).join(' ＋ '),
        requires: [...guards].map(([key, value]) => ({ key, value })),
        resources: path.flatMap((c) => c.resources),
        notes: [...new Set([...path.flatMap((c) => c.notes), '净变化至少需要这些来源共同贡献。'])],
      });
      return true;
    }
    for (let i = start; i < small.length && total + suffix[i]! >= delta; i++) {
      const c = small[i]!;
      path.push(c);
      if (!visit(i + 1, total + c.maxContribution!)) return false;
      path.pop();
    }
    return true;
  }
  return visit(0, 0) ? result : undefined;
}
export class CauseNetwork {
  readonly byObservation = new Map<number | string, CauseRecord>();
  readonly excludedCauses = new Set<Cause>();
  private components: Component[] = [];
  checks = 0;
  joins = 0;
  uncertain = false;
  constructor(
    private quota: Map<string, number>,
    private ordinary: Set<string>,
    private budget = 20000,
  ) {}
  add(p: Profile, record: CauseRecord) {
    this.addMany(p, [record]);
  }
  addMany(p: Profile, records: CauseRecord[]) {
    for (const record of records) this.install(p, record);
    p.active = p.store.propagate();
  }
  private install(p: Profile, record: CauseRecord) {
    this.byObservation.set(record.key ?? record.observation, record);
    // A fixed global incident can produce many public reports. Its trigger
    // already constrains the culprit, and these reports spend no resources.
    const sole = record.alternatives.length === 1 && record.alternatives[0];
    if (
      record.phase === 'incident' &&
      sole &&
      sole.category === 'event' &&
      !sole.resources.length &&
      !sole.choices?.length &&
      sole.requires.length === 1
    ) {
      const guard = sole.requires[0]!;
      const domain = p.store.values(guard.key);
      if (guard.key.startsWith('event:') && domain.size === 1 && domain.has(guard.value)) return;
    }
    const links = new Set(
      record.alternatives.flatMap((a) => [
        ...a.requires.map((r) => r.key),
        ...a.resources.map((r) => r.key),
        ...(a.choices ?? []).map((c) => c.key),
        ...a.requires.filter((r) => this.ordinary.has(r.key)).map((r) => `quota:${r.value}`),
      ]),
    );
    for (const key of p.store.related(
      record.alternatives.flatMap((a) => a.requires.map((g) => g.key)),
    ))
      links.add(key);
    const connected = this.components.filter((c) => [...c.links].some((k) => links.has(k)));
    if (connected.length) this.joins++;
    const records = [...connected.flatMap((c) => c.records), record];
    for (const c of connected) {
      for (const k of c.links) links.add(k);
      p.store.upsert({ name: c.name, reads: [], revise() {} });
    }
    this.components = this.components.filter((c) => !connected.includes(c));
    const component = { name: `cause:${record.key ?? record.observation}`, records, links };
    this.components.push(component);
    const reads = [
      ...new Set(
        records.flatMap((r) => r.alternatives.flatMap((a) => a.requires.map((r) => r.key))),
      ),
    ];
    const capacities = new Map<string, number>();
    for (const r of records)
      for (const a of r.alternatives)
        for (const resource of a.resources)
          capacities.set(resource.key, Math.max(capacities.get(resource.key) ?? 0, resource.limit));
    // Direct reports from different phases cannot be one activation.
    // Reports within a phase can share the same activation.
    const windowLimits = new Map<string, number>();
    for (const r of records)
      for (const a of r.alternatives)
        for (const res of a.resources) {
          if (!res.activation) continue;
          windowLimits.set(res.key, Math.max(windowLimits.get(res.key) ?? 0, res.activation.limit));
        }
    const constraint: Constraint = {
      name: component.name,
      inputs: reads,
      reads:
        records.length === 1 && record.alternatives.every((a) => a.requires.length <= 1)
          ? reads
          : [...p.store.related(reads)],
      cause: true,
      revise: (store) => {
        // Every field is a necessary disjunction. Intersect those projections
        // first, even for a multi-report component. Unmentioned variables are free.
        const possible = (a: Cause) =>
          !this.excludedCauses.has(a) &&
          a.resources.every((r) => r.limit >= 1) &&
          a.requires.every(
            (g) =>
              store.values(g.key).has(g.value) &&
              (!this.ordinary.has(g.key) || (this.quota.get(g.value) ?? Infinity) >= 1),
          );
        const rows: Cause[][] = [];
        for (const r of records) {
          const row = r.alternatives.filter(possible);
          if (!row.length) return store.invalidate();
          // All remaining explanations consume the single ordinary slot for the
          // same identity. Project that disjunction onto the rest of the roster.
          const guard = row[0]!.requires[0];
          if (
            guard &&
            this.quota.get(guard.value) === 1 &&
            row.every(
              (a) =>
                a.requires.length === 1 &&
                a.requires[0]!.value === guard.value &&
                this.ordinary.has(a.requires[0]!.key),
            )
          ) {
            const owners = new Set(row.map((a) => a.requires[0]!.key));
            for (const key of this.ordinary) {
              const domain = store.domains.get(key);
              if (domain?.has(guard.value) && !owners.has(key))
                store.narrow(
                  key,
                  [...domain].filter((v) => v !== guard.value),
                );
            }
          }
          for (const { key } of row[0]!.requires) {
            if (row.some((a) => a.requires.every((g) => g.key !== key))) continue;
            store.narrow(
              key,
              row.flatMap((a) => a.requires.filter((g) => g.key === key).map((g) => g.value)),
            );
          }
          rows.push(row);
        }
        if (
          !store.consistent ||
          (rows.length === 1 &&
            rows[0]!.every(
              (a) =>
                a.category !== 'joint' &&
                a.requires.filter((g) => store.values(g.key).size > 1).length <= 1,
            ))
        )
          return;
        if (rows.length > 1000) {
          this.uncertain = true;
          return;
        }
        const candidates = rows
          .map((row) => row.filter(possible))
          .sort((a, b) => a.length - b.length);
        if (candidates.some((row) => !row.length)) return store.invalidate();
        const supported = new Set<Cause>();
        const allCauses = new Set(candidates.flat());
        const values = new Map(reads.map((key) => [key, new Set<string>()]));
        const selected = new Map<string, string>();
        const counts = new Map<string, number>();
        const used = new Map<string, number>();
        const windows = new Map<string, Set<string>>();
        const bindings = new Map<string, string>();
        const forbidden = new Map<string, Set<string>>();
        const path: Cause[] = [];
        let remaining = this.budget,
          exhausted = false,
          complete = false,
          found = false;
        const visit = (index: number) => {
          if (index === candidates.length) {
            const projection = store.probe(selected);
            if (!projection) return;
            found = true;
            for (const a of path) supported.add(a);
            for (const [key, supportedValues] of values) {
              for (const v of projection.values(key))
                if (
                  !this.ordinary.has(key) ||
                  selected.get(key) === v ||
                  (counts.get(v) ?? 0) < (this.quota.get(v) ?? Infinity)
                )
                  supportedValues.add(v);
            }
            complete =
              supported.size === allCauses.size &&
              reads.every((key) => values.get(key)!.size === store.values(key).size);
            return;
          }
          for (const a of candidates[index]!) {
            if (remaining-- <= 0) {
              exhausted = true;
              return;
            }
            this.checks++;
            if (a.requires.some((g) => selected.has(g.key) && selected.get(g.key) !== g.value))
              continue;
            if (
              a.choices?.some((c) =>
                c.different
                  ? bindings.get(c.key) === c.value
                  : (bindings.has(c.key) && bindings.get(c.key) !== c.value) ||
                    forbidden.get(c.key)?.has(c.value),
              )
            )
              continue;
            const added = a.requires.filter((g) => !selected.has(g.key));
            for (const g of added) {
              selected.set(g.key, g.value);
              if (this.ordinary.has(g.key)) counts.set(g.value, (counts.get(g.value) ?? 0) + 1);
            }
            if (
              added.every(
                (g) => (counts.get(g.value) ?? 0) <= (this.quota.get(g.value) ?? Infinity),
              )
            ) {
              const addedWindows = [];
              let fits = true;
              for (const r of a.resources) {
                used.set(r.key, (used.get(r.key) ?? 0) + 1);
                if (used.get(r.key)! > capacities.get(r.key)!) fits = false;
                if (!r.activation) continue;
                const active = windows.get(r.key) ?? new Set<string>();
                if (!active.has(r.activation.window)) {
                  active.add(r.activation.window);
                  if (active.size > windowLimits.get(r.key)!) fits = false;
                  windows.set(r.key, active);
                  addedWindows.push({ active, window: r.activation.window });
                }
              }
              const addedChoices = [];
              for (const c of a.choices ?? []) {
                if (c.different) {
                  const blocked = forbidden.get(c.key) ?? new Set<string>();
                  if (blocked.has(c.value)) continue;
                  blocked.add(c.value);
                  forbidden.set(c.key, blocked);
                } else {
                  if (bindings.has(c.key)) continue;
                  bindings.set(c.key, c.value);
                }
                addedChoices.push(c);
              }
              path.push(a);
              if (fits) visit(index + 1);
              path.pop();
              for (const c of addedChoices) {
                if (c.different) forbidden.get(c.key)!.delete(c.value);
                else bindings.delete(c.key);
              }
              for (const w of addedWindows) w.active.delete(w.window);
              for (const r of a.resources) used.set(r.key, used.get(r.key)! - 1);
            }
            for (const g of added) {
              selected.delete(g.key);
              if (this.ordinary.has(g.key)) counts.set(g.value, counts.get(g.value)! - 1);
            }
            if (complete || exhausted) return;
          }
        };
        visit(0);
        if (exhausted) {
          this.uncertain = true;
          return;
        }
        if (!found) return store.invalidate();
        if (store === p.store)
          for (const a of allCauses) if (!supported.has(a)) this.excludedCauses.add(a);
        for (const [key, keep] of values) store.narrow(key, keep);
      },
    };
    p.store.upsert(constraint);
  }
}
