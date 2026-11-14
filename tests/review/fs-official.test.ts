import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewSetup, buildReviewServer } from '../../apps/server/src/review.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
test('default FS profile is the complete official FS-01G three-day script', async () => {
  const original = JSON.parse(
    readFileSync('tests/engine/fixtures/official-scenarios.json', 'utf8'),
  ).find((f: { id: string }) => f.id === 'FS-01G');
  assert.deepEqual(reviewSetup, original.setup);
  assert.deepEqual(validateSetup(compileOfficial('FS'), reviewSetup), []);
  const app = buildReviewServer();
  try {
    for (const payload of [{}, { profile: 'FS' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/games', payload });
      assert.equal(r.statusCode, 200);
      const v = r.json().view;
      assert.equal(v.loops, 3);
      assert.equal(v.days, 3);
      assert.equal(v.characters.length, 0);
      assert.deepEqual(v.incidents, [{ day: 3, name: '自杀' }]);
      assert.equal(v.secret, undefined);
    }
  } finally {
    await app.close();
  }
});
