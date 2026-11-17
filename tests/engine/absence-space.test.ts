import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation } from '../../packages/contracts/src/game.js';
import { observeDayEnd } from '../../packages/engine/src/absence/day-end-history.js';
import {
  absenceSolutions,
  buildAbsenceSpace,
  type AbsenceWindow,
} from '../../packages/engine/src/absence/index.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { zeroCounters } from '../../packages/engine/src/runtime/model.js';
import { character, lab, phase } from '../comprehensive/harness.js';

const pack = compileOfficial('BTX');
const roles = ['平民', '杀人狂', '时间旅者'];
const domains = { A: roles, B: roles };
test('日末日志由连续的阶段边界闭合，中途投递、缺号和提前结束均不能证明无人死亡', () => {
  const { entry } = pair();
  const start: Observation = {
    sequence: 12,
    loop: 1,
    day: 1,
    phase: 'day-end',
    type: 'boundary',
    data: { phase: 'day-end' },
  };
  const end: Observation = {
    sequence: 13,
    loop: 1,
    day: 2,
    phase: 'day-start',
    type: 'boundary',
    data: { phase: 'day-start' },
  };
  const read = (reports: Observation[]) =>
    buildAbsenceSpace(pack, observeDayEnd(entry, reports), domains);
  assert.equal(read([start, end]).constraints.length, 2);
  assert.equal(read([start]).constraints.length, 0);
  assert.equal(read([start, { ...end, sequence: 14 }]).constraints.length, 0);
  assert.equal(
    read([start, { ...end, day: 1, phase: 'loop-end', data: { phase: 'loop-end' } }]).constraints
      .length,
    0,
  );
  const died: Observation = {
    ...start,
    sequence: 13,
    type: 'character',
    data: { character: 'B', status: 'dead' },
  };
  const revived: Observation = { ...died, sequence: 14, data: { character: 'B', status: 'alive' } };
  assert.deepEqual(
    read([start, died, revived, { ...end, sequence: 15 }]).constraints.map((c) => c.target),
    ['A'],
  );
});
function pair(): AbsenceWindow {
  return {
    timing: { kind: 'day-end' },
    coverage: 'complete',
    entry: {
      module: 'BTX',
      anniversary: false,
      loop: 1,
      day: 1,
      days: 3,
      loops: 2,
      phase: 'day-end',
      boards: { school: 0, city: 0, hospital: 0, shrine: 0 },
      characters: ['A', 'B'].map((id, i) => ({
        id,
        character: i ? '女学生' : '男学生',
        area: 'school',
        status: 'alive',
        counters: zeroCounters(),
      })),
    },
    absent: ['A', 'B'].map((character) => ({ character, phenomenon: 'death' })),
  };
}

test('反向关系逐行匹配正向结算，包括双杀、双向不死与守护抵消', () => {
  for (const guard of [0, 1]) {
    const w = pair();
    w.entry.characters[1]!.counters.guard = guard;
    const space = buildAbsenceSpace(pack, w, domains);
    const rows = [...absenceSolutions(space)];
    assert.equal(rows.length, guard ? 7 : 6);
    assert.equal(space.constraints.length, guard ? 1 : 2);
    assert.deepEqual(space.domains, domains);
    for (const A of roles)
      for (const B of roles) {
        const l = lab();
        character(l, 'a', '男学生', A, 'school');
        character(l, 'b', '女学生', B, 'school').counters.guard = guard;
        character(l, 'c', '医生', '平民', 'hospital');
        character(l, 'd', '巫女', '平民', 'shrine');
        phase(l, 'day-end');
        const survived = ['a', 'b'].every((id) => l.state.characters[id]!.status === 'alive');
        assert.equal(
          rows.some((r) => r.A === A && r.B === B),
          survived,
          JSON.stringify({ A, B, guard }),
        );
      }
  }
});

test('空间只使用已结算时点和明确观察对象；第三名存活者与潜在代死保留解释', () => {
  for (const coverage of ['partial', 'interrupted'] as const)
    assert.equal(buildAbsenceSpace(pack, { ...pair(), coverage }, domains).constraints.length, 0);
  const w = pair();
  w.entry.phase = 'incident';
  assert.equal(buildAbsenceSpace(pack, w, domains).constraints.length, 0);
  w.entry.phase = 'day-end';
  w.absent = [{ phenomenon: 'death', character: 'B' }];
  assert.deepEqual(
    [...absenceSolutions(buildAbsenceSpace(pack, w, { A: ['杀人狂'], B: roles }))],
    [{ A: '杀人狂', B: '时间旅者' }],
  );
  w.entry.characters.push({ ...w.entry.characters[0]!, id: 'C' });
  assert.equal(buildAbsenceSpace(pack, w, domains).constraints.length, 0);
  w.entry.characters[2]!.status = 'dead';
  assert.equal(buildAbsenceSpace(pack, w, domains).constraints.length, 1);
  w.entry.characters[0]!.character = '从者';
  assert.equal(buildAbsenceSpace(pack, w, domains).constraints.length, 0);
});

test('目击者使用有效不安，死亡未发生可剪去单一身份', () => {
  const wm = compileOfficial('WM');
  const w = pair();
  w.entry.module = 'WM';
  const a = w.entry.characters[0]!;
  const d = { A: ['平民', '目击者'], B: ['平民'] };
  a.counters.paranoia = 3;
  assert.equal(buildAbsenceSpace(wm, w, d).constraints.length, 0);
  a.counters.despair = 1;
  assert.deepEqual([...absenceSolutions(buildAbsenceSpace(wm, w, d))], [{ A: '平民', B: '平民' }]);
  a.counters.guard = 1;
  assert.equal(buildAbsenceSpace(wm, w, d).constraints.length, 0);
});

test('轮回末死亡的亲友及死亡反应的密钥必须公开身份', () => {
  const w = pair();
  w.entry.phase = 'loop-end';
  w.timing = { kind: 'loop-end' };
  w.absent = [{ phenomenon: 'identity-reveal', character: 'A' }];
  w.entry.characters[0]!.status = 'dead';
  const d = { A: ['平民', '亲友'], B: ['平民'] };
  assert.deepEqual(
    [...absenceSolutions(buildAbsenceSpace(pack, w, d))],
    [{ A: '平民', B: '平民' }],
  );
  w.entry.characters[0]!.status = 'alive';
  assert.equal(buildAbsenceSpace(pack, w, d).constraints.length, 0);
  w.entry.module = 'LL';
  w.timing = { kind: 'death', owner: 'A' };
  w.entry.characters[0]!.status = 'dead';
  assert.equal(
    buildAbsenceSpace(compileOfficial('LL'), w, { A: ['密钥'], B: ['平民'] }).constraints[0]
      ?.ability,
    'key-reveal-death',
  );
});
