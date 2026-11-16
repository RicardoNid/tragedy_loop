import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import type { Condition, RulePack, Value } from './model.js';

const unknown = Symbol('unknown');
type Scalar = string | number | boolean | null | typeof unknown;
export interface PublicContext {
  clock: Pick<Observation, 'loop' | 'day' | 'phase'>;
  days: number;
  loops: number;
  pack: RulePack;
  characters: Map<string, PlayerView['characters'][number]>;
  boards: PlayerView['boards'];
  owner?: string;
  target?: string;
  bindings?: Record<string, string>;
  virtualArea?: boolean;
  /** Multi-step/indirect sources do not share the current activation snapshot. */
  staticOnly?: boolean;
  occurred?: (name: string) => boolean | undefined;
  moved?: ReadonlySet<string>;
}
export function publicValue(v: Value, c: PublicContext): Scalar {
  if (v === null || typeof v !== 'object') return v;
  if ('game' in v)
    return v.game === 'day' || v.game === 'loop'
      ? c.clock[v.game]
      : v.game === 'days'
        ? c.days
        : v.game === 'loops'
          ? c.loops
          : unknown;
  if ('op' in v) {
    const a = v.args.map((x) => publicValue(x, c));
    if (a.some((x) => typeof x !== 'number')) return unknown;
    const n = a as number[];
    return v.op === 'add'
      ? n.reduce((a, b) => a + b, 0)
      : v.op === 'subtract'
        ? (n[0] ?? 0) - (n[1] ?? 0)
        : v.op === 'min'
          ? Math.min(...n)
          : Math.max(...n);
  }
  const ref = (r: string): string | undefined =>
    r === '$self' ? c.owner : r.startsWith('$') ? c.bindings?.[r.slice(1)] : r;
  if ('ref' in v) return ref(v.ref) ?? unknown;
  if ('count' in v && !c.staticOnly && v.count.kind === 'alive') {
    let n = 0;
    for (const actor of c.characters.values()) {
      if (actor.status !== 'alive') continue;
      const yes = publicCondition(v.count.where, {
        ...c,
        bindings: { ...c.bindings, it: actor.id },
      });
      if (yes === undefined) return unknown;
      if (yes) n++;
    }
    return n;
  }
  if (!('target' in v)) return unknown;
  const id = ref(v.target);
  if (!id) return unknown;
  const actor = c.characters.get(id);
  if ('field' in v && v.field === 'character') return actor?.character ?? unknown;
  if ('field' in v && v.field === 'area' && (!c.staticOnly || (c.moved && !c.moved.has(id))))
    return id === c.owner && c.virtualArea
      ? unknown
      : (actor?.area ?? (id in c.boards ? id : unknown));
  if (c.staticOnly) return unknown;
  if ('counter' in v) {
    if (!actor)
      return v.counter === 'intrigue' && id in c.boards
        ? c.boards[id as keyof typeof c.boards]
        : unknown;
    const n = actor.counters[v.counter];
    if (v.raw) return n;
    return v.counter === 'goodwill'
      ? n + actor.counters.hope
      : v.counter === 'paranoia'
        ? n + actor.counters.despair
        : v.counter === 'intrigue'
          ? Math.max(0, n + actor.counters.despair - actor.counters.hope)
          : n;
  }
  if ('field' in v) {
    if (v.field === 'paranoiaLimit' && actor)
      return actor.character === '仙人'
        ? 0
        : (c.pack.characters[actor.character]?.paranoia ?? unknown);
    if (v.field === 'status' || v.field === 'character') return actor?.[v.field] ?? unknown;
    // Identity, initial placement and mutable/private properties require explicit constraints.
    if (v.field === 'rawTotal' && actor)
      return Object.values(actor.counters).reduce((a, b) => a + b, 0);
    if (v.field === 'kinds' && actor)
      return Object.values(actor.counters).filter((n) => n > 0).length;
  }
  return unknown;
}
/** Strong Kleene logic: NOT unknown is unknown; absence of a fact is never false. */
export function publicCondition(v: Condition | undefined, c: PublicContext): boolean | undefined {
  if (v === undefined) return true;
  if (typeof v === 'boolean') return v;
  if ('all' in v) {
    const a = v.all.map((x) => publicCondition(x, c));
    return a.includes(false) ? false : a.every((x) => x === true) ? true : undefined;
  }
  if ('any' in v) {
    const a = v.any.map((x) => publicCondition(x, c));
    return a.includes(true) ? true : a.every((x) => x === false) ? false : undefined;
  }
  if ('not' in v) {
    const a = publicCondition(v.not, c);
    return a === undefined ? undefined : !a;
  }
  if ('incidentOccurred' in v && !c.staticOnly) return c.occurred?.(v.incidentOccurred);
  if ('attribute' in v) {
    const id = publicValue({ ref: v.target }, c);
    const actor = typeof id === 'string' ? c.characters.get(id) : undefined;
    const def = actor && c.pack.characters[actor.character];
    if (def?.attributes.includes(v.attribute)) return true;
    if (def && !['神灵', '模仿犯', '临时工？', 'UP主'].includes(actor!.character)) return false;
  }
  if ('cmp' in v) {
    const a = publicValue(v.left, c),
      b = publicValue(v.right, c);
    if (a === unknown || b === unknown) return undefined;
    return v.cmp === 'eq'
      ? a === b
      : v.cmp === 'ne'
        ? a !== b
        : v.cmp === 'ge'
          ? Number(a) >= Number(b)
          : v.cmp === 'gt'
            ? Number(a) > Number(b)
            : v.cmp === 'le'
              ? Number(a) <= Number(b)
              : Number(a) < Number(b);
  }
  return undefined;
}
export function publicNumber(v: Value, c: PublicContext) {
  const n = publicValue(v, c);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
