import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import type { SetupDomain } from '../../packages/contracts/src/setup-domain.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import { compileScriptEvidence } from '../../packages/engine/src/decision/script-evidence.js';
import {
  inferObservedWorlds,
  type DecisionEvidence,
} from '../../packages/engine/src/decision/observed-worlds.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import { act, character, lab, phase } from '../comprehensive/harness.js';
import { exportObservation } from '../../scripts/engine/observed-game.js';
import type { CandidateReplay } from '../../scripts/engine/candidate-replays.js';

const sample = (name: string): CandidateReplay =>
  JSON.parse(
    readFileSync(
      new URL('../../products/engine/' + name + '-example.json', import.meta.url),
      'utf8',
    ),
  ).candidates[0];
const set = (xs: unknown[]) => new Set(xs.map(canonical));
function domain(setup: GameSetup): SetupDomain {
  return {
    plots: [{ y: setup.y, x: setup.x }],
    characters: setup.characters.map(({ identity, ...c }) => ({ ...c, roles: [identity] })),
    incidents: setup.incidents.map((i) => ({ day: i.day, names: [i.name], culprits: [i.culprit] })),
    ...(setup.privateRoles && { privateRoles: setup.privateRoles }),
  };
}
test('第二天神灵公告后，提前限定当事人，在同一合法多日记录上与全量重放完全一致', () => {
  const c = sample('investigation'),
    pack = compileOfficial('BTX');
  const divinity = c.setup.characters.find((x) => x.id === 'officeWorker')!;
  divinity.character = '神灵';
  divinity.enterLoop = 1;
  for (const move of c.choices)
    if (move.actor === 'p1' && move.choice.kind === 'cards')
      move.choice.placements[0]!.target = 'boyStudent';
  c.choices.push(
    {
      actor: 'p1',
      choice: { kind: 'ability', owner: 'officeWorker', ability: 'divinity-incident' },
    },
    { actor: 'p1', choice: { kind: 'select', value: '2' } },
  );
  const e = exportObservation(c),
    d = domain(c.setup);
  const count = e.view.reports.filter((o) => o.type === 'culprit' && o.data.day === 2).length;
  assert.equal(count, 1);
  const day = d.incidents!.find((i) => i.day === 2)!;
  day.culprits = c.setup.characters.map((x) => x.id);
  const all = [...generateSetups(pack, e, [d], 2000).setups];
  const fast = generateSetups(pack, e, [d], 2000, true);
  const one = [...fast.setups];
  assert.ok(all.length > one.length);
  assert.equal(one.length, 1);
  const original = inferObservedWorlds(pack, all, true, e, 200000, 100, false);
  const checked = inferObservedWorlds(pack, one, true, e, 200000, 100);
  assert.ok(original.exhaustive && checked.exhaustive && checked.states.length > 0);
  assert.deepEqual(set(checked.states), set(original.states));
});
test('合法 BTX 最终答题连续三次，通过与完全关闭提前剪枝的全量正向解空间逐状态对照', () => {
  const c = sample('final-decision'),
    p = compileOfficial('BTX'),
    d = domain(c.setup);
  const roles = ['平民', '关键人物', '传谣人', '杀人狂', '亲友'];
  for (const slot of d.characters) slot.roles = roles;
  const initial = exportObservation(c);
  const all = [...generateSetups(p, initial, [d], 90000).setups];
  assert.equal(all.length, 360);
  for (const id of ['doctor', 'boyStudent', 'popIdol']) {
    const role = c.setup.characters.find((e) => e.id === id)!.identity;
    const actor = exportObservation(c).view.menu.actor;
    c.choices.push({ actor, choice: { kind: 'guess', character: id, identity: role } });
    const e = exportObservation(c);
    const optimized = generateSetups(p, e, [d], 90000, true);
    const matching = [...optimized.setups];
    const expected = all.filter((s) =>
      c.choices.every(
        ({ choice }) =>
          choice.kind !== 'guess' ||
          s.characters.find((v) => v.id === choice.character)?.identity === choice.identity,
      ),
    );
    assert.deepEqual(set(matching), set(expected));
    assert.ok(optimized.stats.prunedChoices > 0);
    const baseline = inferObservedWorlds(p, all, true, e, 300000, 1000, false);
    const early = inferObservedWorlds(p, all, true, e, 300000, 1000, true);
    assert.ok(baseline.exhaustive && early.exhaustive);
    assert.deepEqual(set(early.states), set(baseline.states));
    assert.equal(early.states.length, expected.length);
    assert.equal(early.prunedSetups, all.length - expected.length);
    assert.ok(early.work < baseline.work);
    if (id === 'popIdol') {
      assert.equal(matching.length, 4);
      assert.ok(optimized.stats.work < 200);
      assert.equal(early.prunedSetups, 356);
    }
  }
});
function withReport(
  e: DecisionEvidence,
  data: Observation['data'],
  type: Observation['type'] = 'culprit',
) {
  const next = clone(e);
  next.view.reports.push({
    type,
    data,
    sequence: next.view.reports.length + 1,
    loop: 1,
    day: 1,
    phase: 'final-guess',
  });
  return next;
}
test('LL 当事人联合猜错仅排除整组；猜对与逐日公告可提前约束每一天，包括区域当事人', () => {
  const base = sample('seat-policy'),
    e = exportObservation(base, 'p0');
  const second = clone(e);
  second.sheet.incidents.push({ day: 2, name: '不安扩散' });
  const possible = ['boy', 'doctor', 'worker', 'school'];
  for (const correct of [false, true])
    for (const first of possible)
      for (const last of possible) {
        const rules = compileScriptEvidence(
          withReport(second, { guesses: { 1: first, 2: last }, correct }),
        );
        for (const a of possible)
          for (const b of possible) {
            const row = [
              { day: 1, name: '骤变', culprit: a },
              { day: 2, name: '不安扩散', culprit: b },
            ];
            assert.equal(
              rules.allowsCulprit(1, a) && rules.allowsCulprit(2, b) && rules.allowsTuple(row),
              (a === first && b === last) === correct,
            );
          }
      }
  const same = compileScriptEvidence(
    withReport(withReport(second, { day: 2, culprit: 'school' }), { day: 2, culprit: 'doctor' }),
  );
  assert.ok(possible.every((c) => !same.allowsCulprit(2, c)));
  base.choices.push({ actor: 'p0', choice: { kind: 'guess-culprits', answers: { '1': 'boy' } } });
  const after = exportObservation(base);
  assert.ok(after.view.reports.some((o) => o.type === 'culprit' && o.data.correct === false));
  const pack = compileOfficial('LL'),
    setups = possible
      .filter((id) => id !== 'school')
      .map((id) => ({ ...base.setup, incidents: [{ ...base.setup.incidents[0]!, culprit: id }] }));
  assert.deepEqual(
    set(inferObservedWorlds(pack, setups, true, after, 10000, 80).states),
    set(inferObservedWorlds(pack, setups, true, after, 10000, 80, false).states),
  );
});
test('周年替身、AHR 反面和未附反面命令的否定答复不误删；未建模特规则留给原检查', () => {
  const e = exportObservation(sample('final-decision'));
  const plain = compileOfficial('BTX', true),
    ahr = compileOfficial('AHR');
  const correct = withReport(
    e,
    { character: 'doctor', guess: '因果残片', correct: true },
    'identity',
  );
  const rule = compileScriptEvidence(correct);
  assert.ok(rule.allowsBaseRole(plain, 'doctor', '平民'));
  assert.equal(rule.allowsIdentity(plain, 'doctor', '平民'), false);
  const negative = withReport(
    e,
    { character: 'doctor', guess: '关键人物', correct: false },
    'identity',
  );
  assert.ok(compileScriptEvidence(negative).allowsIdentity(ahr, 'doctor', '关键人物', '主谋'));
  const withCommand = withReport(
    negative,
    {
      actor: 'p0',
      choice: { kind: 'guess', character: 'doctor', identity: '关键人物', reverseIdentity: '主谋' },
    },
    'own-choice',
  );
  const checked = compileScriptEvidence(withCommand);
  assert.equal(checked.allowsIdentity(ahr, 'doctor', '关键人物', '主谋'), false);
  assert.equal(checked.allowsIdentity(ahr, 'doctor', '关键人物', '平民'), true);
  withCommand.sheet.specialRules = ['自定义'];
  assert.equal(compileScriptEvidence(withCommand).facts.length, 0);
});
test('忍者可由剧作家宣告另一身份，实际公告和在场同身份比较都不能固定初始剧本', () => {
  const l = lab('MZ');
  character(l, 'a', '职员', '忍者', 'city').counters.goodwill = 3;
  character(l, 'b', '女学生', '关键人物', 'school');
  character(l, 'c', '医生', '平民', 'hospital').counters.goodwill = 2;
  l.state.characters.d!.area = 'hospital';
  phase(l, 'protagonist-abilities');
  act(l, { kind: 'ability', owner: 'a', ability: 'office-worker' });
  if (l.state.pending?.kind === 'refusal') act(l, { kind: 'refuse', refuse: false });
  act(l, { kind: 'select', value: '关键人物' });
  const e = observeQuestion(l.state);
  assert.ok(e.view.reports.some((o) => o.type === 'identity' && o.data.identity === '关键人物'));
  const also = withReport(e, { sameIdentityAs: 'a', characters: [] }, 'identity');
  const rules = compileScriptEvidence(also);
  assert.ok(rules.allowsState(l.pack, l.state));
  assert.equal(rules.facts.length, 0);
});
