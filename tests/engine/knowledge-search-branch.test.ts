import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, advanceSearchBranch, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { choose, generator } from '../../scripts/comprehensive/random-choices.js';
import { officialScenarioSetup } from './official-harness.js';

for (const module of ['FS', 'BTX', 'MC', 'MZ'] as const) {
  test(module + ' search branches preserve the parent state and match ordinary execution', () => {
    const pack = compileOfficial(module);
    let state = initializeDiscussion(pack, officialScenarioSetup(module)).state!;
    const draw = generator(20261121);
    let steps = 0;
    while (!state.winner) {
      assert.ok(++steps < 1500 && state.pending);
      const parent = structuredClone(state);
      const { actor, id: decisionId } = state.pending;
      const command = { id: String(steps), expectedRevision: state.revision, decisionId, choice: choose(state, draw) };
      const reference = advance(pack, parent, actor, command);
      const branch = advanceSearchBranch(pack, state, actor, command);
      assert.equal(branch.status, 'ok');
      assert.deepEqual(state, parent);
      assert.deepEqual(branch, reference);
      state = branch.state;
    }
  });
}
