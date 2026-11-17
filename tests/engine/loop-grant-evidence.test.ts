import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fixtures from './fixtures/official-scenarios.json' with { type: 'json' };
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { clone, canonical } from '../../packages/engine/src/runtime/model.js';
import { advance, drive, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { recompute } from '../../packages/engine/src/runtime/expressions.js';
import { solveFinalDecision } from '../../packages/engine/src/decision/final.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import {
  allowsLoopGrants,
  loopGrantEvidence,
} from '../../packages/engine/src/decision/loop-grant-evidence.js';
import {
  resolveObservedCandidates,
  type ObservedQuestion,
} from '../../scripts/engine/observed-game.js';

const q: ObservedQuestion = JSON.parse(
  readFileSync(new URL('../../products/engine/loop-grant-example.json', import.meta.url), 'utf8'),
);
test('跨轮回实局：职员有两友好，女学生一友好；生成与重放得到同一组完整历史', () => {
  const plain = resolveObservedCandidates({ ...q, loopGrantEvidence: false });
  const fast = resolveObservedCandidates(q);
  assert.ok(plain.candidates.exhaustive && fast.candidates.exhaustive);
  assert.equal(fast.history.prunedSetups, 1);
  assert.deepEqual(
    new Set(fast.candidates.states.map(canonical)),
    new Set(plain.candidates.states.map(canonical)),
  );
  assert.equal(fast.candidates.states.length, 16);
  assert.ok(fast.candidates.states.every((s) => s.setup.anniversaryFragment === 'girl'));
  assert.ok(fast.history.work < plain.history.work);
  const setup = q.setups![0]!;
  const domain = {
    plots: [{ y: setup.y, x: setup.x }],
    characters: setup.characters.map((c) => ({
      id: c.id,
      character: c.character,
      roles: [c.identity],
    })),
  };
  for (const prune of [true, false]) {
    const generated = generateSetups(fast.pack, q.evidence, [domain], 2000, true, true, prune);
    assert.deepEqual(
      [...generated.setups].map((s) => s.anniversaryFragment).sort(),
      prune ? ['girl'] : ['girl', 'office'],
    );
    assert.ok(generated.stats.complete);
  }
});

test('死亡与好感门槛、逐人授牌、重复来源、截断及入场条件', () => {
  const base = q.evidence.view.reports,
    fact = loopGrantEvidence(base)[0]!;
  assert.deepEqual(fact, {
    kind: 'missing-loop-grant',
    character: 'office',
    loop: 2,
    endReport: 29,
    report: 35,
    grant: 'hope+1',
  });
  const roster = q.setups![0]!.characters;
  const withReport = (reports: Observation[], before: number, o: Observation) => {
    reports.splice(before - 1, 0, o);
    reports.forEach((v, i) => (v.sequence = i + 1));
  };
  for (const status of ['dead', 'alive', 'removed', 'absent'])
    for (const goodwill of [0, 1, 2])
      for (const hope of [0, 1])
        for (const mask of [0, 1, 3, 7, 8, 15]) {
          const reports = clone(base);
          const old = reports
            .slice(0, fact.endReport - 1)
            .reverse()
            .find((o) => o.type === 'character' && o.data.character === 'office')!;
          old.data = { ...old.data, status, counters: { goodwill, hope } };
          for (const [i, owner] of ['p0', 'p1', 'p2', 'mastermind'].entries()) {
            if (!(mask & (1 << i))) continue;
            const before = reports.findIndex((o) => o.phase === 'loop-start' && o.loop === 2) + 1;
            const model = reports[before - 2]!;
            withReport(reports, before, {
              ...model,
              type: 'card-grant',
              data: { owner, kind: i === 3 ? 'despair+1' : 'hope+1' },
            });
          }
          const facts = loopGrantEvidence(reports);
          const shouldExclude =
            (status === 'dead' && !(mask & 8)) ||
            (status === 'alive' && goodwill + hope >= 2 && (mask & 7) !== 7);
          assert.equal(
            allowsLoopGrants(facts, roster, 'office'),
            !shouldExclude,
            JSON.stringify({ status, goodwill, hope, mask }),
          );
          assert.ok(allowsLoopGrants(facts, roster, 'girl'));
        }
  for (const change of [{ character: '临时工' }, { enterDay: 1 }, { enterLoop: 3 }]) {
    const r = roster.map((c) => (c.id === 'office' ? { ...c, ...change } : c));
    assert.ok(allowsLoopGrants([fact], r, 'office'));
  }
  assert.ok(
    allowsLoopGrants(
      [fact],
      roster.map((c) => (c.id === 'girl' ? { ...c, character: '手下' } : c)),
      'office',
    ),
  );
  for (const cut of [fact.endReport - 1, fact.endReport, fact.report - 1])
    assert.deepEqual(loopGrantEvidence(base.slice(0, cut)), []);
  assert.deepEqual(loopGrantEvidence(base.filter((o) => o.sequence !== fact.endReport)), []);
  const interrupted = clone(base);
  withReport(interrupted, fact.report, {
    ...interrupted[fact.report - 2]!,
    type: 'failure',
    data: {},
  });
  assert.deepEqual(loopGrantEvidence(interrupted), []);
});

