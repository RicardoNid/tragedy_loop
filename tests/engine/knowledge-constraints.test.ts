import { startSession, solverOpening } from './start-session.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConstraintStore,
  allocation,
  relation,
  type Domains,
} from '../../packages/engine/src/runtime/knowledge-constraints.js';
import {
  buildProfiles,
  configurations,
} from '../../packages/engine/src/runtime/knowledge-domain.js';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { createSession } from '../../packages/engine/src/runtime/ports.js';
import {
  EnumeratedKnowledge,
  LiveKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';

import { normalizeHistory } from '../../packages/engine/src/runtime/reference.js';

const setup: GameSetup = {
  module: 'FS',
  anniversary: false,
  loops: 2,
  days: 2,
  captain: 'p0',
  discussion: 'allowed',
  y: '复仇的火种',
  x: ['流言四起'],
  characters: [
    { id: 'a', character: '男学生', identity: '主谋' },
    { id: 'b', character: '女学生', identity: '传谣人' },
  ],
  incidents: [],
};
function session(config = setup) {
  const s = createSession(compileOfficial(config.module, config.anniversary), config);
  startSession(s);
  return s;
}
function finish(k: LiveKnowledge) {
  if (k.historySearchDeferred) k.verifyAll();
  const end = Date.now() + 30000;
  while (!k.paused && Date.now() < end) k.tick(20, Infinity);
  assert.ok(k.paused, 'search must stop');
  assert.equal(k.snapshot().status, 'exact', JSON.stringify(k.snapshot()));
  return k.snapshot();
}
const mapping = (domains: Domains) =>
  Object.fromEntries([...domains].map(([key, values]) => [key, [...values].sort()]));

test('compound closure finds an arc-consistent contradiction through earlier evidence', () => {
  function cycle(budget: number) {
    const s = new ConstraintStore(new Map(['a','b','c','idle'].map(k => [k, new Set(['0','1'])])));
    s.finishSetup();
    const differs = (a: string, b: string) => a !== b;
    s.add(relation('ab','a','b',differs));
    s.add(relation('bc','b','c',differs));
    s.beginSettlement();
    s.add(relation('ca','c','a',differs));
    assert.ok(s.propagate());
    return { s, result: s.finishSettlement(true,budget) };
  }
  const partial = cycle(1);
  assert.ok(!partial.result.complete && partial.s.consistent);
  assert.deepEqual([...partial.s.values('a')], ['0','1']);
  const full = cycle(2);
  assert.deepEqual(full.result.keys, new Set(['a','b','c']));
  assert.ok(full.result.complete && !full.s.consistent);
});

test('simultaneous independent allocations use the sum of local branches', () => {
  const s = new ConstraintStore(new Map([
    ['a',new Set(['0','1'])], ['b',new Set(['0','1'])],
    ['x',new Set(['2','3'])], ['y',new Set(['2','3'])], ['idle',new Set(['4','5'])],
  ]));
  s.add(allocation([...s.domains.keys()], ['0','1','2','3','4','5'], undefined, false));
  s.finishSetup();
  s.beginSettlement();
  s.add(relation('ab','a','b',(a,b) => a !== b));
  s.add(relation('xy','x','y',(x,y) => x !== y));
  assert.ok(s.propagate());
  const result = s.finishSettlement(true,4);
  assert.deepEqual(result.keys,new Set(['a','b','x','y']));
  assert.ok(result.complete);
  assert.equal(result.branches,4);
  assert.deepEqual([...s.values('idle')],['4','5']);
});

test('dependency queue matches full propagation while skipping unrelated constraints', () => {
  function make() {
    const s = new ConstraintStore(
      new Map(['a', 'b', 'c', 'x', 'y'].map((k) => [k, new Set(['0', '1', '2'])])),
    );
    s.add(relation('ab', 'a', 'b', (a, b) => a !== b));
    s.add(relation('bc', 'b', 'c', (a, b) => a === b));
    s.add(relation('unrelated', 'x', 'y', (a, b) => a === b));
    s.propagate();
    return s;
  }
  const local = make(),
    full = make();
  const startLocal = local.stats.checks,
    startFull = full.stats.checks;
  for (const s of [local, full]) s.narrow('a', ['0']);
  local.propagate();
  full.propagate(true);
  assert.deepEqual(mapping(local.domains), mapping(full.domains));
  assert.ok(local.stats.checks - startLocal < full.stats.checks - startFull);
  assert.deepEqual([...local.values('c')], ['1', '2']);
  const checks = local.stats.checks;
  local.narrow('a', ['0']);
  local.propagate();
  assert.equal(local.stats.checks, checks);
});

test('global allocation prunes Hall sets and detects capacity contradictions without enumeration', () => {
  const s = new ConstraintStore(
    new Map([
      ['a', new Set(['主谋', '传谣人'])],
      ['b', new Set(['主谋', '传谣人'])],
      ['c', new Set(['主谋', '传谣人', '平民'])],
    ]),
  );
  s.add(allocation(['a', 'b', 'c'], ['主谋', '传谣人', '平民']));
  assert.equal(s.propagate(), true);
  assert.deepEqual([...s.values('c')], ['平民']);
  assert.equal(s.stats.branches, 0);
  s.narrow('a', ['主谋']);
  s.narrow('b', ['主谋']);
  assert.equal(s.propagate(), false);
});

test('initial symbolic construction materializes zero setups; duplicate information and idle ticks do no work', () => {
  const opening = solverOpening(session());
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, opening.revision);
  const first = k.snapshot();
  assert.equal(first.generated, 0);
  assert.equal(first.domainComplete, true);
  assert.deepEqual(new Set(first.identities.a), new Set(['主谋', '传谣人']));
  const complete = finish(k);
  for (let i = 0; i < 10; i++) {
    k.append(opening.observations, 0, opening.revision);
    k.append([], opening.observations.length, opening.revision + 1);
    k.tick();
  }
  const repeated = k.snapshot();
  assert.deepEqual(repeated.propagation, complete.propagation);
  assert.equal(repeated.expansions, complete.expansions);
  assert.equal(repeated.generated, complete.generated);
  assert.equal(repeated.jointCount, null);
  assert.throws(
    () => k.append([{ ...opening.observations[0]!, type: 'rule', data: { rule: 'fake' } }], 0, 100),
    /改写/,
  );
  assert.throws(() => k.append([], 99, 100), /偏移/);
  assert.throws(() => k.append([], NaN, 100), /偏移/);
  const renumbered = opening.observations.map((o) => ({ ...o, sequence: o.sequence + 1 }));
  assert.throws(() => k.update(renumbered, 100), /改写/);
  k.update(opening.observations, repeated.revision);
  assert.equal(k.snapshot().revision, repeated.revision);
});

