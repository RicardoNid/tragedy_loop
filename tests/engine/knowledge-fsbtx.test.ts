import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import {
  EnumeratedKnowledge,
  LiveKnowledge,
  generateDomain,
} from '../../packages/engine/src/runtime/knowledge.js';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';

const cases: {
  name: string;
  setup: GameSetup;
  cards?: string[][];
  verify: (s: EngineState) => void;
}[] = [
  {
    name: 'FS copycat identity allocation and simultaneous serial killers',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '复仇的火种',
      x: ['开膛者的魔影'],
      characters: [
        { id: 'a', character: '女学生', identity: '杀人狂' },
        { id: 'b', character: '男学生', identity: '主谋' },
        { id: 'c', character: '住院患者', identity: '传谣人' },
        { id: 'd', character: '模仿犯', identity: '杀人狂', copiedFrom: 'a' },
      ],
      incidents: [],
    },
    cards: [
      ['horizontal', 'a'],
      ['intrigue+2', 'hospital'],
      ['paranoia+1', 'c'],
    ],
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.d!.status, 'dead');
    },
  },
  {
    name: 'FS simultaneous hospital deaths and immediate key-person loop end',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '守护此地',
      x: ['流言四起'],
      characters: [
        { id: 'a', character: '医生', identity: '关键人物' },
        { id: 'b', character: '住院患者', identity: '邪教徒' },
        { id: 'c', character: '男学生', identity: '传谣人' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.b!.status, 'dead');
      assert.equal(s.failed, true);
    },
  },
  {
    name: 'FS hospital batch with servant following, substitution and key-person death',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '守护此地',
      x: ['流言四起'],
      characters: [
        { id: 'a', character: '从者', identity: '传谣人', initialArea: 'school' },
        { id: 'b', character: '大小姐', identity: '邪教徒' },
        { id: 'c', character: '医生', identity: '关键人物' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    cards: [
      ['diagonal', 'b'],
      ['intrigue+1', 'hospital'],
      ['paranoia+1', 'c'],
    ],
    verify(s) {
      assert.equal(s.characters.b!.area, 'hospital');
      assert.equal(s.characters.a!.area, 'hospital');
      assert.equal(s.characters.b!.status, 'alive');
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.c!.status, 'dead');
      assert.ok(s.audit.some((e) => e.kind === 'replacement-request'));
      assert.equal(s.failed, true);
    },
  },
  {
    name: 'BTX hospital simultaneous death and immortal time traveller',
    setup: {
      module: 'BTX',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '改变未来',
      x: ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '医生', identity: '邪教徒' },
        { id: 'b', character: '住院患者', identity: '时间旅者' },
        { id: 'c', character: '男学生', identity: '传谣人' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.b!.status, 'alive');
    },
  },
  {
    name: 'BTX overlapping rumormonger quota, virus transformation and mandatory refusal',
    setup: {
      module: 'BTX',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '巨大定时炸弹X',
      x: ['流言四起', '妄想扩大病毒'],
      characters: [
        { id: 'a', character: '女学生', identity: '魔女' },
        { id: 'b', character: '男学生', identity: '平民' },
        { id: 'c', character: '从者', identity: '传谣人', initialArea: 'school' },
      ],
      incidents: [],
    },
    verify(s) {
      assert.ok(s.observations.protagonists.some((o) => o.type === 'refused'));
      assert.equal(s.characters.b!.identity, '杀人狂');
      assert.equal(s.characters.a!.status, 'alive'); // Two other characters: serial killer does not trigger.
    },
  },
];

