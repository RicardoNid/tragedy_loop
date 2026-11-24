import {
  awaitingFirstPlacement,
  completeObservationGroups,
  type PlayerView,
} from '../../../packages/contracts/src/game.js';
import type { Solution3View } from '../../../packages/contracts/src/solution3.js';
import { SolutionSpace3 } from '../../../packages/engine/src/solution3/space.js';
import { newWork } from '../../../packages/engine/src/solution3/relations.js';
interface PublicHost {
  host: { publicOpening(): PlayerView };
  protagonists: { p0: { view(): PlayerView } };
}
class Projection {
  batchWork = newWork();
  constructor(readonly space: SolutionSpace3) {
    this.batchWork = space.model.graph.work;
  }
  before = new Map<number, string>();
  offset = 0;
  target = -1;
  read(view: PlayerView, target: number, details: boolean) {
    const s = this.space,
      m = s.model,
      g = m.graph;
    const work = newWork();
    const count = (part: typeof work) => {
      work.checks += part.checks;
      work.sources = work.sources.concat(part.sources);
      work.combinations += part.combinations;
      work.configurations += part.configurations;
    };
    if (this.target === -1) count(this.batchWork);
    if (target !== this.target) {
      const groups = completeObservationGroups(view.observations.slice(s.through, target), false);
      const last = groups.at(-1);
      if (last) {
        s.append(view.observations.slice(s.through, last[0]!.sequence - 1), view.characters);
        count(g.work);
        this.before = new Map(
          m.rows.flatMap((r) => Object.values(r.cells).map((a) => [a, g.mark(a)] as const)),
        );
        this.offset = g.rules.length;
        s.append(last, view.characters);
        count(g.work);
        this.batchWork = g.work;
      }
    }
    this.target = target;
    const hidden = [...m.absent.keys()].filter((n) => !s.seen.has(n));
    const safe = (str: string) => !hidden.some((n) => str.includes(n));
    const hideNames = (str: string) =>
      hidden.reduce((text, n) => text.replaceAll(n, '未登场角色'), str);
    const fmt = (a: number) =>
      (a < 0 ? '非 ' : '') + g.names[Math.abs(a)]!.replace(/[\[\]"]/g, '').replaceAll(',', ' · ');
    const rows = m.rows.map((r) => {
      const concealed = Boolean(r.owner && hidden.includes(r.owner));
      return {
        table: r.table,
        name: r.name,
        hidden: concealed,
        cells: Object.fromEntries(
          Object.entries(r.cells)
            .filter(([name]) => !concealed && (r.table !== '事件当事人' || !hidden.includes(name)))
            .map(([name, a]) => {
              const mark = g.mark(a);
              return [
                name,
                {
                  mark,
                  changed: mark !== (this.before.get(a) ?? ''),
                  reasons: mark ? [...new Set(g.reasons(a).map(hideNames))] : [],
                },
              ];
            }),
        ),
      };
    });
    const relations = details
      ? g.rules.flatMap((r, i) => {
          const terms = r.terms.map(fmt),
            guard = r.guard ? fmt(r.guard) : '';
          if (![r.reason, guard, ...terms].every(safe)) return [];
          return [
            {
              changed: i >= this.offset,
              checked: g.touched.has(i),
              description:
                r.reason +
                ' · ' +
                (guard ? '若 ' + guard + '，则 ' : '') +
                r.min +
                ' 至 ' +
                r.max +
                ' 项成立：' +
                terms.join('、'),
            },
          ];
        })
      : [];
    return {
      through: s.through,
      partial: s.through < target && !s.conflict,
      conflict: s.conflict && hideNames(s.conflict),
      rows,
      relations,
      failureSources: s.failureSources,
      unresolved: [...s.unresolved, ...g.unsupported].filter(safe),
      work: { ...work, sources: work.sources.map(hideNames) },
      batchWork: { ...this.batchWork, sources: this.batchWork.sources.map(hideNames) },
    } satisfies Solution3View;
  }
}
const live = new WeakMap<PublicHost, Projection>();
const replay = new WeakMap<PublicHost, Projection>();
export function solution3(game: PublicHost, target: number, details = false): Solution3View {
  const view = game.protagonists.p0.view();
  if (awaitingFirstPlacement(view)) throw Error('等待第一轮回角色登场');
  if (!Number.isSafeInteger(target) || target < 0 || target > view.observations.length)
    throw Error('公开记录位置无效');
  let projection = live.get(game);
  const cache = projection && target < projection.target ? replay : live;
  projection = cache.get(game);
  if (!projection || target < projection.target) {
    projection = new Projection(new SolutionSpace3(game.host.publicOpening()));
    cache.set(game, projection);
  }
  return projection.read(view, target, details);
}
