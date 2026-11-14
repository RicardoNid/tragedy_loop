// One-time guarded migration: only a corrected content digest may change.
// Do not use this to accept arbitrary state/replay differences.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { checkpoint, hash, observers, type History } from '../../tests/engine/official-harness.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';
const file = 'products/engine/tutorials/histories.json',
  metaFile = 'products/engine/tutorials/verification.json';
const histories = JSON.parse(readFileSync(file, 'utf8')) as History[];
const metadata = JSON.parse(readFileSync(metaFile, 'utf8'));
assert.equal(hash(histories), metadata.historiesHash);
const previous = metadata.historiesHash;
let changed = 0,
  checked = 0;
function verifyProjection(
  s: EngineState,
  expected: ReturnType<typeof checkpoint>,
  oldDigest: string,
) {
  checked++;
  const actual = checkpoint(s);
  assert.equal(
    hash({ ...s, ruleDigest: oldDigest }),
    expected.state,
    'state differs beyond content digest; stop migration',
  );
  assert.deepEqual(actual.views, expected.views, 'public views changed; stop migration');
  if (actual.state !== expected.state) changed++;
  return actual;
}
for (const h of histories) {
  const pack = compileOfficial(h.setup.module, h.setup.anniversary);
  const oldDigest = h.ruleDigest;
  h.ruleDigest = pack.digest;
  let s = initializeDiscussion(pack, h.setup).state!;
  assert.ok(s);
  h.initial = verifyProjection(s, h.initial, oldDigest);
  for (const step of h.steps) {
    const result = advance(pack, s, step.actor, step.command);
    assert.equal(result.status, 'ok');
    s = result.state;
    step.expected = verifyProjection(s, step.expected, oldDigest);
  }
}
metadata.historiesHash = hash(histories);
metadata.contentMigration = {
  reason: 'FAQ 444: removed characters are excluded from Virtual World',
  checked,
  changed,
  previousHistoriesHash: previous,
};
writeFileSync(
  'products/comprehensive/content-migration.json',
  JSON.stringify(metadata.contentMigration, null, 2) + '\n',
);
writeFileSync(file, JSON.stringify(histories, null, 2) + '\n');
writeFileSync(metaFile, JSON.stringify(metadata, null, 2) + '\n');
console.log({ checked, changed });
