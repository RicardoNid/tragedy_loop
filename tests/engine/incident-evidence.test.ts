import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { Actor, Choice, Module, Observation } from '../../packages/contracts/src/game.js';
import { BOARDS, canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import {
  IncidentEvidence,
  incidentEvidence,
} from '../../packages/engine/src/decision/incident-evidence.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import {
  resolveObservedCandidates,
  type ObservedQuestion,
} from '../../scripts/engine/observed-game.js';
import { replayCandidates } from '../../scripts/engine/candidate-replays.js';
import { lab, character, phase, act, type Lab } from '../comprehensive/harness.js';

test('实际发生和未发生且都没有死人；三种合法当事人逐状态比对，发生公告可在生成当事人时使用', () => {
  const input = JSON.parse(
    readFileSync(
      new URL('../../products/engine/incident-outcome-example.json', import.meta.url),
      'utf8',
    ),
  ) as ObservedQuestion;
  const pack = compileOfficial('FS');
  const cards = (actor: Actor, placements: [number, string][]) => ({
    actor,
    choice: {
      kind: 'cards' as const,
      placements: placements.map(([i, target]) => ({ card: actor + '-' + i, target })),
    },
  });
  for (const culprit of ['boy', 'doctor']) {
    const setup = input.setups!.find((s) => s.incidents[0]!.culprit === culprit)!;
    const choices: { actor: Actor; choice: Choice }[] = [
      { actor: 'p0', choice: { kind: 'continue' } },
      cards('mastermind', [
        [9, 'school'],
        [4, 'doctor'],
        [5, 'maiden'],
      ]),
      cards('p0', [[5, 'doctor']]),
      cards('p1', [[3, 'boy']]),
      cards('p2', [[7, 'city']]),
    ];
    const l = { pack, state: [...replayCandidates(pack, [{ setup, choices }])][0]! };
    while (l.state.loop === 1) act(l, { kind: 'pass' });
    const evidence = observeQuestion(l.state);
    const report = evidence.view.reports.find((o) => o.type === 'incident')!;
    assert.equal(report.data.occurred, culprit === 'doctor');
    assert.ok(
      !evidence.view.reports.some((o) => o.type === 'character' && o.data.status === 'dead'),
    );
    if (culprit === 'boy') assert.equal(canonical(evidence), canonical(input.evidence));
    const expected = culprit === 'doctor' ? ['doctor'] : ['boy', 'maiden'];
    const q = { ...input, evidence };
    const fast = resolveObservedCandidates(q),
      plain = resolveObservedCandidates({ ...q, incidentEvidence: false });
    assert.ok(fast.candidates.exhaustive && plain.candidates.exhaustive);
    assert.deepEqual(
      new Set(fast.candidates.states.map(canonical)),
      new Set(plain.candidates.states.map(canonical)),
    );
    assert.deepEqual(
      [...new Set(fast.candidates.states.map((s) => s.setup.incidents[0]!.culprit))].sort(),
      expected,
    );
    assert.equal(fast.history.prunedSetups, 3 - expected.length);
    assert.ok(
      fast.history.incidentExamples?.every(
        (e) => e.report === report.sequence && e.predicted !== report.data.occurred,
      ),
    );
    assert.ok(fast.history.work < plain.history.work);
    const domain = {
      plots: [{ y: setup.y, x: setup.x }],
      characters: setup.characters.map((c) => ({
        id: c.id,
        character: c.character,
        roles: [c.identity],
      })),
    };
    const make = (enabled: boolean) =>
      [...generateSetups(pack, evidence, [domain], 2000, true, enabled).setups]
        .map((s) => s.incidents[0]!.culprit)
        .sort();
    assert.deepEqual(make(true), expected);
    assert.deepEqual(make(false), ['boy', 'doctor', 'maiden']);
  }
});

