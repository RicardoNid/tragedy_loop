import type { Protection } from './death.js';
import type { Ability, Condition, Selector, Value, Effect } from '../runtime/model.js';
import type { PublicCharacter } from '../../../contracts/src/game.js';
import { effectiveRole } from './effective.js';
import { majority } from './zombie.js';
import { gates } from './incident.js';
import type { opening3 } from './opening.js';

const atLeast = (counter: 'paranoia' | 'intrigue', amount: number): Condition => ({
  cmp: 'ge',
  left: { counter, target: '$self' },
  right: amount,
});
const hero: Effect = { op: 'protagonist-death' };
const thresholds = {
  杀手: {
    id: 'killer-protagonists',
    timing: 'day-end',
    source: 'facts/text/modules/6145e115e8bfb5ab.txt',
    condition: atLeast('intrigue', 4),
    steps: [{ effects: [hero] }],
  },
  求爱者: {
    id: 'lover-protagonists',
    timing: 'day-end',
    source: 'facts/text/modules/f497855359fe9b6e.txt',
    condition: { all: [atLeast('intrigue', 1), atLeast('paranoia', 3)] },
    steps: [{ effects: [hero] }],
  },
  祭品: {
    id: 'sacrifice',
    timing: 'day-end',
    source: 'facts/text/modules/f7c96b28229536d3.txt',
    condition: { all: [atLeast('intrigue', 2), atLeast('paranoia', 2)] },
    steps: [
      {
        effects: [
          { op: 'each', selector: { kind: 'alive' }, effects: [{ op: 'kill', target: '$it' }] },
          hero,
        ],
      },
    ],
  },
  目击者: {
    id: 'witness',
    timing: 'day-end',
    mandatory: true,
    source: 'facts/text/modules/f7c96b28229536d3.txt',
    condition: atLeast('paranoia', 4),
    steps: [
      {
        effects: [
          { op: 'kill', target: '$self' },
          { op: 'ex', amount: 1 },
        ],
      },
    ],
  },
} satisfies Record<string, Ability>;
/** Bound subset of the native day-end abilities above. Conditions read the acting piece at settlement. */
export function meetsDayEndThreshold(
  owner: keyof typeof thresholds,
  counters: PublicCharacter['counters'],
) {
  function read(condition: Condition): boolean {
    if (typeof condition === 'object' && 'all' in condition) return condition.all.every(read);
    if (
      typeof condition === 'object' &&
      'cmp' in condition &&
      condition.cmp === 'ge' &&
      typeof condition.right === 'number' &&
      typeof condition.left === 'object' &&
      condition.left &&
      'counter' in condition.left &&
      condition.left.target === '$self'
    ) {
      const k = condition.left.counter;
      const v =
        k === 'intrigue'
          ? counters.intrigue + counters.despair - counters.hope
          : k === 'paranoia'
            ? counters.paranoia + counters.despair
            : counters[k];
      return Math.max(0, v) >= condition.right;
    }
    throw Error('日末身份阈值资产使用了未登记条件');
  }
  return read(thresholds[owner]!.condition!);
}

const others: Selector = {
  kind: 'alive',
  where: {
    all: [
      { cmp: 'ne', left: { ref: '$it' }, right: { ref: '$self' } },
      {
        cmp: 'eq',
        left: { field: 'area', target: '$it' },
        right: { field: 'area', target: '$self' },
      },
    ],
  },
};
const serial: Ability = {
  id: 'serial-killer',
  source: 'facts/text/modules/6145e115e8bfb5ab.txt',
  timing: 'day-end',
  mandatory: true,
  condition: { cmp: 'eq', left: { count: others }, right: 1 },
  steps: [
    { effects: [{ op: 'each', selector: others, effects: [{ op: 'kill', target: '$it' }] }] },
  ],
};
type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
type Pieces = Map<string, Piece>;