function complete(k: EnumeratedKnowledge | LiveKnowledge) {
  if (k instanceof LiveKnowledge && k.historySearchDeferred) k.verifyAll();
  const deadline = Date.now() + 120000;
  while (!k.paused && Date.now() < deadline) k.tick(25, Infinity);
  const result = k.snapshot();
  assert.equal(result.domainComplete, true, JSON.stringify(result.reasons));
  assert.equal(result.status, 'exact', JSON.stringify({ ...result, identities: undefined }));
  return result;
}
for (const fixture of cases)
  test(fixture.name, { timeout: 180000 }, () => {
    const pack = compileOfficial(fixture.setup.module, fixture.setup.anniversary);
    const initialized = initializeDiscussion(pack, fixture.setup);
    assert.ok(initialized.state, JSON.stringify(initialized.diagnostics));
    let state = initialized.state;
    const opening = project(state, 'protagonists');
    // Keep the comparison domain explicit and bypass static disclosure pruning.
    const k = new EnumeratedKnowledge(pack, opening, 5000, true);
    const symbolic = new LiveKnowledge(pack, opening);
    symbolic.append(opening.observations, 0, opening.revision);
    let through = opening.observations.length;
    assert.equal(
      symbolic.snapshot().generated,
      0,
      'initial domains do not enumerate complete setups',
    );
    complete(symbolic);
    k.update(opening.observations, opening.revision);
    const initial = complete(k);
    const domain = [...generateDomain(pack, opening)].filter((s): s is GameSetup => !!s);
    const key = (s: GameSetup) =>
      canonical({
        ...s,
        x: [...s.x].sort(),
        characters: s.characters
          .map((c) => ({
            ...c,
            initialArea: c.initialArea ?? pack.characters[c.character]!.initial[0],
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        incidents: s.incidents
          .map((i) => ({ ...i, publicName: i.publicName ?? i.name }))
          .sort((a, b) => a.day - b.day),
      });
    let checkpoints = 0;
    let previousSolutions: Set<string> | undefined;
    const compareJoint = () => {
      const result = complete(k);
      symbolic.verifyCombinations();
      const exact = complete(symbolic);
      const expected = new Set(
        domain.filter((s) => k.queryConfiguration(s) === 'possible').map(key),
      );
      assert.equal(
        expected.size,
        result.possible,
        'every oracle witness belongs to a unique full assignment',
      );
      const actual = new Set(symbolic.jointSolutions()!.map(key));
      assert.equal(exact.jointCount, expected.size);
      assert.deepEqual(
        actual,
        expected,
        'full assignments differ at observation ' + symbolic.observationCount,
      );
      if (previousSolutions)
        for (const s of actual) assert.ok(previousSolutions.has(s), 'a removed script returned');
      previousSolutions = actual;
      checkpoints++;
    };
    assert.equal(
      initial.possible,
      [...generateDomain(pack, opening)].filter(Boolean).length,
      'factored initial count must equal explicit complete enumeration',
    );
    let triedAbility = false,
      triedGossip = false;
    for (let step = 0; step < 70; step++) {
      const pending = state.pending!;
      assert.ok(pending);
      let choice: Choice;
      if (pending.kind === 'cards') {
        const entries =
          pending.actor === 'mastermind'
            ? (fixture.cards ?? [
                ['paranoia+1', 'b'],
                ['intrigue+2', 'hospital'],
                ['paranoia+1', 'c'],
              ])
            : pending.actor === 'p0'
              ? [['paranoia+1', 'b']]
              : pending.actor === 'p1'
                ? [['goodwill+2', 'a']]
                : [['horizontal', 'school']];
        const used = new Set<string>();
        choice = {
          kind: 'cards',
          placements: entries.map(([kind, target]) => {
            const card = state.cards.find(
              (c) =>
                c.owner === pending.actor &&
                c.kind === kind &&
                c.status === 'hand' &&
                !used.has(c.id),
            )!;
            assert.ok(card, `${pending.actor} missing ${kind}`);
            used.add(card.id);
            return { card: card.id, target: target! };
          }),
        };
      } else if (
        !triedGossip &&
        fixture.setup.incidents.length === 0 &&
        pending.actor === 'mastermind' &&
        pending.options.some(
          (c) => c.kind === 'ability' && c.ability === 'gossip' && c.owner === 'c',
        )
      ) {
        choice = pending.options.find(
          (c) => c.kind === 'ability' && c.ability === 'gossip' && c.owner === 'c',
        )!;
        triedGossip = true;
      } else if (
        pending.kind === 'choice' &&
        pending.actor === 'mastermind' &&
        pending.options.some((c) => c.kind === 'select' && c.value === 'b')
      ) {
        choice = pending.options.find((c) => c.kind === 'select' && c.value === 'b')!;
      } else if (
        !triedAbility &&
        fixture.setup.incidents.length === 0 &&
        pending.actor !== 'mastermind' &&
        pending.options.some((c) => c.kind === 'ability')
      ) {
        choice = pending.options.find((c) => c.kind === 'ability' && c.owner === 'a') ?? {
          kind: 'pass',
        };
        triedAbility = true;
      } else
        choice =
          pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
          pending.options[0]!;
      const next = advance(pack, state, pending.actor, {
        id: `case-${step}`,
        expectedRevision: state.revision,
        decisionId: pending.id,
        choice,
      });
      assert.notEqual(next.status, 'rejected', JSON.stringify({ step, pending, choice }));
      state = next.state;
      const view = project(state, 'protagonists');
      const suffix = view.observations.slice(through);
      for (let i = 0; i < suffix.length; i++) {
        const o = suffix[i]!;
        symbolic.append([o], through + i, view.revision);
        // Compare each partial publication during an actual settlement, including
        // the interval between simultaneous deaths and their later triggers.
        if (
          ['incident', 'day-end', 'protagonist-abilities'].includes(o.phase) &&
          [
            'character',
            'board',
            'declaration',
            'refused',
            'failure',
            'incident',
            'no-effect',
          ].includes(o.type)
        ) {
          k.update(view.observations.slice(0, through + i + 1), view.revision);
          compareJoint();
        }
      }
      k.update(view.observations, view.revision);
      through = view.observations.length;
      symbolic.tick(1, Infinity);
      // Allow ordinary play to advance while the solver retains its work; solve at the checkpoint.
      k.tick(1, Infinity);
      if (
        state.winner ||
        state.phase === 'loop-end' ||
        (state.loop > 1 && state.phase === 'discussion')
      )
        break;
    }
    fixture.verify(state);
    compareJoint();
    const oneShot = new LiveKnowledge(pack, opening);
    oneShot.append(state.observations.protagonists, 0, state.revision);
    oneShot.verifyCombinations();
    complete(oneShot);
    assert.deepEqual(
      new Set(oneShot.jointSolutions()!.map(key)),
      previousSolutions,
      'incremental and one-shot spaces differ',
    );
    const result = complete(k);
    const constrained = complete(symbolic);
    const normalize = (r: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(r).map(([key, values]) => [key, [...values].sort()]));
    assert.deepEqual(
      normalize(constrained.identities),
      normalize(result.identities),
      'symbolic identity projections equal exhaustive historical search',
    );
    assert.deepEqual(normalize(constrained.culprits), normalize(result.culprits));
    assert.deepEqual([...constrained.rules].sort(), [...result.rules].sort());
    assert.equal(symbolic.queryConfiguration(fixture.setup), 'possible');
    assert.equal(
      k.queryConfiguration(fixture.setup),
      'possible',
      'the complete true configuration must have a legal witness',
    );
    assert.ok(result.possible > 0, 'the real legal script must retain an explanation');
    assert.ok(
      result.possible < initial.possible,
      'observed effects must reduce the full constructed domain',
    );
    for (const c of fixture.setup.characters)
      assert.ok(
        result.identities[c.id]?.includes(c.identity),
        `${c.id} lost true initial identity`,
      );
    const fresh = new EnumeratedKnowledge(pack, opening, 0);
    const view = project(state, 'protagonists');
    fresh.update(view.observations, view.revision);
    const reference = complete(fresh);
    assert.equal(result.possible, reference.possible);
    assert.equal(result.excluded, reference.excluded);
    if (fixture.setup.incidents.length) {
      assert.equal(state.phase, 'discussion');
      assert.equal(state.loop, 2);
      const pending = state.pending!;
      const restarted = advance(pack, state, pending.actor, {
        id: 'next-loop',
        expectedRevision: state.revision,
        decisionId: pending.id,
        choice: { kind: 'continue' },
      });
      assert.notEqual(restarted.status, 'rejected');
      const reset = project(restarted.state, 'protagonists');
      assert.ok(reset.characters.every((c) => c.status === 'alive'));
      k.update(reset.observations, reset.revision);
      symbolic.append(reset.observations.slice(through), through, reset.revision);
      const continued = complete(symbolic);
      for (const [id, values] of Object.entries(continued.identities))
        assert.ok(values.every((v) => constrained.identities[id]?.includes(v)));
      assert.equal(symbolic.queryConfiguration(fixture.setup), 'possible');
      const secondLoop = complete(k);
      compareJoint();
      assert.ok(
        secondLoop.possible <= result.possible,
        'resetting the board cannot erase prior knowledge',
      );
      assert.equal(k.queryConfiguration(fixture.setup), 'possible');
    }
    console.log(
      JSON.stringify({
        scenario: fixture.name,
        initial: initial.possible,
        jointCheckpoints: checkpoints,
        remaining: result.possible,
        excluded: result.excluded,
        expansions: result.expansions,
        symbolicExpansions: constrained.expansions,
        symbolicWitnesses: constrained.generated,
      }),
    );
  });
