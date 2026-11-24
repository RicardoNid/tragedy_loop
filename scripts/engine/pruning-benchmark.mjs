import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { officialModules, supportsAnniversary } from '../../packages/contracts/src/game.ts';
import { compileOfficial } from '../../packages/content/src/official/compile.ts';
import { absenceProgramIndex } from '../../packages/engine/src/absence/programs.ts';
import { verifyAbsencePhase } from '../../packages/engine/src/absence/phase-search.ts';
import { advance, drive } from '../../packages/engine/src/runtime/engine.ts';
import {
  PruningCatalog,
  necessaryConditions,
  gateLabels,
  requiresGoodwillDeclaration,
} from '../../packages/engine/src/runtime/knowledge-pruning.ts';
import { COUNTERS, canonical, clone } from '../../packages/engine/src/runtime/model.ts';
import { routes } from '../../packages/engine/src/runtime/knowledge-routes.ts';
import { programWindow } from '../../tests/engine/program-window.ts';
import { character, lab } from '../../tests/comprehensive/harness.ts';
import { render } from './pruning-benchmark-page.mjs';
import { quotaCase, quotaCombinations } from './pruning-benchmark-quota.mjs';
import { jointCases } from './pruning-benchmark-history.mjs';
import { goodwillPolicy, rulePolicies } from './compiled-pruning.mjs';
import { cardCases } from './pruning-benchmark-cards.mjs';

const clock = ({ loop, day, phase }) => ({ loop, day, phase });
const blank = () => ({
  queries: 0,
  exhaustive: 0,
  previous: 0,
  pruned: 0,
  possible: 0,
  excluded: 0,
});

// Collect every terminal outcome without consulting the evidence or stopping at a witness.
// Each edge is one drive(1) or one advance(..., 0), exactly as in verifyAbsencePhase.
function enumerate(pack, root) {
  let work = 0;
  let branchPoints = 0;
  const leaves = [],
    cursor = root.observations.public.length;
  function visit(state, parentCursor) {
    assert.ok(work < 250000, '未穷尽阶段 ' + JSON.stringify(clock(root)));
    const reports = state.observations.public.slice(cursor);
    const end = reports.findIndex(
      (o) => o.type === 'boundary' && canonical(clock(o)) !== canonical(clock(root)),
    );
    const node = {
      reports: state.observations.public.slice(parentCursor, end < 0 ? undefined : cursor + end),
      children: [],
    };
    if (end >= 0) {
      node.end = clock(reports[end]);
      leaves.push({ end: clock(reports[end]), reports: reports.slice(0, end) });
      return node;
    }
    if (state.winner) return node;
    const nextCursor = state.observations.public.length;
    assert.ok(!state.diagnostic, JSON.stringify(state.diagnostic));
    if (!state.pending) {
      work++;
      drive(pack, state, 1);
      node.children.push(visit(state, nextCursor));
      return node;
    }
    const decision = state.pending;
    if (decision.options.length > 1) branchPoints++;
    assert.ok(!['cards', 'guess'].includes(decision.kind), '基准仅接受可列尽的阶段决策');
    for (const choice of decision.options) {
      work++;
      const next = advance(
        pack,
        state,
        decision.actor,
        {
          id: 'baseline-' + state.revision,
          decisionId: decision.id,
          expectedRevision: state.revision,
          choice,
        },
        0,
      );
      assert.notEqual(next.status, 'rejected', JSON.stringify(choice));
      node.children.push(visit(next.state, nextCursor));
    }
    return node;
  }
  const first = visit(clone(root), cursor);
  assert.ok(leaves.length, '至少一条路径到达阶段边界');
  return { work, leaves, first, branchPoints };
}

