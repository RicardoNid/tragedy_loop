import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fixturesJson from './fixtures/official-scenarios.json' with { type: 'json' };
import type {
  Actor,
  Choice,
  Command,
  GameSetup,
  Observer,
} from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import {
  advance,
  cardCount,
  initializeDiscussion,
  legalCardTargets,
  resume,
} from '../../packages/engine/src/runtime/engine.js';
import {
  canonical,
  type EngineState,
  type RulePack,
} from '../../packages/engine/src/runtime/model.js';
import { project } from '../../packages/engine/src/runtime/ports.js';

export const fixtures = fixturesJson as unknown as {
  id: string;
  title: string;
  source: unknown;
  setup: GameSetup;
}[];
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const observers: Observer[] = ['mastermind', 'p0', 'p1', 'p2', 'protagonists'];
export const checkpoint = (s: EngineState) => ({
  state: hash(s),
  views: observers.map((o) => hash(project(s, o))),
});
export interface History {
  scenario: string;
  seed: number;
  aggressive: boolean;
  setup: GameSetup;
  ruleDigest: string;
  initial: ReturnType<typeof checkpoint>;
  steps: { actor: Actor; command: Command; expected: ReturnType<typeof checkpoint> }[];
  winner: EngineState['winner'];
  loop: number;
  day: number;
  incidents: EngineState['incidents'];
}

// Test driver has full information, and is not a player AI or a proof of strategy strength.
export function generate(
  scenario: (typeof fixtures)[number],
  aggressive: boolean,
  seed = 1,
): History {
  const setup = structuredClone(scenario.setup),
    pack = compileOfficial(setup.module, setup.anniversary);
  const init = initializeDiscussion(pack, setup);
  assert.deepEqual(init.diagnostics, []);
  assert.ok(init.state);
  let s = init.state,
    rng = seed;
  const random = (n: number) => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng % n;
  };
  const history: History = {
    scenario: scenario.id,
    seed,
    aggressive,
    setup,
    ruleDigest: pack.digest,
    initial: checkpoint(s),
    steps: [],
    winner: undefined,
    loop: 0,
    day: 0,
    incidents: [],
  };
  while (!s.winner) {
    assert.ok(history.steps.length < 1500, `${scenario.id}: decision limit`);
    assert.ok(s.pending, `${scenario.id}: stalled ${s.diagnostic}`);
    const p = s.pending;
    let choice: Choice;
    if (p.kind === 'cards') {
      const cards = s.cards.filter((c) => c.owner === p.actor && c.status === 'hand');
      const targets = legalCardTargets(s, p.actor);
      const placements: { card: string; target: string }[] = [];
      const add = (kind: string, target: string) => {
        const c = cards.find((c) => c.kind === kind && !placements.some((p) => p.card === c.id));
        if (c && targets.includes(target) && !placements.some((p) => p.target === target))
          placements.push({ card: c.id, target });
      };
      if (aggressive && p.actor === 'mastermind') {
        const focus: Record<string, string> = {
          FS: 'girlStudent',
          BTX: 'popIdol',
          MZ: 'officeWorker',
          MC: 'school',
          WM: 'school',
          AHR: 'popIdol',
          LL: 'school',
          HSA: 'school',
        };
        add(setup.module === 'FS' ? 'paranoia+1' : 'intrigue+1', focus[setup.module]!);
        const culprit = setup.incidents.find(
          (i) => i.day >= s.day && s.characters[i.culprit]?.status === 'alive',
        )?.culprit;
        if (culprit) add('paranoia+1', culprit);
        if (setup.module === 'HSA') add('intrigue+2', 'shrine');
      }
      for (const kind of [
        'horizontal',
        'vertical',
        'paranoia-1',
        'block-movement',
        'block-goodwill',
      ])
        for (const b of ['hospital', 'shrine', 'city', 'school'])
          if (placements.length < cardCount(s, p.actor)) add(kind, b);
      assert.equal(placements.length, cardCount(s, p.actor));
      choice = { kind: 'cards', placements };
    } else if (p.kind === 'guess') {
      if (s.flags['c-guess'])
        choice = {
          kind: 'guess-culprits',
          answers: Object.fromEntries(setup.incidents.map((i) => [String(i.day), i.culprit])),
        };
      else {
        const guessed = JSON.parse(s.flags.guessed ?? '[]') as string[];
        const c = Object.values(s.characters).find(
          (c) => c.status !== 'absent' && !guessed.includes(c.id),
        )!;
        const config = setup.characters.find((x) => x.id === c.id);
        choice = {
          kind: 'guess',
          character: c.id,
          identity: aggressive
            ? c.initialIdentity === '平民'
              ? '主谋'
              : '平民'
            : c.initialIdentity,
          ...(config?.reverseIdentity ? { reverseIdentity: config.reverseIdentity } : {}),
        };
      }
    } else if (p.kind === 'ability') {
      const abilities = p.options.filter((c) => c.kind === 'ability');
      choice =
        aggressive && p.actor === 'mastermind' && abilities.length
          ? abilities[random(abilities.length)]!
          : p.options.find((c) => c.kind === 'pass')!;
    } else
      choice = p.options.find((c) => c.kind === 'continue') ?? p.options[random(p.options.length)]!;
    assert.ok(choice, `${scenario.id}: empty menu ${p.kind}`);
    const command: Command = {
      id: `replay-${history.steps.length}`,
      expectedRevision: s.revision,
      decisionId: p.id,
      choice,
    };
    const before = hash(s),
      result = advance(pack, s, p.actor, command);
    assert.equal(hash(s), before, 'advance mutated input');
    assert.equal(
      result.status,
      'ok',
      `${scenario.id} ${s.phase} ${JSON.stringify(choice)}: ${result.reason ?? result.state.diagnostic}`,
    );
    s = result.state;
    history.steps.push({ actor: p.actor, command, expected: checkpoint(s) });
  }
  assert.equal(s.phase, 'finished');
  history.winner = s.winner;
  history.loop = s.loop;
  history.day = s.day;
  history.incidents = s.incidents;
  return history;
}

