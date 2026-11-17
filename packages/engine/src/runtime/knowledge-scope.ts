import { incidentStepProjection } from './knowledge-incident-settlement.js';
import { projectIncidentDeaths } from './knowledge-death-settlement.js';
import { projectDayEnd } from './knowledge-mandatory-settlement.js';
import { routesObservation } from './knowledge-routes.js';
import { lifecycle, characterCounter } from './shared-lifecycle.js';
import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import type { KnowledgeView } from '../../../contracts/src/knowledge.js';
import { partnerPairs } from './knowledge-traits.js';
import { BOARDS, COUNTERS, type RulePack } from './model.js';
import { roleImmortal, roleRefusal, boardVictims, goodwillCounter, incidentExGain, incidentThresholdMet } from './expressions.js';
import { baseIdentity, possibleForms, shownIdentity, type Profile } from './knowledge-domain.js';
import { relation } from './knowledge-constraints.js';

import { PairExecution, type PairMode } from './knowledge-pair.js';
import { groupVictims, quietTargets } from './knowledge-quiet.js';
import { hasVirtualArea, traits, intrinsicCauses } from './knowledge-traits.js';
import { CardReports } from './knowledge-cards.js';
import { firstGoodwillReports, matchesGoodwillReport } from './knowledge-goodwill.js';
import { cardBypassRoles, goodwillMovePlot, mastermindCardImmune, multipleBlocksApply } from './card-settlement.js';
import { PruningCatalog, eligibleSource, indexOwners, requiresGoodwillDeclaration } from './knowledge-pruning.js';
import { directDeathEffect, type EffectSource, type VisibleChange } from './knowledge-effects.js';
import { publicCondition, publicNumber, type PublicContext } from './knowledge-conditions.js';
import { CauseNetwork, counterCauses, type Cause, type CauseRecord } from './knowledge-causes.js';
type Scope = NonNullable<KnowledgeView['scope']>;
interface PairTracker {
  name: string;
  reports: number;
  ordinaryOnly: boolean;
  executions: Map<PairMode, PairExecution>;
}
interface FieldBatch {
  records: Map<Profile, CauseRecord[]>;
  projections: (() => void)[];
}

