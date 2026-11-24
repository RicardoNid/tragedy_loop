import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { BOARDS, COUNTERS, type RulePack } from './model.js';
import {
  affectedByBoardCards,
  cardCounterEffect,
  cardDestination,
  cardTotals,
} from './card-settlement.js';
type Bypass = 'goodwill' | 'intrigue';
/** Public placements resolve in three stages. A reported stage is consumed once per target. */
export class CardReports {
  constructor(
    private characters: Map<string, PlayerView['characters'][number]>,
    private boards: PlayerView['boards'],
    private pack: RulePack,
  ) {}
  readonly pendingGoodwill = new Set<string>();
  readonly possibleFollowers = new Set<string>();
  private readonly protectedMoves = new Map<string, { leader: string; origin: string }[]>();
  private reveal?: Pick<Observation, 'day' | 'loop'>;
  private readBoardCards?: (target: string) => void;
  afterMove(target: string) {
    if (affectedByBoardCards(this.characters.get(target)?.character)) {
      this.readBoardCards?.(target);
      const report = this.targets.get(target);
      if (report) delete report.move;
    }
  }
  close(o: Observation) {
    const complete =
      o.type === 'boundary' &&
      o.phase === 'mastermind-abilities' &&
      this.reveal?.day === o.day &&
      this.reveal.loop === o.loop;
    const missing = complete ? [...this.pendingGoodwill] : [];
    const unresolved: string[] = [];
    if (complete) {
      for (const [guardian, moves] of this.protectedMoves) {
        const follower = this.characters.get(guardian);
        const destinations = moves.flatMap(({ leader, origin }) => {
          const area = this.characters.get(leader)?.area;
          return area && area !== origin ? [area] : [];
        });
        if (
          destinations.length &&
          follower?.status === 'alive' &&
          !destinations.includes(follower.area)
        )
          unresolved.push(guardian + ' 的同区保护对象已移动，须核对随行、多个保护对象或禁行状态');
      }
      for (const [id, report] of this.targets) {
        const actor = this.characters.get(id);
        if (actor && actor.status !== 'alive') continue;
        if (report.move && actor && report.move !== actor.area)
          unresolved.push(id + ' 的移动未发生，须核对禁行或替代移动');
        for (const part of ['plus', 'minus'] as const) {
          if (
            Object.entries(report[part] ?? {}).some(([key, n]) => {
              if (report.bypass.has(key as Bypass)) return false;
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
    this.readBoardCards = undefined;
    this.pendingGoodwill.clear();
    this.targets.clear();
    this.possibleFollowers.clear();
    this.protectedMoves.clear();
    return { missing, unresolved };
  }
  readonly targets = new Map<
    string,
    {
      kinds: Record<'move' | 'plus' | 'minus', string[]>;
      bypass: Set<Bypass>;
      goodwillMayBlockMove: boolean;
      move?: string;
      plus?: Partial<Record<(typeof COUNTERS)[number], number>>;
      minus?: Partial<Record<(typeof COUNTERS)[number], number>>;
    }
  >();
  collect(
    o: Observation,
    possible: (counter: Bypass, target: string) => boolean,
    movePlot: () => boolean,
    multipleBlocks = false,
  ) {
    this.targets.clear();
    this.possibleFollowers.clear();
    this.protectedMoves.clear();
    this.pendingGoodwill.clear();
    this.reveal = undefined;
    this.readBoardCards = undefined;
    const placements = o.data.placements;
    if (
      !Array.isArray(placements) ||
      placements.some((p) => !p || typeof p.kind !== 'string' || typeof p.target !== 'string')
    )
      return;
    const revealed = ['mastermind', 'p0', 'p1', 'p2'].every((owner) =>
      placements.some((p) => p.owner === owner),
    );
    const totals = cardTotals(placements);
    if (revealed) this.reveal = o;
    const compileTarget = (target: string) => {
      const actor = this.characters.get(target);
      const board = BOARDS.includes(target as (typeof BOARDS)[number]);
      if (!board && actor?.status !== 'alive') return;
      const boardCards = affectedByBoardCards(actor?.character);
      const group = placements.filter(
        (p) => p.target === target || (boardCards && p.target === actor?.area),
      );
      const kinds = group.map((p) => p.kind as string);
      const area = actor && cardDestination(actor.area, kinds, false);
      const move = area !== actor?.area ? area : undefined;
      const goodwillMayBlockMove = !!move && kinds.includes('block-goodwill') && movePlot();
      const relevant: Record<'move' | 'plus' | 'minus', string[]> = {
        move: kinds.filter(
          (k) =>
            ['horizontal', 'vertical', 'diagonal'].includes(k) ||
            (k === 'block-goodwill' && goodwillMayBlockMove),
        ),
        plus: [],
        minus: [],
      };
      const plus: Partial<Record<(typeof COUNTERS)[number], number>> = {},
        minus: typeof plus = {};
      const bypass = new Set<Bypass>();
      for (const kind of kinds) {
        const effect = cardCounterEffect(kind, kinds, totals, multipleBlocks);
        if (!effect) continue;
        const { counter, amount: n, block } = effect;
        if (board && counter !== 'intrigue') continue;
        if (block) {
          if (
            block === 'goodwill' &&
            group.some((p) => p.kind === 'block-goodwill' && p.target !== target)
          )
            continue;
          if (
            !revealed ||
            (block !== 'goodwill' && block !== 'intrigue') ||
            !possible(block, target)
          )
            continue;
          bypass.add(block);
        }
        const stage = n > 0 ? 'plus' : 'minus';
        relevant[stage].push(kind);
        if (
          kind === 'hope+1' &&
          totals.hopes >= 2 &&
          !relevant[stage].includes('全场希望牌转为友好')
        )
          relevant[stage].push('全场希望牌转为友好');
        if (
          counter === 'intrigue' &&
          !block &&
          kinds.includes('block-intrigue') &&
          !relevant[stage].includes('全场多张禁止密谋失效')
        )
          relevant[stage].push('全场多张禁止密谋失效');
        if (block && !relevant[stage].includes('block-' + block))
          relevant[stage].push('block-' + block);
        const part = n > 0 ? plus : minus;
        part[counter] = (part[counter] ?? 0) + n;
      }
      this.targets.set(target, {
        kinds: relevant,
        bypass,
        goodwillMayBlockMove,
        move,
        plus,
        minus,
      });
      if (
        revealed &&
        bypass.has('goodwill') &&
        (plus.goodwill ?? 0) > 0 &&
        actor?.status === 'alive'
      )
        this.pendingGoodwill.add(target);
    };
    const targets = new Set(placements.map((p) => p.target as string));
    for (const actor of this.characters.values()) {
      if (actor.status === 'alive' && affectedByBoardCards(actor.character)) {
        this.readBoardCards = compileTarget;
        if (targets.has(actor.area)) targets.add(actor.id);
      }
    }
    for (const target of targets) compileTarget(target);
    if (revealed && ![...this.targets.values()].some((report) => report.move)) return;
    // All movement uses the same pre-move positions. A guardian's report can
    // follow its leader's report, by which time the public locations differ.
    for (const guardian of this.characters.values()) {
      const protects = this.pack.characters[guardian.character]?.protects;
      if (guardian.status !== 'alive' || !protects) continue;
      if (!revealed) this.possibleFollowers.add(guardian.id);
      const fixed = [];
      for (const leader of this.characters.values()) {
        if (
          leader.id === guardian.id ||
          leader.status !== 'alive' ||
          leader.area !== guardian.area ||
          !this.targets.get(leader.id)?.move
        )
          continue;
        this.possibleFollowers.add(guardian.id);
        if (protects.characters.includes(leader.character))
          fixed.push({ leader: leader.id, origin: leader.area });
      }
      if (fixed.length) this.protectedMoves.set(guardian.id, fixed);
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
            (r.bypass.has(k as Bypass) && old.counters[k] === next[k]),
        )
      )
        return part;
    }
  }
}