function publicReports(l: Lab, occurred: boolean) {
  const s = clone(l.state);
  s.observations.protagonists = [];
  s.phase = 'loop-start';
  announce(s, 'boundary', { phase: s.phase });
  for (const c of Object.values(s.characters))
    announce(s, 'character', {
      character: c.id,
      area: c.area,
      status: c.status,
      counters: c.counters,
    });
  for (const board of BOARDS) announce(s, 'board', { board, intrigue: s.boards[board] });
  s.phase = 'incident';
  announce(s, 'boundary', { phase: s.phase });
  const i = s.setup.incidents[0]!;
  announce(s, 'incident', { day: i.day, name: i.publicName ?? i.name, occurred });
  return s.observations.protagonists;
}
function permits(l: Lab, reports: Observation[]) {
  const i = l.state.setup.incidents[0]!;
  const data = incidentEvidence(reports, [{ day: i.day, name: i.publicName ?? i.name }]);
  return new IncidentEvidence(data).allows(l.pack, l.state.setup.characters, i);
}
function oracle(l: Lab) {
  const forward = { pack: l.pack, state: clone(l.state) };
  phase(forward, 'incident');
  const o = forward.state.observations.public.find(
    (o) => o.type === 'incident' && typeof o.data.occurred === 'boolean',
  );
  assert.ok(o, l.pack.module);
  return o.data.occurred as boolean;
}
test('八个模组中有效计数、AI、阈值、免发生角色及特殊催发：每个实际结果保留，确证时排除相反公告', () => {
  let checks = 0,
    exact = 0;
  for (const module of ['FS', 'BTX', 'MZ', 'MC', 'WM', 'HSA', 'AHR', 'LL'] as Module[]) {
    const base = lab(module);
    for (const def of Object.values(base.pack.incidents).filter(
      (d) => d.supported && d.crowdThreshold === undefined,
    )) {
      for (const mode of [0, 1, 2, 3]) {
        const l = { pack: base.pack, state: clone(base.state) };
        const name = mode === 2 ? 'AI' : mode === 3 ? '手下' : '医生';
        const c = character(l, 'c', name, '平民', 'hospital');
        c.counters.paranoia = mode === 1 ? 5 : 0;
        c.counters.goodwill = 2;
        c.counters.intrigue = mode;
        c.counters.despair = mode === 2 ? 1 : 0;
        if (mode === 3) c.flags['no-incidents'] = 'yes';
        if (module === 'AHR') l.state.ex = mode % 2;
        if (module === 'MZ' && mode === 1) character(l, 'b', '女学生', '预言家', 'hospital');
        l.state.setup.incidents = [{ day: l.state.day, name: def.name, culprit: 'c' }];
        const truth = oracle(l);
        assert.ok(permits(l, publicReports(l, truth)), [module, def.name, mode, truth].join('/'));
        exact += Number(!permits(l, publicReports(l, !truth)));
        checks++;
      }
    }
  }
  assert.ok(checks > 250 && exact > 80, JSON.stringify({ checks, exact }));
  console.log(`incidentProfiles=${checks} definiteOutcomes=${exact}`);
});
test('HSA 区域事件的四种阈值，零到两具角色尸体与零到两个受害者标记', () => {
  const base = lab('HSA');
  for (const def of Object.values(base.pack.incidents).filter(
    (d) => d.crowdThreshold !== undefined,
  ))
    for (const corpses of [0, 1, 2])
      for (const victims of [0, 1, 2]) {
        const l = { pack: base.pack, state: clone(base.state) };
        character(l, 'a', '男学生', '平民', 'city').status = corpses >= 1 ? 'dead' : 'alive';
        character(l, 'b', '女学生', '平民', 'city').status = corpses >= 2 ? 'dead' : 'alive';
        l.state.boards.city = victims;
        l.state.setup.incidents = [{ day: 1, name: def.name, culprit: 'city' }];
        const expected = corpses + victims >= def.crowdThreshold!;
        assert.equal(oracle(l), expected);
        assert.ok(permits(l, publicReports(l, expected)));
        assert.ok(!permits(l, publicReports(l, !expected)));
      }
});
test('空白历史、缺号、跨轮回、非事件阶段和仅有无效果公告都不能证明事件未发生', () => {
  const l = lab('FS');
  l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'c' }];
  l.state.characters.c!.counters.paranoia = 5;
  const r = publicReports(l, false);
  assert.equal(permits(l, r), false);
  const last = r.at(-1)!;
  for (const cut of [
    r.slice(0, -1),
    r.slice(1),
    [...r.slice(0, -1), { ...last, phase: 'day-end' as const }],
    [...r.slice(0, -1), { ...last, loop: 2 }],
    [...r.slice(0, -1), { ...last, type: 'no-effect' as const }],
  ])
    assert.ok(permits(l, cut));
});
test('临时工与替班为同一当事人：任何一人在场触发都可以解释发生公告', () => {
  for (const primary of ['alive', 'dead'] as const)
    for (const substitute of ['alive', 'absent'] as const)
      for (const high of [false, true]) {
        const l = lab('BTX');
        const main = character(l, 'c', '临时工', '平民', 'city');
        main.status = primary;
        const other = character(l, 'c_replacement', '临时工？', '平民', 'city');
        other.status = substitute;
        l.state.setup.characters = l.state.setup.characters.filter((c) => c.id !== 'c_replacement');
        main.counters.paranoia = 0;
        other.counters.paranoia = high ? 3 : 0;
        l.state.setup.incidents = [{ day: 1, name: '自杀', culprit: 'c' }];
        const expected = substitute === 'alive' && high;
        assert.equal(oracle(l), expected);
        assert.equal(permits(l, publicReports(l, expected)), true);
        assert.equal(permits(l, publicReports(l, !expected)), false);
      }
});
