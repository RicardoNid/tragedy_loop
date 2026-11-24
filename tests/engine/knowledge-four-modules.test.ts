import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { completeObservationGroups, type GameSetup } from '../../packages/contracts/src/game.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { LiveKnowledge, EnumeratedKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import { casePlayer } from './knowledge-fsbtx-cases.js';

const modules = {
  FS: ['复仇的火种', ['流言四起'], ['主谋', '传谣人', '平民']],
  BTX: ['和我签订契约吧！', ['流言四起', '妄想扩大病毒'], ['关键人物', '传谣人', '平民']],
  MC: ['黑暗学园', ['火药的味道', '绝对意志'], ['主谋', '强迫症', '杀人狂']],
  MZ: ['男子汉的战争', ['X异因子', '灭亡讴歌'], ['不安定因子', '平民', '忍者', '预言家']],
} as const;

function exact(solver: LiveKnowledge | EnumeratedKnowledge) {
  if (solver instanceof LiveKnowledge) solver.verifyCombinations();
  const deadline = performance.now() + 90000;
  while (!solver.paused && performance.now() < deadline) solver.tick(20, Infinity);
  assert.equal(solver.snapshot().status, 'exact', JSON.stringify(solver.snapshot().reasons));
  return solver.jointSolutions()!;
}

for (const module of ['FS', 'BTX', 'MC', 'MZ'] as const)
  for (const cardOnBoard of module === 'MZ' ? [false, true] : [false])
    test(
      module +
        (cardOnBoard ? ' mastermind card on shrine' : '') +
        ' real suicide: identity permutations and culprit through public settlements',
      () => {
        const [y, x, roles] = modules[module];
        const pack = structuredClone(compileOfficial(module));
        // Both readers receive the same restricted plot catalogue. Incident aliases remain available.
        pack.plots = Object.fromEntries([y, ...x].map((name) => [name, pack.plots[name]!]));
        const setup: GameSetup = {
          module,
          y,
          x: [...x],
          loops: 2,
          days: 1,
          captain: 'p0',
          discussion: 'allowed',
          anniversary: false,
          characters: (module === 'MZ'
            ? ['女学生', '住院患者', '职员', '巫女']
            : ['女学生', '住院患者', '男学生']
          ).map((character, i) => ({
            character,
            id: ['a', 'b', 'c', 'd'][i]!,
            identity: roles[i]!,
          })),
          incidents: [{ day: 1, name: '自杀', culprit: 'b' }],
        };
        const init = initializeDiscussion(pack, setup);
        assert.ok(init.state, JSON.stringify(init.diagnostics));
        let state = init.state;
        const opening = initialPlacementView(state);
        const play = casePlayer({
          name: module,
          setup,
          cards:
            module === 'MZ'
              ? [
                  ['block-paranoia', cardOnBoard ? 'shrine' : 'a'],
                  ['intrigue+1', 'hospital'],
                  ['paranoia+1', 'c'],
                ]
              : undefined,
          verify() {},
        });
        const died = () =>
          state.observations.protagonists.some(
            (o) =>
              o.phase === 'incident' &&
              o.type === 'character' &&
              o.data.character === 'b' &&
              o.data.status === 'dead',
          );
        for (let i = 0; !died() && i < 60; i++) {
          const p = state.pending!;
          const next = advance(pack, state, p.actor, {
            id: 'audit-' + i,
            expectedRevision: state.revision,
            decisionId: p.id,
            choice: play(state),
          });
          assert.equal(
            next.status,
            'ok',
            JSON.stringify([p, next.status === 'rejected' && next.reason]),
          );
          state = next.state;
        }
        assert.ok(died());
        const live = new LiveKnowledge(pack, opening);
        const history = state.observations.protagonists;
        let through = 0;
        let checks = 0;
        function permutations(rest: readonly string[]): string[][] {
          return rest.length
            ? rest.flatMap((r) =>
                permutations(rest.filter((v) => v !== r)).map((tail) => [r, ...tail]),
              )
            : [[]];
        }
        const legal = permutations(roles).filter(
          (r) => (module !== 'BTX' || r[0] === '关键人物') && (module !== 'MZ' || r[2] === '忍者'),
        );
        for (const batch of completeObservationGroups(history)) {
          live.append(batch, through, through + batch.length);
          through += batch.length;
          const death = batch.some(
            (o) => o.phase === 'incident' && o.type === 'character' && o.data.status === 'dead',
          );
          if (checks && !batch.some((o) => o.phase === 'incident')) continue;
          const ref = new EnumeratedKnowledge(pack, opening, 5000, true);
          ref.update(history.slice(0, through), through);
          live.verifyCombinations();
          live.tick(1, 1);
          assert.notEqual(
            live.queryConfiguration(setup),
            'excluded',
            'limited work lost the actual script',
          );
          const actual = exact(live);
          const key = (s: GameSetup) =>
            canonical({
              ...s,
              x: [...s.x].sort(),
              characters: s.characters.map((c) => ({
                ...c,
                initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
              })),
              incidents: s.incidents.map((i) => ({ ...i, publicName: i.publicName ?? i.name })),
            });
          assert.deepEqual(
            new Set(actual.map(key)),
            new Set(exact(ref).map(key)),
            'prefix ' + through,
          );
          const real = actual.filter((s) => s.incidents[0]?.name === '自杀');
          const assignments = new Set(
            real.map((s) => s.characters.map((c) => c.identity).join('/')),
          );
          const hand = new Set(
            legal
              .filter(
                (r) =>
                  !death ||
                  ((module !== 'MC' || r[1] === '强迫症') &&
                    (module !== 'MZ' || (r[1] === '平民' && (cardOnBoard || r[0] !== '预言家')))),
              )
              .map((r) => r.join('/')),
          );
          if (!checks || death)
            assert.deepEqual(assignments, hand, 'manual identity permutations at ' + through);
          if (death) {
            // Suspend an actual joint search mid-enumeration, then give it the death evidence.
            const interrupted = new LiveKnowledge(pack, opening);
            const start = opening.observations.length;
            interrupted.append(history.slice(0, start), 0, start);
            interrupted.verifyCombinations();
            interrupted.tick(100, 2);
            assert.ok((interrupted.snapshot().propagation?.branches ?? 0) >= 2);
            assert.equal(interrupted.jointSolutions(), undefined);
            interrupted.append(history.slice(start, through), start, through);
            const resumed = exact(interrupted).map(key).sort();
            assert.deepEqual(
              resumed,
              actual.map(key).sort(),
              'new evidence during recursive search',
            );
            assert.deepEqual(new Set(real.map((s) => s.incidents[0]!.culprit)), new Set(['b']));
            assert.equal(real.length, hand.size);
            // No candidate event can add 17 goodwill to the corpse during this death batch.
            const impossible = structuredClone(history.slice(0, through));
            const victim = impossible.find(
              (o) => o.phase === 'incident' && o.type === 'character' && o.data.status === 'dead',
            )!;
            victim.data.counters = {
              ...(victim.data.counters as (typeof state.characters)[string]['counters']),
              goodwill: 17,
            };
            const negative = new LiveKnowledge(pack, opening);
            negative.append(impossible, 0, through);
            negative.verifyCombinations();
            const deadline = performance.now() + 90000;
            while (!negative.paused && performance.now() < deadline) negative.tick(20, Infinity);
            assert.equal(negative.snapshot().status, 'contradiction');
            console.log(
              JSON.stringify({
                module,
                checks: checks + 1,
                prefix: through,
                realSuicide: real.length,
                total: actual.length,
              }),
            );
            return;
          }
          checks++;
        }
        assert.fail('missing complete death batch');
      },
    );
