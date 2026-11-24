import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project, initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import type { GameSetup, Command, Actor } from '../../packages/contracts/src/game.js';

interface Recording {
  scenario: string;
  seed: number;
  setup: GameSetup;
  steps: { actor: Actor; command: Command }[];
}
const recordings = JSON.parse(
  readFileSync(new URL('../../products/engine/tutorials/histories.json', import.meta.url), 'utf8'),
) as Recording[];
for (const r of recordings.filter((r) => r.setup.module !== 'AHR'))
  test(r.scenario + ' ' + r.seed + ' 各公开前缀保留制作真值', () => {
    const pack = compileOfficial(r.setup.module, r.setup.anniversary);
    let state = initializeDiscussion(pack, r.setup).state!;
    const s = new SolutionSpace3(initialPlacementView(state)),
      m = s.model;
    for (const [index, step] of r.steps.entries()) {
      const result = advance(pack, state, step.actor, step.command);
      assert.notEqual(result.status, 'rejected', r.scenario + ' 重放命令 ' + index);
      state = result.state;
      const v = project(state, 'protagonists');
      s.append(v.observations.slice(s.through), v.characters);
      assert.equal(s.conflict, undefined, r.scenario + ' #' + s.through + ' ' + s.conflict);
      const check = (lit: number | undefined, why: string) => {
        assert(lit, why);
        assert.notEqual(
          m.graph.truth(lit),
          false,
          r.scenario + ' #' + s.through + ' ' + why + ' ' + m.graph.reasons(lit).join('/'),
        );
      };
      for (const name of [r.setup.y, ...r.setup.x]) check(m.plots[name], name);
      for (const c of r.setup.characters)
        check(
          m.ids.get(c.character)?.[r.setup.anniversaryFragment === c.id ? '因果残片' : c.identity],
          c.character + ' ' + c.identity,
        );
      for (const i of r.setup.incidents) {
        check(m.events.get(i.day)?.[i.name], i.name);
        check(
          m.culprits.get(i.day)?.[
            r.setup.characters.find((c) => c.id === i.culprit)?.character ?? i.culprit
          ],
          i.culprit,
        );
      }
    }
  });
