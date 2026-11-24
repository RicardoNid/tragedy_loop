import type { PublicCharacter, Counters } from '../../../contracts/src/game.js';
import { effectiveRole } from './effective.js';
import { gates } from './incident.js';
import type { opening3 } from './opening.js';

type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;
export type Protection = string | ReadonlyMap<string, number> | undefined;
type Fact = number | boolean;
/** Group target choices that this settlement cannot distinguish. Each choice is the same
 * immutable, per-declaration proposition at every subsequent use in the loop. */
export function withProtection(
  m: ReturnType<typeof opening3>,
  binding: ReadonlyMap<string, number>,
  relevant: ReadonlySet<string>,
  reason: string,
  match: (target: string | undefined) => Fact | undefined,
): Fact | undefined {
  const gate = gates(m.graph, reason);
  const other: number[] = [],
    options: Fact[] = [];
  for (const [target, lit] of binding) {
    if (m.graph.truth(lit) === false) continue;
    if (!relevant.has(target)) {
      other.push(lit);
      continue;
    }
    m.graph.work.combinations++;
    const result = match(target);
    if (result === undefined) return undefined;
    options.push(gate.all([lit, result]));
  }
  if (other.length) {
    m.graph.work.combinations++;
    const result = match(undefined);
    if (result === undefined) return undefined;
    options.push(gate.all([gate.any(other), result]));
  }
  return gate.any(options);
}
/** Simultaneous direct hits share entry positions. Resolve immunity and guards before redirecting a hit. */
export function matchDeaths(
  m: ReturnType<typeof opening3>,
  pieces: ReadonlyMap<string, Piece>,
  requests: ReadonlyMap<string, number>,
  died: ReadonlySet<string>,
  finalCounters: ReadonlyMap<string, Counters>,
  causal: Set<string>,
  label: string,
  extraProtection: Protection,
): Fact | undefined {
  if (typeof extraProtection === 'object') {
    const servant = pieces.get('从者');
    const affected = new Set(
      [...requests.keys()].filter(
        (n) =>
          servant?.status === 'alive' &&
          pieces.get(n)?.area === servant.area &&
          !['从者', '大小姐', '大人物'].includes(n),
      ),
    );
    if (!affected.size)
      return matchDeaths(m, pieces, requests, died, finalCounters, causal, label, undefined);
    return withProtection(m, extraProtection, affected, label, (target) =>
      matchDeaths(
        m,
        pieces,
        requests,
        died,
        finalCounters,
        causal,
        label + ' 保护 ' + (target ?? '其他角色'),
        target,
      ),
    );
  }
  const g = m.graph,
    gate = gates(g, label),
    matches: (boolean | number)[] = [];
  const servant = pieces.get('从者'),
    redirected: (number | boolean)[] = [];
  // Only the servant can receive a request that was originally addressed elsewhere.
  for (const [n, p] of pieces)
    if (
      n !== '从者' &&
      p.status === 'alive' &&
      !(requests.get(n) ?? 0) &&
      (died.has(n) || (finalCounters.get(n)?.guard ?? p.counters.guard) !== p.counters.guard)
    )
      return false;
  const immune = (n: string, p: Piece) => {
    const roles = m.data.identities.filter(
      (i) => i.immortal && (i.name !== '纸老虎' || p.counters.paranoia + p.counters.despair < 2),
    );
    const fact = gate.any(roles.map((i) => effectiveRole(m, n, i.name, p, causal, label) ?? false));
    const row = m.ids.get(n === '临时工？' ? '临时工' : n);
    if (typeof fact === 'number' && row && n !== '临时工') {
      const candidates = roles.map((i) => row[i.name]!);
      g.add(label + ' · 不死的配置来源', candidates, 1, candidates.length, fact, true);
      const excluded = Object.values(row).filter((x) => !candidates.includes(x));
      g.add(label + ' · 不死与其他配置身份互斥', excluded, 0, 0, fact);
    }
    return fact;
  };
  if (
    extraProtection === '未绑定' &&
    servant?.status === 'alive' &&
    [...requests.keys()].some((n) => pieces.get(n)?.area === servant.area)
  )
    return undefined;
  for (const [n, p] of pieces) {
    if (p.status !== 'alive' || n === '从者') continue;
    const hit = requests.get(n) ?? 0;
    const spent = p.counters.guard - (finalCounters.get(n)?.guard ?? p.counters.guard);
    if (!hit) continue;
    g.work.sources.push(label + ' 死亡请求 ' + n);
    const blocked = immune(n, p),
      protectedByServant =
        servant?.status === 'alive' &&
        servant.area === p.area &&
        (['大小姐', '大人物'].includes(n) || extraProtection === n);
    if (protectedByServant)
      for (let i = p.counters.guard; i < hit; i++) redirected.push(gate.not(blocked));
    matches.push(
      gate.any([
        gate.all([blocked, !died.has(n) && spent === 0]),
        gate.all([
          gate.not(blocked),
          spent === Math.min(hit, p.counters.guard) &&
            died.has(n) === (!protectedByServant && hit > p.counters.guard),
        ]),
      ]),
    );
  }
  if (
    servant?.status === 'alive' &&
    (redirected.length ||
      requests.has('从者') ||
      died.has('从者') ||
      (finalCounters.get('从者')?.guard ?? servant.counters.guard) !== servant.counters.guard)
  ) {
    g.work.sources.push(label + ' 从者的直接及替代请求');
    const blocked = immune('从者', servant);
    const hits = redirected.filter((x): x is number => typeof x === 'number');
    const fixed = (requests.get('从者') ?? 0) + redirected.filter((x) => x === true).length;
    const guard = servant.counters.guard,
      spent = guard - (finalCounters.get('从者')?.guard ?? guard);
    const dead = died.has('从者');
    const min = (dead ? guard + 1 : spent) - fixed,
      max = dead ? hits.length : spent - fixed;
    let ordinary: boolean | number =
      spent >= 0 && spent <= guard && (!dead || spent === guard) && min <= hits.length && max >= 0;
    if (ordinary && (min > 0 || max < hits.length)) {
      const atLeast = (limit: number): boolean | number => {
        if (limit <= 0) return true;
        if (limit > hits.length) return false;
        const count = g.atom(label + ' 从者收到至少 ' + limit + ' 项替死请求');
        g.add(label, hits, limit, hits.length, count);
        g.add(label, hits, 0, limit - 1, -count);
        return count;
      };
      ordinary = gate.all([atLeast(min), gate.not(atLeast(max + 1))]);
    }
    matches.push(
      gate.any([
        gate.all([blocked, !dead && spent === 0]),
        gate.all([gate.not(blocked), ordinary]),
      ]),
    );
  }
  return gate.all(matches);
}
