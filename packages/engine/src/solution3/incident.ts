import type { PublicCharacter, Observation } from '../../../contracts/src/game.js';
import type { opening3 } from './opening.js';
import type { Relations } from './relations.js';

type Fact = boolean | number;
const not = (v: Fact): Fact => (typeof v === 'boolean' ? !v : -v);
/** Local Boolean gates are reified count constraints. Both directions remain active on later evidence. */
export function gates(g: Relations, label: string) {
  const any = (terms: Fact[]): Fact => {
    if (terms.includes(true)) return true;
    const lits = [...new Set(terms.filter((v): v is number => typeof v === 'number'))];
    if (!lits.length) return false;
    if (lits.length === 1) return lits[0]!;
    const a = g.atom(label + ' 来源组 ' + lits.join(','));
    g.add(label, lits, 1, lits.length, a);
    g.add(label, lits, 0, 0, -a);
    return a;
  };
  return { any, all: (terms: Fact[]) => not(any(terms.map(not))), not };
}

export interface IncidentState {
  board: Map<string, Pick<PublicCharacter, 'status' | 'area' | 'counters'>>;
  intrigue: Record<string, number>;
  ex?: number;
  territory?: string;
  streamerArea?: string;
  causal: Set<string>;
  suppressed: Set<string>;
}
export function matchIncident(
  model: ReturnType<typeof opening3>,
  state: IncidentState,
  o: Observation,
  occurred: boolean,
  pending: (text: string) => void,
) {
  const g = model.graph,
    day = Number(o.data.day),
    cu = model.culprits.get(day),
    ev = model.events.get(day);
  if (!cu || !ev) return;
  const label = '#' + o.sequence + ' · ' + day + ' 日事件' + (occurred ? '发生' : '未发生');
  const { any, all } = gates(g, label);
  const crowd: Record<string, number> = { 疯狂之夜: 0, 诅咒活化: 1, 污秽溢出: 2, 死者默示录: 2 };
  const alive = [...state.board].filter(([, v]) => v.status === 'alive');
  const role = (n: string, r: string): Fact => {
    if (n === '临时工') return r === '平民';
    const atom = model.ids.get(n === '临时工？' ? '临时工' : n)?.[r] ?? false;
    return state.causal.has(n) && model.plots['因果之绊']
      ? all([atom, -model.plots['因果之绊']])
      : atom;
  };
  const unknown = (why: string) => {
    pending(why);
    return g.atom(label + ' 未决 ' + why);
  };
  // Only the owner of a character/identity ability can substitute its reading area.
  // An incident itself still reads the culprit's physical location here.
  function coLocated(n: string, actual: string, targetArea: string): Fact {
    const alternate =
      n === '大人物'
        ? (state.territory ?? '未绑定')
        : n === 'UP主'
          ? state.streamerArea
          : undefined;
    if (!alternate || alternate === actual) return actual === targetArea;
    if (alternate === '未绑定') return unknown(n + ' 的能力结算区域为 ' + targetArea);
    if (actual !== targetArea && alternate !== targetArea) return false;
    const remote = g.atom(label + ' ' + n + ' 以代理区域执行事件判定能力');
    return alternate === targetArea ? remote : -remote;
  }
  function areaSource(identity: string, area: string, except?: string): Fact {
    if (!model.data.identities.some((i) => i.name === identity)) return false;
    return any(
      alive.flatMap(([n, p]) =>
        n === except ? [] : [all([role(n, identity), coLocated(n, p.area, area)])],
      ),
    );
  }
  const possible = new Set<number>();
  const branches: Fact[] = [];
  for (const [name, lit] of Object.entries(cu)) {
    if (g.truth(lit) === false) continue;
    for (const [event, real] of Object.entries(ev)) {
      if (g.truth(real) === false) continue;
      if (name in state.intrigue !== event in crowd) continue;
      g.work.sources.push(event + ' · ' + name);
      g.work.combinations++;
      let result: Fact;
      if (event in crowd) {
        const corpses = [...state.board.values()].filter(
          (p) => p.status === 'dead' && p.area === name,
        ).length;
        result = corpses + state.intrigue[name]! >= crowd[event]!;
      } else {
        const executors = name === '临时工' ? [name, '临时工？'] : [name];
        const predictions = executors.map((actor): Fact => {
          const p = state.board.get(actor);
          if (!p || p.status !== 'alive' || state.suppressed.has(actor)) return false;
          const counters = p.counters;
          const paranoia = counters.paranoia + counters.despair;
          const count =
            event === '希望之光'
              ? counters.goodwill + counters.hope
              : ['廷达罗斯之嗅', '阴谋活动'].includes(event)
                ? Math.max(0, counters.intrigue + counters.despair - counters.hope)
                : actor === 'AI'
                  ? Object.values(counters).reduce((a, b) => a + b, 0)
                  : paranoia;
          const base = model.data.thresholds.get(actor);
          const offset =
            event === '猎奇杀人' ? 1 : ['前兆', '送葬', '冲动杀人'].includes(event) ? -1 : 0;
          const meets = (amount: number): Fact => {
            const adjusted = amount - offset * (actor === '教主' ? 2 : 1);
            if (actor === '仙人') return model.hermitAtMost(adjusted);
            return base === undefined ? unknown(actor + ' 的不安限度') : adjusted >= base;
          };
          const prophet = areaSource('预言家', p.area, actor);
          const triggers: Fact[] = [role(actor, '强迫症')];
          const ordinary = meets(count);
          triggers.push(ordinary);
          if (ordinary !== true) {
            if (
              actor !== 'AI' &&
              counters.intrigue > 0 &&
              !['希望之光', '廷达罗斯之嗅', '阴谋活动'].includes(event)
            ) {
              const modified = any([
                role(actor, '祭品'),
                ['自杀', '连续杀人'].includes(event) ? (model.plots['士的宁毒液'] ?? false) : false,
              ]);
              if (modified !== false)
                triggers.push(all([modified, meets(count + counters.intrigue)]));
            }
            if (model.plots['灭亡讴歌'])
              triggers.push(
                all([
                  model.plots['灭亡讴歌'],
                  role(actor, '平民'),
                  any(alive.map(([n]) => role(n, '预言家'))),
                  meets(count + 1),
                ]),
              );
          }
          if (counters.despair > 0) triggers.push(areaSource('监视者', p.area));
          if (state.ex === 0 || state.ex === undefined) {
            const detective = areaSource('侦探', p.area);
            if (detective !== false)
              triggers.push(
                all([detective, state.ex === undefined ? unknown('侦探发动时的 EX') : true]),
              );
          }
          return all([not(prophet), any(triggers)]);
        });
        result = any(predictions);
      }
      const match = occurred ? result : not(result);
      if (match !== true)
        g.add(
          label + ' · 当事人与真实事件共同成立时匹配结果',
          [-real, -lit, ...(typeof match === 'number' ? [match] : [])],
          1,
        );
      if (match === false) continue;
      possible.add(lit);
      branches.push(all([real, lit, match]));
    }
  }
  const match = any(branches);
  if (match !== true) g.add(label, typeof match === 'number' ? [match] : [], 1);
  // A scheduled culprit exists even when the incident does not occur. Only mark a
  // supported subset when this announcement has actually narrowed the object range.
  const live = Object.values(cu).filter((a) => g.truth(a) !== false);
  for (const a of live) if (!possible.has(a)) g.add(label + ' · 无合法触发路径', [-a], 1);
  if (possible.size < live.length) g.add(label, [...possible], 1, possible.size, undefined, true);
}
