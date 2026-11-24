import type { Protection } from './death.js';
import type { Observation, PublicCharacter } from '../../../contracts/src/game.js';
import type { Ability } from '../runtime/model.js';
import type { opening3 } from './opening.js';
import { gates } from './incident.js';
import { effectiveRole } from './effective.js';
import { matchDeaths } from './death.js';
type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
type Fact = number | boolean;

const poison: Ability = {
  id: 'poisoner-character',
  source: 'facts/text/modules/bee371fd65b819b7.txt',
  timing: 'day-end',
  mandatory: true,
  loopLimit: 1,
  condition: { cmp: 'ge', left: { game: 'ex' }, right: 2 },
  steps: [
    {
      choices: [
        {
          key: 'target',
          options: {
            kind: 'alive',
            where: {
              cmp: 'eq',
              left: { field: 'area', target: '$it' },
              right: { field: 'area', target: '$self' },
            },
          },
        },
      ],
      effects: [{ op: 'kill', target: '$target' }],
    },
  ],
};

/** The poisoner spends its once-per-loop use even when a legal attack leaves no public change. */
export class PoisonHistory {
  readonly current = new Map<string, Fact>();
  private readonly spent = new Map<string, Fact>();
  private loop = 0;
  private day = 0;
  enter(
    m: ReturnType<typeof opening3>,
    pieces: ReadonlyMap<string, Piece>,
    o: Observation,
    ex: number | undefined,
    causal: Set<string>,
  ) {
    this.current.clear();
    if (o.loop !== this.loop) {
      this.loop = o.loop;
      this.day = 0;
      this.spent.clear();
    }
    const reason = '#' + o.sequence + ' 投毒者日末强制请求',
      gate = gates(m.graph, reason);
    const knownHistory = this.day === o.day - 1;
    this.day = o.day;
    const condition = poison.condition;
    if (
      !condition ||
      typeof condition !== 'object' ||
      !('cmp' in condition) ||
      condition.cmp !== 'ge' ||
      typeof condition.right !== 'number'
    )
      throw Error('投毒者 EX 条件资产无效');
    const eligible =
      ex === undefined ? m.graph.atom(reason + ' EX 等级未绑定') : ex >= condition.right;
    for (const [n, p] of pieces) {
      if (!knownHistory)
        this.spent.set(
          n,
          gate.any([this.spent.get(n) ?? false, m.graph.atom(reason + n + ' 缺失日期可能已使用')]),
        );
      if (!eligible || p.status !== 'alive') continue;
      const role = effectiveRole(m, n, '投毒者', p, causal, reason) ?? false;
      const old = this.spent.get(n) ?? false;
      const due = gate.all([role, eligible, gate.not(old)]);
      if (due === false || (typeof due === 'number' && m.graph.truth(due) === false)) continue;
      this.current.set(n, due);
      this.spent.set(n, gate.any([old, due]));
    }
  }
  quiet(
    m: ReturnType<typeof opening3>,
    pieces: ReadonlyMap<string, Piece>,
    causal: Set<string>,
    protection: Protection,
    reason: string,
  ) {
    const gate = gates(m.graph, reason);
    for (const [n, due] of this.current) {
      if (n === '大人物' || n === 'UP主') {
        m.graph.unsupported.add(reason + ' · 投毒者的代理区域须与该次选择共同匹配');
        continue;
      }
      const area = pieces.get(n)?.area;
      const local = new Map([...pieces].filter(([, p]) => p.status === 'alive' && p.area === area));
      const results = [...local.keys()].map((target) => {
        m.graph.work.combinations++;
        return matchDeaths(
          m,
          local,
          new Map([[target, 1]]),
          new Set(),
          new Map(),
          causal,
          reason + ' 投毒者 ' + n + ' → ' + target,
          protection,
        );
      });
      if (results.some((r) => r === undefined)) {
        m.graph.unsupported.add(reason + ' · 投毒者的替死对象未绑定');
        continue;
      }
      const match = gate.any([gate.not(due), ...(results as Fact[])]);
      if (match !== true)
        m.graph.add(
          reason + ' · 投毒者必须能选择没有公开变化的目标',
          typeof match === 'number' ? [match] : [],
          1,
        );
    }
  }
}
