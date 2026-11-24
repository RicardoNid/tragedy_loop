import type { Relations } from '../../packages/engine/src/solution3/relations.js';

/** Offline verifier for small graphs. Reads the stored cardinality constraints directly.
 * Every branch fixes one Boolean; a completed search has no unknown feasibility result. */
export function admits(
  g: Relations,
  assumptions: number[],
  prefix?: { rules: number; values: Relations['values'] },
) {
  const rules = prefix ? g.rules.slice(0, prefix.rules) : g.rules;
  const assignment = new Int8Array(g.names.length);
  for (const [id, proof] of prefix?.values ?? g.values) assignment[id] = proof.value ? 1 : -1;
  function set(values: Int8Array, lit: number) {
    const id = Math.abs(lit),
      sign = Math.sign(lit);
    if (values[id] === -sign) return false;
    values[id] = sign;
    return true;
  }
  if (!assumptions.every((lit) => set(assignment, lit))) return false;
  function solve(values: Int8Array): boolean {
    let branch = 0,
      previous = 0;
    do {
      previous = 0;
      branch = 0;
      for (const r of rules) {
        const read = (lit: number) => values[Math.abs(lit)]! * Math.sign(lit);
        const active = r.guard ? read(r.guard) : 1;
        if (active < 0) continue;
        let yes = 0,
          free = 0,
          choice = 0;
        for (const t of r.terms) {
          const state = read(t);
          if (state > 0) yes++;
          else if (!state) {
            free++;
            choice = t;
          }
        }
        if (yes >= r.min && yes + free <= r.max) continue;
        if (yes > r.max || yes + free < r.min) {
          if (active > 0) return false;
          if (!set(values, -r.guard!)) return false;
          previous++;
          continue;
        }
        if (active > 0 && free && (yes === r.max || yes + free === r.min)) {
          const sign = yes === r.max ? -1 : 1;
          for (const lit of r.terms)
            if (!read(lit)) {
              if (!set(values, sign * lit)) return false;
              previous++;
            }
        } else branch ||= active === 0 ? r.guard! : choice;
      }
    } while (previous);
    if (!branch) return true;
    const left = values.slice();
    set(left, branch);
    if (solve(left)) return true;
    set(values, -branch);
    return solve(values);
  }
  return solve(assignment);
}
