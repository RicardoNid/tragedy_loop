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

const full: ObservedQuestion = JSON.parse(
  readFileSync(new URL('../../products/engine/loop-grant-example.json', import.meta.url), 'utf8'),
);
const q = { ...full, setups: full.setups!.filter((s) => s.x.includes('流言四起')) };
test('隐藏规则 X 和周年身份交叉：按布局提前排除，所有存活历史逐个相等', () => {
  const four = full.setups!;
  const question = full;
  const fast = resolveObservedCandidates(question),
    slow = resolveObservedCandidates({ ...question, loopGrantEvidence: false });
  assert.ok(fast.candidates.exhaustive && slow.candidates.exhaustive);
  assert.deepEqual(
    new Set(fast.candidates.states.map(canonical)),
    new Set(slow.candidates.states.map(canonical)),
  );
  assert.equal(fast.candidates.states.length, 16);
  assert.equal(fast.history.prunedSetups, 3);
  assert.ok(fast.history.work < slow.history.work);
  assert.ok(
    fast.candidates.states.every(
      (s) => s.setup.x[0] === '流言四起' && s.setup.anniversaryFragment === 'girl',
    ),
  );
  const one = four[0]!;
  const domain = {
    plots: [
      { y: one.y, x: one.x },
      { y: one.y, x: ['超越世界线'] },
    ],
    characters: one.characters.map((c) => ({
      id: c.id,
      character: c.character,
      roles: [c.identity],
    })),
  };
  const generated = generateSetups(fast.pack, q.evidence, [domain], 5000, true, true, true);
  const plain = generateSetups(fast.pack, q.evidence, [domain], 5000, true, true, false);
  assert.equal([...generated.setups].length, 1);
  assert.equal([...plain.setups].length, 4);
  assert.ok(
    generated.stats.complete && plain.stats.complete && generated.stats.work < plain.stats.work,
  );
});

test('单轮、奇偶轮和偶数最终轮授牌的公开子集与规则文字逐一对照', () => {
  const pack = compileOfficial('FS', true);
  for (const loops of [1, 2, 3, 4])
    for (let loop = 1; loop <= loops; loop++) {
      const setup = clone(q.setups![0]!);
      setup.loops = loops;
      setup.x = ['超越世界线'];
      const init = initializeDiscussion(pack, setup);
      assert.ok(init.state, JSON.stringify(init.diagnostics));
      const s = init.state,
        d = s.pending!;
      s.loop = loop;
      const next = advance(pack, s, d.actor, {
        id: 'continue',
        expectedRevision: s.revision,
        decisionId: d.id,
        choice: { kind: 'continue' },
      });
      assert.equal(next.status, 'ok');
      const actual = next.state.observations.protagonists.filter((o) => o.type === 'card-grant');
      const expected = [
        ...(loop % 2 === 0 ? ['mastermind/despair+1'] : []),
        ...(loop === loops ? ['p0/hope+1', 'p1/hope+1', 'p2/hope+1'] : []),
      ];
      assert.deepEqual(actual.map((o) => o.data.owner + '/' + o.data.kind).sort(), expected.sort());
      const boundary = (loop: number, phase: Observation['phase']): Observation => ({
        type: 'boundary',
        day: 1,
        loop,
        phase,
        data: { phase },
        sequence: 0,
      });
      const head =
        loop === 1 ? [] : [boundary(loop - 1, 'loop-start'), boundary(loop - 1, 'loop-end')];
      for (let mask = 0; mask < 16; mask++) {
        const reports = [...head, boundary(loop, 'discussion'), boundary(loop, 'loop-start')];
        for (const [i, owner] of ['p0', 'p1', 'p2', 'mastermind'].entries()) {
          if (mask & (1 << i))
            reports.push({
              ...boundary(loop, 'loop-start'),
              type: 'card-grant',
              data: { owner, kind: i === 3 ? 'despair+1' : 'hope+1' },
            });
        }
        reports.push(boundary(loop, 'day-start'));
        reports.forEach((o, i) => (o.sequence = i + 1));
        const wanted = [
          ...(loop % 2 === 0 && !(mask & 8) ? ['despair+1'] : []),
          ...(loop === loops && (mask & 7) !== 7 ? ['hope+1'] : []),
        ];
        assert.deepEqual(
          loopGrantEvidence(reports, loops)
            .filter((f) => f.kind === 'missing-plot-grant')
            .map((f) => f.grant)
            .sort(),
          wanted.sort(),
        );
        assert.deepEqual(loopGrantEvidence(reports.slice(0, -1), loops), []);
      }
    }
});
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

test('六个周年模组和两个原生模组都配置一名传谣人', () => {
  for (const module of ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM', 'AHR', 'LL'] as const) {
    const pack = compileOfficial(module, !['AHR', 'LL'].includes(module));
    assert.deepEqual(pack.plots['超越世界线']!.identities, { 传谣人: 1 }, module);
  }
});