function compare(pack, root, tree, end, absent, stats, label) {
  const conflict = (o) =>
    absent.some(
      (p) =>
        p.type === o.type &&
        Object.entries(p.fields ?? {}).every(
          ([k, v]) => Object.hasOwn(o.data, k) && canonical(o.data[k]) === canonical(v),
        ),
    );
  const expected = tree.leaves.some(
    (leaf) => canonical(leaf.end) === canonical(end) && !leaf.reports.some(conflict),
  );
  // Previous DFS stopped on published conflicts or an actual closing boundary.
  // Every visited edge corresponds to one recorded drive(1) or advance(..., 0).
  let previous = 0;
  function visit(node) {
    if (node.reports.some(conflict)) return false;
    if (node.end) return canonical(node.end) === canonical(end);
    return node.children.some((child) => {
      previous++;
      return visit(child);
    });
  }
  assert.equal(visit(tree.first), expected, label);
  const result = verifyAbsencePhase(
    pack,
    root,
    { start: clock(root), end, coverage: 'complete', absent },
    tree.work + 1,
  );
  assert.equal(
    result.status,
    expected ? 'possible' : 'excluded',
    label + ' ' + JSON.stringify({ absent, result }),
  );
  stats.queries++;
  stats.exhaustive += tree.work;
  stats.previous += previous;
  assert.ok(result.work <= previous, label + ' 搜索展开超过原策略');
  if (result.work * 10 >= tree.work * 9 && tree.work)
    stats.lowQueries = (stats.lowQueries ?? 0) + 1;
  if (
    !stats.worst ||
    result.work * stats.worst.exhaustive > stats.worst.pruned * tree.work ||
    (result.work * stats.worst.exhaustive === stats.worst.pruned * tree.work &&
      tree.work > stats.worst.exhaustive)
  )
    stats.worst = {
      end,
      absent,
      status: result.status,
      exhaustive: tree.work,
      previous,
      pruned: result.work,
      choices: result.choices,
    };
  stats.pruned += result.work;
  stats[result.status]++;
  return expected;
}

function measureWindow(pack, root, label, extended = false) {
  const tree = enumerate(pack, root);
  const leaf = tree.leaves[0],
    stats = blank();
  // Test one compatible absence and every distinct event type observed on any branch.
  const types = new Set(tree.leaves.flatMap((l) => l.reports.map((o) => o.type)));
  const probes = [...types].map((type) => [{ type }]);
  probes.push(
    ['character', 'board', 'failure', 'rule', 'identity', 'incident', 'declaration']
      .filter((t) => !leaf.reports.some((o) => o.type === t))
      .map((type) => ({ type })),
  );
  if (extended) {
    const events = tree.leaves.flatMap((l) => l.reports);
    const patterns = new Map(
      events.map((o) => [canonical([o.type, o.data]), { type: o.type, fields: o.data }]),
    );
    probes.push(...[...patterns.values()].map((p) => [p]));
  }
  for (const absent of probes) compare(pack, root, tree, leaf.end, absent, stats, label);
  if (extended) {
    const ends = new Map(tree.leaves.map((l) => [canonical(l.end), l.end]));
    const early = { loop: root.loop, day: root.day, phase: 'loop-end' };
    ends.set(canonical(early), early);
    for (const end of ends.values()) compare(pack, root, tree, end, [], stats, label);
  }
  return { paths: tree.leaves.length, branchPoints: tree.branchPoints, ...stats };
}

function measureProgram(pack, p) {
  const windows = ['原盘面', '同区有守护', '异区有死者'].map((variant, i) => {
    const root = programWindow(pack.module, pack.anniversary, p);
    if (i === 1) {
      root.characters.b.area = root.characters.a.area;
      root.characters.b.counters.guard = 1;
      root.characters.a.counters.goodwill = 3;
      root.boards.school = 2;
    } else if (i === 2) {
      root.characters.b.status = 'dead';
      root.characters.c.area = root.characters.a.area === 'city' ? 'hospital' : 'city';
      root.characters.c.counters.paranoia = 3;
      root.ex = 1;
    }
    return { variant, ...measureWindow(pack, root, p.owner + '/' + p.id + '/' + variant, i !== 0) };
  });
  return windowTotals(windows);
}
function windowTotals(windows) {
  const totals = blank();
  for (const w of windows) for (const key of Object.keys(totals)) totals[key] += w[key];
  return {
    windows,
    lowQueries: windows.reduce((n, w) => n + (w.lowQueries ?? 0), 0),
    paths: windows.reduce((n, w) => n + w.paths, 0),
    ...totals,
  };
}
function passiveWindow(pack, group, name) {
  const l = lab(pack.module, pack.anniversary),
    root = l.state;
  character(
    l,
    'a',
    group === 'characters' ? name : '男学生',
    group === 'identities' ? name : '平民',
    group === 'characters' ? undefined : 'school',
  );
  root.phase = 'day-end';
  root.pending = null;
  root.phaseEntered = false;
  root.delayed = [
    {
      loop: root.loop,
      day: root.day,
      timing: 'day-end',
      effects: [{ op: 'kill', target: 'a' }],
      env: {},
    },
  ];
  return windowTotals(
    [0, 1, 2].map((guard) => {
      root.characters.a.counters.guard = guard;
      return { variant: '本人守护 ' + guard, ...measureWindow(pack, root, name, guard > 0) };
    }),
  );
}

