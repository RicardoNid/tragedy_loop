import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonical, clone } from '../../packages/engine/src/runtime/model.js';
import { solveInvestigation } from '../../packages/engine/src/decision/investigation.js';
import type {
  InvestigationPlan,
  InvestigationView,
} from '../../packages/contracts/src/investigation.js';
import { investigate } from '../../scripts/engine/investigate.js';
import { exportObservation } from '../../scripts/engine/observed-game.js';
import { act, character, lab, phase } from '../comprehensive/harness.js';

const day = { kind: 'culprit', day: 1 } as const;
function office(role: string, culprit: string) {
  const l = lab();
  character(l, 'a', '职员', role, 'city').counters.goodwill = 3;
  l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit }];
  phase(l, 'protagonist-abilities');
  return l;
}
test('职员两种身份与两个当事人的所有组合，在三个发动预算下与按身份分组的手算一致', () => {
  const all = ['平民', '时间旅者'].flatMap((role) =>
    ['b', 'c'].map((culprit) => ({ role, culprit, l: office(role, culprit) })),
  );
  for (let mask = 1; mask < 16; mask++) {
    const group = all.filter((_, i) => mask & (1 << i));
    for (const maxAbilities of [0, 1, 2]) {
      const partitions = new Map<string, Set<string>>();
      for (const w of group) {
        const key = maxAbilities ? w.role : 'all';
        const set = partitions.get(key) ?? new Set();
        set.add(w.culprit);
        partitions.set(key, set);
      }
      const expected = Math.max(...[...partitions.values()].map((s) => s.size));
      const r = solveInvestigation(
        group[0]!.l.pack,
        { exhaustive: true, states: group.map((x) => x.l.state) },
        { target: day, maxAbilities },
        2000,
      );
      assert.equal(r.status, 'optimal');
      assert.equal(r.worstRemaining, expected, mask + '/' + maxAbilities);
      assert.equal(
        r.plan?.kind,
        expected < new Set(group.map((w) => w.culprit)).size ? 'act' : 'stop',
      );
    }
  }
});
function combination(a: boolean, b: boolean) {
  const l = lab();
  character(l, 'a', '职员', a ? '关键人物' : '平民', 'city').counters.goodwill = 3;
  character(l, 'b', '异界人', '平民', 'hospital').counters.goodwill = 4;
  character(l, 'c', '医生', b ? '时间旅者' : '平民', 'hospital');
  character(l, 'd', '巫女', '平民', 'shrine');
  const culprit = ['a', 'b', 'c', 'd'][Number(a) * 2 + Number(b)]!;
  l.state.setup.incidents = [{ day: 1, name: '不安扩散', culprit }];
  phase(l, 'protagonist-abilities');
  return l;
}
function leafSizes(p: InvestigationPlan): number[] {
  return p.kind === 'stop' ? [p.answers.length] : p.responses.flatMap((r) => leafSizes(r.then));
}
test('异界人已使用击杀，同一目标生死两种观察与职员公告合起来定位当事人；重复暗牌历史不增加答案数', () => {
  const worlds = [false, true].flatMap((a) => [false, true].map((b) => combination(a, b)));
  for (const [i, l] of worlds.entries()) {
    const copy = { pack: l.pack, state: clone(l.state) };
    act(copy, { kind: 'ability', owner: 'b', ability: 'alien-kill' });
    assert.equal(copy.state.characters.c!.status, i % 2 ? 'alive' : 'dead');
  }
  for (const duplicates of [1, 3])
    for (const budget of [0, 1, 2]) {
      const states = worlds.flatMap((l) =>
        Array.from({ length: duplicates }, () => clone(l.state)),
      );
      const r = solveInvestigation(
        worlds[0]!.pack,
        { states, exhaustive: true },
        { target: day, maxAbilities: budget },
        20000,
      );
      assert.equal(r.status, 'optimal');
      assert.equal(r.answers!.length, 4);
      assert.equal(r.worstRemaining, [4, 2, 1][budget]);
      assert.equal(Math.max(...leafSizes(r.plan!)), r.worstRemaining);
      if (budget === 2) assert.deepEqual(leafSizes(r.plan!), [1, 1, 1, 1]);
    }
  const two = [worlds[0]!, worlds[1]!];
  const answer = solveInvestigation(
    two[0]!.pack,
    { exhaustive: true, states: two.map((l) => l.state) },
    { target: { kind: 'identity', character: 'c' } },
    1000,
  );
  assert.equal(answer.worstRemaining, 1);
  assert.ok(answer.plan?.kind === 'act');
  assert.deepEqual(answer.plan.choice, { kind: 'ability', owner: 'b', ability: 'alien-kill' });
  const alive = answer.plan.responses.find(
    (b) => b.when.view.characters.find((c) => c.id === 'c')?.status === 'alive',
  );
  assert.deepEqual(alive?.then, { kind: 'stop', answers: [{ identity: '时间旅者' }] });
});
test('多个角色均可拒绝时同一拒绝报告不能区分；只有一人可拒绝时任何剧作家答复都能判明身份', () => {
  const roles = ['杀手', '主谋', '邪教徒', '魔女', '平民'];
  for (let mask = 1; mask < 32; mask++) {
    const subset = roles.filter((_, i) => mask & (1 << i));
    const worlds = subset.map((r) => office(r, 'b'));
    const advice = solveInvestigation(
      worlds[0]!.pack,
      { states: worlds.map((w) => w.state), exhaustive: true },
      { target: { kind: 'identity', character: 'a' } },
      10000,
    );
    assert.equal(advice.status, 'optimal');
    assert.equal(
      advice.worstRemaining,
      Math.max(1, subset.filter((r) => r !== '平民').length),
      subset.join(','),
    );
  }
});
test('合法的第二日调查重放和完整观察分别还原，再检查有限预算、部分候选、初始身份和视野', () => {
  const q = JSON.parse(
    readFileSync(
      new URL('../../products/engine/investigation-example.json', import.meta.url),
      'utf8',
    ),
  );
  const byReplay = investigate(q).investigation;
  assert.equal(byReplay.status, 'optimal');
  assert.equal(byReplay.worstRemaining, 1);
  const byView = investigate({
    evidence: exportObservation(q.candidates[0]),
    setups: q.candidates.map((c: { setup: unknown }) => c.setup),
    exhaustiveSetups: true,
    investigation: q.investigation,
    historyWorkLimit: 150000,
    worldLimit: 300,
  } as Parameters<typeof investigate>[0]);
  assert.equal(byView.investigation.status, 'optimal');
  assert.deepEqual(byView.investigation.plan, byReplay.plan);
  const short = investigate({ ...q, workLimit: 0 }).investigation;
  assert.equal(short.status, 'unknown');
  assert.equal(short.worstRemaining, 2);
  assert.equal(short.plan?.kind, 'stop');
  assert.equal(investigate({ ...q, frontierLimit: 1 }).investigation.reason, 'limit');
  assert.equal(investigate({ ...q, exhaustive: false }).investigation.worstRemaining, undefined);
  const l = office('平民', 'b');
  const alternate = clone(l.state);
  alternate.characters.a!.initialIdentity = '时间旅者';
  const states = [l.state, alternate];
  const original = canonical(states);
  const result = solveInvestigation(
    l.pack,
    { states, exhaustive: true },
    { target: { kind: 'identity', character: 'a' } },
    2000,
  );
  assert.equal(result.worstRemaining, 2);
  assert.equal(canonical(states), original);
  alternate.boards.city++;
  assert.throws(
    () => solveInvestigation(l.pack, { states, exhaustive: true }, { target: day }, 2),
    /Different observed/,
  );
});