/** This reader accepts exactly the native nodes used by the registered ability. */
function publicTargets(ability: Ability, self: string, pieces: Pieces) {
  function value(v: Value, it: string): unknown {
    if (typeof v !== 'object' || v === null) return v;
    if ('ref' in v) return v.ref === '$it' ? it : self;
    if ('field' in v && v.field === 'area') return pieces.get(v.target === '$it' ? it : self)?.area;
    if ('count' in v) return select(v.count).length;
    throw Error('未绑定的回合结束值');
  }
  function test(c: Condition, it: string): boolean {
    if (typeof c === 'boolean') return c;
    if ('all' in c) return c.all.every((x) => test(x, it));
    if ('cmp' in c && ['eq', 'ne'].includes(c.cmp))
      return (value(c.left, it) === value(c.right, it)) === (c.cmp === 'eq');
    throw Error('未绑定的回合结束条件');
  }
  function select(s: Selector) {
    if (s.kind !== 'alive') throw Error('未绑定的选择范围');
    return [...pieces]
      .filter(([id, p]) => p.status === 'alive' && test(s.where ?? true, id))
      .map(([id]) => id);
  }
  if (!test(ability.condition ?? true, self)) return [];
  return ability.steps.flatMap((s) =>
    s.effects.flatMap((e) => {
      if (e.op !== 'each' || !e.effects.every((k) => k.op === 'kill' && k.target === '$it'))
        throw Error('未绑定的回合结束效果');
      return select(e.selector);
    }),
  );
}
export function dayEndDeath(
  m: ReturnType<typeof opening3>,
  pieces: Pieces,
  victim: string,
  died: boolean,
  reason: string,
  state: {
    day: number;
    ex?: number;
    causal: Set<string>;
    postCurse?: Record<string, number>;
    extraProtection?: Protection;
  },
) {
  const target = pieces.get(victim);
  if (!target || target.status !== 'alive') return false;
  if (
    died &&
    [...pieces].some(
      ([name, p]) => p.status === 'alive' && ['从者', '大人物', 'UP主', '临时工？'].includes(name),
    )
  )
    return false;
  const g = m.graph;
  const { any, all, not } = gates(g, reason + ' ' + victim);
  const terms: (number | boolean)[] = [];
  const targetRow = m.ids.get(victim === '临时工？' ? '临时工' : victim);
  if (!targetRow) return false;
  const role = (n: string, r: string) =>
    effectiveRole(m, n, r, pieces.get(n), state.causal, reason) ?? false;
  const immune = any(
    m.data.identities
      .filter(
        (i) =>
          i.immortal &&
          !(i.name === '纸老虎' && target.counters.paranoia + target.counters.despair >= 2),
      )
      .map((i) => role(victim, i.name)),
  );
  // A curse or corpse-majority execution may independently explain a positive HSA report.
  if (died && targetRow['丧尸']) {
    if (!state.postCurse) return false;
    terms.push(majority(m, pieces, target.area, state.postCurse[target.area] ?? 0, reason));
  }
  if (targetRow['目击者'] && meetsDayEndThreshold('目击者', target.counters))
    terms.push(role(victim, '目击者'));
  if (died && targetRow['祭品'])
    for (const [n, p] of pieces)
      if (p.status === 'alive' && meetsDayEndThreshold('祭品', p.counters))
        terms.push(role(n, '祭品'));
  const intrigue = Math.max(
    0,
    target.counters.intrigue + target.counters.despair - target.counters.hope,
  );
  if (died && target.counters.guard > 0) return false; // Multiple established requests can consume guard and then kill.
  for (const [name, p] of pieces) {
    if (p.status !== 'alive' || p.area !== target.area) continue;
    if (!died && (name === '大人物' || name === 'UP主')) continue;
    const row = m.ids.get(name === '临时工？' ? '临时工' : name);
    if (!row) return false;
    if (died && row['梦魇']) terms.push(role(name, '梦魇'));
    if (died && intrigue >= 2 && row['吸血鬼'])
      terms.push(all([role(name, '吸血鬼'), role(victim, '关键人物')]));
    if (publicTargets(serial, name, pieces).includes(victim)) {
      g.work.sources.push('杀人狂 ' + name);
      terms.push(role(name, '杀人狂'));
      if (state.day % 3 === 0) terms.push(role(name, '怪杰'));
    }
    if (died && intrigue >= 2) {
      if (row['杀手']) {
        g.work.sources.push('杀手 ' + name);
        terms.push(all([role(name, '杀手'), role(victim, '关键人物')]));
      }
      if (row['忍者']) {
        g.work.sources.push('忍者 ' + name);
        terms.push(role(name, '忍者'));
      }
    }
    if (died && row['投毒者'] && (state.ex === undefined || state.ex >= 2))
      terms.push(role(name, '投毒者'));
  }
  if (victim === '临时工' && Object.values(target.counters).reduce((s, n) => s + n, 0) >= 3)
    terms.push(true);
  // A completely quiet window also rules out a guard being consumed.
  // A replacement can be silent only when an unguarded target redirects to an immune servant.
  let silent: boolean | number = immune;
  const servant = pieces.get('从者');
  if (
    !died &&
    !target.counters.guard &&
    victim !== '从者' &&
    servant?.status === 'alive' &&
    servant.area === target.area
  ) {
    const protectedTarget =
      ['大小姐', '大人物'].includes(victim) ||
      (typeof state.extraProtection === 'object'
        ? (state.extraProtection.get(victim) ?? false)
        : state.extraProtection === victim);
    if (!protectedTarget && state.extraProtection === '未绑定') return false;
    if (protectedTarget) {
      silent = any([
        immune,
        all([
          protectedTarget,
          any(
            m.data.identities
              .filter(
                (i) =>
                  i.immortal &&
                  (i.name !== '纸老虎' || servant.counters.paranoia + servant.counters.despair < 2),
              )
              .map((i) => role('从者', i.name)),
          ),
        ]),
      ]);
    }
  }
  const result = all([any(terms), not(silent)]);
  const expected = died ? result : not(result);
  if (expected !== true)
    g.add(reason + ' · ' + victim, typeof expected === 'number' ? [expected] : [], 1);
  return true;
}

type HeroDeathSource = { when: boolean | number; role?: string; owner?: number };
export function requireHeroDeath(
  m: ReturnType<typeof opening3>,
  reason: string,
  sources: HeroDeathSource[],
) {
  const g = m.graph,
    gate = gates(g, reason);
  const options = sources.filter(
    (s) => s.when !== false && (s.when === true || g.truth(s.when) !== false),
  );
  const possible = gate.any(options.map((s) => s.when));
  if (possible !== true) g.add(reason, typeof possible === 'number' ? [possible] : [], 1);
  for (const role of new Set(options.filter((s) => s.owner).map((s) => s.role!))) {
    const alternatives = gate.any(
      options.filter((s) => s.role !== role || !s.owner).map((s) => s.when),
    );
    if (alternatives === true) continue;
    const owners = [
      ...new Set(options.filter((s) => s.role === role && s.owner).map((s) => s.owner!)),
    ];
    g.add(
      reason + ' · 必须由' + role + '产生时的持有者',
      owners,
      1,
      owners.length,
      alternatives === false ? undefined : -alternatives,
      true,
    );
  }
}
