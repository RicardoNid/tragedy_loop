import { programWindow } from './program-window.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Module, Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { absenceProgramIndex } from '../../packages/engine/src/absence/programs.js';
import {
  verifyAbsencePhase,
  type PhaseEvidence,
} from '../../packages/engine/src/absence/phase-search.js';
import { propagateSolutions } from '../../packages/engine/src/absence/propagation.js';
import { solveAbsence } from '../../packages/engine/src/absence/solve.js';
import { advance, drive } from '../../packages/engine/src/runtime/engine.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { character, lab } from '../comprehensive/harness.js';

function day(module: Module = 'BTX', anniversary = false) {
  const l = lab(module, anniversary);
  l.state.pending = null;
  l.state.phase = 'day-end';
  l.state.phaseEntered = false;
  l.state.loop = 1;
  l.state.day = 1;
  return l;
}
const clock = { phase: 'day-end', loop: 1, day: 1 } as const;
const evidence: PhaseEvidence = {
  start: clock,
  end: { phase: 'day-start', loop: 1, day: 2 },
  coverage: 'complete',
  absent: [{ type: 'character', fields: { character: 'b', status: 'dead' } }],
};

test('真实阶段覆盖同时强制、可选放弃和守护；先传播后调用执行内核', () => {
  const l = day();
  character(l, 'a', '男学生', '杀人狂', 'school');
  character(l, 'b', '女学生', '平民', 'school');
  assert.equal(verifyAbsencePhase(l.pack, l.state, evidence, 200).status, 'excluded');
  l.state.characters.b!.counters.guard = 1;
  assert.equal(verifyAbsencePhase(l.pack, l.state, evidence, 200).status, 'possible');
  assert.equal(verifyAbsencePhase(l.pack, l.state, evidence, 0).status, 'unknown');
  assert.equal(
    verifyAbsencePhase(l.pack, l.state, { ...evidence, coverage: 'partial' }, 200).status,
    'unknown',
  );
  const stats = { branches: 0, solutions: 0, removed: 0 };
  l.state.characters.b!.counters.guard = 0;
  const entry = {
    ...clock,
    days: 4,
    loops: 3,
    module: l.pack.module,
    anniversary: false,
    boards: l.state.boards,
    characters: Object.values(l.state.characters),
  };
  let verified = 0;
  const rows = [
    ...solveAbsence(
      l.pack,
      {
        entry,
        coverage: 'complete',
        timing: { kind: 'day-end' },
        absent: [{ phenomenon: 'death', character: 'b' }],
      },
      { a: ['杀人狂'], b: ['平民', '时间旅者'], c: ['平民'], d: ['平民'] },
      {
        evidence,
        workPerRow: 200,
        worlds(row) {
          verified++;
          const s = clone(l.state);
          for (const [id, role] of Object.entries(row)) s.characters[id]!.identity = role;
          return { states: [s], exhaustive: true };
        },
      },
      stats,
    ),
  ];
  assert.equal(verified, 1);
  assert.equal(stats.branches, 0);
  assert.equal(stats.removed, 1);
  assert.deepEqual(
    rows.map((r) => [r.identities.b, r.status]),
    [['时间旅者', 'possible']],
  );
});

test('隐藏消耗、延迟任务和非身份公告也使用相同缺席检查', () => {
  const l = day();
  l.state.delayed = [
    { loop: 1, day: 1, timing: 'day-end', effects: [{ op: 'ex', amount: 1 }], env: {} },
  ];
  const e = { ...evidence, absent: [{ type: 'board' as const, fields: { ex: 1 } }] };
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'excluded');
  l.state.delayed = [];
  assert.equal(verifyAbsencePhase(l.pack, l.state, e, 200).status, 'possible');
});

