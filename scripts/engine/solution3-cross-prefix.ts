import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { admits } from './solution3-offline-sat.js';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project, initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge-live.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import { choose, generator } from '../comprehensive/random-choices.js';

// Offline FS production table for ordinary three-seat casts.
const threeSeats = [
  ['复仇的火种', '流言四起', '主谋', '传谣人', '平民'],
  ['复仇的火种', '开膛者的魔影', '主谋', '传谣人', '杀人狂'],
  ['复仇的火种', '最黑暗的剧本', '主谋', '传谣人', '亲友'],
  ['守护此地', '流言四起', '关键人物', '邪教徒', '传谣人'],
] as const;
const selectedModule = process.argv.find((a) => a.startsWith('--module='))?.slice(9) ?? 'FS';
assert(
  selectedModule === 'FS' ||
    selectedModule === 'BTX' ||
    selectedModule === 'HSA' ||
    selectedModule === 'MC',
);
const pack = compileOfficial(selectedModule);
// Printed two-seat profiles; the solver must also enforce all character restrictions itself.
const twoSeats: { y: string; x: string[]; roles: [string, string] }[] = [];
if (selectedModule === 'BTX') {
  for (const [y, required] of [
    ['和我签订契约吧！', '关键人物'],
    ['巨大定时炸弹X', '魔女'],
  ] as const)
    for (const [a, b, other] of [
      ['流言四起', '妄想扩大病毒', '传谣人'],
      ['流言四起', '因果线', '传谣人'],
      ['妄想扩大病毒', '因果线', '传谣人'],
      ['因果线', '未知因子Χ', '不安定因子'],
    ] as const)
      twoSeats.push({ y, x: [a, b], roles: [required, other] });
}
if (selectedModule === 'HSA')
  for (const [a, r] of [
    ['魔女遗咒', '魔女'],
    ['少女大危机', '关键人物'],
  ] as const)
    twoSeats.push({ y: '古墓活尸', x: [a, '怪物们的阴谋'], roles: [r, '传谣人'] });

const collect = process.argv.includes('--collect');
const retryFile = process.argv
  .find((a) => a.startsWith('--retry-limited='))
  ?.slice('--retry-limited='.length);
let retry: Set<string> | undefined;
if (retryFile) {
  const data = readFileSync(retryFile);
  const input = (retryFile.endsWith('.gz') ? gunzipSync(data) : data).toString('utf8').trim();
  retry = new Set(
    input
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((r) => r.status1 !== 'exact')
      .map((r) => r.eventName + '/' + r.seed),
  );
}
const firstSeed = Number(process.argv[2] ?? 1);
const count = Number(process.argv[4] ?? 1);
assert([firstSeed, count].every((n) => Number.isSafeInteger(n) && n > 0));
const events =
  process.argv[3] === 'all' ? Object.keys(pack.incidents) : [process.argv[3] ?? '自杀'];
