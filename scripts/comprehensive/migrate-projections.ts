// One-time guarded migration: only the absent-character redaction may change.
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
function verifyProjection(s: EngineState, expected: ReturnType<typeof checkpoint>) {
  checked++;
  const actual = checkpoint(s);
  assert.equal(actual.state, expected.state, 'authoritative state changed; stop migration');
  for (let i = 0; i < observers.length; i++) {
    if (actual.views[i] === expected.views[i]) continue;
    const observer = observers[i]!;
    assert.notEqual(observer, 'mastermind', 'mastermind view must be unchanged');
    const legacy = project(s, observer);
    legacy.characters = Object.values(s.characters).map(
      ({ id, character, area, status, counters }) => ({ id, character, area, status, counters }),
    );
    assert.equal(
      hash(legacy),
      expected.views[i],
      'difference is not solely absent-character redaction',
    );
    changed++;
  }
  return actual;
}
for (const h of histories) {
  const pack = compileOfficial(h.setup.module, h.setup.anniversary);
  assert.equal(pack.digest, h.ruleDigest);
  let s = initializeDiscussion(pack, h.setup).state!;
  assert.ok(s);
  h.initial = verifyProjection(s, h.initial);
  for (const step of h.steps) {
    const result = advance(pack, s, step.actor, step.command);
    assert.equal(result.status, 'ok');
    s = result.state;
    step.expected = verifyProjection(s, step.expected);
  }
}
metadata.historiesHash = hash(histories);
metadata.projectionMigration = {
  reason: 'FAQ 121: do not reveal characters before their first appearance',
  checked,
  changed,
  previousHistoriesHash: previous,
};
writeFileSync(
  'products/comprehensive/projection-migration.json',
  JSON.stringify(metadata.projectionMigration, null, 2) + '\n',
);
writeFileSync(file, JSON.stringify(histories, null, 2) + '\n');
writeFileSync(metaFile, JSON.stringify(metadata, null, 2) + '\n');
console.log({ checked, changed });
