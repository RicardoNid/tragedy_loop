import type { Observation, PublicCharacter } from '../../../contracts/src/game.js';
import { gates } from './incident.js';
import type { opening3 } from './opening.js';
type Fact = boolean | number;
type Piece = Pick<PublicCharacter, 'status' | 'counters'>;

/** LL A/B is a continuous check at the phase boundary and after each settled change.
 * Keep earlier qualifications until it is known whether this window ended normally. */
export class LLSpecialVictory {
  private readonly conditions = new Map<string, Fact>();
  private last?: Fact;
  private finalC?: Fact;
  private answeredC = false;
  private hopefulKeys(m: ReturnType<typeof opening3>, pieces: ReadonlyMap<string, Piece>) {
    const keys: number[] = [];
    for (const [n, p] of pieces)
      if (p.counters.hope >= 1 && (p.status === 'alive' || p.status === 'dead') && n !== '临时工') {
        const key = m.ids.get(n === '临时工？' ? '临时工' : n)?.['关键人物'];
        if (key) keys.push(key);
      }
    return keys;
  }
  enterFinal(
    m: ReturnType<typeof opening3>,
    pieces: ReadonlyMap<string, Piece>,
    carry: boolean,
    reason: string,
  ) {
    const g = gates(m.graph, reason);
    const disabled = carry && g.all([m.plots['最终计划']!, g.any(this.hopefulKeys(m, pieces))]);
    this.finalC = g.all([m.plots['我才是名侦探']!, g.not(disabled)]);
    this.answeredC = false;
  }
  answer(m: ReturnType<typeof opening3>, special: boolean, reason: string) {
    if (this.answeredC || this.finalC === undefined) return;
    const match = special ? this.finalC : gates(m.graph, reason).not(this.finalC);
    if (match !== true)
      m.graph.add(
        reason + ' · 最终决战前的 C 回答机会',
        typeof match === 'number' ? [match] : [],
        1,
      );
    this.answeredC = true;
  }
  observe(
    m: ReturnType<typeof opening3>,
    pieces: ReadonlyMap<string, Piece>,
    o: Observation,
    deaths: number,
    communications: number,
  ) {
    const plot =
      o.phase === 'day-end' && deaths >= 5
        ? '真正的怪物'
        : o.phase === 'protagonist-abilities' && communications >= 6
          ? '神话收集者'
          : undefined;
    if (!plot) return;
    const keys = this.hopefulKeys(m, pieces);
    const signature = plot + '/' + keys.join(',');
    let condition = this.conditions.get(signature);
    if (condition === undefined) {
      const reason = '#' + o.sequence + ' 达到特殊胜利标志门槛',
        gate = gates(m.graph, reason);
      const plan = gate.all([m.plots['最终计划']!, gate.any(keys)]);
      condition = gate.all([m.plots[plot]!, gate.not(plan)]);
      this.conditions.set(signature, condition);
    }
    this.last = condition;
  }
  close(m: ReturnType<typeof opening3>, o: Observation, complete: boolean, win: boolean) {
    if (complete)
      for (const condition of new Set(this.conditions.values()))
        if (condition !== false)
          m.graph.add(
            '#' + o.sequence + ' 完整经过 LL 特殊胜利窗口',
            typeof condition === 'number' ? [-condition] : [],
            1,
          );
    this.conditions.clear();
    if (!win) this.last = undefined;
  }
  won(m: ReturnType<typeof opening3>, why: string) {
    if (this.last !== undefined && this.last !== true)
      m.graph.add(
        why + ' · 获胜时仍具背叛者资格',
        typeof this.last === 'number' ? [this.last] : [],
        1,
      );
  }
}
