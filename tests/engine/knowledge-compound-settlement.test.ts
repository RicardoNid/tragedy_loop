import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import {
  ConstraintStore,
  allocation,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';
import { projectIncidentDeaths } from '../../packages/engine/src/runtime/knowledge-death-settlement.js';
import { incidentStepProjection } from '../../packages/engine/src/runtime/knowledge-incident-settlement.js';
import { projectDayEnd } from '../../packages/engine/src/runtime/knowledge-mandatory-settlement.js';
import { drive } from '../../packages/engine/src/runtime/engine.js';
import type { Profile } from '../../packages/engine/src/runtime/knowledge-domain.js';
import { canonical, type EngineState, type Step } from '../../packages/engine/src/runtime/model.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { initialState } from '../../packages/engine/src/runtime/setup.js';
import { settle } from '../../packages/engine/src/runtime/settlement.js';

const pack = structuredClone(compileOfficial('BTX'));
const ids = ['lady', 'servant', 'student'];
const roles = ['时间旅者', '传谣人', '邪教徒'];
const setup: GameSetup = {
  module: 'BTX',
  anniversary: false,
  loops: 2,
  days: 1,
  captain: 'p0',
  discussion: 'allowed',
  y: '改变未来',
  x: ['流言四起', '因果线'],
  incidents: [{ day: 1, name: '医院事故', culprit: 'student' }],
  characters: ids.map((id, i) => ({
    id,
    character: ['大小姐', '从者', '男学生'][i]!,
    identity: roles[i]!,
  })),
};
function position(guard = 0) {
  const state = initialState(pack, setup);
  state.phase = 'incident';
  state.boards.hospital = 1;
  state.characters.lady!.area = state.characters.servant!.area = 'hospital';
  state.characters.student!.area = 'school';
  state.characters.servant!.counters.guard = guard;
  return state;
}
function context(state: EngineState) {
  const opening = initialPlacementView(state);
  return {
    opening,
    clock: opening,
    pack,
    days: 1,
    loops: 2,
    ex: opening.ex,
    boards: opening.boards,
    characters: new Map(opening.characters.map((c) => [c.id, c])),
  };
}
function profile(event: string): Profile {
  const store = new ConstraintStore(new Map(ids.map((id) => ['identity:' + id, new Set(roles)])));
  store.domains.set('event:1', new Set([event]));
  store.domains.set('culprit:1', new Set(ids));
  store.add(
    allocation(
      ids.map((id) => 'identity:' + id),
      roles,
    ),
  );
  assert.ok(store.propagate());
  store.finishSetup();
  return {
    id: 'test',
    y: setup.y,
    x: setup.x,
    identityCounts: Object.fromEntries(roles.map((r) => [r, 1])),
    store,
    active: true,
  };
}
const reportKey = (os: Observation[]) =>
  canonical(os.map((o) => canonical([o.type, o.data])).sort());

test('hospital deaths, immunity, substitution and multiple guard hits match every legal identity permutation', () => {
  for (const guard of [0, 1, 2]) {
    const entry = position(guard),
      ctx = context(entry);
    const cases: { assignment: string[]; reports: Observation[] }[] = [];
    for (const a of roles)
      for (const b of roles.filter((r) => r !== a)) {
        const assignment = [a, b, roles.find((r) => r !== a && r !== b)!];
        const s = structuredClone(entry);
        ids.forEach((id, i) => {
          s.characters[id]!.identity = assignment[i]!;
        });
        settle(
          pack,
          s,
          pack.incidents['医院事故']!.steps[0]!.effects.map((effect) => ({
            effect,
            env: { self: 'student' },
          })),
        );
        cases.push({ assignment, reports: s.observations.public });
      }
    for (const { reports } of cases.filter((c) => c.reports.length)) {
      const p = profile('医院事故');
      const result = projectIncidentDeaths(ctx, [...reports].reverse(), p, { branches: 4096 });
      assert.deepEqual(result?.participants, new Set(['lady', 'servant']));
      for (const candidate of cases) {
        const s = p.store.clone();
        ids.forEach((id, i) => s.narrow('identity:' + id, [candidate.assignment[i]!]));
        assert.equal(
          s.propagate(),
          reportKey(reports) === reportKey(candidate.reports),
          JSON.stringify({ guard, reports, assignment: candidate.assignment }),
        );
      }
      const limited = profile('医院事故');
      assert.equal(projectIncidentDeaths(ctx, reports, limited, { branches: 1 })?.open, true);
      assert.deepEqual(limited.store.values('identity:servant'), new Set(roles));
    }
  }
});

test('a missing simultaneous protagonist death requires an available protection source', () => {
  for (const soldier of [false, true]) {
    const entry = position();
    if (soldier) entry.characters.student!.character = '军人';
    entry.boards.hospital = 2;
    const ctx = context(entry);
    const actual = structuredClone(entry);
    actual.protected = soldier;
    settle(
      pack,
      actual,
      pack.incidents['医院事故']!.steps[0]!.effects.map((effect) => ({
        effect,
        env: { self: 'student' },
      })),
    );
    assert.equal(actual.protagonistDead, !soldier);
    const withoutFailure = actual.observations.public.filter((o) => o.type !== 'failure');
    const p = profile('医院事故');
    projectIncidentDeaths(ctx, withoutFailure, p, { branches: 4096 });
    assert.equal(p.active, soldier);
  }
});

test('public incident choices reproduce exactly the engine report multiset and reject mixed targets', () => {
  const name = 'transfer-fixture';
  const step: Step = {
    choices: [{ key: 'target', options: { kind: 'alive' } }],
    effects: [
      { op: 'transfer', from: '$self', to: '$target', counter: 'goodwill' },
      { op: 'counter', target: '$target', counter: 'intrigue', amount: 1 },
    ],
  };
  pack.incidents[name] = { ...pack.incidents['医院事故']!, name, steps: [step] };
  const entry = position(),
    ctx = context(entry);
  for (const c of Object.values(entry.characters)) c.counters.goodwill = 1;
  const board = context(entry);
  const outcomes: { owner: string; reports: Observation[] }[] = [];
  for (const owner of ids)
    for (const target of ids) {
      const s = structuredClone(entry);
      settle(
        pack,
        s,
        step.effects.map((effect) => ({ effect, env: { self: owner, target } })),
      );
      outcomes.push({ owner, reports: s.observations.public });
    }
  const impossible = [outcomes[1]!.reports[0]!, outcomes[1]!.reports[0]!];
  for (const reports of [...outcomes.map((c) => c.reports), impossible]) {
    const p = profile(name);
    const result = incidentStepProjection(board, ctx.opening, [...reports].reverse(), {
      branches: 4096,
    })(p);
    assert.equal(result?.open, false);
    const supported = new Set(
      outcomes.filter((c) => reportKey(c.reports) === reportKey(reports)).map((c) => c.owner),
    );
    assert.deepEqual(p.active ? p.store.values('culprit:1') : new Set(), supported);
    assert.deepEqual(p.store.values('identity:student'), new Set(roles));
  }
});

test('day-end mandatory abilities share entry eligibility and aggregate opposite deltas before capping', () => {
  const rules = structuredClone(pack);
  rules.plots[setup.y]!.abilities = [2, -1].map((amount) => ({
    id: 'board-' + amount,
    source: 'test',
    timing: 'day-end',
    mandatory: true,
    steps: [{ effects: [{ op: 'counter', counter: 'intrigue', target: 'school', amount }] }],
  }));
  const config: GameSetup = {
    ...setup,
    x: [],
    incidents: [],
    characters: ids.map((id, i) => ({
      id,
      character: ['男学生', '女学生', '巫女'][i]!,
      identity: '平民',
    })),
  };
  const entry = initialState(rules, config);
  entry.phase = 'day-end';
  entry.boards.school = 2;
  const ctx = { ...context(entry), pack: rules };
  const cases: { roles: string[]; reports: Observation[] }[] = [];
  for (const a of ['杀人狂', '平民'])
    for (const b of ['杀人狂', '平民']) {
      const state = structuredClone(entry);
      state.characters.lady!.identity = a;
      state.characters.servant!.identity = b;
      drive(rules, state, 3); // enter phase, stage all mandatory frames, settle the first step
      const reports = state.observations.public.filter((o) => o.simultaneousSize !== undefined);
      assert.ok(reports.some((o) => o.type === 'board' && o.data.intrigue === 3));
      assert.equal(
        reports.filter((o) => o.type === 'character' && o.data.status === 'dead').length,
        Number(a === '杀人狂') + Number(b === '杀人狂'),
      );
      cases.push({ roles: [a, b], reports });
    }
  for (const { reports } of cases) {
    const p: Profile = {
      ...profile('医院事故'),
      x: [],
      store: new ConstraintStore(
        new Map(
          ids.map((id) => [
            'identity:' + id,
            new Set(id === 'student' ? ['平民', '传谣人'] : ['杀人狂', '平民']),
          ]),
        ),
      ),
    };
    p.store.beginSettlement();
    const result = projectDayEnd(ctx, ctx.opening, [...reports].reverse(), p, { branches: 4096 });
    assert.equal(result?.open, false);
    assert.deepEqual(result?.participants, new Set(['lady', 'servant']));
    for (const c of cases) {
      const branch = p.store.clone();
      c.roles.forEach((role, i) => branch.narrow('identity:' + ids[i], [role]));
      assert.equal(branch.propagate(), reportKey(c.reports) === reportKey(reports));
    }
    assert.equal(p.store.values('identity:student').size, 2);
  }
});

test('an unobserved private operand remains a wildcard beside a disproved public incident', () => {
  const rules = structuredClone(pack);
  const visible = 'visible-fixture',
    hidden = 'private-fixture';
  const change: Step = {
    effects: [{ op: 'counter', target: 'school', counter: 'intrigue', amount: 1 }],
  };
  rules.incidents[visible] = { ...rules.incidents['医院事故']!, name: visible, steps: [change] };
  rules.incidents[hidden] = {
    ...rules.incidents[visible]!,
    name: hidden,
    steps: [
      {
        condition: { flag: 'private' },
        effects: [{ op: 'counter', target: 'city', counter: 'intrigue', amount: 1 }],
      },
    ],
  };
  const state = position(),
    ctx = { ...context(state), pack: rules };
  const p = profile(visible);
  p.store.domains.get('event:1')!.add(hidden);
  const reports: Observation[] = [
    {
      sequence: 1,
      loop: 1,
      day: 1,
      phase: 'incident',
      type: 'board',
      data: { board: 'city', intrigue: 1 },
    },
  ];
  const result = incidentStepProjection(ctx, ctx.opening, reports, { branches: 4096 })(p);
  assert.ok(result?.open && p.active);
  assert.deepEqual(p.store.values('event:1'), new Set([hidden]));
  assert.deepEqual(p.store.values('culprit:1'), new Set(ids));
});
