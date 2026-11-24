import test from 'node:test';
import assert from 'node:assert/strict';
import type { Choice, GameSetup, Observation } from '../../packages/contracts/src/game.js';
import { officialModules, supportsAnniversary } from '../../packages/contracts/src/game.js';
import { fixtures, officialScenarioSetup } from './official-harness.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { generateDomain, LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { enumerateChoices } from '../../packages/engine/src/runtime/replay.js';
import {
  advance,
  cardCount,
  initializeDiscussion,
  legalCardTargets,
} from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import { validateSetup } from '../../packages/engine/src/runtime/setup.js';
import {
  PruningCatalog,
  necessaryConditions,
  rejectedCondition,
} from '../../packages/engine/src/runtime/knowledge-pruning.js';
import { zeroCounters, type EngineState } from '../../packages/engine/src/runtime/model.js';
import {
  buildProfiles,
  configurations,
} from '../../packages/engine/src/runtime/knowledge-domain.js';
import { partnerPairs } from '../../packages/engine/src/runtime/knowledge-traits.js';

const config: GameSetup = {
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

function checkPrefix(solver: LiveKnowledge, setup: GameSetup, o: Observation, scenario: string) {
  solver.append([o], o.sequence - 1, o.sequence);
  const view = solver.snapshot();
  const context = scenario + ' observation ' + o.sequence + ' (' + o.phase + '/' + o.type + ')';
  const through = o.simultaneousGroup !== undefined && o.sequence + 1 < o.simultaneousGroup + o.simultaneousSize!
    ? o.simultaneousGroup - 1 : o.sequence;
  assert.equal(view.evidenceThrough, through, context);
  assert.notEqual(view.status, 'contradiction', context);
  for (const c of setup.characters) {
    const identity = setup.anniversaryFragment === c.id ? '因果残片' : c.identity;
    assert.ok(view.identities[c.id]?.includes(identity), context + ' ' + c.id + '/' + identity);
  }
  for (const event of setup.incidents)
    assert.ok(view.culprits[event.day]?.includes(event.culprit), context + ' day ' + event.day);
  assert.ok(
    view.ruleCombinations?.some(
      ({ y, x }) =>
        y === setup.y && x.length === setup.x.length && setup.x.every((rule) => x.includes(rule)),
    ),
    context,
  );
}

test('structured solver counts legal openings and retains the actual script through every public prefix', () => {
  for (const module of ['FS', 'BTX'] as const) {
    const setup: GameSetup =
      module === 'FS'
        ? config
        : {
            ...config,
            module,
            y: '被封印的邪灵',
            x: ['流言四起', '因果线'],
            characters: [...config.characters, { id: 'c', character: '职员', identity: '邪教徒' }],
          };
    const pack = compileOfficial(module);
    const opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
    const solver = new LiveKnowledge(pack, opening);
    const legalOpenings = [...generateDomain(pack, opening)].filter(Boolean).length;
    assert.ok(legalOpenings > 0);
    solver.verifyCombinations();
    for (let i = 0; !solver.paused && i < 10000; i++) solver.tick(30, 100000);
    assert.equal(solver.snapshot().status, 'exact');
    assert.equal(solver.snapshot().jointCount, legalOpenings);
    let replay = initializeDiscussion(pack, setup).state!;
    for (let i = 0; i < 30 && !replay.winner; i++) {
      const decision = replay.pending!;
      const choice =
        decision.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
        enumerateChoices(replay).next().value;
      assert.ok(choice);
      const r = advance(pack, replay, decision.actor, {
        id: 'prefix-' + i,
        decisionId: decision.id,
        expectedRevision: replay.revision,
        choice,
      });
      assert.equal(r.status, 'ok');
      replay = r.state;
      if (replay.day > 1) break;
    }
    const observations = replay.observations.protagonists;
    assert.ok(observations.length > 15);
    for (const o of observations) checkPrefix(solver, setup, o, module);
    assert.equal(solver.queryConfiguration(setup), 'possible', module);
  }
});

function playSeededChoice(state: EngineState, randomIndex: (length: number) => number): Choice {
  const decision = state.pending!;
  if (decision.kind !== 'cards') {
    const options = decision.options.filter(
      (c) => c.kind !== 'request-final-guess' && c.kind !== 'vote-final-guess',
    );
    const choice =
      options.find((c) => c.kind === 'continue') ?? options[randomIndex(options.length)];
    assert.ok(choice);
    return choice;
  }
  const hand = state.cards.filter((c) => c.owner === decision.actor && c.status === 'hand');
  const targets = legalCardTargets(state, decision.actor);
  const placements = [];
  for (let i = 0; i < cardCount(state, decision.actor); i++) {
    const card = hand.splice(randomIndex(hand.length), 1)[0]!;
    const target = targets.splice(randomIndex(targets.length), 1)[0]!;
    placements.push({ card: card.id, target });
  }
  return { kind: 'cards', placements };
}

for (const module of ['FS', 'BTX'] as const)
  for (const anniversary of [false, true]) {
    test(
      module +
        (anniversary ? ' anniversary' : '') +
        ': seeded card histories retain the real roles, plots and culprit',
      () => {
        const pack = compileOfficial(module, anniversary);
        const fs = module === 'FS';
        const setup: GameSetup = {
          ...config,
          module,
          anniversary,
          y: fs ? '守护此地' : '改变未来',
          x: fs ? ['流言四起'] : ['流言四起', '因果线'],
          characters: [
            { id: 'a', character: '医生', identity: fs ? '关键人物' : '邪教徒' },
            { id: 'b', character: '住院患者', identity: fs ? '邪教徒' : '时间旅者' },
            { id: 'c', character: '从者', identity: '传谣人', initialArea: 'school' },
            { id: 'd', character: '大小姐', identity: '平民' },
          ],
          incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
          ...(anniversary && { anniversaryFragment: 'd' }),
        };
        for (let seed = 1; seed <= 6; seed++) {
          let random = seed;
          const randomIndex = (length: number) => {
            random = (Math.imul(1664525, random) + 1013904223) >>> 0;
            return Math.floor((random / 2 ** 32) * length);
          };
          const start = initializeDiscussion(pack, setup);
          assert.ok(start.state, JSON.stringify(start.diagnostics));
          let state = start.state;
          const solver = new LiveKnowledge(pack, initialPlacementView(state));
          const label = module + ' anniversary=' + anniversary + ' seed=' + seed;
          let turns = 0;
          while (true) {
            for (const o of state.observations.protagonists.slice(solver.observationCount))
              checkPrefix(solver, setup, o, label);
            if (state.winner || state.pending?.kind === 'guess') break;
            assert.ok(state.pending && turns < 100, label);
            const result = advance(pack, state, state.pending.actor, {
              id: 'seed-' + turns++,
              expectedRevision: state.revision,
              decisionId: state.pending.id,
              choice: playSeededChoice(state, randomIndex),
            });
            assert.equal(result.status, 'ok', label);
            state = result.state;
          }
          assert.ok(
            state.observations.protagonists.some(
              (o) => o.type === 'cards' && o.phase === 'card-resolution',
            ),
            label,
          );
        }
      },
    );
  }

for (const module of officialModules.filter((m) => m !== 'FS' && m !== 'BTX')) {
  for (const anniversary of supportsAnniversary(module) ? [false, true] : [false]) {
    test(module + (anniversary ? '+' : '') + ' public observations retain the real script', () => {
      const setup = officialScenarioSetup(module, anniversary);
      const pack = compileOfficial(module, anniversary);
      const start = initializeDiscussion(pack, setup);
      assert.ok(start.state, JSON.stringify(start.diagnostics));
      let state = start.state;
      const opening = initialPlacementView(state);
      // This case supplies the full roster as public input; late arrival timing remains hidden.
      opening.roster = setup.characters.map(({ id, character }) => ({ id, character }));
      let seed = 1;
      for (let n = 0; !state.winner && state.pending?.kind !== 'guess'; n++) {
        assert.ok(n < 1500 && state.pending);
        const result = advance(pack, state, state.pending.actor, {
          id: 'official-' + n,
          expectedRevision: state.revision,
          decisionId: state.pending.id,
          choice: playSeededChoice(state, (length) => {
            seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
            return Math.floor((seed / 2 ** 32) * length);
          }),
        });
        assert.equal(result.status, 'ok', result.reason);
        state = result.state;
      }

      const solver = new LiveKnowledge(pack, opening);
      assert.deepEqual(solver.reasons, []);
      assert.equal(solver.queryConfiguration(setup), 'possible');
      for (const o of state.observations.protagonists) checkPrefix(solver, setup, o, module);
      const view = solver.snapshot();
      for (const c of setup.characters)
        if (c.reverseIdentity)
          assert.ok(view.parameters?.['reverse:' + c.id]?.includes(c.reverseIdentity));
      assert.ok(state.observations.protagonists.some((o) => o.type === 'incident'));
    });
  }
}

test('AHR pairs, WM ordered X and alternate Y, and LL secret additions and seat permutations match exhaustive openings', () => {
  for (const [module, rules] of [
    ['AHR', ['鹅妈妈神秘故事', '恶魔吹着笛子来', '超越世界线']],
    ['WM', ['巨大定时炸弹Y', '染血的仪式', '疯狂的真相', '流言四起']],
    ['LL', ['巨大定时炸弹Z', '捏造的秘密', 'X异因子']],
  ] as const) {
    const pack = structuredClone(compileOfficial(module));
    pack.plots = Object.fromEntries(rules.map((r) => [r, pack.plots[r]!]));
    const opening = initialPlacementView(
      initializeDiscussion(compileOfficial('FS'), config).state!,
    );
    opening.module = module;
    opening.characters = ['男学生', '女学生', '情报商', '医生', '职员'].map((character, i) => ({
      id: 'r' + i,
      character,
      status: 'alive',
      area: pack.characters[character]!.initial[0]!,
      counters: zeroCounters(),
    }));
    const key = (s: GameSetup) =>
      JSON.stringify([
        s.y,
        s.x,
        s.characters.map((c) => [c.identity, c.reverseIdentity]),
        s.secretAddition,
        s.alternateY,
        s.privateRoles,
      ]);
    const expected = new Set<string>();
    for (const setup of generateDomain(pack, opening))
      if (setup) {
        expected.add(key(setup));
        if (module === 'WM') expected.add(key({ ...setup, x: [...setup.x].reverse() }));
      }
    const profiles = buildProfiles(pack, opening, { checks: 0, removed: 0, branches: 0 });
    const solved = [...configurations(pack, opening, profiles)].filter((s) => s !== null);
    assert.ok(expected.size > 0, module);
    assert.equal(solved.length, expected.size, module);
    assert.deepEqual(new Set(solved.map(key)), expected, module);
    if (module === 'LL') {
      assert.equal(new Set(solved.map((s) => JSON.stringify(s.privateRoles))).size, 6);
      assert.deepEqual(new Set(solved.map((s) => s.secretAddition)), new Set(['杀手', '因果残片']));
    }
    if (module === 'AHR')
      assert.ok(
        solved.every(
          (s) =>
            s.characters.filter((c) => c.reverseIdentity === '布道者' && c.identity === '魔笛手')
              .length === 1,
        ),
      );
    if (module === 'WM') assert.ok(solved.every((s) => s.alternateY && s.alternateY !== s.y));
  }
});

test('HSA crowd locations count public corpses and victims; MC links the adjacent Ex gain to the culprit', () => {
  for (const module of ['HSA', 'MC'] as const) {
    const setup = structuredClone(fixtures.find((f) => f.setup.module === module)!.setup);
    const pack = compileOfficial(module);
    if (module === 'MC')
      setup.characters.find((c) => c.character === '住院患者')!.character = '黑猫';
    const start = initializeDiscussion(pack, setup);
    assert.ok(start.state, JSON.stringify(start.diagnostics));
    const opening = initialPlacementView(start.state);
    const cat = opening.characters.find((c) => c.character === '黑猫');
    const day = module === 'HSA' ? 4 : 2;
    if (module === 'MC') for (const c of opening.characters) c.counters.paranoia = 5;
    const solver = new LiveKnowledge(pack, opening);
    const append = (type: Observation['type'], data: Observation['data']) => {
      const sequence = solver.observationCount + 1;
      solver.append(
        [{ sequence, loop: 1, day, phase: 'incident', type, data }],
        sequence - 1,
        sequence,
      );
    };
    append('boundary', {});
    if (module === 'HSA') append('board', { board: 'school', intrigue: 2 });
    append('incident', { day, occurred: true, name: module === 'HSA' ? '死者默示录' : '银色子弹' });
    if (module === 'HSA') assert.deepEqual(solver.snapshot().culprits[day], ['school']);
    else {
      assert.ok(cat && solver.snapshot().culprits[day]?.includes(cat.id));
      append('board', { ex: 0 }); // Silver bullet gives zero, but a black-cat culprit gives one.
      assert.ok(!solver.snapshot().culprits[day]?.includes(cat.id));
      assert.ok(solver.snapshot().culprits[day]?.includes('policeOfficer'));
    }
  }
});

test('AHR disclosures use the public world line and MZ keeps the ninja as a possible false disclosure', () => {
  for (const module of ['AHR', 'MZ'] as const) {
    const setup = fixtures.find((f) => f.setup.module === module)!.setup;
    const pack = structuredClone(compileOfficial(module));
    pack.plots = Object.fromEntries([setup.y, ...setup.x].map((name) => [name, pack.plots[name]!]));
    const opening = initialPlacementView(initializeDiscussion(pack, setup).state!);
    const character = module === 'AHR' ? 'richStudent' : 'officeWorker';
    for (const ex of module === 'AHR' ? [0, 1] : [0]) {
      const solver = new LiveKnowledge(pack, opening);
      const identity = module === 'AHR' ? '主谋' : '亲友';
      solver.update(
        [
          {
            sequence: 1,
            loop: 1,
            day: 1,
            phase: 'protagonist-abilities',
            type: 'board',
            data: { ex },
          },
          {
            sequence: 2,
            loop: 1,
            day: 1,
            phase: 'protagonist-abilities',
            type: 'identity',
            data: { character, identity },
          },
        ],
        2,
      );
      const roles = solver.snapshot().identities[character]!;
      assert.ok(roles.includes(identity));
      if (module === 'AHR') assert.equal(roles.includes('关键人物'), ex === 1);
      else {
        assert.ok(roles.includes('忍者'));
        assert.ok(!roles.includes('平民'));
      }
    }
  }
});

test('changing a rule changes both setup legality and the solver domain', () => {
  const pack = structuredClone(compileOfficial('FS'));
  const opening = initialPlacementView(initializeDiscussion(pack, config).state!);
  assert.ok(new LiveKnowledge(pack, opening).snapshot().identities.a!.includes('主谋'));
  pack.setupRules.attribute = {
    plot: config.y,
    identity: '主谋',
    attribute: '不存在的属性',
    except: '局外人',
  };
  assert.ok(validateSetup(pack, config).some((d) => d.code === 'required-attribute'));
  assert.equal(new LiveKnowledge(pack, opening).queryConfiguration(config), 'excluded');
  assert.ok(
    !new LiveKnowledge(pack, opening).snapshot().ruleCombinations?.some((p) => p.y === config.y),
  );
});

test('direct effects compile threshold, target and amount gates; missing evidence keeps a source', () => {
  const pack = structuredClone(compileOfficial('FS'));
  const def = pack.identities['传谣人']!.abilities[0]!;
  def.threshold = 4;
  const roster = [{ id: 'b', character: '女学生' }];
  const source = new PruningCatalog(pack, { incidents: [] }, roster).sourcesFor(
    'identities',
    '传谣人',
  )[0]!;
  assert.ok(necessaryConditions(source).includes('goodwill'));
  const actor = {
    ...roster[0]!,
    area: 'school' as const,
    status: 'alive' as const,
    counters: zeroCounters(),
  };
  const context = {
    pack,
    clock: { phase: 'mastermind-abilities' as const, day: 1, loop: 1 },
    loops: 2,
    days: 2,
    owner: 'b',
    characters: new Map([['b', actor]]),
    boards: { school: 0, hospital: 0, shrine: 0, city: 0 },
  };
  const window = { deaths: new Set<string>(), occurrence: new Map<string, boolean>() };
  const change = {
    target: 'b',
    kind: 'counter' as const,
    counter: 'paranoia' as const,
    sign: 1,
    before: 0,
    after: 1,
  };
  assert.equal(rejectedCondition(source, change, context, window), 'goodwill');
  actor.counters.hope = 4;
  assert.equal(rejectedCondition(source, change, context, window), undefined);
  assert.equal(rejectedCondition(source, { ...change, after: 2 }, context, window), 'amount');
  context.characters.clear();
  assert.equal(rejectedCondition(source, change, context, window), undefined);
});

test('absence templates follow the enabled death reaction and its direction', () => {
  const pack = structuredClone(compileOfficial('BTX'));
  delete pack.identities['求爱者']!.partnerReaction;
  assert.deepEqual(partnerPairs(pack), [['心上人', '求爱者']]);
  pack.identities['心上人']!.partnerReaction!.paranoia = 0;
  assert.deepEqual(partnerPairs(pack), []);
});
