import type { Protection } from './death.js';
import { LLSpecialVictory } from './ll-victory.js';
import { PoisonHistory } from './poison.js';
import { matchZombieMove } from './zombie.js';
import { matchDeaths } from './death.js';
import { PartnerReactions } from './partner.js';
import { effectiveRole } from './effective.js';
import { expectedCounters, useKey } from './active.js';
import { CurseHistory } from './curse.js';
import { unchangedZombieWindow, madNightAtOccurrence, matchHsaHeroDeath } from './zombie.js';
import { matchLoopEnd } from './loop-end.js';
import { startOutcome, recordOutcome, closeOutcome, matchIncidentPublication } from './outcome.js';
import { matchDayEndGroup } from './death-group.js';
import { dayEndDeath, requireHeroDeath, meetsDayEndThreshold } from './day-end.js';
import { gates, matchIncident } from './incident.js';
import {
  completeObservationGroups,
  type Observation,
  type PlayerView,
  type PublicCharacter,
  type Counters,
} from '../../../contracts/src/game.js';
import { opening3, boards } from './opening.js';
import { newWork } from './relations.js';

type Piece = Pick<PublicCharacter, 'status' | 'area' | 'counters'>;
type PublicResult = {
  type: Observation['type'];
  key: string;
  value: unknown;
  intrigue?: number;
  status?: string;
};
export class SolutionSpace3 {
  readonly model: ReturnType<typeof opening3>;
  readonly seen = new Set<string>();
  readonly board = new Map<string, Piece>();
  readonly unresolved = new Set<string>();
  private readonly occupants = new Map<string, Set<string>>();
  private putPiece(name: string, piece: Piece) {
    const old = this.board.get(name);
    if (old?.status === 'alive') this.occupants.get(old.area)?.delete(name);
    this.board.set(name, piece);
    if (piece.status === 'alive') {
      const residents = this.occupants.get(piece.area) ?? new Set<string>();
      residents.add(name);
      this.occupants.set(piece.area, residents);
    }
  }
  private readonly boardIntrigue: Record<string, number>;
  private revealedCards?: { owner: string; target: string; kind: string }[];
  private cardEntry?: Map<string, Piece>;
  private readonly llVictory = new LLSpecialVictory();
  private readonly markers = { communicated: new Set<string>(), died: new Set<string>() };
  private preVictory?: Observation['phase'];
  private readonly reveals = new Set<string>();
  private readonly occurred = new Set<string>();
  private readonly pastFireDays = new Set<number>();
  private readonly houndSources: (boolean | number)[] = [];
  private declarations: {
    actor: string;
    ability: string;
    must: boolean | number;
    can: boolean | number;
    roleOptions: number[];
    target?: string;
    possibleProtection?: string[];
    illegalProtection?: boolean;
    invokedIncident?: string;
    callOutcome?: ReturnType<typeof startOutcome>;
    invokedAbility?: string;
    expected: Map<string, Partial<Counters>>;
    publicResult?: PublicResult;
    revealed: Set<string>;
    confirmed: boolean;
    attack?: {
      target: string;
      before: Map<string, Piece>;
      protection?: Protection;
      settled: boolean;
    };
    movement?: { target: string; destinations: string[] };
    revival?: { id: string; area: string; goodwill?: number; intrigue?: number; seen: boolean };
    reason: string;
  }[] = [];
  private readonly deathTriggers: { source: Observation; fatal: number | boolean }[] = [];
  private failedEarlier = false;
  private failedAtEnd = false;
  private lastLoop?: Map<string, Piece>;
  private lastEx?: number;
  private loopEntry?: Map<string, Piece>;
  private outcome?: ReturnType<typeof startOutcome>;
  private incidentEx?: { day: number; before?: number; source: Observation };
  private readonly treeTransfer = new Set<keyof Counters>();
  private streamerTarget?: string;
  private territory?: string;
  private readonly territoryChoices = new Map<string, number>();
  private madNight?: { day: number; loop: number; delayed: boolean | number };
  private stableEnd = false;
  private readonly silentTherapists = new Map<number, Set<string>>();
  private readonly silentGhosts = new Map<number, Set<string>>();
  private settledDeathGroup = false;
  private zombieMoveDay?: string;
  private readonly endUses = new Map<string, number[]>();
  private matchedDeathGroup = false;
  private window?: Observation;
  private observedArrival = false;
  private rosterChanged = false;
  private ex?: number;
  private exAtDayEnd?: number;
  private readonly keyDeaths = new Set<string>();
  private readonly keyCardDays = new Set<string>();
  private readonly poison = new PoisonHistory();
  private forcedPoison: (number | boolean)[] = [];
  private witnessesAtDayEnd: number[] = [];
  private protagonistDiedAtDayEnd = false;
  private exAtLoopStart?: number;
  private exIncreased?: boolean;
  private refusalEx = 0;
  private protectedProtagonists = false;
  private lockdown?: { area: string; day: number; loop: number; reason: string };
  private readonly letterHolds = new Map<string, { day: number; loop: number; reason: string }>();
  private rememberLetter(outcome: ReturnType<typeof startOutcome>, reason: string) {
    for (const name of outcome.moved) {
      // Only a servant can move as a follower rather than as a selected target.
      if (name === '从者' && outcome.moved.size > 1) continue;
      this.letterHolds.set(name, { day: outcome.day + 1, loop: outcome.loop, reason });
    }
  }
  private extraProtection?: Protection;
  private readonly homes = new Map<string, string>();
  private readonly causal = new Set<string>();
  private readonly completedGoodwill = new Set<string>();
  private readonly uses = new Map<string, number[]>();
  private readonly suppressed = new Set<string>();
  private readonly releasedMovement = new Map<string, boolean>();
  private readonly curses = new CurseHistory();
  private readonly partners = new PartnerReactions();
  private readonly grants = new Set<string>();
  private readonly scheduledHope = new Map<number, (number | boolean)[]>();
  private scheduleHope(loop: number, condition: number | boolean) {
    const sources = this.scheduledHope.get(loop + 1) ?? [];
    sources.push(condition);
    this.scheduledHope.set(loop + 1, sources);
  }
  private readonly hiddenBindings = new Map<string, Map<string, number>>();
  private readonly buffered = new Map<number, Observation>();
  budgetStopped = false;
  through = 0;
  partial = false;
  conflict?: string;
  constructor(readonly opening: PlayerView) {
    if (!['briefing', 'discussion', 'loop-start'].includes(opening.phase)) {
      this.releasedMovement.set('住院患者', false);
      this.releasedMovement.set('小女孩', false);
    }
    this.model = opening3(opening);
    this.boardIntrigue = { ...opening.boards };
    this.ex = opening.ex;
    for (const c of opening.characters) {
      this.putPiece(c.character, c);
      if (c.status !== 'absent') this.homes.set(c.character, c.area);
      if (c.status !== 'absent') this.seen.add(c.character);
      if (c.character === '神灵' && c.status !== 'absent')
        this.assert('公开开局神灵登场', this.model.arrival.get('神灵')![0]!);
    }
    const graph = this.model.graph;
    graph.propagate();
    if (graph.conflict !== undefined)
      this.conflict = '开局 · ' + graph.rules[graph.conflict]!.reason;
    if (opening.publicSpecialRules?.length) this.unresolved.add('剧本特殊规则尚未解释');
  }
  private assert(reason: string, ...lits: number[]) {
    this.model.graph.add(reason, lits, 1, lits.length, undefined, true);
  }
  private pending(o: Observation, text: string) {
    this.unresolved.add('#' + o.sequence + ' ' + o.phase + ' · ' + text);
  }
  private get basic() {
    return this.opening.module === 'FS' || this.opening.module === 'BTX';
  }
  private loopStartClosed(old: Observation, reason: string) {
    const m = this.model,
      g = m.graph,
      previous = this.lastLoop;
    if (!this.loopEntry || (old.loop > 1 && !previous)) {
      this.pending(old, '缺少上一轮闭合盘面');
      return;
    }
    const gate = gates(g, reason + ' 轮回开始');
    for (const kind of ['hope+1', 'despair+1']) {
      const sources: (number | boolean)[] = [];
      const fragments: number[] = [];
      const hope = kind === 'hope+1';
      if (m.plots['超越世界线'] && (hope ? old.loop === this.opening.loops : old.loop % 2 === 0))
        sources.push(m.plots['超越世界线']!);
      for (const [n, p] of this.loopEntry) {
        const prev = previous?.get(n);
        if (n === '临时工' || !prev || p.status !== 'alive') continue;
        const role = m.ids.get(n === '临时工？' ? '临时工' : n)?.['因果残片'];
        if (
          role &&
          (hope
            ? prev.status === 'alive' && prev.counters.goodwill + prev.counters.hope >= 2
            : prev.status === 'dead')
        )
          fragments.push(role);
      }
      if (hope) sources.push(...(this.scheduledHope.get(old.loop) ?? []));
      const alternate = gate.any(sources);
      if (this.grants.has(kind) && alternate !== true && fragments.length) {
        const condition = typeof alternate === 'number' ? -alternate : undefined;
        g.add(
          reason + ' · ' + kind + ' 须由上轮符合条件的因果残片提供',
          fragments,
          1,
          fragments.length,
          condition,
          true,
        );
        if (this.opening.anniversary && !m.ids.has('模仿犯')) {
          const elsewhere = [...m.ids.values()]
            .map((row) => row['因果残片']!)
            .filter((a) => a && !fragments.includes(a));
          g.add(reason + ' · 唯一周年残片须在发牌范围内', elsewhere, 0, 0, condition);
        }
      }
      const result = gate.any([alternate, ...fragments]);
      const match = this.grants.has(kind) ? result : gate.not(result);
      if (match !== true)
        g.add(reason + ' · ' + kind + ' 来源', typeof match === 'number' ? [match] : [], 1);
    }
    if (previous) {
      const eligible = [...this.loopEntry]
        .filter(([n, p]) => p.status === 'alive' && previous.get(n)?.status === 'dead')
        .map(([n]) => n);
      if (this.opening.module === 'MZ' && eligible.length && !this.causal.size) {
        for (const plot of ['因果之绊', '诸神之骰'])
          this.assert(reason + ' · 缺少强制因果 EX 附着', -m.plots[plot]!);
      }
      if (
        this.opening.module === 'MC' &&
        this.lastEx !== undefined &&
        this.lastEx <= 2 &&
        this.ex !== undefined
      )
        this.assert(
          reason + ' · 隔离病房的 EX',
          (this.ex > 0 ? 1 : -1) * m.plots['隔离病房惊魂记']!,
        );
      if (this.basic && m.plots['因果线'])
        for (const [n, p] of this.loopEntry) {
          const prev = previous.get(n),
            end = this.board.get(n);
          if (
            !prev ||
            !end ||
            p.status !== 'alive' ||
            prev.counters.goodwill + prev.counters.hope <= 0
          )
            continue;
          this.assert(
            reason + ' · 上轮友好与本轮不安',
            (end.counters.paranoia - p.counters.paranoia >= 2 ? 1 : -1) * m.plots['因果线'],
          );
        }
    }
  }
  private close(o: Observation) {
    for (const { source, fatal } of this.deathTriggers) {
      if (source.loop !== o.loop || this.failedEarlier) continue;
      const closed =
        (source.phase === 'incident' && o.phase === 'captain-change') ||
        (source.phase === 'protagonist-abilities' && o.phase === 'incident') ||
        (source.phase === 'day-end' &&
          (o.phase === 'day-start' ||
            (o.phase === 'loop-end' && source.day === this.opening.days)));
      if (closed && fatal !== false)
        this.assert(
          '#' + o.sequence + ' · #' + source.sequence + ' 死亡时生效的关键人物能力应立即结束轮回',
          ...(typeof fatal === 'number' ? [-fatal] : []),
        );
    }
    this.deathTriggers.length = 0;
    if (this.incidentEx) {
      if (o.phase === 'captain-change' || o.phase === 'loop-end') this.matchIncidentEx(o, this.ex);
      else this.pending(this.incidentEx.source, '事件发生后的 EX 窗口缺少结束边界');
      this.incidentEx = undefined;
    }
    if (this.outcome) {
      if (o.phase === 'captain-change' || o.phase === 'loop-end')
        closeOutcome(
          this.model,
          this.outcome,
          o.sequence,
          this.opening.module,
          o.phase === 'captain-change',
          (r) => this.unresolved.add(r),
          this.homes,
          this.protectedProtagonists,
          this.causal,
          this.extraProtection,
          this.releasedMovement,
        );
      if (
        this.opening.module === 'WM' &&
        this.outcome.protagonistDeath &&
        !this.opening.publicSpecialRules?.length &&
        this.opening.loop <= 1 &&
        this.opening.incidents.some(
          (i) =>
            i.day === this.outcome!.day &&
            ['发现', '不安扩散', '邪气污染', '失踪', '廷达罗斯之嗅'].includes(i.name),
        )
      ) {
        const label = '#' + o.sequence + ' · 本事件文本无主人公死亡，检查此前生效的廷达罗斯';
        const cause = gates(this.model.graph, label).any(this.houndSources);
        if (this.protectedProtagonists || cause === false) this.assert(label);
        else if (typeof cause === 'number') this.assert(label, cause);
      }
      if (this.opening.module === 'WM' && o.phase === 'captain-change') {
        const w = this.outcome,
          label = '#' + o.sequence + ' · 廷达罗斯在后续事件阶段结束时结算';
        if (!this.protectedProtagonists && !w.protagonistDeath) {
          for (const source of this.houndSources)
            if (source !== false)
              this.assert(label, ...(typeof source === 'number' ? [-source] : []));
        }
        if (this.opening.incidents.some((i) => i.day === w.day && i.name === '廷达罗斯之嗅')) {
          const cat = this.model.culprits.get(w.day)?.['黑猫'];
          this.houndSources.push(cat ? -cat : true);
        }
      }
      if (
        this.opening.module === 'MC' &&
        this.opening.incidents.some((i) => i.day === this.outcome!.day && i.name === '可疑信件')
      )
        this.rememberLetter(this.outcome, '第' + this.outcome.day + '日可疑信件');
      this.outcome = undefined;
    }
    const old = this.window;
    if (!old) return;
    const reason = '#' + o.sequence + ' 闭合 ' + old.phase;
    if (this.refusalEx) {
      if (old.phase === 'protagonist-abilities' && o.phase === 'incident')
        this.assert(reason + ' · 被拒绝的友好能力缺少 EX 增量');
      else this.pending(old, '被拒绝后的 EX 公告窗口中断');
      this.refusalEx = 0;
    }
    this.finishDeclarations(
      old,
      reason,
      old.phase === 'protagonist-abilities' && o.phase === 'incident',
    );
    const closedEnd =
      old.phase === 'day-end' &&
      !this.failedEarlier &&
      (o.phase === 'day-start' || (o.phase === 'loop-end' && old.day === this.opening.days));
    if (closedEnd && !this.protectedProtagonists && !this.protagonistDiedAtDayEnd) {
      if (this.keyDeaths.has(old.loop + '/' + old.day))
        this.assert(reason + ' · 公开密钥的到期日缺少主人公死亡');
      for (const poison of this.forcedPoison)
        if (poison !== false)
          this.assert(
            reason + ' · EX 达到四的投毒者缺少主人公死亡',
            ...(typeof poison === 'number' ? [-poison] : []),
          );
    }
    if (this.opening.module === 'WM') {
      const complete =
        old.phase === 'day-end' &&
        !this.failedEarlier &&
        (o.phase === 'day-start' || (o.phase === 'loop-end' && old.day === this.opening.days));
      if (complete && !this.protectedProtagonists && !this.protagonistDiedAtDayEnd)
        for (const used of this.endUses.get('祭品') ?? [])
          this.assert(reason + ' · 祭品发动后必有主人公死亡', -used);
      if (complete && this.exAtDayEnd !== undefined && this.ex === this.exAtDayEnd)
        for (const witness of this.witnessesAtDayEnd)
          this.assert(reason + ' · 目击者的强制 EX 增量缺失', -witness);
      if (
        old.phase === 'day-end' &&
        (o.phase === 'day-start' || o.phase === 'loop-end') &&
        this.exAtDayEnd !== undefined &&
        this.exAtDayEnd >= 4 &&
        !this.protectedProtagonists &&
        !this.protagonistDiedAtDayEnd
      )
        this.assert(reason + ' · EX 达到 4 的日末发狂缺少主人公死亡');
      if (
        old.phase === 'loop-end' &&
        (o.phase === 'discussion' || o.phase === 'loop-start') &&
        o.loop > old.loop &&
        this.ex !== undefined &&
        this.ex >= 4
      )
        this.assert(reason + ' · EX 达到 4 后不能开始新一轮');
    }
    if (
      old.phase === 'day-end' &&
      this.opening.module === 'HSA' &&
      !this.protectedProtagonists &&
      !this.failedEarlier &&
      (o.phase === 'day-start' || o.phase === 'loop-end') &&
      this.madNight?.loop === old.loop &&
      this.madNight.day === old.day
    ) {
      const delayed = this.madNight.delayed;
      if (delayed !== false)
        this.assert(
          reason + ' · 疯狂之夜的日末强制死亡缺失',
          ...(typeof delayed === 'number' ? [-delayed] : []),
        );
    }
    const delayed =
      old.loop === o.loop &&
      old.phase === 'day-start' &&
      o.phase === 'mastermind-cards' &&
      old.day === o.day
        ? '转校生'
        : old.loop === o.loop && old.phase === 'loop-start' && o.phase === 'day-start'
          ? '神灵'
          : undefined;
    if (delayed && !this.observedArrival && !this.seen.has(delayed)) {
      const date = delayed === '神灵' ? old.loop : old.day;
      const slot = this.model.arrival.get(delayed)?.[date - 1];
      if (slot && this.model.graph.truth(slot) !== false) {
        this.assert(reason + ' · 未登场', -slot);
        if (
          this.model.arrival
            .get(delayed)!
            .every((a) => a === slot || this.model.graph.truth(a) === false)
        )
          this.rosterChanged = true;
      }
    }
    if (old.phase === 'mastermind-abilities' && o.phase === 'protagonist-abilities')
      for (const [ghost] of this.silentGhosts)
        this.assert(reason + ' · 死亡鬼魂有合法目标但该区域没有出现强制不安', -ghost);
    if (old.phase === 'mastermind-abilities' && o.phase === 'protagonist-abilities')
      for (const role of this.silentTherapists.keys())
        this.assert(reason + ' · 心理医生的所有合法目标都有不安但没有减少', -role);
    this.silentTherapists.clear();
    this.silentGhosts.clear();
    if (old.phase === 'day-end' && !closedEnd && !this.failedEarlier && o.phase !== 'finished')
      this.pending(old, '日末窗口中断，不能用其余强制结果的缺失排除');
    if (
      this.opening.module === 'LL' &&
      (old.phase === 'day-end' || old.phase === 'protagonist-abilities')
    )
      this.llVictory.close(
        this.model,
        o,
        closedEnd || (old.phase === 'protagonist-abilities' && o.phase === 'incident'),
        o.phase === 'finished',
      );
    if (
      old.phase === 'card-resolution' &&
      o.phase === 'mastermind-abilities' &&
      this.revealedCards &&
      this.cardEntry
    ) {
      const cards = this.revealedCards,
        hopes = cards.filter((c) => c.kind === 'hope+1').length;
      for (const block of cards.filter((c) => c.kind === 'block-goodwill')) {
        const name = this.model.names.get(block.target),
          entry = name && this.cardEntry.get(name),
          end = name && this.board.get(name);
        if (!name || !entry || !end || name === '幻想') continue;
        const add = cards
          .filter((c) => c.target === block.target)
          .reduce(
            (n, c) =>
              n +
              (c.kind === 'goodwill+1'
                ? 1
                : c.kind === 'goodwill+2'
                  ? 2
                  : c.kind === 'hope+1' && hopes >= 2
                    ? 1
                    : 0),
            0,
          );
        if (!add) continue;
        const role = this.model.ids.get(name)?.['时间旅者'];
        if (!role || name === '临时工' || name === '临时工？') continue;
        const diff = end.counters.goodwill - entry.counters.goodwill;
        if (diff === 0 || diff === add)
          this.assert(reason + ' · 禁止友好与时间旅者', diff === 0 ? -role : role);
        else this.pending(old, '行动牌与其他友好变化重合');
      }
    }
    if (
      old.phase === 'loop-end' &&
      !this.failedEarlier &&
      ['finished', 'final-guess', 'discussion'].includes(o.phase)
    ) {
      if (
        !matchLoopEnd(
          this.model,
          this.opening,
          this.board,
          this.boardIntrigue,
          this.ex,
          this.exAtLoopStart,
          this.exIncreased,
          this.occurred,
          this.reveals,
          this.causal,
          this.homes,
          old.loop,
          this.failedAtEnd,
          reason,
        )
      )
        this.pending(o, '轮回失败条件来源');
    }
    if (
      old.phase === 'day-end' &&
      this.stableEnd &&
      (o.phase === 'day-start' || (o.phase === 'loop-end' && old.day === this.opening.days))
    ) {
      if (this.opening.module === 'MC')
        this.poison.quiet(this.model, this.board, this.causal, this.extraProtection, reason);
      if (this.opening.module === 'HSA' && !this.curses.pendingDeath)
        unchangedZombieWindow(
          this.model,
          this.board,
          this.boardIntrigue,
          reason,
          this.causal,
          this.extraProtection,
        );
      for (const [n, p] of this.board)
        if (
          p.status === 'alive' &&
          !dayEndDeath(this.model, this.board, n, false, reason, {
            day: old.day,
            extraProtection: this.extraProtection,
            ex: this.ex,
            causal: this.causal,
          })
        )
          this.pending(old, n + ' 的回合结束存活与替代、守护或执行者绑定');
    }
    if (old.phase === 'loop-start' && o.phase === 'day-start') {
      this.loopStartClosed(old, reason);
      const plot = this.model.plots['超越世界线'];
      if (
        plot &&
        ((old.loop === this.opening.loops && !this.grants.has('hope+1')) ||
          (old.loop % 2 === 0 && !this.grants.has('despair+1')))
      )
        this.assert(reason + ' · 缺少应发行动牌', -plot);
    }
  }
  private settleActiveAttack(
    action: (typeof this.declarations)[number],
    reason: string,
    complete: boolean,
  ) {
    const attack = action.attack;
    if (!attack || attack.settled) return;
    const died = new Set<string>();
    const counters = new Map<string, Counters>();
    let changed = false;
    for (const [n, old] of attack.before) {
      const p = this.board.get(n);
      if (!p) return;
      if (old.status === 'alive' && p.status === 'dead') died.add(n);
      if (p.counters.guard !== old.counters.guard) changed = true;
      counters.set(n, p.counters);
    }
    if (!complete && !changed && !died.size) return;
    attack.settled = true;
    const match = matchDeaths(
      this.model,
      attack.before,
      new Map([[attack.target, 1]]),
      died,
      counters,
      this.causal,
      reason + ' · 异界人杀害声明的对象',
      attack.protection,
    );
    if (match === undefined) this.unresolved.add(reason + ' · 异界人杀害的替死对象未绑定');
    else if (match !== true)
      this.assert(
        reason + ' · 异界人杀害的护卫、替死或不死',
        ...(typeof match === 'number' ? [match] : []),
      );
    if (changed || died.size) action.confirmed = true;
  }
  private finishDeclarations(old: Observation, reason: string, complete: boolean) {
    for (const d of this.declarations) {
      const g = this.model.graph;
      this.settleActiveAttack(d, reason, complete);
      if (!complete && !d.confirmed) {
        this.pending(old, d.ability + ' 的接受、完成或后续效果因阶段中断未确认');
        continue;
      }
      if (d.callOutcome && d.invokedIncident) {
        const crowd = ['疯狂之夜', '诅咒活化', '污秽溢出', '死者默示录'].includes(
          d.invokedIncident,
        );
        closeOutcome(
          this.model,
          d.callOutcome,
          old.sequence,
          this.opening.module,
          complete,
          (text) => this.pending(old, text),
          this.homes,
          this.protectedProtagonists,
          this.causal,
          this.extraProtection,
          this.releasedMovement,
          { event: d.invokedIncident, actor: crowd ? 'city' : d.actor, reason: d.reason },
        );
      }
      if (d.callOutcome && d.invokedIncident === '可疑信件')
        this.rememberLetter(d.callOutcome, d.reason);
      if (complete && old.phase === 'protagonist-abilities')
        this.completedGoodwill.add(useKey(d.actor, d.ability, old.loop, old.day));
      if (complete && this.board.get(d.actor)?.status === 'alive')
        for (const role of ['巫师', '密钥']) {
          if (!this.model.ids.get(d.actor)?.[role] || d.revealed.has(role)) continue;
          const active = effectiveRole(
            this.model,
            d.actor,
            role,
            this.board.get(d.actor),
            this.causal,
            reason,
          );
          if (typeof active === 'number')
            this.assert(reason + ' · 友好完成时未公告' + role, -active);
          if (active === true) this.assert(reason + ' · 友好完成时未公告' + role);
        }
      if (complete && d.movement) {
        const actual = this.board.get(d.movement.target)?.area;
        if (!actual) this.pending(old, d.ability + ' 的结算位置未绑定');
        else if (!d.movement.destinations.includes(actual))
          this.assert(reason + ' · ' + d.ability + ' 的实际移动与声明及禁行不相容');
      }
      const missingRevival =
        d.revival && !d.revival.seen && this.board.get(d.actor)?.area === d.revival.area;
      if ((d.expected.size || d.publicResult || missingRevival) && complete)
        g.add(reason + ' · 已接受的 ' + d.ability + ' 缺少公开结果', [], 1);
      if (d.must !== false)
        g.add(reason + ' · 接受 ' + d.ability, typeof d.must === 'number' ? [-d.must] : [], 1);
      if (d.ability === 'doctor-release') this.releasedMovement.set('住院患者', true);
      if (d.ability === 'girl-release') this.releasedMovement.set(d.actor, true);
      if (
        d.ability === 'ai' &&
        this.opening.module === 'WM' &&
        this.opening.incidents.some((i) => i.name === '廷达罗斯之嗅')
      ) {
        if (d.invokedIncident === '廷达罗斯之嗅') this.houndSources.push(true);
        else if (!d.invokedIncident) {
          this.pending(old, 'AI 所选事件与本轮廷达罗斯生效时间未绑定');
          this.houndSources.push(g.atom(d.reason + ' AI 选择廷达罗斯之嗅'));
        }
      }
      if (d.ability === 'henchman') this.suppressed.add(d.actor);
      if (d.ability === 'soldier-protect') this.protectedProtagonists = true;
      if (d.ability === 'servant') {
        if (d.illegalProtection) this.assert(d.reason + ' · 从者只能追加保护另一名存活角色');
        else if (d.target) this.extraProtection = d.target;
        else if (d.possibleProtection?.length) {
          const binding = new Map(
            d.possibleProtection.map((n) => [n, g.atom(d.reason + ' 从者本轮追加保护 ' + n)]),
          );
          g.add(d.reason + ' 从者选择一名其他在场角色', [...binding.values()], 1, 1);
          this.extraProtection = binding;
        } else this.extraProtection = '未绑定';
      }
      if (
        d.ability === 'ai' &&
        this.opening.module === 'LL' &&
        this.opening.incidents.some((i) => i.name === '遗言')
      ) {
        if (d.invokedIncident === '遗言') this.scheduleHope(old.loop, true);
        else if (!d.invokedIncident) {
          this.pending(old, 'AI 所选公开事件未绑定');
          this.scheduleHope(old.loop, g.atom(d.reason + ' AI 选择遗言'));
        }
      }
    }
    this.declarations = [];
  }
  private consume(o: Observation) {
    const { model: m } = this,
      { graph: g } = m,
      d = o.data;
    const why = '#' + o.sequence + ' ' + o.phase;
    if (this.outcome && o.phase === 'incident') recordOutcome(this.outcome, o, m.names);
    if (
      o.phase === 'protagonist-abilities' &&
      o.type === 'own-choice' &&
      ['ability', 'pass'].includes((d.choice as { kind?: string })?.kind ?? '')
    )
      this.finishDeclarations(o, why + ' 下一次主人公行动', true);
    const actor = m.names.get(String(d.character));
    for (const action of this.declarations) {
      if (action.callOutcome && o.phase === 'protagonist-abilities')
        recordOutcome(action.callOutcome, o, m.names);
      if (actor === action.actor && o.type === 'identity' && typeof d.identity === 'string')
        action.revealed.add(d.identity);
      const revival = action.revival;
      if (revival && !revival.seen) {
        if (
          revival.goodwill !== undefined &&
          o.type === 'character' &&
          d.character === revival.id &&
          d.status === 'alive' &&
          d.area === revival.area &&
          d.counters
        ) {
          revival.seen = action.confirmed = true;
          if (
            o.simultaneousSize !== undefined ||
            ['FS', 'BTX', 'HSA'].includes(this.opening.module)
          ) {
            const gain = (d.counters as Counters).goodwill - revival.goodwill;
            for (const bound of [m.hermitAtMost(gain), gates(g, why).not(m.hermitAtMost(gain - 1))])
              if (bound !== true)
                this.assert(
                  why + ' · 仙人复活后实际放置 X 枚友好',
                  ...(typeof bound === 'number' ? [bound] : []),
                );
          } else this.pending(o, '仙人 X 与后续友好变化缺少同批标记');
        } else if (
          revival.intrigue !== undefined &&
          o.type === 'board' &&
          d.board === revival.area &&
          d.intrigue === revival.intrigue - 1
        )
          revival.seen = action.confirmed = true;
      }
      const match = action.publicResult;
      if (
        match &&
        o.type === match.type &&
        d[match.key] === match.value &&
        (match.intrigue === undefined || d.intrigue === match.intrigue) &&
        (match.status === undefined || d.status === match.status)
      ) {
        action.publicResult = undefined;
        action.confirmed = true;
      }
    }
    if (
      o.phase === 'mastermind-abilities' &&
      o.type === 'character' &&
      actor &&
      d.counters &&
      (d.counters as Counters).paranoia > (this.board.get(actor)?.counters.paranoia ?? Infinity)
    )
      for (const [ghost, targets] of this.silentGhosts)
        if (targets.has(actor)) this.silentGhosts.delete(ghost);
    if (actor && o.type === 'character' && d.counters)
      for (const action of this.declarations) {
        const counters = d.counters as Record<string, number>;
        const expected = action.expected.get(actor);
        if (expected && Object.entries(expected).every(([key, value]) => counters[key] === value)) {
          action.expected.delete(actor);
          action.confirmed = true;
        }
      }
    if (
      this.opening.module === 'MC' &&
      o.phase === 'mastermind-abilities' &&
      o.type === 'character' &&
      actor &&
      d.counters
    ) {
      const before = this.board.get(actor),
        after = d.counters as Counters;
      if (before && after.paranoia < before.counters.paranoia) {
        for (const [role, targets] of this.silentTherapists)
          if (targets.has(actor)) this.silentTherapists.delete(role);
        const tree = this.board.get('御神木'),
          doctor = this.board.get('医生');
        const doctorActs =
          doctor?.status === 'alive' &&
          doctor.area === before.area &&
          actor !== '医生' &&
          !doctor.counters.hope &&
          doctor.counters.goodwill >= 2;
        if (
          !doctorActs &&
          !(tree?.status === 'alive' && tree.area === before.area) &&
          this.streamerTarget !== '未绑定' &&
          after.paranoia === before.counters.paranoia - 1 &&
          before.status === 'alive' &&
          before.area === d.area &&
          Object.keys(after).every(
            (k) =>
              k === 'paranoia' ||
              before.counters[k as keyof Counters] === after[k as keyof Counters],
          )
        ) {
          const sources: number[] = [];
          for (const n of this.abilityActors(before.area)) {
            if (n === actor || n === '临时工') continue;
            const id = m.ids.get(n === '临时工？' ? '临时工' : n)?.['心理医生'];
            if (!id || g.truth(id) === false) continue;
            g.work.sources.push('心理医生 · ' + n);
            const remote = this.territoryRequirement(n, before.area);
            const fit = remote ? gates(g, why).all([id, remote]) : id;
            if (typeof fit === 'number') sources.push(fit);
          }
          if (this.ex !== undefined && this.ex < 1)
            this.assert(why + ' · 心理医生的 EX 门槛未达到');
          else
            g.add(
              why + ' · 同区其他角色的不安减少来自心理医生',
              sources,
              1,
              sources.length,
              undefined,
              true,
            );
        }
      }
    }
    if (
      o.phase === 'loop-start' &&
      o.type === 'character' &&
      actor === '手下' &&
      d.status === 'alive' &&
      typeof d.area === 'string' &&
      boards.includes(d.area)
    )
      this.homes.set(actor, d.area);
    const row = actor && m.ids.get(actor);
    if (
      o.type === 'character' &&
      (this.basic || this.opening.module === 'HSA' || this.opening.module === 'MC') &&
      o.phase === 'mastermind-abilities' &&
      actor &&
      d.counters
    ) {
      const before = this.board.get(actor),
        after = d.counters as Piece['counters'];
      if (
        before?.status === 'alive' &&
        before.area === d.area &&
        before.status === d.status &&
        (this.basic || this.opening.module === 'MC') &&
        after.intrigue === before.counters.intrigue + 1 &&
        Object.keys(before.counters).every(
          (k) =>
            k === 'intrigue' ||
            after[k as keyof typeof after] === before.counters[k as keyof typeof after],
        )
      ) {
        this.intrigue(o, before.area, actor);
        return;
      }
      if (
        before?.status === 'alive' &&
        before.area === d.area &&
        before.status === d.status &&
        after.paranoia === before.counters.paranoia + 1 &&
        Object.keys(before.counters).every(
          (k) =>
            k === 'paranoia' ||
            after[k as keyof typeof after] === before.counters[k as keyof typeof after],
        )
      ) {
        this.matchParanoia(o, actor, before.area);
        return;
      }
    }
    if (o.type === 'boundary') {
      if (this.opening.module === 'HSA') {
        if (this.window?.phase === 'day-end')
          this.curses.close(
            m,
            o,
            o.phase === 'day-start' ||
              (o.phase === 'loop-end' &&
                !this.failedEarlier &&
                this.window.day === this.opening.days),
          );
        if (o.phase === 'day-end') this.curses.enter(this.board, m.names);
      }
      if (o.phase === 'final-guess' && this.opening.module === 'LL')
        this.llVictory.enterFinal(m, this.board, o.loop === this.opening.loops, why);
      if (o.phase === 'finished') this.preVictory = this.window?.phase;
      this.close(o);
      if (o.phase === 'discussion' && o.loop > 1) {
        this.lastLoop = new Map(this.board);
        this.lastEx = this.ex;
      }
      if (o.phase === 'card-resolution') {
        this.cardEntry = new Map(this.board);
        this.revealedCards = undefined;
      }
      if (o.phase === 'mastermind-abilities' && this.opening.module === 'HSA') {
        for (const [n, p] of this.board) {
          if (p.status !== 'dead' || ['临时工', '大人物', 'UP主'].includes(n)) continue;
          const role = effectiveRole(m, n, '鬼魂', p, this.causal, why);
          if (typeof role !== 'number' || g.truth(role) === false) continue;
          const home = this.homes.get(n);
          if (!home) continue;
          const targets = new Set(
            [...this.board]
              .filter(([, t]) => t.status === 'alive' && (t.area === p.area || t.area === home))
              .map(([name]) => name),
          );
          if (targets.size && !targets.has('御神木')) this.silentGhosts.set(role, targets);
        }
      }
      if (
        this.opening.module === 'MC' &&
        o.phase === 'mastermind-abilities' &&
        this.ex !== undefined &&
        this.ex >= 1
      ) {
        for (const [n, piece] of this.board) {
          const role = m.ids.get(n === '临时工？' ? '临时工' : n)?.['心理医生'];
          if (
            !role ||
            g.truth(role) === false ||
            piece.status !== 'alive' ||
            ['大人物', 'UP主', '临时工'].includes(n)
          )
            continue;
          const others = [...(this.occupants.get(piece.area) ?? [])].filter((k) => k !== n);
          if (
            others.length &&
            !others.includes('御神木') &&
            n !== '御神木' &&
            others.every((k) => this.board.get(k)!.counters.paranoia > 0)
          )
            this.silentTherapists.set(role, new Set(others));
        }
      }
      this.window = o;
      this.stableEnd = o.phase === 'day-end';
      if (o.phase === 'day-end') {
        this.exAtDayEnd = this.ex;
        this.forcedPoison = [];
        if (this.opening.module === 'MC') this.poison.enter(m, this.board, o, this.ex, this.causal);
        if (this.opening.module === 'MC' && (this.ex === undefined || this.ex >= 4)) {
          const ex = this.ex === undefined ? g.atom(why + ' 进入日末时 EX 至少为四') : true;
          for (const [n, p] of this.board)
            if (p.status === 'alive') {
              const role = effectiveRole(m, n, '投毒者', p, this.causal, why);
              if (role !== undefined && role !== false)
                this.forcedPoison.push(gates(g, why).all([role, ex]));
            }
        }

        this.protagonistDiedAtDayEnd = false;
        this.witnessesAtDayEnd = [];
        if (this.opening.module === 'WM')
          for (const [n, p] of this.board) {
            if (p.status !== 'alive' || !meetsDayEndThreshold('目击者', p.counters)) continue;
            const role = effectiveRole(m, n, '目击者', p, this.causal, why);
            if (typeof role === 'number') this.witnessesAtDayEnd.push(role);
          }
      }
      this.settledDeathGroup = false;
      this.endUses.clear();
      this.observedArrival = false;
      if (o.phase === 'loop-start') {
        this.loopEntry = new Map(this.board);
        this.failedEarlier = false;
        this.failedAtEnd = false;
        this.occurred.clear();
        this.houndSources.length = 0;
        this.reveals.clear();
        this.causal.clear();
        this.grants.clear();
        this.suppressed.clear();
        this.releasedMovement.clear();
        this.curses.reset();
        this.streamerTarget = undefined;
        this.protectedProtagonists = false;
        this.extraProtection = undefined;
        this.homes.clear();
        for (const [n, p] of this.board) if (p.status === 'alive') this.homes.set(n, p.area);
        this.exAtLoopStart = this.ex;
        this.exIncreased = this.ex === undefined ? undefined : false;
        if (this.seen.has('神灵')) this.observedArrival = true;
      }
      return;
    }
    if (o.type === 'identity' && typeof d.identity === 'string') this.reveals.add(d.identity);
    if (
      this.opening.module === 'LL' &&
      o.type === 'identity' &&
      d.identity === '密钥' &&
      o.loop <= 2
    ) {
      this.keyDeaths.add(o.loop + '/' + Math.min(this.opening.days, o.day + 1));
      if (o.day < this.opening.days) this.keyCardDays.add(o.loop + '/' + (o.day + 1));
    }
    if (
      this.keyCardDays.has(o.loop + '/' + o.day) &&
      o.type === 'cards' &&
      Array.isArray(d.placements) &&
      (o.phase === 'card-resolution' || o.phase === 'mastermind-cards') &&
      d.placements.filter((p) => p.owner === 'mastermind').length > 1
    )
      this.assert(why + ' · 密钥公开后的同轮次日剧作家最多一张行动牌');
    if (o.type === 'failure') {
      if (o.phase === 'day-end' && d.result === 'protagonist-death')
        this.protagonistDiedAtDayEnd = true;
      if (
        o.phase === 'day-end' &&
        this.opening.module === 'HSA' &&
        d.result === 'protagonist-death' &&
        this.window?.phase === 'day-end'
      ) {
        const night = this.madNight?.loop === o.loop && this.madNight.day === o.day;
        if (this.protectedProtagonists) this.assert(why + ' · 主人公受保护时不能死亡');
        else
          matchHsaHeroDeath(
            m,
            this.board,
            this.boardIntrigue,
            this.homes,
            this.causal,
            night,
            night ? this.madNight!.delayed : false,
            this.curses.stranded,
            why,
          );
      }
      if (
        o.phase === 'day-end' &&
        this.window?.phase === 'day-end' &&
        d.result === 'protagonist-death' &&
        this.opening.module !== 'HSA' &&
        !this.opening.publicSpecialRules?.length
      ) {
        const sources: Parameters<typeof requireHeroDeath>[2] = this.forcedPoison.map((when) => ({
            when,
          })),
          gate = gates(g, why);
        const module = this.opening.module;
        if (this.protectedProtagonists) this.assert(why + ' · 主人公受保护时不能死亡');
        if (module === 'WM')
          sources.push({ when: this.exAtDayEnd === undefined || this.exAtDayEnd >= 4 });
        if (module === 'LL') {
          if (this.keyDeaths.has(o.loop + '/' + o.day) || this.opening.loop > 1)
            sources.push({ when: true });
          let shrine = this.boardIntrigue.shrine ?? 0;
          for (const p of this.board.values())
            if (p.area === 'shrine' && p.status === 'alive')
              shrine += p.counters.despair - p.counters.hope;
          if (shrine >= 2) sources.push({ when: m.plots['封印的终末']! });
        }
        for (const [n, p] of this.board) {
          if (p.status !== 'alive') continue;
          const add = (role: string, extra: boolean | number = true) => {
            const when = gate.all([effectiveRole(m, n, role, p, this.causal, why) ?? false, extra]);
            sources.push({
              when,
              role,
              owner:
                n === '临时工' ? undefined : m.ids.get(n === '临时工？' ? '临时工' : n)?.[role],
            });
          };
          for (const owner of ['杀手', '求爱者', '祭品'] as const)
            if (
              m.ids.get(n === '临时工？' ? '临时工' : n)?.[owner] &&
              meetsDayEndThreshold(owner, p.counters)
            )
              add(owner);
          if (
            module === 'LL' &&
            o.day === this.opening.days &&
            Object.values(p.counters).reduce((x, y) => x + y, 0) <= 1
          )
            add('监视者', m.plots['恶魔的剧本']!);
        }
        requireHeroDeath(m, why + ' · 日末主人公死亡的可行来源', sources);
      }
      if (o.phase === 'loop-end') this.failedAtEnd = true;
      else this.failedEarlier = true;
    }
    if (
      o.phase === 'day-end' &&
      o.type === 'character' &&
      actor &&
      d.status === 'dead' &&
      this.board.get(actor)?.status === 'alive'
    ) {
      if (this.matchedDeathGroup) return;
      if (this.window?.phase === 'day-end' && !this.stableEnd) {
        this.pending(o, actor + ' 的死亡可能属于前批已成立的请求或后续连锁');
        return;
      }
      if (
        dayEndDeath(m, this.board, actor, true, why, {
          postCurse:
            this.window?.phase === 'day-end' && !this.curses.pendingDeath
              ? this.boardIntrigue
              : undefined,
          day: o.day,
          ex: this.ex,
          causal: this.causal,
        })
      )
        return;
    }
    if (this.opening.module === 'LL') {
      if (
        o.type === 'board' &&
        (typeof d.communicatedMarker === 'string' || typeof d.diedMarker === 'string')
      ) {
        if (typeof d.communicatedMarker === 'string')
          this.markers.communicated.add(d.communicatedMarker);
        if (typeof d.diedMarker === 'string') this.markers.died.add(d.diedMarker);
        return;
      }
      if (o.phase === 'final-guess') {
        if (o.type === 'culprit' && d.guesses) this.llVictory.answer(m, true, why);
        if (o.type === 'identity' && typeof d.guess === 'string')
          this.llVictory.answer(m, false, why);
        const choice = d.choice as { kind?: string } | undefined;
        if (
          o.type === 'own-choice' &&
          choice?.kind === 'guess-culprits' &&
          typeof d.actor === 'string' &&
          m.seats.has(d.actor)
        ) {
          this.llVictory.answer(m, true, why);
          this.assert(why + ' · 回答全日程的是 C 席', m.seats.get(d.actor)!.C!);
        }
      }
      if (o.type === 'culprit' && d.guesses)
        this.assert(why + ' · 背叛者 C 获得回答机会', m.plots['我才是名侦探']!);
      if (o.type === 'victory' && typeof d.winner === 'string' && m.seats.has(d.winner)) {
        const entry =
          this.preVictory === 'day-end'
            ? ['A', '真正的怪物']
            : this.preVictory === 'protagonist-abilities'
              ? ['B', '神话收集者']
              : this.preVictory === 'final-guess'
                ? ['C', '我才是名侦探']
                : undefined;
        if (entry) {
          if (
            (entry[0] === 'A' && this.markers.died.size < 5) ||
            (entry[0] === 'B' && this.markers.communicated.size < 6)
          )
            this.assert(why + ' · 特殊胜利标志数量不足');
          if (entry[0] !== 'C') this.llVictory.won(m, why);
          this.assert(why + ' · 特殊胜利副线', m.plots[entry[1]!]!);
          this.assert(why + ' · 获胜席位的私人牌', m.seats.get(d.winner)![entry[0]!]!);
          return;
        }
      }
    }
    if (o.type === 'rule' && typeof d.rule === 'string') {
      const atom =
        this.opening.module === 'WM' && o.phase === 'loop-end' ? m.x1[d.rule] : m.plots[d.rule];
      if (atom) this.assert(why + ' · 公开规则', atom);
      else this.pending(o, '公开规则的用途缺少绑定');
      return;
    }
    if (o.type === 'culprit') {
      const resolve = (day: number, id: unknown) =>
        m.culprits.get(day)?.[m.names.get(String(id)) ?? String(id)];
      if (d.guesses && typeof d.guesses === 'object' && typeof d.correct === 'boolean') {
        const guesses = Object.entries(d.guesses).map(([day, id]) => resolve(Number(day), id));
        if (guesses.every((a): a is number => !!a) && guesses.length === m.culprits.size) {
          if (d.correct) for (const a of guesses) this.assert(why + ' · 全部当事人回答正确', a);
          else this.assert(why + ' · 至少一个当事人回答错误', ...guesses.map((a) => -a));
          return;
        }
      }
      const schedule = m.culprits.get(Number(d.day));
      const known = m.names.get(String(d.culprit));
      if (
        schedule &&
        typeof d.culprit === 'string' &&
        (!known || (m.absent.has(known) && !this.seen.has(known))) &&
        !boards.includes(d.culprit)
      ) {
        let bindings = this.hiddenBindings.get(d.culprit);
        if (!bindings) {
          bindings = new Map();
          for (const [n, missing] of m.absent) {
            if (this.seen.has(n)) continue;
            const a = g.atom('未登场绑定 ' + d.culprit + ' ' + n);
            g.add(why + ' · 配置角色存在', [-missing], 1, 1, a);
            for (const other of this.hiddenBindings.values())
              if (other.has(n)) g.add('不同公开编号对应不同配置角色', [a, other.get(n)!], 0, 1);
            bindings.set(n, a);
          }
          this.hiddenBindings.set(d.culprit, bindings);
          g.add(why + ' · 未登场角色编号绑定', [...bindings.values()], 1, 1);
        }
        for (const [n, a] of bindings)
          g.add(why + ' · 登场前公开的当事人', [schedule[n]!], 1, 1, a);
        return;
      }
      const atom = resolve(Number(d.day), d.culprit);
      if (atom) this.assert(why + ' · 公开配置当事人', atom);
      else this.pending(o, '当事人与后台行尚未绑定');
      return;
    }
    if (
      o.type === 'identity' &&
      row &&
      typeof d.guess === 'string' &&
      typeof d.correct === 'boolean'
    ) {
      const guess = row[d.guess];
      const options = guess ? [guess] : [];
      const fragment = m.fragments.get(actor!);
      if (d.guess === '因果残片' && fragment) options.push(fragment);
      if (d.guess === '平民' && fragment) options.push(fragment);
      if (d.correct) this.assert(why + ' · 最终决战回答正确', ...options);
      else for (const a of options) this.assert(why + ' · 最终决战回答错误', -a);
      return;
    }
    if (
      o.type === 'identity' &&
      !actor &&
      typeof d.character === 'string' &&
      d.character.startsWith('victim:') &&
      this.opening.module === 'HSA'
    ) {
      const [, area, index] = d.character.split(':');
      if (!area || !boards.includes(area) || index === undefined || !/^\d+$/.test(index)) {
        this.pending(o, '牺牲者编号或版图未绑定');
        return;
      }
      if (Number(index) >= this.boardIntrigue[area]!) this.assert(why + ' · 该版图没有对应牺牲者');
      else if (d.identity === '丧尸' || d.identity === '平民')
        this.assert(
          why + ' · 牺牲者的有效身份',
          (d.identity === '丧尸' ? 1 : -1) * m.plots['古墓活尸']!,
        );
      else this.assert(why + ' · 牺牲者不能具有所公开的身份');
      return;
    }
    if (o.type === 'identity' && actor && typeof d.identity === 'string') {
      const piece = this.board.get(actor);
      const actual = effectiveRole(m, actor, d.identity, piece, this.causal, why);
      if (actual === undefined) {
        this.pending(o, '公开身份缺少角色状态');
        return;
      }
      const gate = gates(g, why + ' 身份公告');
      const options: (number | boolean)[] = [actual];
      const candidates: number[] = [];
      const config = m.ids.get(actor === '临时工？' ? '临时工' : actor);
      if (config && actor !== '临时工') {
        if (config[d.identity]) candidates.push(config[d.identity]!);
        if (
          d.identity === '杀人狂' &&
          m.plots['妄想扩大病毒'] &&
          piece!.status === 'alive' &&
          piece!.counters.paranoia + piece!.counters.despair >= 3
        )
          candidates.push(config['平民']!);
        if (d.identity === '丧尸' && m.plots['古墓活尸'] && piece!.status === 'dead')
          for (const r of ['平民', '胆小鬼', '纸老虎']) candidates.push(config[r]!);
      }
      if (
        m.data.identities.some((i) => i.name === '忍者') &&
        d.identity !== '平民' &&
        piece!.status === 'alive'
      ) {
        const holders = [...m.ids.values()].flatMap((r) =>
          r[String(d.identity)] ? [r[String(d.identity)]!] : [],
        );
        const ninja = effectiveRole(m, actor, '忍者', piece, this.causal, why);
        options.push(gate.all([ninja ?? false, gate.any(holders)]));
        if (config?.['忍者']) candidates.push(config['忍者']);
      }
      const match = gate.any(options);
      if (match !== true) g.add(why + ' · 身份公开', typeof match === 'number' ? [match] : [], 1);
      const override =
        d.identity === '关键人物' && this.causal.has(actor) ? m.plots['因果之绊'] : undefined;
      if (candidates.length && actor !== '临时工')
        g.add(
          why + ' · 配置身份范围',
          [...new Set(candidates)],
          1,
          new Set(candidates).size,
          override ? -override : undefined,
          true,
        );
      return;
    }
    if (
      o.type === 'identity' &&
      typeof d.sameIdentityAs === 'string' &&
      Array.isArray(d.characters)
    ) {
      const owner = m.names.get(d.sameIdentityAs),
        gate = gates(g, why + ' 相同有效身份');
      if (!owner || !this.board.has(owner)) {
        this.pending(o, '相同身份的来源角色缺少绑定');
        return;
      }
      for (const [id, name] of m.names) {
        const p = this.board.get(name);
        if (owner === name || p?.status !== 'alive') continue;
        const values = m.data.identities.map(({ name: role }) =>
          gate.all([
            effectiveRole(m, owner, role, this.board.get(owner), this.causal, why) ?? false,
            effectiveRole(m, name, role, p, this.causal, why) ?? false,
          ]),
        );
        const equal = gate.any(values),
          match = d.characters.includes(id) ? equal : gate.not(equal);
        if (match !== true)
          g.add(
            why + ' · ' + name + ' 的相同身份回答',
            typeof match === 'number' ? [match] : [],
            1,
          );
      }
      return;
    }
    if (o.type === 'board' && typeof d.territory === 'string') {
      this.territory = d.territory;
      const choice = this.territoryChoices.get(d.territory);
      if (choice) this.assert(why + ' · 公布制作时指定的领地', choice);
    }
    if (
      this.opening.module === 'MC' &&
      o.type === 'board' &&
      d.attachment === 'lockdown-area' &&
      typeof d.target === 'string' &&
      boards.includes(d.target)
    ) {
      this.lockdown = { area: d.target, day: o.day, loop: o.loop, reason: why };
      return;
    }
    if (o.type === 'board' && d.attachment === 'streamer-target')
      this.streamerTarget = m.names.get(String(d.target)) ?? '未绑定';
    if (o.type === 'board' && Array.isArray(d.curses) && this.opening.module === 'HSA') {
      this.curses.read(m, o, this.homes, (reason) => this.pending(o, reason));
      return;
    }
    if (o.type === 'board' && typeof d.ex === 'number') {
      if (this.incidentEx && o.phase === 'incident') this.matchIncidentEx(o, d.ex);
      if (this.refusalEx) {
        if (this.ex === undefined) {
          this.pending(o, '拒绝前 EX 基数缺失');
          this.refusalEx = 0;
        } else {
          const gain = Math.max(0, d.ex - this.ex);
          if (gain > this.refusalEx) this.pending(o, '拒绝以外的 EX 增量');
          this.refusalEx = Math.max(0, this.refusalEx - gain);
        }
      }
      if (this.ex !== undefined && d.ex > this.ex) this.exIncreased = true;
      this.ex = d.ex;
      return;
    }
    if (o.type === 'board' && d.attachment === 'causal-ex' && this.opening.module === 'MZ') {
      const name = m.names.get(String(d.target)),
        entry = name && this.loopEntry?.get(name),
        previous = name && this.lastLoop?.get(name);
      if (
        o.phase !== 'loop-start' ||
        o.loop === 1 ||
        (entry && entry.status !== 'alive') ||
        (previous && previous.status !== 'dead')
      )
        this.assert(why + ' · 因果 EX 目标与上轮死亡状态冲突');
      else if (!previous || !entry) this.pending(o, '因果 EX 目标的跨轮绑定');
      g.add(why + ' · 因果 EX 附着', [m.plots['因果之绊']!, m.plots['诸神之骰']!], 1);
      this.causal.add(name ?? String(d.target));
      return;
    }
    if (o.type === 'card-grant' && o.phase === 'loop-start') {
      this.grants.add(String(d.kind));
      if (
        o.loop === 1 &&
        o.loop === this.opening.loops &&
        d.kind === 'hope+1' &&
        m.plots['超越世界线']
      )
        this.assert(why + ' · 首轮也是最终轮的希望牌', m.plots['超越世界线']);
      else this.pending(o, '授牌来源依赖上轮状态');
      return;
    }
    if (o.type === 'incident' && typeof d.occurred === 'boolean') {
      this.incident(o, d.occurred);
      if (d.occurred) this.occurred.add(String(d.name));
      if (d.occurred && this.opening.module === 'HSA' && d.name === '疯狂之夜')
        this.madNight = {
          day: o.day,
          loop: o.loop,
          delayed: madNightAtOccurrence(m, this.board, this.boardIntrigue, this.causal, why),
        };

      if (d.occurred && o.day === Number(d.day) && o.phase === 'incident') {
        this.outcome = startOutcome(
          o,
          this.board,
          this.boardIntrigue,
          this.opening.module === 'HSA' ? this.curses.currentIds() : undefined,
        );
        this.outcome.initialEx = this.ex;
        if (this.opening.module === 'WM' && d.name === '灭绝之火') {
          this.outcome.firstFire = this.pastFireDays.has(o.day)
            ? false
            : this.opening.loop <= 1
              ? true
              : undefined;
          this.pastFireDays.add(o.day);
        }
        if (this.opening.module === 'LL' && d.name === '遗言') {
          const cat = m.culprits.get(o.day)?.['黑猫'];
          this.scheduleHope(o.loop, cat ? -cat : true);
        }
        if (
          this.opening.module === 'MC' &&
          this.opening.incidents.some((i) => i.day === o.day && i.name === d.name)
        )
          this.incidentEx = { day: o.day, before: this.ex, source: o };
      }
      return;
    }
    if (o.type === 'board' && typeof d.board === 'string' && typeof d.intrigue === 'number') {
      if (o.phase === 'mastermind-abilities' && d.intrigue === this.boardIntrigue[d.board]! + 1)
        this.intrigue(o, d.board);
      else this.pending(o, '版图变化的来源');
      return;
    }
    if (
      (o.type === 'declaration' || o.type === 'refused') &&
      actor &&
      typeof d.ability === 'string'
    ) {
      const state = this.board.get(actor);
      if (!state) {
        this.pending(o, '声明时的角色盘面缺失');
        return;
      }
      const gate = gates(g, why + ' 友好能力');
      const role = (r: string) => effectiveRole(m, actor, r, state, this.causal, why) ?? false;
      const modes = m.data.identities.filter((i) => i.ignore);
      const obligatory = modes.filter((i) => i.ignore === 'mandatory').map((i) => role(i.name));
      if (m.ids.get(actor)?.['纸老虎'] && state.counters.paranoia + state.counters.despair >= 2)
        obligatory.push(role('纸老虎'));
      const other = modes.filter((i) => i.ignore === 'optional').map((i) => role(i.name));
      if (m.plots['捏造的秘密']) other.push(gate.all([role('密钥'), m.plots['捏造的秘密']]));
      const parent =
        o.type === 'declaration'
          ? this.declarations.find(
              (x) =>
                x.ability === 'little-sister' &&
                x.target === actor &&
                x.invokedAbility === d.ability,
            )
          : undefined;
      if (parent) parent.invokedAbility = undefined;
      const exempt =
        Boolean(parent) ||
        ['nurse', 'outsider-reveal', 'copycat-reveal'].includes(d.ability) ||
        state.counters.hope > 0;
      const must = exempt ? false : gate.any([state.counters.despair > 0, ...obligatory]);
      const can = exempt ? false : gate.any([must, ...other]);
      const roleOptions =
        m.ids.get(actor) && state.counters.despair === 0 && !exempt
          ? [
              ...modes.map((i) => m.ids.get(actor)![i.name]!),
              ...(m.ids.get(actor)!['纸老虎'] ? [m.ids.get(actor)!['纸老虎']!] : []),
              ...(m.plots['捏造的秘密'] ? [m.ids.get(actor)!['密钥']!] : []),
            ]
          : [];
      if (o.type === 'declaration') {
        if (
          o.phase === 'protagonist-abilities' &&
          this.completedGoodwill.has(useKey(actor, d.ability, o.loop, o.day))
        )
          this.assert(why + ' · ' + actor + ' 的 ' + d.ability + ' 已完成且次数耗尽');
        const choices = d.choices as Record<string, unknown> | undefined;
        const target = m.names.get(String(choices?.target));
        const before = target && this.board.get(target);
        let publicResult: PublicResult | undefined;
        if (d.ability === 'illusion-remove')
          publicResult = {
            type: 'character',
            key: 'character',
            value: d.character,
            status: 'removed',
          };
        let movement;
        if (['girl-move', 'illusion-move', 'immortal-revive'].includes(d.ability)) {
          const moving = d.ability === 'illusion-move' ? target : actor;
          const piece = moving && this.board.get(moving);
          const to = choices?.area;
          if (
            moving &&
            piece &&
            typeof to === 'string' &&
            (boards.includes(to) || (to === 'far' && d.ability === 'immortal-revive'))
          ) {
            const forbidden = (m.data.forbidden.get(moving) ?? []).includes(to);
            const release = this.releasedMovement.get(moving);
            movement = {
              target: moving,
              destinations:
                !forbidden || release === true
                  ? [to]
                  : release === false
                    ? [piece.area, to]
                    : [piece.area],
            };
          } else this.pending(o, d.ability + ' 的移动对象或目的地未绑定');
        }
        if (d.ability === 'alien-revive' && choices?.target) {
          const id = String(choices.target);
          if (before && before.status === 'dead')
            publicResult = { type: 'character', key: 'character', value: id, status: 'alive' };
          else if (this.opening.module === 'HSA' && id.startsWith('victim:')) {
            const area = id.split(':')[1];
            if (area && this.boardIntrigue[area]! > 0)
              publicResult = {
                type: 'board',
                key: 'board',
                value: area,
                intrigue: this.boardIntrigue[area]! - 1,
              };
          }
        }
        const selfReveal = ['office-worker', 'outsider-reveal', 'parttimer-reveal'].includes(
          d.ability,
        );
        const targetReveal = [
          'shrine-maiden-reveal',
          'teacher-reveal',
          'leader-reveal',
          'forensic-reveal',
          'boss-reveal',
        ].includes(d.ability);
        if (selfReveal || (targetReveal && choices?.target))
          publicResult = {
            type: 'identity',
            key: 'character',
            value: selfReveal ? d.character : choices?.target,
          };
        if (d.ability === 'copycat-reveal')
          publicResult = { type: 'identity', key: 'sameIdentityAs', value: d.character };
        if (
          ['detective-incident', 'divinity-incident'].includes(d.ability) &&
          this.opening.incidents.some((i) => i.day === Number(choices?.day))
        )
          publicResult = { type: 'culprit', key: 'day', value: Number(choices?.day) };
        const area = d.ability === 'shrine-maiden-remove' ? 'shrine' : String(choices?.target);
        if (
          boards.includes(area) &&
          ['shrine-maiden-remove', 'media-intrigue', 'divinity-intrigue'].includes(d.ability)
        ) {
          const prior = this.boardIntrigue[area]!;
          const intrigue = Math.max(
            0,
            Math.min(3, prior + (d.ability === 'media-intrigue' ? 1 : -1)),
          );
          if (prior !== intrigue)
            publicResult = { type: 'board', key: 'board', value: area, intrigue };
        }
        const expected = new Map<string, Partial<Counters>>();
        const change = before && expectedCounters(d.ability, before.counters, choices);
        if (target && change) expected.set(target, change);
        if (d.ability === 'forensic-transfer') {
          const from = m.names.get(String(choices?.from)),
            to = m.names.get(String(choices?.to));
          const counter = choices?.counter as keyof Counters;
          const left = from && this.board.get(from),
            right = to && this.board.get(to);
          if (
            from &&
            to &&
            left &&
            right &&
            Object.prototype.hasOwnProperty.call(left.counters, counter)
          ) {
            const amount = left.counters[counter] > 0 ? 1 : right.counters[counter] > 0 ? -1 : 0;
            if (amount) {
              expected.set(from, { [counter]: left.counters[counter] - amount });
              expected.set(to, { [counter]: right.counters[counter] + amount });
            } else if (
              Object.values(left.counters).some(Boolean) ||
              Object.values(right.counters).some(Boolean)
            )
              this.assert(why + ' · 鉴别员所选指示物在两名对象上均不存在');
          } else this.pending(o, '鉴别员转移对象或指示物未绑定');
        }
        let revival;
        if (d.ability === 'immortal-revive' && typeof choices?.target === 'string') {
          const id = choices.target;
          if (before && before.status === 'dead')
            revival = { id, area: before.area, goodwill: before.counters.goodwill, seen: false };
          else if (this.opening.module === 'HSA' && id.startsWith('victim:')) {
            const area = id.split(':')[1];
            if (area && this.boardIntrigue[area]! > 0)
              revival = { id, area, intrigue: this.boardIntrigue[area]!, seen: false };
          }
        }
        let attack;
        if (d.ability === 'alien-kill') {
          if (target && before) {
            const pieces = new Map([[target, before]]);
            const servant = this.board.get('从者');
            if (servant?.status === 'alive' && servant.area === before.area)
              pieces.set('从者', servant);
            attack = { target, before: pieces, protection: this.extraProtection, settled: false };
          } else this.pending(o, '异界人杀害的对象未绑定');
        }
        let callOutcome;
        if (d.ability === 'ai' && typeof choices?.incident === 'string') {
          const name = choices.incident;
          if (!this.opening.incidents.some((i) => i.name === name))
            this.assert(why + ' · AI 所选事件不在公开日程');
          if (m.data.events.includes(name)) {
            callOutcome = startOutcome(
              { ...o, data: { name } },
              this.board,
              this.boardIntrigue,
              this.opening.module === 'HSA' ? this.curses.currentIds() : undefined,
            );
            callOutcome.firstFire = false;
            callOutcome.initialEx = this.ex;
          }
        }
        this.declarations.push({
          callOutcome,
          illegalProtection:
            d.ability === 'servant' &&
            target !== undefined &&
            (target === actor || (!!before && before.status !== 'alive')),
          possibleProtection:
            d.ability === 'servant' && !target
              ? [...this.board]
                  .filter(([n, p]) => n !== actor && p.status === 'alive')
                  .map(([n]) => n)
              : undefined,
          actor,
          ability: d.ability,
          revival,
          attack,
          movement,
          confirmed: false,
          revealed: new Set(),
          invokedAbility:
            d.ability === 'little-sister' && typeof choices?.ability === 'string'
              ? choices.ability
              : undefined,
          invokedIncident: typeof choices?.incident === 'string' ? choices.incident : undefined,
          must,
          can,
          roleOptions,
          reason: why,
          target,
          expected,
          publicResult,
        });
        return;
      }
      if (this.opening.module === 'WM' && o.phase === 'protagonist-abilities') this.refusalEx++;
      const index = this.declarations.findIndex(
        (entry) => entry.actor === actor && entry.ability === d.ability,
      );
      const declaration = index < 0 ? undefined : this.declarations.splice(index, 1)[0];
      const match = declaration?.can ?? can;
      if (match !== true)
        g.add(why + ' · 友好能力被拒绝', typeof match === 'number' ? [match] : [], 1);
      if (roleOptions.length && actor !== '临时工') {
        g.add(why + ' · 有效拒绝来源范围', roleOptions, 1, roleOptions.length, undefined, true);
        g.resolveCauses(why + ' · 友好被拒的配置身份', roleOptions);
      }
      return;
    }
    if (
      o.type === 'cards' &&
      o.phase === 'card-resolution' &&
      Array.isArray(d.placements) &&
      d.placements.every((p) => typeof p.kind === 'string')
    )
      this.revealedCards = d.placements;
    if (
      o.type === 'cards' &&
      ['MZ', 'HSA'].includes(this.opening.module) &&
      Array.isArray(d.placements)
    ) {
      for (const p of d.placements)
        if (p.owner === 'mastermind') {
          const name = m.names.get(p.target);
          const prophet =
            name && m.ids.get(name)?.[this.opening.module === 'HSA' ? '狼人' : '预言家'];
          if (prophet && name !== '临时工' && !this.causal.has(name))
            this.assert(why + ' · 剧作家设置行动牌', -prophet);
        }
    }
    if (
      o.type === 'character' &&
      actor &&
      m.arrival.has(actor) &&
      d.status === 'alive' &&
      !this.seen.has(actor)
    ) {
      // Divinity resets in discussion before the loop-start boundary.
      if (
        (actor === '转校生' && o.phase === 'day-start') ||
        (actor === '神灵' && ['discussion', 'loop-start'].includes(o.phase))
      ) {
        this.assert(
          why + ' · 首次登场',
          m.arrival.get(actor)![(actor === '神灵' ? o.loop : o.day) - 1]!,
        );
        this.observedArrival = true;
        if (typeof d.area === 'string') this.homes.set(actor, d.area);
      }
      this.assert(why + ' · 已配置角色', -m.absent.get(actor)!);
      this.rosterChanged = true;
      const binding = this.hiddenBindings.get(String(d.character))?.get(actor);
      if (binding) this.assert(why + ' · 已知编号正式登场', binding);
    }
    if (!['own-choice', 'declaration', 'cards'].includes(o.type))
      this.pending(o, o.type + ' 的其余来源或连锁效果');
    else if (
      o.type !== 'own-choice' ||
      !['continue', 'pass'].includes(String((d.choice as { kind?: string })?.kind))
    )
      this.pending(o, '主动行为的约束及后续效果');
  }
  private matchIncidentEx(o: Observation, current?: number) {
    const w = this.incidentEx!;
    this.incidentEx = undefined;
    const actors = this.model.culprits.get(w.day),
      events = this.model.events.get(w.day);
    if (!actors || !events || current === undefined || w.before === undefined) {
      this.pending(o, 'MC 事件 EX 增量缺少基数或日程绑定');
      return;
    }
    const g = this.model.graph,
      delta = current - w.before;
    const reason = '#' + w.source.sequence + ' 至 #' + o.sequence + ' · MC 发生时 EX 增量 ' + delta;
    // The cat changes only the special gains. Group all other culprits into one literal.
    const cat = actors['黑猫'];
    for (const [name, real] of Object.entries(events)) {
      if (g.truth(real) === false) continue;
      const gain = name === '猎奇杀人' ? 2 : name === '银色子弹' ? 0 : 1;
      g.work.sources.push(name + ' · 发生时 EX');
      if (gain === 1 || !cat) {
        if (delta !== gain) this.assert(reason, -real);
      } else if (delta === 1) g.add(reason + ' · 黑猫替换事件文本', [cat], 1, 1, real);
      else if (delta === gain) g.add(reason + ' · 事件原本的增量', [-cat], 1, 1, real);
      else this.assert(reason, -real);
    }
  }
  private incident(o: Observation, occurred: boolean) {
    const { model: m } = this,
      why = '#' + o.sequence + ' · 事件发生判定';
    const day = Number(o.data.day),
      cu = m.culprits.get(day);
    if (
      !cu ||
      o.phase !== 'incident' ||
      o.day !== day ||
      this.opening.incidents.find((i) => i.day === day)?.name !== o.data.name
    ) {
      this.pending(o, '预定事件窗口未绑定');
      return;
    }
    matchIncident(
      m,
      {
        board: this.board,
        intrigue: this.boardIntrigue,
        ex: this.ex,
        territory: this.territory ?? this.opening.territory,
        streamerArea: this.streamerTarget
          ? (this.board.get(this.streamerTarget)?.area ?? '未绑定')
          : undefined,
        causal: this.causal,
        suppressed: this.suppressed,
      },
      o,
      occurred,
      (text) => this.pending(o, text),
    );
  }
  private territoryRequirement(actor: string, area: string): number | undefined {
    if (
      actor !== '大人物' ||
      this.board.get(actor)?.area === area ||
      this.territory ||
      this.opening.territory ||
      !boards.includes(area)
    )
      return;
    if (!this.territoryChoices.size) {
      const g = this.model.graph;
      for (const b of boards) this.territoryChoices.set(b, g.atom('大人物制作时的领地 ' + b));
      g.add('大人物在制作时指定一块领地', [...this.territoryChoices.values()], 1, 1);
    }
    return this.territoryChoices.get(area);
  }
  private readonly priorAbilityActors = new Set<string>();
  private revisitAbilityRoles(reason: string, actors: Iterable<string>) {
    const g = this.model.graph;
    for (const n of actors) {
      const row = this.model.ids.get(n);
      if (!row || n === '临时工') continue;
      if (this.priorAbilityActors.has(n)) {
        const roles = Object.values(row).filter((a) => g.truth(a) !== false);
        if (roles.length > 1) g.resolveCauses(reason + ' · 同一角色解释两项来源 ' + n, roles);
      }
      this.priorAbilityActors.add(n);
    }
  }
  private abilityActors(area: string) {
    const local = new Set(this.occupants.get(area) ?? []);
    if (
      this.board.get('大人物')?.status === 'alive' &&
      ((this.territory ?? this.opening.territory) === area ||
        (!this.territory && !this.opening.territory && boards.includes(area)))
    )
      local.add('大人物');
    if (
      this.streamerTarget &&
      this.board.get('UP主')?.status === 'alive' &&
      this.board.get(this.streamerTarget)?.area === area
    )
      local.add('UP主');
    return local;
  }
  private matchParanoia(o: Observation, target: string, area: string) {
    const tree = this.board.get('御神木');
    if (
      tree?.status === 'alive' &&
      tree.area === area &&
      target !== '御神木' &&
      (o.simultaneousSize === undefined ||
        (tree.counters.paranoia > 0 && this.treeTransfer.has('paranoia')))
    ) {
      this.pending(o, '同区御神木转移不安与其他来源');
      return;
    }
    const m = this.model,
      g = m.graph,
      why = '#' + o.sequence + ' · 剧作家增加不安';
    const local = this.abilityActors(area);
    if (this.streamerTarget === '未绑定' && this.board.get('UP主')?.status === 'alive') {
      this.pending(o, 'UP 主 EX 持有者未绑定');
      return;
    }
    const uses: number[] = [],
      roles: number[] = [];
    const add = (
      actor: string,
      ability: string,
      requirements: number[],
      grantedBy = '',
      useTerritory = true,
    ) => {
      if (!requirements.length || requirements.every((l) => g.truth(l) === false)) return;
      g.work.sources.push(actor + ' · ' + ability);
      const source = g.atom(why + ' ' + actor + ' ' + ability + grantedBy);
      g.add(why + ' · ' + ability, requirements, 1, requirements.length, source);
      const remote = useTerritory && this.territoryRequirement(actor, area);
      if (remote) g.add(why + ' · 通过制作时指定的领地使用能力', [remote], 1, 1, source);
      const key = o.loop + '/' + o.day + '/' + actor + '/' + ability,
        prior = this.uses.get(key) ?? [];
      prior.push(source);
      this.uses.set(key, prior);
      if (prior.length > 1) g.add(why + ' · 每阶段限一次', prior.slice(), 0, 1);
      uses.push(source);
      return source;
    };
    const substitutes: number[] = [];
    for (const n of local) {
      const row = m.ids.get(n === '临时工？' ? '临时工' : n);
      if (n === '临时工' || !row) continue;
      if (add(n, '传谣人', [row['传谣人']!])) roles.push(row['传谣人']!);
      if (target === n && row['偏执狂']) {
        const source = add(n, '偏执狂', [row['偏执狂']]);
        if (source) substitutes.push(source);
      }
      if (row['不安定因子'] && this.boardIntrigue.school! >= 2) {
        const source = add(n, '传谣人', [row['不安定因子']], ' · 不安定因子获得');
        if (source) substitutes.push(source);
      }
    }
    if (this.opening.module === 'HSA') {
      for (const [n, p] of this.board) {
        if (p.status !== 'dead' || n === '临时工') continue;
        const home = this.homes.get(n);
        const remote =
          (n === '大人物' && (this.territory ?? this.opening.territory ?? area) === area) ||
          (n === 'UP主' &&
            this.streamerTarget &&
            this.board.get(this.streamerTarget)?.area === area);
        if (p.area !== area && home && home !== area && !remote) continue;
        const ghost = m.ids.get(n === '临时工？' ? '临时工' : n)?.['鬼魂'];
        if (ghost) {
          const source = add(
            n,
            '鬼魂',
            [ghost],
            '',
            p.area !== area && home !== area && Boolean(home),
          );
          if (source) substitutes.push(source);
        }
      }
    }
    const doctor = this.board.get('医生');

    if (
      local.has('医生') &&
      doctor &&
      target !== '医生' &&
      doctor.counters.goodwill + doctor.counters.hope >= 2 &&
      !doctor.counters.hope
    ) {
      const requirements = m.data.identities
        .filter((i) => i.ignore)
        .map((i) => m.ids.get('医生')![i.name]!);
      if (doctor.counters.despair) {
        const lit = g.atom(why + ' 医生绝望');
        this.assert(why, lit);
        requirements.push(lit);
      }
      const source = add('医生', '医生能力', requirements);
      if (source) substitutes.push(source);
    }
    const alt = gates(g, why + ' 替代来源').any(substitutes);
    const alternate = typeof alt === 'number' ? alt : undefined;
    g.add(why + ' · 选择一个来源', uses, 1, 1);
    g.add(
      why + ' · 传谣人所在集合',
      roles,
      1,
      roles.length,
      alternate ? -alternate : undefined,
      true,
    );
    const allRumors = [...m.ids.values()].map((row) => row['传谣人']!);
    g.resolveCauses(why, uses);
    // Copycat and outsider are outside ordinary quotas.
    if (!m.ids.has('模仿犯') && !m.ids.has('局外人'))
      g.add(
        why + ' · 传谣人名额已由本区占用',
        allRumors.filter((a) => !roles.includes(a)),
        0,
        0,
        alternate ? -alternate : undefined,
      );
    this.revisitAbilityRoles(why, local);
  }
  private intrigue(o: Observation, area: string, target?: string) {
    const m = this.model,
      g = m.graph,
      why = '#' + o.sequence + ' · ' + (target ?? area) + ' 增加密谋';
    const tree = this.board.get('御神木');
    if (
      target &&
      target !== '御神木' &&
      tree?.status === 'alive' &&
      tree.area === area &&
      (o.simultaneousSize === undefined ||
        (tree.counters.intrigue > 0 && this.treeTransfer.has('intrigue')))
    ) {
      this.pending(o, '同区御神木转移密谋与其他来源');
      return;
    }
    if (this.streamerTarget === '未绑定' && this.board.get('UP主')?.status === 'alive') {
      this.pending(o, 'UP 主 EX 持有者未绑定');
      return;
    }
    const gate = gates(g, why);
    const alternatives: { use: number; role?: number; character?: string }[] = [];
    const use = (
      source: string,
      needs: (boolean | number)[],
      key: string,
      limit: number,
      role?: number,
      character?: string,
    ) => {
      if (needs.some((l) => l === false || (typeof l === 'number' && g.truth(l) === false))) return;
      g.work.sources.push(source);
      const choice = g.atom(why + ' 来源 ' + source);
      const requirements = needs.filter((v): v is number => typeof v === 'number');
      g.add(why + ' · ' + source, requirements, requirements.length, requirements.length, choice);
      const prior = this.uses.get(key) ?? [];
      prior.push(choice);
      this.uses.set(key, prior);
      if (prior.length > limit) g.add(source + ' 使用次数', prior.slice(), 0, limit);
      alternatives.push({ use: choice, role, character });
      return choice;
    };
    const loopKey = o.loop + '/',
      dayKey = loopKey + o.day + '/';
    const factor: number[] = [];
    const ignored: (boolean | number)[] = [];
    const localActors = this.abilityActors(area);
    for (const n of localActors) {
      const p = this.board.get(n)!;
      if (p.status !== 'alive') continue;
      const row = m.ids.get(n === '临时工？' ? '临时工' : n);
      if (!row) {
        this.pending(o, '角色身份行缺少绑定');
        return;
      }
      const local = p.area === area;
      if (local && n !== '临时工' && row['不安定因子']) factor.push(row['不安定因子']);
      if (local && !p.counters.hope) {
        if (p.counters.despair) ignored.push(true);
        else if (n !== '临时工') {
          ignored.push(...m.data.identities.filter((i) => i.ignore).map((i) => row[i.name]!));
          if (row['纸老虎'] && p.counters.paranoia >= 2) ignored.push(row['纸老虎']);
        }
      }
      if (n === '临时工') continue;
      if (target === n && row['偏执狂'])
        use(n + ' · 偏执狂', [row['偏执狂']], dayKey + n + '/偏执狂', 1, row['偏执狂'], n);
      for (const r of [
        '主谋',
        '深潜者',
        ...(this.ex === undefined || this.ex >= 2 ? ['无面者'] : []),
        ...(o.day % 3 === 0 ? ['怪杰'] : []),
      ]) {
        if (row[r]) {
          const requirements = [row[r]!, ...(this.causal.has(n) ? [-m.plots['因果之绊']!] : [])];
          if (r === '无面者' && this.ex === undefined) {
            this.pending(o, '无面者取得能力时的 EX 未绑定');
            requirements.push(g.atom(why + ' EX 至少为 2'));
          }
          const remote = this.territoryRequirement(n, area);
          if (remote) requirements.push(remote);
          use(n + ' · ' + r, requirements, dayKey + n + '/密谋', 1, row[r], n);
        }
      }
    }
    const rumor = m.plots['流言四起'],
      x = m.plots['X异因子'],
      monsters = m.plots['怪物们的阴谋'];
    if (rumor && !target) use('流言四起', [rumor], loopKey + '流言四起', 1);
    if (x && !target) use('X异因子', [x, gate.any(factor)], loopKey + 'X异因子', 1);
    let monsterSource;
    if (monsters && !target) {
      monsterSource = use(
        '怪物们的阴谋',
        [monsters, gate.any(ignored)],
        loopKey + '怪物们的阴谋',
        2,
      );
      if (monsterSource) {
        const key = dayKey + '怪物们的阴谋';
        const days = this.uses.get(key) ?? [];
        days.push(monsterSource);
        this.uses.set(key, days);
        g.add('怪物们的阴谋每日一次', days.slice(), 0, 1);
      }
    }
    g.add(
      why + ' · 本次使用的来源',
      alternatives.map((a) => a.use),
      1,
      1,
    );
    const bypass = gate.any(alternatives.filter((a) => !a.role).map((a) => a.use));
    const roles = [...new Set(alternatives.flatMap((a) => (a.role ? [a.role] : [])))];
    if (bypass !== true && roles.length)
      g.add(
        why + ' · 限定角色身份来源',
        roles,
        1,
        roles.length,
        typeof bypass === 'number' ? -bypass : undefined,
        true,
      );
    g.resolveCauses(
      why,
      alternatives.map((a) => a.use),
    );
    if (monsterSource && alternatives.length === 1 && !ignored.includes(true)) {
      const candidates = [
        ...new Set(ignored.filter((lit): lit is number => typeof lit === 'number')),
      ];
      g.resolveCauses(why + ' · 怪物们的阴谋必须在有无视友好身份的区域', candidates);
    }
    this.revisitAbilityRoles(why, localActors);
    if (!target && (this.uses.get(loopKey + '流言四起')?.length ?? 0) > 1)
      m.projectQuotas(why + ' · 同轮版图密谋复核规则组合与身份名额', true);
  }
  append(
    history: readonly Observation[],
    roster: readonly Pick<PublicCharacter, 'id' | 'character'>[] = [],
    maxGroups = Infinity,
  ) {
    const m = this.model,
      g = m.graph;
    g.work = newWork();
    g.touched.clear();
    if (this.conflict) return;
    for (const c of roster) m.names.set(c.id, c.character);
    for (const o of history) if (o.sequence > this.through) this.buffered.set(o.sequence, o);
    const suffix: Observation[] = [];
    for (let seq = this.through + 1; this.buffered.has(seq); seq++)
      suffix.push(this.buffered.get(seq)!);
    this.budgetStopped = false;
    let groups: Observation[][];
    try {
      groups = completeObservationGroups(suffix, false);
    } catch (error) {
      this.partial = true;
      this.unresolved.add('#' + (this.through + 1) + ' 公告批次无效 · ' + String(error));
      return;
    }
    this.partial = false;
    for (const group of groups) {
      if (maxGroups-- <= 0) {
        this.budgetStopped = true;
        break;
      }
      const first = group[0]!;
      if (first.sequence !== this.through + 1) {
        this.partial = true;
        break;
      }
      if (this.opening.module === 'BTX' || this.opening.module === 'HSA')
        this.partners.observe(
          m,
          this.board,
          group,
          this.causal,
          !this.failedEarlier && first.day === this.opening.days,
        );
      this.treeTransfer.clear();
      if (first.phase === 'mastermind-abilities' && this.board.get('御神木')?.status === 'alive') {
        for (const r of group)
          if (
            r.type === 'character' &&
            m.names.get(String(r.data.character)) === '御神木' &&
            r.data.counters
          ) {
            const before = this.board.get('御神木')!.counters,
              after = r.data.counters as Counters;
            for (const key of ['paranoia', 'intrigue'] as const)
              if (after[key] === before[key] - 1) this.treeTransfer.add(key);
          }
      }
      if (
        this.opening.module === 'HSA' &&
        first.phase === 'day-end' &&
        this.window?.phase === 'day-end' &&
        matchZombieMove(m, this.board, this.boardIntrigue, group, this.causal)
      ) {
        const day = first.loop + '/' + first.day;
        if (this.zombieMoveDay === day)
          this.assert('#' + first.sequence + ' · 所有丧尸的日末移尸合计每日一次');
        this.zombieMoveDay = day;
        if (this.stableEnd && !this.curses.pendingDeath)
          unchangedZombieWindow(
            m,
            this.board,
            this.boardIntrigue,
            '#' + first.sequence + ' · 移尸前的强制丧尸攻击',
            this.causal,
            this.extraProtection,
          );
        this.settledDeathGroup = true;
      }
      this.matchedDeathGroup =
        (this.basic ||
          ['MZ', 'LL', 'WM', 'MC'].includes(this.opening.module) ||
          (this.opening.module === 'HSA' && !this.curses.pendingDeath)) &&
        this.window?.phase === 'day-end' &&
        first.phase === 'day-end' &&
        first.simultaneousSize !== undefined &&
        matchDayEndGroup(
          m,
          this.board,
          group,
          !this.settledDeathGroup,
          this.causal,
          this.extraProtection,
          this.endUses,
          new Map([
            ['大人物', this.territory ?? this.opening.territory],
            ...(this.streamerTarget
              ? [['UP主', this.board.get(this.streamerTarget)?.area] as const]
              : []),
          ]),
          this.opening.module === 'HSA' ? this.boardIntrigue : undefined,
          this.opening.module === 'MC' ? this.poison.current : undefined,
        );
      if (this.matchedDeathGroup) this.settledDeathGroup = true;
      for (const o of group) this.consume(o);
      if (this.outcome && first.phase === 'incident' && first.simultaneousSize !== undefined)
        matchIncidentPublication(
          m,
          this.outcome,
          first.sequence,
          this.opening.module,
          this.causal,
          this.extraProtection,
        );
      if (
        group.some(
          (o) => o.phase === 'day-end' && ['failure', 'character', 'board'].includes(o.type),
        )
      )
        this.stableEnd = false;
      const deaths = group.filter(
        (o) =>
          o.type === 'character' &&
          o.data.status === 'dead' &&
          this.board.get(m.names.get(String(o.data.character)) ?? '')?.status === 'alive' &&
          ['protagonist-abilities', 'incident', 'day-end'].includes(o.phase),
      );
      // All evidence in a simultaneous group reads the same pre-settlement pieces.
      for (const o of group) {
        const d = o.data,
          name = m.names.get(String(d.character));
        if (o.type === 'character' && name && d.area && d.status && d.counters) {
          const before = this.board.get(name);
          if (
            this.opening.module === 'MC' &&
            before?.status === 'alive' &&
            d.status === 'alive' &&
            before.area !== d.area &&
            [
              'card-resolution',
              'protagonist-abilities',
              'mastermind-abilities',
              'incident',
              'day-end',
            ].includes(o.phase)
          ) {
            const lock = this.lockdown,
              hold = this.letterHolds.get(name);
            if (
              lock?.loop === o.loop &&
              o.day >= lock.day &&
              o.day < lock.day + 3 &&
              [before.area, d.area].includes(lock.area)
            )
              this.assert('#' + o.sequence + ' · 角色在' + lock.reason + '封锁期间进出了指定版图');
            if (hold?.loop === o.loop && hold.day === o.day)
              this.assert('#' + o.sequence + ' · ' + hold.reason + '移动的角色次日不能移动');
          }
          this.putPiece(name, d as unknown as Piece);
          if (d.status !== 'absent') this.seen.add(name);
        }
        if (o.type === 'board' && typeof d.board === 'string' && typeof d.intrigue === 'number')
          this.boardIntrigue[d.board] = d.intrigue;
      }
      for (const source of deaths) {
        const n = m.names.get(String(source.data.character))!,
          p = this.board.get(n)!;
        const why = '#' + source.sequence + ' · ' + n + ' 死亡时的失败能力',
          gate = gates(g, why);
        const role = (r: string) => effectiveRole(m, n, r, p, this.causal, why);
        const key = role('关键人物');
        if (key === undefined) {
          this.pending(source, '死亡角色的结算身份未绑定');
          continue;
        }
        const causes = [key];
        const factor = role('不安定因子');
        if (factor) {
          const city = this.boardIntrigue.city ?? 0,
            seal = m.plots['封印的终末'];
          let threshold: number | boolean = city >= 2;
          if (seal) {
            let modified = city;
            for (const c of this.board.values())
              if (c.status === 'alive' && c.area === 'city')
                modified += c.counters.despair - c.counters.hope;
            if (modified >= 2 !== threshold) threshold = modified >= 2 ? seal : -seal;
          }
          causes.push(gate.all([factor, threshold]));
        }
        const whisper = m.plots['深渊之都的私语'];
        if (whisper) causes.push(gate.all([whisper, role('偏执狂') ?? false]));
        this.deathTriggers.push({ source, fatal: gate.any(causes) });
      }
      if (first.phase === 'protagonist-abilities' && first.simultaneousSize !== undefined)
        for (const action of this.declarations)
          this.settleActiveAttack(action, '#' + first.sequence, false);
      if (
        first.phase === 'day-end' &&
        this.opening.module === 'HSA' &&
        this.curses.settle(m, this.board, first.sequence, this.causal, this.extraProtection)
      )
        this.stableEnd = true;
      if (
        this.opening.module === 'LL' &&
        (first.phase === 'protagonist-abilities' || first.phase === 'day-end')
      )
        this.llVictory.observe(
          m,
          this.board,
          first,
          this.markers.died.size,
          this.markers.communicated.size,
        );
      if (this.rosterChanged) {
        m.projectQuotas('#' + first.sequence + ' · 登场窗口与剩余角色名额');
        this.rosterChanged = false;
      }
      g.propagate();
      for (const o of group) this.buffered.delete(o.sequence);
      this.through = group.at(-1)!.sequence;
      if (g.conflict !== undefined) {
        this.conflict =
          '#' + first.sequence + ' ' + first.phase + ' · ' + g.rules[g.conflict]!.reason;
        break;
      }
    }
    if (!this.conflict && this.buffered.size) this.partial = true;
  }
  get failureSources() {
    if (this.opening.module !== 'WM') return [];
    const m = this.model,
      replaced = m.graph.truth(m.plots['疯狂的真相']!);
    return Object.keys(m.primary).filter(
      (y) =>
        ((this.exAtLoopStart === undefined || this.exAtLoopStart < 2 || replaced !== true) &&
          m.graph.truth(m.primary[y]!) !== false) ||
        ((this.exAtLoopStart === undefined || this.exAtLoopStart >= 2) &&
          replaced !== false &&
          m.graph.truth(m.alt[y]!) !== false),
    );
  }
}
