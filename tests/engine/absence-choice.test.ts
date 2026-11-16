import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAbsenceSpace,
  absenceSolutions,
  type AbsenceWindow,
} from '../../packages/engine/src/absence/index.js';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';
import { character, lab } from '../comprehensive/harness.js';

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
