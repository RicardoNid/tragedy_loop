import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { BOARDS, COUNTERS } from './model.js';
import { destination } from './expressions.js';
/** Public placements resolve in three stages. A reported stage is consumed once per target. */
export class CardReports {
  constructor(
    private characters: Map<string, PlayerView['characters'][number]>,
    private boards: PlayerView['boards'],
  ) {}
  readonly pendingGoodwill = new Set<string>();
  private reveal?: Pick<Observation, 'day' | 'loop'>;
  close(o: Observation) {
    const complete =
      o.type === 'boundary' &&
      o.phase === 'mastermind-abilities' &&
      this.reveal?.day === o.day &&
      this.reveal.loop === o.loop;
    const missing = complete ? [...this.pendingGoodwill] : [];
    const unresolved: string[] = [];
    if (complete) {
      for (const [id, report] of this.targets) {
        const actor = this.characters.get(id);
        if (actor && actor.status !== 'alive') continue;
        if (report.move && actor && report.move !== actor.area)
          unresolved.push(id + ' 的移动未发生，须核对禁行或替代移动');
        for (const part of ['plus', 'minus'] as const) {
          if (
            Object.entries(report[part] ?? {}).some(([key, n]) => {
              if (key === report.bypass) return false;
              const old =
                actor?.counters[key as keyof typeof actor.counters] ??
                (key === 'intrigue' ? this.boards[id as keyof typeof this.boards] : undefined);
              return (
                old !== undefined && old !== Math.min(actor ? Infinity : 3, Math.max(0, old + n))
              );
            })
          )
            unresolved.push(id + ' 缺少公开牌应产生的指示物变化');
        }
      }
    }
    this.reveal = undefined;
    this.pendingGoodwill.clear();
    this.targets.clear();
    return { missing, unresolved };
  }
  readonly targets = new Map<
    string,
    {
      kinds: string[];
      bypass?: 'goodwill' | 'intrigue';
      move?: string;
      plus?: Partial<Record<(typeof COUNTERS)[number], number>>;
      minus?: Partial<Record<(typeof COUNTERS)[number], number>>;
    }
  >();
  collect(o: Observation) {
    this.targets.clear();
    this.pendingGoodwill.clear();
    this.reveal = undefined;
    const placements = o.data.placements;
    if (
      !Array.isArray(placements) ||
      placements.some((p) => !p || typeof p.kind !== 'string' || typeof p.target !== 'string')
    )
      return;
    const revealed = ['mastermind', 'p0', 'p1', 'p2'].every((owner) =>
      placements.some((p) => p.owner === owner),
    );
    const blocks = placements.filter((p) => p.kind === 'block-intrigue').length;
    if (revealed) this.reveal = o;
    const hopes = placements.filter((p) => p.kind === 'hope+1').length;
    for (const target of new Set(placements.map((p) => p.target as string))) {
      const actor = this.characters.get(target);
      if (actor?.character === '幻想') continue;
      const kinds = placements.filter((p) => p.target === target).map((p) => p.kind as string);
      const dirs = kinds.filter((k) => ['horizontal', 'vertical', 'diagonal'].includes(k));
      const move =
        actor && dirs.length && !kinds.includes('block-movement')
          ? destination(actor.area, dirs)
          : undefined;
      const plus: Partial<Record<(typeof COUNTERS)[number], number>> = {},
        minus: typeof plus = {};
      let uncertain = false,
        bypass: 'goodwill' | 'intrigue' | undefined;
      for (const kind of kinds) {
        const m = /^(paranoia|goodwill|intrigue|hope|despair)([+-][12])$/.exec(kind);
        if (!m) continue;
        const counter = (
          m[1] === 'hope' && hopes >= 2 ? 'goodwill' : m[1]
        ) as (typeof COUNTERS)[number];
        if (kinds.includes('block-' + counter)) {
          if (!revealed) {
            uncertain = true;
            continue;
          }
          if (counter === 'paranoia') continue;
          if (counter === 'goodwill' || (counter === 'intrigue' && blocks === 1)) {
            if (bypass && bypass !== counter) uncertain = true;
            bypass = counter;
          }
        }
        const n = Number(m[2]),
          part = n > 0 ? plus : minus;
        part[counter] = (part[counter] ?? 0) + n;
      }
      this.targets.set(target, {
        kinds,
        bypass,
        move: move || undefined,
        ...(uncertain ? {} : { plus, minus }),
      });
      if (
        revealed &&
        !uncertain &&
        bypass === 'goodwill' &&
        (plus.goodwill ?? 0) > 0 &&
        actor?.status === 'alive'
      )
        this.pendingGoodwill.add(target);
    }
  }
  match(o: Observation): 'move' | 'plus' | 'minus' | undefined {
    if (o.phase !== 'card-resolution') return;
    const id = String(o.data.character ?? o.data.board),
      r = this.targets.get(id);
    if (!r) return;
    if (o.type === 'board' && BOARDS.includes(id as (typeof BOARDS)[number])) {
      const old = this.boards[id as (typeof BOARDS)[number]];
      for (const part of ['plus', 'minus'] as const) {
        const delta = r[part]?.intrigue;
        if (
          delta &&
          old !== o.data.intrigue &&
          Math.min(3, Math.max(0, old + delta)) === o.data.intrigue
        )
          return part;
      }
    }
    const old = this.characters.get(id);
    if (
      o.type !== 'character' ||
      !old ||
      old.status !== 'alive' ||
      old.status !== o.data.status ||
      !o.data.counters ||
      typeof o.data.counters !== 'object'
    )
      return;
    const next = o.data.counters as Record<string, unknown>;
    if (old.area !== o.data.area) {
      if (r.move === o.data.area && COUNTERS.every((k) => old.counters[k] === next[k]))
        return 'move';
      return;
    }
    if (!COUNTERS.some((k) => next[k] !== old.counters[k])) return;
    for (const part of ['plus', 'minus'] as const) {
      const deltas = r[part];
      if (
        deltas &&
        COUNTERS.every(
          (k) =>
            Math.max(0, old.counters[k] + (deltas[k] ?? 0)) === next[k] ||
            (k === r.bypass && old.counters[k] === next[k]),
        )
      )
        return part;
    }
  }
}
