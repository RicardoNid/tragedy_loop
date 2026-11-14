import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { btxReviewSetup, buildReviewServer } from '../../apps/server/src/review.js';
import fixture from '../../apps/server/src/fixtures/btx-01g.json' with { type: 'json' };
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { initializeDiscussion, drive } from '../../packages/engine/src/runtime/engine.js';
test('BTX review uses complete official BTX-01G, including key person and day-three hospital incident', async () => {
  const original = JSON.parse(
    readFileSync('tests/engine/fixtures/official-scenarios.json', 'utf8'),
  ).find((x: { id: string }) => x.id === 'BTX-01G');
  assert.deepEqual(btxReviewSetup, original.setup);
  assert.equal(
    createHash('sha256').update(readFileSync(fixture.source.snapshot)).digest('hex'),
    fixture.source.sha256,
  );
  assert.ok(btxReviewSetup.characters.some((c) => c.identity === '关键人物'));
  const incident = btxReviewSetup.incidents.find((i) => i.name === '医院事故')!;
  assert.equal(incident.day, 3);
  const pack = compileOfficial('BTX'),
    result = initializeDiscussion(pack, btxReviewSetup);
  assert.deepEqual(result.diagnostics, []);
  const s = result.state!;
  s.day = 3;
  s.pending = null;
  s.frames = [];
  s.batch = null;
  s.phase = 'incident';
  s.phaseEntered = false;
  s.characters[incident.culprit]!.counters.paranoia = 2;
  s.boards.hospital = 2;
  drive(pack, s, 10000);
  assert.equal(s.protagonistDead, true);
  assert.ok(s.incidents.some((i) => i.name === '医院事故'));
  const app = buildReviewServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { profile: 'BTX' },
    });
    assert.equal(response.statusCode, 200);
    const v = response.json().view;
    assert.equal(v.characters.length, 0);
    assert.equal(v.loops, 4);
    assert.equal(v.days, 5);
    assert.ok(
      v.incidents.some((i: { name: string; day: number }) => i.name === '医院事故' && i.day === 3),
    );
    assert.equal(v.secret, undefined);
  } finally {
    await app.close();
  }
});
