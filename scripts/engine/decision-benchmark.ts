import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { inferObservedWorlds } from '../../packages/engine/src/decision/observed-worlds.js';
import { findWinningPolicy } from '../../packages/engine/src/decision/game-policy.js';
import { exportObservation } from './observed-game.js';

const question = JSON.parse(
  readFileSync(new URL('../../products/engine/game-policy-example.json', import.meta.url), 'utf8'),
);
const candidate = question.candidates[0];
const evidence = exportObservation(candidate);
const pack = compileOfficial(evidence.sheet.module, evidence.sheet.anniversary);
const histories = inferObservedWorlds(pack, [candidate.setup], true, evidence, 50000, 720);
assert.equal(histories.exhaustive, true);
assert.equal(histories.states.length, 720);
console.log(JSON.stringify({ worlds: histories.states.length, historyWork: histories.work }));
for (const cacheLimit of [0, 1024]) {
  const start = performance.now();
  const result = findWinningPolicy(pack, histories, 1000000, 512, undefined, cacheLimit);
  assert.equal(result.status, 'guaranteed');
  assert.deepEqual(result.policy?.choice, {
    kind: 'cards',
    placements: [{ card: 'p2-7', target: 'school' }],
  });
  console.log(
    JSON.stringify({
      cacheLimit,
      work: result.work,
      reusedProofs: result.reusedProofs ?? 0,
      milliseconds: Math.round(performance.now() - start),
      choice: result.policy.choice,
    }),
  );
}
