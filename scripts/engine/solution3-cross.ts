import assert from 'node:assert/strict';
import { compareModules } from './solution3-cross-modules.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project, initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';

// The FS printed plot table is the offline oracle. Ordinary seats accept every permutation.
const printedY: Record<string, string[]> = {
  谋杀计划: ['关键人物', '杀手', '主谋'],
  复仇的火种: ['主谋'],
  守护此地: ['关键人物', '邪教徒'],
};
const printedX: Record<string, string[]> = {
  开膛者的魔影: ['传谣人', '杀人狂'],
  流言四起: ['传谣人'],
  最黑暗的剧本: ['传谣人', '亲友'],
};
const names = ['男学生', '女学生', '巫女', '职员', '刑警', '偶像'];
const pack = compileOfficial('FS');
let cases = 0,
  configurations1 = 0,
  local3 = 0,
  ms1 = 0,
  ms3 = 0;
for (const first of names)
  for (const second of names) {
    if (first === second) continue;
    for (const size of [2, 3, 4]) {
      const extra = names.filter((n) => n !== first && n !== second).slice(0, size - 2);
      const setup: GameSetup = {
        module: 'FS',
        anniversary: false,
        loops: 1,
        days: 1,
        captain: 'p0',
        discussion: 'between-loops',
        y: '复仇的火种',
        x: ['流言四起'],
        characters: [
          { id: 'a', character: first, identity: '主谋' },
          { id: 'b', character: second, identity: '传谣人' },
          ...extra.map((character, i) => ({ id: 'extra' + i, character, identity: '平民' })),
        ],
        incidents: [],
      };
      const state = initializeDiscussion(pack, setup).state!;
      const opening = initialPlacementView(state);
      const v = project(
        advance(pack, state, 'p0', {
          id: 'continue',
          expectedRevision: state.revision,
          decisionId: state.pending!.id,
          choice: { kind: 'continue' },
        }).state,
        'protagonists',
      );
      let start = performance.now();
      const one = new LiveKnowledge(pack, opening);
      one.update(v.observations, v.revision);
      one.verifyCombinations();
      for (let i = 0; i < 100 && one.snapshot().status === 'running'; i++) one.tick(25);
      const expected = one.snapshot();
      ms1 += performance.now() - start;
      start = performance.now();
      const three = new SolutionSpace3(opening);
      local3 += three.model.graph.work.combinations;
      three.append(v.observations, v.characters);
      ms3 += performance.now() - start;
      assert.equal(expected.status, 'exact', first + second);
      assert.equal(three.conflict, undefined);
      const g = three.model.graph;
      const oracleRoles = new Set<string>(),
        oraclePlots = new Set<string>();
      for (const [y, main] of Object.entries(printedY))
        for (const [x, side] of Object.entries(printedX)) {
          if (main.length + side.length > size) continue;
          oraclePlots.add(y);
          oraclePlots.add(x);
          for (const role of [...main, ...side]) oracleRoles.add(role);
          if (main.length + side.length < size) {
            oracleRoles.add('平民');
            if (x === '最黑暗的剧本') oracleRoles.add('暴徒');
          }
        }
      for (const c of setup.characters) {
        const roles = Object.entries(three.model.ids.get(c.character)!)
          .filter(([, a]) => g.truth(a) !== false)
          .map(([n]) => n)
          .sort();
        assert.deepEqual(roles, [...oracleRoles].sort(), first + second + ' ' + size);
        assert.deepEqual(roles, expected.identities[c.id]!.slice().sort());
      }
      assert.deepEqual(
        expected.rules.slice().sort(),
        Object.entries(three.model.plots)
          .filter(([, a]) => g.truth(a) !== false)
          .map(([n]) => n)
          .sort(),
      );
      assert.deepEqual(expected.rules.slice().sort(), [...oraclePlots].sort());
      assert.equal(g.work.configurations, 0);
      local3 += g.work.combinations;
      configurations1 += expected.generated;
      cases++;
    }
  }
console.log(JSON.stringify({ cases, configurations1, local3, configurations3: 0, ms1, ms3 }));
compareModules();