test('new action reuses prior history states and an exhausted budget never removes unknown values', () => {
  const s = session(),
    opening = solverOpening(s);
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, opening.revision);
  const initial = finish(k);
  s.protagonists.p0.submit({
    id: 'go',
    expectedRevision: opening.revision,
    decisionId: opening.decision!.id,
    choice: { kind: 'continue' },
  });
  const next = s.protagonists.p0.view();
  k.append(
    next.observations.slice(opening.observations.length),
    opening.observations.length,
    next.revision,
  );
  k.tick(20, 0);
  assert.equal(k.snapshot().status, 'incomplete');
  assert.deepEqual(k.snapshot().identities, initial.identities);
  assert.equal(k.snapshot().excluded, 0);
  // A fresh solver with normal budget must prove the same values. The limited one resumes on new evidence.
  const resumed = new LiveKnowledge(compileOfficial('FS'), opening);
  resumed.append(opening.observations, 0, opening.revision);
  finish(resumed);
  const initialized = resumed.snapshot().propagation!.initializations;
  resumed.append(
    next.observations.slice(opening.observations.length),
    opening.observations.length,
    next.revision,
  );
  const after = finish(resumed);
  assert.equal(
    after.propagation!.initializations,
    initialized,
    'existing witnesses advance without reinitializing',
  );
  assert.deepEqual(after.identities, initial.identities);
});

