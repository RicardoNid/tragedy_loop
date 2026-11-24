import type { Protection } from './death.js';
import type { Observation, PublicCharacter } from '../../../contracts/src/game.js';
import { boards, type opening3 } from './opening.js';
import { matchDeaths } from './death.js';
type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;

/** Track physical curse cards by public id. Each optional script ability places one per loop. */
export class CurseHistory {
  private readonly locations = new Map<string, string>();
  private readonly uses = new Map<string, number[]>();
  private placements = 0;
  stranded = false;
  private expected = new Map<string, Set<string>>();
  private entry?: Map<string, Piece>;
  private returning = new Set<string>();
  private hits = new Map<string, number>();
  currentIds() {
    return new Set(this.locations.keys());
  }
  get pendingDeath() {
    return this.returning.size > 0;
  }
  enter(board: ReadonlyMap<string, Piece>, names: ReadonlyMap<string, string>) {
    this.expected.clear();
    this.entry = new Map(board);
    this.stranded = false;
    this.returning.clear();
    this.hits.clear();
    for (const [id, target] of this.locations) {
      if (boards.includes(target)) {
        const options = [...names]
          .filter(([, n]) => board.get(n)?.area === target && board.get(n)?.status === 'alive')
          .map(([key]) => key);
        if (!options.length) this.stranded = true;
        this.expected.set(id, new Set(options.length ? options : [target]));
      } else {
        const name = names.get(target) ?? '',
          piece = board.get(name);
        if (piece?.status === 'alive') {
          this.returning.add(id);
          this.hits.set(name, (this.hits.get(name) ?? 0) + 1);
        }
        if (piece && (piece.status === 'alive' || piece.status === 'dead'))
          this.expected.set(id, new Set([piece.area]));
      }
    }
  }
  settle(
    m: ReturnType<typeof opening3>,
    board: ReadonlyMap<string, Piece>,
    seq: number,
    causal: Set<string>,
    extra: Protection,
  ) {
    if (!this.entry || !this.hits.size || this.returning.size) return false;
    const reason = '#' + seq + ' · 日末附身诅咒返回版图前的死亡结算';
    const died = new Set(
      [...this.entry]
        .filter(([n, p]) => p.status === 'alive' && board.get(n)?.status === 'dead')
        .map(([n]) => n),
    );
    const counters = new Map([...board].map(([n, p]) => [n, p.counters]));
    const match = matchDeaths(m, this.entry, this.hits, died, counters, causal, reason, extra);
    if (match === undefined) m.graph.unsupported.add(reason + ' · 从者保护对象缺失');
    else if (match !== true) m.graph.add(reason, typeof match === 'number' ? [match] : [], 1);
    this.entry = undefined;
    return true;
  }
  close(m: ReturnType<typeof opening3>, o: Observation, complete: boolean) {
    if (complete)
      for (const [id, targets] of this.expected) {
        if (!targets.has(this.locations.get(id) ?? ''))
          m.graph.add('#' + o.sequence + ' · 诅咒 ' + id + ' 在完整日末缺少强制转移', [], 1);
      }
    this.expected.clear();
    this.entry = undefined;
  }
  reset() {
    this.locations.clear();
    this.uses.clear();
    this.placements = 0;
    this.expected.clear();
  }
  read(
    m: ReturnType<typeof opening3>,
    o: Observation,
    homes: ReadonlyMap<string, string>,
    pending: (reason: string) => void,
  ) {
    if (!Array.isArray(o.data.curses)) return;
    if (
      !o.data.curses.every((c) => c && typeof c.id === 'string' && typeof c.target === 'string')
    ) {
      pending('诅咒牌编号或目标缺少绑定');
      return;
    }
    const g = m.graph;
    for (const c of o.data.curses) {
      if (o.phase === 'loop-start' && !this.locations.has(c.id)) {
        const reason = '#' + o.sequence + ' · 轮回开始诅咒 ' + c.id;
        const choices: number[] = [];
        const plots: number[] = [];
        for (const [plot, role] of [
          ['被诅咒的土地', '鬼魂'],
          ['魔女遗咒', '魔女'],
        ] as const) {
          const rule = m.plots[plot]!;
          if (g.truth(rule) === false) continue;
          g.work.sources.push(plot + ' · ' + c.target);
          const candidates: number[] = [];
          for (const [n, row] of m.ids) {
            if (g.truth(row[role]!) === false) continue;
            // The configured identity of the part-timer belongs to the second card.
            const home =
              n === '临时工'
                ? homes.get('临时工？')
                : (homes.get(n) ??
                  (n === '转校生' ? 'school' : n === '神灵' ? 'shrine' : undefined));
            if (!home) pending(role + ' 的本轮初始区域未绑定');
            if (!home || home === c.target) candidates.push(row[role]!);
          }
          if (!boards.includes(c.target) || !candidates.length) continue;
          const use = g.atom(reason + ' 来源 ' + plot);
          choices.push(use);
          plots.push(rule);
          g.add(reason + ' · 来源规则', [rule], 1, 1, use);
          g.add(reason + ' · 初始区域与身份', candidates, 1, candidates.length, use, true);
          const prior = this.uses.get(plot) ?? [];
          prior.push(use);
          this.uses.set(plot, prior);
          if (prior.length > 1) g.add(plot + ' 每轮一次', prior.slice(), 0, 1);
        }
        g.add(reason + ' · 本牌一个放置来源', choices, 1, 1);
        g.add(reason + ' · 至少一条来源规则', plots, 1, plots.length, undefined, true);
        this.placements++;
        g.add(
          reason + ' · 每张新牌须有不同来源规则',
          [m.plots['被诅咒的土地']!, m.plots['魔女遗咒']!],
          this.placements,
          2,
        );
      }
      if (o.phase === 'day-end' && this.locations.get(c.id) !== c.target) {
        const targets = this.expected.get(c.id);
        if (targets && !targets.has(c.target))
          g.add('#' + o.sequence + ' · 诅咒 ' + c.id + ' 日末转移目标不合法', [], 1);
        this.expected.delete(c.id);
        this.returning.delete(c.id);
      }
    }
    this.locations.clear();
    for (const c of o.data.curses) this.locations.set(c.id, c.target);
  }
}
