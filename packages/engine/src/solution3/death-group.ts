import type { Protection } from './death.js';
import type { Observation, PublicCharacter } from '../../../contracts/src/game.js';
import { majority } from './zombie.js';
import { boards, type opening3 } from './opening.js';
import { gates } from './incident.js';
import { effectiveRole } from './effective.js';
import { meetsDayEndThreshold } from './day-end.js';
import { matchDeaths } from './death.js';

type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
type Fact = number | boolean;
/** Normal end-of-day. Only complete, explicitly delimited publications establish
 * a cut between the simultaneous mandatory attacks and subsequent optional attacks. */
export function matchDayEndGroup(
  m: ReturnType<typeof opening3>,
  pieces: Map<string, Piece>,
  group: Observation[],
  first: boolean,
  causal: Set<string>,
  protection: Protection,
  uses: Map<string, number[]>,
  virtualAreas: ReadonlyMap<string, string | undefined>,
  zombieBoards?: Record<string, number>,
  poison?: ReadonlyMap<string, Fact>,
) {
  const changed = new Set<string>(),
    died = new Set<string>(),
    final = new Map<string, Piece['counters']>();
  const affected = new Set<string>();
  for (const o of group) {
    if (o.type !== 'character') continue;
    const n = m.names.get(String(o.data.character)),
      p = n && pieces.get(n);
    const counters = o.data.counters as Piece['counters'] | undefined;
    if (!p || !n || !counters) return false;
    if (p.status !== 'alive' || (o.data.status !== 'dead' && counters.guard === p.counters.guard))
      continue;
    if (o.data.status === 'dead') died.add(n);
    changed.add(n);
    affected.add(p.area);
    final.set(n, counters);
  }
  if (!changed.size) return false;
  const sacrifice = m.data.identities.some((i) => i.name === '祭品')
    ? [...pieces].filter(([n, p]) => {
        const id = m.ids.get(n === '临时工？' ? '临时工' : n)?.['祭品'];
        return (
          id &&
          n !== '临时工' &&
          m.graph.truth(id) !== false &&
          p.status === 'alive' &&
          meetsDayEndThreshold('祭品', p.counters)
        );
      })
    : [];
  const relevant = new Set(affected);
  if (first && poison)
    for (const [n, due] of poison) {
      const p = pieces.get(n);
      if (p && (due === true || (typeof due === 'number' && m.graph.truth(due) !== false)))
        relevant.add(p.area);
    }
  for (let previous = -1; previous !== relevant.size; ) {
    previous = relevant.size;
    for (const [actor, remote] of virtualAreas) {
      const p = pieces.get(actor);
      if (p?.status !== 'alive') continue;
      if (remote === undefined) {
        m.graph.unsupported.add('#' + group[0]!.sequence + ' · ' + actor + ' 的代理区域未绑定');
        return false;
      }
      if (relevant.has(p.area) || relevant.has(remote)) {
        relevant.add(p.area);
        relevant.add(remote);
      }
    }
  }
  const local = new Map(
    [...pieces].filter(
      ([, p]) =>
        p.status === 'alive' &&
        (relevant.has(p.area) || sacrifice.length > 0 || Boolean(first && zombieBoards)),
    ),
  );
  const reason = '#' + group[0]!.sequence + ' 日末死亡及护卫批次',
    g = m.graph,
    gate = gates(g, reason);
  const role = (n: string, r: string) =>
    effectiveRole(m, n, r, pieces.get(n), causal, reason) ?? false;
  const choices: { source: Fact; targets: string[] }[] = [];
  const opt: Fact[] = [];
  if (sacrifice.length) {
    const match = matchDeaths(
      m,
      local,
      new Map([...local.keys()].map((n) => [n, 1])),
      died,
      final,
      causal,
      reason + ' 祭品使所有角色死亡',
      protection,
    );
    if (match === undefined) return false;
    for (const [n] of sacrifice) {
      const possible = gate.all([role(n, '祭品'), match]);
      if (possible === false) continue;
      const used = g.atom(reason + ' ' + n + ' 发动祭品');
      if (typeof possible === 'number')
        g.add(reason + ' 祭品身份与全场同时结算', [possible], 1, 1, used);
      const ownerKey = n + ' 祭品';
      const byOwner = [...(uses.get(ownerKey) ?? []), used];
      uses.set(ownerKey, byOwner);
      if (byOwner.length > 1) g.add(ownerKey + ' 该阶段限一次', byOwner, 0, 1);
      const prior = uses.get('祭品') ?? [];
      uses.set('祭品', [...prior, used]);
      // Each eligible owner has this ability once per day-end phase. Multiple
      // sacrifices, if present, may activate separately.
      opt.push(used);
    }
  }
  for (const [n, p] of local) {
    const remote = virtualAreas.get(n);
    const areas = remote && remote !== p.area ? [p.area, remote] : [p.area];
    const due = poison?.get(n);
    if (first && due && (due === true || g.truth(due) !== false)) {
      const targets = [...local].filter(([, q]) => areas.includes(q.area)).map(([t]) => t);
      choices.push({ source: due, targets });
    }
    const serial = gate.any([role(n, '杀人狂'), group[0]!.day % 3 === 0 ? role(n, '怪杰') : false]);
    if (first && serial !== false && (serial === true || g.truth(serial) !== false)) {
      const mode = areas.length === 2 ? g.atom(reason + ' ' + n + ' 以代理区域结算杀人狂') : false;
      for (const [i, area] of areas.entries()) {
        const others = [...local].filter(([t, q]) => t !== n && q.area === area);
        if (others.length === 1)
          choices.push({
            source: gate.all([serial, i === 0 ? gate.not(mode) : mode]),
            targets: [others[0]![0]],
          });
      }
    }
    if (n === '临时工' && Object.values(p.counters).reduce((a, b) => a + b, 0) >= 3)
      choices.push({ source: true, targets: [n] });
    if (
      first &&
      m.ids.get(n === '临时工？' ? '临时工' : n)?.['目击者'] &&
      meetsDayEndThreshold('目击者', p.counters)
    ) {
      const witness = role(n, '目击者');
      if (witness !== false) choices.push({ source: witness, targets: [n] });
    }
    for (const source of zombieBoards ? ['梦魇', '吸血鬼'] : ['杀手', '忍者']) {
      const owner = role(n, source);
      if (owner === false || (typeof owner === 'number' && g.truth(owner) === false)) continue;
      const targets = [...local].filter(([, q]) => affected.has(q.area) && areas.includes(q.area));
      const options: Fact[] = [];
      for (const [t, q] of targets) {
        if (source !== '梦魇' && q.counters.intrigue + q.counters.despair - q.counters.hope < 2)
          continue;
        g.work.sources.push(source + ' ' + n + ' → ' + t);
        g.work.combinations++;
        const match = matchDeaths(
          m,
          local,
          new Map([[t, 1]]),
          died,
          final,
          causal,
          reason + ' ' + source + ' ' + n + ' ' + t,
          protection,
        );
        if (match === undefined) return false;
        options.push(
          gate.all([source === '梦魇' || source === '忍者' || role(t, '关键人物'), match]),
        );
      }
      const possible = gate.all([owner, gate.any(options)]);
      if (possible === false) continue;
      const key = n + ' ' + source,
        used = g.atom(reason + ' 使用 ' + key);
      if (typeof possible === 'number')
        g.add(reason + ' · ' + key + ' 的身份、目标和死亡结算', [possible], 1, 1, used);
      const history = uses.get(key) ?? [];
      history.push(used);
      uses.set(key, history);
      if (history.length > 1) g.add(key + ' 该阶段限一次', history.slice(), 0, 1);
      opt.push(used);
    }
  }
  let result = gate.any(opt);
  if (first) {
    if (
      choices.length > 10 ||
      choices.reduce((count, c) => count * (1 + c.targets.length), 1) > 4096
    ) {
      g.unsupported.add(reason + ' · 同批强制请求局部预算');
      return false;
    }
    const alternatives: Fact[] = [];
    const settlements = new Map<string, Fact>();
    function visit(i: number, conditions: Fact[], requests: Map<string, number>) {
      const c = choices[i];
      if (!c) {
        g.work.combinations++;
        const key = JSON.stringify([...requests].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        let settlement = settlements.get(key);
        if (settlement === undefined) {
          const tag = reason + ' 请求 ' + key;
          const observed = matchDeaths(m, local, requests, died, final, causal, tag, protection);
          if (observed === undefined) return false;
          let quiet: Fact | undefined = false;
          if (result !== false && observed !== true)
            quiet = matchDeaths(
              m,
              local,
              requests,
              new Set(),
              new Map(),
              causal,
              tag + ' 无公开变化',
              protection,
            );
          if (quiet === undefined) return false;
          settlement = gate.any([observed, gate.all([quiet, result])]);
          settlements.set(key, settlement);
        }
        if (settlement !== false) alternatives.push(gate.all([...conditions, settlement]));
        return true;
      }
      const known = typeof c.source === 'boolean' ? c.source : g.truth(c.source);
      if (known !== true && !visit(i + 1, [...conditions, gate.not(c.source)], requests))
        return false;
      if (known !== false)
        for (const target of c.targets) {
          const hit = new Map(requests);
          hit.set(target, 1 + (hit.get(target) ?? 0));
          if (!visit(i + 1, [...conditions, c.source], hit)) return false;
        }
      return true;
    }
    if (zombieBoards) {
      const eligible = boards.map((b) => majority(m, pieces, b, zombieBoards[b] ?? 0, reason));
      const none = gate.not(gate.any(eligible));
      if (none !== false && !visit(0, [none], new Map())) return false;
      for (const [i, b] of boards.entries()) {
        const trigger = eligible[i]!;
        if (trigger === false || (typeof trigger === 'number' && g.truth(trigger) === false))
          continue;
        for (const [n, p] of local)
          if (p.area === b && !visit(0, [trigger], new Map([[n, 1]]))) return false;
      }
    } else if (!visit(0, [], new Map())) return false;
    result = gate.any(alternatives);
  }
  if (result !== true) g.add(reason, typeof result === 'number' ? [result] : [], 1);
  return true;
}