test('simultaneous disclosures commit together, accept reordered retries and preserve later evidence', () => {
  const opening = solverOpening(session());
  const start = opening.observations.length + 1;
  const report = (character: string, identity: string, sequence: number): Observation => ({
    sequence, loop: 1, day: 1, phase: 'protagonist-abilities', type: 'identity',
    simultaneousGroup: start, simultaneousSize: 2, data: { character, identity },
  });
  const group = [report('a', '主谋', start), report('b', '传谣人', start + 1)];
  const reversed = [report('b', '传谣人', start), report('a', '主谋', start + 1)];
  const singles = group.map(({ simultaneousGroup: _group, ...o }) => ({ ...o, simultaneousSize: 1 }));
  assert.deepEqual(normalizeHistory(group), normalizeHistory(reversed));
  assert.notDeepEqual(normalizeHistory(group), normalizeHistory(singles));
  assert.deepEqual(normalizeHistory(group.slice(0, 1)), []);
  const solve = () => {
    const k = new LiveKnowledge(compileOfficial('FS'), opening);
    k.update(opening.observations, 1);
    return k;
  };
  const k = solve();
  const before = k.snapshot();
  k.append([reversed[0]!], start - 1, 2);
  assert.equal(k.observationCount, start);
  assert.equal(k.snapshot().evidenceThrough, start - 1);
  assert.deepEqual(k.snapshot().identities, before.identities);
  assert.deepEqual(k.snapshot().propagation, before.propagation);
  assert.throws(() => k.append([singles[1]!], start, 2), /同时结算/);
  assert.equal(k.observationCount, start);
  k.append([reversed[1]!], start, 2);
  const complete = k.snapshot();
  assert.equal(complete.evidenceThrough, start + 1);
  const full = solve();
  full.append(group, start - 1, 2);
  assert.deepEqual(complete.identities, full.snapshot().identities);
  assert.deepEqual(complete.identities.a, ['主谋']);
  k.update([...opening.observations, ...group], 2);
  assert.deepEqual(k.snapshot().propagation, complete.propagation);
  assert.throws(() => k.update([...opening.observations, group[0]!, { ...group[0]!, sequence: start + 1 }], 2), /改写/);
  const later = { ...singles[0]!, sequence: start + 2, data: { character: 'a', identity: '传谣人' } };
  k.append([later], start + 1, 3);
  assert.equal(k.snapshot().status, 'contradiction');
});

test('direct disclosures propagate conditional quotas immediately, including contradiction', () => {
  const opening = solverOpening(session());
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, 1);
  const o: Observation = {
    sequence: 2,
    loop: 1,
    day: 1,
    phase: 'protagonist-abilities',
    type: 'identity',
    data: { character: 'a', identity: '主谋' },
  };
  k.append([o], 1, 2);
  assert.deepEqual(k.snapshot().identities.b, ['传谣人']);
  assert.equal(k.snapshot().generated, 0, 'propagation happens before any joint setup search');
  k.append([{ ...o, sequence: 3, data: { character: 'b', identity: '主谋' } }], 2, 3);
  assert.equal(k.snapshot().status, 'contradiction');
});

test('verified marginals do not license invalid joint combinations or expose private setup fields', () => {
  const opening = solverOpening(session());
  assert.equal(opening.roster, undefined);
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, opening.revision);
  const view = finish(k);
  assert.ok(view.verified!.identities.a!.includes('主谋'));
  assert.ok(view.verified!.identities.b!.includes('主谋'));
  const impossible = structuredClone(setup);
  impossible.characters.forEach((c) => {
    c.identity = '主谋';
  });
  assert.equal(k.queryConfiguration(impossible), 'excluded');
  assert.equal('setup' in view, false);
  assert.equal('frontier' in view, false);
});

