import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import {
  officialModules,
  supportsAnniversary,
  type GameSetup,
} from '../../packages/contracts/src/game.js';
import { initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import {
  buildProfiles,
  configurations,
} from '../../packages/engine/src/runtime/knowledge-domain.js';
import { generateDomain } from '../../packages/engine/src/runtime/knowledge-enumerated.js';
import { PruningCatalog } from '../../packages/engine/src/runtime/knowledge-pruning.js';
import { absenceProgramIndex } from '../../packages/engine/src/absence/programs.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';

const setup: GameSetup = {
  module: 'FS',
  anniversary: false,
  days: 1,
  loops: 1,
  captain: 'p0',
  discussion: 'allowed',
  y: '复仇的火种',
  x: ['流言四起'],
  characters: [
    { id: 'a', character: '男学生', identity: '主谋' },
    { id: 'b', character: '女学生', identity: '传谣人' },
  ],
  incidents: [],
};
const start = initializeDiscussion(compileOfficial('FS'), setup);
assert.ok(start.state);
const opening = initialPlacementView(start.state);
const projection = (s: GameSetup) =>
  canonical({
    y: s.y,
    x: s.x,
    identities: s.characters.map((c) => [c.id, c.identity, c.reverseIdentity ?? '']),
    events: s.incidents.map((e) => [e.day, e.name, e.culprit]),
  });

for (const mode of ['required-culprit', 'forbidden-culprit', 'attribute'] as const)
  test(
    'solver 1 reads changed declarations in validation and both domain constructors: ' + mode,
    () => {
      const pack = structuredClone(compileOfficial('FS'));
      const view = structuredClone(opening),
        actual = structuredClone(setup);
      if (mode === 'attribute')
        pack.setupRules.attributes = [
          { plot: setup.y, identities: ['主谋'], attribute: '少女', except: '局外人' },
        ];
      else {
        pack.identities['主谋']!.culpritRequirement =
          mode === 'required-culprit' ? 'required' : 'forbidden';
        if (mode === 'forbidden-culprit') {
          actual.incidents = [{ day: 1, name: '医院事故', culprit: 'a' }];
          view.incidents = [{ day: 1, name: '医院事故' }];
        }
      }
      assert.ok(
        validateSetup(pack, actual).some(
          (d) => d.code === (mode === 'attribute' ? 'required-attribute' : mode),
        ),
      );
      const stats = { checks: 0, removed: 0, branches: 0 };
      const structured = [...configurations(pack, view, buildProfiles(pack, view, stats))].filter(
        (s): s is GameSetup => !!s,
      );
      const exhaustive = [...generateDomain(pack, view)].filter((s): s is GameSetup => !!s);
      assert.deepEqual(new Set(structured.map(projection)), new Set(exhaustive.map(projection)));
      assert.ok(!exhaustive.some((s) => projection(s) === projection(actual)));
      assert.ok(exhaustive.every((s) => validateSetup(pack, s).length === 0));
      if (mode !== 'required-culprit')
        assert.ok(exhaustive.length, 'should retain other legal configurations');
    },
  );

test('incident fast path follows declared coverage, never identity spelling', () => {
  const pack = structuredClone(compileOfficial('FS'));
  const catalog = () => new PruningCatalog(pack, opening, opening.characters).publicTriggerModel;
  assert.equal(catalog(), true);
  pack.identities['改名身份'] = { ...pack.identities['主谋']!, name: '改名身份' };
  assert.equal(catalog(), true);
  delete pack.identities['改名身份']!.ordinaryIncidentTrigger;
  assert.equal(catalog(), false);
  pack.identities['改名身份']!.ordinaryIncidentTrigger = true;
  pack.identities['改名身份']!.sameAreaIncidentTrigger = true;
  assert.equal(catalog(), false, 'special trigger condition must not use ordinary coverage');
});

for (const module of officialModules)
  for (const anniversary of supportsAnniversary(module) ? [false, true] : [false])
    test(`native programs keep original ability objects and construction declarations: ${module}/${anniversary}`, () => {
      const pack = compileOfficial(module, anniversary);
      for (const p of absenceProgramIndex(pack).programs) {
        if (p.kind === 'incident')
          assert.equal(
            p.ability.steps,
            p.id === 'incident'
              ? pack.incidents[p.owner]!.steps
              : pack.incidents[p.owner]!.afterIncidentSteps,
          );
        else if (p.kind !== 'module') {
          const defs =
            p.kind === 'identity'
              ? pack.identities
              : p.kind === 'character'
                ? pack.characters
                : pack.plots;
          assert.ok(
            defs[p.owner]!.abilities.includes(p.ability),
            'index must retain source program, not rewrite rule body',
          );
        }
      }
      for (const role of Object.values(pack.identities)) {
        const expected = ['强迫症', '愚者', '双胞胎', '祭品', '怪杰'].includes(role.name)
          ? 'required'
          : role.name === '侦探'
            ? 'forbidden'
            : undefined;
        assert.equal(role.culpritRequirement, expected);
      }
      for (const e of Object.values(pack.incidents))
        assert.equal(
          e.crowdThreshold,
          ({ 疯狂之夜: 0, 诅咒活化: 1, 污秽溢出: 2, 死者默示录: 2 } as Record<string, number>)[
            e.name
          ],
        );
    });
