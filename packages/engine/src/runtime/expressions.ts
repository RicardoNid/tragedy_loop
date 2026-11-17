import type { Area, Board, Counter, Counters } from '../../../contracts/src/game.js';
import {
  BOARDS,
  COUNTERS,
  identityConfiguration,
  type Condition,
  type EngineState,
  type Environment,
  type RulePack,
  type Selector,
  type Value,
} from './model.js';

export function ref(value: string, env: Environment): string {
  return value.startsWith('$') ? (env[value.slice(1)] ?? '') : value;
}
export function bind(state: EngineState, env: Environment): Environment {
  const result = { ...env };
  for (const [key, id] of Object.entries(env)) {
    const c = state.characters[id];
    if (c) {
      result[`${key}.area`] = c.area;
      result[`${key}.initialArea`] = c.initialArea;
    } else if (id.startsWith('victim:')) result[`${key}.area`] = id.split(':')[1]!;
  }
  if (env.effectiveArea) result['self.area'] = env.effectiveArea;
  return result;
}
export function effective(state: EngineState, target: string, counter: Counter): number {
  if (BOARDS.includes(target as Board)) {
    const modifier =
      state.setup.y === '封印的终末'
        ? Object.values(state.characters)
            .filter((c) => c.status === 'alive' && c.area === target)
            .reduce((n, c) => n + c.counters.despair - c.counters.hope, 0)
        : 0;
    return counter === 'intrigue' ? Math.max(0, state.boards[target as Board] + modifier) : 0;
  }
  const c = state.characters[target]?.counters;
  if (!c) return 0;
  return characterCounter(c, counter);
}
export function characterCounter(c: Counters, counter: Counter): number {
  if (counter === 'goodwill') return c.goodwill + c.hope;
  if (counter === 'paranoia') return c.paranoia + c.despair;
  if (counter === 'intrigue') return Math.max(0, c.intrigue + c.despair - c.hope);
  return c[counter];
}
export function identities(state: EngineState, id: string): string[] {
  const c = state.characters[id];
  if (!c) return [];
  const result = [c.identity];
  if (c.identity === '不安定因子') {
    if (effective(state, 'school', 'intrigue') >= 2) result.push('传谣人');
    if (effective(state, 'city', 'intrigue') >= 2) result.push('关键人物');
  }
  if (c.identity === '无面者') result.push(state.ex <= 1 ? '传谣人' : '深潜者');
  if (c.identity === '偏执狂' && state.setup.x.includes('深渊之都的私语')) result.push('关键人物');
  if (c.identity === '怪杰' && state.day % 3 === 0) result.push('传谣人', '主谋', '杀人狂');
  return result;
}
export function refusal(
  pack: RulePack,
  state: EngineState,
  id: string,
): 'none' | 'optional' | 'mandatory' {
  const c = state.characters[id];
  if (!c || c.counters.hope > 0) return 'none';
  if (c.counters.despair > 0) return state.setup.x.includes('傀儡之线') ? 'optional' : 'mandatory';
  if (c.identity === '纸老虎' && effective(state, id, 'paranoia') >= 2) return 'mandatory';
  if (c.identity === '密钥' && state.setup.x.includes('捏造的秘密')) return 'optional';
  const mode = pack.identities[c.identity]?.ignore ?? 'none';
  return state.setup.x.includes('傀儡之线') && mode !== 'none' ? 'optional' : mode;
}
export function immortal(pack: RulePack, state: EngineState, id: string): boolean {
  const c = state.characters[id];
  return !!c && roleImmortal(pack, c.identity, c.counters);
}
export function roleImmortal(
  pack: RulePack,
  role: string,
  counters: EngineState['characters'][string]['counters'],
) {
  return (
    Boolean(pack.identities[role]?.immortal) &&
    !(role === '纸老虎' && counters.paranoia + counters.despair >= 2)
  );
}
export function value(
  pack: RulePack,
  state: EngineState,
  expression: Value,
  env: Environment,
): string | number | boolean | null {
  if (expression === null || typeof expression !== 'object') return expression;
  if ('ref' in expression) return ref(expression.ref, env);
  if ('gameFlag' in expression) return state.flags[expression.gameFlag] ?? '';
  if ('game' in expression) {
    if (expression.game === 'world') return state.ex % 2;
    if (expression.game === 'days' || expression.game === 'loops')
      return state.setup[expression.game];
    return state[expression.game];
  }
  if ('count' in expression) return select(pack, state, expression.count, env).length;
  if ('sum' in expression)
    return select(pack, state, expression.sum, env).reduce(
      (total, id) =>
        total + Number(value(pack, state, expression.value, bind(state, { ...env, it: id }))),
      0,
    );
  if ('op' in expression) {
    const args = expression.args.map((a) => Number(value(pack, state, a, env)));
    if (expression.op === 'add') return args.reduce((a, b) => a + b, 0);
    if (expression.op === 'subtract') return (args[0] ?? 0) - (args[1] ?? 0);
    return expression.op === 'min' ? Math.min(...args) : Math.max(...args);
  }
  const target = ref(expression.target, env);
  if ('counter' in expression)
    return expression.raw
      ? (state.characters[target]?.counters[expression.counter] ??
          (expression.counter === 'intrigue' ? (state.boards[target as Board] ?? 0) : 0))
      : effective(state, target, expression.counter);
  const c = state.characters[target];
  if (!c && target.startsWith('victim:')) {
    if (expression.field === 'area' || expression.field === 'initialArea')
      return target.split(':')[1]!;
    if (expression.field === 'identity') return state.setup.y === '古墓活尸' ? '丧尸' : '平民';
    if (expression.field === 'status') return 'dead';
    return 0;
  }
  if (!c) return expression.field === 'area' || expression.field === 'initialArea' ? target : null;
  if (expression.field === 'area' && target === env.self && env.effectiveArea)
    return env.effectiveArea;
  if (expression.field === 'rawTotal') return COUNTERS.reduce((sum, k) => sum + c.counters[k], 0);
  if (expression.field === 'kinds') return COUNTERS.filter((k) => c.counters[k] > 0).length;
  if (expression.field === 'paranoiaLimit') return c.character === '仙人' ? 0 : c.paranoiaLimit;
  return c[expression.field];
}
export function test(
  pack: RulePack,
  state: EngineState,
  condition: Condition | undefined,
  env: Environment,
): boolean {
  if (condition === undefined) return true;
  if (typeof condition === 'boolean') return condition;
  if ('all' in condition) return condition.all.every((c) => test(pack, state, c, env));
  if ('any' in condition) return condition.any.some((c) => test(pack, state, c, env));
  if ('not' in condition) return !test(pack, state, condition.not, env);
  if ('attribute' in condition)
    return (
      state.characters[ref(condition.target, env)]?.attributes.includes(condition.attribute) ??
      false
    );
  if ('hasAbility' in condition)
    return identities(state, ref(condition.target, env)).includes(condition.hasAbility);
  if ('flag' in condition)
    return Boolean(
      condition.target
        ? state.characters[ref(condition.target, env)]?.flags[condition.flag]
        : state.flags[condition.flag],
    );
  if ('incidentOccurred' in condition)
    return state.incidents.some(
      (i) => i.loop === state.loop && i.name === condition.incidentOccurred,
    );
  const a = value(pack, state, condition.left, env);
  const b = value(pack, state, condition.right, env);
  if (condition.cmp === 'eq') return a === b;
  if (condition.cmp === 'ne') return a !== b;
  if (condition.cmp === 'ge') return Number(a) >= Number(b);
  if (condition.cmp === 'gt') return Number(a) > Number(b);
  if (condition.cmp === 'le') return Number(a) <= Number(b);
  return Number(a) < Number(b);
}
export function select(
  pack: RulePack,
  state: EngineState,
  selector: Selector,
  env: Environment,
): string[] {
  let ids = Object.values(state.characters)
    .filter(
      (c) =>
        selector.kind === 'cards' ||
        (selector.kind === 'dead' ? c.status === 'dead' : c.status === 'alive'),
    )
    .map((c) => c.id);
  if (selector.kind === 'boards') ids = [...BOARDS];
  if (selector.kind === 'alive-or-boards') ids.push(...BOARDS);
  if (pack.module === 'HSA' && selector.kind === 'dead')
    for (const board of BOARDS)
      for (let n = 0; n < state.boards[board]; n++) ids.push(`victim:${board}:${n}`);
  return ids.filter((id) => test(pack, state, selector.where, { ...env, it: id }));
}
export function recompute(state: EngineState): void {
  for (const c of Object.values(state.characters)) {
    if (state.setup.module === 'AHR') {
      const config = identityConfiguration(state, c.id);
      c.identity =
        state.ex % 2 === 1 && config?.reverseIdentity ? config.reverseIdentity : c.initialIdentity;
      if (c.character === '临时工') c.identity = '平民';
      if (
        state.setup.x.includes('空想扩大病毒') &&
        state.ex % 2 === 1 &&
        ['平民', '因果残片'].includes(c.identity) &&
        c.status === 'alive' &&
        COUNTERS.filter((k) => c.counters[k] > 0).length >= 2
      )
        c.identity = '杀人狂';
    }
    if (state.setup.x.includes('妄想扩大病毒') && c.initialIdentity === '平民') {
      c.identity =
        c.status === 'alive' && effective(state, c.id, 'paranoia') >= 3
          ? '杀人狂'
          : c.initialIdentity;
    }
    if (state.setup.y === '因果之绊' && c.flags['causal-ex']) c.identity = '关键人物';
    if (
      state.setup.y === '古墓活尸' &&
      c.status === 'dead' &&
      ['平民', '胆小鬼', '纸老虎'].includes(c.identity)
    )
      c.identity = '丧尸';
  }
  checkSpecialVictory(state);
}
export function traitors(state: EngineState): ('p0' | 'p1' | 'p2')[] {
  if (!state.ll || state.ll.finalTraitorsDisabled) return [];
  if (
    state.setup.y === '最终计划' &&
    Object.values(state.characters).some((c) => c.identity === '关键人物' && c.counters.hope >= 1)
  )
    return [];
  const active = [
    state.setup.x.includes('真正的怪物') ? 'A' : '',
    state.setup.x.includes('神话收集者') ? 'B' : '',
    state.setup.x.includes('我才是名侦探') ? 'C' : '',
  ];
  return (['p0', 'p1', 'p2'] as const).filter((p) => active.includes(state.ll!.roles[p]));
}
export function checkSpecialVictory(state: EngineState): void {
  if (!state.ll || state.latchedWinner || state.winner) return;
  for (const actor of traitors(state)) {
    const role = state.ll.roles[actor];
    if (
      (role === 'A' && state.phase === 'day-end' && state.ll.died.length >= 5) ||
      (role === 'B' && state.phase === 'protagonist-abilities' && state.ll.communicated.length >= 6)
    )
      state.latchedWinner = actor;
  }
}
export function destination(area: Area, directions: string[]): Area {
  const moves = [...new Set(directions)];
  if (area === 'far' || moves.length === 0) return area;
  const bits = moves.reduce((n, d) => n ^ ({ horizontal: 1, vertical: 2, diagonal: 3 }[d] ?? 0), 0);
  return BOARDS[BOARDS.indexOf(area) ^ bits] ?? area;
}
