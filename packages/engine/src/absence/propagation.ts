import type { AbsenceSpace } from './index.js';

export interface SearchCounts {
  branches: number;
  removed: number;
  solutions: number;
}
type Domains = Map<string, string[]>;

/** Each directed forbidden pair is a binary relation. Intersect relations on the same
 * pair before testing support, so two inconsistent witnesses cannot support a value. */
export function* propagateSolutions(
  space: AbsenceSpace,
  stats: SearchCounts = { branches: 0, removed: 0, solutions: 0 },
): Generator<Record<string, string>> {
  const domains: Domains = new Map(Object.entries(space.domains));
  const neighbors = new Map([...domains.keys()].map((k) => [k, new Set<string>()]));
  const blocks = new Map<string, Set<string>>();
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  function block(a: string, b: string, x: string, y: string) {
    neighbors.get(a)!.add(b);
    const k = key(a, b);
    if (!blocks.has(k)) blocks.set(k, new Set());
    blocks.get(k)!.add(key(x, y));
  }
  for (const c of space.constraints)
    for (const r of c.targetIdentities) {
      block(c.owner, c.target, c.identity, r);
      block(c.target, c.owner, r, c.identity);
    }
  function revise(d: Domains, changed: Iterable<string>) {
    const queue = new Set(changed);
    for (const values of d.values()) if (!values.length) return false;
    while (queue.size) {
      const b = queue.values().next().value!;
      queue.delete(b);
      for (const a of neighbors.get(b)!) {
        const denied = blocks.get(key(a, b))!;
        const old = d.get(a)!;
        const keep = old.filter((x) =>
          a === b ? !denied.has(key(x, x)) : d.get(b)!.some((y) => !denied.has(key(x, y))),
        );
        if (keep.length === old.length) continue;
        stats.removed += old.length - keep.length;
        if (!keep.length) return false;
        d.set(a, keep);
        queue.add(a);
      }
    }
    return true;
  }
  function* visit(d: Domains): Generator<Record<string, string>> {
    let best: string | undefined;
    for (const [k, v] of d)
      if (
        v.length > 1 &&
        (best === undefined ||
          v.length < d.get(best)!.length ||
          (v.length === d.get(best)!.length && neighbors.get(k)!.size > neighbors.get(best)!.size))
      )
        best = k;
    if (best === undefined) {
      stats.solutions++;
      yield Object.fromEntries([...d].map(([k, v]) => [k, v[0]!]));
      return;
    }
    for (const value of d.get(best)!) {
      stats.branches++;
      const next = new Map(d);
      next.set(best, [value]);
      if (revise(next, [best])) yield* visit(next);
    }
  }
  if (revise(domains, domains.keys())) yield* visit(domains);
}