test('later card disclosure retains alternative hidden explanations and matches a fresh solver', () => {
  const s = session(),
    opening = solverOpening(s);
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, opening.revision);
  finish(k);
  s.protagonists.p0.submit({
    id: 'go',
    expectedRevision: opening.revision,
    decisionId: opening.decision!.id,
    choice: { kind: 'continue' },
  });
  let offset = opening.observations.length;
  const sync = () => {
    const v = s.protagonists.p0.view();
    k.append(v.observations.slice(offset), offset, v.revision);
    offset = v.observations.length;
    return finish(k);
  };
  sync();
  const mm = s.mastermind.view();
  const placed = s.mastermind.submit({
    id: 'hidden',
    expectedRevision: mm.revision,
    decisionId: mm.decision!.id,
    choice: {
      kind: 'cards',
      placements: (
        [
          ['paranoia+1', 'a'],
          ['intrigue+2', 'b'],
          ['horizontal', 'hospital'],
        ] as const
      ).map(([kind, target]) => ({
        card: mm.hands.mastermind!.find((c) => c.kind === kind)!.id,
        target,
      })),
    },
  });
  assert.notEqual(placed.status, 'rejected');
  assert.ok(s.protagonists.p0.view().placements.every((p) => !p.kind));
  sync();
  for (const [seat, kind, target] of [
    ['p0', 'horizontal', 'hospital'],
    ['p1', 'vertical', 'shrine'],
    ['p2', 'block-movement', 'city'],
  ] as const) {
    const v = s.protagonists[seat].view();
    const result = s.protagonists[seat].submit({
      id: `reveal-${seat}`,
      expectedRevision: v.revision,
      decisionId: v.decision!.id,
      choice: {
        kind: 'cards',
        placements: [{ card: v.hands[seat]!.find((c) => c.kind === kind)!.id, target }],
      },
    });
    assert.notEqual(result.status, 'rejected');
  }
  const result = sync();
  const fresh = new LiveKnowledge(compileOfficial('FS'), opening);
  const now = s.protagonists.p0.view();
  fresh.append(now.observations, 0, now.revision);
  assert.deepEqual(result.identities, finish(fresh).identities);
  assert.equal(k.queryConfiguration(setup), 'possible');
});

test('unsupported infinite parameters remain unknown instead of being reported as a contradiction', () => {
  const opening = solverOpening(session());
  opening.characters[0]!.character = '仙人';
  const k = new LiveKnowledge(compileOfficial('FS'), opening);
  k.append(opening.observations, 0, opening.revision);
  k.tick();
  assert.equal(k.snapshot().status, 'unsupported');
  assert.equal(k.queryConfiguration(setup), 'unknown');
});

test('real event type and culprit reuse remain conditional rather than unconditionally all-different', () => {
  const config = structuredClone(setup);
  config.characters.push({ id: 'c', character: '住院患者', identity: '平民' });
  config.incidents = [
    { day: 1, name: '医院事故', culprit: 'a' },
    { day: 2, name: '谋杀', culprit: 'b' },
  ];
  const opening = solverOpening(session(config));
  const pack = structuredClone(compileOfficial('FS'));
  // Controlled content fixture exercises the conditional machinery; FS itself has no forged event.
  pack.incidents['伪造事件'] = { ...pack.incidents['谋杀']!, name: '伪造事件' };
  const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 });
  const actual = new Set(
    [...configurations(pack, opening, profiles)].filter((v) => v !== null).map(canonical),
  );
  const expected = new Set(
    [...generateDomain(pack, opening)].filter((v) => v !== null).map(canonical),
  );
  assert.ok(actual.size > 0);
  assert.deepEqual(actual, expected);
  assert.ok([...actual].some((s) => s.includes('伪造事件')));
  pack.incidents['连续杀人'] = { ...pack.incidents['谋杀']!, name: '连续杀人' };
  opening.incidents = [
    { day: 1, name: '连续杀人' },
    { day: 2, name: '连续杀人' },
  ];
  const serial = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 });
  const serialSetups = [...configurations(pack, opening, serial)].filter((v) => v !== null);
  assert.ok(serialSetups.some((s) => s.incidents[0]!.culprit === s.incidents[1]!.culprit));
  assert.ok(
    serialSetups.every(
      (s) =>
        s.incidents[0]!.culprit !== s.incidents[1]!.culprit ||
        s.incidents.every((e) => e.name === '连续杀人'),
    ),
  );
  assert.deepEqual(
    new Set(serialSetups.map(canonical)),
    new Set([...generateDomain(pack, opening)].filter((v) => v !== null).map(canonical)),
  );
});

