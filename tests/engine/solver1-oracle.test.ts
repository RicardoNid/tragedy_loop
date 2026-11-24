import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import {
  engineOracle,
  independentCandidates,
  publicGroups,
} from '../../scripts/engine/solver1-oracle.js';
import { focusedHistory, focusedTimelineCases } from './knowledge-timeline-cases.js';

const pack = compileOfficial('FS');
const setup: GameSetup = {
  module: 'FS',
  anniversary: false,
  loops: 1,
  days: 1,
  captain: 'p0',
  discussion: 'allowed',
  y: '复仇的火种',
  x: ['流言四起'],
  characters: [
    { id: 'a', character: '男学生', identity: '主谋' },
    { id: 'b', character: '巫女', identity: '传谣人' },
  ],
  incidents: [{ day: 1, name: '医院事故', culprit: 'a' }],
};

test('independent finite domain contains both identity orders and both culprits', () => {
  const start = initializeDiscussion(pack, setup);
  assert.ok(start.state);
  const candidates = independentCandidates(pack, initialPlacementView(start.state));
  assert.equal(candidates.length, 4);
  assert.deepEqual(
    new Set(candidates.map((c) => c.characters.map((v) => v.identity).join('/'))),
    new Set(['主谋/传谣人', '传谣人/主谋']),
  );
  assert.deepEqual(new Set(candidates.map((c) => c.incidents[0]!.culprit)), new Set(['a', 'b']));
});

test('engine oracle accepts engine output, rejects impossible content, and preserves budget uncertainty', () => {
  const start = initializeDiscussion(pack, setup);
  assert.ok(start.state?.pending);
  const state = start.state;
  const next = advance(pack, state, state.pending!.actor, {
    id: 'oracle-test',
    expectedRevision: state.revision,
    decisionId: state.pending!.id,
    choice: { kind: 'continue' },
  });
  assert.equal(next.status, 'ok');
  const history = next.state.observations.protagonists;
  assert.equal(engineOracle(pack, setup, history).verdict, 'possible');
  assert.equal(engineOracle(pack, setup, history, 0).verdict, 'unknown');
  const wrong = structuredClone(history);
  wrong[0]!.data = { impossible: 'oracle-negative-control' };
  assert.equal(engineOracle(pack, setup, wrong).verdict, 'excluded');
});

test('independent report matching preserves simultaneous multiplicity and buffers incomplete groups', () => {
  const first = {
    sequence: 1,
    simultaneousGroup: 1,
    simultaneousSize: 2,
    loop: 1,
    day: 1,
    phase: 'incident' as const,
    type: 'board' as const,
    data: { board: 'city', intrigue: 1 },
  };
  const second = { ...first, sequence: 2, data: { board: 'school', intrigue: 1 } };
  assert.deepEqual(publicGroups([first]), []);
  assert.deepEqual(
    publicGroups([first, second]),
    publicGroups([
      { ...second, sequence: 1 },
      { ...first, sequence: 2 },
    ]),
  );
  assert.notDeepEqual(
    publicGroups([first, second]),
    publicGroups([first, { ...first, sequence: 2 }]),
  );
});

for (const id of ['FS-goodwill-effective', 'BTX-incident-fixed'])
  test(id + ' independent oracle checks a complete legal path and a corrupted late effect', () => {
    const fixture = focusedTimelineCases.find((item) => item.id === id)!;
    const { pack: rules, history } = focusedHistory(fixture);
    const answer = engineOracle(rules, fixture.setup, history, 100000, 10000);
    assert.equal(answer.verdict, 'possible');
    assert.ok(answer.witness?.length);
    const corrupted = structuredClone(history);
    const effect = corrupted.find(
      (report) =>
        report.phase === fixture.focus && (report.type === 'board' || report.type === 'character'),
    );
    assert.ok(effect);
    effect.data = { ...effect.data, impossibleOracleMarker: true };
    assert.equal(engineOracle(rules, fixture.setup, corrupted, 100000, 10000).verdict, 'excluded');
  });
