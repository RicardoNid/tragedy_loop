import type { Protection } from './death.js';
import type { Counters, Observation, PublicCharacter } from '../../../contracts/src/game.js';
import { effectiveRole } from './effective.js';
import { matchDeaths, withProtection } from './death.js';
import { gates } from './incident.js';
import { boards, type opening3 } from './opening.js';

type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
type State = { pieces: Map<string, Piece>; boards: Record<string, number> };
type Change = {
  aggregated: boolean;
  group: number;
  name: string;
  piece?: Piece;
  intrigue?: number;
};

export const sequentialEvents = new Set([
  '自杀',
  '遗言',
  '谋杀',
  '连续杀人',
  '疯狂杀人',
  '集体自杀',
  '远距离杀人',
  '送葬',
  '代行者',
  '失踪',
  '可疑信件',
  '亵渎杀人',
  '阴谋活动',
  '猎奇杀人',
]);

const clockwise: Record<string, string> = {
  hospital: 'shrine',
  shrine: 'school',
  school: 'city',
  city: 'hospital',
};
export function incidentAreas(actor: string, physical: string) {
  const adjacent = actor === '仙人' && clockwise[physical];
  return adjacent ? [physical, adjacent] : [physical];
}

export function nestedChange(o: Observation, names: Map<string, string>): Change | undefined {
  const d = o.data,
    group = o.simultaneousGroup ?? o.sequence;
  if (o.type === 'board' && typeof d.board === 'string' && typeof d.intrigue === 'number')
    return {
      aggregated: o.simultaneousSize === undefined,
      group,
      name: d.board,
      intrigue: d.intrigue,
    };
  const name = names.get(String(d.character));
  if (o.type === 'character' && name && d.status && d.area && d.counters)
    return {
      aggregated: o.simultaneousSize === undefined,
      group,
      name,
      piece: d as unknown as Piece,
    };
  return undefined;
}