for (const variant of [
  'ordinary',
  'AI',
  '妹妹',
  '局外人',
  '模仿犯',
  '周年',
  '周年模仿犯',
  '临时工',
  '转校生',
  '神灵',
  '大人物',
] as const)
  test(`constraint assignments equal exhaustive construction: ${variant}`, () => {
    const config = structuredClone(setup);
    config.characters.push({ id: 'c', character: '住院患者', identity: '平民' });
    if (variant === 'AI') config.characters[0]!.character = 'AI';
    if (variant === '妹妹') config.characters[2]!.character = '妹妹';
    if (variant === '局外人')
      config.characters[2] = { id: 'c', character: '局外人', identity: '邪教徒' };
    if (variant === '模仿犯')
      config.characters[2] = { id: 'c', character: '模仿犯', identity: '主谋', copiedFrom: 'a' };
    if (variant === '周年') {
      config.anniversary = true;
      config.anniversaryFragment = 'c';
    }
    if (variant === '周年模仿犯') {
      config.anniversary = true;
      config.anniversaryFragment = 'c';
      config.characters[2] = { id: 'c', character: '模仿犯', identity: '平民', copiedFrom: 'd' };
      config.characters.push({ id: 'd', character: '职员', identity: '平民' });
    }
    if (variant === '临时工') config.characters[0]!.character = '临时工';
    if (variant === '转校生')
      config.characters[2] = { id: 'c', character: '转校生', identity: '平民', enterDay: 2 };
    if (variant === '神灵')
      config.characters[2] = { id: 'c', character: '神灵', identity: '平民', enterLoop: 2 };
    if (variant === '大人物')
      config.characters[2] = {
        id: 'c',
        character: '大人物',
        identity: '平民',
        territory: 'school',
      };
    config.incidents =
      variant === '转校生' || variant === '神灵'
        ? [{ day: 2, name: '医院事故', culprit: 'c' }]
        : [{ day: 1, name: '医院事故', culprit: 'b' }];
    const pack = compileOfficial(config.module, config.anniversary),
      opening = solverOpening(session(config));
    if (variant === '转校生' || variant === '神灵') {
      assert.equal(opening.roster, undefined);
      // This test supplies a known roster explicitly; the engine never discloses hidden arrivals.
      opening.roster = config.characters.map(({ id, character }) => ({ id, character }));
    }
    const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 });
    const normalize = (s: GameSetup) =>
      canonical({
        ...s,
        characters: s.characters.map((c) =>
          Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
        ),
      });
    const actual = new Set(
      [...configurations(pack, opening, profiles)].filter((v) => v !== null).map(normalize),
    );
    const expected = new Set(
      [...generateDomain(pack, opening)].filter((v) => v !== null).map(normalize),
    );
    assert.ok(expected.size > 0);
    assert.deepEqual(actual, expected);
    const oracle = new EnumeratedKnowledge(pack, opening);
    oracle.update(opening.observations, opening.revision);
    assert.equal(oracle.queryConfiguration(config), 'possible');
    if (variant === '转校生' || variant === '神灵') {
      assert.ok(!opening.characters.some((c) => c.id === 'c'));
      while (!oracle.paused) oracle.tick();
      assert.ok(oracle.snapshot().culprits['2']?.includes('c'));
    }
    const k = new LiveKnowledge(pack, opening);
    k.append(opening.observations, 0, opening.revision);
    finish(k);
    assert.equal(k.queryConfiguration(config), 'possible');
  });

test('territory domains follow the compiled marker for both current and older openings', () => {
  const pack = structuredClone(compileOfficial('FS'));
  pack.characters['男学生']!.abilityArea = pack.characters['大人物']!.abilityArea!;
  const config = structuredClone(setup);
  config.characters[0]!.territory = 'school';
  const session = createSession(pack, config);
  startSession(session);
  const opening = solverOpening(session);
  assert.equal(opening.territory, 'school');
  for (const expected of [['school'], ['hospital', 'shrine', 'city', 'school']]) {
    const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 });
    assert.ok(profiles.length);
    for (const profile of profiles)
      assert.deepEqual(profile.store.domains.get('territory:a'), new Set(expected));
    const enumerated = new Set([...generateDomain(pack, opening)].flatMap(
      (candidate) => candidate ? [candidate.characters.find((c) => c.id === 'a')!.territory] : [],
    ));
    assert.deepEqual(enumerated, new Set(expected));
    delete opening.territory;
  }
});
