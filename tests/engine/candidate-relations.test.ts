import test from 'node:test';
import assert from 'node:assert/strict';
import { symbolicCandidatePairs } from '../../packages/engine/src/runtime/knowledge-candidate-pairs.js';
import {
  ConstraintStore,
  relation,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';
import type { Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';

const report: Observation = {
  sequence: 3,
  loop: 1,
  day: 1,
  phase: 'mastermind-abilities',
  type: 'board',
  data: { board: 'school', intrigue: 1 },
};

test('the live projection wait for the full public group and retain its clause across an unrelated report', () => {
  const pack = compileOfficial('FS');
  const setup = initializeDiscussion(pack, {
    module: 'FS',
    anniversary: false,
    days: 2,
    loops: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '复仇的火种',
    x: ['流言四起'],
    incidents: [],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '女学生', identity: '传谣人' },
      { id: 'c', character: '巫女', identity: '平民' },
    ],
  });
  const opening = initialPlacementView(setup.state!);
  const first = new LiveKnowledge(pack, opening);
  const publicGroup: Observation[] = [
    { ...report, sequence: 1, simultaneousGroup: 1, simultaneousSize: 2 },
    {
      ...report,
      sequence: 2,
      simultaneousGroup: 1,
      simultaneousSize: 2,
      type: 'no-effect',
      data: {},
    },
  ];
  first.append(publicGroup.slice(0, 1), 0, 1);
  assert.deepEqual(first.snapshot().candidateRelations?.observations, []);
  first.append(publicGroup.slice(1), 1, 2);
  for (const relations of [
    first.snapshot().candidateRelations,
  ]) {
    assert.ok(
      relations?.observations.some((c) =>
        ['identity:a', 'identity:b', 'rule'].every((key) =>
          c.alternatives.some((row) => row.length === 1 && row[0]!.key === key),
        ),
      ),
      JSON.stringify(relations?.observations),
    );
  }
  const before = first.snapshot().candidateRelations;
  const next: Observation = { ...report, sequence: 3, type: 'no-effect', data: {} };
  first.append([next], 2, 3);
  assert.deepEqual(first.snapshot().candidateRelations, before);
});
const partition = (identities: string[], rule = '剧情甲') => ({
  identities,
  y: '主线',
  x: [rule],
  events: {},
  culprits: {},
  count: 1,
});

test('symbolic projections preserve a three-way event, culprit and identity dependency with unrestricted pairs', () => {
  const partitions = ['甲', '乙'].map((role, i) => ({
    ...partition([role, '丙', '丁']),
    count: 2,
    events: { 1: ['自杀', '伪造事件'] },
    culprits: { 1: ['a', 'b'] },
    eventRows: [['自杀'], ['伪造事件']],
    culpritRows: i ? [['b'], ['a']] : [['a'], ['b']],
  }));
  const profiles = partitions.map((p, i) => {
    const store = new ConstraintStore(
      new Map([
        ['identity:a', new Set([p.identities[0]!])],
        ['culprit:1', new Set(p.culprits[1])],
        ['event:1', new Set(p.events[1])],
      ]),
    );
    store.add(
      relation(
        'fixture',
        'event:1',
        'culprit:1',
        (e, c) => ((e === '自杀') === (c === 'a')) === (i === 0),
      ),
    );
    return { id: String(i), y: p.y, x: p.x, identityCounts: {}, active: true, store };
  });
  for (const result of [
    symbolicCandidatePairs(profiles),
  ]) {
    assert.equal(result.length, 1);
    assert.equal(result[0]!.left, 'identity:a');
    assert.equal(result[0]!.right, 'schedule:1');
    const forbidden = result[0]!.excluded
      .flatMap((group) =>
        group.left.flatMap((role) => group.right.map((encoded) => [role, ...JSON.parse(encoded)])),
      )
      .sort();
    assert.deepEqual(
      forbidden,
      [
        ['甲', '自杀', 'b'],
        ['甲', '伪造事件', 'a'],
        ['乙', '自杀', 'a'],
        ['乙', '伪造事件', 'b'],
      ].sort(),
    );
  }
});