for (const eventName of events) {
  assert(eventName in pack.incidents);
  for (let requested = firstSeed; requested < firstSeed + count; requested++) {
    if (retry && !retry.has(eventName + '/' + requested)) continue;
    const setup: GameSetup = {
      module: selectedModule,
      anniversary: false,
      loops: 1,
      days: 1,
      captain: 'p0',
      discussion: 'between-loops',
      y: '复仇的火种',
      x: ['流言四起'],
      characters: [
        { id: 'a', character: '男学生', identity: '主谋' },
        { id: 'b', character: '女学生', identity: '传谣人' },
      ],
      incidents: [{ day: 1, name: eventName, culprit: 'b' }],
    };
    const seats = Number(process.argv[5] ?? 2);
    assert(seats === 2 || seats === 3);
    if (seats === 3) setup.characters.push({ id: 'c', character: '巫女', identity: '平民' });
    const crowds = pack.incidents[eventName]!.crowdThreshold !== undefined;
    if (selectedModule === 'MC') {
      assert.equal(seats, 3);
      setup.y = '黑暗学园';
      setup.x = ['火药的味道', '绝对意志'];
      setup.characters[0]!.identity = '主谋';
      setup.characters[1]!.identity = '杀人狂';
      setup.characters[2]!.identity = '强迫症';
      setup.incidents[0]!.culprit = 'c';
    } else if (selectedModule !== 'FS') {
      assert.equal(seats, 2);
      const fixture = twoSeats.find((p) => p.roles.includes('魔女'))!;
      setup.y = fixture.y;
      setup.x = fixture.x;
      setup.characters.forEach((c, i) => (c.identity = fixture.roles[i]!));
      if (crowds) setup.incidents[0]!.culprit = 'school';
    }
    const rng = generator(requested);
    let state = initializeDiscussion(pack, setup).state!;
    const opening = initialPlacementView(state),
      one = new LiveKnowledge(pack, opening, 3000),
      three = new SolutionSpace3(opening);
    for (let step = 0; state.pending && state.phase !== 'finished'; step++) {
      const d = state.pending;
      const next = advance(pack, state, d.actor, {
        id: 'prefix-' + step,
        expectedRevision: state.revision,
        decisionId: d.id,
        choice: choose(state, rng),
      });
      assert.notEqual(next.status, 'rejected');
      state = next.state;
      const view = project(state, 'protagonists');
      if (view.observations.length === three.through) continue;
      let t = performance.now();
      three.append(view.observations.slice(three.through), view.characters);
      const ms3 = performance.now() - t,
        g = three.model.graph;
      assert(!three.conflict, three.conflict);
      t = performance.now();
      one.update(view.observations, view.revision);
      one.verifyCombinations();
      for (
        let slice = 0;
        slice < (retry ? 1000 : 25) && one.snapshot().status === 'running';
        slice++
      )
        one.tick(20);
      const s = one.snapshot(),
        ms1 = performance.now() - t;
      const differences: string[] = [];
      // Solver 1 fixes the cast from its input. Solver 3 also keeps unobserved
      // delayed entrants until every legal entry window has passed.
      const sameCast = [...three.model.absent.values()].every((a) => g.truth(a) === true);
      for (const c of setup.characters) {
        const a = Object.keys(three.model.ids.get(c.character)!)
          .filter((n) => g.truth(three.model.ids.get(c.character)![n]!) !== false)
          .sort();
        assert(a.includes(c.identity), '求解器3排除真实身份');
        const b = [...(s.identities[c.id] ?? [])].sort();
        if (a.join() !== b.join())
          differences.push(c.character + ': ' + a.join('/') + ' vs ' + b.join('/'));
      }
      const row = three.model.culprits.get(1)!;
      const actors = setup.characters
        .filter((c) => g.truth(row[c.character]!) !== false)
        .map((c) => c.id)
        .sort();
      if (crowds)
        actors.push(
          ...['city', 'shrine', 'school', 'hospital'].filter((b) => g.truth(row[b]!) !== false),
        );
      actors.sort();
      const other = (s.culprits?.['1'] ?? []).slice().sort();
      if (actors.join() !== other.join())
        differences.push('当事人 ' + actors.join('/') + ' vs ' + other.join('/'));
      const plots = Object.keys(three.model.plots)
        .filter((n) => g.truth(three.model.plots[n]!) !== false)
        .sort();
      if (plots.join() !== s.rules.slice().sort().join())
        differences.push('规则 ' + plots.join('/') + ' vs ' + s.rules.join('/'));
      const pairs3: string[] = [];
      const pairs1 = one
        .jointSolutions()
        ?.map((w) =>
          selectedModule !== 'FS'
            ? JSON.stringify([
                w.y,
                ...w.x.slice().sort(),
                ...setup.characters.map((c) => w.characters.find((d) => d.id === c.id)!.identity),
                w.incidents[0]!.culprit,
              ])
            : seats === 2
              ? JSON.stringify([
                  w.characters.find((c) => c.identity === '主谋')!.id,
                  w.incidents[0]!.culprit,
                ])
              : JSON.stringify([
                  w.y,
                  w.x[0],
                  ...setup.characters.map((c) => w.characters.find((d) => c.id === d.id)!.identity),
                  w.incidents[0]!.culprit,
                ]),
        )
        .sort();
      if (selectedModule === 'MC') {
        // The printed minimum is one Y role plus two X roles. Only this plot triple fits three ordinary seats.
        for (const first of ['主谋', '杀人狂', '强迫症'])
          for (const second of ['主谋', '杀人狂', '强迫症'].filter((r) => r !== first)) {
            const third = ['主谋', '杀人狂', '强迫症'].find((r) => r !== first && r !== second)!;
            const assignment = [first, second, third];
            const fixed = [
              three.model.plots['黑暗学园']!,
              three.model.plots['火药的味道']!,
              three.model.plots['绝对意志']!,
              ...setup.characters.map((c, i) => three.model.ids.get(c.character)![assignment[i]!]!),
            ];
            for (const target of setup.characters)
              if (admits(g, [...fixed, row[target.character]!]))
                pairs3.push(
                  JSON.stringify([
                    '黑暗学园',
                    ...['火药的味道', '绝对意志'].sort(),
                    ...assignment,
                    target.id,
                  ]),
                );
          }
      } else if (selectedModule !== 'FS') {
        const targets = crowds
          ? ['city', 'shrine', 'school', 'hospital'].map((name) => ({ id: name, name }))
          : setup.characters.map((c) => ({ id: c.id, name: c.character }));
        for (const profile of twoSeats)
          for (const assignment of [profile.roles, profile.roles.slice().reverse()]) {
            const fixed = [
              three.model.plots[profile.y]!,
              ...profile.x.map((x) => three.model.plots[x]!),
              ...setup.characters.map((c, i) => three.model.ids.get(c.character)![assignment[i]!]!),
            ];
            for (const target of targets)
              if (admits(g, [...fixed, row[target.name]!]))
                pairs3.push(
                  JSON.stringify([
                    profile.y,
                    ...profile.x.slice().sort(),
                    ...assignment,
                    target.id,
                  ]),
                );
          }
      } else if (seats === 2) {
        for (const mastermind of setup.characters)
          for (const culprit of setup.characters)
            if (
              admits(g, [
                three.model.ids.get(mastermind.character)!['主谋']!,
                row[culprit.character]!,
              ])
            )
              pairs3.push(JSON.stringify([mastermind.id, culprit.id]));
      } else {
        for (const [y, x, ...roles] of threeSeats)
          for (const first of roles)
            for (const second of roles.filter((r) => r !== first)) {
              const third = roles.find((r) => r !== first && r !== second)!;
              const assignment = [first, second, third];
              const constraints = [
                three.model.plots[y]!,
                three.model.plots[x]!,
                ...setup.characters.map(
                  (c, i) => three.model.ids.get(c.character)![assignment[i]!]!,
                ),
              ];
              for (const culprit of setup.characters)
                if (admits(g, [...constraints, row[culprit.character]!]))
                  pairs3.push(JSON.stringify([y, x, ...assignment, culprit.id]));
            }
      }
      const joint3 = pairs3.length;
      if (pairs1 && pairs1.join() !== pairs3.sort().join())
        differences.push(
          '可行的完整制作组合 ' + JSON.stringify(pairs3) + ' vs ' + JSON.stringify(pairs1),
        );
      if (s.status === 'exact' && s.jointCount !== joint3)
        differences.push('联合配置 ' + joint3 + ' vs ' + s.jointCount);
      const real = Object.keys(three.model.events.get(1)!)
        .filter((n) => g.truth(three.model.events.get(1)![n]!) !== false)
        .sort();
      if (real.join() !== (s.realIncidents?.['1'] ?? []).slice().sort().join())
        differences.push('真实事件 ' + real.join('/'));
      const result: Record<string, unknown> = {
        seed: requested,
        eventName,
        seats,
        module: selectedModule,
        through: three.through,
        phase: state.phase,
        status1: s.status,
        sameCast,
        differences,
        allPairsVerified: Boolean(pairs1),
        joint1: s.jointCount,
        joint3,
        ms1,
        ms3,
        generated1: s.generated,
        expanded1: s.expansions,
        sourceBranches1: s.propagation?.causeBranches,
        historyComparisons1: s.propagation?.historyComparisons,
        sources3: g.work.sources.length,
        local3: g.work.combinations,
        configurations3: g.work.configurations,
      };
      console.log(JSON.stringify(result));
      if (
        s.status === 'exact' &&
        differences.length &&
        (sameCast ||
          differences.some((d) => d.startsWith('可行的完整制作组合') || d.startsWith('联合配置')))
      ) {
        if (collect) {
          console.error(
            JSON.stringify({
              seed: requested,
              eventName,
              phase: state.phase,
              through: three.through,
              differences,
              observations: view.observations.slice(-14),
            }),
          );
          process.exitCode = 1;
          break;
        }
        console.error(JSON.stringify(view.observations.slice(-14)));
        assert.deepEqual(differences, [], JSON.stringify(result));
      }
    }
  }
}