const tableNames = {
  characters: 'cards',
  identities: 'identities',
  plots: 'rules',
  incidents: 'events',
  modules: 'modules',
};
const kinds = {
  characters: 'character',
  identities: 'identity',
  plots: 'plot',
  incidents: 'incident',
  modules: 'module',
};
const phases = [
  'briefing',
  'discussion',
  'loop-start',
  'day-start',
  'mastermind-cards',
  'protagonist-cards',
  'card-resolution',
  'mastermind-abilities',
  'protagonist-abilities',
  'incident',
  'captain-change',
  'day-end',
  'loop-end',
  'final-guess',
  'finished',
];
const changes = ['move', 'kill', 'revive', 'remove', 'failure', 'protagonist-death']
  .map((kind) => ({ kind, target: 'a' }))
  .concat(
    COUNTERS.flatMap((counter) =>
      [-1, 1].map((sign) => ({ kind: 'counter', counter, sign, target: 'a' })),
    ),
  );

// Independent scan of the published source signatures; compare object identities including multiplicity.
function accepts(s, phase, q) {
  if ((s.timing !== '*' && s.timing !== phase) || (s.kind && s.kind !== q.kind)) return false;
  if (q.kind !== 'counter') return true;
  if (s.sign !== undefined && s.sign !== q.sign) return false;
  if (!s.counter) return true;
  if (!s.counter.startsWith('$')) return s.counter === q.counter;
  const options = s.choices.get(s.counter.slice(1));
  return (
    !Array.isArray(options) || options.includes(q.counter) || options.some((v) => v.startsWith('$'))
  );
}
function signature(source) {
  const { ability, choices, ...fields } = source;
  return {
    ...fields,
    ability: ability?.id,
    threshold: ability?.threshold,
    loopLimit: ability?.loopLimit,
    choices: Object.fromEntries(choices),
    gates: necessaryConditions(source),
    directDeclaration: requiresGoodwillDeclaration(source),
  };
}
function measurePack(module, anniversary) {
  const pack = compileOfficial(module, anniversary);
  const catalog = new PruningCatalog(
    pack,
    { incidents: Object.keys(pack.incidents).map((name, i) => ({ name, day: i + 1 })) },
    Object.keys(pack.characters).map((character) => ({ id: character, character })),
  );
  const { programs } = absenceProgramIndex(pack);
  const queries = phases.flatMap((phase) =>
    changes.map((change) => {
      const before = { ...catalog.lookupWork };
      const index = catalog.forChange(phase, change);
      return {
        phase,
        change,
        index,
        visits:
          catalog.lookupWork.timingChecks -
          before.timingChecks +
          catalog.lookupWork.candidateChecks -
          before.candidateChecks,
      };
    }),
  );
  const cold = { ...catalog.lookupWork };
  for (const q of queries) assert.equal(catalog.forChange(q.phase, q.change), q.index);
  assert.equal(catalog.lookupWork.timingChecks, cold.timingChecks);
  assert.equal(catalog.lookupWork.candidateChecks, cold.candidateChecks);
  const rules = [];
  for (const [group, table] of Object.entries(tableNames)) {
    const names =
      group === 'modules'
        ? [...new Set(pack.moduleAbilities.map((a) => a.owner))]
        : Object.keys(pack[group]);
    for (const name of names) {
      const sources = catalog.sourcesFor(group, name);
      let scanned = 0,
        selected = 0;
      for (const { phase, change, index } of queries) {
        const expected = sources.filter(
          (s) =>
            accepts(s, phase, change) &&
            (catalog
              .outputsFor(s)
              ?.some((child) => accepts(child, child.invocation ? child.timing : phase, change)) ??
              true),
        );
        const actual = index[table].get(name) ?? [];
        assert.ok(
          actual.length === expected.length && actual.every((s, i) => s === expected[i]),
          JSON.stringify({ module, group, name, phase, change }),
        );
        scanned += sources.length;
        selected += actual.length;
      }
      const measured = programs
        .filter((p) => p.kind === kinds[group] && p.owner === name)
        .map((p) => ({
          id: p.id,
          activation: p.activation,
          timing: p.timing,
          effects: p.effects,
          goodwillLogic:
            p.ability.threshold !== undefined && p.timing === 'protagonist-abilities'
              ? goodwillPolicy(p.ability)
              : undefined,
          ...measureProgram(pack, p),
        }));
      const definition =
        group === 'modules'
          ? pack.moduleAbilities.filter((m) => m.owner === name).map((m) => m.ability)
          : pack[group][name];
      const quota = group === 'plots' ? quotaCase(pack, [definition]) : undefined;
      const quotaFour = group === 'plots' ? quotaCase(pack, [definition], 4) : undefined;
      const passive =
        !measured.length && ['identities', 'characters'].includes(group)
          ? passiveWindow(pack, group, name)
          : undefined;
      assert.ok(measured.length || quota || passive, name);
      rules.push({
        group,
        name,
        definition,
        policies: group === 'modules' ? [] : rulePolicies(group, definition, pack),
        sources: sources.map((s) => ({
          ...signature(s),
          indirect: catalog.outputsFor(s)?.map(signature),
        })),
        scanned,
        selected,
        programs: measured,
        quota,
        quotaFour,
        passive,
      });
    }
  }
  assert.equal(rules.flatMap((r) => r.programs).length, programs.length);
  console.log(module, anniversary, rules.length, programs.length);
  return {
    module,
    anniversary,
    digest: pack.digest,
    setup: pack.setupRules,
    lookup: {
      ...catalog.lookupWork,
      firstVisit: queries.find((q) => q.phase === 'mastermind-abilities').visits,
      sourceCount: rules.reduce((sum, r) => sum + r.sources.length, 0),
    },
    rules,
    combinations: quotaCombinations(pack),
  };
}

