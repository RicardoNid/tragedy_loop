import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project, initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import type { GameSetup, Actor, Command } from '../../packages/contracts/src/game.js';
interface Recording {
  scenario: string;
  seed: number;
  setup: GameSetup;
  steps: { actor: Actor; command: Command }[];
}
const records = JSON.parse(
  readFileSync(new URL('../../products/engine/tutorials/histories.json', import.meta.url), 'utf8'),
) as Recording[];
for (const r of records.filter((r) => r.setup.module !== 'AHR')) {
  const pack = compileOfficial(r.setup.module, r.setup.anniversary);
  let state = initializeDiscussion(pack, r.setup).state!;
  const opening = initialPlacementView(state),
    one = new LiveKnowledge(pack, opening),
    three = new SolutionSpace3(opening);
  let prefixes = 0,
    exact = 0,
    diff = 0,
    ms1 = 0,
    ms3 = 0,
    checks = 0,
    local = three.model.graph.work.combinations;
  let firstDifference: unknown;
  for (const step of r.steps) {
    state = advance(pack, state, step.actor, step.command).state;
    const view = project(state, 'protagonists');
    if (three.through === view.observations.length) continue;
    let t = performance.now();
    three.append(view.observations.slice(three.through), view.characters);
    ms3 += performance.now() - t;
    local += three.model.graph.work.combinations;
    checks += three.model.graph.work.sources.length;
    t = performance.now();
    one.update(view.observations, view.revision);
    const s = one.snapshot();
    ms1 += performance.now() - t;
    prefixes++;
    assert(!three.conflict, r.scenario + ' ' + three.conflict);
    if (s.status === 'exact') exact++;
    for (const c of view.characters) {
      const cell = three.model.ids.get(c.character),
        other = s.identities[c.id];
      if (!cell || !other?.length) continue;
      const supported = Object.keys(cell)
        .filter((n) => three.model.graph.truth(cell[n]!) !== false)
        .sort();
      if (supported.join() !== other.slice().sort().join()) {
        if (s.status === 'exact')
          assert.deepEqual(
            supported,
            other.slice().sort(),
            r.scenario + ' #' + three.through + ' ' + c.character + ' 精确身份投影',
          );
        diff++;
        firstDifference ??= {
          through: three.through,
          character: c.character,
          status1: s.status,
          one: other,
          three: supported,
        };
      }
      const actual = r.setup.characters.find((x) => x.id === c.id);
      if (actual && s.status === 'exact')
        assert(
          other.includes(actual.id === r.setup.anniversaryFragment ? '因果残片' : actual.identity),
          r.scenario + ' #' + three.through + ' ' + c.character + ' 求解器1排除真实配置',
        );
    }
  }
  console.log(
    JSON.stringify({
      scenario: r.scenario,
      seed: r.seed,
      prefixes,
      exact,
      differentRows: diff,
      firstDifference,
      ms1,
      ms3,
      checks3: checks,
      local3: local,
      generated1: one.snapshot().generated,
      configurations3: 0,
    }),
  );
}
