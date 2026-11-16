import assert from 'node:assert/strict';
import type { Area, Choice, GameSetup, Module, Phase } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, drive, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import {
  clone,
  zeroCounters,
  type EngineState,
  type RulePack,
} from '../../packages/engine/src/runtime/model.js';
export interface Lab {
  pack: RulePack;
  state: EngineState;
}
export function lab(module: Module = 'BTX', anniversary = false): Lab {
  const setup: GameSetup = {
    module: 'BTX',
    anniversary: false,
    loops: 3,
    days: 4,
    captain: 'p0',
    discussion: 'between-loops',
    y: '谋杀计划',
    x: ['流言四起', '因果线'],
    characters: [
      { id: 'a', character: '男学生', identity: '关键人物' },
      { id: 'b', character: '女学生', identity: '传谣人' },
      { id: 'c', character: '医生', identity: '杀手' },
      { id: 'd', character: '巫女', identity: '主谋' },
    ],
    incidents: [],
  };
  const base = compileOfficial('BTX');
  const result = initializeDiscussion(base, setup);
  assert.ok(result.state);
  const pack = compileOfficial(module, anniversary),
    state = result.state;
  state.setup.module = module;
  state.setup.anniversary = anniversary;
  state.ruleDigest = pack.digest;
  state.setup.y = '';
  state.setup.x = [];
  for (const c of Object.values(state.characters)) {
    c.identity = c.initialIdentity = '平民';
    state.setup.characters.find((x) => x.id === c.id)!.identity = '平民';
  }
  return { pack, state };
}
export function character(l: Lab, id: string, character: string, identity = '平民', area?: Area) {
  const def = l.pack.characters[character];
  assert.ok(def, character);
  const c: EngineState['characters'][string] = (l.state.characters[id] = {
    id,
    character,
    identity,
    initialIdentity: identity,
    area: area ?? def.initial[0] ?? 'city',
    initialArea: area ?? def.initial[0] ?? 'city',
    status: 'alive',
    counters: zeroCounters(),
    flags: {},
    forbidden: [...def.forbidden],
    attributes: [...def.attributes],
    paranoiaLimit: def.paranoia,
    revealed: false,
  });
  l.state.setup.characters = l.state.setup.characters.filter((c) => c.id !== id);
  l.state.setup.characters.push({ id, character, identity, initialArea: c.area });
  return c;
}
export function phase(l: Lab, phase: Phase) {
  const s = l.state;
  s.pending = null;
  s.frames = [];
  s.batch = null;
  s.phase = phase;
  s.phaseEntered = false;
  drive(l.pack, s, 10000);
  return s;
}
export function act(l: Lab, choice: Choice) {
  const s = l.state;
  assert.ok(s.pending, `missing decision ${s.phase}`);
  const r = advance(l.pack, s, s.pending.actor, {
    id: `faq-${s.revision}`,
    expectedRevision: s.revision,
    decisionId: s.pending.id,
    choice,
  });
  assert.equal(r.status, 'ok', r.reason);
  l.state = r.state;
  return l.state;
}
export function ability(l: Lab, id: string, ability: string, choices?: Record<string, string>) {
  phase(l, 'protagonist-abilities');
  return act(l, { kind: 'ability', owner: id, ability, choices });
}
export function drain(l: Lab, picks: string[] = [], limit = 30) {
  for (let i = 0; i < limit; i++) {
    const d = l.state.pending;
    if (!d || !['choice', 'refusal'].includes(d.kind)) return;
    const pick = picks.shift();
    const c =
      d.options.find((c) => c.kind === 'select' && c.value === pick) ??
      d.options.find((c) => c.kind === 'refuse' && !c.refuse) ??
      d.options[0];
    assert.ok(c);
    act(l, c);
  }
  assert.fail('choice drain limit');
}
export function freezeSnapshot(l: Lab) {
  return clone(l.state);
}
