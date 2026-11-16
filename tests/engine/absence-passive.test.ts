import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';
import { character, lab } from '../comprehensive/harness.js';

test('常驻临时工死亡请求、守护和替代结算均在阶段内核验', () => {
  const l = lab();
  l.state.phase = 'day-end';
  l.state.phaseEntered = false;
  l.state.pending = null;
  const c = character(l, 'a', '临时工', '平民', 'hospital');
  const e = {
    start: { loop: l.state.loop, day: l.state.day, phase: 'day-end' as const },
    end: { loop: l.state.loop, day: l.state.day + 1, phase: 'day-start' as const },
    coverage: 'complete' as const,
    absent: [{ type: 'character' as const, fields: { character: 'a', status: 'dead' } }],
  };
  c.counters.paranoia = 2;
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'possible');
  c.counters.intrigue = 1;
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'excluded');
  c.counters.guard = 1;
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'possible');
  c.counters.guard = 0;
  const guardian = character(l, 'b', '从者', '平民', 'hospital');
  guardian.flags.protect = 'a';
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'possible');
  assert.equal(
    verifyAbsencePhase(
      l.pack,
      l.state,
      { ...e, absent: [{ type: 'character', fields: { status: 'dead' } }] },
      200,
    ).status,
    'excluded',
  );
});