test('临时工的替班继承周年配置，但在下一轮开始时缺席', () => {
  const setup = clone(q.setups![0]!);
  setup.characters.find((c) => c.id === 'office')!.character = '临时工';
  const pack = compileOfficial('FS', true);
  for (const status of ['dead', 'alive'] as const) {
    const init = initializeDiscussion(pack, setup);
    assert.ok(init.state, JSON.stringify(init.diagnostics));
    const s = init.state;
    assert.equal(s.characters.office!.identity, '平民');
    assert.equal(s.characters.office_replacement!.initialIdentity, '因果残片');
    s.loop = 2;
    s.previousLoop = { characters: clone(s.characters), boards: clone(s.boards), ex: 0 };
    const prior = s.previousLoop.characters.office_replacement!;
    prior.status = status;
    prior.counters.goodwill = 2;
    const d = s.pending!;
    const next = advance(pack, s, d.actor, {
      id: 'next',
      decisionId: d.id,
      expectedRevision: s.revision,
      choice: { kind: 'continue' },
    });
    assert.equal(next.status, 'ok');
    assert.equal(next.state.characters.office_replacement!.status, 'absent');
    assert.ok(!next.state.observations.public.some((o) => o.type === 'card-grant'));
  }
});

test('AHR 临时工继承完整身份两面，里世界及最终两面回答逐项核对', () => {
  const setup = clone(fixtures.find((f) => f.setup.module === 'AHR')!.setup) as GameSetup;
  // Exchange character cards while preserving the legal plot role pairs.
  setup.characters.find((c) => c.id === 'soldier')!.character = '临时工';
  setup.characters.find((c) => c.id === 'partTimer')!.character = '军人';
  const pack = compileOfficial('AHR'),
    init = initializeDiscussion(pack, setup);
  assert.ok(init.state, JSON.stringify(init.diagnostics));
  const s = init.state,
    id = 'soldier_replacement';
  s.characters.soldier!.status = 'dead';
  s.pending = null;
  s.phase = 'day-start';
  s.phaseEntered = false;
  drive(pack, s, 100);
  assert.equal(s.characters[id]!.status, 'alive');
  for (const ex of [1, 0, 3]) {
    s.ex = ex;
    recompute(s);
    assert.equal(s.characters[id]!.identity, ex % 2 ? '杀人狂' : '传谣人');
    assert.equal(s.characters.soldier!.identity, '平民');
  }
  s.phase = 'final-guess';
  s.pending = null;
  s.phaseEntered = true;
  s.flags.guessed = JSON.stringify(Object.keys(s.characters).filter((k) => k !== id));
  drive(pack, s, 100);
  const correct = {
    kind: 'guess' as const,
    character: id,
    identity: '传谣人',
    reverseIdentity: '杀人狂',
  };
  const advice = solveFinalDecision(pack, { exhaustive: true, states: [s] });
  assert.deepEqual(advice.plan, [correct]);
  for (const back of ['杀人狂', '主谋', undefined]) {
    const d = s.pending!;
    const r = advance(pack, s, d.actor, {
      id: 'answer',
      expectedRevision: s.revision,
      decisionId: d.id,
      choice: { ...correct, reverseIdentity: back },
    });
    assert.equal(r.state.winner, back === '杀人狂' ? 'protagonists' : 'mastermind');
  }
});
