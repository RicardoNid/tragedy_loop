import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import {
  EnumeratedKnowledge,
  LiveKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.js';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';

function setup(anniversary: boolean): GameSetup {
  return {
    module: 'WM',
    anniversary,
    loops: 1,
    days: 1,
    captain: 'p0',
    discussion: 'allowed',
    y: '巨大定时炸弹Y',
    x: ['流言四起', anniversary ? '超越世界线' : '见证恐惧'],
    characters: [
      { id: 'a', character: '男学生', identity: anniversary ? '平民' : '魔女' },
      { id: 'b', character: '女学生', identity: anniversary ? '魔女' : '深潜者' },
      { id: 'c', character: '大小姐', identity: anniversary ? '深潜者' : '传谣人' },
      { id: 'd', character: '巫女', identity: anniversary ? '传谣人' : '目击者' },
    ],
    incidents: [],
    ...(anniversary ? { anniversaryFragment: 'a' } : {}),
  };
}
function finish(solver: EnumeratedKnowledge | LiveKnowledge) {
  for (let n = 0; !solver.paused && n < 10000; n++) solver.tick(20, Infinity);
  assert.equal(solver.snapshot().status, 'exact', JSON.stringify(solver.snapshot().reasons));
  assert.ok(solver.snapshot().domainComplete);
}

for (const anniversary of [false, true])
  test(`WM initial exhaustive space retains both first-X orders; anniversary ${anniversary}`, () => {
    const pack = compileOfficial('WM', anniversary),
      config = setup(anniversary);
    const start = initializeDiscussion(pack, config);
    assert.ok(start.state, JSON.stringify(start.diagnostics));
    const opening = initialPlacementView(start.state);
    const domain = [...generateDomain(pack, opening)].filter((s): s is GameSetup => !!s);
    const key = (s: GameSetup) =>
      canonical({
        y: s.y,
        x: s.x,
        anniversaryFragment: s.anniversaryFragment,
        alternateY: s.alternateY,
        characters: s.characters.map((c) => ({
          ...c,
          initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
        })),
      });
    const expected = new Set(domain.map(key));
    assert.equal(domain.length, 144);
    assert.equal(expected.size, domain.length);
    for (const s of domain) assert.ok(expected.has(key({ ...s, x: [...s.x].reverse() })));
    const exhaustive = new EnumeratedKnowledge(pack, opening, 1000, true);
    assert.equal(exhaustive.jointSolutions(), undefined);
    exhaustive.update(opening.observations, 1);
    finish(exhaustive);
    assert.equal(exhaustive.snapshot().possible, 144);
    assert.deepEqual(new Set(exhaustive.jointSolutions()!.map(key)), expected);
    const live = new LiveKnowledge(pack, opening);
    live.append(opening.observations, 0, 1);
    live.verifyCombinations();
    finish(live);
    assert.deepEqual(new Set(live.jointSolutions()!.map(key)), expected);
  });

test('an exact initial count without a complete materialized cache does not expose an empty solution set', () => {
  const pack = compileOfficial('WM');
  const start = initializeDiscussion(pack, setup(false));
  assert.ok(start.state);
  const opening = initialPlacementView(start.state);
  const exhaustive = new EnumeratedKnowledge(pack, opening, 1, true);
  exhaustive.update(opening.observations, 1);
  finish(exhaustive);
  assert.equal(exhaustive.snapshot().possible, 144);
  assert.equal(exhaustive.jointSolutions(), undefined);
});

test('WM public first-X revelation distinguishes reversed orders in complete-configuration queries', () => {
  const pack = structuredClone(compileOfficial('WM')),
    config = setup(false);
  pack.moduleAbilities.push({
    owner: 'timeline-fixture',
    ability: {
      id: 'public-ex',
      source: 'fixture',
      timing: 'loop-start',
      mandatory: true,
      steps: [{ effects: [{ op: 'ex', amount: 2 }] }],
    },
  });
  const start = initializeDiscussion(pack, config);
  assert.ok(start.state);
  let state = start.state;
  const opening = initialPlacementView(state);
  for (let n = 0; n < 80 && !state.observations.public.some((o) => o.type === 'rule'); n++) {
    const pending = state.pending;
    assert.ok(pending);
    const choice =
      pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
      enumerateChoices(state).next().value;
    assert.ok(choice);
    const next = advance(pack, state, pending.actor, {
      id: 'first-x-' + n,
      expectedRevision: state.revision,
      decisionId: pending.id,
      choice,
    });
    assert.equal(next.status, 'ok');
    state = next.state;
  }
  const history = project(state, 'protagonists').observations;
  assert.ok(history.some((o) => o.type === 'rule' && o.data.rule === config.x[0]));
  const exhaustive = new EnumeratedKnowledge(pack, opening, 1000, true);
  exhaustive.update(history, history.length);
  finish(exhaustive);
  assert.equal(exhaustive.queryConfiguration(config), 'possible');
  assert.equal(
    exhaustive.queryConfiguration({ ...config, x: [...config.x].reverse() }),
    'excluded',
  );
});
