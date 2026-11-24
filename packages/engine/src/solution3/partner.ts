import type { Observation, PublicCharacter } from '../../../contracts/src/game.js';
import type { opening3 } from './opening.js';
import { effectiveRole } from './effective.js';
import { gates } from './incident.js';

type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;
type Fact = number | boolean;
const partners = ['心上人', '求爱者'] as const;

/** Death cleanup finishes before the next independent step. Only living counterparts react. */
export class PartnerReactions {
  private pending?: {
    source: Observation;
    before: Map<string, Piece>;
    died: Set<string>;
    gains: Map<string, number>;
    incomplete: boolean;
  };

  observe(
    m: ReturnType<typeof opening3>,
    board: ReadonlyMap<string, Piece>,
    group: Observation[],
    causal: Set<string>,
    normalLastDay: boolean,
  ) {
    const first = group[0]!;
    const died = new Set<string>();
    for (const o of group) {
      const n = m.names.get(String(o.data.character));
      if (
        o.type === 'character' &&
        n &&
        board.get(n)?.status === 'alive' &&
        o.data.status === 'dead'
      )
        died.add(n);
    }
    if (
      this.pending &&
      (died.size || first.type === 'boundary' || first.phase !== this.pending.source.phase)
    ) {
      const prev = this.pending.source;
      const complete =
        (first.phase === prev.phase && died.size > 0) ||
        (prev.phase === 'incident' && first.phase === 'captain-change') ||
        (prev.phase === 'day-end' &&
          (first.phase === 'day-start' || (first.phase === 'loop-end' && normalLastDay)));
      this.match(m, causal, first.sequence, complete);
      this.pending = undefined;
    }
    if (died.size && ['incident', 'day-end'].includes(first.phase)) {
      this.pending = {
        source: first,
        before: new Map(board),
        died,
        gains: new Map(),
        incomplete: first.simultaneousSize === undefined,
      };
    }
    if (!this.pending) return;
    const changed = new Set<string>();
    for (const o of group) {
      const n = m.names.get(String(o.data.character));
      const previous = n && board.get(n);
      if (
        o.type !== 'character' ||
        !n ||
        !previous ||
        o.data.status !== 'alive' ||
        !o.data.counters
      )
        continue;
      const delta = (o.data.counters as Piece['counters']).paranoia - previous.counters.paranoia;
      if (delta < 6) continue;
      if (delta % 6 || o.simultaneousSize === undefined) this.pending.incomplete = true;
      else {
        this.pending.gains.set(n, (this.pending.gains.get(n) ?? 0) + delta / 6);
        changed.add(n);
      }
    }
    if (changed.size) this.match(m, causal, first.sequence, false, changed);
  }
  private match(
    m: ReturnType<typeof opening3>,
    causal: Set<string>,
    seq: number,
    complete: boolean,
    only?: ReadonlySet<string>,
  ) {
    const w = this.pending!;
    const reason = '#' + seq + ' · #' + w.source.sequence + ' 实际死亡后的恋人不安';
    if (w.incomplete) {
      m.graph.unsupported.add(reason + ' · 合批或不安变化量未绑定');
      return;
    }
    const g = m.graph,
      gate = gates(g, reason);
    const deadRoles = partners.map((role) =>
      [...w.died].map((n) => effectiveRole(m, n, role, w.before.get(n), causal, reason)),
    );
    if (deadRoles.some((list) => list.includes(undefined))) {
      g.unsupported.add(reason + ' · 死者身份未绑定');
      return;
    }
    for (const [n, p] of w.before) {
      if ((only && !only.has(n)) || p.status !== 'alive' || w.died.has(n)) continue;
      const count = w.gains.get(n) ?? 0;
      if (!count && !complete) continue;
      const owners: Fact[] = [];
      let bound = true;
      for (const [i, role] of partners.entries()) {
        const owner = effectiveRole(m, n, role, p, causal, reason);
        if (owner === undefined) {
          bound = false;
          g.unsupported.add(reason + ' · 生存角色身份未绑定');
          break;
        }
        if (owner === false || (typeof owner === 'number' && g.truth(owner) === false)) continue;
        owners.push(owner);
        const dead = deadRoles[1 - i]!;
        const terms = dead.filter((r): r is number => typeof r === 'number');
        const fixed = dead.filter((v) => v === true).length;
        if (count === 0 && terms.length === 0 && fixed === 0) continue;
        g.work.sources.push(n + ' · ' + role + ' 死亡后触发');
        g.add(
          reason + ' · ' + n + ' 从每名死亡的对应身份获得六不安',
          terms,
          Math.max(0, count - fixed),
          complete ? count - fixed : terms.length,
          owner === true ? undefined : owner,
        );
      }
      if (count && bound) {
        const required = gate.any(owners);
        if (required !== true)
          g.add(
            reason + ' · 获得六不安的生存角色',
            typeof required === 'number' ? [required] : [],
            1,
          );
      }
    }
  }
}
