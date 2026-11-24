import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.ts';
import {
  officialModules,
  supportsAnniversary,
  completeObservationGroups,
} from '../../packages/contracts/src/game.ts';
import {
  initialize,
  initializeDiscussion,
  advance,
  cardCount,
  legalCardTargets,
} from '../../packages/engine/src/runtime/engine.ts';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.ts';
import {
  LiveKnowledge,
  EnumeratedKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.ts';
import { canonical } from '../../packages/engine/src/runtime/model.ts';
import {
  configuredAddition,
  buildProfiles,
  configurations,
} from '../../packages/engine/src/runtime/knowledge-domain.ts';
import { routes } from '../../packages/engine/src/runtime/knowledge-routes.ts';
import { PruningCatalog } from '../../packages/engine/src/runtime/knowledge-pruning.ts';
import { cases, casePlayer } from '../../tests/engine/knowledge-fsbtx-cases.ts';
import { focusedTimelineCases } from '../../tests/engine/knowledge-timeline-cases.ts';
import { officialScenarioSetup } from '../../tests/engine/official-harness.ts';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.ts';
import { phaseCatalog, phaseNames } from './timeline-audit-catalog.mjs';
import { renderTimeline } from './timeline-audit-page.mjs';

const output = new URL('../../products/engine/timeline-audit.html', import.meta.url);
const progress = new URL('../../products/engine/timeline-audit-progress.json', import.meta.url);
const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex');
const files = [
  'knowledge-live.ts',
  'knowledge-scope.ts',
  'knowledge-history.ts',
  'knowledge-enumerated.ts',
  'knowledge-domain.ts',
  'observation-history.ts',
  'knowledge-goodwill.ts',
  'knowledge-incident-settlement.ts',
  'engine.ts',
  'settlement.ts',
];
const sourceHashes = Object.fromEntries(
  files.map((file) => [
    file,
    hash(
      readFileSync(new URL('../../packages/engine/src/runtime/' + file, import.meta.url), 'utf8'),
    ),
  ]),
);
const fingerprint = hash(sourceHashes);
const selected = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const data =
  process.argv.includes('--resume') && existsSync(progress)
    ? JSON.parse(readFileSync(progress, 'utf8'))
    : {
        schemaVersion: 2,
        oracleMode: 'independent-prefix',
        startedAt: new Date().toISOString(),
        status: 'running',
        sourceHashes,
        fingerprint,
        phaseCatalog,
        routes,
        scenarios: [],
        findings: [],
        inventory: [],
        repairs: [
          {
            area: 'WM 穷举参照',
            before:
              '将两条副线视为无序组合，基础与周年的四角色样本均只生成 72 个初始配置；完整配置查询还会排序副线，混淆第一副线。',
            after:
              'WM 单独枚举两个副线顺序，并在配置查询键中保留顺序；两个样本均恢复为 144 个配置。公开第一副线后，反序配置可正确排除。',
            regression: 'tests/engine/knowledge-timeline.test.ts',
          },
        ],
        methodNotes: [
          {
            scenario: 'case-3',
            through: 22,
            issue:
              '旧穷举器连续复用前缀时单节点超过 180 秒；独立重算该前缀得到 288 个解、1584 次历史展开，约 1.4 秒。为隔离参照器缓存路径影响，所有最终参照点均从初始域独立重算。',
          },
        ],
      };
assert.equal(data.fingerprint, fingerprint, 'Cannot reuse results from different solver sources');
assert.equal(data.oracleMode, 'independent-prefix', 'Old audit methodology: run without --resume');

function save() {
  // Windows readers may hold a short-lived sharing lock while inspecting progress.
  for (const [file, content] of [
    [progress, JSON.stringify(data)],
    [output, renderTimeline(data)],
  ])
    for (let attempt = 0; ; attempt++) {
      try {
        writeFileSync(file, content);
        break;
      } catch (error) {
        if (attempt >= 5 || !['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code))
          throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
}
function configurationKey(pack, s) {
  return canonical({
    ...s,
    discussion: 'allowed',
    secretAddition: configuredAddition(s),
    x: s.module === 'WM' ? s.x : [...s.x].sort(),
    characters: s.characters
      .map((c) => ({
        ...c,
        initialArea: c.initialArea ?? pack.characters[c.character]?.initial[0],
        ...(c.character === '神灵' ? { enterLoop: c.enterLoop ?? 1 } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    incidents: s.incidents
      .map((e) => ({ ...e, publicName: e.publicName ?? e.name }))
      .sort((a, b) => a.day - b.day),
  });
}
function finiteDomain(pack, opening, limit = 5000) {
  const domain = [];
  for (const s of generateDomain(pack, opening))
    if (s) {
      domain.push(s);
      if (domain.length > limit) return;
    }
  return domain;
}
function simpleSetup(module, anniversary) {
  const pack = compileOfficial(module, anniversary);
  const official = initializeDiscussion(pack, officialScenarioSetup(module, anniversary));
  assert.ok(official.state, JSON.stringify(official.diagnostics));
  const base = initialPlacementView(official.state);
  const normal = base.characters.filter(
    (c) =>
      ![
        '临时工',
        '临时工？',
        '仙人',
        '神灵',
        '上位存在',
        '模仿犯',
        '局外人',
        '大人物',
        '转校生',
        'UP主',
        '情报商',
      ].includes(c.character),
  );
  for (const count of [2, 3, 4, 5]) {
    if (normal.length < count) continue;
    const opening = {
      ...base,
      characters: normal.slice(0, count),
      roster: undefined,
      incidents: [],
      loops: 1,
      days: 1,
    };
    const domain = finiteDomain(pack, opening, module === 'LL' ? 2000 : 500);
    if (domain?.length) return domain.find((s) => s.y !== '封印的终末') ?? domain[0];
  }
  throw Error('No bounded public fixture for ' + module + ' anniversary=' + anniversary);
}
function ordinaryChoice(state, seed = 0) {
  const p = state.pending;
  if (p.kind === 'guess') {
    if (state.flags['c-guess'] === 'yes')
      return {
        kind: 'guess-culprits',
        answers: Object.fromEntries(state.setup.incidents.map((e) => [String(e.day), e.culprit])),
      };
    const guessed = new Set(JSON.parse(state.flags.guessed ?? '[]'));
    const target = state.setup.characters.find(
      (c) => !guessed.has(c.id) && state.characters[c.id]?.status !== 'absent',
    );
    assert.ok(target, 'No unguessed character remains');
    return {
      kind: 'guess',
      character: target.id,
      identity: target.identity,
      ...(target.reverseIdentity ? { reverseIdentity: target.reverseIdentity } : {}),
    };
  }
  if (p.kind === 'cards') {
    const hand = state.cards.filter((c) => c.owner === p.actor && c.status === 'hand');
    const targets = legalCardTargets(state, p.actor);
    const placements = [];
    for (let i = 0; i < cardCount(state, p.actor); i++) {
      const card = hand.splice((seed + i) % hand.length, 1)[0];
      const target = targets.splice((seed + i) % targets.length, 1)[0];
      placements.push({ card: card.id, target });
    }
    return { kind: 'cards', placements };
  }
  return (
    p.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
    p.options[0] ??
    enumerateChoices(state).next().value
  );
}
function twoLoopChoice(state) {
  if (state.pending.kind !== 'cards') return ordinaryChoice(state);
  const actor = state.pending.actor;
  const entries =
    actor === 'mastermind'
      ? [
          ['intrigue+1', 'school'],
          ['paranoia+1', 'a'],
          ['paranoia+1', 'b'],
        ]
      : [['block-movement', { p0: 'a', p1: 'b', p2: 'hospital' }[actor]]];
  const used = new Set();
  return {
    kind: 'cards',
    placements: entries.map(([kind, target]) => {
      const card = state.cards.find(
        (c) => c.owner === actor && c.kind === kind && c.status === 'hand' && !used.has(c.id),
      );
      assert.ok(card, `${actor} missing reusable ${kind}`);
      used.add(card.id);
      return { card: card.id, target };
    }),
  };
}
function buildHistory(fixture) {
  const pack = compileOfficial(fixture.setup.module, fixture.setup.anniversary);
  const init = initializeDiscussion(pack, fixture.setup);
  assert.ok(init.state, JSON.stringify(init.diagnostics));
  let state = init.state;
  const opening = initialPlacementView(state),
    choices = [];
  const play =
    fixture.play ??
    (fixture.original ? casePlayer(fixture) : (s) => ordinaryChoice(s, fixture.seed ?? 0));
  for (let i = 0; i < 180 && !state.winner; i++) {
    assert.ok(state.pending, fixture.name + ' stalled');
    const choice = play(state),
      actor = state.pending.actor;
    const next = advance(pack, state, actor, {
      id: 'timeline-' + i,
      expectedRevision: state.revision,
      decisionId: state.pending.id,
      choice,
    });
    assert.equal(
      next.status,
      'ok',
      fixture.name +
        ': ' +
        next.reason +
        ' ' +
        JSON.stringify({ phase: state.phase, actor, choice }),
    );
    choices.push({ actor, choice });
    state = next.state;
    if (
      fixture.original &&
      (state.phase === 'loop-end' || (state.loop > 1 && state.phase === 'discussion'))
    )
      break;
  }
  if (!fixture.original) assert.ok(state.winner, fixture.name + ' did not finish');
  fixture.verify?.(state);
  const history = project(state, 'protagonists').observations;
  if (fixture.requireTwoLoops) {
    assert.ok(
      history.some((o) => o.loop === 2 && o.day === 2),
      'Cross-loop fixture must reach day 2 of loop 2',
    );
  }
  return { pack, opening, history, choices, winner: state.winner };
}
function checkpoints(history) {
  const points = new Map([[0, { kind: 'initial', phase: 'discussion', loop: 1, day: 1 }]]);
  let end = 0,
    previous;
  for (const group of completeObservationGroups(history)) {
    const before = end;
    end += group.length;
    const last = group.at(-1),
      boundary = group.find((o) => o.type === 'boundary');
    if (boundary) {
      if (previous && !points.has(before))
        points.set(before, {
          kind: 'phase-end',
          phase: previous.phase,
          loop: previous.loop,
          day: previous.day,
        });
      points.set(end, {
        kind: 'entry',
        phase: boundary.phase,
        closed: previous?.phase,
        loop: boundary.loop,
        day: boundary.day,
      });
    }
    if (
      group.some((o) =>
        ['identity', 'rule', 'culprit', 'failure', 'incident', 'no-effect'].includes(o.type),
      )
    )
      points.set(end, { kind: 'evidence', phase: last.phase, loop: last.loop, day: last.day });
    previous = last;
  }
  if (end && !points.has(end))
    points.set(end, {
      kind: 'phase-end',
      phase: previous.phase,
      loop: previous.loop,
      day: previous.day,
    });
  // Guess outcomes precede their own-choice record in one engine command.
  // A free-form guess is not complete evidence until that command's choice arrives
  // (the public outcome alone does not include the reverse-face answer).
  const guessWindows = history.flatMap((o, i) => {
    if (
      !(o.type === 'identity' && o.data.guess !== undefined) &&
      !(o.type === 'culprit' && o.data.guesses !== undefined)
    )
      return [];
    const choice = history.slice(i + 1).find((x) => x.type === 'own-choice');
    return choice && ['guess', 'guess-culprits'].includes(choice.data.choice?.kind)
      ? [{ start: i + 1, end: history.indexOf(choice) + 1 }]
      : [];
  });
  for (const window of guessWindows) {
    const deferred = [...points].filter(
      ([through]) => through >= window.start && through < window.end,
    );
    if (!deferred.length) continue;
    for (const [through] of deferred) points.delete(through);
    const last = history[window.end - 1];
    points.set(window.end, {
      ...deferred.at(-1)[1],
      phase: last.phase,
      loop: last.loop,
      day: last.day,
      deferredFrom: deferred.map(([through]) => through),
      reason: '等待同次猜测的 own-choice；结果记录本身未包含完整回答。',
    });
  }
  return [...points].sort(([a], [b]) => a - b).map(([through, node]) => ({ through, ...node }));
}
function finish(solver, label) {
  const start = performance.now();
  while (!solver.paused) {
    solver.tick(30, Infinity);
    if (performance.now() - start > 180000) throw Error(label + ' exceeded 180s at one checkpoint');
  }
  const view = solver.snapshot();
  if (!['exact', 'contradiction'].includes(view.status) || !view.domainComplete)
    throw Error(label + ': ' + view.status + ' ' + JSON.stringify(view.reasons));
  return view;
}
const sortedValues = (v) =>
  v && Object.fromEntries(Object.entries(v).map(([k, values]) => [k, [...values].sort()]));
const snapshotSpace = (v) => ({
  identities: sortedValues(v.identities),
  rules: [...v.rules].sort(),
  culprits: sortedValues(v.culprits),
  realIncidents: sortedValues(v.realIncidents),
  parameters: sortedValues(v.parameters),
  ruleCombinations: v.ruleCombinations
    ?.map((c) => ({ ...c, x: [...c.x] }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b))),
});
const metrics = (v) => ({
  checks: v.propagation?.checks ?? 0,
  branches: v.propagation?.branches ?? 0,
  causeBranches: v.propagation?.causeBranches ?? 0,
  expansions: v.expansions,
  historyComparisons: v.propagation?.historyComparisons ?? 0,
});
const subtract = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - (b[k] ?? 0)]));
function projectionDifference(local, exact) {
  const entries = (v) =>
    new Set([
      ...Object.entries(v.identities).flatMap(([id, vs]) =>
        vs.map((x) => '身份 ' + id + ' = ' + x),
      ),
      ...v.rules.map((x) => '规则 ' + x),
      ...Object.entries(v.culprits).flatMap(([id, vs]) =>
        vs.map((x) => '当事人 ' + id + ' = ' + x),
      ),
    ]);
  const a = entries(local),
    b = entries(exact);
  return { extra: [...a].filter((x) => !b.has(x)), missing: [...b].filter((x) => !a.has(x)) };
}
function audit(fixture) {
  const { pack, opening, history, choices, winner } = buildHistory(fixture);
  const domain = finiteDomain(pack, opening);
  assert.ok(domain?.length, fixture.name + ' domain exceeded limit');
  const key = (s) => configurationKey(pack, s),
    ids = new Map(domain.map((s, i) => [key(s), 'C' + String(i + 1).padStart(4, '0')]));
  assert.equal(ids.size, domain.length, 'duplicate construction keys');
  const toIds = (ss) =>
    ss
      .map((s) => {
        const id = ids.get(key(s));
        assert.ok(id, 'configuration missing from domain');
        return id;
      })
      .sort();
  const local = new LiveKnowledge(pack, opening),
    nodeLocal = new LiveKnowledge(pack, opening);
  const exact = new LiveKnowledge(pack, opening),
    nodeExact = new LiveKnowledge(pack, opening);
  const result = {
    id: fixture.id,
    name: fixture.name,
    focus: fixture.focus,
    module: pack.module,
    anniversary: pack.anniversary,
    setup: fixture.setup,
    opening,
    history,
    choices,
    winner,
    domain: domain.map((s, i) => ({ id: 'C' + String(i + 1).padStart(4, '0'), setup: s })),
    nodes: [],
    status: 'complete',
  };
  const directProof = domain.length > 450;
  result.proofMode = directProof ? 'finite-domain-query' : 'joint-enumeration';
  function proved(solver, label) {
    if (!directProof) {
      solver.verifyCombinations();
      const view = finish(solver, label);
      return { view, solutions: solver.jointSolutions() ?? [] };
    }
    const solutions = [];
    for (const candidate of domain) {
      const verdict = solver.queryConfiguration(candidate);
      assert.notEqual(verdict, 'unknown', label + ' candidate query incomplete');
      if (verdict === 'possible') solutions.push(candidate);
    }
    return { view: solver.snapshot(), solutions };
  }
  const briefing = initialize(pack, fixture.setup);
  assert.ok(briefing.state);
  assert.equal(
    new LiveKnowledge(pack, project(briefing.state, 'protagonists')).snapshot().status,
    'waiting',
  );
  result.briefing = 'waiting';
  let previous = 0,
    priorExpected = new Set(ids.values());
  let priorMetrics = [local, nodeLocal, exact, nodeExact].map((s) => metrics(s.snapshot()));
  try {
    for (const point of checkpoints(history)) {
      const suffix = history.slice(previous, point.through);
      for (const o of suffix) {
        local.append([o], o.sequence - 1, o.sequence);
        exact.append([o], o.sequence - 1, o.sequence);
      }
      if (suffix.length) {
        nodeLocal.append(suffix, previous, point.through);
        nodeExact.append(suffix, previous, point.through);
      }
      const a = local.snapshot(),
        b = nodeLocal.snapshot();
      const originalProof = proved(exact, fixture.id + ' original #' + point.through),
        nodeProof = proved(nodeExact, fixture.id + ' node #' + point.through);
      const c = originalProof.view,
        d = nodeProof.view;
      const exhaustive = new EnumeratedKnowledge(pack, opening, 10000, true);
      exhaustive.update(history.slice(0, point.through), point.through);
      const e = finish(exhaustive, fixture.id + ' exhaustive #' + point.through);
      const expected = exhaustive.jointSolutions();
      assert.ok(expected, 'exhaustive configuration set incomplete');
      const expectedIds = toIds(expected),
        originalIds = toIds(originalProof.solutions),
        nodeIds = toIds(nodeProof.solutions);
      assert.equal(
        e.possible,
        expectedIds.length,
        'exhaustive count differs from materialized set',
      );
      const expectedSet = new Set(expectedIds);
      const compare = (list) => ({
        missing: expectedIds.filter((id) => !list.includes(id)),
        extra: list.filter((id) => !expectedSet.has(id)),
      });
      const differences = {
        original: compare(originalIds),
        node: compare(nodeIds),
        localDelivery: canonical(snapshotSpace(a)) !== canonical(snapshotSpace(b)),
        localProjection: projectionDifference(a, e),
      };
      const now = [a, b, c, d].map(metrics);
      const node = {
        ...point,
        phaseName: phaseNames[point.phase],
        before: priorExpected.size,
        after: expectedIds.length,
        eliminated: [...priorExpected].filter((id) => !expectedSet.has(id)),
        original: originalIds,
        node: nodeIds,
        exhaustive: expectedIds,
        differences,
        local: snapshotSpace(a),
        localNode: snapshotSpace(b),
        work: {
          originalLocal: subtract(now[0], priorMetrics[0]),
          nodeLocal: subtract(now[1], priorMetrics[1]),
          originalExact: subtract(now[2], priorMetrics[2]),
          nodeExact: subtract(now[3], priorMetrics[3]),
          exhaustive: e.expansions,
        },
        observations: suffix.map((o) => ({
          sequence: o.sequence,
          phase: o.phase,
          type: o.type,
          data: o.data,
        })),
        deductions: (a.calculationTrace ?? []).filter(
          (t) => t.observation > previous && t.observation <= point.through,
        ),
      };
      result.nodes.push(node);
      if (
        differences.original.missing.length ||
        differences.original.extra.length ||
        differences.node.missing.length ||
        differences.node.extra.length ||
        differences.localDelivery ||
        differences.localProjection.missing.length
      )
        data.findings.push({
          scenario: fixture.id,
          through: point.through,
          phase: point.phase,
          differences,
        });
      assert.ok(
        expectedSet.has(ids.get(key(fixture.setup))),
        fixture.name + ' exhaustive lost actual script',
      );
      assert.ok(
        expectedIds.every((id) => priorExpected.has(id)),
        'exact space grew after appending observations',
      );
      previous = point.through;
      priorExpected = expectedSet;
      priorMetrics = now;
      console.log(
        fixture.id,
        point.loop + '/' + point.day,
        point.phase,
        point.kind,
        '#' + point.through,
        node.before + '→' + node.after,
        'diff',
        differences.original.missing.length +
          differences.node.missing.length +
          differences.original.extra.length +
          differences.node.extra.length,
      );
    }
  } catch (error) {
    result.status = 'incomplete';
    result.error = String(error);
    data.findings.push({
      scenario: fixture.id,
      kind: 'incomplete',
      through: previous,
      message: String(error),
    });
    console.error(error);
  }
  return result;
}

const fixtures = cases.map((c, i) => ({ ...c, id: 'case-' + i, original: true }));
fixtures.push(...focusedTimelineCases);
for (const module of officialModules)
  for (const anniversary of supportsAnniversary(module) ? [false, true] : [false]) {
    const id = module + (anniversary ? '-anniversary' : '-base');
    if (selected && selected !== id && selected !== 'all') continue;
    try {
      fixtures.push({
        id,
        name: module + (anniversary ? ' 周年' : ' 基础') + '完整单轮',
        setup: simpleSetup(module, anniversary),
      });
    } catch (error) {
      data.findings.push({ scenario: id, kind: 'setup-coverage', message: String(error) });
      console.error(id, error);
    }
  }
fixtures.push({
  id: 'FS-two-loops',
  name: 'FS 两日两轮与跨轮重置',
  play: twoLoopChoice,
  requireTwoLoops: true,
  setup: {
    ...cases[0].setup,
    days: 2,
    loops: 2,
    x: ['流言四起'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '女学生', identity: '传谣人' },
    ],
    incidents: [],
  },
});

for (const fixture of fixtures) {
  if (selected && selected !== 'all' && fixture.id !== selected) continue;
  if (data.scenarios.some((s) => s.id === fixture.id && s.status === 'complete')) continue;
  data.scenarios = data.scenarios.filter((s) => s.id !== fixture.id);
  data.findings = data.findings.filter((f) => f.scenario !== fixture.id);
  console.log('START', fixture.id, fixture.name);
  try {
    data.scenarios.push(audit(fixture));
  } catch (error) {
    data.scenarios.push({
      id: fixture.id,
      name: fixture.name,
      module: fixture.setup.module,
      status: 'incomplete',
      error: String(error),
    });
    data.findings.push({ scenario: fixture.id, kind: 'incomplete', message: String(error) });
    console.error(error);
  }
  save();
}

if (!selected || selected === 'all') {
  data.negativeCases = [];
  for (const kind of [
    'goodwill-wrong-amount',
    'incident-wrong-amount',
    'incident-missing-effect',
  ]) {
    const fixture = focusedTimelineCases.find(
      (c) =>
        c.id === (kind.startsWith('goodwill') ? 'FS-goodwill-effective' : 'BTX-incident-fixed'),
    );
    try {
      const { pack, opening, history } = buildHistory(fixture);
      const invalid = structuredClone(history);
      const index = invalid.findIndex((o) =>
        kind.startsWith('goodwill')
          ? o.phase === 'protagonist-abilities' &&
            o.type === 'character' &&
            o.data.character === 'b'
          : o.phase === 'incident' && o.type === 'board' && o.data.board === 'shrine',
      );
      assert.ok(index >= 0);
      if (kind === 'incident-missing-effect') {
        assert.equal(invalid[index].simultaneousSize ?? 1, 1);
        invalid.splice(index, 1);
        const mapping = new Map(invalid.map((o, i) => [o.sequence, i + 1]));
        for (let i = 0; i < invalid.length; i++) {
          const o = invalid[i];
          if (o.simultaneousGroup !== undefined)
            o.simultaneousGroup = mapping.get(o.simultaneousGroup);
          o.sequence = i + 1;
        }
      } else if (kind.startsWith('goodwill')) invalid[index].data.counters.paranoia = 2;
      else invalid[index].data.intrigue = 1;
      const original = new LiveKnowledge(pack, opening),
        node = new LiveKnowledge(pack, opening);
      for (const o of invalid) original.append([o], o.sequence - 1, o.sequence);
      node.append(invalid, 0, invalid.length);
      const oracle = new EnumeratedKnowledge(pack, opening, 10000, true);
      oracle.update(invalid, invalid.length);
      for (const solver of [original, node]) solver.verifyCombinations();
      const counts = [original, node, oracle].map((solver) => {
        finish(solver, kind);
        const solutions = solver.jointSolutions();
        assert.ok(solutions, 'Unfinished query is not an empty set');
        return solutions.length;
      });
      assert.deepEqual(counts, [0, 0, 0]);
      data.negativeCases.push({
        kind,
        fixture: fixture.id,
        counts,
        status: 'contradiction-confirmed',
        history: invalid,
      });
    } catch (error) {
      data.findings.push({ kind: 'negative-oracle', case: kind, message: String(error) });
    }
  }
  data.inventory = [];
  for (const module of officialModules)
    for (const anniversary of supportsAnniversary(module) ? [false, true] : [false]) {
      const pack = compileOfficial(module, anniversary);
      const catalog = new PruningCatalog(
        pack,
        { incidents: [] },
        Object.keys(pack.characters).map((character) => ({ id: character, character })),
      );
      const sources = [];
      for (const group of ['characters', 'identities', 'plots', 'incidents'])
        for (const name of Object.keys(pack[group]))
          for (const source of catalog.sourcesFor(group, name))
            sources.push({
              group,
              name,
              timing: source.timing,
              kind: source.kind,
              ability: source.ability?.id,
            });
      for (const [name, list] of catalog.modules)
        for (const source of list)
          sources.push({
            group: 'modules',
            name,
            timing: source.timing,
            kind: source.kind,
            ability: source.ability?.id,
          });
      data.inventory.push({ module, anniversary, digest: pack.digest, sources });
    }
}
// Verify both constructors: querying only the legacy domain could hide its omissions.
for (const scenario of data.scenarios.filter((s) => s.domain && !s.initialDomainAgreement)) {
  const pack = compileOfficial(scenario.module, scenario.anniversary);
  const key = (setup) => configurationKey(pack, setup);
  const profiles = buildProfiles(pack, scenario.opening, { checks: 0, removed: 0, branches: 0 });
  const structured = new Set(
    [...configurations(pack, scenario.opening, profiles)].filter(Boolean).map(key),
  );
  const exhaustive = new Set(scenario.domain.map((entry) => key(entry.setup)));
  const missing = [...structured].filter((k) => !exhaustive.has(k));
  const extra = [...exhaustive].filter((k) => !structured.has(k));
  scenario.initialDomainAgreement = {
    structured: structured.size,
    exhaustive: exhaustive.size,
    missing,
    extra,
  };
  if (missing.length || extra.length)
    data.findings.push({ scenario: scenario.id, kind: 'initial-domain', missing, extra });
}

data.status = data.findings.length
  ? 'differences-found'
  : selected && selected !== 'all'
    ? 'partial'
    : 'complete';
data.completedAt = new Date().toISOString();
save();
console.log(
  'RESULT',
  data.status,
  data.scenarios.length,
  'scenarios',
  data.scenarios.reduce((n, s) => n + (s.nodes?.length ?? 0), 0),
  'nodes',
  data.findings.length,
  'findings',
);
if (data.status === 'complete') unlinkSync(progress);
if (data.findings.length) process.exitCode = 1;