function bindChoices(
  source: EffectSource,
  change: VisibleChange,
  window: (string | number)[],
): Cause['choices'] {
  const key = (name: string) => JSON.stringify([...window, name]);
  const choices: NonNullable<Cause['choices']> = [];
  if (source.selection) {
    for (const name of [source.selection.key, ...source.selection.equal])
      choices.push({ key: key(name), value: change.target });
    for (const name of source.selection.different)
      choices.push({ key: key(name), value: change.target, different: true });
  }
  if (source.counterSelection && change.counter)
    choices.push({ key: key(source.counterSelection), value: change.counter });
  return choices.length ? choices : undefined;
}
/** Only public snapshots are retained. No scan of the accumulated history on append. */
export class CausalScope {
  private characters: Map<string, PlayerView['characters'][number]>;
  private boards: PlayerView['boards'];
  private roster: { id: string; character: string }[];
  private readonly catalog: PruningCatalog;
  // These packs have additional engine lifecycle sources outside ordinary ability steps.
  private readonly extended: boolean;
  private networks = new Map<string, CauseNetwork>();
  private simultaneous?: FieldBatch;
  beginSimultaneous() {
    this.simultaneous = { records: new Map(), projections: [] };
  }
  finishSimultaneous() {
    const batch = this.simultaneous;
    if (!batch) return;
    this.simultaneous = undefined;
    for (const [p,records] of batch.records)
      if (p.active) this.network(p).addMany(p,records);
    for (const project of batch.projections) project();
  }
  private addCauses(p: Profile, records: CauseRecord[]) {
    if (!this.simultaneous) return this.network(p).addMany(p,records);
    const pending = this.simultaneous.records.get(p) ?? [];
    pending.push(...records);
    this.simultaneous.records.set(p,pending);
  }
  private relationFacts = new Map<
    string | number,
    {
      observation: number;
      loop: number;
      day: number;
      phase: string;
      target: string;
      description?: string;
    }
  >();
  // At discussion entry the engine still exposes the previous loop's final
  // counters. Reset publications follow, before the loop-start boundary.
  private lastBoundary?: Pick<Observation, 'loop' | 'day' | 'phase'>;
  private declared?: {
    sequence: number;
    id: string;
    ability: string;
    phase: Observation['phase'];
    choices: Record<string, string>;
    independent: boolean;
    primary?: Map<string, VisibleChange[]>;
    primarySequence?: number;
    singleStep?: boolean;
    checkKillResolution?: boolean;
    useKeys?: readonly string[];
  };
  private nestedDeclaration = false;
  private completedGoodwill = new Map<string, number>();
  private directRequest?: { id: string; ability: string };
  private readonly hasIncidentAreaIdentity: boolean;
  private readonly cardReports: CardReports;
  private initialAreas: Map<string, string>;
  private resetTargets = new Set<string>();
  private quietDayEnd = false;
  private deathsInWindow = new Set<string>();
  readonly impliedIdentities: NonNullable<KnowledgeView['impliedIdentities']> = {};
  private cityQualifiedAtDeath = new Set<string>();
  private endEntry?: Pick<PublicContext, 'boards' | 'characters'>;
  private movedInWindow = new Set<string>();
  private readonly eventSchedule: PlayerView['incidents'];
  private readonly scheduledDays: Set<number>;
  private occurrence = new Map<string, boolean>();
  private pairWindow?: {
    loop: number;
    day: number;
    reports: number;
    modes: Map<string, PairExecution>;
    hasReport: boolean;
    settledQuietly?: boolean;
    completedFrame?: boolean;
    paranoiaRise: Set<string>;
    arrivals: Set<string>;
    group?: { remaining: Set<string>; changed: boolean; uncertain: boolean };
  };
  private pairResults = new WeakMap<PairExecution, { sequence: number; possible: boolean }>();
  private pairStates = new Map<Profile, PairTracker>();
  private pairBranches = 0;
  private counterWork = { branches: 0 };
  private fixedIncidentReports = new Map<string, number>();
  private priorFriends = new Set<string>();
  private window?: { loop: number; next: number; missing: Set<string>; cats: Set<string> };
  private publicRelations: NonNullable<KnowledgeView['relations']> = [];
  private days: number;
  private loops: number;
  private publicEx: number;
  get ex() { return this.publicEx; }
  private mcGain?: { sequence: number; day: number; loop: number; before: number };
  private eventRelations = new Map<string, NonNullable<KnowledgeView['relations']>>();
  private incidentPairs = new Map<
    string,
    { day: number; pairs: { name: string; id: string; label: string; pending: string[] }[] }
  >();
  private knownProfiles = new Map<string, Profile>();
  version = 0;
  constructor(
    private pack: RulePack,
    private readonly opening: PlayerView,
  ) {
    const interrupt = (a: { mandatory?: boolean; timing: string }) => a.mandatory && a.timing === 'incident';
    this.hasIncidentInterrupt = pack.moduleAbilities.some(({ability}) => interrupt(ability)) ||
      Object.values(pack.identities).some(def => def.abilities.some(interrupt)) ||
      [...(opening.roster ?? opening.characters), ...opening.characters].some(c =>
        pack.characters[c.character]?.abilities.some(interrupt) ||
        (c.character === '临时工' && pack.characters['临时工？']?.abilities.some(interrupt)));
    this.interruptPlots = new Set(Object.values(pack.plots).filter(def => def.abilities.some(interrupt)).map(def => def.name));
    this.extended = !['FS', 'BTX'].includes(pack.module);
    this.hasIncidentAreaIdentity = Object.values(pack.identities).some(
      (identity) => identity.baseIncidentArea && identity.baseIncidentArea !== 'actual',
    );
    this.days = opening.days;
    this.loops = opening.loops;
    this.publicEx = opening.ex ?? 0;
    this.characters = new Map(opening.characters.map((c) => [c.id, structuredClone(c)]));
    this.boards = { ...opening.boards };
    this.cardReports = new CardReports(this.characters, this.boards, pack);
    this.initialAreas = new Map(opening.characters.map((c) => [c.id, c.area]));
    this.eventSchedule = opening.incidents;
    this.scheduledDays = new Set(opening.incidents.map((i) => i.day));
    this.roster = [...(opening.roster ?? opening.characters)];
    // setup creates a replacement outside the initial identity and culprit tables.
    const temporary = this.roster.find((c) => c.character === '临时工');
    if (temporary && !this.roster.some((c) => c.character === '临时工？'))
      this.roster.push({ id: temporary.id + '_replacement', character: '临时工？' });
    this.catalog = new PruningCatalog(pack, opening, this.roster);
  }
  private summary(o: Observation, kind: Scope['kind']): Scope {
    return {
      kind,
      observation: o.sequence,
      phase: o.phase,
      target: String(o.data.board ?? o.data.day ?? ''),
      characters: [],
      rules: [],
      events: [],
      skippedCharacters: [],
      skippedRules: [],
      skippedEvents: [],
      conservative: [],
      deferred: false,
    };
  }
  private context(
    o: Observation,
    source: EffectSource,
    owner?: string,
    target = String(o.data.board ?? o.data.character),
  ): PublicContext {
    const character = this.roster.find((c) => c.id === owner)?.character;
    const declaration =
      o.phase === 'protagonist-abilities' &&
      this.declared?.id === owner &&
      this.declared?.ability === source.ability?.id &&
      requiresGoodwillDeclaration(source)
        ? this.declared
        : undefined;
    return {
      clock: o,
      declaredGoodwill: !!declaration,
      ex: this.publicEx,
      occurred: (name) => {
        if (this.pack.incidents[lifecycle.incident.disguised] || source.detached) return;
        const slots = this.eventSchedule.filter((e) => e.name === name && e.day <= o.day);
        const flags = slots.map((e) => this.occurrence.get(o.loop + ':' + e.day));
        if (flags.includes(true)) return true;
        if (flags.every((v) => v === false)) return false;
      },
      days: this.days,
      loops: this.loops,
      pack: this.pack,
      characters: this.characters,
      boards: this.boards,
      owner,
      target,
      bindings:
        !source.detached && source.target?.startsWith('$') && !source.target.includes('.')
          ? { ...(source.entryStep && declaration?.choices), [source.target.slice(1)]: target }
          : (source.entryStep && declaration?.choices) || {},
      staticOnly: source.detached || !source.safeSnapshot,
      moved: source.detached || !this.lastBoundary ? undefined : this.movedInWindow,
      virtualArea:
        hasVirtualArea(this.pack, character) ||
        (this.hasIncidentAreaIdentity && o.phase === 'incident') ||
        source.choices.has('areaMode'),
    };
  }
  private eligible(
    source: EffectSource,
    o: Observation,
    change: VisibleChange,
    owner?: string,
    eventDay?: number,
  ) {
    return eligibleSource(
      source,
      change,
      this.context(o, source, owner, change.target),
      {
        phase: this.lastBoundary?.phase,
        deaths: this.deathsInWindow,
        endEntry: this.endEntry,
        occurrence: this.occurrence,
      },
      eventDay,
    );
  }
  private resources(source: EffectSource, o: Observation, owner: string): Cause['resources'] {
    const a = source.ability;
    if (!a || source.detached || source.timing === '*') return [];
    const reports = Math.max(1, source.reports),
      base = a.sharedKey ?? `${owner}:${a.id}`;
    const ownerName = owner.startsWith('plot:')
      ? owner.slice(5)
      : (this.roster.find((c) => c.id === owner)?.character ?? owner);
    const abilityName =
      ({ brain: '主谋能力', 'rumor-intrigue': '区域密谋能力' } as Record<string, string>)[a.id] ??
      '相关能力';
    const label = `${ownerName}·${abilityName}${a.sharedKey ? '（共享使用次数）' : ''}`;
    const reportLimit = (n: number) =>
      Number.isFinite(n) ? '最多解释 ' + n + ' 条公开变化' : '可解释多个对象的变化';
    const activation = JSON.stringify([o.day, o.phase, owner, a.id]);
    return [
      ...(a.mandatory && Number.isFinite(reports) && ['day-end', 'loop-end'].includes(a.timing)
        ? [
            {
              key: JSON.stringify(['mandatory', o.loop, o.day, o.phase, owner, a.id]),
              limit: reports,
              label: label + '：本次强制结算最多产生 ' + reports + ' 项变化',
            },
          ]
        : []),
      ...(!a.mandatory
        ? [
            {
              key: `phase:${o.loop}:${o.day}:${o.phase}:mastermind:${base}`,
              limit: reports,
              activation: { window: activation, limit: 1 },
              label: `${label}：第 ${o.loop} 轮第 ${o.day} 日本阶段至多 1 次（${reportLimit(reports)}）`,
            },
          ]
        : []),
      ...(a.loopLimit !== undefined
        ? [
            {
              key: `loop:${o.loop}:${base}`,
              limit: a.mandatory && a.sharedKey ? Infinity : a.loopLimit * reports,
              activation: { window: o.day + '/' + o.phase, limit: a.loopLimit },
              label: `${label}：第 ${o.loop} 轮至多 ${a.loopLimit} 次（${reportLimit(a.loopLimit * reports)}）`,
            },
          ]
        : []),
    ];
  }
  private network(p: Profile) {
    this.knownProfiles.set(p.id, p);
    let network = this.networks.get(p.id);
    if (!network) {
      const ordinary = new Set(
        this.roster
          .filter((c) => !['局外人', '模仿犯', '临时工', '临时工？'].includes(c.character))
          .map((c) => `identity:${c.id}`),
      );
      network = new CauseNetwork(new Map(Object.entries(p.identityCounts)), ordinary);
      this.networks.set(p.id, network);
    }
    return network;
  }
  private hasIncidentInterrupt: boolean;
  private interruptPlots: Set<string>;
  get causeJoins() {
    let count = 0;
    for (const network of this.networks.values()) count += network.joins;
    return count;
  }
  get causeBudgetLimited() {
    return [...this.networks.values()].some(network => network.uncertain);
  }
  private nextIncidentStep?: { loop: number; day: number };
  private dayEndEntry?: Observation;
  /** Called once per complete announcement, after single-rule filtering, before board writes. */
  finishSettlement(reports: Observation[], profiles: Profile[], remaining: { branches: number }, compound: boolean) {
    const first = reports[0]!;
    const previous = this.dayEndEntry;
    if (first.type !== 'own-choice') this.dayEndEntry =
      first.type === 'boundary' && first.phase === 'day-end' ? first : undefined;
    if (previous && previous.day === first.day && previous.loop === first.loop &&
        first.phase === 'day-end' && first.simultaneousSize !== undefined && compound) {
      const context: PublicContext = { clock: first, pack: this.pack, characters: this.characters,
        boards: this.boards, days: this.days, loops: this.loops, ex:this.publicEx };
      let matched = false, open = false;
      const participants = new Set<string>();
      for (const p of profiles) {
        if (!p.active) continue;
        if (remaining.branches <= 0) { open = true; break; }
        const result = projectDayEnd(context,this.opening,reports,p,remaining);
        if (!result) { open = true; continue; }
        matched = true;
        open ||= result.open;
        for (const id of result.participants) participants.add(id);
      }
      if (matched) { this.version++; return { participants, open }; }
    }
    if (first.type === 'incident') {
      this.nextIncidentStep = first.data.occurred === true ? { loop: first.loop, day: first.day } : undefined;
      return;
    }
    const entry = this.nextIncidentStep;
    if (!entry) return;
    if (first.phase === 'incident' && first.loop === entry.loop && first.day === entry.day) {
      if (first.type === 'own-choice' ||
          (this.pack.module === 'MC' && first.type === 'board' && typeof first.data.ex === 'number' &&
           first.simultaneousSize === undefined)) return;
      this.nextIncidentStep = undefined;
      if (first.simultaneousSize === undefined || this.hasIncidentInterrupt) return;
      const context: PublicContext = { clock: first, pack: this.pack, characters: this.characters,
        boards: this.boards, days: this.days, loops: this.loops, ex: this.publicEx };
      const publicStep = incidentStepProjection(context, this.opening, reports, remaining);
      const participants = new Set<string>();
      let matched = false, open = false;
      for (const p of profiles) {
        if (!p.active) continue;
        if ([p.y, ...p.x].some(name => this.interruptPlots.has(name))) { open = true; continue; }
        if (remaining.branches <= 0) { open = true; break; }
        const result = projectIncidentDeaths(context, reports, p, remaining);
        const direct = p.active && compound ? publicStep(p) : undefined;
        if (!result && !direct) { open = true; continue; }
        matched = true;
        open ||= result?.open !== false && direct?.open !== false;
        for (const id of result?.participants ?? []) participants.add(id);
        for (const id of direct?.participants ?? []) participants.add(id);
      }
      if (matched) {
        this.version++;
        return { participants, open };
      }
    } else this.nextIncidentStep = undefined;
  }
  get causeBranches() {
    let branches = this.pairBranches + this.counterWork.branches;
    for (const network of this.networks.values()) branches += network.checks;
    return branches;
  }
  relations(profiles: Profile[]): NonNullable<KnowledgeView['relations']> {
    const areas: Record<string, string> = {
      school: '学校',
      hospital: '医院',
      city: '都市',
      shrine: '神社',
    };
    const result: NonNullable<KnowledgeView['relations']> = [];
    const initialCases = profiles.map((p) => {
      return {
        when: [[p.y, ...p.x].join(' ＋ ')],
        alternatives: ['同时满足本组合的全部联合条件'],
        limits: [
          `常规角色初始身份名额：${Object.entries(p.identityCounts)
            .filter(([, n]) => n > 0)
            .map(([r, n]) => `${r} × ${n}`)
            .join('、')}。局外人、模仿犯不占用这些名额。`,
          ...(this.roster.some((c) => c.character === '模仿犯')
            ? ['模仿犯的初始身份须与其复制对象相同；因果残片按平民身份参与此关系。']
            : []),
          ...(this.roster.some((c) => c.character === '局外人')
            ? ['局外人身份必须不在所选规则的身份池中。']
            : []),
          ...(this.pack.anniversary
            ? [
                '周年设定有平民时须指定一名因果残片；其基础身份按平民计算，仍须满足身份名额和复制关系。',
              ]
            : []),
          '同一角色重复担任普通事件当事人时，两次真实事件均须允许复用；区域当事人与真实事件类型必须匹配。',
        ],
        notes: [] as string[],
      };
    });
    if (initialCases.length)
      result.push({
        id: 'initial-relations',
        observation: 0,
        fact: '开局联合条件：规则组合决定身份名额，事件和特殊身份仍有跨表限制。',
        implications: [],
        cases: initialCases,
      });
    for (const [factKey, fact] of this.relationFacts) {
      const grouped = new Map<
        string,
        { when: string[]; alternatives: string[]; limits: string[]; notes: string[] }
      >();
      const all: Cause[] = [];
      for (const p of profiles.length ? profiles : this.knownProfiles.values()) {
        const network = this.networks.get(p.id);
        const record = network?.byObservation.get(factKey);
        if (!record) continue;
        const possible = profiles.length
          ? record.alternatives.filter(
              (a) =>
                !network!.excludedCauses.has(a) &&
                a.requires.every((g) => p.store.values(g.key).has(g.value)),
            )
          : record.alternatives;
        all.push(...possible);
        const row = {
          when: [] as string[],
          alternatives: [...new Set(possible.map((a) => a.label))],
          limits: [...new Set(possible.flatMap((a) => a.resources.map((r) => r.label)))],
          notes: [
            ...new Set([
              ...possible.flatMap((a) => a.notes),
              ...(network?.uncertain ? ['关联约束检查达到预算，未知解释保留。'] : []),
              ...(!profiles.length ? ['该组合已排除；此处保留形成矛盾的原因与限制。'] : []),
            ]),
          ],
        };
        const key = JSON.stringify(row),
          existing = grouped.get(key) ?? row;
        existing.when.push([p.y, ...p.x].join(' ＋ '));
        grouped.set(key, existing);
      }
      const implications: string[] = [];
      const rules = [...new Set(all.flatMap((a) => (a.rule ? [a.rule] : [])))];
      const others = all.filter((a) => !a.rule);
      if (profiles.length && rules.length === 1 && !others.length)
        implications.push(`所有相容解释都要求剧本含有“${rules[0]}”。`);
      if (rules.length && others.length && others.every((a) => a.requires.length > 0))
        implications.push(
          `若不包含${rules.map((r) => `“${r}”`).join('、')}中的任何规则，则至少满足：${[...new Set(others.map((a) => a.label))].join(' 或 ')}。`,
        );
      result.push({
        id: `cause:${factKey}`,
        observation: fact.observation,
        fact: `第 ${fact.loop} 轮第 ${fact.day} 日：${fact.description ?? (areas[fact.target] ?? fact.target) + '密谋增加'}，以下原因至少成立一项。`,
        implications,
        cases: [...grouped.values()].map((c) => ({ ...c, when: [...new Set(c.when)] })),
      });
    }
    for (const p of profiles)
      for (const entry of this.eventRelations.get(p.id) ?? []) {
        const existing = result.find((r) => r.id === entry.id);
        const projected = structuredClone(entry);
        const info = this.incidentPairs.get(p.id + ':' + entry.observation)!;
        const survivingPairs = info.pairs.filter(
          (pair) =>
            p.store.values('event:' + info.day).has(pair.name) &&
            p.store.values('culprit:' + info.day).has(pair.id),
        );
        projected.cases[0]!.alternatives = survivingPairs.map((pair) => pair.label);
        projected.cases[0]!.notes.push(...new Set(survivingPairs.flatMap((pair) => pair.pending)));
        if (existing) existing.cases.push(...projected.cases);
        else result.push(projected);
      }
    for (const entry of result) {
      const cases = new Map<string, (typeof entry.cases)[number]>();
      for (const row of entry.cases) {
        const key = JSON.stringify({ ...row, when: [] }),
          prior = cases.get(key);
        if (prior) prior.when = [...new Set([...prior.when, ...row.when])];
        else cases.set(key, row);
      }
      entry.cases = [...cases.values()];
    }
    result.push(...structuredClone(this.publicRelations));
    return result.sort((a, b) => a.observation - b.observation);
  }
  /** Necessary cause clause, NOT an assertion that a complete hidden history exists. */
  private pairModes(id: string): PairMode[] | undefined {
    const actor = this.roster.find((c) => c.id === id)?.character;
    if (!actor) return;
    if (traits(this.pack, actor).execution === 'cancel') return [];
    if (traits(this.pack, actor).execution === 'repeat') return ['repeated'];
    if (traits(this.pack, actor).execution === 'proxy') {
      const proxies = [...this.characters.values()].filter(
        (c) => c.character === '临时工？' && c.status === 'alive',
      );
      if (proxies.length > 1) return;
      if (proxies.length && this.characters.get(id)?.status === 'alive')
        return ['ordinary', 'parallel'];
    }
    return ['ordinary'];
  }
  private startPair(name: string, ids: string[]) {
    const modes = this.pairWindow!.modes;
    const executions = new Map<PairMode, PairExecution>();
    const options = ids.map((id) => this.pairModes(id));
    const ordinaryOnly = options.every((m) => m?.length === 1 && m[0] === 'ordinary');
    for (const mode of new Set(options.flatMap((m) => m ?? []))) {
      const key = JSON.stringify([name, mode]);
      let execution = modes.get(key);
      if (!execution) {
        execution = new PairExecution(this.catalog.pairPrograms.get(name)!, mode);
        modes.set(key, execution);
      }
      executions.set(mode, execution);
    }
    return { name, reports: 0, ordinaryOnly, executions };
  }
  private pairCulprits(
    tracker: PairTracker,
    ids: string[],
    scope: { needsHistory?: boolean },
    sequence: number,
    change?: VisibleChange,
  ) {
    const valid = new Set<PairMode>();
    for (const [mode, execution] of tracker.executions) {
      let result = this.pairResults.get(execution);
      if (result?.sequence !== sequence) {
        const before = execution.branches;
        result = { sequence, possible: execution.advance(this.characters, change) };
        this.pairResults.set(execution, result);
        this.pairBranches += execution.branches - before;
      }
      if (result.possible) valid.add(mode);
      if (execution.uncertain) scope.needsHistory = true;
    }
    if (tracker.ordinaryOnly) return valid.has('ordinary') ? ids : [];
    return ids.filter((id) => {
      const modes = this.pairModes(id);
      if (!modes) {
        scope.needsHistory = true;
        return true;
      }
      return modes.some((mode) => valid.has(mode));
    });
  }
  private visibleEffect(
    o: Observation,
    profiles: Profile[],
    change: VisibleChange,
    description?: string,
    declared?: { id: string; ability: string },
    batch?: FieldBatch,
  ): Scope | undefined {
    const scope = this.summary(o, description ? 'visible-effect' : 'board-intrigue');
    const board = change.target;
    scope.target = board;
    const relevantRules = new Set<string>(),
      relevantCharacters = new Set<string>(),
      relevantEvents = new Set<string>();
    const allRules = new Set(profiles.flatMap((p) => [p.y, ...p.x]));
    const key = description
      ? [o.sequence, change.kind, change.counter].filter(Boolean).join('/')
      : o.sequence;
    const clauses = new Map<Profile, Cause[]>();
    const labels = new Set<string>();
    let checkedExclusion = false;
    const boardOnly = new Set<Profile>();

    // Eligibility reads this public observation, owner, and origin day. Rule
    // profiles change quotas and domains but never these public predicates.
    const matches = new Map<EffectSource, Map<string, boolean>>();
    const eligible = (source: EffectSource, owner?: string, day?: number) => {
      let byOwner = matches.get(source);
      if (!byOwner) matches.set(source, (byOwner = new Map()));
      const key = JSON.stringify([owner, day]);
      if (!byOwner.has(key)) byOwner.set(key, this.eligible(source, o, change, owner, day));
      return byOwner.get(key)!;
    };
    const cats = this.roster.filter((c) => this.pack.characters[c.character]?.loopShrineIntrigue);
    const victim = this.characters.get(change.target);
    const virtualVictim =
      this.hasIncidentAreaIdentity ||
      !!(victim && this.pack.characters[victim.character]?.incidentAreaFromBase);
    const indexed = this.catalog.forChange(
      o.phase,
      change,
      routesObservation('declaredEffect', o)
        ? this.declared?.singleStep && this.declared.primary?.size === 0
          ? null
          : (this.declared ?? null)
        : undefined,
    );
    if (this.extended) {
      // The indexed effects are candidates. An implicit lifecycle hook, borrowed ability
      // or changed identity can also produce this report; only replay proves exhaustiveness.
      const roles = [...indexed.identities].filter(([, sources]) => sources.some(s => eligible(s))).map(([name]) => name);
      scope.characters = [...indexed.cards].filter(([id, sources]) => sources.some(s => eligible(s, id))).map(([id]) => id);
      scope.rules = [...indexed.rules].filter(([name, sources]) =>
        sources.some(s => eligible(s) && (allRules.has(name) || (s.ability?.id === 'loss' &&
          profiles.some(p => p.store.domains.get('alternateY')?.has(name)))))).map(([name]) => name);
      scope.events = [...indexed.events].filter(([name,sources]) => sources.some(s =>
        this.eventSchedule.some(day => (s.detached || day.day === o.day) &&
          (day.name === name || name === lifecycle.incident.disguised) && eligible(s,undefined,day.day)))).map(([name])=>name);
      scope.alternatives = [...roles, ...indexed.modules.keys(), ...scope.rules, ...scope.characters, ...scope.events];
      scope.needsHistory = true;
      scope.conservative.push('已按时点和效果筛选来源；另核对模组触发、当前身份和隐藏选择。');
      return scope;
    }
    const owners = indexOwners(
      this.roster,
      this.characters,
      change,
      this.hasIncidentAreaIdentity && o.phase === 'incident',
      this.pack,
    );
    const roleSources = new Map<string, Map<string, EffectSource[]>>();
    for (const [identity, sources] of indexed.identities) {
      for (const source of sources) {
        for (const c of owners(source)) {
          if (!eligible(source, c.id)) continue;
          let roles = roleSources.get(c.id);
          if (!roles) roleSources.set(c.id, (roles = new Map()));
          const list = roles.get(identity);
          if (list) list.push(source);
          else roles.set(identity, [source]);
        }
      }
    }
    const cardSources = new Map<string, EffectSource[]>();
    for (const [id, sources] of indexed.cards) {
      const valid = sources.filter((s) => {
        if (
          this.declared?.primary?.size === 0 &&
          s.entryStep &&
          requiresGoodwillDeclaration(s) &&
          this.declared.id === id &&
          this.declared.ability === s.ability?.id
        )
          return false;
        if (
          o.phase === 'protagonist-abilities' &&
          this.declared &&
          !this.declared.independent &&
          this.declared.id === id &&
          this.declared.ability === s.ability?.id
        ) {
          scope.needsHistory = true;
        }
        return eligible(s, id);
      });
      if (valid.length) cardSources.set(id, valid);
    }
    // The public base card can act through a replacement with a different
    // location/identity. A board report cannot bind its current owner.
    const participating = this.roster.filter(
      (c) =>
        roleSources.has(c.id) ||
        cardSources.has(c.id) ||
        (!description &&
          indexed.identities.size > 0 &&
          ['临时工', '临时工？'].includes(c.character)),
    );
    const ruleSources = new Map(
      [...indexed.rules]
        .filter(([id]) => allRules.has(id))
        .map(([id, ss]) => [id, ss.filter((s) => eligible(s))]),
    );
    for (const p of profiles) {
      if (!p.active) continue;
      const alternatives: Cause[] = [];
      const pairCauses = new Map<Cause, string>();
      const guardCauses = new Set<Cause>();
      let unboundRepeat = false;
      let fixedReport: string | undefined;
      let fixedAlternatives = 0;
      const add = (
        source: EffectSource,
        category: Cause['category'],
        label: string,
        owner: string,
        requires: Cause['requires'] = [],
        rule?: string,
      ) =>
        alternatives.push({
          category,
          label,
          owner,
          ability: source.ability?.id,
          rule,
          requires,
          resources: this.resources(source, o, owner),
          choices:
            source.ability && source.reports > 1 && !source.detached && source.timing === o.phase
              ? bindChoices(source, change, [
                  'ability-choice',
                  o.loop,
                  o.day,
                  o.phase,
                  owner,
                  source.ability.source,
                  source.ability.id,
                ])
              : undefined,
          maxContribution:
            source.ability?.mandatory &&
            source.timing === o.phase &&
            ['day-end', 'loop-end', 'mastermind-abilities'].includes(o.phase) &&
            !source.detached
              ? source.maxContribution
              : undefined,
          notes: source.detached
            ? [
                source.delay
                  ? `可能的延迟效果于第 ${o.loop} 轮第 ${o.day} 日 ${o.phase} 到期，发动时点为 ${source.delay.origin}。`
                  : directDeathEffect(source)
                    ? '该能力在角色死亡时触发。'
                    : '间接来源：保留先前发动条件。',
              ]
            : source.conditions.some(
                  (c) => publicCondition(c, this.context(o, source, owner)) === undefined,
                )
              ? ['部分条件未知，保留可能解释。']
              : [],
        });
      for (const rule of [p.y, ...p.x])
        for (const source of ruleSources.get(rule) ?? []) {
          relevantRules.add(rule);
          add(
            source,
            'rule',
            `规则“${rule}”的${source.detached ? '延迟或间接' : description ? (source.ability?.id ?? '直接') : '区域密谋'}效果`,
            `plot:${rule}`,
            [],
            rule,
          );
        }
      for (const c of participating) {
        if (['临时工', '临时工？'].includes(c.character)) {
          relevantCharacters.add(c.id);
          alternatives.push({
            category: 'character',
            label: `${c.character}（${c.id}）的替身/当前身份来源待定`,
            requires: [],
            resources: [],
            notes: ['保留特殊身份转换解释。'],
          });
          continue;
        }
        for (const source of cardSources.get(c.id) ?? []) {
          relevantCharacters.add(c.id);
          add(
            source,
            'character',
            `${c.character}（${c.id}）的${source.detached ? '间接效果' : description ? (source.ability?.id ?? '角色能力') : '角色能力'}`,
            c.id,
          );
        }
        const key = 'identity:' + c.id,
          roles = roleSources.get(c.id);
        if (!roles) continue;
        for (const value of p.store.domains.get(key) ?? []) {
          const identity = baseIdentity(value);
          const matching = [...(roles.get(identity) ?? [])];
          if (identity === '怪杰') matching.push(...(roles.get('主谋') ?? []));
          if (description && identity === lifecycle.borrowed.identity) {
            if (this.boards.school >= lifecycle.borrowed.threshold)
              matching.push(...(roles.get(lifecycle.borrowed.school) ?? []));
            if (this.cityQualifiedAtDeath.has(c.id))
              matching.push(...(roles.get(lifecycle.borrowed.city) ?? []));
          }
          if (
            description &&
            value === lifecycle.transformation.initial &&
            p.x.includes(lifecycle.transformation.plot)
          ) {
            const old = this.endEntry?.characters.get(c.id);
            if (
              !old ||
              old.counters.paranoia + old.counters.despair >= lifecycle.transformation.paranoia
            )
              matching.push(...(roles.get(lifecycle.transformation.effective) ?? []));
          }
          if (matching.length) {
            relevantCharacters.add(c.id);
            for (const source of matching)
              add(
                source,
                'character',
                source.detached && !directDeathEffect(source)
                  ? `${c.character}（${c.id}）可能先前发动的 ${identity} 效果`
                  : `${c.character}（${c.id}）是${identity}${description && source.ability ? '（' + source.ability.id + '）' : ''}`,
                c.id,
                source.detached && !directDeathEffect(source) ? [] : [{ key, value }],
              );
          }
        }
      }
      for (const [name, sources] of indexed.events) {
        const eventDays = sources.some((s) => s.detached)
          ? [...p.store.domains.keys()]
              .filter((k) => k.startsWith('event:'))
              .map((k) => Number(k.slice(6)))
          : [o.day];
        for (const eventDay of eventDays) {
          const key = 'event:' + eventDay;
          if (!p.store.domains.get(key)?.has(name)) continue;
          for (const source of sources)
            if (
              (source.detached || !this.pairWindow?.completedFrame) &&
              (!description ||
                source.detached ||
                (Number(key.slice(6)) === o.day &&
                  !this.pairWindow?.completedFrame &&
                  this.occurrence.get(o.loop + ':' + o.day) !== false)) &&
              (eligible(source, undefined, eventDay) ||
                (virtualVictim && !source.detached && eligible(source, change.target, eventDay)))
            ) {
              const day = key.slice(6);
              const culpritKey = 'culprit:' + day;
              const actors = p.store.domains.get(culpritKey) ?? new Set(['未公开']);
              const independent =
                !description || source.detached || (source.independentOfCulprit && !virtualVictim);
              let culpritOptions: (string | undefined)[] = [undefined];
              if (!actors.size) continue;
              if (!independent || cats.some((c) => actors.has(c.id))) {
                const effective = [...actors].filter(
                  (id) =>
                    !cats.some((c) => c.id === id) &&
                    (independent ||
                      this.roster.find((c) => c.id === id)?.character === '临时工' ||
                      eligible(source, id, eventDay)),
                );
                if (!effective.length) continue;
                culpritOptions = effective;
              }
              relevantEvents.add(day + ':' + name);
              if (
                o.phase === 'incident' &&
                independent &&
                !source.detached &&
                source.reports === 1 &&
                change.kind === 'counter' &&
                source.target === change.target &&
                source.amount
              ) {
                fixedReport = JSON.stringify([
                  p.id,
                  o.loop,
                  o.day,
                  name,
                  change.target,
                  change.counter,
                  change.sign,
                ]);
                fixedAlternatives += culpritOptions.length;
              }
              for (const id of culpritOptions) {
                add(
                  source,
                  'event',
                  `第 ${day} 日真实事件为${name}，${source.delay ? '且有本日到期的相关效果' : '其结算可能导致本次变化'}` +
                    (id ? `（当事人 ${id}）` : ''),
                  'event:' + key,
                  [{ key, value: name }, ...(id ? [{ key: culpritKey, value: id }] : [])],
                );
                const cause = alternatives.at(-1)!;
                if (source.deathGuard && !source.detached) guardCauses.add(cause);
                if (!source.detached && eventDay === o.day && this.catalog.pairPrograms.has(name))
                  pairCauses.set(cause, name);
                if (
                  source.selection &&
                  !this.roster.some(
                    (c) =>
                      (traits(this.pack, c.character).execution === 'repeat' ||
                        traits(this.pack, c.character).execution === 'proxy') &&
                      (id ? c.id === id : actors.has(c.id)),
                  )
                ) {
                  cause.choices = bindChoices(source, change, [
                    'event-choice',
                    o.loop,
                    eventDay,
                    name,
                  ]);
                  cause.notes.push(
                    '本次事件的 ' +
                      source.selection.key +
                      ' 选择 ' +
                      change.target +
                      (source.selection.different.length
                        ? '，须与 ' + source.selection.different.join('、') + ' 不同。'
                        : '。'),
                  );
                } else if (source.selection) unboundRepeat = true;
              }
            }
        }
      }
      if (description) {
        for (const cause of intrinsicCauses(
          this.pack,
          o,
          change,
          p,
          this.characters.get(change.target),
          this.characters,
          this.deathsInWindow,
          this.priorFriends,
          cats,
        )) {
          alternatives.push(cause);
          if (cause.rule) relevantRules.add(cause.rule);
          if (cause.owner) relevantCharacters.add(cause.owner);
        }
      }
      const direct = declared
        ? alternatives.filter(
            (a) =>
              a.category === 'character' &&
              a.owner === declared.id &&
              a.ability === declared.ability,
          )
        : [];
      let unique = [
        ...new Map(
          (direct.length ? direct : alternatives).map((a) => [JSON.stringify(a), a]),
        ).values(),
      ];
      const window = this.pairWindow;
      const pairName = unique.length ? pairCauses.get(unique[0]!) : undefined;
      if (
        pairName &&
        unique.every((a) => pairCauses.get(a) === pairName) &&
        !batch &&
        window &&
        o.phase === 'incident' &&
        window.loop === o.loop &&
        window.day === o.day
      ) {
        let tracker = this.pairStates.get(p);
        const key = 'culprit:' + o.day;
        const ids = [...p.store.values(key)];
        if (!tracker && window.reports === 0) {
          tracker = this.startPair(pairName, ids);
          this.pairStates.set(p, tracker);
        }
        if (tracker?.name === pairName && tracker.reports === window.reports) {
          checkedExclusion = true;
          tracker.reports++;
          const valid = this.pairCulprits(tracker, ids, scope, o.sequence, change);
          if (!tracker.ordinaryOnly) for (const id of ids) relevantCharacters.add(id);
          // The public pair cursor already retains the target inequality.
          if (
            tracker.ordinaryOnly &&
            valid.length === ids.length &&
            p.store.values('event:' + o.day).size === 1
          )
            boardOnly.add(p);
          unique = unique.flatMap((a) => {
            a.notes.push('一次结算的两名目标必须不同，教主再次结算时重新选择。');
            if (tracker.executions.has('parallel'))
              a.notes.push('临时工与替身分别选目标，同一步的指示物变化合并结算。');
            if (valid.length === ids.length) return [a];
            return valid
              .filter((id) => a.requires.every((g) => g.key !== key || g.value === id))
              .map((id) => ({
                ...a,
                requires: [...a.requires.filter((g) => g.key !== key), { key, value: id }],
                label: a.label + '，当事人为 ' + id,
              }));
          });
        } else scope.needsHistory = true;
      } else if (unboundRepeat || pairCauses.size) scope.needsHistory = true;
      if (
        guardCauses.size &&
        o.phase === 'incident' &&
        !['临时工', '临时工？'].includes(this.characters.get(change.target)?.character ?? '')
      ) {
        const key = 'identity:' + change.target;
        const domain = p.store.domains.get(key);
        if (domain && [...domain].some((v) => this.pack.identities[shownIdentity(v)]?.immortal)) {
          const mortal = [...domain].filter(
            (v) => !this.pack.identities[shownIdentity(v)]?.immortal,
          );
          checkedExclusion = true;
          unique = unique.flatMap((a) =>
            guardCauses.has(a)
              ? mortal.map((value) => ({
                  ...a,
                  requires: [...a.requires, { key, value }],
                  label:
                    a.label +
                    '，守护实际消耗，' +
                    change.target +
                    ' 的身份为' +
                    shownIdentity(value),
                }))
              : [a],
          );
        }
      }
      if (change.before !== undefined && change.after !== undefined) {
        const joint = counterCauses(
          unique,
          Math.abs(change.after - change.before),
          undefined,
          this.counterWork,
        );
        if (joint) unique = joint;
        else {
          scope.needsHistory = true;
          scope.conservative.push('合并指示物来源达到局部预算，保留未区分的解释。');
        }
      }
      // One ordinary resolution of a fixed single counter effect can publish
      // only once. A second guaranteed report can distinguish a cult leader
      // or the part-timer's additional acting culprit.
      if (
        fixedReport &&
        fixedAlternatives === alternatives.length &&
        p.store.values('event:' + o.day).size === 1
      ) {
        const priorReports = this.fixedIncidentReports.get(fixedReport) ?? 0;
        if (priorReports > 0) {
          if (priorReports >= 2) scope.needsHistory = true;
          const culpritKey = 'culprit:' + o.day;
          const repeaters = this.roster.filter(
            (c) =>
              (traits(this.pack, c.character).execution === 'repeat' ||
                traits(this.pack, c.character).execution === 'proxy') &&
              p.store.values(culpritKey).has(c.id),
          );
          const repeated = unique.flatMap((a) =>
            repeaters
              .filter((c) => a.requires.every((g) => g.key !== culpritKey || g.value === c.id))
              .map((c) => ({
                ...a,
                label: a.label + '，由' + c.character + '（' + c.id + '）重复结算',
                requires: [
                  ...a.requires.filter((g) => g.key !== culpritKey),
                  { key: culpritKey, value: c.id },
                ],
              })),
          );
          unique.splice(0, unique.length, ...repeated);
        }
        this.fixedIncidentReports.set(fixedReport, priorReports + 1);
      }
      for (const a of unique) {
        scope.conservative.push(...a.notes);
        labels.add(a.label);
      }
      clauses.set(p, unique);
    }
    if (description && !labels.size && !checkedExclusion) return;
    const allBoardOnly =
      !scope.needsHistory &&
      clauses.size > 0 &&
      [...clauses].every(
        ([p, alternatives]) =>
          boardOnly.has(p) ||
          (this.pairWindow?.day === o.day &&
            this.pairWindow.loop === o.loop &&
            o.phase === 'incident' &&
            alternatives.length === 1 &&
            alternatives.every(
              (a) =>
                a.category === 'event' &&
                !a.notes.length &&
                !a.resources.length &&
                !a.choices?.length &&
                a.requires.length === 1 &&
                a.requires[0]?.key === 'event:' + o.day &&
                p.store.values(a.requires[0].key).size === 1 &&
                p.store.values(a.requires[0].key).has(a.requires[0].value),
            )),
      );
    if (!allBoardOnly) {
      this.relationFacts.set(key, {
        observation: o.sequence,
        loop: o.loop,
        day: o.day,
        phase: o.phase,
        target: board,
        description,
      });
      this.version++;
      for (const [p, alternatives] of clauses) {
        const record: CauseRecord = {
          key: typeof key === 'string' ? key : undefined,
          observation: o.sequence,
          phase: o.phase,
          alternatives,
        };
        if (batch) {
          const records = batch.records.get(p) ?? [];
          records.push(record);
          batch.records.set(p, records);
        } else this.addCauses(p, [record]);
      }
    }
    const project = () => {
      const surviving = [...clauses]
        .filter(([p]) => p.active)
        .flatMap(([p, causes]) =>
          causes.filter(
            (c) =>
              !this.networks.get(p.id)?.excludedCauses.has(c) &&
              c.requires.every((g) => p.store.values(g.key).has(g.value)),
          ),
        );
      if (!scope.needsHistory && !batch && surviving.length) {
        for (const guard of surviving[0]!.requires) {
          if (
            guard.key.startsWith('identity:') &&
            surviving.every((c) =>
              c.requires.some((g) => g.key === guard.key && g.value === guard.value),
            )
          ) {
            this.impliedIdentities[guard.key.slice(9)] = {
              identity: shownIdentity(guard.value),
              observation: o.sequence,
            };
          }
        }
        if (
          o.phase === 'mastermind-abilities' &&
          change.kind === 'counter' &&
          change.counter === 'paranoia' &&
          change.after === (change.before ?? NaN) + 1 &&
          surviving.every((c) => c.ability === 'gossip' && c.requires.length === 1)
        )
          scope.locallyExplained = true;
      }
      scope.alternatives = [...new Set(surviving.map((cause) => cause.label))];
      if (
        declared &&
        surviving.length &&
        surviving.every((c) => c.owner === declared.id && c.ability === declared.ability)
      ) {
        relevantCharacters.clear();
        relevantCharacters.add(declared.id);
        // This exact single counter report is accounted for. A later disclosure
        // or completion reaction still arrives as its own observation.
        if (
          this.declared?.independent &&
          !scope.needsHistory &&
          surviving.every((c) => !c.notes.length && !c.requires.length)
        )
          scope.locallyExplained = true;
        relevantRules.clear();
        relevantEvents.clear();
      }
      scope.characters = [...relevantCharacters];
      scope.rules = [...relevantRules];
      scope.events = [...relevantEvents];
      scope.skippedCharacters = this.roster
        .filter((c) => !relevantCharacters.has(c.id))
        .map((c) => c.id);
      scope.skippedRules = [...allRules].filter((r) => !relevantRules.has(r));
      scope.skippedEvents = [
        ...new Set(
          profiles.flatMap((p) =>
            [...p.store.domains]
              .filter(([key]) => key.startsWith('event:'))
              .flatMap(([key, values]) => [...values].map((n) => `${key.slice(6)}:${n}`)),
          ),
        ),
      ].filter((e) => !relevantEvents.has(e));
      scope.conservative = [...new Set(scope.conservative)];
    };
    if (batch) batch.projections.push(project);
    else project();
    this.simultaneous?.projections.push(project);
    return scope;
  }
  private quietIncident(
    o: Observation,
    profiles: Profile[],
    survivors?: string[],
  ): Scope | undefined {
    const w = this.pairWindow;
    if (
      !w ||
      (!survivors && (w.hasReport || o.phase !== 'incident' || o.day !== o.data.day)) ||
      w.loop !== o.loop ||
      w.day !== o.day ||
      !['FS', 'BTX'].includes(this.pack.module)
    )
      return;
    const scope = this.summary(o, 'visible-effect');
    scope.alternatives = [];
    const ek = 'event:' + o.day,
      ck = 'culprit:' + o.day;
    // A public empty target set or a saturated board common to every
    // candidate adds nothing, even before considering private identities.
    const names = new Set(
      profiles.filter((p) => p.active).flatMap((p) => [...(p.store.domains.get(ek) ?? [])]),
    );
    if (
      !survivors &&
      names.size &&
      [...names].every((name) => {
        const d = this.pack.incidents[name];
        return (
          d &&
          !d.afterIncidentSteps?.length &&
          quietTargets(d.steps, {
            clock: o,
            pack: this.pack,
            characters: this.characters,
            boards: this.boards,
            days: this.days,
            loops: this.loops,
          })?.some((v) => !v.length)
        );
      })
    ) {
      scope.events = [...names].map((name) => o.day + ':' + name);
      scope.skippedCharacters = this.roster.map((c) => c.id);
      scope.skippedRules = [...new Set(profiles.flatMap((p) => [p.y, ...p.x]))];
      w.settledQuietly = true;
      return scope;
    }
    const rows = new Map<Profile, Cause[]>();
    let informative = false;
    const alive = [...this.characters.values()].filter((c) => c.status === 'alive');
    const cache = new Map<string, string[][] | undefined>();
    for (const p of profiles) {
      if (!p.active) continue;
      const events = p.store.domains.get(ek),
        ids = p.store.domains.get(ck);
      if (!events?.size || !ids?.size) return;
      const causes: Cause[] = [];
      for (const name of events)
        for (const id of ids) {
          const actor = this.characters.get(id);
          const incident = this.pack.incidents[name];
          const guards = [
            { key: ek, value: name },
            { key: ck, value: id },
          ];
          const add = (label: string, extra: Cause['requires'] = []) =>
            causes.push({
              category: 'event',
              label: name + '（当事人 ' + id + '）：' + label,
              requires: [...guards, ...extra],
              resources: [],
              notes: [],
            });
          scope.events.push(o.day + ':' + name);
          let free = false;
          const unknown = () => {
            scope.needsHistory = true;
            free = true;
            add('保留未核验的结算解释');
          };
          if (
            traits(this.pack, actor?.character).execution === 'cancel' &&
            !incident?.afterIncidentSteps?.length
          ) {
            free = true;
            add('黑猫当事人取消事件效果');
          } else if (
            !actor ||
            ['临时工', '临时工？'].includes(actor.character) ||
            this.pack.characters[actor.character]?.incidentAreaFromBase ||
            !incident ||
            incident.afterIncidentSteps?.length
          )
            unknown();
          else {
            const key = JSON.stringify([name, id]);
            if (!cache.has(key)) {
              const pair = this.catalog.pairPrograms.get(name);
              if (survivors) cache.set(key, [survivors]);
              else if (pair) {
                const execution = new PairExecution(pair, 'ordinary');
                cache.set(key, execution.advance(this.characters) ? [[]] : []);
              } else
                cache.set(
                  key,
                  quietTargets(incident.steps, {
                    clock: o,
                    pack: this.pack,
                    owner: id,
                    characters: this.characters,
                    boards: this.boards,
                    days: this.days,
                    loops: this.loops,
                    virtualArea: this.hasIncidentAreaIdentity,
                  }),
                );
            }
            const alternatives = cache.get(key);
            if (!alternatives) unknown();
            else
              for (const targets of alternatives) {
                if (!targets.length) {
                  free = true;
                  add('公开盘面允许无变化');
                  break;
                }
                const required: Cause['requires'] = [];
                let supported = true,
                  unsupported = false;
                for (const target of new Set(targets)) {
                  const c = this.characters.get(target)!;
                  const domain = p.store.domains.get('identity:' + target);
                  if (
                    !domain ||
                    ['临时工', '临时工？'].includes(c.character) ||
                    (c.counters.guard === 0 &&
                      alive.some(
                        (a) =>
                          a.id !== target &&
                          a.area === c.area &&
                          this.pack.characters[a.character]?.protects,
                      ))
                  ) {
                    unsupported = true;
                    break;
                  }
                  const immortal = [...domain].filter(
                    (v) => this.pack.identities[shownIdentity(v)]?.immortal,
                  );
                  if (!immortal.length) {
                    supported = false;
                    break;
                  }
                  if (immortal.length === domain.size) continue;
                  if (immortal.length !== 1) {
                    unsupported = true;
                    break;
                  }
                  required.push({ key: 'identity:' + target, value: immortal[0]! });
                }
                if (unsupported) {
                  unknown();
                  break;
                }
                if (supported) {
                  if (!required.length) free = true;
                  add(targets.join('、') + ' 的死亡请求被不死身份阻止', required);
                  if (free) break;
                }
              }
          }
          if (!free) informative = true;
        }
      rows.set(p, causes);
    }
    scope.events = [...new Set(scope.events)];
    if (informative) {
      this.version++;
      this.relationFacts.set(o.sequence, {
        observation: o.sequence,
        loop: o.loop,
        day: o.day,
        phase: o.phase,
        target: '事件',
        description: survivors
          ? '事件阶段结束，部分应受死亡请求的角色未发生死亡或守护变化'
          : '事件已发生，结算无现象',
      });
      for (const [p, alternatives] of rows) {
        this.network(p).add(p, {
          observation: o.sequence,
          phase: o.phase,
          alternatives,
        });
        if (!p.active) continue;
        const viable = alternatives.filter(
          (a) =>
            !this.network(p).excludedCauses.has(a) &&
            a.requires.every((g) => p.store.values(g.key).has(g.value)),
        );
        scope.characters.push(
          ...viable.flatMap((a) =>
            a.requires
              .filter((g) => g.key === ck || g.key.startsWith('identity:'))
              .map((g) => (g.key === ck ? g.value : g.key.slice(9))),
          ),
        );
        scope.alternatives!.push(...viable.map((a) => a.label));
      }
      scope.characters = [...new Set(scope.characters)];
      scope.alternatives = [...new Set(scope.alternatives)];
    }
    scope.skippedCharacters = this.roster
      .filter((c) => !scope.characters.includes(c.id))
      .map((c) => c.id);
    scope.skippedRules = [...new Set(profiles.flatMap((p) => [p.y, ...p.x]))];
    if (!scope.needsHistory && !survivors) w.settledQuietly = true;
    return scope;
  }
  private moduleIncident(
    o: Observation,
    profiles: Profile[],
    day: number,
    occurred: boolean,
  ): Scope {
    const scope = this.summary(o, 'incident-occurrence');
    if (this.pack.module === 'MC' && occurred)
      this.mcGain = { sequence: o.sequence, loop: o.loop, day, before: this.publicEx };
    let unresolved = false;
    const event = 'event:' + day,
      owner = 'culprit:' + day;
    for (const p of profiles) {
      if (!p.active || !p.store.domains.has(event)) continue;
      const allowed = new Set<string>();
      const owners = [...this.characters.values()]
        .filter((c) => c.status === 'alive')
        .map((c) => ({
          actor: c,
          roles: new Set(
            ['临时工', '临时工？'].includes(c.character)
              ? Object.keys(this.pack.identities)
              : [...(p.store.domains.get('identity:' + c.id) ?? [])].flatMap((v) =>
                  possibleForms(p, v),
                ),
          ),
        }));
      const prophetAlive = owners.some((c) => c.roles.has('预言家'));
      const areaTrigger = owners.some((c) =>
        [...c.roles].some((role) => this.pack.identities[role]?.sameAreaIncidentTrigger),
      );
      for (const name of p.store.values(event))
        for (const id of p.store.values(owner)) {
          const rule = this.pack.incidents[name]!;
          const actor = this.characters.get(id);
          if (rule.crowdThreshold !== undefined) {
            if (!BOARDS.includes(id as (typeof BOARDS)[number])) continue;
            const corpses =
              [...this.characters.values()].filter((c) => c.status === 'dead' && c.area === id)
                .length +
              boardVictims(this.pack.module, this.boards[id as (typeof BOARDS)[number]]);
            if (corpses >= rule.crowdThreshold !== occurred) continue;
          } else {
            if (BOARDS.includes(id as (typeof BOARDS)[number])) continue;
            if (
              actor &&
              traits(this.pack, actor.character).execution !== 'proxy' &&
              occurred &&
              actor.status !== 'alive'
            )
              continue;
            if (!actor || traits(this.pack, actor.character).privateTrigger) unresolved = true;
            if (
              actor &&
              !traits(this.pack, actor.character).privateTrigger &&
              actor.status === 'alive'
            ) {
              const possibleRoles = owners.find((c) => c.actor.id === id)!.roles;
              const nearby = owners.filter((c) => c.actor.area === actor.area);
              const forced = name === '次元转换';
              const forcePossible =
                areaTrigger ||
                (actor.counters.despair > 0 && nearby.some((c) => c.roles.has('监视者')));
              const suppressPossible =
                traits(this.pack, actor.character).maySuppress ||
                nearby.some((c) => c.actor.id !== id && c.roles.has('预言家'));
              if (forcePossible || suppressPossible || possibleRoles.size > 1) unresolved = true;
              const compatible = [...possibleRoles].some((role) => {
                const automatic = forced || role === '强迫症';
                const met = incidentThresholdMet(
                  this.pack,
                  name,
                  actor.character,
                  role,
                  actor.counters,
                  this.pack.characters[actor.character]!.paranoia,
                  this.publicEx,
                  p.y,
                  p.x,
                  occurred && prophetAlive,
                );
                return occurred
                  ? automatic || forcePossible || met
                  : suppressPossible || (!automatic && !met);
              });
              if (!compatible) continue;
            }
          }
          allowed.add(JSON.stringify([name, id]));
        }
      p.store.add(
        relation('module-incident:' + o.sequence, event, owner, (name, id) =>
          allowed.has(JSON.stringify([name, id])),
        ),
      );
      p.active = p.store.propagate();
      if (p.active) {
        scope.events.push(...p.store.values(event));
        scope.characters.push(...p.store.values(owner));
      }
    }
    scope.events = [...new Set(scope.events)];
    scope.characters = [...new Set(scope.characters)];
    scope.needsHistory = unresolved;
    scope.conservative.push('已按真实事件和当事人配对；私有触发、区域尸体、Ex 与正文另核验。');
    return scope;
  }
  private incident(o: Observation, profiles: Profile[]): Scope | undefined {
    const day = o.data.day;
    if (o.phase !== 'incident' || typeof day !== 'number' || typeof o.data.occurred !== 'boolean')
      return;
    if (this.extended) return this.moduleIncident(o, profiles, day, o.data.occurred);
    if (!this.catalog.publicTriggerModel) return;
    if (profiles.some((p) => p.y === '士的宁毒液' || p.x.includes('灭亡讴歌'))) return;
    const scope = this.summary(o, 'incident-occurrence');
    this.version++;
    const eventKey = `event:${day}`,
      culpritKey = `culprit:${day}`;
    const roster = this.roster;
    const passing = new Map<string, Map<string, boolean>>();
    for (const p of profiles) {
      if (!p.store.domains.has(eventKey) || !p.store.domains.has(culpritKey)) continue;
      scope.events.push(...[...p.store.values(eventKey)].map((n) => `${day}:${n}`));
      scope.characters.push(...p.store.values(culpritKey));
      const allowed = new Set<string>();
      const pairs = [...p.store.values(eventKey)].flatMap((name) =>
        [...p.store.values(culpritKey)]
          .filter((id) => {
            let candidates = passing.get(name);
            if (!candidates) passing.set(name, (candidates = new Map()));
            if (!candidates.has(id))
              candidates.set(
                id,
                this.catalog.permitsOccurrence(
                  name,
                  this.characters.get(id),
                  o.data.occurred === true,
                ),
              );
            if (!candidates.get(id)) return false;
            allowed.add(JSON.stringify([name, id]));
            return true;
          })
          .map((id) => ({
            name,
            id,
            pending: [] as string[],
            label: `真实事件为${name} 且 当事人为${roster.find((c) => c.id === id)?.character ?? id}（${id}）`,
          })),
      );
      if (o.data.occurred)
        for (const pair of pairs) {
          if (
            traits(this.pack, roster.find((c) => c.id === pair.id)?.character).execution ===
            'cancel'
          )
            continue;
          for (const source of this.catalog.events.get(pair.name) ?? []) {
            if (!source.delay?.day) continue;
            const origin = { ...this.context(o, source), staticOnly: true };
            const dueLoop =
              source.delay.loop === undefined ? o.loop : publicNumber(source.delay.loop, origin);
            const dueDay = publicNumber(source.delay.day, origin);
            pair.pending.push(
              `若真实事件为${pair.name}且当事人为${pair.id}并成功安排，区域效果于第 ${dueLoop ?? '？'} 轮第 ${dueDay ?? '？'} 日 ${source.timing} 到期。`,
            );
          }
        }
      this.incidentPairs.set(p.id + ':' + o.sequence, { day, pairs });
      const entries = this.eventRelations.get(p.id) ?? [];
      entries.push({
        id: `incident:${o.sequence}`,
        observation: o.sequence,
        fact: `第 ${o.loop} 轮第 ${day} 日事件${o.data.occurred ? '发生' : '未发生'}：真实事件与当事人必须成对相容。`,
        implications: [],
        cases: [
          {
            when: [[p.y, ...p.x].join(' ＋ ')],
            alternatives: [],
            limits: [],
            notes: ['未知的特殊触发或禁止条件保留，不将无现象视为未发生。'],
          },
        ],
      });
      this.eventRelations.set(p.id, entries);
      p.store.add(
        relation(`incident-trigger:${o.sequence}`, eventKey, culpritKey, (name, id) =>
          allowed.has(JSON.stringify([name, id])),
        ),
      );
      p.active = p.store.propagate();
    }
    scope.characters = [...new Set(scope.characters)];
    scope.events = [...new Set(scope.events)];
    scope.skippedCharacters = roster
      .filter((c) => !scope.characters.includes(c.id))
      .map((c) => c.id);
    scope.skippedRules = [...new Set(profiles.flatMap((p) => [p.y, ...p.x]))];
    scope.conservative = [
      '仅约束当事人与真实事件；黑猫无效果不等于事件未发生，教主重复效果另行核验，手下可能受禁止事件效果影响。',
    ];
    return scope;
  }
  private mandatoryWindow(o: Observation, profiles: Profile[]): Scope | undefined {
    if (o.type === 'boundary' && o.phase === 'discussion') {
      this.priorFriends = new Set(
        [...this.characters.values()]
          .filter((c) => o.loop > 1 && c.counters.goodwill + c.counters.hope > 0)
          .map((c) => c.id),
      );
    }
    if (o.type === 'boundary' && o.phase === 'loop-start') {
      const alive = [...this.characters.values()].filter((c) => c.status === 'alive');
      this.window = {
        loop: o.loop,
        next: o.sequence + 1,
        missing: new Set(alive.filter((c) => this.priorFriends.has(c.id)).map((c) => c.id)),
        cats: new Set(
          alive
            .filter((c) => this.pack.characters[c.character]?.loopShrineIntrigue)
            .map((c) => c.id),
        ),
      };
      return;
    }
    const w = this.window;
    if (!w) return;
    if (o.loop !== w.loop || o.sequence !== w.next++) {
      this.window = undefined;
      return;
    }
    if (o.phase === 'loop-start') {
      const id = String(o.data.character);
      if (o.type === 'character') {
        const old = this.characters.get(id);
        const next = o.data.counters as { paranoia?: number } | undefined;
        if (
          !old ||
          o.data.status !== 'alive' ||
          next?.paranoia === undefined ||
          next.paranoia > old.counters.paranoia
        )
          w.missing.delete(id);
        if (o.data.status !== 'alive') w.cats.delete(id);
      }
      if (
        o.type === 'board' &&
        o.data.board === 'shrine' &&
        typeof o.data.intrigue === 'number' &&
        o.data.intrigue > this.boards.shrine
      )
        w.cats.clear();
      return;
    }
    this.window = undefined;
    if (o.type !== 'boundary' || o.phase !== 'day-start') return;
    const conflict =
      w.missing.size > 0 && profiles.some((p) => p.x.includes(lifecycle.previousFriend.plot));
    if (!w.cats.size && !conflict) return;
    const scope = this.summary(o, 'mandatory-absence');
    scope.characters = [...new Set([...w.cats, ...(conflict ? w.missing : [])])];
    scope.rules = conflict ? [lifecycle.previousFriend.plot] : [];
    scope.skippedRules = [...new Set(profiles.flatMap((p) => [p.y, ...p.x]))].filter(
      (r) => !scope.rules.includes(r),
    );
    scope.skippedCharacters = this.roster
      .filter((c) => !scope.characters.includes(c.id))
      .map((c) => c.id);
    scope.skippedEvents = [
      ...new Set(
        profiles.flatMap((p) =>
          [...p.store.domains]
            .filter(([k]) => k.startsWith('event:'))
            .flatMap(([k, vs]) => [...vs].map((v) => k.slice(6) + ':' + v)),
        ),
      ),
    ];
    const missing = w.cats.size
      ? '黑猫存活，但神社未出现强制密谋增加'
      : '上一轮有友好或希望的存活角色未出现因果线强制的不安增加';
    this.publicRelations.push({
      id: 'absence:' + o.sequence,
      fact: missing,
      observation: o.sequence,
      implications: [w.cats.size ? '本观察序列与轮回开始效果矛盾。' : '排除含因果线的规则组合。'],
      cases: [
        {
          when: ['第 ' + o.loop + ' 轮轮回开始窗口已关闭'],
          alternatives: [],
          limits: [],
          notes: ['涉及角色 ' + scope.characters.join('、')],
        },
      ],
    });
    for (const p of profiles)
      if (w.cats.size || p.x.includes(lifecycle.previousFriend.plot)) p.active = false;
    this.version++;
    return scope;
  }
  publicUpdate(o: Observation): boolean {
    const d = o.data;
    switch (o.type) {
      case 'boundary': {
        const previous = this.lastBoundary;
        // Crossing these windows can itself disclose non-occurrence. Keep the
        // history check for mandatory outcomes without a local propagator.
        if (previous?.phase === 'day-end' || previous?.phase === 'loop-end') return false;
        if (
          previous?.phase === 'incident' &&
          this.scheduledDays.has(previous.day) &&
          !this.occurrence.has(previous.loop + ':' + previous.day)
        )
          return false;
        return true;
      }
      case 'own-choice': {
        const choice = d.choice;
        return (
          !!choice &&
          typeof choice === 'object' &&
          'kind' in choice &&
          (['cards', 'continue', 'pass'].includes(String(choice.kind)) ||
            (choice.kind === 'select' &&
              o.phase === 'protagonist-abilities' &&
              !!this.directRequest) ||
            (choice.kind === 'ability' &&
              'owner' in choice &&
              'ability' in choice &&
              this.roster.some(
                (c) =>
                  c.id === choice.owner &&
                  this.pack.characters[c.character]?.abilities.some((a) => a.id === choice.ability),
              )))
        );
      }
      case 'cards':
        return Array.isArray(d.placements);
      case 'no-effect':
        return false; // Classified with event and identity domains in consume().
      case 'declaration':
        return (
          typeof d.ability === 'string' &&
          this.roster.some(
            (c) =>
              c.id === d.character &&
              this.pack.characters[c.character]?.abilities.some((a) => a.id === d.ability),
          )
        );
      case 'rule':
        return typeof d.rule === 'string';
      case 'culprit':
        return (
          this.roster.some((c) => c.id === d.culprit) &&
          typeof d.day === 'number' &&
          this.scheduledDays.has(d.day)
        );
      case 'identity':
        return (
          typeof d.identity === 'string' &&
          this.roster.some(
            (c) => c.id === d.character && !['临时工', '临时工？'].includes(c.character),
          )
        );
      case 'board':
        if (
          o.phase === 'loop-start' &&
          this.window?.loop === o.loop &&
          this.window.cats.size &&
          d.board === 'shrine' &&
          d.intrigue === this.boards.shrine + 1
        )
          return true;
        return false;
      default:
        return false;
    }
  }
  // A quiet closed window can rule out a mandatory kill. Read the entry
  // snapshot: two simultaneous killers can both die before either report is read.
  private closedDayEnd(o: Observation, profiles: Profile[]): Scope | undefined {
    const entry = this.endEntry,
      prev = this.lastBoundary;
    if (o.type !== 'boundary' || !entry || !this.quietDayEnd || prev?.phase !== 'day-end') return;
    const actors = [...entry.characters.values()].filter((c) => c.status === 'alive');
    if (
      actors.some(
        (c) =>
          ['临时工', '临时工？'].includes(c.character) ||
          this.pack.characters[c.character]?.protects ||
          hasVirtualArea(this.pack, c.character),
      )
    )
      return;
    const ordinary =
      prev.loop === o.loop &&
      (prev.day === this.days
        ? o.phase === 'loop-end' && prev.day === o.day
        : o.phase === 'day-start' && o.day === prev.day + 1);
    const outstanding = this.catalog.otherDayEndObligations;
    let unknown =
      this.catalog.scheduledDayEnd || !ordinary || actors.some((c) => c.counters.guard > 0);
    const scopes = new Set<string>(),
      cases: NonNullable<KnowledgeView['relations']>[number]['cases'] = [];
    for (const { identity, ability: a, step, selector } of this.catalog.dayEndKills) {
      for (const owner of actors) {
        const ctx: PublicContext = {
          clock: prev,
          days: this.days,
          loops: this.loops,
          pack: this.pack,
          ...entry,
          owner: owner.id,
        };
        const enabled = publicCondition(a.condition, ctx),
          stepEnabled = publicCondition(step.condition, ctx);
        if (enabled === undefined || stepEnabled === undefined) unknown = true;
        if (enabled !== true || stepEnabled !== true) continue;
        for (const target of actors) {
          const selected = publicCondition(selector.where, {
            ...ctx,
            bindings: { it: target.id },
          });
          if (selected === undefined || (target.id === owner.id && selected === true))
            unknown = true;
          if (target.id === owner.id || target.counters.guard || selected !== true) continue;
          for (const p of profiles) {
            const from = 'identity:' + owner.id,
              to = 'identity:' + target.id;
            const uses = (v: string) =>
              shownIdentity(v) === identity ||
              (identity === lifecycle.transformation.effective &&
                v === lifecycle.transformation.initial &&
                p.x.includes(lifecycle.transformation.plot) &&
                owner.counters.paranoia + owner.counters.despair >=
                  lifecycle.transformation.paranoia);
            const domain = p.store.domains.get(from);
            if (!p.active || !domain || ![...domain].some(uses) || !p.store.domains.has(to))
              continue;
            p.store.add(
              relation(
                'missing-kill:' + o.sequence + ':' + owner.id + ':' + target.id + ':' + a.id,
                from,
                to,
                (v, t) => !uses(v) || !!this.pack.identities[shownIdentity(t)]?.immortal,
              ),
            );
            p.active = p.store.propagate();
            scopes.add(owner.id);
            scopes.add(target.id);
            const statement =
              owner.character +
              '（' +
              owner.id +
              '）若以' +
              identity +
              '结算，则' +
              target.character +
              '（' +
              target.id +
              '）必须具有不死身份';
            cases.push({
              when: [[p.y, ...p.x].join(' ＋ ')],
              alternatives: [statement],
              limits: [],
              notes: [],
            });
          }
        }
      }
    }
    if (!cases.length && (unknown || outstanding)) return;
    const scope = this.summary(o, 'mandatory-absence');
    scope.characters = [...scopes];
    scope.skippedCharacters = this.roster.map((c) => c.id).filter((id) => !scopes.has(id));
    scope.alternatives = [...new Set(cases.flatMap((c) => c.alternatives))];
    // Other obligations at the same boundary can still require a witness.
    scope.needsHistory = unknown || outstanding > 0;
    if (!cases.length) return scope;
    this.publicRelations.push({
      id: 'missing-kill:' + o.sequence,
      observation: o.sequence,
      fact: '日末窗口已关闭，盘面没有发生强制死亡或守护变化。',
      implications: [],
      cases,
    });
    this.version++;
    return scope;
  }
  private bypass(
    o: Observation,
    profiles: Profile[],
    key: 'goodwill' | 'intrigue',
    id: string,
  ): Scope | undefined {
    const actor = this.characters.get(id),
      area = actor?.area ?? id;
    const changed =
      o.type === 'board'
        ? o.data.intrigue !== this.boards[id as (typeof BOARDS)[number]]
        : actor && (o.data.counters as Record<string, number>)[key] !== actor.counters[key];
    if (!changed) return;
    const roles = cardBypassRoles[key];
    const inRange =
      key === 'goodwill'
        ? [id]
        : [...this.characters.values()]
            // Modern openings disclose the territory. Older inputs may omit it.
            .filter(
              (c) =>
                c.status === 'alive' &&
                (c.area === area ||
                  c.character === 'UP主' ||
                  (this.pack.characters[c.character]?.abilityArea?.publicMarker === 'territory' &&
                    (!this.opening.territory || this.opening.territory === area))),
            )
            .map((c) => c.id);
    const owners = inRange.filter(
      (owner) =>
        ['临时工', '临时工？'].includes(this.characters.get(owner)?.character ?? '') ||
        profiles.some(
          (p) =>
            p.active && roles.some((role) => p.store.domains.get('identity:' + owner)?.has(role)),
        ),
    );
    // Leave alternative custom/delayed card-resolution sources to a history witness.
    const before = actor?.counters[key] ?? this.boards[id as (typeof BOARDS)[number]];
    const after =
      o.type === 'board'
        ? Number(o.data.intrigue)
        : (o.data.counters as Record<string, number>)[key]!;
    const change: VisibleChange = {
      kind: 'counter',
      target: id,
      counter: key,
      sign: Math.sign(after - before),
    };
    if (
      owners.some((id) =>
        ['临时工', '临时工？'].includes(this.characters.get(id)?.character ?? ''),
      ) ||
      Object.values(this.catalog.forChange(o.phase, change)).some((table) =>
        [...table.values()].some((sources) => sources.some((s) => this.eligible(s, o, change))),
      )
    )
      return;
    const causes = new Set<string>();
    for (const p of profiles) {
      if (!p.active) continue;
      const alternatives: Cause[] = owners.flatMap((owner) =>
        roles
          .filter((role) => p.store.domains.get('identity:' + owner)?.has(role))
          .map((role) => ({
            category: 'character',
            label:
              this.roster.find((c) => c.id === owner)?.character + '（' + owner + '）是' + role,
            requires: [{ key: 'identity:' + owner, value: role }],
            resources: [],
            notes: [],
          })),
      );
      alternatives.forEach((a) => causes.add(a.label));
      this.network(p).add(p, {
        observation: o.sequence,
        phase: o.phase,
        alternatives,
      });
    }
    this.version++;
    this.relationFacts.set(o.sequence, {
      observation: o.sequence,
      loop: o.loop,
      day: o.day,
      phase: o.phase,
      target: id,
      description: '禁止牌生效窗口仍发生' + (key === 'goodwill' ? '友好' : '密谋') + '变化',
    });
    const scope = this.summary(o, 'visible-effect');
    scope.target = id;
    scope.characters = owners;
    scope.alternatives = [...causes];
    scope.skippedCharacters = this.roster.map((c) => c.id).filter((c) => !owners.includes(c));
    return scope;
  }
  private arrival(o: Observation, profiles: Profile[]): Scope | undefined {
    if (
      o.type !== 'character' ||
      o.phase !== 'day-start' ||
      o.data.status !== 'alive' ||
      this.lastBoundary?.phase !== 'day-start' ||
      this.lastBoundary.loop !== o.loop ||
      this.lastBoundary.day !== o.day
    )
      return;
    const id = String(o.data.character),
      old = this.characters.get(id),
      entry = this.roster.find((c) => c.id === id);
    if (
      entry?.character !== '转校生' ||
      (old && old.status !== 'absent') ||
      !o.data.counters ||
      typeof o.data.counters !== 'object' ||
      !COUNTERS.every(
        (k) => (o.data.counters as Record<string, number>)[k] === (old?.counters[k] ?? 0),
      )
    )
      return;
    // Arrival changes status only. If a hidden initial area was just exposed, bind it too.
    if (
      old
        ? old.area !== o.data.area
        : !this.pack.characters[entry.character]?.initial.some((a) => a === o.data.area)
    )
      return;
    for (const p of profiles) {
      const day = 'enterDay:' + id,
        area = 'area:' + id;
      if (p.store.domains.has(day)) p.store.narrow(day, [String(o.day)]);
      if (p.store.domains.has(area)) p.store.narrow(area, [String(o.data.area)]);
      p.active = p.store.propagate();
    }
    return this.publicFact(
      o,
      '转校生登场',
      ['登场日为第 ' + o.day + ' 日，初始区域为 ' + o.data.area],
      'arrival',
      id,
    );
  }
  private reset(o: Observation, profiles: Profile[]): Scope | undefined {
    if (
      o.phase !== 'discussion' ||
      this.lastBoundary?.phase !== 'discussion' ||
      this.lastBoundary.loop !== o.loop ||
      o.day !== 1 ||
      (o.type !== 'board' && o.type !== 'character')
    )
      return;
    const id = String(o.data.board ?? o.data.character),
      key = o.type + ':' + id;
    if (this.resetTargets.has(key)) return;
    if (o.type === 'board') {
      if (
        !BOARDS.includes(id as (typeof BOARDS)[number]) ||
        o.data.intrigue !== 0 ||
        this.boards[id as (typeof BOARDS)[number]] === 0
      )
        return;
    } else {
      const actor = this.roster.find((c) => c.id === id);
      if (
        !actor ||
        !o.data.counters ||
        typeof o.data.counters !== 'object' ||
        !COUNTERS.every((k) => (o.data.counters as Record<string, unknown>)[k] === 0)
      )
        return;
      const area = this.initialAreas.get(id);
      if (
        area
          ? area !== o.data.area
          : !this.pack.characters[actor.character]?.initial.some((a) => a === o.data.area)
      )
        return;
      if (actor.character === '神灵') {
        if (!['absent', 'alive'].includes(String(o.data.status))) return;
      } else if (
        o.data.status !== (['转校生', '临时工？'].includes(actor.character) ? 'absent' : 'alive')
      )
        return;
      for (const p of profiles) {
        const areaKey = 'area:' + id;
        if (p.store.domains.has(areaKey)) p.store.narrow(areaKey, [String(o.data.area)]);
        const date = 'enterLoop:' + id;
        if (actor.character === '神灵' && p.store.domains.has(date))
          p.store.narrow(
            date,
            [...p.store.values(date)].filter(
              (v) => Number(v) <= o.loop === (o.data.status === 'alive'),
            ),
          );
        p.active = p.store.propagate();
      }
    }
    this.resetTargets.add(key);
    return this.publicFact(
      o,
      '第 ' + o.loop + ' 轮 ' + id + ' 重置',
      ['按开局区域、登场时点及零指示物重置'],
      'loop-reset',
    );
  }
  private publicFact(
    o: Observation,
    fact: string,
    alternatives: string[],
    id: string,
    actor?: string,
  ): Scope {
    const scope = this.summary(o, 'visible-effect');
    scope.target = String(o.data.character ?? o.data.board ?? '');
    scope.characters = actor ? [actor] : [];
    scope.skippedCharacters = this.roster
      .map((c) => c.id)
      .filter((c) => !scope.characters.includes(c));
    scope.alternatives = alternatives;
    this.publicRelations.push({
      id: id + ':' + o.sequence,
      observation: o.sequence,
      fact,
      implications: [],
      cases: [{ when: [], alternatives, limits: [], notes: [] }],
    });
    this.version++;
    return scope;
  }
  private refusal(o: Observation, profiles: Profile[]): Scope | undefined {
    const actor = this.characters.get(String(o.data.character));
    if (!actor) return;
    const ability = this.pack.characters[actor.character]?.abilities.find(
      (a) => a.id === o.data.ability,
    );
    if (!ability) return;
    if (ability.cannotRefuse) {
      for (const p of profiles) p.active = false;
      return this.publicFact(
        o,
        actor.character + '的能力明确不可拒绝，与拒绝报告冲突。',
        [],
        'refused',
        actor.id,
      );
    }
    if (['临时工', '临时工？'].includes(actor.character)) return;
    const key = 'identity:' + actor.id;
    for (const p of profiles) {
      if (!p.active) continue;
      const domain = p.store.domains.get(key);
      if (!domain) continue;
      p.store.narrow(
        key,
        [...domain].filter((v) => {
          if (this.extended) return possibleForms(p,v).some(role => roleRefusal(this.pack,p.x,role,actor.counters) !== 'none');
          let identity = shownIdentity(v);
          if (
            identity === lifecycle.transformation.initial &&
            p.x.includes(lifecycle.transformation.plot) &&
            actor.counters.paranoia + actor.counters.despair >= lifecycle.transformation.paranoia
          )
            identity = lifecycle.transformation.effective;
          return (
            actor.counters.hope === 0 &&
            (actor.counters.despair > 0 || !!this.pack.identities[identity]?.ignore)
          );
        }),
      );
      p.active = p.store.propagate();
    }
    return this.publicFact(
      o,
      actor.character + '拒绝友好能力',
      [actor.counters.despair ? '绝望使其拒绝' : '当前身份允许或强制拒绝'],
      'refused',
      actor.id,
    );
  }
  private classifyChanges(
    o: Observation,
    profiles: Profile[],
    changes: VisibleChange[],
  ): Scope | undefined {
    if (
      ![
        'mastermind-abilities',
        'protagonist-abilities',
        'incident',
        'day-end',
        'loop-start',
        'loop-end',
        'day-start',
      ].includes(o.phase) ||
      this.lastBoundary?.phase !== o.phase ||
      this.lastBoundary.loop !== o.loop ||
      this.lastBoundary.day !== o.day ||
      !changes.length
    )
      return;
    if (routesObservation('declaredEffect', o) && this.nestedDeclaration) {
      const scope = this.summary(o, 'visible-effect');
      scope.needsHistory = true;
      scope.conservative.push(
        '已公开代为发动的能力；按调用次序核验其结算、后续反应和原能力的剩余步骤。',
      );
      return scope;
    }
    const active = this.declared;
    if (
      active?.independent &&
      active.phase === o.phase &&
      active.primary?.size &&
      active.primarySequence !== undefined &&
      active.primarySequence >= (o.simultaneousGroup ?? o.sequence) - 1 &&
      active.primarySequence < o.sequence
    ) {
      const target = changes[0]!.target;
      const expected = active.primary.get(target);
      if (expected && matchesGoodwillReport(expected, changes)) {
        active.primary.delete(target);
        active.primarySequence = o.sequence;
        const actor = this.characters.get(active.id)!;
        if (active.useKeys && !active.primary.size) this.recordGoodwill(active.useKeys);
        const scope = this.summary(o, 'visible-effect');
        scope.target = target;
        scope.skippedCharacters = this.roster.map((c) => c.id);
        scope.alternatives = [actor.character + '（' + actor.id + '）的' + active.ability];
        scope.conservative.push('首批变化与声明相符，直接更新盘面；额外披露或死亡反应另行处理。');
        scope.locallyExplained = true;
        scope.publicSettlement = true;
        return scope;
      }
      // A failed prediction does not make another local source necessary.
      // consume() retains this report for replay and still updates the board.
      const scope = this.summary(o, 'visible-effect');
      scope.needsHistory = true;
      return scope;
    }
    const names = {
      move: '移动',
      kill: '死亡',
      revive: '复活',
      remove: '移除',
      counter: '指示物变化',
      failure: '主人公败北',
      'protagonist-death': '主人公死亡',
    };
    const counters = {
      paranoia: '不安',
      intrigue: '密谋',
      guard: '守护',
      goodwill: '友好',
      despair: '绝望',
      hope: '希望',
    };
    const declaration = this.declared;
    let certain: { id: string; ability: string } | undefined;
    if (
      declaration &&
      !declaration.independent &&
      declaration.sequence === (o.simultaneousGroup ?? o.sequence) - 1 &&
      declaration.phase === o.phase &&
      changes.length === 1
    ) {
      const owner = this.characters.get(declaration.id);
      const ability =
        owner &&
        this.pack.characters[owner.character]?.abilities.find((a) => a.id === declaration.ability);
      const effects = ability?.steps[0]?.effects;
      const e = effects?.length === 1 && effects[0];
      const c = changes[0]!;
      if (
        e &&
        e.op === 'counter' &&
        e.counter === c.counter &&
        typeof e.amount === 'number' &&
        Math.sign(e.amount) === c.sign &&
        ability?.steps.length === 1 &&
        !ability.condition &&
        !ability.steps[0]?.condition
      ) {
        const target =
          e.target === '$self'
            ? owner?.id
            : e.target.startsWith('$')
              ? declaration.choices[e.target.slice(1)]
              : e.target;
        if (target === c.target && owner && this.characters.has(target) && c.counter) {
          const old = this.characters.get(target)!.counters[c.counter];
          const next = (o.data.counters as Record<string, number>)[c.counter];
          if (next !== old && next === Math.max(0, old + e.amount))
            certain = { id: owner.id, ability: ability!.id };
        }
      }
    }
    const batch: FieldBatch | undefined =
      changes.length > 1 ? { records: new Map(), projections: [] } : undefined;
    const fields: string[] = [];
    const scopes = changes.map((change) => {
      const who = this.roster.find((c) => c.id === change.target)?.character ?? change.target;
      const label =
        (who === '主人公' ? '' : who + '（' + change.target + '）') +
        (change.counter
          ? counters[change.counter] + (change.sign === 1 ? '增加' : '减少')
          : names[change.kind] + (change.destination ? '至 ' + change.destination : ''));
      fields.push(label);
      return this.visibleEffect(o, profiles, change, label, certain, batch);
    });
    if (batch) {
      for (const [p, records] of batch.records) this.addCauses(p, records);
      for (const project of batch.projections) project();
    }
    const local = scopes.filter((s): s is Scope => !!s);
    if (!local.length) {
      if (!routesObservation('declaredEffect', o)) return;
      const scope = this.summary(o, 'visible-effect');
      scope.needsHistory = true;
      scope.conservative.push(
        '当前声明及已知的后续来源无法在本地解释这条观察，按实际选择核验历史。',
      );
      return scope;
    }
    const merged = this.summary(o, 'visible-effect');
    const merge = () => {
      merged.target = changes[0]!.target;
      if (batch)
        merged.fields = fields.map((field, i) => ({ field, alternatives: scopes[i]?.alternatives }));
      for (const k of ['characters', 'rules', 'events', 'alternatives', 'conservative'] as const)
        merged[k] = [...new Set([...(k === 'conservative' ? merged.conservative : []), ...local.flatMap((s) => s[k] ?? [])])];
      for (const [skipped, used] of [
        ['skippedCharacters', 'characters'],
        ['skippedRules', 'rules'],
        ['skippedEvents', 'events'],
      ] as const)
        merged[skipped] = [...new Set(local.flatMap((s) => s[skipped]))].filter(
          (v) => !merged[used].includes(v),
        );
      if (local.length !== scopes.length || local.some((s) => s.needsHistory))
        merged.needsHistory = true;
      if (declaration?.independent && declaration.sequence + 1 === o.sequence && !declaration.primary)
        merged.needsHistory = true;
      if (changes.length === 1 && local[0]?.locallyExplained) merged.locallyExplained = true;
    };
    merge();
    this.simultaneous?.projections.push(merge);
    return merged;
  }
  private goodwillKeys(o: Observation, key: string) {
    return [JSON.stringify([o.loop, o.day, o.phase, key]), JSON.stringify([o.loop, key])] as const;
  }
  private recordGoodwill(keys: readonly string[]) {
    for (const key of keys)
      this.completedGoodwill.set(key, (this.completedGoodwill.get(key) ?? 0) + 1);
  }
  consume(o: Observation, profiles: Profile[], pendingWrites?: (() => void)[]): Scope | undefined {
    // All members read the entry board. Publish their changes before the next settlement.
    const write = (apply: () => void) => {
      if (pendingWrites) pendingWrites.push(apply);
      else apply();
    };
    // Mandatory refusal is published immediately after a direct declaration. A
    // delegated ability (little sister) has different threshold/refusal rules.
    const prior = this.declared;
    const constrainedCharacters = new Set<string>();
    const pending = prior?.primary?.size ?? 0;
    if (
      prior?.useKeys &&
      prior.primary?.size === 0 &&
      prior.sequence + 1 === o.sequence &&
      o.type !== 'refused'
    )
      this.recordGoodwill(prior.useKeys);
    if (
      routesObservation('afterDeclaration', o) &&
      prior?.independent &&
      prior.sequence + 1 === o.sequence &&
      o.type !== 'refused'
    ) {
      const actor = this.characters.get(prior.id);
      const ability =
        actor &&
        this.pack.characters[actor.character]?.abilities.find((a) => a.id === prior.ability);
      if (
        actor &&
        ability?.threshold !== undefined &&
        !ability.cannotRefuse &&
        actor.counters.hope === 0 &&
        !['临时工', '临时工？'].includes(actor.character)
      ) {
        const key = 'identity:' + prior.id;
        for (const p of profiles) {
          const domain = p.store.domains.get(key);
          if (!p.active || !domain) continue;
          if (this.extended) {
            if (p.store.narrow(key, [...domain].filter(v => possibleForms(p,v).some(role =>
              roleRefusal(this.pack,p.x,role,actor.counters) !== 'mandatory')))) {
              constrainedCharacters.add(actor.id);
              p.active = p.store.propagate();
            }
            continue;
          }
          if (
            actor.counters.despair === 0 &&
            ![...domain].some((v) => this.pack.identities[shownIdentity(v)]?.ignore === 'mandatory')
          )
            continue;
          p.store.narrow(
            key,
            [...domain].filter(
              (v) =>
                actor.counters.despair === 0 &&
                this.pack.identities[shownIdentity(v)]?.ignore !== 'mandatory',
            ),
          );
          constrainedCharacters.add(actor.id);
          p.active = p.store.propagate();
        }
      }
    }
    const requested = this.directRequest;
    const choice = o.type === 'own-choice' ? o.data.choice : undefined;
    if (
      o.type === 'boundary' ||
      o.type === 'refused' ||
      (choice && typeof choice === 'object' && 'kind' in choice && choice.kind !== 'select')
    ) {
      this.declared = undefined;
      this.nestedDeclaration = false;
    }
    if (!(choice && typeof choice === 'object' && 'kind' in choice && choice.kind === 'select'))
      this.directRequest = undefined;
    if (
      routesObservation('direct', o) &&
      choice &&
      typeof choice === 'object' &&
      'kind' in choice &&
      choice.kind === 'ability' &&
      'owner' in choice &&
      typeof choice.owner === 'string' &&
      'ability' in choice &&
      typeof choice.ability === 'string'
    ) {
      const actor = this.characters.get(choice.owner);
      const ability =
        actor &&
        this.pack.characters[actor.character]?.abilities.find((a) => a.id === choice.ability);
      if (actor && ability?.threshold !== undefined) {
        const [phaseUse, loopUse] = this.goodwillKeys(
          o,
          ability.sharedKey ?? actor.id + ':' + ability.id,
        );
        if (
          this.completedGoodwill.has(phaseUse) ||
          (ability.loopLimit !== undefined &&
            (this.completedGoodwill.get(loopUse) ?? 0) >= ability.loopLimit)
        ) {
          for (const p of profiles) p.active = false;
          return this.publicFact(
            o,
            '已公开完成的友好能力达到使用上限',
            [],
            'goodwill-limit',
            actor.id,
          );
        }
        if (characterCounter(actor.counters,goodwillCounter(this.pack.module,this.publicEx,'protagonist',ability.id)) < ability.threshold) {
          for (const p of profiles) p.active = false;
          return this.publicFact(
            o,
            actor.character + (goodwillCounter(this.pack.module,this.publicEx,'protagonist',ability.id) === 'paranoia' ? '独立请求的有效不安低于门槛' : '独立请求的有效友好低于门槛'),
            [],
            'goodwill-threshold',
            actor.id,
          );
        }
        this.directRequest = { id: actor.id, ability: ability.id };
      }
    }
    if (this.pairWindow && !['own-choice', 'no-effect', 'boundary', 'incident'].includes(o.type))
      this.pairWindow.hasReport = true;
    const closed = !this.extended && routesObservation('end', o) ? this.closedDayEnd(o, profiles) : undefined;
    let pairClosed: Scope | undefined;
    if (!this.extended && routesObservation('pairClose', o) && this.pairWindow) {
      const { day, loop, reports } = this.pairWindow;
      if (
        !this.pairWindow.settledQuietly &&
        o.phase === 'captain-change' &&
        o.loop === loop &&
        o.day === day
      ) {
        const group = this.pairWindow.group;
        if (group?.changed && group.remaining.size) {
          if (group.uncertain) {
            pairClosed = this.summary(o, 'mandatory-absence');
            pairClosed.needsHistory = true;
            pairClosed.conservative.push(
              '事件期间存在移动、替身或其他盘面变化，核验未结算的死亡请求。',
            );
          } else pairClosed = this.quietIncident(o, profiles, [...group.remaining]);
        }
        const used = new Set<string>();
        let needsHistory = false;
        let narrowed = false;
        for (const p of profiles) {
          const ek = 'event:' + day,
            ck = 'culprit:' + day;
          const names = p.store.domains.get(ek);
          if (!names || ![...names].some((n) => this.catalog.pairPrograms.has(n))) continue;
          let tracker = this.pairStates.get(p);
          if (!tracker && reports === 0 && names.size === 1)
            tracker = this.startPair([...names][0]!, [...p.store.values(ck)]);
          if (
            !tracker ||
            tracker.reports !== reports ||
            names.size !== 1 ||
            !names.has(tracker.name)
          ) {
            needsHistory = true;
            continue;
          }
          used.add(tracker.name);
          const result = { needsHistory: false };
          const changed = p.store.narrow(ck, [
            ...this.pairCulprits(tracker, [...p.store.values(ck)], result, o.sequence),
            ...[...p.store.values(ck)].filter(
              (id) =>
                reports === 0 &&
                traits(this.pack, this.characters.get(id)?.character).execution === 'cancel',
            ),
          ]);
          needsHistory ||= result.needsHistory;
          narrowed ||= changed;
          if (changed) p.active = p.store.propagate();
        }
        if (!used.size && reports === 0) needsHistory = true;
        if (used.size || needsHistory) {
          pairClosed =
            narrowed || needsHistory
              ? this.publicFact(
                  o,
                  '事件阶段结束，核对两步事件剩余的必选效果。',
                  [...used].map((n) => n + '每次结算须完成两步，两名目标不同。'),
                  'incident-close',
                )
              : this.summary(o, 'visible-effect');
          pairClosed.events = [...used].map((n) => day + ':' + n);
          pairClosed.needsHistory = needsHistory;
        }
      }
      if (
        o.phase === 'captain-change' &&
        o.loop === loop &&
        o.day === day &&
        this.deathsInWindow.size &&
        ['FS', 'BTX'].includes(this.pack.module)
      ) {
        const notes = new Set<string>();
        const ordinary = (id: string) =>
          !['临时工', '临时工？'].includes(this.characters.get(id)?.character ?? '');
        for (const p of profiles.filter((p) => p.active)) {
          for (const dead of this.deathsInWindow) {
            const from = 'identity:' + dead;
            const domain = p.store.domains.get(from);
            if (!ordinary(dead) || !domain) continue;
            if (
              p.store.narrow(
                from,
                [...domain].filter((v) => !this.catalog.failureRoles.includes(shownIdentity(v))),
              )
            )
              notes.add(dead + ' 死亡后仍正常进入队长交换，排除死亡必定触发败北的身份。');
            if (!p.store.consistent) break;
            for (const target of this.characters.values()) {
              if (
                target.status !== 'alive' ||
                !ordinary(target.id) ||
                this.pairWindow.arrivals.has(target.id) ||
                this.pairWindow.paranoiaRise.has(target.id)
              )
                continue;
              const to = 'identity:' + target.id,
                roles = p.store.domains.get(to);
              if (!roles) continue;
              const pairs = partnerPairs(this.pack).filter(
                ([a, b]) => domain.has(a!) && roles.has(b!),
              );
              if (!pairs.length) continue;
              if (this.catalog.extraDeathReaction) {
                pairClosed ??= this.summary(o, 'mandatory-absence');
                pairClosed.needsHistory = true;
                continue;
              }
              p.store.add(
                relation(
                  'missing-partner:' + o.sequence + ':' + dead + ':' + target.id,
                  from,
                  to,
                  (a, b) => !pairs.some(([x, y]) => a === x && b === y),
                ),
              );
              notes.add(
                dead + ' 死亡后 ' + target.id + ' 未增加不安，排除这两人的求爱者与心上人配对。',
              );
            }
          }
          p.active = p.store.propagate();
        }
        if (notes.size) {
          const end = this.publicFact(
            o,
            '事件结束时应发生的死亡联动未发生。',
            [...notes],
            'incident-death-reaction',
          );
          pairClosed ??= end;
        }
      }
      // complete() enqueues these mandatory abilities on the acting culprit.
      // Even an empty incident frame can schedule private work before phase exit.
      if (o.phase === 'captain-change' && o.loop === loop && o.day === day) {
        if (this.catalog.completionRoles.length || this.catalog.completionCards.size) {
          const owners = new Set<string>();
          for (const p of profiles.filter((p) => p.active))
            for (const id of p.store.domains.get('culprit:' + day) ?? []) {
              const actor = this.roster.find((c) => c.id === id);
              if (
                this.catalog.completionCards.has(id) ||
                this.catalog.completionRoles.some((role) =>
                  p.store.domains.get('identity:' + id)?.has(role),
                ) ||
                actor?.character === '临时工'
              )
                owners.add(id);
            }
          if (owners.size) {
            pairClosed ??= this.summary(o, 'mandatory-absence');
            pairClosed.needsHistory = true;
            pairClosed.characters = [...new Set([...pairClosed.characters, ...owners])];
            pairClosed.conservative.push(
              '当事人可能有事件结算后的强制能力，保留其触发条件和后续效果并核验历史。',
            );
          }
        }
      }
      this.pairStates.clear();
      this.pairWindow = undefined;
    }
    let goodwillDeaths: Scope | undefined;
    if (
      o.type === 'boundary' &&
      o.phase === 'incident' &&
      this.lastBoundary?.phase === 'protagonist-abilities' &&
      this.lastBoundary.loop === o.loop &&
      this.lastBoundary.day === o.day &&
      this.deathsInWindow.size && !this.extended
    ) {
      const pairs = partnerPairs(this.pack);
      for (const dead of this.deathsInWindow) {
        if (['临时工', '临时工？'].includes(this.characters.get(dead)?.character ?? '')) continue;
        const key = 'identity:' + dead;
        for (const p of profiles) {
          const domain = p.store.domains.get(key);
          if (!p.active || !domain) continue;
          if (
            p.store.narrow(
              key,
              [...domain].filter((v) => !this.catalog.failureRoles.includes(shownIdentity(v))),
            )
          ) {
            p.active = p.store.propagate();
            goodwillDeaths ??= this.summary(o, 'mandatory-absence');
            if (!goodwillDeaths.characters.includes(dead)) goodwillDeaths.characters.push(dead);
          }
          if (
            p.active &&
            pairs.some(
              ([role, partner]) =>
                domain.has(role) &&
                [...this.characters.values()].some(
                  (c) =>
                    c.status === 'alive' && p.store.domains.get('identity:' + c.id)?.has(partner),
                ),
            )
          ) {
            goodwillDeaths ??= this.summary(o, 'mandatory-absence');
            goodwillDeaths.needsHistory = true;
          }
        }
      }
      if (goodwillDeaths)
        goodwillDeaths.conservative.push(
          '已正常进入事件阶段，死者不能是死亡必定触发败北的身份；可能的幸存者联动按实际报告核验。',
        );
    }
    if (o.type === 'boundary') {
      this.resetTargets.clear();
      if ((o.phase === 'discussion' && this.pack.module !== 'WM') || o.phase === 'final-guess') this.publicEx = 0;
    }
    if (o.phase === 'day-end' && o.type !== 'boundary' && !['own-choice', 'cards'].includes(o.type))
      this.quietDayEnd = false;
    const hadDeaths = this.deathsInWindow.size > 0;
    if (o.type === 'boundary') {
      this.quietDayEnd = o.phase === 'day-end';
      this.deathsInWindow.clear();
      this.cityQualifiedAtDeath.clear();
      this.movedInWindow.clear();
      this.endEntry = ['day-end', 'loop-end'].includes(o.phase)
        ? { boards: { ...this.boards }, characters: new Map(this.characters) }
        : undefined;
    }
    const needsDeathHistory = this.extended && o.type === 'boundary' && o.phase === 'incident' &&
        this.lastBoundary?.phase === 'protagonist-abilities' && hadDeaths;
    if (o.type === 'boundary') this.lastBoundary = { loop: o.loop, day: o.day, phase: o.phase };
    const closedCards =
      o.type === 'boundary' || o.phase !== 'card-resolution'
        ? this.cardReports.close(o)
        : undefined;
    let targeted: Scope | undefined;
    if (routesObservation('cardSettlement', o)) {
      if (Object.keys(this.pack.identities).some(mastermindCardImmune) && Array.isArray(o.data.placements)) {
        for (const placement of o.data.placements) {
          if (placement?.owner !== 'mastermind') continue;
          const card = this.characters.get(placement.target);
          if (!card || ['临时工','临时工？'].includes(card.character)) continue;
          const key = 'identity:' + card.id;
          for (const p of profiles) {
            const slots = p.store.domains.get(key);
            if (p.active && slots && p.store.narrow(key,[...slots].filter(v =>
              possibleForms(p,v).some(role => !mastermindCardImmune(role))))) {
              p.active = p.store.propagate();
              targeted ??= this.summary(o,'visible-effect');
              if (!targeted.characters.includes(card.id)) targeted.characters.push(card.id);
            }
          }
        }
        if (targeted) targeted.conservative.push('剧作家的公开出牌目标须可被选中，排除当时不能成为目标的身份。');
      }
      this.cardReports.collect(
        o,
        (key, target) => {
          const roles = cardBypassRoles[key];
          if (!roles.some((role) => this.pack.identities[role])) return false;
          // Movement settles before the cultist chooses an area. Use the post-move
          // locations in bypass(); the flip can exclude only unavailable owners.
          const owners =
            key === 'goodwill' ? [this.characters.get(target)] : this.characters.values();
          for (const owner of owners) {
            if (!owner || owner.status !== 'alive') continue;
            if (
              ['临时工', '临时工？'].includes(owner.character) ||
              profiles.some(
                (p) =>
                  p.active &&
                  roles.some((role) => p.store.domains.get('identity:' + owner.id)?.has(role)),
              )
            )
              return true;
          }
          return false;
        },
        () => profiles.some((p) => p.active && p.x.includes(goodwillMovePlot)),
        multipleBlocksApply(this.pack.module, this.publicEx),
      );
    }
    const card = this.cardReports.match(o);
    if (card) delete this.cardReports.targets.get(String(o.data.character ?? o.data.board))![card];
    if (o.type === 'character' && this.cardReports.pendingGoodwill.has(String(o.data.character))) {
      const id = String(o.data.character);
      const old = this.characters.get(id)!;
      const next = (o.data.counters as Record<string, number> | undefined)?.goodwill;
      if (next === undefined || next !== old.counters.goodwill || o.data.status !== 'alive')
        this.cardReports.pendingGoodwill.delete(id);
    }
    let scope =
      (!this.extended && routesObservation('loopWindow', o) ? this.mandatoryWindow(o, profiles) : undefined) ??
      targeted ?? goodwillDeaths ??
      closed ??
      pairClosed ??
      (routesObservation('reset', o) ? this.reset(o, profiles) : undefined) ??
      (routesObservation('arrival', o) ? this.arrival(o, profiles) : undefined);
    if (closedCards?.missing.length && ['FS', 'BTX'].includes(this.pack.module)) {
      const excluded: string[] = [];
      for (const id of closedCards.missing) {
        const key = 'identity:' + id;
        const travelers = cardBypassRoles.goodwill;
        if (
          !profiles.some(
            (p) => p.active && travelers.some((role) => p.store.domains.get(key)?.has(role)),
          )
        )
          continue;
        // A nonstandard ability can alter the same field during the card window.
        const indexed = this.catalog.forChange('card-resolution', {
          kind: 'counter',
          target: id,
          counter: 'goodwill',
          sign: 1,
        });
        if (
          ['临时工', '临时工？'].includes(this.characters.get(id)?.character ?? '') ||
          Object.values(indexed).some((table) => table.size)
        ) {
          closedCards.unresolved.push(id + ' 的友好禁止窗口有替身或其他结算来源');
          continue;
        }
        for (const p of profiles) {
          const domain = p.store.domains.get(key);
          if (
            !p.active ||
            !domain ||
            ![...domain].some((v) => travelers.includes(shownIdentity(v)))
          )
            continue;
          p.store.narrow(
            key,
            [...domain].filter((v) => !travelers.includes(shownIdentity(v))),
          );
          p.active = p.store.propagate();
          if (!excluded.includes(id)) excluded.push(id);
        }
      }
      if (excluded.length) {
        scope = this.publicFact(
          o,
          '友好禁止与友好增加牌已结算，目标未增加友好',
          excluded.map((id) => id + ' 排除时间旅者'),
          'blocked-goodwill',
        );
        scope.characters = excluded;
        scope.skippedCharacters = this.roster
          .map((c) => c.id)
          .filter((id) => !excluded.includes(id));
      }
    }
    if (closedCards?.unresolved.length) {
      scope ??= this.summary(o, 'mandatory-absence');
      scope.needsHistory = true;
      scope.conservative.push(...closedCards.unresolved);
    }
    if (
      o.type === 'declaration' &&
      typeof o.data.character === 'string' &&
      typeof o.data.ability === 'string'
    ) {
      if (this.declared && !requested) this.nestedDeclaration = true;
      this.declared = {
        independent:
          requested?.id === o.data.character &&
          requested?.ability === o.data.ability &&
          o.phase === 'protagonist-abilities',
        sequence: o.sequence,
        id: o.data.character,
        ability: o.data.ability,
        phase: o.phase,
        choices: (o.data.choices ?? {}) as Record<string, string>,
      };
      if (this.declared.independent) {
        const actor = this.characters.get(this.declared.id);
        const ability =
          actor &&
          this.pack.characters[actor.character]?.abilities.find(
            (a) => a.id === this.declared!.ability,
          );
        if (actor && ability) {
          this.declared.primary = firstGoodwillReports(ability, {
            clock: o,
            days: this.days,
            loops: this.loops,
            pack: this.pack,
            characters: this.characters,
            boards: this.boards,
            owner: actor.id,
            bindings: this.declared.choices,
            virtualArea: hasVirtualArea(this.pack, actor.character),
          });
          this.declared.primarySequence = o.sequence;
          this.declared.singleStep = ability.steps.length === 1;
          if (this.declared.singleStep && this.declared.primary)
            this.declared.useKeys = this.goodwillKeys(
              o,
              ability.sharedKey ?? actor.id + ':' + ability.id,
            );
          this.declared.checkKillResolution =
            !this.declared.primary && ability.steps[0]?.effects.some((e) => e.op === 'kill');
        }
      }
      if (this.declared.independent && !scope) {
        scope = this.summary(o, 'visible-effect');
        scope.target = this.declared.id;
        scope.skippedCharacters = this.roster.map((c) => c.id);
        scope.alternatives = [
          '主人公已声明 ' +
            this.declared.id +
            ' 的 ' +
            this.declared.ability +
            '，等待拒绝或结算观察。',
        ];
        scope.locallyExplained = true;
      }
    }
    if (
      routesObservation('failure', o) &&
      ['protagonist-death', 'protagonist-failure'].includes(String(o.data.result))
    )
      scope = this.classifyChanges(o, profiles, [
        {
          kind: o.data.result === 'protagonist-death' ? 'protagonist-death' : 'failure',
          target: '主人公',
        },
      ]);
    if (routesObservation('refusal', o)) scope = this.refusal(o, profiles);
    if (card) {
      const target = String(o.data.character ?? o.data.board);
      const label =
        card === 'move'
          ? '公开移动牌结算至 ' + o.data.area
          : '公开行动牌的' + (card === 'plus' ? '增加' : '减少') + '效果与全部指示物变化吻合';
      scope = this.summary(o, 'visible-effect');
      scope.target = target;
      scope.alternatives = [
        this.cardReports.targets.get(target)!.kinds[card].join(' ＋ ') + ' · ' + label,
      ];
      scope.skippedCharacters = this.roster.map((c) => c.id);
      scope.locallyExplained = true;
      scope.publicSettlement = true;
      if (card === 'move') {
        const actor = this.characters.get(target);
        if (
          actor &&
          this.pack.characters[actor.character]?.protects &&
          this.cardReports.possibleFollowers.has(target)
        ) {
          scope.alternatives.push(actor.character + '跟随同区保护对象移动');
          scope = this.publicFact(o, target + ' 的移动结算', scope.alternatives, 'cards', target);
        }
        if (this.cardReports.targets.get(target)!.goodwillMayBlockMove) {
          scope.needsHistory = true;
          scope.conservative.push('同目标有禁止友好与移动牌，候选副线心无灵犀可禁止这次移动。');
        }
        if (
          actor &&
          this.pack.characters[actor.character]?.forbidden.some((area) => area === o.data.area)
        ) {
          scope.needsHistory = true;
          scope.conservative.push('移动进入原禁行区域，还须满足解除禁行条件。');
        }
      }
      if (card !== 'move') {
        const old = this.characters.get(target);
        const changed = [...this.cardReports.targets.get(target)!.bypass].filter((key) =>
          o.type === 'board'
            ? key === 'intrigue'
            : old && (o.data.counters as Record<string, number>)[key] !== old.counters[key],
        );
        if (changed.length > 1) scope.needsHistory = true;
        else if (changed.length === 1) {
          const narrowed = this.extended ? undefined : this.bypass(o, profiles, changed[0]!, target);
          if (narrowed) scope = narrowed;
          else scope.needsHistory = true;
        }
      }
    }
    if (
      o.type === 'board' &&
      BOARDS.includes(o.data.board as (typeof BOARDS)[number]) &&
      typeof o.data.intrigue === 'number'
    ) {
      const board = o.data.board as (typeof BOARDS)[number];
      if (o.phase === 'mastermind-abilities' && o.data.intrigue > this.boards[board])
        scope = this.visibleEffect(o, profiles, {
          kind: 'counter',
          target: board,
          counter: 'intrigue',
          sign: 1,
          before: this.boards[board],
          after: o.data.intrigue,
        });
      else if (
        !card &&
        this.boards[board] !== o.data.intrigue &&
        !(
          o.phase === 'loop-start' &&
          board === 'shrine' &&
          this.roster.some((c) => this.pack.characters[c.character]?.loopShrineIntrigue)
        )
      )
        scope =
          this.classifyChanges(o, profiles, [
            {
              kind: 'counter',
              target: board,
              counter: 'intrigue',
              sign: Math.sign(o.data.intrigue - this.boards[board]),
              before: this.boards[board],
              after: o.data.intrigue,
            },
          ]) ?? scope;
      const intrigue = o.data.intrigue;
      write(() => { this.boards[board] = intrigue; });
    } else if (routesObservation('empty', o)) {
      scope = this.extended ? undefined : this.quietIncident(o, profiles) ?? scope;
      const window = this.pairWindow;
      if (
        window &&
        o.phase === 'incident' &&
        window.loop === o.loop &&
        o.day === window.day &&
        o.data.day === o.day
      ) {
        window.completedFrame = true;
        window.hasReport = true;
      }
    } else if (o.type === 'incident') {
      if (typeof o.data.occurred === 'boolean' && o.phase === 'incident' && o.data.day === o.day)
        this.occurrence.set(o.loop + ':' + o.day, o.data.occurred);
      this.pairStates.clear();
      this.pairWindow =
        o.phase === 'incident' && o.data.occurred === true && o.data.day === o.day
          ? {
              loop: o.loop,
              day: o.day,
              reports: 0,
              modes: new Map(),
              hasReport: false,
              paranoiaRise: new Set(),
              arrivals: new Set(),
            }
          : undefined;
      scope = routesObservation('occurrence', o) ? this.incident(o, profiles) : undefined;
      if (this.pairWindow && ['FS', 'BTX'].includes(this.pack.module)) {
        const names = new Set(
          profiles
            .filter((p) => p.active)
            .flatMap((p) => [...(p.store.domains.get('event:' + o.day) ?? [])]),
        );
        const def = names.size === 1 && this.pack.incidents[[...names][0]!];
        const targets =
          def &&
          groupVictims(def.steps, {
            clock: o,
            pack: this.pack,
            characters: this.characters,
            boards: this.boards,
            days: this.days,
            loops: this.loops,
          });
        if (targets && targets.length)
          this.pairWindow.group = {
            remaining: new Set(targets),
            changed: false,
            uncertain: [...this.characters.values()].some(
              (c) => c.status === 'alive' && this.pack.characters[c.character]?.protects,
            ),
          };
      }
    } else if (o.type === 'character' && typeof o.data.character === 'string') {
      const old = this.characters.get(o.data.character);
      const entry = this.roster.find((c) => c.id === o.data.character);
      if (old && !card && o.data.counters && typeof o.data.counters === 'object') {
        const changes: VisibleChange[] = [];
        const target = old.id;
        if (old.area !== o.data.area && typeof o.data.area === 'string')
          changes.push({ kind: 'move', target, destination: o.data.area });
        if (old.status === 'alive' && o.data.status === 'dead')
          changes.push({ kind: 'kill', target });
        if (old.status === 'dead' && o.data.status === 'alive')
          changes.push({ kind: 'revive', target });
        if (old.status === 'alive' && o.data.status === 'removed')
          changes.push({ kind: 'remove', target });
        for (const counter of COUNTERS) {
          const n = (o.data.counters as Record<string, unknown>)[counter];
          if (typeof n === 'number' && n !== old.counters[counter])
            changes.push({
              kind: 'counter',
              target,
              counter,
              sign: Math.sign(n - old.counters[counter]),
              before: old.counters[counter],
              after: n,
            });
        }
        if (this.pairWindow && o.phase === 'incident') {
          if (changes.some((c) => c.counter === 'paranoia' && c.sign === 1))
            this.pairWindow.paranoiaRise.add(target);
          if (old.status !== 'alive' && o.data.status === 'alive')
            this.pairWindow.arrivals.add(target);
        }
        const group = this.pairWindow?.group;
        if (group && changes.length) {
          group.changed = true;
          if (changes.some((c) => c.kind === 'kill' || (c.counter === 'guard' && c.sign === -1)))
            group.remaining.delete(target);
          if (changes.some((c) => c.kind === 'move' || c.kind === 'revive' || c.kind === 'remove'))
            group.uncertain = true;
        }
        if (
          old.status === o.data.status ||
          changes.some((c) => ['kill', 'revive', 'remove'].includes(c.kind))
        )
          scope = this.classifyChanges(o, profiles, changes) ?? scope;
        if (old.status === 'alive' && o.data.status === 'dead') {
          write(() => { this.deathsInWindow.add(target); });
          if (this.boards.city >= lifecycle.borrowed.threshold)
            write(() => { this.cityQualifiedAtDeath.add(target); });
          if (!['临时工', '临时工？'].includes(old.character))
            for (const p of profiles) {
              const key = 'identity:' + target,
                domain = p.store.domains.get(key);
              if (
                domain &&
                p.active &&
                [...domain].some((v) => this.pack.identities[shownIdentity(v)]?.immortal)
              ) {
                p.store.narrow(
                  key,
                  [...domain].filter((v) => possibleForms(p,v).some(role => !roleImmortal(this.pack,role,old.counters))),
                );
                constrainedCharacters.add(target);
                p.active = p.store.propagate();
              }
            }
        }
      }
      if (old && old.area !== o.data.area) write(() => { this.movedInWindow.add(old.id); });
      if (
        entry &&
        typeof o.data.area === 'string' &&
        typeof o.data.status === 'string' &&
        o.data.counters
      )
        write(() => this.characters.set(entry.id, {
          ...old,
          ...entry,
          area: o.data.area,
          status: o.data.status,
          counters: structuredClone(o.data.counters),
        } as PlayerView['characters'][number]));
      if (old && old.area !== o.data.area && o.phase === 'card-resolution')
        write(() => this.cardReports.afterMove(old.id));
    }
    if (
      this.pairWindow?.group &&
      o.phase === 'incident' &&
      (o.type === 'board' ||
        (o.type === 'character' && !this.characters.get(String(o.data.character))))
    )
      this.pairWindow.group.uncertain = true;
    if (
      this.pairWindow &&
      o.phase === 'incident' &&
      ['character', 'board', 'no-effect', 'failure'].includes(o.type)
    )
      this.pairWindow.reports++;
    if (scope && pairClosed?.needsHistory) scope.needsHistory = true;
    if (scope?.locallyExplained && constrainedCharacters.size) {
      scope.publicSettlement = false;
      scope.characters = [...new Set([...scope.characters, ...constrainedCharacters])];
      scope.skippedCharacters = scope.skippedCharacters.filter(
        (id) => !constrainedCharacters.has(id),
      );
    }
    const missingPrimary = o.simultaneousGroup === undefined
      ? pending > 0 && prior?.primary?.size === pending
      : o.sequence + 1 === o.simultaneousGroup + (o.simultaneousSize ?? 1) && !!prior?.primary?.size;
    if (
      prior &&
      o.type !== 'refused' &&
      (missingPrimary ||
        (prior.checkKillResolution && prior.sequence + 1 === o.sequence))
    ) {
      // The first report is missing, altered, or interrupted. It can disclose
      // immunity, substitution, or a hidden condition; never skip that evidence.
      prior.primary = undefined;
      scope ??= this.summary(o, 'visible-effect');
      scope.needsHistory = true;
      scope.conservative.push('实际结算与声明可预期的首批报告不同，核验免疫、替代或其他介入。');
    }
    if (this.extended && (needsDeathHistory || (closedCards?.missing.length ?? 0) > 0 || (o.type === 'boundary' &&
        o.phase === 'incident' && pending > 0))) {
      scope ??= this.summary(o, 'mandatory-absence');
      scope.needsHistory = true;
    }
    if (o.type === 'board' && typeof o.data.ex === 'number') {
      const pending = this.mcGain;
      if (pending && o.phase === 'incident' && pending.sequence + 1 === (o.simultaneousGroup ?? o.sequence) &&
          o.loop === pending.loop && o.day === pending.day) {
        const gain = o.data.ex - pending.before;
        const roster = new Map(this.roster.map(c => [c.id,c.character]));
        for (const p of profiles) {
          const event = 'event:' + o.day, owner = 'culprit:' + o.day;
          if (!p.store.domains.has(event)) continue;
          p.store.add(relation('incident-ex:' + o.sequence, event, owner, (name,id) => {
            const card = roster.get(id);
            return !card || incidentExGain(this.pack,name,card) === gain;
          }));
          p.active = p.store.propagate();
        }
        scope = this.publicFact(o,'事件发生后 Ex 变化 '+gain,['按真实事件与当事人结算方式配对'],'incident-ex');
      }
      const ex = o.data.ex;
      write(() => { this.publicEx = ex; });
    }
    if (scope?.needsHistory) delete scope.publicSettlement;
    return scope;
  }
}
