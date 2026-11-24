import assert from 'node:assert/strict';
import test from 'node:test';
import { openGame, reviewSetup } from '../../apps/server/src/review-game.js';
import { solution3 } from '../../apps/server/src/solution3.js';

test('求解器3回看与实时缓存独立，重复展开关系的额外工作为零', () => {
  const game = openGame(reviewSetup);
  assert.equal(game.status, 'ready');
  if (game.status !== 'ready') throw Error(game.status);
  try {
    const player = game.protagonists.p0;
    for (const kind of ['start', 'continue'] as const) {
      const view = player.view();
      player.submit({
        id: kind,
        expectedRevision: view.revision,
        decisionId: view.decision!.id,
        choice: { kind },
      });
    }
    const end = player.view().observations.length;
    assert(end > 1);
    const first = solution3(game, end);
    assert(first.work.checks > 0);
    assert.equal(first.through, end);
    const opened = solution3(game, end, true);
    assert.deepEqual(opened.work, { checks: 0, sources: [], combinations: 0, configurations: 0 });
    assert.deepEqual(opened.batchWork, first.batchWork);
    assert(opened.relations.length);
    assert.deepEqual(opened.rows, first.rows);
    assert.equal(solution3(game, 0).through, 0);
    const returned = solution3(game, end, true);
    assert.deepEqual(returned, opened);
    assert(returned.rows.filter((r) => r.hidden).every((r) => !Object.keys(r.cells).length));
  } finally {
    game.host.close();
  }
});
