import type { Protection } from './death.js';
import type { PublicCharacter } from '../../../contracts/src/game.js';
import type { opening3 } from './opening.js';
import { boards } from './opening.js';
import { effectiveRole } from './effective.js';
import { matchDeaths } from './death.js';
import { gates } from './incident.js';
type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
export function majority(
  m: ReturnType<typeof opening3>,
  pieces: ReadonlyMap<string, Piece>,
  area: string,
  intrigue: number,
  reason: string,
) {
  if (!boards.includes(area)) return false;
  const weighted: (number | boolean)[] = [];
  let alive = 0;
  for (const [n, p] of pieces) {
    if (p.area !== area || !['dead', 'alive'].includes(p.status)) continue;
    const zombie = effectiveRole(m, n, '丧尸', p, new Set(), reason) ?? false;
    weighted.push(zombie);
    if (p.status === 'alive') {
      alive++;
      weighted.push(zombie);
    }
  }
  if (!alive) return false;
  for (let i = 0; i < intrigue; i++) weighted.push(m.plots['古墓活尸']!);
  const threshold = alive + 1 - weighted.filter((v) => v === true).length;
  const terms = weighted.filter((v): v is number => typeof v === 'number');
  if (threshold <= 0) return true;
  if (threshold > terms.length) return false;
  const id = m.graph.atom(reason + ' ' + area + ' 丧尸人数占优');
  m.graph.add(reason, terms, threshold, terms.length, id);
  m.graph.add(reason, terms, 0, threshold - 1, -id);
  return id;
}
export function madNightAtOccurrence(
  m: ReturnType<typeof opening3>,
  pieces: ReadonlyMap<string, Piece>,
  intrigue: Record<string, number>,
  causal: Set<string>,
  reason: string,
) {
  const corpses = [...pieces]
    .filter(([, p]) => p.status === 'dead')
    .map(([n, p]) => effectiveRole(m, n, '丧尸', p, causal, reason) ?? false);
  for (const b of boards)
    for (let i = 0; i < (intrigue[b] ?? 0); i++) corpses.push(m.plots['古墓活尸']!);
  const threshold = 6 - corpses.filter((k) => k === true).length;
  const terms = corpses.filter((k): k is number => typeof k === 'number');
  if (threshold <= 0) return true;
  if (threshold > terms.length) return false;
  const enough = m.graph.atom(reason + ' 疯狂之夜发生时有至少六具丧尸');
  m.graph.add(reason, terms, threshold, terms.length, enough);
  m.graph.add(reason, terms, 0, threshold - 1, -enough);
  return enough;
}