/** Each invocation picks one event text and sees the board left by the previous invocation. */
export function matchSequentialIncident(
  event: string,
  m: ReturnType<typeof opening3>,
  actor: string,
  entry: State,
  changes: Change[],
  causal: Set<string>,
  protection: Protection,
  label: string,
  selections: string[] = [],
  releasedMovement: ReadonlyMap<string, boolean> = new Map(),
): boolean | number | undefined {
  if (typeof protection === 'object' && ['失踪', '阴谋活动', '可疑信件'].includes(event)) {
    const area = entry.pieces.get('从者')?.area;
    const relevant = new Set(
      [...entry.pieces].filter(([n, p]) => n === actor || p.area === area).map(([n]) => n),
    );
    return withProtection(m, protection, relevant, label, (target) =>
      matchSequentialIncident(
        event,
        m,
        actor,
        entry,
        changes,
        causal,
        target,
        label + ' 保护 ' + (target ?? '其他角色'),
        selections,
        releasedMovement,
      ),
    );
  }
  const g = m.graph,
    gate = gates(g, label);
  const states = [entry];
  let group: number | undefined;
  for (const change of changes) {
    const before = states.at(-1)!;
    if (change.group !== group) {
      states.push({ pieces: new Map(before.pieces), boards: { ...before.boards } });
      group = change.group;
    }
    const next = states.at(-1)!;
    if (change.piece) next.pieces.set(change.name, change.piece);
    else if (change.intrigue !== undefined) next.boards[change.name] = change.intrigue;
  }
  const last = states.length - 1;
  function invocation(
    start: number,
    end: number,
    text = event,
    use = 0,
  ): boolean | number | undefined {
    const before = states[start]!,
      after = states[end]!,
      executor = before.pieces.get(actor);
    if (!executor) return undefined;
    const died = new Set<string>(),
      moved = new Set<string>(),
      boardChanges = new Set<string>();
    let guardChanged = false,
      moves = 0,
      boardUpdates = 0;
    for (let i = start + 1; i <= end; i++) {
      const previous = states[i - 1]!,
        current = states[i]!;
      for (const b of boards)
        if (previous.boards[b] !== current.boards[b]) {
          boardChanges.add(b);
          boardUpdates++;
        }
      for (const [n, p] of current.pieces) {
        const prior = previous.pieces.get(n);
        if (!prior) return undefined;
        if (p.area !== prior.area) {
          moved.add(n);
          moves++;
        }
        if (prior.status === 'alive' && p.status === 'dead') died.add(n);
        if (p.counters.guard !== prior.counters.guard) guardChanged = true;
      }
    }
    const counters = new Map<string, Counters>([...after.pieces].map(([n, p]) => [n, p.counters]));
    if (text === '自杀' || text === '遗言') {
      if (moved.size || boardChanges.size) return false;
      const hits = new Map<string, number>();
      if (executor.status === 'alive') hits.set(actor, 1);
      return matchDeaths(
        m,
        before.pieces,
        hits,
        died,
        counters,
        causal,
        label + ' 自杀 ' + start + '–' + end,
        protection,
      );
    }
    const destination = after.pieces.get(actor)!.area;
    const servant = before.pieces.get('从者');
    const follow =
      servant?.status === 'alive' &&
      servant.area === executor.area &&
      (protection === actor || actor === '大小姐' || actor === '大人物');
    if (protection === '未绑定' && servant?.status === 'alive') return undefined;
    const followerMoves = follow && destination !== executor.area;
    const twins = effectiveRole(m, actor, '双胞胎', executor, causal, label) ?? false;
    const opposite: Record<string, string> = {
      shrine: 'city',
      city: 'shrine',
      hospital: 'school',
      school: 'hospital',
    };
    function located(base: string, test: (area: string) => boolean): number | boolean {
      const normal = incidentAreas(actor, base).some(test);
      if (twins === false || !opposite[base]) return normal;
      const other = incidentAreas(actor, opposite[base]!).some(test);
      if (normal === other) return normal;
      return other ? twins : gate.not(twins);
    }
    const disappearance =
      moves === moved.size &&
      boardUpdates <= 1 &&
      !guardChanged &&
      !died.size &&
      boards.includes(destination) &&
      (destination === executor.area ||
        !(m.data.forbidden.get(actor) ?? []).includes(destination) ||
        releasedMovement.has(actor)) &&
      [...moved].every((n) => n === actor || (n === '从者' && followerMoves)) &&
      (!followerMoves || after.pieces.get('从者')?.area === destination) &&
      located(
        destination,
        (area) =>
          [...boardChanges].every((b) => b === area) &&
          after.boards[area] === Math.min(3, before.boards[area]! + 1),
      );
    if (text === '可疑信件') {
      if (boardChanges.size || died.size || guardChanged || moves !== moved.size) return false;
      if (!moved.size) return true; // Choosing the current board produces no movement.
      const options: (number | boolean)[] = [];
      for (const target of moved) {
        const piece = before.pieces.get(target)!;
        const to = after.pieces.get(target)!.area;
        if (
          piece.status !== 'alive' ||
          !boards.includes(to) ||
          (m.data.forbidden.get(target)?.includes(to) && !releasedMovement.has(target))
        )
          continue;
        const joined =
          servant?.status === 'alive' &&
          target !== '从者' &&
          servant.area === piece.area &&
          (target === '大小姐' || target === '大人物' || protection === target);
        if (
          [...moved].some(
            (n) => n !== target && !(n === '从者' && joined && after.pieces.get(n)?.area === to),
          )
        )
          continue;
        // A previous letter can immobilize the servant while its charge still moves.
        options.push(located(executor.area, (area) => piece.area === area));
      }
      return gate.any(options);
    }
    if (text === '失踪') return disappearance;
    if (text === '阴谋活动' && disappearance === true) return true;
    if (
      text === '亵渎杀人' &&
      !moves &&
      !guardChanged &&
      !died.size &&
      boardUpdates <= 1 &&
      incidentAreas(actor, executor.area).some(
        (area) =>
          [...boardChanges].every((b) => b === area) &&
          (!boards.includes(area) || after.boards[area] === Math.min(3, before.boards[area]! + 1)),
      )
    )
      return true;

    if (moved.size || boardChanges.size) return false;
    if (text === '集体自杀') {
      const enabled =
        executor.counters.intrigue + executor.counters.despair - executor.counters.hope >= 1;
      const matches = [];
      for (const area of incidentAreas(actor, executor.area)) {
        const hits = new Map<string, number>();
        if (enabled)
          for (const [name, p] of before.pieces)
            if (p.status === 'alive' && (name === actor || p.area === area)) hits.set(name, 1);
        g.work.combinations++;
        const match = matchDeaths(
          m,
          before.pieces,
          hits,
          died,
          counters,
          causal,
          label + ' 集体自杀 ' + area,
          protection,
        );
        if (match === undefined) return undefined;
        matches.push(match);
      }
      return gate.any(matches);
    }
    function kills(base: string): boolean | number | undefined {
      const candidates = new Set<string>();
      for (const area of incidentAreas(actor, base)) {
        const occupants = [...before.pieces].filter(([n, p]) => {
          if (p.status !== 'alive') return false;
          if (text === '远距离杀人')
            return p.counters.intrigue + p.counters.despair - p.counters.hope >= 2;
          if (text === '送葬' || text === '代行者')
            return !selections[use] || n === selections[use];
          if (n === actor) return text === '疯狂杀人';
          return p.area === area;
        });
        if (
          !occupants.length &&
          !guardChanged &&
          !died.size &&
          text !== '亵渎杀人' &&
          (!(text === '送葬' || text === '代行者') || !selections[use])
        )
          return true;
        for (const [n] of occupants) candidates.add(n);
      }
      const alternatives = [];
      for (const n of candidates) {
        g.work.combinations++;
        const result = matchDeaths(
          m,
          before.pieces,
          new Map([[n, 1]]),
          died,
          counters,
          causal,
          label + ' ' + start + '–' + end + ' 连续杀人 ' + n,
          protection,
        );
        if (result === undefined) return undefined;
        alternatives.push(result);
      }
      return gate.any(alternatives);
    }
    const normal = kills(executor.area);
    if (twins === false || normal === undefined || !opposite[executor.area]) return normal;
    const other = kills(opposite[executor.area]!);
    return other === undefined
      ? undefined
      : gate.any([gate.all([twins, other]), gate.all([gate.not(twins), normal])]);
  }
  if (event === '猎奇杀人') {
    // Each visible change belongs to one native step. The three steps and the
    // optional repeat read their own entry snapshots. The fool clears only after completion.
    type Delta = { name: string; field: keyof Counters; delta: number };
    const batches = states.slice(1).map((after, i) => {
      const before = states[i]!;
      const deltas: Delta[] = [];
      let spatial = false,
        damage = false;
      for (const [n, p] of after.pieces) {
        const old = before.pieces.get(n)!;
        if (!old) return undefined;
        if (old.area !== p.area) spatial = true;
        if (old.status !== p.status) damage = true;
        for (const field of Object.keys(p.counters) as (keyof Counters)[]) {
          const delta = p.counters[field] - old.counters[field];
          if (!delta) continue;
          if (field === 'guard') damage = true;
          else deltas.push({ name: n, field, delta });
        }
      }
      if (boards.some((b) => before.boards[b] !== after.boards[b])) spatial = true;
      return { spatial, damage, deltas };
    });
    if (batches.some((b) => !b || b.spatial || (b.damage && b.deltas.length))) return undefined;
    function hunt(start: number, repeat: boolean): number | boolean | undefined {
      let end = start;
      while (batches[end]?.damage) end++;
      const death = invocation(start, end, '连续杀人');
      if (death === undefined || death === false) return death;
      const alive = [...states[end]!.pieces]
        .filter(([, p]) => p.status === 'alive')
        .map(([n]) => n);
      if (alive.length) {
        const first = batches[end]?.deltas;
        if (
          first?.length !== 1 ||
          first[0]!.field !== 'paranoia' ||
          first[0]!.delta !== 2 ||
          !alive.includes(first[0]!.name)
        )
          return false;
        end++;
        if (alive.length > 1) {
          const second = batches[end]?.deltas;
          if (
            second?.length !== 1 ||
            second[0]!.field !== 'intrigue' ||
            second[0]!.delta !== 1 ||
            !alive.includes(second[0]!.name) ||
            first[0]!.name === second[0]!.name
          )
            return false;
          end++;
        }
      }
      if (repeat) {
        const next = hunt(end, false);
        return next === undefined ? undefined : gate.all([death, next]);
      }
      const executor = states[end]!.pieces.get(actor)!;
      const fool =
        executor.status === 'alive' && executor.counters.paranoia > 0
          ? (effectiveRole(m, actor, '愚者', executor, causal, label) ?? false)
          : false;
      if (end === last) return gate.all([death, gate.not(fool)]);
      const clear = batches[end]?.deltas;
      if (
        end + 1 !== last ||
        clear?.length !== 1 ||
        clear[0]!.field !== 'paranoia' ||
        clear[0]!.name !== actor ||
        clear[0]!.delta !== -executor.counters.paranoia
      )
        return false;
      return gate.all([death, fool]);
    }
    return hunt(0, actor === '教主');
  }
  // Legacy transcripts can combine two hits on the same card into one final snapshot.
  // With no eligible substitute the final guards/death are equivalent to a two-hit batch.
  const executor = entry.pieces.get(actor);
  const servant = entry.pieces.get('从者');
  if (
    event === '自杀' &&
    actor === '教主' &&
    executor &&
    changes.every((c) => c.aggregated && c.name === actor && c.piece?.area === executor.area) &&
    !(
      servant?.status === 'alive' &&
      servant.area === executor.area &&
      (protection === actor || protection === '未绑定')
    )
  ) {
    const finalPiece = states[last]!.pieces.get(actor)!;
    return matchDeaths(
      m,
      entry.pieces,
      new Map([[actor, 2]]),
      new Set(finalPiece.status === 'dead' ? [actor] : []),
      new Map([[actor, finalPiece.counters]]),
      causal,
      label + ' 两次自杀的累计结果',
      protection,
    );
  }
  if (actor !== '教主') return invocation(0, last);
  const alternatives = [];
  for (let split = 0; split <= last; split++) {
    g.work.combinations++;
    // With a single public choice either invocation may have auto-selected its target.
    const bindings =
      selections.length === 1
        ? [
            [0, 1],
            [1, 0],
          ]
        : [[0, 1]];
    for (const [left, right] of bindings) {
      const first = invocation(0, split, event, left);
      if (first === false) continue;
      const second = invocation(split, last, event, right);
      if (second === false) continue;
      if (first === undefined || second === undefined) return undefined;
      alternatives.push(gate.all([first, second]));
    }
  }
  return gate.any(alternatives);
}
