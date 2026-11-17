import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { drive } from '../../packages/engine/src/runtime/engine.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import { inferObservedWorlds } from '../../packages/engine/src/decision/observed-worlds.js';
import { DayEndIntersection } from '../../packages/engine/src/decision/day-end-intersection.js';
import { adviseObservedGame, type ObservedQuestion } from '../../scripts/engine/observed-game.js';
import { character, lab, type Lab } from '../comprehensive/harness.js';

test('十二个合法剧本同一区域两人无人死亡；正反求交保留八套剧本、32 条相容历史，逐状态等于正向穷举', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/day-end-observation-example.json', import.meta.url),
      'utf8',
    ),
  ) as ObservedQuestion;
  const pack = compileOfficial('BTX');
  const generated = generateSetups(pack, q.evidence, q.setupDomains!, 5000);
  const setups = [...generated.setups];
  assert.equal(setups.length, 12);
  for (const order of [setups, [...setups].reverse()]) {
    const plain = inferObservedWorlds(pack, order, true, q.evidence, 5000, 80, false);
    const fast = inferObservedWorlds(pack, order, true, q.evidence, 5000, 80, {
      script: false,
      dayEnd: true,
    });
    assert.deepEqual(new Set(fast.states.map(canonical)), new Set(plain.states.map(canonical)));
    assert.equal(fast.states.length, 32);
    assert.ok(fast.exhaustive && plain.exhaustive);
    const expected = order.filter((s) => {
      const pair = s.characters
        .filter((c) => c.id === 'doctor' || c.id === 'patient')
        .map((c) => c.identity);
      return !pair.includes('杀人狂') || pair.includes('时间旅者');
    });
    assert.equal(expected.length, 8);
    assert.deepEqual(
      new Set(fast.states.map((s) => canonical(s.setup))),
      new Set(expected.map(canonical)),
    );
    assert.equal(fast.dayEndPruning?.excluded, 8);
    assert.equal(fast.dayEndPruning.compiled, 1);
    assert.deepEqual(
      fast.dayEndPruning.windows.map((w) => [w.firstReport, w.lastReport]),
      [[24, 25]],
    );
    assert.ok(fast.work < plain.work);
  }
  assert.deepEqual(
    adviseObservedGame(q).advice,
    adviseObservedGame({ ...q, dayEndAbsence: false }).advice,
  );
});

function boundary(l: Lab) {
  const s = l.state;
  s.phase = 'day-end';
  s.phaseEntered = false;
  s.pending = null;
  s.frames = [];
  s.batch = null;
  announce(s, 'boundary', { phase: 'day-end', captain: s.captain });
  const cursor = s.observations.protagonists.length;
  const last: Observation = {
    sequence: cursor + 1,
    loop: s.loop,
    day: s.day + 1,
    phase: 'day-start',
    type: 'boundary',
    data: { phase: 'day-start', captain: s.captain },
  };
  return { cursor, reports: [...s.observations.protagonists, last] };
}
test('24 组双人日末，死亡保护与免死保留；仅在正向真正排队的强制批次之后剪枝', () => {
  for (const killer of [false, true])
    for (const other of ['平民', '时间旅者', '杀人狂'])
      for (const guard of [0, 1])
        for (const additional of [false, true]) {
          const l = lab();
          character(l, 'a', '职员', killer ? '杀人狂' : '平民', 'city');
          character(l, 'b', '男学生', other, 'city').counters.guard = guard;
          character(l, 'c', '医生', '平民', additional ? 'city' : 'hospital');
          character(l, 'd', '巫女', '平民', 'shrine');
          const { cursor, reports } = boundary(l);
          const s = l.state,
            start = { loop: s.loop, day: s.day, phase: 'day-end' as const };
          const run = verifyAbsencePhase(
            l.pack,
            s,
            {
              coverage: 'complete',
              start,
              end: { ...start, day: s.day + 1, phase: 'day-start' },
              absent: ['a', 'b', 'c', 'd'].map((character) => ({
                type: 'character' as const,
                fields: { character, status: 'dead' },
              })),
            },
            3000,
          );
          const proof = new DayEndIntersection(l.pack, reports);
          assert.equal(proof.excludes(s, cursor), false);
          drive(l.pack, s, 1);
          const mustDie =
            !additional && ((killer && !guard && other !== '时间旅者') || other === '杀人狂');
          assert.equal(run.status, mustDie ? 'excluded' : 'possible');
          assert.equal(proof.excludes(s, cursor), mustDie);
        }
});
test('有发动次数的投毒者与强制选人，查询所有目标组合；任一合法不死目标保留无死亡路径', () => {
  for (const b of ['平民', '侦探'])
    for (const c of ['平民', '侦探']) {
      const l = lab('MC');
      l.state.ex = 2;
      character(l, 'a', '男学生', '投毒者', 'school');
      character(l, 'b', '女学生', b, 'school');
      character(l, 'c', '医生', c, 'school');
      character(l, 'd', '巫女', '平民', 'shrine');
      const { reports, cursor } = boundary(l);
      drive(l.pack, l.state, 1);
      const proof = new DayEndIntersection(l.pack, reports);
      assert.equal(proof.excludes(l.state, cursor), b === '平民' && c === '平民');
    }
});
test('时序前置效果、待办延迟、窗口未闭合、插入败北与观察断号全部交回原检查', () => {
  for (const module of ['BTX', 'HSA', 'AHR'] as const) {
    const l = lab(module);
    character(l, 'a', '职员', '杀人狂', 'city');
    character(l, 'b', '女学生', '平民', 'city');
    const { cursor, reports } = boundary(l);
    const delayed = clone(l.state);
    delayed.delayed = [
      {
        loop: delayed.loop,
        day: delayed.day,
        timing: 'day-end',
        effects: [{ op: 'fail' }],
        env: {},
      },
    ];
    drive(l.pack, delayed, 1);
    assert.equal(new DayEndIntersection(l.pack, reports).excludes(delayed, cursor), false);
    drive(l.pack, l.state, 1);
    const last = reports.at(-1)!;
    const failure: Observation = {
      ...last,
      phase: 'day-end',
      day: l.state.day,
      type: 'failure',
      data: { result: 'protagonist-failure' },
    };
    for (const cut of [
      reports.slice(0, -1),
      reports.map((o, i) =>
        i === cursor - 1 ? { ...o, data: { ...o.data, captain: 'different' } } : o,
      ),
      [...reports.slice(0, -1), { ...last, sequence: last.sequence + 1 }],
      [...reports.slice(0, -1), failure, { ...last, sequence: last.sequence + 1 }],
    ]) {
      assert.equal(new DayEndIntersection(l.pack, cut).excludes(l.state, cursor), false);
    }
    assert.equal(
      new DayEndIntersection(l.pack, reports).excludes(l.state, cursor),
      module === 'BTX',
    );
  }
});