export function matchHsaHeroDeath(
  m: ReturnType<typeof opening3>,
  pieces: ReadonlyMap<string, Piece>,
  intrigue: Record<string, number>,
  homes: ReadonlyMap<string, string>,
  causal: Set<string>,
  night: boolean,
  delayed: number | boolean,
  stranded: boolean,
  reason: string,
) {
  const g = m.graph,
    gate = gates(g, reason);
  const corpseCounts: Record<string, number> = { ...intrigue };
  let corpseIntrigue = 0;
  for (const p of pieces.values())
    if (p.status === 'dead') {
      corpseCounts[p.area] = (corpseCounts[p.area] ?? 0) + 1;
      corpseIntrigue += Math.max(0, p.counters.intrigue + p.counters.despair - p.counters.hope);
    }
  const options: (number | boolean)[] = [delayed];
  if (stranded) options.push(m.plots['被诅咒的土地']!);
  for (const [n, p] of pieces) {
    if (p.status !== 'alive') continue;
    const role = (r: string) => effectiveRole(m, n, r, p, causal, reason) ?? false;
    if (night) options.push(role('狼人'));
    if (corpseIntrigue >= 3) options.push(role('梦魇'));
    if (
      p.counters.paranoia + p.counters.despair >= 3 &&
      p.counters.intrigue + p.counters.despair - p.counters.hope >= 1
    )
      options.push(role('求爱者'));
    const home = homes.get(n);
    if (home && (corpseCounts[home] ?? 0) >= 2) options.push(role('吸血鬼'));
    if (!home && Object.values(corpseCounts).some((c) => c >= 2)) {
      g.unsupported.add(reason + ' · ' + n + ' 的本轮初始区域未绑定');
      options.push(
        gate.all([role('吸血鬼'), g.atom(reason + ' ' + n + ' 的初始区域存在两具尸体')]),
      );
    }
  }
  const match = gate.any(options);
  if (match !== true)
    g.add(reason + ' · 日末主人公死亡须有相容来源', typeof match === 'number' ? [match] : [], 1);
  const live = options.filter((x): x is number => typeof x === 'number' && g.truth(x) !== false);
  if (!options.includes(true) && live.length)
    g.add(reason + ' · 日末主人公死亡来源', live, 1, live.length, undefined, true);
}
export function unchangedZombieWindow(
  m: ReturnType<typeof opening3>,
  pieces: ReadonlyMap<string, Piece>,
  intrigue: Record<string, number>,
  reason: string,
  causal: Set<string>,
  protection: Protection,
) {
  const gate = gates(m.graph, reason + ' 丧尸选择');
  const areas = boards.map((b) => majority(m, pieces, b, intrigue[b]!, reason));
  const spared = boards.map((b, i) => {
    const majority = areas[i]!;
    if (majority === false || (typeof majority === 'number' && m.graph.truth(majority) === false))
      return false;
    const residents = new Map([...pieces].filter(([, p]) => p.status === 'alive' && p.area === b));
    const options = [];
    for (const n of residents.keys()) {
      const silent = matchDeaths(
        m,
        residents,
        new Map([[n, 1]]),
        new Set(),
        new Map(),
        causal,
        reason + ' 丧尸选择 ' + n,
        protection,
      );
      if (silent === undefined) {
        m.graph.unsupported.add(reason + ' · 丧尸的从者追加替死对象未绑定');
        return majority;
      }
      options.push(silent);
    }
    return gate.all([majority, gate.any(options)]);
  });
  const match = gate.any([gate.not(gate.any(areas)), ...spared]);
  if (match !== true)
    m.graph.add(
      reason + ' · 丧尸必须在一块合法版图选择目标',
      typeof match === 'number' ? [match] : [],
      1,
    );
}

/** A moved corpse keeps its physical card. Forbidden areas apply only to living characters. */
export function matchZombieMove(
  m: ReturnType<typeof opening3>,
  board: ReadonlyMap<string, Piece>,
  intrigue: Readonly<Record<string, number>>,
  group: readonly import('../../../contracts/src/game.js').Observation[],
  causal: Set<string>,
) {
  const first = group[0]!,
    g = m.graph;
  const reason = '#' + first.sequence + ' · 日末丧尸移动尸体';
  const adjacent = (from: string, to: string) =>
    boards.includes(from) &&
    boards.includes(to) &&
    from !== to &&
    ![
      ['school', 'hospital'],
      ['city', 'shrine'],
    ].some((pair) => pair.includes(from) && pair.includes(to));
  const moves: { from: string; to: string; source: number | boolean | undefined }[] = [];
  const boardsChanged = group
    .filter(
      (o) =>
        o.type === 'board' &&
        typeof o.data.board === 'string' &&
        typeof o.data.intrigue === 'number',
    )
    .map((o) => ({
      name: String(o.data.board),
      delta: Number(o.data.intrigue) - intrigue[String(o.data.board)]!,
    }));
  if (boardsChanged.length === 2 && first.simultaneousSize !== undefined) {
    const from = boardsChanged.find((c) => c.delta === -1),
      to = boardsChanged.find((c) => c.delta === 1);
    if (from && to) moves.push({ from: from.name, to: to.name, source: m.plots['古墓活尸'] });
  }
  for (const o of group) {
    const n = m.names.get(String(o.data.character)),
      p = n && board.get(n);
    if (
      o.type !== 'character' ||
      !n ||
      !p ||
      p.status !== 'dead' ||
      o.data.status !== 'dead' ||
      typeof o.data.area !== 'string' ||
      p.area === o.data.area
    )
      continue;
    moves.push({
      from: p.area,
      to: o.data.area,
      source: effectiveRole(m, n, '丧尸', p, causal, reason),
    });
  }
  if (!moves.length) return false;
  if (moves.length > 1) g.add(reason + ' · 所有丧尸每日合计一次', [], 1);
  for (const { from, to, source } of moves) {
    if (!adjacent(from, to)) g.add(reason + ' · 目的地必须是相邻版图', [], 1);
    if (source === undefined) g.unsupported.add(reason + ' · 尸体身份未绑定');
    else if (source !== true)
      g.add(reason + ' · 读取移动时的尸体身份', typeof source === 'number' ? [source] : [], 1);
  }
  return true;
}
