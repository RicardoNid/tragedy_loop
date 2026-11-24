import type { PlayerView, PublicCharacter } from '../../../contracts/src/game.js';
import { gates } from './incident.js';
import type { opening3 } from './opening.js';
type Fact = number | boolean;
type Piece = Pick<PublicCharacter, 'status' | 'counters' | 'area'>;
export function matchLoopEnd(
  m: ReturnType<typeof opening3>,
  opening: PlayerView,
  board: Map<string, Piece>,
  intrigue: Record<string, number>,
  ex: number | undefined,
  startEx: number | undefined,
  increased: boolean | undefined,
  occurred: Set<string>,
  reveals: Set<string>,
  causal: Set<string>,
  homes: ReadonlyMap<string, string>,
  loop: number,
  failed: boolean,
  reason: string,
) {
  const g = m.graph,
    { all, any, not } = gates(g, reason);
  const alive = [...board].filter(([, p]) => p.status === 'alive');
  const cards = [...board].filter(([, p]) => p.status === 'alive' || p.status === 'dead');
  const counts: Record<string, Fact | undefined> = {
    守护此地: intrigue.school! >= 2,
    被封印的邪灵: intrigue.shrine! >= 2,
    改变未来: occurred.has('蝴蝶效应'),
    事件交织的罗网: ex === undefined ? undefined : ex >= 3,
    命悬一线的计划: ex === undefined ? undefined : ex <= 1,
    黑暗学园: intrigue.school! >= loop - 1,
    火药的味道: alive.reduce((n, [, p]) => n + p.counters.paranoia + p.counters.despair, 0) >= 12,
    外神合唱曲:
      alive.filter(([, p]) => p.counters.intrigue + p.counters.despair - p.counters.hope >= 1)
        .length >= 5,
    达贡的福音书: ex === undefined ? undefined : intrigue.shrine! >= ex,
    黄衣之王: increased,
    染血的仪式:
      ex === undefined
        ? undefined
        : [...board.values()].filter((c) => c.status === 'dead').length >= ex,
    死亡真人秀: alive.length <= 6,
    绝密报告: ['主谋', '魔术师', '不安定因子'].some((n) => reveals.has(n)),
    恶魔的剧本: occurred.has('遗言') || occurred.has('代行者'),
  };
  const sources: Fact[] = [];
  const effective = (n: string, r: string): Fact => {
    const base =
      n === '临时工' ? r === '平民' : (m.ids.get(n === '临时工？' ? '临时工' : n)?.[r] ?? false);
    if (!causal.has(n)) return base;
    return r === '关键人物'
      ? any([base, m.plots['因果之绊']!])
      : all([base, -m.plots['因果之绊']!]);
  };
  for (const [name, role] of [
    ['复仇的火种', '主谋'],
    ['巨大定时炸弹X', '魔女'],
    ['巨大定时炸弹Y', '魔女'],
    ['巨大定时炸弹Z', '魔女'],
  ] as const) {
    if (!m.plots[name]) continue;
    counts[name] = any(
      [...m.ids.keys(), ...(board.has('临时工？') ? ['临时工？'] : [])].map((n) => {
        const area =
          homes.get(n) ??
          (n === '神灵'
            ? 'shrine'
            : n === '转校生'
              ? 'school'
              : n === '临时工？'
                ? 'city'
                : undefined);
        if (!area) return all([effective(n, role), g.atom(reason + ' 未绑定初始区域 ' + n)]);
        return all([effective(n, role), (intrigue[area] ?? 0) >= 2]);
      }),
    );
  }
  if (m.plots['和我签订契约吧！'])
    counts['和我签订契约吧！'] = any(
      cards
        .filter(([, p]) => p.counters.intrigue + p.counters.despair - p.counters.hope >= 2)
        .map(([n]) => effective(n, '关键人物')),
    );
  counts['叛逆的世界'] = any(
    cards
      .filter(([, p]) => p.counters.intrigue + p.counters.despair - p.counters.hope >= 2)
      .map(([n]) => effective(n, '关键人物')),
  );
  counts['男子汉的战争'] = any(
    cards
      .filter(([, p]) => p.counters.intrigue + p.counters.despair - p.counters.hope >= 2)
      .map(([n]) => effective(n, '忍者')),
  );
  for (const [name, condition] of Object.entries(counts)) {
    if (!m.plots[name] || condition === undefined) continue;
    let active: Fact = m.plots[name]!;
    if (opening.module === 'WM' && m.primary[name]) {
      const replace = all([
        m.plots['疯狂的真相']!,
        startEx === undefined ? g.atom(reason + ' 未绑定轮回开始 EX') : startEx >= 2,
      ]);
      active = any([all([replace, m.alt[name]!]), all([not(replace), active])]);
    }
    sources.push(all([active, condition]));
  }
  for (const [n, p] of board)
    if (p.status === 'dead') for (const role of ['亲友', '巫师']) sources.push(effective(n, role));
  const supported = ['FS', 'BTX', 'WM', 'MC', 'MZ', 'LL', 'HSA'].includes(opening.module);
  // Other modules retain their unregistered failure paths. Only fully covered windows can demand a source.
  if (
    failed &&
    (!supported ||
      ((opening.module === 'WM' || opening.module === 'MC') &&
        (ex === undefined || startEx === undefined)))
  )
    return false;
  if (!supported) return false;
  const prediction = any(sources);
  const match = failed ? prediction : not(prediction);
  if (match !== true) {
    g.add(reason, typeof match === 'number' ? [match] : [], 1);
    m.projectQuotas(reason + ' · 本轮生效的失败条件与制作名额', true);
  }
  return true;
}
