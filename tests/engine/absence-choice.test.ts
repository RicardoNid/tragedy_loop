import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAbsenceSpace,
  absenceSolutions,
  type AbsenceWindow,
} from '../../packages/engine/src/absence/index.js';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';
import { advance, drive, settledPhaseBoundary } from '../../packages/engine/src/runtime/engine.js';
import { character, lab } from '../comprehensive/harness.js';

test('日末边界见证可以实际重放，放弃不能排除另一条提前轮末的历史', () => {
  const l = lab(),
    pack = structuredClone(l.pack),
    s = l.state;
  s.phase = 'day-end';
  s.phaseEntered = true;
  s.pending = null;
  s.day = s.loop = 1;
  const start = { phase: 'day-end' as const, day: 1, loop: 1 };
  const nextDay = { phase: 'day-start' as const, day: 2, loop: 1 };
  const loopEnd = { phase: 'loop-end' as const, day: 1, loop: 1 };
  const evidence = { start, end: nextDay, coverage: 'complete' as const, absent: [] };
  assert.deepEqual(settledPhaseBoundary(pack, s)?.boundary, nextDay);
  s.day = s.setup.days;
  assert.equal(settledPhaseBoundary(pack, s)?.boundary.phase, 'loop-end');
  s.day = 1;
  s.phaseEntered = false;
  assert.equal(settledPhaseBoundary(pack, s), undefined);
  s.endRequested = true;
  assert.deepEqual(settledPhaseBoundary(pack, s)?.boundary, loopEnd);
  s.endRequested = false;
  s.phaseEntered = true;
  const plot = pack.plots['谋杀计划']!;
  plot.abilities = [
    {
      id: 'end-early',
      timing: 'day-end',
      source: 'fixture',
      steps: [{ effects: [{ op: 'end-loop' }] }],
    },
  ];
  s.setup.y = plot.name;
  assert.equal(settledPhaseBoundary(pack, s), undefined);
  drive(pack, s, 1);
  const pending = s.pending as typeof l.state.pending;
  assert.ok(pending?.kind === 'ability');
  const before = structuredClone(s);
  const actual = verifyAbsencePhase(pack, s, evidence, 1);
  assert.deepEqual(actual.witness, [{ kind: 'pass' }]);
  const replay = advance(
    pack,
    s,
    pending.actor,
    {
      id: 'replay-pass',
      expectedRevision: s.revision,
      decisionId: pending.id,
      choice: actual.witness![0]!,
    },
    1,
  );
  assert.equal(replay.state.phase, 'day-start');
  assert.equal(replay.state.day, 2);
  assert.deepEqual(s, before);
  assert.equal(verifyAbsencePhase(pack, s, { ...evidence, end: loopEnd }, 100).status, 'possible');
  assert.equal(verifyAbsencePhase(pack, s, { ...evidence, decisions: [] }, 100).status, 'excluded');
  assert.equal(
    verifyAbsencePhase(pack, s, { ...evidence, coverage: 'partial' }, 100).status,
    'unknown',
  );
  assert.equal(verifyAbsencePhase(pack, s, evidence, 0).status, 'unknown');
});

test('真实 MC 日末强制选人：只要有一个合法不死目标，未死亡仍有见证', () => {
  const l = lab('MC');
  l.state.phase = 'day-end';
  l.state.phaseEntered = false;
  l.state.pending = null;
  l.state.ex = 2;
  character(l, 'a', '男学生', '投毒者', 'school');
  character(l, 'b', '女学生', '平民', 'school');
  character(l, 'c', '医生', '平民', 'school');
  character(l, 'd', '巫女', '平民', 'shrine');
  const roles = ['平民', '侦探'];
  const a = { owner: 'a', ability: 'poisoner-character' };
  const w: AbsenceWindow = {
    entry: { ...l.state, ...l.state.setup, characters: Object.values(l.state.characters) },
    timing: { kind: 'day-end' },
    coverage: 'complete',
    availableLimitedAbilities: [a],
    absent: ['a', 'b', 'c'].map((character) => ({ character, phenomenon: 'death' })),
  };
  const domains = { a: ['投毒者'], b: roles, c: roles, d: ['平民'] };
  const s = buildAbsenceSpace(l.pack, w, domains);
  assert.equal(s.choiceConflicts?.length, 1);
  const rows = [...absenceSolutions(s)];
  assert.equal(rows.length, 3);
  const start = { phase: 'day-end' as const, loop: l.state.loop, day: l.state.day };
  for (const b of roles)
    for (const c of roles) {
      l.state.characters.b!.identity = b;
      l.state.characters.c!.identity = c;
      const value = verifyAbsencePhase(
        l.pack,
        l.state,
        {
          coverage: 'complete',
          start,
          end: { ...start, phase: 'day-start', day: start.day + 1 },
          absent: w.absent.map((e) => ({
            type: 'character',
            fields: { character: e.character, status: 'dead' },
          })),
        },
        2000,
      );
      assert.equal(
        value.status,
        rows.some((r) => r.b === b && r.c === c) ? 'possible' : 'excluded',
      );
    }
  for (const changed of [
    { availableLimitedAbilities: [] },
    { absent: w.absent.slice(0, 2) },
    { entry: { ...w.entry, ex: 1 } },
  ]) {
    assert.equal(
      [...absenceSolutions(buildAbsenceSpace(l.pack, { ...w, ...changed }, domains))].length,
      4,
    );
  }
});