test('神灵须选择正确的事件日期；同一个公开事件名不区分其真实当事人', () => {
  const worlds = ['b', 'c'].flatMap((first) =>
    ['b', 'd'].map((second) => {
      const l = lab();
      character(l, 'a', '神灵', '平民', 'shrine').counters.goodwill = 3;
      l.state.setup.incidents = [
        { day: 1, name: '医院事故', culprit: first },
        { day: 2, name: '失踪', culprit: second },
      ];
      phase(l, 'protagonist-abilities');
      return l;
    }),
  );
  for (const d of [1, 2]) {
    const r = solveInvestigation(
      worlds[0]!.pack,
      { exhaustive: true, states: worlds.map((l) => l.state) },
      { target: { kind: 'culprit', day: d } },
      1500,
    );
    assert.equal(r.worstRemaining, 1);
    assert.ok(r.plan?.kind === 'act');
    assert.equal(r.plan.responses.length, 1);
    const follow = r.plan.responses[0]!.then;
    assert.ok(follow.kind === 'act');
    assert.deepEqual(follow.choice, { kind: 'select', value: String(d) });
    for (const w of worlds) {
      const copy = { pack: w.pack, state: clone(w.state) };
      act(copy, r.plan.choice);
      act(copy, follow.choice);
      const report = [...copy.state.observations.protagonists]
        .reverse()
        .find((o) => o.type === 'culprit');
      assert.ok(report);
      const branch: { when: InvestigationView; then: InvestigationPlan } | undefined =
        follow.responses.find((b) =>
          b.when.view.reports.some((o) => canonical(o) === canonical(report)),
        );
      assert.deepEqual(branch?.then, {
        kind: 'stop',
        answers: [{ culprit: w.state.setup.incidents[d - 1]!.culprit }],
      });
    }
  }
});

test('刑警在第二轮第三天只能选本轮已发生事件，选择前两日分别公开各自当事人', () => {
  for (const selected of [1, 2]) {
    const l = lab();
    l.state.day = 3;
    l.state.loop = 2;
    character(l, 'a', '刑警', '平民', 'city').counters.goodwill = 4;
    l.state.setup.incidents = [
      { day: 1, name: '医院事故', culprit: 'b' },
      { day: 2, name: '不安扩散', culprit: 'c' },
      { day: 3, name: '失踪', culprit: 'd' },
    ];
    l.state.incidents = l.state.setup.incidents.map((i) => ({
      ...i,
      publicName: i.name,
      loop: i.day === 3 ? 1 : 2,
    }));
    phase(l, 'protagonist-abilities');
    act(l, { kind: 'ability', owner: 'a', ability: 'detective-incident' });
    assert.deepEqual(l.state.pending?.options, [
      { kind: 'select', value: '1' },
      { kind: 'select', value: '2' },
    ]);
    act(l, { kind: 'select', value: String(selected) });
    assert.deepEqual(l.state.observations.protagonists.find((o) => o.type === 'culprit')?.data, {
      day: selected,
      culprit: selected === 1 ? 'b' : 'c',
    });
  }
});
