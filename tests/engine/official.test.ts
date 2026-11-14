import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtures, verify, checkpoint, hash, type History } from './official-harness.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { replay, runBatch } from '../../packages/engine/src/runtime/replay.js';
const histories = JSON.parse(
  readFileSync(new URL('../../products/engine/tutorials/histories.json', import.meta.url), 'utf8'),
) as History[];
const metadata = JSON.parse(
  readFileSync(
    new URL('../../products/engine/tutorials/verification.json', import.meta.url),
    'utf8',
  ),
) as { fixturesHash: string; historiesHash: string };

test('official source snapshots match their provenance hashes', () => {
  const root = new URL('../../products/engine/tutorials/sources/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
    records: { file: string; sha256: string }[];
  };
  for (const source of manifest.records) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(source.file, root)))
        .digest('hex'),
      source.sha256,
      source.file,
    );
  }
});
test('official fixtures and reviewed histories are pinned, with both outcomes for all 8 modules', () => {
  assert.equal(hash(fixtures), metadata.fixturesHash);
  assert.equal(hash(histories), metadata.historiesHash);
  assert.deepEqual(fixtures.map((f) => f.setup.module).sort(), [
    'AHR',
    'BTX',
    'FS',
    'HSA',
    'LL',
    'MC',
    'MZ',
    'WM',
  ]);
  assert.equal(histories.length, 16);
  for (const f of fixtures) {
    const hs = histories.filter((h) => h.scenario === f.id);
    assert.deepEqual(hs.map((h) => h.winner).sort(), ['mastermind', 'protagonists']);
    for (const h of hs) assert.deepEqual(h.setup, f.setup);
  }
});
for (const h of histories)
  test(`${h.scenario} official full game → ${h.winner}: exact replay, persisted resume, retry and batch`, () => {
    for (const budget of [1, 7, 10000]) verify(h, budget, true);
    const pack = compileOfficial(h.setup.module, h.setup.anniversary);
    const request = {
      setup: h.setup,
      choices: h.steps.map((s) => ({ actor: s.actor, choice: s.command.choice })),
    };
    const before = hash(request);
    for (const r of [replay(pack, request), ...runBatch(pack, [request, request])]) {
      assert.equal(r.status, 'replayed');
      assert.deepEqual(checkpoint(r.state), h.steps.at(-1)!.expected);
    }
    assert.equal(hash(request), before, 'replay mutated the history');
    const tampered = structuredClone(request);
    tampered.choices[0]!.actor = 'mastermind';
    const r = replay(pack, tampered);
    assert.equal(r.status, 'mismatch');
    if (r.status === 'mismatch') assert.equal(r.index, 0);
    const appended = replay(pack, {
      ...request,
      choices: [...request.choices, request.choices[0]!],
    });
    assert.equal(appended.status, 'mismatch');
    if (appended.status === 'mismatch') {
      assert.equal(appended.index, request.choices.length);
      assert.equal(appended.reason, 'game-ended');
    }
  });