function compound() {
  const roles = ['平民', '杀人狂', '时间旅者', '关键人物'];
  return ['两人同区', '两人异区', '第三人同区'].flatMap((layout) =>
    [0, 1, 2].flatMap((guard) =>
      ['无人死亡', '无人失败', '无人死亡且无人失败'].map((label) => {
        const stats = blank(),
          kept = [];
        for (const A of roles)
          for (const B of roles) {
            const l = lab(),
              root = l.state;
            character(l, 'a', '男学生', A, 'school');
            character(
              l,
              'b',
              '女学生',
              B,
              layout === '两人异区' ? 'shrine' : 'school',
            ).counters.guard = guard;
            if (layout === '第三人同区') root.characters.c.area = 'school';
            root.phase = 'day-end';
            root.phaseEntered = false;
            root.pending = null;
            const tree = enumerate(l.pack, root);
            const absent = [];
            if (label.includes('无人死亡'))
              absent.push({ type: 'character', fields: { status: 'dead' } });
            if (label.includes('无人失败')) absent.push({ type: 'failure' });
            if (
              compare(
                l.pack,
                root,
                tree,
                { phase: 'day-start', day: 2, loop: 1 },
                absent,
                stats,
                label,
              )
            )
              kept.push([A, B]);
          }
        return { layout, guard, label, roles, kept, ...stats };
      }),
    ),
  );
}

const packs = officialModules.flatMap((m) =>
  (supportsAnniversary(m) ? [false, true] : [false]).map((a) => measurePack(m, a)),
);
const data = {
  schemaVersion: 2,
  units: {
    sources: '候选来源数',
    quota: '非单值选择的赋值分支',
    phase: '单步推进或选择提交',
    history: '历史决策展开',
  },
  phases,
  changes,
  gateLabels,
  routes,
  packs,
  compound: compound(),
  history: jointCases(),
  cards: cardCases(measureWindow),
};
writeFileSync(
  new URL('../../products/engine/pruning-benchmark.html', import.meta.url),
  render(data),
);
