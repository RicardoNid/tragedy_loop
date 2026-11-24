import assert from 'node:assert/strict';
import {
  allocation,
  assignments,
  ConstraintStore,
} from '../../packages/engine/src/runtime/knowledge-constraints.ts';

// One fixed quota branch per selection (optional slots taken, LL adds no extra secret).
// Disclose the tail to keep exhaustive enumeration finite; both methods see identical domains.
export function quotaCase(pack, plots, unknown = 3) {
  const counts = new Map(),
    pairs = [];
  for (const p of plots) {
    for (const [role, n] of Object.entries(p.identities)) {
      counts.set(
        role,
        Math.min((counts.get(role) ?? 0) + n, pack.identities[role]?.max ?? Infinity),
      );
    }
    if (p.pair) pairs.push(p.pair.join('/'));
  }
  const slots = [...counts].filter(([, n]) => n > 0).map(([role]) => role);
  slots.push(...pairs, '平民');
  for (const [role, n] of counts) for (let i = 1; i < n; i++) slots.push(role);
  // At least three positions, including fillers when the rule has very few slots.
  while (slots.length < unknown) slots.push('平民');
  const keys = slots.map((_, i) => 'r' + i),
    values = [...new Set(slots)];
  const domains = new Map(keys.map((key, i) => [key, new Set(i < unknown ? values : [slots[i]])]));
  const store = new ConstraintStore(domains);
  store.add(allocation(keys, slots));
  let branches = 0;
  const expected = [],
    actual = [];
  const required = JSON.stringify([...slots].sort());
  const visit = (index, row) => {
    if (index === unknown) {
      if (JSON.stringify([...row, ...slots.slice(unknown)].sort()) === required)
        expected.push(JSON.stringify(row));
      return;
    }
    for (const role of values) {
      if (values.length > 1) branches++;
      visit(index + 1, [...row, role]);
    }
  };
  visit(0, []);
  for (const result of assignments(store))
    if (result)
      actual.push(JSON.stringify(keys.slice(0, unknown).map((k) => [...result.get(k)][0])));
  assert.ok(expected.length);
  assert.deepEqual(actual.sort(), expected.sort(), plots.map((p) => p.name).join(' / '));
  return {
    rules: plots.map((p) => p.name),
    slots,
    unknown,
    solutions: actual.length,
    exhaustive: branches,
    pruned: store.stats.branches,
    checks: store.stats.checks,
  };
}

export function quotaCombinations(pack) {
  const all = Object.values(pack.plots),
    ys = all.filter((p) => p.type === 'Y'),
    xs = all.filter((p) => p.type === 'X');
  return [3, 4].flatMap((unknown) =>
    ys.flatMap((y) =>
      xs.flatMap((x, i) =>
        pack.setupRules.xSlots === 1
          ? [quotaCase(pack, [y, x], unknown)]
          : xs.slice(i + 1).map((second) => quotaCase(pack, [y, x, second], unknown)),
      ),
    ),
  );
}
