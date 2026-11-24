import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import type { GameSetup, Module } from '../../packages/contracts/src/game.js';
import { pathToFileURL } from 'node:url';
import { openingOracle } from './solution3-opening-oracle.js';

const fixtures: [Module, string, string[], string[]][] = [
  ['BTX', '巨大定时炸弹X', ['流言四起', '因果线'], ['魔女', '传谣人']],
  ['MZ', '男子汉的战争', ['X异因子', '死亡真人秀'], ['忍者', '不安定因子', '魔术师', '永生者']],
  ['MC', '黑暗学园', ['火药的味道', '潜伏的杀人狂'], ['主谋', '杀人狂', '杀人狂', '亲友']],
  ['HSA', '古墓活尸', ['少女大危机', '怪物们的阴谋'], ['传谣人', '关键人物']],
  ['WM', '巨大定时炸弹Y', ['流言四起', '无貌之神'], ['魔女', '深潜者', '传谣人', '巫师', '无面者']],
  ['LL', '恶魔的剧本', ['超越世界线', 'X异因子'], ['杀人狂', '监视者', '传谣人', '不安定因子']],
];
const cast = ['职员', '女学生', '巫女', '男学生', '刑警'];
export function compareModules() {
  for (const [module, y, x, roles] of fixtures) {
    const pack = compileOfficial(module);
    const setup: GameSetup = {
      module,
      y,
      x,
      anniversary: false,
      days: 1,
      loops: 1,
      captain: 'p0',
      discussion: 'between-loops',
      incidents: [],
      characters: roles.map((identity, i) => ({ id: 'c' + i, identity, character: cast[i]! })),
      ...(module === 'LL' ? { privateRoles: { p0: 'A', p1: 'B', p2: 'C' } } : {}),
    };
    const initial = initializeDiscussion(pack, setup);
    assert(initial.state, JSON.stringify(initial.diagnostics));
    const opening = initialPlacementView(initial.state);
    const play = advance(pack, initial.state, 'p0', {
      id: 'continue',
      expectedRevision: initial.state.revision,
      decisionId: initial.state.pending!.id,
      choice: { kind: 'continue' },
    });
    const v = project(play.state, 'protagonists');
    let t = performance.now();
    const three = new SolutionSpace3(opening);
    const openingAttempts = three.model.graph.work.combinations;
    three.append(v.observations, v.characters);
    const ms3 = performance.now() - t;
    assert(!three.conflict, three.conflict);
    t = performance.now();
    const one = new LiveKnowledge(pack, opening);
    one.update(v.observations, v.revision);
    one.verifyCombinations();
    while (one.snapshot().status === 'running' && performance.now() - t < 15000) one.tick(25);
    const s = one.snapshot(),
      ms1 = performance.now() - t;
    const diff = [];
    const oracle = openingOracle(pack, setup, v.observations);
    assert(oracle.witnesses);
    const oracleDiff = [];
    const plotNames = Object.entries(three.model.plots)
      .filter(([, a]) => three.model.graph.truth(a) !== false)
      .map(([n]) => n)
      .sort();
    const oraclePlots = [...oracle.plots].sort();
    for (const c of setup.characters) {
      const row = three.model.ids.get(c.character)!;
      const candidates = Object.keys(row)
        .filter((n) => three.model.graph.truth(row[n]!) !== false)
        .sort();
      assert(candidates.includes(c.identity));
      const expected = s.identities[c.id]?.slice().sort();
      if (s.status === 'exact')
        assert(expected?.includes(c.identity), module + c.character + ' 求解器1误删');
      if (candidates.join() !== expected?.join())
        diff.push({ character: c.character, one: expected, three: candidates });
      const exact = [...oracle.rows[setup.characters.indexOf(c)]!].sort();
      if (candidates.join() !== exact.join())
        oracleDiff.push({ character: c.character, oracle: exact, three: candidates });
    }
    console.log(
      JSON.stringify({
        module,
        phase: v.phase,
        through: three.through,
        status1: s.status,
        generated1: s.generated,
        ms1,
        ms3,
        sourceChecks3: three.model.graph.work.sources.length,
        openingAttempts,
        incrementalAttempts: three.model.graph.work.combinations,
        configurations3: 0,
        diff,
        oracleDiff,
        oracleWitnesses: oracle.witnesses,
        oracleValidations: oracle.validations,
      }),
    );
    assert.deepEqual(oracleDiff, [], module + ' 独立穷举角色投影不同');
    assert.deepEqual(plotNames, oraclePlots, module + ' 独立穷举规则投影不同');
    if (s.status === 'exact') {
      assert.deepEqual(diff, [], module + ' 精确角色投影不同');
      assert.deepEqual(s.rules.slice().sort(), oraclePlots, module + ' 求解器1精确规则投影不同');
    }
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) compareModules();
