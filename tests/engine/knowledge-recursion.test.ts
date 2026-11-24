import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignments,
  ConstraintStore,
  relation,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';

test('eight-level assignment recursion resumes with new evidence and backtracks without duplicate leaves', () => {
  const root = new ConstraintStore(
    new Map(Array.from({ length: 8 }, (_, i) => [String(i), new Set(['0', '1'])])),
  );
  const traversal = assignments(root.clone(), () => root.domains);
  // Before the first leaf, each suspension must have descended one additional level.
  for (let i = 0; i < 8; i++) assert.deepEqual(traversal.next(), { done: false, value: null });
  root.narrow('0', ['1']); // Invalidates the entire active subtree after seven nested calls.
  const leaves: string[] = [];
  for (const row of traversal)
    if (row) leaves.push([...row.values()].map((v) => [...v][0]).join(''));
  // Numeric enumeration is independent of the solver's recursion.
  assert.deepEqual(
    leaves.sort(),
    Array.from({ length: 128 }, (_, n) => (n + 128).toString(2)),
  );
});

test('recursive compound projection agrees with a flat truth table at budget boundaries', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
  const digits = ['0', '1', '2'];
  const patterns = new Set<string>();
  let truncated = 0;
  for (let seed = 1; seed <= 96; seed++) {
    let rng = seed;
    const draw = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 2 ** 32;
    };
    const edges: { i: number; j: number; mask: number }[] = [];
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++)
        if (j === i + 1 || draw() < 0.32)
          edges.push({ i, j, mask: Math.floor(draw() * 512) | (1 << Math.floor(draw() * 9)) });
    const rows: string[] = [];
    for (let n = 0; n < 3 ** 6; n++) {
      const row = n.toString(3).padStart(6, '0');
      if (edges.every(({ i, j, mask }) => mask & (1 << (3 * Number(row[i]) + Number(row[j])))))
        rows.push(row);
    }
    patterns.add(rows.length === 0 ? 'empty' : rows.length === 1 ? 'unique' : 'multiple');
    for (const budget of [0, 1, 3, 10000]) {
      const s = new ConstraintStore(new Map(keys.map((k) => [k, new Set(digits)])));
      s.finishSetup();
      s.beginSettlement();
      for (const { i, j, mask } of edges)
        s.add(
          relation(keys[i]! + keys[j]!, keys[i]!, keys[j]!, (x, y) =>
            Boolean(mask & (1 << (3 * Number(x) + Number(y)))),
          ),
        );
      s.propagate();
      const result = s.finishSettlement(true, budget);
      const label = 'seed=' + seed + ' budget=' + budget;
      if (!result.complete && result.branches > 0) truncated++;
      if (budget === 10000) assert.ok(result.complete, label);
      if (result.complete) assert.equal(s.consistent, rows.length > 0, label);
      for (const [i, k] of keys.entries()) {
        const expected: Set<string> = new Set(rows.map((row) => row[i]!));
        for (const v of expected) assert.ok(s.values(k).has(v), label);
        if (result.complete && rows.length) assert.deepEqual(s.values(k), expected, label);
      }
      if (budget === 10000) {
        const leaves = [...assignments(s.clone())]
          .filter((row) => row !== null)
          .map((row) => keys.map((k) => [...row.get(k)!][0]).join(''));
        assert.deepEqual(leaves.sort(), rows, label);
      }
    }
  }
  assert.ok(truncated > 0);
  assert.equal(patterns.size, 3);
});