export function verify(history: History, budget = 10000, roundTrip = false): EngineState {
  const pack = compileOfficial(history.setup.module, history.setup.anniversary);
  assert.equal(
    pack.digest,
    history.ruleDigest,
    'rule version changed: review and regenerate evidence',
  );
  const started = initializeDiscussion(pack, history.setup, budget);
  assert.deepEqual(started.diagnostics, []);
  assert.ok(started.state);
  let s = settled(pack, started.state, budget, roundTrip);
  assert.deepEqual(checkpoint(s), history.initial, 'initial state');
  for (const [i, step] of history.steps.entries()) {
    if (roundTrip) s = JSON.parse(JSON.stringify(s)) as EngineState;
    const old = hash(s),
      r = advance(pack, s, step.actor, step.command, budget);
    assert.notEqual(r.status, 'rejected', `${i}: ${r.reason}`);
    assert.equal(hash(s), old, 'input mutation');
    s = settled(pack, r.state, budget, roundTrip);
    assert.deepEqual(
      checkpoint(s),
      step.expected,
      `${history.scenario} step ${i} budget ${budget}`,
    );
    const retry = advance(pack, s, step.actor, step.command);
    assert.equal(retry.status, 'ok');
    assert.deepEqual(retry.state, s, 'retry changed state');
  }
  assert.equal(s.winner, history.winner);
  assert.equal(s.phase, 'finished');
  return s;
}
function settled(pack: RulePack, state: EngineState, budget: number, json: boolean): EngineState {
  let s = state;
  for (let n = 0; !s.pending && !s.winner; n++) {
    assert.ok(n < 10000, 'resume limit');
    if (json) s = JSON.parse(JSON.stringify(s)) as EngineState;
    const r = resume(pack, s, Math.max(1, budget));
    assert.notEqual(r.status, 'rejected');
    s = r.state;
  }
  return s;
}
