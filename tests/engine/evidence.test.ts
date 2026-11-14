import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import catalog from '../../packages/content/src/official/source-catalog.json' with { type: 'json' };
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';

test('official evidence is pinned to current read-only source files; stale translations are detected', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const entry of catalog.entries) {
    const hash = createHash('sha256')
      .update(readFileSync(resolve(root, entry.source)))
      .digest('hex');
    assert.equal(
      hash,
      entry.sha256,
      `Source changed: ${entry.source}; re-review before re-pinning.`,
    );
  }
});
test('BTX complete failed loop reaches final guesses; a wrong guess loses and correct guesses win', () => {
  const pack = compileOfficial('BTX');
  const setup: GameSetup = {
    module: 'BTX',
    anniversary: false,
    loops: 1,
    days: 1,
    y: '谋杀计划',
    x: ['流言四起', '因果线'],
    captain: 'p0',
    discussion: 'allowed',
    characters: [
      { id: 'key', character: '住院患者', identity: '关键人物' },
      { id: 'killer', character: '医生', identity: '杀手' },
      { id: 'brain', character: '巫女', identity: '主谋' },
      { id: 'gossip', character: '男学生', identity: '传谣人' },
    ],
    incidents: [{ day: 1, name: '自杀', culprit: 'key' }],
  };
  let state = initializeDiscussion(pack, setup).state!;
  const act = (choice: Choice) => {
    assert.ok(state.pending);
    const r = advance(pack, state, state.pending.actor, {
      id: `complete-${state.revision}`,
      expectedRevision: state.revision,
      decisionId: state.pending.id,
      choice,
    });
    assert.equal(r.status, 'ok', r.reason);
    state = r.state;
  };
  act({ kind: 'continue' });
  act({
    kind: 'cards',
    placements: [
      { card: 'mastermind-4', target: 'key' },
      { card: 'mastermind-0', target: 'city' },
      { card: 'mastermind-1', target: 'school' },
    ],
  });
  act({ kind: 'cards', placements: [{ card: 'p0-5', target: 'key' }] });
  act({ kind: 'cards', placements: [{ card: 'p1-0', target: 'city' }] });
  act({ kind: 'cards', placements: [{ card: 'p2-0', target: 'school' }] });
  for (let n = 0; n < 10 && state.phase !== 'final-guess'; n++) act({ kind: 'pass' });
  assert.equal(state.phase, 'final-guess');
  assert.equal(state.failed, true);
  const checkpoint = structuredClone(state);
  act({ kind: 'guess', character: 'key', identity: '平民' });
  assert.equal(state.winner, 'mastermind');
  state = checkpoint;
  for (const c of setup.characters) act({ kind: 'guess', character: c.id, identity: c.identity });
  assert.equal(state.winner, 'protagonists');
});
