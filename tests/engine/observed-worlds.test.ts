import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { inferObservedWorlds } from '../../packages/engine/src/decision/observed-worlds.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import { adviseObservedGame, exportObservation } from '../../scripts/engine/observed-game.js';
import { replayCandidates } from '../../scripts/engine/candidate-replays.js';

function sample(name: string) {
  return JSON.parse(
    readFileSync(
      new URL('../../products/engine/' + name + '-example.json', import.meta.url),
      'utf8',
    ),
  );
}
function fixedHospital() {
  const { setupDomains: _, ...q } = sample('observed-game');
  return { ...q, setups: [sample('day-survival').candidates[0].setup] };
}
test('揭牌前只有三个暗置位置：独立生成十张牌的 720 个有序分配，逐一比对重建结果', () => {
  const q = sample('game-policy'),
    pack = compileOfficial('FS');
  const evidence = exportObservation(q.candidates[0]);
  assert.deepEqual(evidence, exportObservation(q.candidates[1]));
  assert.doesNotMatch(JSON.stringify(evidence), /"mastermind-\d+"/);
  const setup = q.candidates[0].setup;
  const result = inferObservedWorlds(pack, [setup, clone(setup)], true, evidence, 50000, 720);
  assert.equal(result.exhaustive, true);
  const assignments = new Set<string>();
  for (const s of result.states) {
    const mm = s.placements
      .filter((p) => p.card.startsWith('mastermind-'))
      .sort((a, b) => a.target.localeCompare(b.target));
    assert.deepEqual(
      mm.map((p) => p.target),
      ['city', 'hospital', 'school'],
    );
    assignments.add(mm.map((p) => p.card.split('-')[1]).join('/'));
  }
  const expected = new Set<string>();
  for (let a = 0; a < 10; a++)
    for (let b = 0; b < 10; b++)
      for (let c = 0; c < 10; c++)
        if (new Set([a, b, c]).size === 3) expected.add([a, b, c].join('/'));
  assert.deepEqual(assignments, expected);
  assert.equal(result.states.length, 720);
  assert.ok(result.commands < 3000);
});

test('揭牌后只剩两张同面的不安牌可互换，公开盘面、完整观察及决策均能复现', () => {
  const q = fixedHospital(),
    pack = compileOfficial('BTX');
  const original = sample('day-survival');
  assert.deepEqual(
    JSON.parse(JSON.stringify(exportObservation(original.candidates[0]))),
    q.evidence,
  );
  const search = (work: number, worlds: number) =>
    inferObservedWorlds(pack, q.setups, true, q.evidence, work, worlds);
  const result = search(10000, 2);
  assert.equal(result.exhaustive, true);
  assert.equal(result.states.length, 2);
  for (const state of result.states)
    assert.equal(canonical(observeQuestion(state)), canonical(q.evidence));
  const cardIds = result.states
    .map(
      (s) => s.choices.find((c) => c.actor === 'mastermind' && c.choice.kind === 'cards')!.choice,
    )
    .map((c) =>
      c.kind === 'cards' ? c.placements.find((p) => p.target === 'patient')?.card : undefined,
    );
  assert.deepEqual(cardIds.sort(), ['mastermind-4', 'mastermind-5']);
  assert.ok(result.work < 150);
  assert.equal(search(result.work - 1, 2).reason, 'work-limit');
  assert.equal(search(result.work, 1).reason, 'world-limit');
  const solved = adviseObservedGame(q);
  assert.equal(solved.advice.status, 'guaranteed');
  assert.deepEqual(solved.advice.policy?.choice, {
    kind: 'ability',
    owner: 'doctor',
    ability: 'doctor-counter',
  });
  for (const partial of [{ worldLimit: 1 }, { historyWorkLimit: 0 }, { exhaustiveSetups: false }])
    assert.equal(adviseObservedGame({ ...q, ...partial }).advice.status, 'unknown');
});

test('来源范围、矛盾证据、闭合区间、未支持特规与中间漏记', () => {
  const q = fixedHospital();
  const empty = adviseObservedGame({ ...q, setups: [] });
  assert.equal(empty.advice.status, 'no-candidates');
  const broken = clone(q);
  broken.evidence.view.reports.splice(3, 1);
  assert.throws(() => adviseObservedGame(broken), /Incomplete observation/);
  broken.evidence.view.reports.forEach(
    (r: { sequence: number }, i: number) => (r.sequence = i + 1),
  );
  assert.equal(adviseObservedGame(broken).advice.status, 'no-candidates');
  const special = clone(q);
  special.setups[0].publicSpecialRules = special.evidence.sheet.specialRules = ['特规'];
  assert.equal(adviseObservedGame(special).history.reason, 'unsupported');
  assert.equal(adviseObservedGame(special).advice.status, 'unknown');
  const altered = clone(q);
  altered.evidence.view.boards.school = 10;
  assert.equal(adviseObservedGame(altered).advice.status, 'no-candidates');
  assert.throws(
    () => adviseObservedGame({ ...q, evidence: { ...q.evidence, coverage: 'partial' } }),
    /complete protagonist/,
  );
});

test('不同真实剧本经过同一讨论和三票进入决战，保留关联；只允许共同正确答案', () => {
  const q = sample('final-decision'),
    pack = compileOfficial('BTX');
  const evidence = exportObservation(q.candidates[0]);
  const setups = q.candidates.map((c: { setup: unknown }) => c.setup);
  const r = inferObservedWorlds(pack, setups, true, evidence, 1000, 2);
  assert.equal(r.exhaustive, true);
  const fingerprint = (s: (typeof r.states)[number]) =>
    canonical([s.setup, s.observations.protagonists, s.pending?.options]);
  assert.deepEqual(
    new Set(r.states.map(fingerprint)),
    new Set([...replayCandidates(pack, q.candidates)].map(fingerprint)),
  );
  assert.equal(
    adviseObservedGame({ exhaustiveSetups: true, setups, evidence }).advice.status,
    'no-guaranteed-policy',
  );
});
