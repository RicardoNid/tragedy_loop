import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewServer } from '../../apps/server/src/review.js';
test('development service rejects opaque and unrelated origins', async () => {
  const app = buildReviewServer();
  try {
    for (const origin of ['null', 'https://untrusted.example']) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/games',
        headers: { origin },
        payload: {},
      });
      assert.equal(result.statusCode, 403);
    }
  } finally {
    await app.close();
  }
});