test('约束传播对照暴力穷举，保持同一对变量的联合支持', () => {
  let seed = 43;
  const rand = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
  for (let trial = 0; trial < 100; trial++) {
    const ids = ['a', 'b', 'c', 'd'],
      roles = ['0', '1', '2'];
    const domains = Object.fromEntries(ids.map((id) => [id, roles]));
    const constraints = Array.from({ length: 16 }, () => ({
      source: 'fixture',
      ability: 'rel',
      phenomenon: 'death' as const,
      owner: ids[Math.floor(rand() * 4)]!,
      target: ids[Math.floor(rand() * 4)]!,
      identity: roles[Math.floor(rand() * 3)]!,
      targetIdentities: [roles[Math.floor(rand() * 3)]!],
    }));
    const expected = [];
    for (const a of roles)
      for (const b of roles)
        for (const c of roles)
          for (const d of roles) {
            const row: Record<string, string> = { a, b, c, d };
            if (
              !constraints.some(
                (q) => row[q.owner] === q.identity && q.targetIdentities.includes(row[q.target]!),
              )
            )
              expected.push([a, b, c, d].join(''));
          }
    assert.deepEqual(
      [...propagateSolutions({ domains, constraints })]
        .map((r) => ids.map((id) => r[id]).join(''))
        .sort(),
      expected,
    );
  }
});

for (const module of ['BTX', 'FS', 'MZ', 'MC', 'AHR', 'WM', 'HSA', 'LL'] as const)
  for (const anniversary of ['AHR', 'LL'].includes(module) ? [false] : [false, true]) {
    test(
      module +
        (anniversary ? ' 周年' : '') +
        ' 全部强制、任意能力和事件逐条从成立后的第一步执行，与缺席核验对照',
      () => {
        const pack = compileOfficial(module, anniversary),
          idx = absenceProgramIndex(pack);
        const all = [
          ...Object.values(pack.characters),
          ...Object.values(pack.identities),
          ...Object.values(pack.plots),
        ]
          .flatMap((d) => d.abilities)
          .concat(pack.moduleAbilities.map((m) => m.ability));
        assert.equal(
          idx.programs.filter((p) => p.activation === 'mandatory').length,
          all.filter((a) => a.mandatory).length,
        );
        assert.equal(
          idx.programs.filter((p) => p.activation === 'optional').length,
          all.filter((a) => !a.mandatory).length,
        );
        assert.equal(
          idx.programs.filter((p) => p.activation === 'incident').length,
          Object.values(pack.incidents).reduce(
            (n, d) => n + 1 + Number(!!d.afterIncidentSteps?.length),
            0,
          ),
        );
        for (const p of idx.programs) {
          // Already-established frame. Test its effect/choice semantics independently of admission;
          // the natural day-end / death / plot tests cover trigger admission separately.
          const s = programWindow(module, anniversary, p);
          const copy = clone(s),
            start = copy.observations.public.length;
          let forced: Observation | undefined,
            hadChoice = false;
          for (let i = 0; i < 200 && copy.phase === 'day-end'; i++) {
            if (!copy.pending) drive(pack, copy, 1);
            else {
              const d = copy.pending;
              hadChoice = true;
              const choice = d.options.find((v) => v.kind === 'pass') ?? d.options[0];
              assert.ok(choice, p.id);
              const next = advance(
                pack,
                copy,
                d.actor,
                { id: 'audit-' + i, expectedRevision: copy.revision, decisionId: d.id, choice },
                0,
              );
              assert.notEqual(next.status, 'rejected', p.id);
              Object.assign(copy, next.state);
            }
            if (!hadChoice)
              forced ??= copy.observations.public.slice(start).find((o) => o.type !== 'boundary');
          }
          const reports = copy.observations.public.slice(start);
          const end = reports.find((o) => o.type === 'boundary' && o.phase !== s.phase);
          assert.ok(end, p.id + ' never closed');
          const before = reports.slice(0, reports.indexOf(end));
          const absent = (
            [
              'failure',
              'character',
              'rule',
              'culprit',
              'identity',
              'incident',
              'board',
              'declaration',
              'card-grant',
            ] as const
          )
            .filter((type) => !before.some((o) => o.type === type))
            .map((type) => ({ type }));
          const query = { ...evidence, end, absent };
          assert.equal(
            verifyAbsencePhase(pack, s, query, 4000).status,
            'possible',
            p.owner + '/' + p.id,
          );
          if (forced && before.some((o) => o.sequence === forced.sequence))
            assert.equal(
              verifyAbsencePhase(
                pack,
                s,
                { ...query, absent: [{ type: forced.type, fields: forced.data }] },
                4000,
              ).status,
              'excluded',
              p.id,
            );
        }
      },
    );
  }
