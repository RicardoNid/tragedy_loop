import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import {
  completeObservationGroups,
  type Choice,
  type GameSetup,
  type Observation,
  type PlayerView,
} from '../../packages/contracts/src/game.js';
import {
  advance,
  cardCount,
  initializeDiscussion,
  legalCardTargets,
} from '../../packages/engine/src/runtime/engine.js';
import { EnumeratedKnowledge, LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import { requiredAttribute } from '../../packages/engine/src/runtime/setup-rules.js';
import {
  canonical,
  type EngineState,
  type RulePack,
} from '../../packages/engine/src/runtime/model.js';

const modules = ['FS', 'BTX', 'MC', 'MZ'] as const;
const module = modules.find((m) => m === process.argv[2]);
assert.ok(module, 'usage: reverse-campaign.ts FS|BTX|MC|MZ [rounds] [seed] [exact]');
const rounds = Number(process.argv[3] ?? 2);
const base = Number(process.argv[4] ?? 20261118);
assert.ok(
  Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 1000 && Number.isSafeInteger(base),
);
assert.ok(process.argv[5] === undefined || process.argv[5] === 'exact');
const exactMode = process.argv[5] === 'exact';
let comparisons = 0,
  exactConfigurations = 0;
function compare(pack: RulePack, setup: GameSetup, opening: PlayerView, evidence: Observation[]) {
  const limited = {
    ...pack,
    plots: Object.fromEntries([setup.y, ...setup.x].map((name) => [name, pack.plots[name]!])),
  };
  const reference = new EnumeratedKnowledge(limited, opening, 10000, true);
  reference.update(evidence, evidence.length);
  const live = new LiveKnowledge(limited, opening);
  live.append(evidence, 0, evidence.length);
  live.verifyCombinations();
  function solutions(solver: LiveKnowledge | EnumeratedKnowledge) {
    const stop = performance.now() + 60000;
    while (!solver.paused && performance.now() < stop) solver.tick(20, Infinity);
    assert.equal(solver.snapshot().status, 'exact', JSON.stringify(solver.snapshot().reasons));
    return new Set(
      solver.jointSolutions()!.map((s) =>
        canonical({
          ...s,
          x: [...s.x].sort(),
          characters: s.characters.map((c) => ({
            ...c,
            initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
          })),
          incidents: s.incidents.map((i) => ({ ...i, publicName: i.publicName ?? i.name })),
        }),
      ),
    );
  }
  const expected = solutions(reference),
    actual = solutions(live);
  assert.equal(live.queryConfiguration(setup), 'possible');
  assert.equal(actual.size, expected.size, 'joint count');
  for (const key of expected) assert.ok(actual.has(key), 'missing configuration ' + key);
  comparisons++;
  exactConfigurations += actual.size;
}
function random(seed: number) {
  return (n: number) => {
    assert.ok(n > 0);
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return Math.floor((((z ^ (z >>> 14)) >>> 0) / 2 ** 32) * n);
  };
}
type Draw = ReturnType<typeof random>;
function shuffled<T>(values: readonly T[], draw: Draw) {
  const list = [...values];
  for (let i = list.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}
const roster = [
  '男学生',
  '女学生',
  '住院患者',
  '巫女',
  '大小姐',
  '从者',
  '医生',
  '职员',
  '刑警',
  '黑猫',
  '教主',
  '护士',
  '学者',
  '军人',
  '偶像',
  '媒体人',
];
const plots = new Set<string>(),
  events = new Set<string>(),
  phases = new Set<string>(),
  actors = new Set<string>(),
  failedSeeds: string[] = [];
let histories = 0,
  batches = 0,
  occurred = 0,
  absent = 0,
  crossLoop = 0,
  possible = 0,
  unknown = 0;
function makeSetup(pack: RulePack, event: string, draw: Draw): GameSetup {
  // The four-character limit makes valid samples rare for some MC and MZ plot pools.
  const maxAttempts = exactMode ? 10000 : 500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const all = shuffled(Object.values(pack.plots), draw);
    const y = all.find((p) => p.type === 'Y')!,
      xs = all.filter((p) => p.type === 'X').slice(0, pack.setupRules.xSlots);
    const x = xs.map((p) => p.name);
    const pool: Record<string, number> = {};
    for (const p of [y, ...xs])
      for (const [r, n] of Object.entries(p.identities))
        pool[r] = Math.min((pool[r] ?? 0) + n, pack.identities[r]!.max ?? Infinity);
    const roles = shuffled(
      [...Object.entries(pool).flatMap(([r, n]) => Array<string>(n).fill(r)), '平民'],
      draw,
    );
    const cards = shuffled(
      roster.filter((c) => pack.characters[c]?.supported),
      draw,
    );
    const characters: GameSetup['characters'] = [];
    for (const [i, r] of roles.entries()) {
      const k = cards.findIndex((c) => {
        const attr = requiredAttribute(pack, y.name, x, c, r);
        return !attr || pack.characters[c]!.attributes.includes(attr);
      });
      if (k < 0) break;
      const c = cards.splice(k, 1)[0]!;
      characters.push({
        id: 'c' + i,
        character: c,
        identity: r,
        initialArea: shuffled(pack.characters[c]!.initial, draw)[0]!,
      });
    }
    if (characters.length !== roles.length) continue;
    const owners = shuffled(characters, draw).filter(
      (c) => pack.identities[c.identity]?.culpritRequirement !== 'forbidden',
    );
    owners.sort(
      (a, b) =>
        Number(pack.identities[b.identity]?.culpritRequirement === 'required') -
        Number(pack.identities[a.identity]?.culpritRequirement === 'required'),
    );
    const names = [event];
    if (x.includes('灭亡讴歌') && event !== '自杀') names.push('自杀');
    while (
      names.length <
      owners.filter((c) => pack.identities[c.identity]?.culpritRequirement === 'required').length
    )
      names.push(
        shuffled(
          Object.keys(pack.incidents).filter((n) => !names.includes(n)),
          draw,
        )[0]!,
      );
    const setup: GameSetup = {
      module: pack.module,
      anniversary: pack.anniversary,
      loops: 2,
      days: Math.max(2, names.length),
      captain: 'p0',
      discussion: 'allowed',
      y: y.name,
      x,
      characters,
      incidents: names.map((name, i) => ({ day: i + 1, name, culprit: owners[i]!.id })),
      ...(pack.anniversary && {
        anniversaryFragment: characters.find((c) => c.identity === '平民')!.id,
      }),
    };
    if (exactMode && setup.characters.length > 4) continue;
    if (!validateSetup(pack, setup).length) return setup;
  }
  throw Error('no legal setup for ' + event);
}
function action(state: EngineState, draw: Draw, bias: boolean): Choice {
  const p = state.pending!;
  if (p.kind !== 'cards') {
    const options = p.options.filter(
      (c) => c.kind !== 'request-final-guess' && c.kind !== 'vote-final-guess',
    );
    return options[draw(options.length)]!;
  }
  const targets = shuffled(legalCardTargets(state, p.actor), draw);
  const cards = shuffled(
    state.cards.filter((c) => c.owner === p.actor && c.status === 'hand'),
    draw,
  );
  const owner = state.setup.incidents.find((e) => e.day === state.day)?.culprit;
  if (bias && owner && targets.includes(owner) && cards.some((c) => c.kind === 'paranoia+1')) {
    targets.unshift(...targets.splice(targets.indexOf(owner), 1));
    cards.unshift(
      ...cards.splice(
        cards.findIndex((c) => c.kind === 'paranoia+1'),
        1,
      ),
    );
  }
  return {
    kind: 'cards',
    placements: cards
      .slice(0, cardCount(state, p.actor))
      .map((c, i) => ({ card: c.id, target: targets[i]! })),
  };
}
for (const anniversary of [false, true]) {
  const pack = compileOfficial(module, anniversary);
  for (const [index, event] of Object.keys(pack.incidents).entries())
    for (let r = 0; r < rounds; r++) {
      if (exactMode && index !== r % Object.keys(pack.incidents).length) continue;
      const seed =
        (base +
          modules.indexOf(module) * 1000000 +
          Number(anniversary) * 100000 +
          index * 1000 +
          r) >>>
        0;
      let stage = 'setup';
      try {
        const draw = random(seed),
          setup = makeSetup(pack, event, draw);
        const init = initializeDiscussion(pack, setup);
        assert.ok(init.state, JSON.stringify(init.diagnostics));
        let state = init.state,
          offset = 0;
        const opening = initialPlacementView(state);
        const solver = new LiveKnowledge(pack, opening, 1);
        let compared = false;
        for (let step = 0; ; step++) {
          for (const group of completeObservationGroups(
            state.observations.protagonists.slice(offset),
          )) {
            stage = 'prefix ' + group.at(-1)!.sequence + ' ' + group[0]!.phase;
            solver.append(group, offset, offset + group.length);
            offset += group.length;
            const answer = solver.queryConfiguration(setup);
            assert.notEqual(answer, 'excluded', 'actual script excluded');
            if (answer === 'possible') possible++;
            else unknown++;
            phases.add(group[0]!.phase);
            batches++;
            if (
              exactMode &&
              !compared &&
              group.some(
                (o) =>
                  o.phase === 'captain-change' || o.phase === 'loop-end' || o.phase === 'finished',
              )
            ) {
              compare(pack, setup, opening, state.observations.protagonists.slice(0, offset));
              compared = true;
            }
            for (const o of group)
              if (o.type === 'incident') {
                if (o.data.occurred) occurred++;
                else absent++;
              }
          }
          if (state.winner || state.pending?.kind === 'guess') break;
          assert.ok(step < 400 && state.pending);
          stage = 'play ' + step + ' ' + state.phase;
          const p = state.pending,
            choice = action(state, draw, r % 2 === 1);
          const result = advance(pack, state, p.actor, {
            id: 'audit-' + step,
            expectedRevision: state.revision,
            decisionId: p.id,
            choice,
          });
          assert.equal(result.status, 'ok', JSON.stringify({ choice, reason: result.reason }));
          state = result.state;
        }
        if (exactMode) assert.ok(compared);
        histories++;
        if (state.loop > 1) crossLoop++;
        [setup.y, ...setup.x].forEach((v) => plots.add(v));
        events.add(event);
        setup.characters.forEach((c) => actors.add(c.character));
      } catch (e) {
        const msg = [module, anniversary, event, seed, stage, (e as Error).message].join(' | ');
        failedSeeds.push(msg);
        console.error(msg);
      }
    }
}
console.log(
  JSON.stringify({
    module,
    rounds,
    base,
    histories,
    comparisons,
    exactConfigurations,
    batches,
    possible,
    unknown,
    crossLoop,
    occurred,
    absent,
    plots: [...plots].sort(),
    events: events.size,
    characters: actors.size,
    phases: phases.size,
    failures: failedSeeds.length,
  }),
);
if (failedSeeds.length) process.exitCode = 1;
